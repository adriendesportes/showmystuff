#!/usr/bin/env python3
"""Final mix: voice + music (ducking) + sound effects -> build/audio/mix.wav (48 kHz, stereo, 24-bit).

Usage:
    python mix.py [--project DIR]                       # timeline.json -> mix.wav
    python mix.py --report mix-report.json --stems stems

Timeline (build/audio/timeline.json, written by `sms timeline`):
    {"duration_s": 480.0,
     "voice": [{"id": "s01", "file": "voice/s01.wav", "start_s": 1.2, "gain_db": 0}],
     "sfx": [{"type": "whoosh", "start_s": 3.0, "gain_db": -6, "pan": 0}],
     "music": {"file": "music.wav", "gain_db": 0}}        (null = no music)

Chain:
  voice : 80 Hz high-pass (4th order), light de-essing, soft compression (2.5:1), centred, loudness-aligned.
  music : set ~19 dB under the voice during speech (K-weighted, after ducking) + gain_db;
          ducking driven by the voice envelope: −9 dB, 80 ms anticipated attack, 450 ms release;
          pauses shorter than 0.8 s stay ducked (no pumping between sentences).
  sfx   : levels calibrated in sfx.py (0 dB = present under the voice) + gain_db, pan.
  master: −16 LUFS integrated, true peak ≤ −1 dBTP (look-ahead soft limiter).
"""
from __future__ import annotations

import argparse
import math
import time
from pathlib import Path

import numpy as np
from scipy import ndimage

import common as cm
from common import SR


def mean_speech_level(clips: list) -> float:
    total, nb = 0.0, 0
    for c in clips:
        x = c["x"]
        active = 10.0 * np.log10(cm.smooth_one_pole(x ** 2, 0.015) + 1e-12) > -50.0
        total += float(np.sum(x[active] ** 2))
        nb += int(np.sum(active))
    return 10.0 * math.log10(total / nb + 1e-14) if nb else -30.0


def de_esser(v: np.ndarray, mean_db: float, cutoff_hz: float = 4500.0, max_db: float = 6.0) -> tuple:
    highs = cm.filt(cm.butter(4, cutoff_hz, "high"), v, zero_phase=True)
    rest = v - highs
    e_h = 10.0 * np.log10(cm.smooth_one_pole(highs ** 2, 0.005, zero_phase=True) + 1e-14)
    e_t = 10.0 * np.log10(cm.smooth_one_pole(v ** 2, 0.005, zero_phase=True) + 1e-14)
    active = e_t > -50.0
    gr = np.clip((e_h - (mean_db - 8.0)) * (1.0 - 1.0 / 3.0), 0.0, max_db) * (e_h - e_t > -6.0)
    gr = ndimage.maximum_filter1d(gr, int(0.005 * SR) | 1, mode="nearest")
    gr = cm.smooth_one_pole(gr, 0.01, zero_phase=True)
    return rest + highs * 10.0 ** (-gr / 20.0), gr, active


def compress(v: np.ndarray, mean_db: float, ratio: float = 2.5, knee_db: float = 6.0, above_db: float = 2.0) -> tuple:
    level = 10.0 * np.log10(cm.smooth_one_pole(v ** 2, 0.015) + 1e-12)
    active = level > -50.0
    x = level - (mean_db + above_db)
    slope = 1.0 - 1.0 / ratio
    gr = np.where(x <= -knee_db / 2, 0.0, np.where(x >= knee_db / 2, slope * x, slope * (x + knee_db / 2) ** 2 / (2 * knee_db)))
    gr = ndimage.maximum_filter1d(gr, int(0.02 * SR) | 1, mode="nearest")
    gr = cm.smooth_one_pole(gr, 0.04, zero_phase=True)
    return v * 10.0 ** (-gr / 20.0), gr, active


def speech_segments(v: np.ndarray, threshold_dbfs: float = -50.0) -> list:
    env = 10.0 * np.log10(cm.smooth_one_pole(v ** 2, 0.02, zero_phase=True) + 1e-12)
    active = np.concatenate([[False], env > threshold_dbfs, [False]])
    edges = np.nonzero(np.diff(active.astype(np.int8)))[0]
    return [(int(a), int(b)) for a, b in zip(edges[::2], edges[1::2])]


def merge(segments: list, bridge_s: float = 0.8, min_s: float = 0.06) -> list:
    merged = []
    for a, b in sorted(segments):
        if merged and a - merged[-1][1] < bridge_s * SR:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return [(a, b) for a, b in merged if b - a >= min_s * SR]


def ducking_curve(n: int, segments: list, depth_db: float, attack_s: float, release_s: float) -> np.ndarray:
    d = np.zeros(n, np.float32)
    na, nr = max(2, int(attack_s * SR)), max(2, int(release_s * SR))
    up, down = cm.ramp(na).astype(np.float32), cm.ramp(nr)[::-1].astype(np.float32)
    for a, b in segments:
        d[a:b] = 1.0
        a0 = max(0, a - na)
        d[a0:a] = np.maximum(d[a0:a], up[na - (a - a0):])
        b1 = min(n, b + nr)
        d[b:b1] = np.maximum(d[b:b1], down[: b1 - b])
    d *= np.float32(-depth_db / 20.0 * math.log(10.0))
    np.exp(d, out=d)
    return d


def main() -> None:
    pa = argparse.ArgumentParser(description="Mix voice + music + sound effects.")
    cm.add_project_arg(pa)
    pa.add_argument("--timeline", default="timeline.json", help="timeline JSON (default %(default)s)")
    pa.add_argument("--out", default="mix.wav", help="output WAV (default %(default)s)")
    pa.add_argument("--sfx-dir", default="sfx", help="sound effects folder (default %(default)s)")
    pa.add_argument("--lufs", type=float, default=-16.0, help="final integrated loudness (default %(default)s)")
    pa.add_argument("--true-peak", type=float, default=-1.0, help="ceiling in dBTP (default %(default)s)")
    pa.add_argument("--ducking-db", type=float, default=9.0, help="music attenuation under the voice")
    pa.add_argument("--attack-ms", type=float, default=80.0)
    pa.add_argument("--release-ms", type=float, default=450.0)
    pa.add_argument("--bridge-ms", type=float, default=800.0, help="speech pauses shorter than this stay ducked")
    pa.add_argument("--music-under-voice-db", type=float, default=19.0, help="target voice/music gap during speech, ducking included")
    pa.add_argument("--report", default="", help="JSON report of the measurements")
    pa.add_argument("--stems", default="", help="folder for separate voice/music/sfx stems (final scale)")
    args = pa.parse_args()
    cm.set_project(args.project)
    t_start = time.time()
    tl = cm.read_json(args.timeline)
    duration = float(tl["duration_s"])
    n = int(round(duration * SR))
    report = {"duration_s": duration}

    missing = [v["file"] for v in tl.get("voice", []) if not cm.path(v["file"]).exists()]
    music_cfg = tl.get("music")
    if music_cfg and music_cfg.get("file") and not cm.path(music_cfg["file"]).exists():
        missing.append(music_cfg["file"])
    if missing:
        raise SystemExit(f"files not found: {', '.join(missing)} (run `sms voice` / `sms music`)")
    clips = []
    sos_hp = cm.butter(4, 80.0, "high")
    for v in tl.get("voice", []):
        wav = cm.path(v["file"])
        x = cm.read_wav(wav, channels=1)[:, 0] * 10 ** (float(v.get("gain_db", 0)) / 20)
        x = cm.filt(sos_hp, x)
        i0 = int(round(float(v["start_s"]) * SR))
        if i0 < 0:
            x, i0 = x[-i0:], 0
        if i0 + x.size > n:
            cm.warn(f"voice {v.get('id', wav.name)} cut by the end of the timeline")
            x = x[: max(0, n - i0)]
        clips.append({"id": v.get("id"), "start_s": float(v["start_s"]), "i0": i0, "x": x})
    mean = mean_speech_level(clips)
    stats = {"dees_max": 0.0, "dees_n": 0, "comp_max": 0.0, "comp_sum": 0.0, "active": 0}
    voice = np.zeros(n, np.float32)
    for c in clips:
        x, gr_d, active = de_esser(c["x"], mean)
        x, gr_c, active_c = compress(x, mean)
        if x.size:
            stats["dees_max"] = max(stats["dees_max"], float(gr_d.max()))
            stats["dees_n"] += int(np.sum(gr_d[active] > 1.0))
            stats["comp_max"] = max(stats["comp_max"], float(gr_c.max()))
            stats["comp_sum"] += float(np.sum(gr_c[active_c]))
            stats["active"] += int(np.sum(active_c))
        voice[c["i0"]:c["i0"] + x.size] += x.astype(np.float32)
        c["x"] = x
    active = max(1, stats["active"])
    report["de_essing"] = {"max_reduction_db": round(stats["dees_max"], 1), "frames_treated": round(stats["dees_n"] / active, 3)}
    report["compression"] = {"threshold_dbfs": round(mean + 2.0, 1), "max_reduction_db": round(stats["comp_max"], 1), "mean_reduction_db": round(stats["comp_sum"] / active, 2)}
    voice_st = np.repeat(voice[:, None], 2, axis=1)
    del voice
    l_voice = cm.lufs_integrated(voice_st)
    g_voice = 10 ** ((args.lufs - l_voice) / 20) if np.isfinite(l_voice) else 1.0
    voice_st *= np.float32(g_voice)
    segs = []
    for c in clips:
        segs += [(c["i0"] + a, c["i0"] + b) for a, b in speech_segments(c["x"] * g_voice)]
        del c["x"]
    segs = merge(segs, bridge_s=args.bridge_ms / 1000)
    mask = np.zeros(n, bool)
    for a, b in segs:
        mask[a:b] = True

    music = np.zeros((n, 2), np.float32)
    duck = ducking_curve(n, segs, args.ducking_db, args.attack_ms / 1000, args.release_ms / 1000)
    music_info, ducking_measured = {}, None
    if music_cfg and music_cfg.get("file"):
        mu = cm.read_wav(music_cfg["file"], channels=2, dtype="float32")
        m = min(n, mu.shape[0])
        music[:m] = mu[:m]
        del mu
        user_gain = float(music_cfg.get("gain_db", 0))
        audible = np.max(np.abs(music), axis=1) > 1e-6
        l_m_raw = cm.lufs_masked(music, mask & audible)
        music *= duck[:, None]
        l_v = cm.lufs_masked(voice_st, mask)
        l_m = cm.lufs_masked(music, mask & audible)
        if np.isfinite(l_v) and np.isfinite(l_m):
            g_auto = (l_v - args.music_under_voice_db) - l_m
            mode = "speech"
            ducking_measured = round(l_m_raw - l_m, 2)
        else:
            g_auto = (args.lufs - 10.0) - cm.lufs_integrated(music)
            mode = "integrated"
        outside = (~mask) & audible
        if np.any(outside) and np.isfinite(g_auto):
            short = cm.lufs_sliding(music, 3.0)
            peak = float(np.max(short[outside])) + g_auto + user_gain
            del short
            ceiling = args.lufs - 4.0
            if peak > ceiling:
                cm.warn(f"music reduced by {peak - ceiling:.1f} dB (too loud outside speech)")
                g_auto -= peak - ceiling
        g_total = g_auto + user_gain if np.isfinite(g_auto) else 0.0
        music *= np.float32(10 ** (g_total / 20))
        music_info = {"alignment": mode, "auto_gain_db": round(g_auto, 2), "timeline_gain_db": user_gain}

    sfx = np.zeros((n, 2), np.float32)
    cache, not_found = {}, []
    rng = np.random.default_rng(1)
    for e in tl.get("sfx", []):
        name = e.get("type", "")
        if name == "key":
            name = f"key-{int(rng.integers(1, 5))}"
        f = cm.path(e["file"]) if e.get("file") else cm.path(args.sfx_dir) / f"{name}.wav"
        if not f.exists():
            not_found.append(name or str(f))
            continue
        if f not in cache:
            cache[f] = cm.read_wav(f, channels=2)
        x = cache[f]
        bl, br = cm.stereo_balance(float(e.get("pan", 0)))
        g = 10 ** (float(e.get("gain_db", 0)) / 20)
        i0 = int(round(float(e["start_s"]) * SR))
        if i0 < 0:
            x, i0 = x[-i0:], 0
        m = min(x.shape[0], n - i0)
        if m > 0:
            sfx[i0:i0 + m, 0] += g * bl * x[:m, 0]
            sfx[i0:i0 + m, 1] += g * br * x[:m, 1]
    if not_found:
        cm.warn(f"sound effects not found: {', '.join(sorted(set(not_found)))} (run `sms sfx`)")

    outside = (~mask) & (np.max(np.abs(music), axis=1) > 1e-7)
    l_v = cm.lufs_masked(voice_st, mask)
    l_mp = cm.lufs_masked(music, mask)
    l_mo = cm.lufs_masked(music, outside)
    l_valone = cm.lufs_integrated(voice_st)
    peak_sfx = cm.peak_db(sfx)
    del outside

    keep = bool(args.stems)
    if keep:
        voice_stem = voice_st.copy()
    mix = voice_st
    del voice_st
    mix += music
    mix += sfx
    if not keep:
        del music, sfx
    mix, master = cm.normalize(mix, args.lufs, args.true_peak, curve=keep)
    before = master.pop("lufs_before")
    g_curve = master.pop("_gain", None)
    g_db = master["lufs"] - before if np.isfinite(before) else 0.0
    cm.write_wav(args.out, mix, "PCM_24")
    if keep:
        g = g_curve if g_curve is not None else np.float32(10 ** (g_db / 20))
        g = g[:, None] if np.ndim(g) == 1 else g
        d = cm.path(args.stems)
        for name, track in (("voice", voice_stem), ("music", music), ("sfx", sfx)):
            track *= g
            cm.write_wav(d / f"{name}.wav", track, "FLOAT")
        del voice_stem, music, sfx, g

    report.update({
        "mix": {**master, "peak_dbfs": round(cm.peak_db(mix), 2), "nan_inf": int(mix.size - np.count_nonzero(np.isfinite(mix))), "discontinuities": len(cm.discontinuities(mix))},
        "voice": {"lufs_alone": round(l_valone + g_db, 2), "speech_s": round(mask.sum() / SR, 2), "segments": len(segs), "speech_level_lufs": round(l_v + g_db, 2)},
        "music": {**music_info, "during_voice_lufs": round(l_mp + g_db, 2) if np.isfinite(l_mp) else None,
                  "outside_voice_lufs": round(l_mo + g_db, 2) if np.isfinite(l_mo) else None,
                  "voice_music_gap_during_speech_db": round(l_v - l_mp, 2) if np.isfinite(l_mp) else None,
                  "ducking_measured_db": ducking_measured},
        "sfx": {"events": len(tl.get("sfx", [])), "missing": sorted(set(not_found)), "peak_dbfs": round(peak_sfx + g_db, 2)},
    })
    report["compute_s"] = round(time.time() - t_start, 1)
    if args.report:
        cm.write_json(args.report, report)
    mu = report["music"]
    cm.info(f"{cm.rel(cm.path(args.out))}: {duration:.2f} s, {master['lufs']} LUFS, true peak {master['true_peak_dbtp']} dBTP (limiter {master['limiter_reduction_db']} dB)")
    cm.info(f"  voice {report['voice']['speech_level_lufs']} LUFS during speech; music during voice {mu.get('during_voice_lufs')} LUFS "
            f"(gap {mu.get('voice_music_gap_during_speech_db')} dB, ducking {mu.get('ducking_measured_db')} dB), outside voice {mu.get('outside_voice_lufs')} LUFS")
    cm.info(f"  {len(tl.get('sfx', []))} sound effect(s); {report['compute_s']} s")


if __name__ == "__main__":
    main()
