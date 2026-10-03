#!/usr/bin/env python3
"""Synthesised sound effects (48 kHz, stereo, 24-bit PCM) -> build/audio/sfx/*.wav.

Usage:
    python sfx.py [--project DIR]            # all sounds
    python sfx.py --only pop,ding            # a few sounds
    python sfx.py --preview                  # + sfx-preview.wav (all sounds in a row)

Style: warm, felted, never harsh. Each sound is low-passed (nothing aggressive above
~7 kHz), starts and ends with a fade (first and last samples at 0) and stays under −3 dBFS.

Levels: each sound is calibrated on its maximum 100 ms loudness (K-weighted) for a mix where
the voice sits at −16 LUFS. With gain_db = 0 in the timeline the sound is present but under
the voice; −6 dB = discreet; −12 dB = barely perceptible.
"""
from __future__ import annotations

import argparse
import time

import numpy as np
from scipy.signal import lfilter

import common as cm
from common import SR, butter, filt, env_ad, times

PEAK_MAX_DB = -3.0


def _bell(n: int, peak: float, power: float = 2.0) -> tuple:
    u = np.linspace(0.0, 1.0, n)
    w = u ** (np.log(0.5) / np.log(peak))
    return np.sin(np.pi * w) ** power, w


def _sliding_bandpass(x: np.ndarray, t_fc: np.ndarray, fc: np.ndarray, width_oct: float) -> np.ndarray:
    sigma = width_oct / 2.355

    def gain(f, tau):
        centre = np.interp(tau, t_fc, fc)
        return np.exp(-0.5 * (np.log2(np.maximum(f, 1.0) / centre) / sigma) ** 2)

    return cm.stft_variable_filter(x, gain, nperseg=1024)


def _stereo(x: np.ndarray) -> np.ndarray:
    return np.stack([x, x], axis=1)


def whoosh(rng, duration=0.6, f_low=320.0, f_high=1900.0, peak=0.56, pan=(-0.6, 0.6), width_oct=1.4):
    n = int(duration * SR)
    t = times(n)
    bell, w = _bell(n, peak)
    fc = f_low * (f_high / f_low) ** bell
    env = bell ** 1.3
    src = cm.pink_noise(n, rng)
    band = _sliding_bandpass(src, t, fc, width_oct)
    body = filt(butter(2, [90.0, 320.0], "band"), cm.pink_noise(n, rng)) * 0.5
    mono = (band + body) * env
    width = _sliding_bandpass(cm.pink_noise(n, rng), t, fc, width_oct * 1.3) * env * 0.22
    gl, gr = cm.pan_gains(pan[0] + (pan[1] - pan[0]) * w)
    x = np.stack([mono * gl * np.sqrt(2) + width, mono * gr * np.sqrt(2) - width], axis=1)
    x = filt(butter(4, 80.0, "high"), x)
    return filt(butter(2, 6500.0, "low"), x)


def whoosh_short(rng):
    return whoosh(rng, duration=0.35, f_low=420.0, f_high=2300.0, peak=0.45, pan=(-0.35, 0.35), width_oct=1.3)


def click(rng):
    n = int(0.07 * SR)
    t = times(n)
    x = (np.sin(2 * np.pi * 1250 * t) * env_ad(n, 0.0006, 0.0045)
         + 0.35 * np.sin(2 * np.pi * 2650 * t + 0.3) * env_ad(n, 0.0004, 0.0022)
         + 0.5 * np.sin(2 * np.pi * 420 * t) * env_ad(n, 0.0012, 0.009))
    noise = filt(butter(2, [1500.0, 5000.0], "band"), rng.standard_normal(n))
    x += 0.25 * noise / (np.std(noise) + 1e-9) * env_ad(n, 0.0003, 0.0015) * 0.3
    return _stereo(filt(butter(2, 7000.0, "low"), x))


def pop(rng):
    n = int(0.16 * SR)
    t = times(n)
    f = 600.0 * 1.5 ** (1.0 - np.exp(-t / 0.016))
    phase = 2 * np.pi * np.cumsum(f) / SR
    x = (np.sin(phase) + 0.12 * np.sin(2 * phase)) * env_ad(n, 0.004, 0.032)
    breath = filt(butter(2, 1800.0, "low"), rng.standard_normal(n))
    x += 0.15 * breath / (np.std(breath) + 1e-9) * env_ad(n, 0.0006, 0.004) * 0.4
    return _stereo(x)


def ding(rng):
    n = int(1.7 * SR)
    t = times(n)
    f1, f2 = 880.0, 880.0 * 2.756
    main_ = np.sin(2 * np.pi * f1 * t) * env_ad(n, 0.003, 0.55)
    partial = 0.2 * np.sin(2 * np.pi * f2 * t + 0.5) * env_ad(n, 0.002, 0.09)
    sl = 0.22 * np.sin(2 * np.pi * (f1 - 1.1) * t + 1.0) * env_ad(n, 0.003, 0.5)
    sr_ = 0.22 * np.sin(2 * np.pi * (f1 + 1.1) * t + 2.0) * env_ad(n, 0.003, 0.5)
    dry = np.stack([main_ + partial + sl, main_ + partial + sr_], axis=1)
    ir = cm.impulse_response(1.2, rt60=(1.3, 1.1, 0.6), predelay_ms=12, dark_hz=6000, seed=3)
    x = dry + 0.18 * cm.reverb(dry, ir)
    return filt(butter(2, 7500.0, "low"), x)


def tick(rng):
    n = int(0.045 * SR)
    t = times(n)
    x = (np.sin(2 * np.pi * 2100 * t) * env_ad(n, 0.0003, 0.0025) + 0.6 * np.sin(2 * np.pi * 1050 * t) * env_ad(n, 0.0005, 0.004))
    noise = filt(butter(2, [2000.0, 5000.0], "band"), rng.standard_normal(n))
    x += 0.15 * noise / (np.std(noise) + 1e-9) * env_ad(n, 0.0003, 0.0012) * 0.3
    return _stereo(filt(butter(2, 6500.0, "low"), x))


KEY_VARIANTS = [(2200.0, 210.0, 1250.0, 0.055), (2500.0, 240.0, 1450.0, 0.062), (1950.0, 190.0, 1150.0, 0.048), (2350.0, 225.0, 1350.0, 0.070)]


def key(rng, k: int):
    fc, f_body, f_plast, t_ret = KEY_VARIANTS[k]
    n = int(0.13 * SR)
    t = times(n)

    def contact(centre, tau):
        b = filt(butter(2, [centre / 1.5, centre * 1.5], "band"), rng.standard_normal(n))
        return b / (np.std(b) + 1e-9) * env_ad(n, 0.0009, tau)

    x = (0.45 * contact(fc, 0.003) + 0.6 * np.sin(2 * np.pi * f_body * t) * env_ad(n, 0.0015, 0.011)
         + 0.25 * np.sin(2 * np.pi * f_plast * t) * env_ad(n, 0.0008, 0.006))
    ret = 0.18 * contact(fc * 1.15, 0.002)
    d = int(t_ret * SR)
    x[d:] += ret[: n - d]
    return _stereo(filt(butter(4, 5500.0, "low"), x))


def riser(rng):
    duration = 1.5
    n = int(duration * SR)
    t = times(n)
    u = t / duration
    fc = 250.0 * (3000.0 / 250.0) ** (u ** 1.3)
    common, g, d = (cm.pink_noise(n, rng) for _ in range(3))
    wide = 0.15 + 0.85 * u
    norm = np.sqrt((1 - wide) ** 2 + wide ** 2)
    noise = np.stack([(common * (1 - wide) + g * wide) / norm, (common * (1 - wide) + d * wide) / norm], axis=1)
    noise = _sliding_bandpass(noise, t, fc, 1.6)
    glide = 2.0 ** (u ** 1.5)
    tone = (np.sin(2 * np.pi * np.cumsum(220.0 * glide) / SR) + 0.7 * np.sin(2 * np.pi * np.cumsum(329.63 * glide) / SR))
    x = noise + 0.16 * tone[:, None]
    env = u ** 2.2
    nf = int(0.035 * SR)
    env[n - nf:] *= cm.ramp(nf)[::-1]
    x = x * env[:, None]
    return filt(butter(4, 6500.0, "low"), x)


def impact_soft(rng):
    n = int(1.9 * SR)
    t = times(n)
    f = 52.0 + 58.0 * np.exp(-t / 0.045)
    phase = 2 * np.pi * np.cumsum(f) / SR
    tone = (np.sin(phase) + 0.38 * np.sin(2 * phase) + 0.14 * np.sin(3 * phase) + 0.05 * np.sin(4 * phase)) * env_ad(n, 0.005, 0.30)
    body = filt(butter(2, 220.0, "low"), rng.standard_normal(n))
    body = body / (np.std(body) + 1e-9) * env_ad(n, 0.002, 0.045) * 0.35
    felt = filt(butter(2, [400.0, 1200.0], "band"), rng.standard_normal(n))
    felt = felt / (np.std(felt) + 1e-9) * env_ad(n, 0.003, 0.12) * 0.08
    dry = tone + body + felt
    ir = cm.impulse_response(1.6, rt60=(1.6, 1.2, 0.6), predelay_ms=10, dark_hz=2500, seed=5)
    x = _stereo(dry) + 0.22 * cm.reverb(dry, ir)
    return filt(butter(2, 28.0, "high"), x)


def page(rng):
    duration = 0.75
    n = int(duration * SR)
    gesture, _ = _bell(n, 0.35)
    cdf = np.cumsum(gesture)
    cdf /= cdf[-1]
    channels = []
    starts = np.searchsorted(cdf, rng.uniform(0.02, 0.98, 55))
    amps = rng.lognormal(0.0, 0.5, 55) * gesture[starts]
    classes = rng.integers(0, 3, 55)
    for c in range(2):
        x = np.zeros(n)
        for k, (tau, centre) in enumerate(((0.0025, 4200.0), (0.005, 2800.0), (0.009, 1800.0))):
            impulses = np.zeros(n)
            sel = classes == k
            np.add.at(impulses, starts[sel], amps[sel])
            a = np.exp(-1.0 / (tau * SR))
            env = lfilter([1.0], [1.0, -a], impulses)
            env = cm.smooth_one_pole(env, 0.0004)
            b = filt(butter(2, [centre / 1.5, centre * 1.5], "band"), rng.standard_normal(n))
            x += env * b / (np.std(b) + 1e-9)
        breath = filt(butter(2, [900.0, 3500.0], "band"), rng.standard_normal(n))
        x += 0.35 * breath / (np.std(breath) + 1e-9) * gesture * np.max(np.abs(x)) * 0.4
        channels.append(x)
    g, d = channels
    x = np.stack([0.8 * g + 0.2 * d, 0.2 * g + 0.8 * d], axis=1)
    x = filt(butter(2, 350.0, "high"), x)
    return filt(butter(4, 7000.0, "low"), x)


def stamp(rng):
    n = int(0.16 * SR)
    t = times(n)
    f = 185.0 + 110.0 * np.exp(-t / 0.010)
    body = 0.8 * np.sin(2 * np.pi * np.cumsum(f) / SR) * env_ad(n, 0.0012, 0.020)
    body2 = 0.5 * np.sin(2 * np.pi * 420.0 * t + 0.4) * env_ad(n, 0.001, 0.010)
    b = filt(butter(2, 2000.0, "low"), rng.standard_normal(n))
    contact = 0.8 * b / (np.std(b) + 1e-9) * env_ad(n, 0.0008, 0.006)
    p = filt(butter(2, [1500.0, 4000.0], "band"), rng.standard_normal(n))
    grain = 1.0 + 0.8 * filt(butter(1, 120.0, "low"), rng.standard_normal(n))
    paper = 0.12 * p / (np.std(p) + 1e-9) * np.abs(grain) * env_ad(n, 0.002, 0.018)
    x = body + body2 + contact + paper
    x = filt(butter(2, 60.0, "high"), x)
    return _stereo(filt(butter(4, 5000.0, "low"), x))


# name -> (function, target loudness in LUFS over 100 ms)
SOUNDS = {
    "whoosh": (whoosh, -21.0),
    "whoosh-short": (whoosh_short, -22.0),
    "click": (click, -26.0),
    "pop": (pop, -24.0),
    "ding": (ding, -22.0),
    "tick": (tick, -28.0),
    "key-1": (lambda r: key(r, 0), -27.0),
    "key-2": (lambda r: key(r, 1), -27.0),
    "key-3": (lambda r: key(r, 2), -27.0),
    "key-4": (lambda r: key(r, 3), -27.0),
    "riser": (riser, -22.0),
    "impact-soft": (impact_soft, -19.0),
    "page": (page, -25.0),
    "stamp": (stamp, -22.0),
}


def make(name: str, seed: int) -> tuple:
    fn, target = SOUNDS[name]
    rng = np.random.default_rng([seed, sum(map(ord, name))])
    x = np.asarray(fn(rng), dtype=np.float64)
    if name != "impact-soft":
        x = filt(butter(2, 40.0, "high"), x)
    x = cm.fades(x, in_s=0.002 if name not in ("riser", "page") else 0.03, out_s=0.012)
    gain = 10 ** ((target - cm.lufs_max(x, 0.1)) / 20)
    x *= gain
    tp = cm.true_peak_db(x)
    if tp > PEAK_MAX_DB - 0.2:
        x *= 10 ** ((PEAK_MAX_DB - 0.2 - tp) / 20)
        cm.warn(f"{name}: peak-limited, loudness below target")
    x[0] = 0.0
    x[-1] = 0.0
    return x, {"duration_s": round(x.shape[0] / SR, 3), "peak_dbfs": round(cm.peak_db(x), 2),
               "true_peak_dbtp": round(cm.true_peak_db(x), 2), "lufs_100ms_max": round(cm.lufs_max(x, 0.1), 1)}


def main() -> None:
    p = argparse.ArgumentParser(description="Generates the sound effects into build/audio/sfx/.")
    cm.add_project_arg(p)
    p.add_argument("--out", default="sfx", help="output folder (default %(default)s)")
    p.add_argument("--only", default="", help="comma-separated names")
    p.add_argument("--seed", type=int, default=7, help="random seed (default %(default)s)")
    p.add_argument("--preview", action="store_true", help="also writes sfx-preview.wav (all sounds in a row)")
    args = p.parse_args()
    cm.set_project(args.project)
    names = [n.strip() for n in args.only.split(",") if n.strip()] or list(SOUNDS)
    unknown = [n for n in names if n not in SOUNDS]
    if unknown:
        raise SystemExit(f"unknown sounds: {', '.join(unknown)} (available: {', '.join(SOUNDS)})")
    folder = cm.path(args.out)
    t0 = time.time()
    preview = []
    for name in names:
        x, m = make(name, args.seed)
        cm.write_wav(folder / f"{name}.wav", x, "PCM_24")
        preview += [x, np.zeros((int(0.6 * SR), 2))]
        cm.info(f"  {name:<13} {m['duration_s']:5.2f} s  peak {m['peak_dbfs']:6.1f} dBFS  true peak {m['true_peak_dbtp']:6.1f} dBTP  loudness100ms {m['lufs_100ms_max']:6.1f} LUFS")
    if args.preview:
        cm.write_wav(folder.parent / "sfx-preview.wav", np.concatenate(preview), "PCM_24")
    cm.info(f"{len(names)} sound(s) -> {cm.rel(folder)}/ in {time.time() - t0:.1f} s")


if __name__ == "__main__":
    main()
