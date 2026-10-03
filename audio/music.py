#!/usr/bin/env python3
"""Original synthesised music (no external sample) from a plan of sections.

Usage:
    python music.py [--project DIR]                  # music-plan.json -> music.wav + music-reperes.json
    python music.py --seed 5 --stems stems           # another variation, separate stems

Plan (build/audio/music-plan.json, written by `sms timeline`):
    {"duration_s": 480.0, "bpm": 94, "seed": 3,
     "sections": [{"start_s": 0, "end_s": 12.5, "intensity": 0..3, "accent_start": true}, ...]}
  intensity 0 = pad only; 1 = + electric piano; 2 = + sub bass and soft drums; 3 = + discreet arpeggio.

Style: warm lo-fi / corporate bed. maj7/maj9/m7/m9 chords in F major, two 4-bar progressions,
computed voice leading. Sections start on a bar line: the tempo is adjusted per section
(±6 % at most) so that the bar falls on the requested time. Ending: resolution chord at the end
of the last section, one bar of resonance, 3 s of reverb tail, then silence until duration_s.
"""
from __future__ import annotations

import argparse
import itertools
import math
import time
from dataclasses import dataclass

import numpy as np

import common as cm
from common import SR, butter, filt, mtof, ramp, times

TAIL_S = 3.0
SWING = 0.56

NOTE_NAMES = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}
QUALITIES = {"maj7": (0, 4, 7, 11), "maj9": (0, 4, 7, 11, 14), "maj9#11": (0, 4, 7, 11, 14, 18), "m7": (0, 3, 7, 10), "m9": (0, 3, 7, 10, 14)}
PROGRESSION_A = (("F", "maj9"), ("A", "m7"), ("D", "m9"), ("Bb", "maj9#11"))
PROGRESSION_B = (("D", "m9"), ("Bb", "maj9"), ("G", "m9"), ("A", "m7"))
FINAL_CHORD = ("F", "maj9")
PENTATONIC = {5, 7, 9, 0, 2}

LEVELS = {"pad": 0.085, "piano": 0.16, "bass": 0.17, "kick": 0.40, "snap": 0.085, "shaker": 0.026, "hat": 0.018, "arp": 0.18, "rise": 0.06, "boom": 0.26}
SENDS = {"pad": 0.21, "piano": 0.23, "snap": 0.35, "shaker": 0.15, "hat": 0.10, "arp": 0.45, "rise": 0.35, "boom": 0.12, "bass": 0.0, "kick": 0.0}
PAD_BY_INTENSITY = {0: 1.0, 1: 0.82, 2: 0.72, 3: 0.66}
BRIGHTNESS_BY_INTENSITY = {0: 0.15, 1: 0.3, 2: 0.42, 3: 0.55}

PIANO_CALM = [[(0.0, 3.6, 0.62)], [(0.0, 1.8, 0.60), (2.5, 1.3, 0.45)], [(0.0, 2.4, 0.60), (3.0, 0.9, 0.38)]]
PIANO_RHYTHM = [[(0.0, 0.9, 0.60), (1.5, 0.45, 0.48), (2.5, 1.2, 0.55)], [(0.0, 1.2, 0.58), (1.75, 0.5, 0.45), (3.0, 0.8, 0.50)],
                [(0.0, 1.6, 0.60), (2.0, 0.45, 0.42), (2.75, 1.1, 0.50)], [(0.0, 0.7, 0.60), (0.75, 0.6, 0.40), (2.5, 1.3, 0.55)]]
BASS_PATTERNS = [[(0.0, 1.4, 0, 0.90), (1.5, 0.45, 0, 0.60), (2.5, 1.35, 0, 0.75)], [(0.0, 2.35, 0, 0.90), (2.5, 1.35, 7, 0.62)],
                 [(0.0, 0.7, 0, 0.90), (0.75, 0.65, 0, 0.55), (2.0, 1.85, 0, 0.80)]]
KICK_PATTERNS = [[0.0, 2.5], [0.0, 1.75, 2.5], [0.0, 2.25]]
ARP_PATTERNS = [[0, 1, 2, 3, 2, 1, None, None], [0, None, 1, 2, None, 3, 2, None], [2, 1, 0, None, 1, 2, 3, None], [0, 2, 1, 3, None, 2, None, 1]]


@dataclass(frozen=True)
class Chord:
    root: int
    intervals: tuple
    name: str

    @property
    def classes(self) -> set:
        return {(self.root + i) % 12 for i in self.intervals}

    @property
    def guides(self) -> set:
        return {(self.root + i) % 12 for i in self.intervals if i in (3, 4, 10, 11)}


def chord(root: str, quality: str) -> Chord:
    return Chord(NOTE_NAMES[root], QUALITIES[quality], root.replace("b", "♭") + quality)


def place(cls: int, lo: int, hi: int, target: float) -> int:
    notes = [m for m in range(lo, hi + 1) if m % 12 == cls]
    return min(notes, key=lambda m: abs(m - target))


def voicing(ch: Chord, previous, lo: int, hi: int, nb: int, centre: float) -> list:
    classes = ch.classes - {ch.root}
    if len(classes) < nb:
        classes = ch.classes
    candidates = [m for m in range(lo, hi + 1) if m % 12 in classes]
    best, best_cost = None, math.inf
    for need_guides in (True, False):
        for combo in itertools.combinations(candidates, nb):
            cl = [m % 12 for m in combo]
            if len(set(cl)) < nb or (need_guides and not ch.guides <= set(cl)):
                continue
            if any(b - a < (3 if a < 60 else 2) for a, b in zip(combo, combo[1:])):
                continue
            if combo[-1] - combo[0] > 17:
                continue
            cost = 0.6 * abs(float(np.mean(combo)) - centre)
            if previous:
                cost += sum(abs(a - b) for a, b in zip(combo, previous))
            if cost < best_cost:
                best, best_cost = list(combo), cost
        if best:
            return best
    return sorted(place(c, lo, hi, centre) for c in list(ch.classes)[:nb])


def swing(pos: float) -> float:
    frac = pos % 1.0
    if abs(frac - 0.5) < 1e-6:
        return pos + (SWING - 0.5)
    if abs(frac - 0.25) < 1e-6 or abs(frac - 0.75) < 1e-6:
        return pos + (SWING - 0.5) / 2
    return pos


@dataclass
class Bar:
    start: float
    length: float
    section: int
    intensity: int
    accent: bool
    rank: int
    chord: Chord | None = None

    def t(self, pos: float) -> float:
        return self.start + pos * self.length / 4.0


def build_grid(plan: dict, max_dev: float) -> tuple:
    duration = float(plan["duration_s"])
    bpm = float(plan.get("bpm", 94))
    bar_nom = 240.0 / bpm
    sections = sorted((dict(s) for s in plan["sections"]), key=lambda s: float(s["start_s"]))
    if not sections:
        raise SystemExit("plan without sections")
    t = max(0.0, float(sections[0]["start_s"]))
    end_max = duration - (bar_nom + TAIL_S)
    if end_max - t < bar_nom:
        raise SystemExit(f"duration_s too short: at least {t + 2 * bar_nom + TAIL_S:.1f} s needed")
    bars, infos = [], []
    for i, s in enumerate(sections):
        intensity = int(s.get("intensity", 1))
        if not 0 <= intensity <= 3:
            raise SystemExit(f"section {i}: intensity {intensity} outside 0..3")
        last = i == len(sections) - 1
        wanted = float(s["end_s"]) if last else float(sections[i + 1]["start_s"])
        wanted = min(wanted, end_max)
        length = wanted - t
        info = {"index": i, "intensity": intensity, "accent_start": bool(s.get("accent_start", False)), "requested_start_s": float(s["start_s"]), "actual_start_s": round(t, 3)}
        if length < 0.5 * bar_nom and not (last and not bars):
            cm.warn(f"section {i} too short or outside the duration ({length:.2f} s): ignored")
            infos.append({**info, "ignored": True})
            continue
        d_min, d_max = bar_nom * (1.0 - max_dev), bar_nom * (1.0 + max_dev)
        candidates = []
        for nn in {max(1, int(length // bar_nom)), max(1, int(-(-length // bar_nom)))}:
            dd = min(max(length / nn, d_min), d_max)
            candidates.append((abs(nn * dd - length), abs(dd / bar_nom - 1.0), nn, dd))
        _, _, n, d = min(candidates)
        fit = "exact" if abs(n * d - length) < 0.005 else "approximate"
        while n > 1 and t + n * d > end_max + 1e-6:
            n -= 1
        for k in range(n):
            bars.append(Bar(t + k * d, d, i, intensity, info["accent_start"] and k == 0 and bool(bars), k))
        shift = t - float(s["start_s"])
        if abs(shift) > 0.02:
            cm.warn(f"section {i}: actual start {t:.2f} s instead of {float(s['start_s']):.2f} s (shift {shift:+.2f} s)")
        infos.append({**info, "actual_end_s": round(t + n * d, 3), "bars": n, "bpm": round(240.0 / d, 2), "fit": fit})
        t += n * d
    for b in bars:
        prog = PROGRESSION_A if (b.rank // 4) % 2 == 0 else PROGRESSION_B
        b.chord = chord(*prog[b.rank % 4])
    return bars, infos, t, bar_nom


class Instruments:
    def __init__(self, seed: int):
        self.seed = seed
        self.cache = {}

    def _memo(self, key, make):
        if key not in self.cache:
            self.cache[key] = make()
        return self.cache[key]

    def pad(self, midi: int, on_s: float, brightness: float, release: float) -> np.ndarray:
        n = int((on_s + release) * SR) + 1
        dark = self._pad_raw(midi, False, n)
        bright = self._pad_raw(midi, True, n)
        env = self._memo(("env_pad", n, round(on_s, 4), round(release, 3)), lambda: self._pad_env(n, on_s, release))
        return (dark[:n] * (1.0 - brightness) + bright[:n] * brightness) * env[:, None]

    def _pad_env(self, n, on_s, release):
        env = np.ones(n, np.float32)
        na = min(n, int(0.3 * SR))
        env[:na] = ramp(na)
        on = min(n, int(on_s * SR))
        tr = times(n - on)
        env[on:] *= (np.exp(-tr / (release / 2.5)) * ramp(n - on)[::-1]).astype(np.float32)
        return env

    def _pad_raw(self, midi, bright, n_min):
        key = ("pad_raw", midi, bright)
        if key in self.cache and self.cache[key].shape[0] >= n_min:
            return self.cache[key]
        n = max(n_min, int(4.0 * SR))
        rng = np.random.default_rng([self.seed, midi, int(bright)])
        f0 = float(mtof(midi))
        fc = 2400.0 if bright else 1200.0
        kmax = max(1, int(min(2.0 * fc, 11000.0) / f0))
        k = np.arange(1, kmax + 1)
        amp = (1.0 / k) / np.sqrt(1.0 + (k * f0 / fc) ** 4)
        L = 2048
        u = np.arange(L + 1) / L
        t = times(n)
        lfo_c, lfo_s = np.cos(2 * np.pi * 0.2 * t), np.sin(2 * np.pi * 0.2 * t)
        channels = []
        for detunes in ((-8.0, 0.0, 7.0), (-4.0, 3.0, 9.0)):
            total = np.zeros(n, np.float32)
            for cents in detunes:
                phases = rng.uniform(0, 2 * np.pi, kmax)
                table = np.sum(amp[:, None] * np.sin(2 * np.pi * k[:, None] * u[None, :] + phases[:, None]), axis=0).astype(np.float32)
                f = f0 * 2 ** (cents / 1200.0)
                ph = rng.uniform(0, 2 * np.pi)
                vib = f * 0.0007 / (2 * np.pi * 0.2)
                cycles = f * t - vib * (lfo_c * math.cos(ph) - lfo_s * math.sin(ph)) + rng.uniform()
                pos = (cycles - np.floor(cycles)) * L
                i0 = pos.astype(np.int32)
                fr = (pos - i0).astype(np.float32)
                v0 = table[i0]
                total += v0 + fr * (table[i0 + 1] - v0)
            channels.append(total / math.sqrt(3.0))
        x = np.stack(channels, axis=1) / np.float32(np.sqrt(np.sum(amp ** 2) / 2) + 1e-9)
        self.cache[key] = x.astype(np.float32)
        return self.cache[key]

    def piano(self, midi: int, vel: float, on_s: float) -> np.ndarray:
        key = ("ep", midi, round(vel, 1), round(on_s * 20) / 20)
        return self._memo(key, lambda: self._piano(midi, round(vel, 1), round(on_s * 20) / 20))

    def _piano(self, midi, vel, on_s):
        f = float(mtof(midi))
        release = 0.35
        n = int((on_s + release) * SR)
        t = times(n)
        index = (0.3 + 1.6 * vel) * np.exp(-t / 0.2) + 0.25 + 0.2 * vel
        x = np.sin(2 * np.pi * f * t + index * np.sin(2 * np.pi * f * t))
        if 4 * f < 6500:
            x += 0.10 * vel * np.sin(2 * np.pi * 4 * f * t) * np.exp(-t / 0.025)
        tau = 1.5 * (261.63 / f) ** 0.4
        env = np.exp(-t / tau)
        na = int(0.004 * SR)
        env[:na] *= ramp(na)
        on = min(n, int(on_s * SR))
        env[on:] *= np.exp(-times(n - on) / 0.08) * ramp(n - on)[::-1]
        x = x * env * (0.35 + 0.65 * vel)
        return (np.tanh(1.4 * x) / 1.4).astype(np.float32)

    def bass(self, midi: int, vel: float, on_s: float) -> np.ndarray:
        key = ("bass", midi, round(vel, 2), round(on_s * 20) / 20)
        return self._memo(key, lambda: self._bass(midi, vel, round(on_s * 20) / 20))

    def _bass(self, midi, vel, on_s):
        f = float(mtof(midi))
        n = int((on_s + 0.08) * SR)
        t = times(n)
        ph = 2 * np.pi * f * t
        x = np.sin(ph) + 0.22 * np.sin(2 * ph) + 0.07 * np.sin(3 * ph)
        env = 0.8 + 0.2 * np.exp(-t / 0.25)
        na = int(0.012 * SR)
        env[:na] *= ramp(na)
        on = min(n, int(on_s * SR))
        env[on:] *= ramp(n - on)[::-1]
        return (x * env * vel).astype(np.float32)

    def hit(self, name: str, variant: int) -> np.ndarray:
        return self._memo(("drum", name, variant), lambda: self._hit(name, variant))

    def _hit(self, name, variant):
        rng = np.random.default_rng([self.seed, variant, sum(map(ord, name))])
        if name == "kick":
            n = int(0.45 * SR)
            t = times(n)
            f = 46.0 + 70.0 * np.exp(-t / 0.032)
            x = np.sin(2 * np.pi * np.cumsum(f) / SR) * cm.env_ad(n, 0.0015, 0.14)
            click = filt(butter(2, 1500.0, "low"), rng.standard_normal(n)) * cm.env_ad(n, 0.0005, 0.003)
            x += 0.04 * click / (np.std(click[:200]) + 1e-9)
        elif name == "snap":
            n = int(0.3 * SR)
            t = times(n)
            b = filt(butter(2, [1100.0, 3200.0], "band"), rng.standard_normal(n))
            x = b / (np.std(b) + 1e-9) * cm.env_ad(n, 0.0015, 0.045) * 0.5
            x += 0.5 * np.sin(2 * np.pi * (270 + 15 * variant) * t) * cm.env_ad(n, 0.001, 0.028)
            x += 0.2 * np.sin(2 * np.pi * 560 * t) * cm.env_ad(n, 0.001, 0.015)
            x = filt(butter(2, 5000.0, "low"), x)
        elif name == "shaker":
            n = int(0.14 * SR)
            b = filt(butter(2, [3000.0, 8500.0], "band"), rng.standard_normal(n))
            x = b / (np.std(b) + 1e-9) * cm.env_ad(n, 0.008, 0.03)
        else:
            n = int(0.09 * SR)
            b = filt(butter(2, [6000.0, 10500.0], "band"), rng.standard_normal(n))
            x = b / (np.std(b) + 1e-9) * cm.env_ad(n, 0.0008, 0.018)
        return cm.fades(x, 0.0005, 0.01).astype(np.float32)

    def mallet(self, midi: int, vel: float, dark: bool = False) -> np.ndarray:
        return self._memo(("arp", midi, round(vel, 2), dark), lambda: self._mallet(midi, vel, dark))

    def _mallet(self, midi, vel, dark):
        f = float(mtof(midi))
        n = int(1.1 * SR)
        t = times(n)
        x = np.sin(2 * np.pi * f * t + 0.9 * np.exp(-t / 0.06) * np.sin(4 * np.pi * f * t)) * cm.env_ad(n, 0.002, 0.32)
        x += 0.12 * np.sin(2 * np.pi * 3 * f * t) * cm.env_ad(n, 0.001, 0.05)
        x = cm.fades(x, 0.002, 0.2) * vel
        if dark:
            x = filt(butter(1, 2200.0, "low"), x)
        return x.astype(np.float32)

    def rise(self, duration: float) -> np.ndarray:
        return self._memo(("rise", round(duration, 3)), lambda: self._rise(duration))

    def _rise(self, duration):
        rng = np.random.default_rng([self.seed, 77])
        n = int(duration * SR)
        u = np.linspace(0.0, 1.0, n)
        noise = cm.pink_noise(n, rng, channels=2)
        cutoffs = [300.0, 800.0, 2000.0, 5000.0]
        versions = [filt(butter(2, fc, "low"), noise) for fc in cutoffs]
        pos = 3.0 * u ** 1.6
        i0 = np.minimum(pos.astype(int), 2)
        fr = (pos - i0)[:, None]
        stack = np.stack(versions)
        idx = np.arange(n)
        x = stack[i0, idx] * (1 - fr) + stack[i0 + 1, idx] * fr
        env = u ** 2.0
        nf = int(0.03 * SR)
        env[n - nf:] *= ramp(nf)[::-1]
        x = cm.fades(x * env[:, None], 0.05, 0.03)
        return x.astype(np.float32)

    def boom(self) -> np.ndarray:
        return self._memo(("boom",), self._boom)

    def _boom(self):
        rng = np.random.default_rng([self.seed, 99])
        n = int(1.6 * SR)
        t = times(n)
        f = 43.65 + 45.0 * np.exp(-t / 0.05)
        ph = 2 * np.pi * np.cumsum(f) / SR
        x = (np.sin(ph) + 0.3 * np.sin(2 * ph) + 0.1 * np.sin(3 * ph)) * cm.env_ad(n, 0.004, 0.35)
        breath = filt(butter(2, [300.0, 4000.0], "band"), rng.standard_normal(n))
        x += 0.05 * breath / (np.std(breath) + 1e-9) * cm.env_ad(n, 0.01, 0.5)
        return cm.fades(x, 0.002, 0.3).astype(np.float32)


TRACKS = ("pad", "piano", "bass", "drums", "arp", "fx")


class Bus:
    def __init__(self, n: int, separate: bool):
        self.n = n
        if separate:
            self.tracks = {p: np.zeros((n, 2), np.float32) for p in TRACKS}
        else:
            shared = np.zeros((n, 2), np.float32)
            self.tracks = {p: shared for p in TRACKS}
        self.send = np.zeros(n, np.float32)

    def add(self, track: str, x: np.ndarray, t: float, gain: float = 1.0, pan: float = 0.0, send: float = 0.0) -> None:
        i0 = int(round(t * SR))
        if i0 < 0:
            x = x[-i0:]
            i0 = 0
        m = min(x.shape[0], self.n - i0)
        if m <= 0:
            return
        bus = self.tracks[track]
        if x.ndim == 1:
            gl, gr = cm.pan_gains(pan)
            bus[i0:i0 + m, 0] += float(gain * gl * math.sqrt(2)) * x[:m]
            bus[i0:i0 + m, 1] += float(gain * gr * math.sqrt(2)) * x[:m]
            if send:
                self.send[i0:i0 + m] += float(gain * send) * x[:m]
        else:
            bl, br = cm.stereo_balance(pan)
            bus[i0:i0 + m, 0] += float(gain * bl) * x[:m, 0]
            bus[i0:i0 + m, 1] += float(gain * br) * x[:m, 1]
            if send:
                self.send[i0:i0 + m] += float(gain * send * 0.5) * (x[:m, 0] + x[:m, 1])


def arrange(bars: list, t_final: float, bar_nom: float, inst: Instruments, bus: Bus, rng: np.random.Generator) -> None:
    pad_prev = piano_prev = None
    root_prev, bass_prev = 50.0, 40.0
    accents = {b for b, m in enumerate(bars) if m.accent}
    arp_pattern = None
    all_bars = bars + [Bar(t_final, bar_nom, -1, -1, False, 0, chord(*FINAL_CHORD))]

    for b, m in enumerate(all_bars):
        final = m.intensity < 0
        ch = m.chord
        intensity = bars[-1].intensity if final else m.intensity
        pad_high = voicing(ch, pad_prev, 57, 77, 4, 66)
        pad_root = place(ch.root, 45, 56, root_prev)
        piano_v = voicing(ch, piano_prev, 55, 79, 4, 67)
        bass_root = place(ch.root, 33, 45, bass_prev)
        pad_prev, root_prev, piano_prev, bass_prev = pad_high, pad_root, piano_v, bass_root

        brightness = BRIGHTNESS_BY_INTENSITY[intensity] + 0.12 * math.sin(2 * math.pi * b / 12.0)
        brightness = float(np.clip(brightness, 0.0, 1.0))
        g_pad = LEVELS["pad"] * PAD_BY_INTENSITY[intensity]
        on_s = 1.2 if final else m.length + 0.15
        release = 2.0 if final else 0.9
        for v, midi in enumerate([pad_root] + pad_high):
            gv = g_pad * (0.9 if v == 0 else (0.6 if v == 4 else 0.72))
            bus.add("pad", inst.pad(midi, on_s, brightness, release), m.start, gv, send=SENDS["pad"])

        if final:
            _piano_chord(inst, bus, rng, piano_v, [bass_root + 12], m.start, 0.5, 2.2)
            if intensity >= 2:
                bus.add("bass", inst.bass(bass_root, 0.8, 2.0), m.start, LEVELS["bass"])
            break

        if m.accent and b > 0:
            prev = bars[b - 1]
            d_rise = 2 * prev.length / 4.0
            bus.add("fx", inst.rise(d_rise), m.start - d_rise, LEVELS["rise"], send=SENDS["rise"])
            bus.add("fx", inst.boom(), m.start, LEVELS["boom"], send=SENDS["boom"])
        cut = (b + 1) in accents

        if intensity >= 1:
            patterns = PIANO_CALM if intensity == 1 else PIANO_RHYTHM
            pattern = patterns[rng.integers(len(patterns))] if m.rank % 4 else patterns[0]
            left_hand = [bass_root + 12] if intensity == 1 else []
            for pos, dur, vel in pattern:
                vel = min(1.0, vel + (0.12 if (m.accent and pos == 0.0) else 0.0))
                notes = piano_v + (left_hand if pos == 0.0 else [])
                _piano_chord(inst, bus, rng, notes, [], m.t(swing(pos)), vel, dur * m.length / 4.0)

        if intensity >= 2:
            pattern = BASS_PATTERNS[rng.integers(len(BASS_PATTERNS))] if m.rank % 4 else BASS_PATTERNS[0]
            for pos, dur, interval, vel in pattern:
                if cut and pos >= 2.0:
                    continue
                bus.add("bass", inst.bass(bass_root + interval, vel, dur * m.length / 4.0), m.t(swing(pos)), LEVELS["bass"])
            kicks = KICK_PATTERNS[0] if m.rank % 4 == 0 else KICK_PATTERNS[rng.integers(len(KICK_PATTERNS))]
            for pos in kicks:
                if cut and pos >= 2.0:
                    continue
                vel = 1.0 if pos == 0.0 else 0.8
                bus.add("drums", inst.hit("kick", int(rng.integers(3))), m.t(swing(pos)), LEVELS["kick"] * vel)
            for pos in (1.0, 3.0):
                if cut and pos >= 2.0:
                    continue
                bus.add("drums", inst.hit("snap", int(rng.integers(4))), m.t(pos) + 0.008 + rng.normal(0, 0.003), LEVELS["snap"] * rng.uniform(0.85, 1.0), pan=-0.08, send=SENDS["snap"])
            eighths = [i * 0.5 for i in range(8)]
            if intensity >= 3:
                eighths += [i * 0.5 + 0.25 for i in range(8)]
            for pos in eighths:
                strong = (pos % 1.0) == 0.5
                vel = 0.8 if strong else (0.5 if pos % 0.5 == 0 else 0.25)
                bus.add("drums", inst.hit("shaker", int(rng.integers(6))), m.t(swing(pos)) + rng.normal(0, 0.003), LEVELS["shaker"] * vel, pan=0.3, send=SENDS["shaker"])
            if intensity >= 3:
                for pos in (0.5, 1.5, 2.5, 3.5):
                    bus.add("drums", inst.hit("hat", int(rng.integers(4))), m.t(swing(pos)), LEVELS["hat"] * rng.uniform(0.7, 1.0), pan=-0.25, send=SENDS["hat"])

        if intensity >= 3:
            classes = (ch.classes & PENTATONIC) or ch.classes
            notes = sorted(x for x in range(72, 89) if x % 12 in classes)
            if m.rank % 2 == 0 or arp_pattern is None:
                arp_pattern = ARP_PATTERNS[rng.integers(len(ARP_PATTERNS))]
                shift = 0
            else:
                shift = 1
            for slot, degree in enumerate(arp_pattern):
                if degree is None:
                    continue
                midi = notes[min(len(notes) - 1, degree + shift)]
                vel = round((0.55 if slot == 0 else 0.42) * rng.uniform(0.9, 1.0) * 20) / 20
                t0 = m.t(swing(slot * 0.5)) + rng.normal(0, 0.004)
                bus.add("arp", inst.mallet(midi, round(vel, 2)), t0, LEVELS["arp"], pan=0.1, send=SENDS["arp"])
                for k, (ge, pe) in enumerate(((0.32, -0.6), (0.18, 0.6), (0.10, -0.6)), start=1):
                    bus.add("arp", inst.mallet(midi, round(vel, 2), dark=True), t0 + k * 0.75 * m.length / 4.0, LEVELS["arp"] * ge, pan=pe, send=SENDS["arp"] * 0.5)


def _piano_chord(inst, bus, rng, notes, low_notes, t, vel, duration) -> None:
    all_notes = sorted(notes + low_notes)
    t_note = t + rng.normal(0, 0.005)
    for midi in all_notes:
        v = float(np.clip(vel * rng.uniform(0.92, 1.05), 0.1, 1.0))
        pan = float(np.clip((midi - 66) / 30.0, -0.35, 0.35))
        bus.add("piano", inst.piano(midi, v, duration), t_note, LEVELS["piano"], pan=pan, send=SENDS["piano"])
        t_note += rng.uniform(0.008, 0.018)


def generate(plan: dict, seed: int, max_dev: float, target_lufs: float, separate: bool) -> tuple:
    duration = float(plan["duration_s"])
    n = int(round(duration * SR))
    bars, infos, t_final, bar_nom = build_grid(plan, max_dev)
    rng = np.random.default_rng(seed)
    inst = Instruments(seed)
    bus = Bus(n, separate)
    arrange(bars, t_final, bar_nom, inst, bus, rng)

    ir = cm.impulse_response(3.0, rt60=(2.4, 2.0, 1.0), predelay_ms=18, dark_hz=6500, seed=seed)
    ret = cm.reverb(bus.send, ir)
    bus.send = None
    cm.filt(butter(2, 150.0, "high"), ret, out=ret)

    if separate:
        x = np.zeros((n, 2), np.float32)
        for p in TRACKS:
            x += bus.tracks[p]
    else:
        x = bus.tracks["pad"]
    x += ret
    if not separate:
        del ret
    for sos in (butter(2, 30.0, "high"), cm.biquad_peak(2800.0, -2.0, 0.9), cm.biquad_high_shelf(9000.0, -3.0), butter(2, 15000.0, "low")):
        cm.filt(sos, x, out=x)

    t0 = bars[0].start
    i0 = int(round(t0 * SR))
    gain = np.zeros(n, np.float32)
    nf = int(round(2 * bars[0].length * SR))
    t_stop = t_final + bar_nom + TAIL_S
    i_stop = min(n, int(round(t_stop * SR)))
    gain[i0:i_stop] = 1.0
    gain[i0:i0 + nf] = ramp(nf)[: max(0, min(nf, n - i0))]
    nend = int(2.0 * SR)
    gain[i_stop - nend:i_stop] *= ramp(nend)[::-1].astype(np.float32)
    x *= gain[:, None]
    x, master = cm.normalize(x, target_lufs, -1.0)
    before = master.pop("lufs_before")
    g_norm = 10 ** ((master["lufs"] - before) / 20) if np.isfinite(before) else 1.0
    x[i_stop:] = 0.0

    for inf in infos:
        if inf.get("ignored"):
            continue
        a, b = int(inf["actual_start_s"] * SR), int(inf["actual_end_s"] * SR)
        inf["lufs"] = round(cm.lufs_integrated(x[a:b]), 1) if b - a > SR else None
    markers = {
        "bpm_nominal": float(plan.get("bpm", 94)), "bar_nominal_s": round(bar_nom, 4), "music_start_s": round(t0, 3),
        "sections": infos, "accents_s": [round(m.start, 3) for m in bars if m.accent], "bars_s": [round(m.start, 3) for m in bars],
        "chords": [m.chord.name for m in bars] + [chord(*FINAL_CHORD).name], "final_chord_s": round(t_final, 3),
        "music_end_s": round(min(t_stop, duration), 3), "duration_s": duration, "master": master,
    }
    stems = None
    if separate:
        stems = {p: bus.tracks[p] * gain[:, None] * np.float32(g_norm) for p in TRACKS}
        stems["reverb"] = ret * gain[:, None] * np.float32(g_norm)
    return x, markers, stems


def main() -> None:
    p = argparse.ArgumentParser(description="Synthesised music from a plan of sections.")
    cm.add_project_arg(p)
    p.add_argument("--plan", default="music-plan.json", help="plan JSON (default %(default)s)")
    p.add_argument("--out", default="music.wav", help="output WAV (default %(default)s)")
    p.add_argument("--seed", type=int, default=None, help="variation seed (default: plan.seed or 3)")
    p.add_argument("--lufs", type=float, default=-18.0, help="target integrated loudness (default %(default)s)")
    p.add_argument("--max-tempo-dev", type=float, default=0.06, help="tempo deviation allowed to fit sections (0 = strict grid)")
    p.add_argument("--stems", default="", help="folder for separate stems (diagnostics)")
    args = p.parse_args()
    cm.set_project(args.project)
    t_start = time.time()
    plan = cm.read_json(args.plan)
    seed = args.seed if args.seed is not None else int(plan.get("seed", 3))
    x, markers, stems = generate(plan, seed, args.max_tempo_dev, args.lufs, bool(args.stems))
    out = cm.path(args.out)
    cm.write_wav(out, x, "PCM_24")
    markers["seed"] = seed
    markers["compute_s"] = round(time.time() - t_start, 1)
    cm.write_json(out.with_name(out.stem + "-markers.json"), markers)
    if stems:
        folder = cm.path(args.stems)
        for name, y in stems.items():
            cm.write_wav(folder / f"{name}.wav", y, "FLOAT")
    for s in markers["sections"]:
        if s.get("ignored"):
            continue
        cm.info(f"  section {s['index']}: intensity {s['intensity']}, {s['actual_start_s']:7.2f} -> {s['actual_end_s']:7.2f} s, {s['bars']} bar(s) at {s['bpm']} bpm ({s['fit']}), {s.get('lufs')} LUFS")
    cm.info(f"final chord {markers['final_chord_s']} s, end {markers['music_end_s']} s; master {markers['master']}; {cm.rel(out)} in {markers['compute_s']} s")


if __name__ == "__main__":
    main()
