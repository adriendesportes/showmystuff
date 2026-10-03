#!/usr/bin/env python3
"""Numerical check of WAV files (nobody can listen during the build: we measure).

Usage:
    python verify.py mix.wav music.wav sfx/*.wav [--project DIR]
    python verify.py music.wav --spectrogram spectrogram.png --json report.json

Per file: duration, NaN/Inf, peak (dBFS), true peak (dBTP), integrated and maximum loudness
(3 s / 100 ms), DC offset, L/R correlation, discontinuities (clicks), first/last samples,
band energy, fixed lines (hum), centroid. Exit code 1 on a blocking anomaly.
"""
from __future__ import annotations

import argparse
import sys

import numpy as np
import soundfile as sf

import common as cm


def analyse(file, detail: bool = True) -> dict:
    p = cm.path(file)
    infos = sf.info(str(p))
    x = cm.read_wav(p)
    r = {"file": cm.rel(p), "format": f"{infos.samplerate} Hz, {infos.channels} channel(s), {infos.subtype}",
         "duration_s": round(x.shape[0] / cm.SR, 3), "nan_inf": int(np.size(x) - np.count_nonzero(np.isfinite(x)))}
    x = np.nan_to_num(x)
    r["peak_dbfs"] = round(cm.peak_db(x), 2)
    r["true_peak_dbtp"] = round(cm.true_peak_db(x), 2)
    r["lufs_integrated"] = round(cm.lufs_integrated(x), 2)
    if x.shape[0] >= 3 * cm.SR:
        r["lufs_short_max_3s"] = round(cm.lufs_max(x, 3.0), 2)
    r["lufs_max_100ms"] = round(cm.lufs_max(x, 0.1), 2)
    r["dc_offset"] = float(f"{np.max(np.abs(np.mean(x, axis=0))):.2e}")
    if x.shape[1] == 2:
        l, d = x[:, 0], x[:, 1]
        den = np.sqrt(np.sum(l ** 2) * np.sum(d ** 2))
        r["lr_correlation"] = round(float(np.sum(l * d) / den), 3) if den > 0 else None
    disc = cm.discontinuities(x)
    r["discontinuities"] = len(disc)
    if disc:
        r["discontinuity_examples"] = disc[:8]
    r["first_sample"] = float(f"{np.max(np.abs(x[0])):.2e}")
    r["last_sample"] = float(f"{np.max(np.abs(x[-1])):.2e}")
    if detail:
        r["bands_db"] = cm.band_energy(x)
        r["fixed_lines"] = cm.hums(x)
        mono = x.mean(axis=1)
        from scipy import signal
        f, pxx = signal.welch(mono, fs=cm.SR, nperseg=min(8192, max(256, mono.size)))
        r["centroid_hz"] = round(float(np.sum(f * pxx) / (np.sum(pxx) + 1e-30)), 0)
    blocking = []
    if r["nan_inf"]:
        blocking.append("NaN/Inf")
    if r["peak_dbfs"] > 0:
        blocking.append("peak > 0 dBFS")
    if r["discontinuities"]:
        blocking.append("discontinuities")
    r["anomalies"] = blocking
    return r


def main() -> None:
    p = argparse.ArgumentParser(description="Measurements of WAV files.")
    cm.add_project_arg(p)
    p.add_argument("files", nargs="+")
    p.add_argument("--spectrogram", default="", help="PNG spectrogram of the first file")
    p.add_argument("--json", default="", help="write the JSON report")
    p.add_argument("--short", action="store_true", help="without bands or lines (faster)")
    args = p.parse_args()
    cm.set_project(args.project)
    reports = []
    for f in args.files:
        r = analyse(f, detail=not args.short)
        reports.append(r)
        line = (f"{r['file']}: {r['duration_s']:.2f} s | peak {r['peak_dbfs']:.1f} dBFS | true peak {r['true_peak_dbtp']:.1f} dBTP | "
                f"{r['lufs_integrated']:.1f} LUFS | DC {r['dc_offset']:.0e} | clicks {r['discontinuities']} | NaN {r['nan_inf']}")
        if "lr_correlation" in r:
            line += f" | L/R corr {r['lr_correlation']}"
        print(line)
        if not args.short:
            print(f"    bands {r['bands_db']} | centroid {r['centroid_hz']:.0f} Hz | lines {r['fixed_lines']}")
        if r["anomalies"]:
            print(f"    ANOMALIES: {', '.join(r['anomalies'])} {r.get('discontinuity_examples', '')}")
    if args.spectrogram:
        x = cm.read_wav(args.files[0])
        engine = cm.spectrogram_png(x, args.spectrogram, title=cm.rel(cm.path(args.files[0])))
        print(f"spectrogram ({engine}) -> {args.spectrogram}")
    if args.json:
        cm.write_json(args.json, reports)
    sys.exit(1 if any(r["anomalies"] for r in reports) else 0)


if __name__ == "__main__":
    main()
