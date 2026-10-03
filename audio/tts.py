#!/usr/bin/env python3
"""Voice-over: synthesis (edge-tts, ElevenLabs, macOS `say`, Piper), 48 kHz mono WAV, timed words and cues.

Usage (paths relative to <project>/build/audio):
    python tts.py [--project DIR]              # scenario.json -> build/voice/<id>.wav + .json + index.json
    python tts.py --only s01,s04 --force
    python tts.py --voice edge:fr-FR-HenriNeural --out voice-henri   (compare another voice)

Voice selection, in scenario.json (global, overridable per scene):
    "voice": "edge:en-US-AriaNeural"                       free online voice (Microsoft Edge)
    "voice": "elevenlabs:eleven_v4:<voice_id>"             ElevenLabs (key in ELEVENLABS_API_KEY, keychain or ~/.config/showmystuff)
    "voice": "say:Samantha"                                macOS built-in voice, fully offline
    "voice": "piper:/path/to/model.onnx"                   Piper, local neural voice (binary `piper` in PATH)
  or an object: {"provider": "edge", "voice": "…", "rate": "+0%", "pitch": "+0Hz"}

Text mark-up in each scene's `text`:
    {{name}}              cue: time of the start of the following word (end of the last word
                          if the marker ends the text); removed from the spoken text.
    [shown|spoken]        the TTS reads "spoken", words and subtitles keep "shown".

Outputs: <out>/<id>.wav, <out>/<id>.json, <out>/index.json ({"_voice": …, "<id>": duration_s}).
Cache: <out>/.cache/<hash>.*, keyed by (spoken text, voice, rate, pitch): moving a {{cue}} or
changing the "shown" part never costs a new synthesis.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

import numpy as np
import soundfile as sf

import common as cm

CHAIN_VERSION = 1
DEFAULT_VOICE = "edge:en-US-AriaNeural"
FFMPEG = shutil.which("ffmpeg") or "ffmpeg"

MARKUP = re.compile(r"\{\{\s*([^{}]*?)\s*\}\}|\[([^\[\]|]*)\|([^\[\]]*)\]")
CUE = re.compile(r"\{\{\s*([^{}]*?)\s*\}\}")
SPACES = " \t\r\n"
NBSPS = "    "
OPENING = set("«([{“‘¿¡")
ATTACHED = set(".,…)]}")  # punctuation without a space before
NBSP = " "


# ---------------------------------------------------------------------------
# Text analysis: shown / spoken / cues
# ---------------------------------------------------------------------------

def analyze_text(text: str) -> dict:
    """Builds the shown text and the spoken text in parallel.

    map_[i] = (start, end) in the spoken text for shown character i. Cues are positions in the shown text.
    """
    shown, spoken, map_, cues = [], [], [], []
    pos = 0
    for m in MARKUP.finditer(text):
        for ch in text[pos:m.start()]:
            shown.append(ch)
            map_.append((len(spoken), len(spoken) + 1))
            spoken.append(ch)
        if m.group(1) is not None:
            cues.append((m.group(1), len(shown)))
        else:
            disp, say = m.group(2), m.group(3)
            for c in CUE.finditer(disp + " " + say):
                cues.append((c.group(1), len(shown)))
            disp = CUE.sub("", disp)
            say = CUE.sub("", say)
            d0 = len(spoken)
            spoken.extend(say)
            d1 = len(spoken)
            for ch in disp:
                shown.append(ch)
                map_.append((d0, d1))
        pos = m.end()
    for ch in text[pos:]:
        shown.append(ch)
        map_.append((len(spoken), len(spoken) + 1))
        spoken.append(ch)

    spoken = [" " if ch in NBSPS else ch for ch in spoken]
    new = [0] * (len(spoken) + 1)
    out = []
    for i, ch in enumerate(spoken):
        new[i] = len(out)
        if ch in SPACES:
            if not out or out[-1] == " ":
                continue
            out.append(" ")
        else:
            out.append(ch)
    new[len(spoken)] = len(out)
    if out and out[-1] == " ":
        out.pop()
    lim = len(out)
    map_ = [(min(new[a], lim), min(new[b], lim)) for a, b in map_]
    return {"shown": "".join(shown), "spoken": "".join(out), "map": map_, "cues": cues}


def split_shown(shown: str, map_: list) -> list:
    """Splits the shown text into words; isolated punctuation is attached to its word."""
    tokens = []
    pending = None
    for m in re.finditer(r"[^ \t\r\n]+", shown):
        a, b, tok = m.start(), m.end(), m.group()
        if not any(ch.isalnum() for ch in tok):
            if all(ch in OPENING for ch in tok) or not tokens:
                pending = (pending[0], pending[1] + NBSP + tok) if pending else (a, tok)
                continue
            j = tokens[-1]
            sep = "" if all(ch in ATTACHED for ch in tok) else NBSP
            j["end"] = b
            j["text"] += sep + tok
            continue
        text = tok
        start = a
        if pending:
            start = pending[0]
            text = pending[1] + NBSP + tok
            pending = None
        tokens.append({"start": start, "end": b, "text": text})
    if pending and tokens:
        tokens[-1]["text"] += NBSP + pending[1]
        tokens[-1]["end"] = len(shown)
    for j in tokens:
        span = [map_[i] for i in range(j["start"], j["end"]) if i < len(map_)]
        j["ss"] = min(e[0] for e in span) if span else 0
        j["se"] = max(e[1] for e in span) if span else 0
    return tokens


def _key(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKC", text).lower() if c.isalnum())


def locate_boundaries(spoken: str, boundaries: list) -> list:
    """Finds each word boundary in the spoken text (letters and digits only comparison)."""
    alnum, pos = [], []
    for i, ch in enumerate(spoken):
        for c in unicodedata.normalize("NFKC", ch).lower():
            if c.isalnum():
                alnum.append(c)
                pos.append(i)
    s = "".join(alnum)
    cursor = 0
    spans = []
    for b in boundaries:
        k = _key(b["text"])
        if not k:
            spans.append(None)
            continue
        j = s.find(k, cursor, cursor + 40 + len(k))
        if j < 0 and len(k) >= 4:
            j = s.find(k, cursor)
        if j < 0:
            spans.append(None)
            continue
        spans.append((pos[j], pos[j + len(k) - 1] + 1))
        cursor = j + len(k)
    return spans


def _weight(text: str) -> float:
    w = sum(2.2 if c.isdigit() else 1.0 for c in text if c.isalnum())
    return max(w, 0.5)


def time_words(tokens: list, spoken: str, boundaries: list) -> list:
    """Assigns (t, d) to each shown word from the provider's word boundaries."""
    spans = locate_boundaries(spoken, boundaries)
    ok = [(b["t"], b["t"] + b["d"], e) for b, e in zip(boundaries, spans) if e]
    for j in tokens:
        j["fr"] = [k for k, (_, _, (s, e)) in enumerate(ok) if s < j["se"] and e > j["ss"]]
    groups = []
    for k, j in enumerate(tokens):
        if j["fr"] and groups and tokens[groups[-1][-1]]["fr"] and min(j["fr"]) <= max(max(tokens[g]["fr"]) for g in groups[-1]):
            groups[-1].append(k)
        else:
            groups.append([k])
    times = [None] * len(tokens)
    for g in groups:
        idx = sorted({f for k in g for f in tokens[k]["fr"]})
        if not idx:
            continue
        t0 = min(ok[f][0] for f in idx)
        t1 = max(ok[f][1] for f in idx)
        w = np.array([_weight(spoken[tokens[k]["ss"]:tokens[k]["se"]]) for k in g])
        edges = t0 + (t1 - t0) * np.concatenate([[0.0], np.cumsum(w) / w.sum()])
        for i, k in enumerate(g):
            times[k] = (float(edges[i]), float(edges[i + 1]))
    k = 0
    end_ok = max((f[1] for f in ok), default=0.0)
    start_ok = min((f[0] for f in ok), default=0.0)
    while k < len(tokens):
        if times[k] is not None:
            k += 1
            continue
        k2 = k
        while k2 < len(tokens) and times[k2] is None:
            k2 += 1
        a = times[k - 1][1] if k > 0 else start_ok
        b = times[k2][0] if k2 < len(tokens) else max(a, end_ok)
        b = max(a, b)
        w = np.array([_weight(spoken[tokens[i]["ss"]:tokens[i]["se"]] or tokens[i]["text"]) for i in range(k, k2)])
        edges = a + (b - a) * np.concatenate([[0.0], np.cumsum(w) / w.sum()])
        for i in range(k, k2):
            times[i] = (float(edges[i - k]), float(edges[i - k + 1]))
        k = k2
    return [{"t": round(t0, 3), "d": round(max(0.0, t1 - t0), 3), "text": j["text"]} for j, (t0, t1) in zip(tokens, times)]


def compute_cues(cues: list, tokens: list, words: list) -> dict:
    out = {}
    for name, pos in cues:
        t = None
        for j, m in zip(tokens, words):
            if j["start"] >= pos:
                t = m["t"]
                break
        if t is None:
            t = (words[-1]["t"] + words[-1]["d"]) if words else 0.0
        key, n = name or "cue", 2
        while key in out:
            key = f"{name}_{n}"
            n += 1
        if key != name:
            cm.warn(f"duplicate cue \"{name}\" renamed \"{key}\"")
        out[key] = round(float(t), 3)
    return out


# ---------------------------------------------------------------------------
# Timing estimation for providers without word boundaries (say, piper)
# ---------------------------------------------------------------------------

def speech_segments(x: np.ndarray, gap_s: float = 0.22) -> list:
    """[(start, end)] of speech measured on energy (10 ms frames, threshold peak − 35 dB), pauses > gap_s split."""
    fr = int(0.01 * cm.SR)
    n = len(x) // fr
    if n == 0:
        return []
    rms = np.sqrt(np.mean(x[: n * fr].reshape(n, fr) ** 2, axis=1))
    thr = max(np.max(rms) * 10 ** (-35 / 20), 10 ** (-60 / 20))
    active = rms > thr
    segs, start, last = [], None, None
    for i, a in enumerate(active):
        if a:
            if start is None:
                start = i
            last = i
        elif start is not None and (i - last) * 0.01 > gap_s:
            segs.append((start * 0.01, (last + 1) * 0.01))
            start = None
    if start is not None:
        segs.append((start * 0.01, (last + 1) * 0.01))
    return segs


def estimated_boundaries(spoken: str, x: np.ndarray) -> list:
    """Word boundaries estimated from the audio envelope: sentences are mapped onto speech
    segments when their counts match, then words are spread by weight (digits count more,
    punctuation adds a pause)."""
    words = [w for w in re.findall(r"\S+", spoken)]
    if not words:
        return []
    segs = speech_segments(x)
    if not segs:
        segs = [(0.0, len(x) / cm.SR)]
    # Sentences = runs ending with . ! ? …
    sentences, cur = [], []
    for w in words:
        cur.append(w)
        if re.search(r"[.!?…]['\")»]*$", w):
            sentences.append(cur)
            cur = []
    if cur:
        sentences.append(cur)
    out = []

    def spread(ws, t0, t1):
        weights = []
        for w in ws:
            wt = _weight(w)
            if re.search(r"[,;:]$", w):
                wt += 1.5
            if re.search(r"[.!?…]['\")»]*$", w):
                wt += 2.5
            weights.append(wt)
        weights = np.array(weights)
        edges = t0 + (t1 - t0) * np.concatenate([[0.0], np.cumsum(weights) / weights.sum()])
        for i, w in enumerate(ws):
            d = max(0.04, (edges[i + 1] - edges[i]) * 0.85)
            out.append({"t": float(edges[i]), "d": float(d), "text": w})

    if len(sentences) == len(segs) and len(segs) > 1:
        for ws, (a, b) in zip(sentences, segs):
            spread(ws, a, b)
    else:
        spread(words, segs[0][0], segs[-1][1])
    return out


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------

def parse_voice(v, default: dict) -> dict:
    """Normalises a voice spec (string or object) into {provider, voice, model, rate, pitch}."""
    spec = dict(default)
    if isinstance(v, dict):
        spec.update({k: v[k] for k in ("provider", "voice", "model", "rate", "pitch") if k in v})
        return spec
    if isinstance(v, str) and v:
        parts = v.split(":")
        if parts[0] in ("edge", "elevenlabs", "say", "piper"):
            spec["provider"] = parts[0]
            if parts[0] == "elevenlabs":
                if len(parts) == 3:
                    spec["model"], spec["voice"] = parts[1], parts[2]
                elif len(parts) == 2:
                    spec["voice"] = parts[1]
            else:
                spec["voice"] = ":".join(parts[1:])
        else:  # bare edge voice name
            spec["provider"], spec["voice"] = "edge", v
    return spec


async def synth_edge(spoken: str, voice: str, rate: str, pitch: str, tries: int = 4) -> tuple:
    import edge_tts
    last = None
    for attempt in range(tries):
        try:
            com = edge_tts.Communicate(spoken, voice, rate=rate, pitch=pitch, boundary="WordBoundary")
            audio = bytearray()
            bounds = []
            async for chunk in com.stream():
                if chunk["type"] == "audio":
                    audio += chunk["data"]
                elif chunk["type"] == "WordBoundary":
                    bounds.append({"t": chunk["offset"] / 1e7, "d": chunk["duration"] / 1e7, "text": chunk["text"]})
            if not audio:
                raise RuntimeError("no audio received")
            return bytes(audio), "mp3", bounds
        except Exception as e:  # network / service errors
            last = e
            if attempt < tries - 1:
                wait = 1.5 * 2 ** attempt
                cm.warn(f"edge-tts: {type(e).__name__}: {e} — retrying in {wait:.1f} s")
                await asyncio.sleep(wait)
    raise RuntimeError(f"edge-tts failed after {tries} attempts: {last}")


def elevenlabs_key() -> str:
    """API key read at call time: ELEVENLABS_API_KEY, then macOS keychain (service
    `showmystuff-elevenlabs` or `elevenlabs`), then ~/.config/showmystuff/elevenlabs.key. Never written nor printed."""
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not key and sys.platform == "darwin":
        for service in ("showmystuff-elevenlabs", "elevenlabs"):
            r = subprocess.run(["security", "find-generic-password", "-s", service, "-w"], capture_output=True, text=True)
            if r.returncode == 0 and r.stdout.strip():
                key = r.stdout.strip()
                break
    if not key:
        f = Path.home() / ".config" / "showmystuff" / "elevenlabs.key"
        if f.exists():
            key = f.read_text(encoding="utf-8").strip()
    if not key:
        raise RuntimeError("ElevenLabs key not found (set ELEVENLABS_API_KEY, or run `sms key elevenlabs`)")
    return key


def elevenlabs_call(method: str, route: str, body: dict | None = None, timeout: float = 180) -> dict:
    import urllib.error
    import urllib.request
    req = urllib.request.Request("https://api.elevenlabs.io" + route, method=method,
                                 data=json.dumps(body).encode("utf-8") if body is not None else None,
                                 headers={"xi-api-key": elevenlabs_key(), "Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as rep:
            return json.loads(rep.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"ElevenLabs {method} {route.split('?')[0]} → HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:400]}")


ELEVENLABS_SETTINGS = {"stability": 0.5, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": True}
ELEVENLABS_MODEL_FALLBACKS = ["eleven_v4", "eleven_v3", "eleven_multilingual_v2"]


def words_from_alignment(al: dict) -> list:
    chars, starts, ends = al["characters"], al["character_start_times_seconds"], al["character_end_times_seconds"]
    words, cur = [], None
    for c, a, b in zip(chars, starts, ends):
        if c.isspace():
            if cur:
                words.append(cur)
                cur = None
            continue
        if cur is None:
            cur = {"t": float(a), "end": float(b), "text": c}
        else:
            cur["end"] = float(b)
            cur["text"] += c
    if cur:
        words.append(cur)
    return [{"t": w["t"], "d": max(0.01, w["end"] - w["t"]), "text": w["text"]} for w in words]


async def synth_elevenlabs(spoken: str, model: str, voice_id: str, rate: str, language: str, tries: int = 4) -> tuple:
    import base64
    speed = 1.0
    m = re.match(r"^([+-]?\d+(?:\.\d+)?)%$", (rate or "").strip())
    if m:
        speed = max(0.7, min(1.2, 1 + float(m.group(1)) / 100))
    models = [model] + [x for x in ELEVENLABS_MODEL_FALLBACKS if x != model]
    body = {"text": spoken, "model_id": models[0], "voice_settings": {**ELEVENLABS_SETTINGS, "speed": speed}}
    if language:
        body["language_code"] = language[:2]
    last = None
    for attempt in range(tries):
        try:
            route = f"/v1/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_192"
            try:
                rep = await asyncio.to_thread(elevenlabs_call, "POST", route, body)
            except RuntimeError as e:
                msg = str(e)
                if "language_code" in msg and "language_code" in body:
                    body.pop("language_code")
                    rep = await asyncio.to_thread(elevenlabs_call, "POST", route, body)
                elif "model" in msg.lower() and "HTTP 4" in msg and len(models) > 1:
                    cm.warn(f"ElevenLabs: model {body['model_id']} unavailable, trying {models[1]}")
                    models.pop(0)
                    body["model_id"] = models[0]
                    continue
                else:
                    raise
            audio = base64.b64decode(rep["audio_base64"])
            al = rep.get("alignment") or rep.get("normalized_alignment")
            if not audio or not al:
                raise RuntimeError("ElevenLabs answer without audio or alignment")
            return audio, "mp3", words_from_alignment(al)
        except Exception as e:
            last = e
            if "HTTP 4" in str(e) and "HTTP 429" not in str(e):
                raise
            if attempt < tries - 1:
                wait = 2.0 * 2 ** attempt
                cm.warn(f"ElevenLabs: {e} — retrying in {wait:.0f} s")
                await asyncio.sleep(wait)
    raise RuntimeError(f"ElevenLabs failed after {tries} attempts: {last}")


async def synth_say(spoken: str, voice: str, rate: str, tmp: Path) -> tuple:
    """macOS `say` (offline). Rate "+10%" → words per minute around 175 × 1.1."""
    if sys.platform != "darwin" or not shutil.which("say"):
        raise RuntimeError("the `say` provider needs macOS")
    wpm = 175
    m = re.match(r"^([+-]?\d+(?:\.\d+)?)%$", (rate or "").strip())
    if m:
        wpm = int(round(175 * (1 + float(m.group(1)) / 100)))
    out = tmp.with_suffix(".aiff")
    cmd = ["say", "-r", str(wpm), "-o", str(out)]
    if voice:
        cmd += ["-v", voice]
    cmd += ["--", spoken]
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
    _, err = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"say: {err.decode(errors='replace').strip() or 'failed'} (voice \"{voice}\"? run `sms voices say`)")
    data = out.read_bytes()
    out.unlink(missing_ok=True)
    return data, "aiff", None


async def synth_piper(spoken: str, model: str, rate: str, tmp: Path) -> tuple:
    """Piper (local neural TTS): `piper --model x.onnx --output_file out.wav` reading stdin."""
    binary = shutil.which("piper")
    if not binary:
        raise RuntimeError("the `piper` provider needs the `piper` binary in PATH (https://github.com/rhasspy/piper)")
    model = model or os.environ.get("PIPER_MODEL", "")
    if not model:
        raise RuntimeError("piper: give a model path (voice \"piper:/path/model.onnx\" or PIPER_MODEL)")
    length = 1.0
    m = re.match(r"^([+-]?\d+(?:\.\d+)?)%$", (rate or "").strip())
    if m:
        length = 1 / max(0.5, min(1.6, 1 + float(m.group(1)) / 100))
    out = tmp.with_suffix(".wav")
    proc = await asyncio.create_subprocess_exec(binary, "--model", model, "--output_file", str(out), "--length_scale", str(length),
                                                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
    _, err = await proc.communicate(spoken.encode("utf-8"))
    if proc.returncode != 0 or not out.exists():
        raise RuntimeError(f"piper: {err.decode(errors='replace').strip() or 'failed'}")
    data = out.read_bytes()
    out.unlink(missing_ok=True)
    return data, "wav", None


# ---------------------------------------------------------------------------
# Conversion, cache, per-scene processing
# ---------------------------------------------------------------------------

async def convert(src: Path, wav: Path) -> None:
    """Any audio -> WAV 48 kHz mono float32 through ffmpeg."""
    tmp = wav.with_name(wav.stem + ".tmp.wav")
    proc = await asyncio.create_subprocess_exec(
        FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-ac", "1",
        "-af", "aresample=48000:filter_size=64:cutoff=0.96", "-c:a", "pcm_f32le", str(tmp),
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
    _, err = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg: {err.decode(errors='replace')}")
    tmp.replace(wav)


def speech_bounds(x: np.ndarray) -> tuple:
    fr = int(0.01 * cm.SR)
    n = len(x) // fr
    if n == 0:
        return 0.0, 0.0
    rms = np.sqrt(np.mean(x[: n * fr].reshape(n, fr) ** 2, axis=1))
    thr = max(np.max(rms) * 10 ** (-40 / 20), 10 ** (-60 / 20))
    active = np.nonzero(rms > thr)[0]
    if active.size == 0:
        return 0.0, 0.0
    return round(active[0] * 0.01, 3), round((active[-1] + 1) * 0.01, 3)


def fingerprint(spoken: str, spec: dict) -> str:
    key = json.dumps({"spoken": spoken, "provider": spec["provider"], "voice": spec["voice"], "model": spec.get("model", ""),
                      "rate": spec.get("rate", ""), "pitch": spec.get("pitch", ""), "v": CHAIN_VERSION}, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:20]


async def process_scene(scene: dict, default: dict, language: str, folder: Path, force: bool, sem: asyncio.Semaphore) -> dict:
    sid = str(scene["id"])
    spec = parse_voice(scene.get("voice"), default)
    analysis = analyze_text(scene["text"])
    spoken = analysis["spoken"]
    if not spoken.strip():
        raise ValueError(f"{sid}: empty spoken text")
    h = fingerprint(spoken, spec)
    cache = folder / ".cache"
    cache.mkdir(parents=True, exist_ok=True)
    meta = cache / f"{h}.json"
    wav, js = folder / f"{sid}.wav", folder / f"{sid}.json"

    status = "cache"
    if force or not meta.exists():
        async with sem:
            t0 = time.time()
            p = spec["provider"]
            if p == "edge":
                audio, ext, bounds = await synth_edge(spoken, spec["voice"], spec.get("rate", "+0%"), spec.get("pitch", "+0Hz"))
            elif p == "elevenlabs":
                audio, ext, bounds = await synth_elevenlabs(spoken, spec.get("model") or "eleven_v4", spec["voice"], spec.get("rate", "+0%"), language)
            elif p == "say":
                audio, ext, bounds = await synth_say(spoken, spec["voice"], spec.get("rate", "+0%"), cache / f"{h}.tmp")
            elif p == "piper":
                audio, ext, bounds = await synth_piper(spoken, spec["voice"], spec.get("rate", "+0%"), cache / f"{h}.tmp")
            else:
                raise ValueError(f"{sid}: unknown voice provider \"{p}\" (edge, elevenlabs, say, piper)")
            raw = cache / f"{h}.{ext}"
            raw.write_bytes(audio)
            cm.write_json(meta, {"spoken": spoken, "spec": spec, "ext": ext, "boundaries": bounds})
            status = f"synthesis {time.time() - t0:.1f} s"
    info = cm.read_json(meta)
    raw = cache / f"{h}.{info['ext']}"

    previous = None
    if js.exists():
        try:
            previous = cm.read_json(js)
        except (OSError, json.JSONDecodeError):
            previous = None
    if force or not wav.exists() or not previous or previous.get("hash") != h:
        await convert(raw, wav)
        if status == "cache":
            status = "cache (reconverted)"

    x, sr = sf.read(str(wav), dtype="float64")
    if x.ndim > 1:
        x = x.mean(axis=1)
    duration = round(len(x) / sr, 3)
    bounds = info.get("boundaries")
    estimated = bounds is None
    if estimated:
        bounds = estimated_boundaries(spoken, x)
    tokens = split_shown(analysis["shown"], analysis["map"])
    words = time_words(tokens, spoken, bounds)
    cues = compute_cues(analysis["cues"], tokens, words)
    start, end = speech_bounds(x)
    peak = float(np.max(np.abs(x))) if x.size else 0.0
    if peak > 0.99:
        cm.warn(f"{sid}: peak {20 * np.log10(peak):.1f} dBFS in the decoded voice")
    data = {
        "id": sid, "duration_s": duration, "words": words, "cues": cues,
        "speech_start_s": start, "speech_end_s": end,
        "text": scene["text"], "text_shown": " ".join(m["text"] for m in words), "text_spoken": spoken,
        "provider": spec["provider"], "voice": spec["voice"], "model": spec.get("model", ""),
        "rate": spec.get("rate", ""), "pitch": spec.get("pitch", ""), "timing": "estimated" if estimated else "provider",
        "hash": h,
        "boundaries": [{"t": round(b["t"], 4), "d": round(b["d"], 4), "text": b["text"]} for b in bounds],
    }
    cm.write_json(js, data)
    if not estimated:
        missing = len(bounds) - sum(1 for e in locate_boundaries(spoken, bounds) if e)
        if missing:
            cm.warn(f"{sid}: {missing} word boundar(ies) not found in the text (times interpolated)")
    cm.info(f"  {sid:>8}: {duration:6.2f} s, {len(words):3d} words, {len(cues)} cue(s) — {status}{' (timing estimated)' if estimated else ''}")
    return data


async def main_async(args) -> int:
    proj = cm.set_project(args.project)
    scenario = cm.read_json(proj / "scenario.json")
    default = {"provider": "edge", "voice": "", "model": "", "rate": "+0%", "pitch": "+0Hz"}
    default = parse_voice(args.voice or scenario.get("voice") or DEFAULT_VOICE, default)
    if not default.get("voice") and default["provider"] == "edge":
        default["voice"] = DEFAULT_VOICE.split(":", 1)[1]
    language = str(scenario.get("language") or "")
    folder = cm.path(args.out) if args.out else proj / "build" / "voice"
    folder.mkdir(parents=True, exist_ok=True)
    scenes = [s for s in scenario.get("scenes", []) if isinstance(s.get("text"), str) and s["text"].strip()]
    ids = [str(s["id"]) for s in scenes]
    if len(set(ids)) != len(ids):
        cm.warn("duplicate scene ids in the scenario")
    chosen = scenes
    if args.only:
        wanted = [x.strip() for x in args.only.split(",") if x.strip()]
        unknown = set(wanted) - set(ids)
        if unknown:
            cm.warn(f"unknown scenes or scenes without text: {', '.join(sorted(unknown))}")
        chosen = [s for s in scenes if str(s["id"]) in wanted]
    label = f"{default['provider']}:{default.get('model') + ':' if default.get('model') else ''}{default['voice']}"
    cm.info(f"Voice {label}, rate {default['rate']} -> {cm.rel(folder)}/ ({len(chosen)} scene(s))")
    sem = asyncio.Semaphore(max(1, args.parallel))
    t0 = time.time()
    results = await asyncio.gather(*(process_scene(s, default, language, folder, args.force, sem) for s in chosen), return_exceptions=True)
    errors = [(s["id"], r) for s, r in zip(chosen, results) if isinstance(r, Exception)]
    for sid, e in errors:
        print(f"ERROR {sid}: {e}", file=sys.stderr)

    index = {"_voice": label}
    for s in scenes:
        js = folder / f"{s['id']}.json"
        if not js.exists():
            continue
        d = cm.read_json(js)
        expected = fingerprint(analyze_text(s["text"])["spoken"], parse_voice(s.get("voice"), default))
        if d.get("hash") != expected:
            cm.warn(f"{s['id']}: stale voice (text or voice changed), regenerate")
        index[str(s["id"])] = d["duration_s"]
    cm.write_json(folder / "index.json", index)
    total = sum(v for k, v in index.items() if not k.startswith("_"))
    cm.info(f"index.json: {len(index) - 1} scene(s), {total:.1f} s of voice — {time.time() - t0:.1f} s")
    if any(isinstance(r, dict) and r.get("timing") == "estimated" for r in results):
        cm.info("Word timings are estimated for this provider (cues land near the right word, not on it); "
                "edge and elevenlabs voices return measured timings.")
    return 1 if errors else 0


def main() -> None:
    p = argparse.ArgumentParser(description="Voice-over -> build/voice/<id>.wav + timed words + cues.")
    cm.add_project_arg(p)
    p.add_argument("--out", default="", help="output folder (default build/voice)")
    p.add_argument("--only", default="", help="comma-separated scene ids")
    p.add_argument("--voice", default="", help="override the scenario's global voice (comparison)")
    p.add_argument("--force", action="store_true", help="ignore the cache and resynthesise")
    p.add_argument("--parallel", type=int, default=4, help="simultaneous requests")
    args = p.parse_args()
    sys.exit(asyncio.run(main_async(args)))


if __name__ == "__main__":
    main()
