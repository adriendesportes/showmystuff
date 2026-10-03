"""Shared helpers of the Show My Stuff audio chain (48 kHz).

WAV read/write, project paths, envelopes, filters, noise, convolution reverb,
measurements (LUFS, true peak, discontinuities, bands), look-ahead soft limiter.
Everything is vectorised (numpy/scipy).

Paths: every relative path (command line or JSON) is resolved from the project's
`build/audio/` folder; `--project` (or SMS_PROJECT, or the nearest showmystuff.json)
selects the project.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import warnings
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import ndimage, signal

SR = 48000
_PROJECT: Path | None = None


# ---------------------------------------------------------------------------
# Project, paths, JSON, WAV
# ---------------------------------------------------------------------------

def add_project_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--project", default="", help="project folder (default: SMS_PROJECT or the nearest showmystuff.json)")


def set_project(arg: str = "") -> Path:
    """Resolves and memorises the project folder."""
    global _PROJECT
    p = arg or os.environ.get("SMS_PROJECT", "")
    if not p:
        d = Path.cwd()
        while True:
            if (d / "showmystuff.json").exists():
                p = str(d)
                break
            if d.parent == d:
                break
            d = d.parent
    if not p or not (Path(p) / "showmystuff.json").exists():
        raise SystemExit("No project found: run from a project folder (showmystuff.json) or pass --project <dir>")
    _PROJECT = Path(p).resolve()
    (_PROJECT / "build" / "audio").mkdir(parents=True, exist_ok=True)
    return _PROJECT


def project() -> Path:
    if _PROJECT is None:
        set_project()
    return _PROJECT  # type: ignore[return-value]


def audio_dir() -> Path:
    return project() / "build" / "audio"


def path(p) -> Path:
    """Resolves a relative path from build/audio/."""
    p = Path(p).expanduser()
    return p if p.is_absolute() else (audio_dir() / p)


def rel(p) -> str:
    """Readable path relative to the project (for messages and JSON)."""
    p = Path(p).resolve()
    try:
        return str(p.relative_to(project()))
    except ValueError:
        return str(p)


def read_json(p):
    with open(path(p), "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(p, data) -> None:
    p = path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    tmp.replace(p)


def read_wav(p, channels: int | None = None, dtype: str = "float64") -> np.ndarray:
    """Reads a WAV as (n, channels) at 48 kHz. channels=1: mono mix-down; channels=2: mono duplicated."""
    x, sr = sf.read(str(path(p)), dtype=dtype, always_2d=True)
    if sr != SR:
        g = math.gcd(int(sr), SR)
        x = signal.resample_poly(x, SR // g, int(sr) // g, axis=0)
    if channels == 1 and x.shape[1] > 1:
        x = x.mean(axis=1, keepdims=True)
    elif channels == 2 and x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    return x


def write_wav(p, x: np.ndarray, subtype: str = "PCM_24") -> Path:
    """Writes a 48 kHz WAV (PCM_24 by default, or FLOAT)."""
    p = path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    x = np.asarray(x)
    if x.dtype not in (np.float32, np.float64):
        x = x.astype(np.float64)
    channels = 1 if x.ndim == 1 else x.shape[1]
    tmp = p.with_name(p.stem + ".tmp" + p.suffix)
    with sf.SoundFile(str(tmp), "w", SR, channels, subtype=subtype) as f:
        for a in range(0, x.shape[0], 10 * SR):
            block = x[a:a + 10 * SR]
            if not np.all(np.isfinite(block)):
                f.close()
                tmp.unlink(missing_ok=True)
                raise ValueError(f"{p.name}: NaN/Inf values, write refused")
            if subtype.startswith("PCM"):
                block = np.clip(block, -1.0, 1.0 - 2.0 ** -23)
            f.write(block)
    tmp.replace(p)
    return p


def info(msg: str) -> None:
    print(msg, flush=True)


def warn(msg: str) -> None:
    print(f"WARNING: {msg}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# Units, envelopes
# ---------------------------------------------------------------------------

def db_lin(db):
    return 10.0 ** (np.asarray(db, dtype=np.float64) / 20.0)


def lin_db(x, floor: float = -200.0):
    x = np.maximum(np.abs(np.asarray(x, dtype=np.float64)), 10.0 ** (floor / 20.0))
    return 20.0 * np.log10(x)


def mtof(midi):
    return 440.0 * 2.0 ** ((np.asarray(midi, dtype=np.float64) - 69.0) / 12.0)


def times(n: int) -> np.ndarray:
    return np.arange(n, dtype=np.float64) / SR


def ramp(n: int) -> np.ndarray:
    """Raised-cosine rise from 0 to 1 over n samples."""
    if n <= 0:
        return np.zeros(0)
    if n == 1:
        return np.ones(1)
    return 0.5 - 0.5 * np.cos(np.pi * np.arange(n) / (n - 1))


def fades(x: np.ndarray, in_s: float = 0.002, out_s: float = 0.01) -> np.ndarray:
    """Cosine fade in/out; first and last samples forced to 0."""
    x = np.array(x, dtype=np.float64, copy=True)
    n = x.shape[0]
    ni = min(n, max(2, int(round(in_s * SR))))
    no = min(n, max(2, int(round(out_s * SR))))
    shape = (n,) + (1,) * (x.ndim - 1)
    g = np.ones(n)
    g[:ni] *= ramp(ni)
    g[n - no:] *= ramp(no)[::-1]
    return x * g.reshape(shape)


def env_ad(n: int, attack_s: float, tau_s: float) -> np.ndarray:
    """Soft (cosine) attack then exponential decay."""
    t = times(n)
    e = np.exp(-t / max(tau_s, 1e-6))
    na = min(n, max(2, int(round(attack_s * SR))))
    e[:na] *= ramp(na)
    return e


def pan_gains(p) -> tuple:
    """Constant-power law. p in [-1, 1]; returns (gL, gR), 1/√2 each at centre."""
    p = np.clip(np.asarray(p, dtype=np.float64), -1.0, 1.0)
    a = (p + 1.0) * np.pi / 4.0
    return np.cos(a), np.sin(a)


def stereo_balance(p) -> tuple:
    """Balance for an already-stereo source: (1, 1) at centre, +3 dB on one side at the extremes."""
    gl, gr = pan_gains(p)
    return gl * math.sqrt(2.0), gr * math.sqrt(2.0)


# ---------------------------------------------------------------------------
# Filters and noise
# ---------------------------------------------------------------------------

def butter(order: int, fc, kind: str) -> np.ndarray:
    return signal.butter(order, fc, btype=kind, fs=SR, output="sos")


def filt(sos: np.ndarray, x: np.ndarray, zero_phase: bool = False, out: np.ndarray | None = None,
         block_s: float = 10.0) -> np.ndarray:
    """SOS filter along axis 0. Long float32 signals are filtered by 10 s blocks in float64."""
    if zero_phase:
        return signal.sosfiltfilt(sos, x, axis=0)
    n = x.shape[0]
    block = int(block_s * SR)
    if x.dtype == np.float64 or n <= block:
        y = signal.sosfilt(sos, x, axis=0)
        if out is not None:
            out[...] = y
            return out
        return y
    y = np.empty_like(x) if out is None else out
    zi = np.zeros((sos.shape[0], 2) + x.shape[1:])
    for a in range(0, n, block):
        piece, zi = signal.sosfilt(sos, x[a:a + block].astype(np.float64), axis=0, zi=zi)
        y[a:a + block] = piece
    return y


def biquad_peak(fc: float, gain_db: float, q: float) -> np.ndarray:
    """RBJ peaking EQ as SOS."""
    a = 10.0 ** (gain_db / 40.0)
    w0 = 2.0 * np.pi * fc / SR
    alpha = np.sin(w0) / (2.0 * q)
    b = np.array([1 + alpha * a, -2 * np.cos(w0), 1 - alpha * a])
    aa = np.array([1 + alpha / a, -2 * np.cos(w0), 1 - alpha / a])
    return np.concatenate([b / aa[0], aa / aa[0]])[None, :]


def biquad_high_shelf(fc: float, gain_db: float, s: float = 1.0) -> np.ndarray:
    """RBJ high shelf as SOS."""
    a = 10.0 ** (gain_db / 40.0)
    w0 = 2.0 * np.pi * fc / SR
    alpha = np.sin(w0) / 2.0 * np.sqrt((a + 1.0 / a) * (1.0 / s - 1.0) + 2.0)
    c = np.cos(w0)
    b0 = a * ((a + 1) + (a - 1) * c + 2 * np.sqrt(a) * alpha)
    b1 = -2 * a * ((a - 1) + (a + 1) * c)
    b2 = a * ((a + 1) + (a - 1) * c - 2 * np.sqrt(a) * alpha)
    a0 = (a + 1) - (a - 1) * c + 2 * np.sqrt(a) * alpha
    a1 = 2 * ((a - 1) - (a + 1) * c)
    a2 = (a + 1) - (a - 1) * c - 2 * np.sqrt(a) * alpha
    return np.array([[b0 / a0, b1 / a0, b2 / a0, 1.0, a1 / a0, a2 / a0]])


def pink_noise(n: int, rng: np.random.Generator, channels: int = 1) -> np.ndarray:
    """Pink noise (−3 dB/octave) by spectral shaping, RMS = 1."""
    nfft = max(16, int(2 ** math.ceil(math.log2(max(n, 2)))))
    white = rng.standard_normal((nfft, channels))
    spec = np.fft.rfft(white, axis=0)
    f = np.fft.rfftfreq(nfft, 1.0 / SR)
    shape = np.ones_like(f)
    shape[1:] = 1.0 / np.sqrt(np.maximum(f[1:], 20.0) / 20.0)
    shape[0] = 0.0
    x = np.fft.irfft(spec * shape[:, None], n=nfft, axis=0)[:n]
    x /= np.sqrt(np.mean(x ** 2, axis=0, keepdims=True)) + 1e-12
    return x if channels > 1 else x[:, 0]


def stft_variable_filter(x: np.ndarray, gain_fn, nperseg: int = 1024) -> np.ndarray:
    """Time-varying filter through STFT. gain_fn(freqs_hz[:, None], times_s[None, :]) -> gains (bins, frames)."""
    mono = x.ndim == 1
    xx = x[:, None] if mono else x
    n = xx.shape[0]
    out = np.zeros_like(xx)
    for c in range(xx.shape[1]):
        f, t, z = signal.stft(xx[:, c], fs=SR, nperseg=nperseg, noverlap=nperseg * 3 // 4, boundary="even", padded=True)
        g = gain_fn(f[:, None], t[None, :])
        _, y = signal.istft(z * g, fs=SR, nperseg=nperseg, noverlap=nperseg * 3 // 4, boundary=True)
        out[:, c] = y[:n] if len(y) >= n else np.pad(y, (0, n - len(y)))
    return out[:, 0] if mono else out


def smooth_one_pole(x: np.ndarray, tau_s: float, zero_phase: bool = False) -> np.ndarray:
    """One-pole low-pass smoothing (lfilter), optionally forward-backward."""
    a = math.exp(-1.0 / (max(tau_s, 1e-6) * SR))
    b, aa = [1.0 - a], [1.0, -a]
    if zero_phase:
        return signal.filtfilt(b, aa, x, axis=0, padlen=0)
    zi = signal.lfilter_zi(b, aa) * (x[0] if x.ndim == 1 else 0.0)
    if x.ndim == 1:
        y, _ = signal.lfilter(b, aa, x, zi=zi)
        return y
    return signal.lfilter(b, aa, x, axis=0)


# ---------------------------------------------------------------------------
# Convolution reverb (synthetic impulse response)
# ---------------------------------------------------------------------------

def impulse_response(duration_s: float = 2.6, rt60=(2.3, 1.8, 0.9), predelay_ms: float = 16.0,
                     dark_hz: float = 7000.0, seed: int = 11) -> np.ndarray:
    """Synthetic stereo IR (exponentially decaying noise per band). Energy normalised to 1 per channel."""
    rng = np.random.default_rng(seed)
    n = int(duration_s * SR)
    t = times(n)
    sos_low = butter(2, 400.0, "low")
    sos_high = butter(2, 3500.0, "high")
    ir = np.zeros((n, 2))
    for c in range(2):
        b = rng.standard_normal(n)
        low = filt(sos_low, b, zero_phase=True)
        high = filt(sos_high, b, zero_phase=True)
        mid = b - low - high
        e = (low * 10.0 ** (-3.0 * t / rt60[0]) + mid * 10.0 ** (-3.0 * t / rt60[1]) + high * 10.0 ** (-3.0 * t / rt60[2]))
        e *= 1.0 - np.exp(-t / 0.015)
        ir[:, c] = e
    d = int(predelay_ms * SR / 1000.0)
    ir = np.vstack([np.zeros((d, 2)), ir])[:n]
    for c in range(2):
        for k in range(7):
            pos = d + int(rng.uniform(0.004, 0.05) * SR)
            ir[pos, c] += (0.55 * 0.8 ** k) * rng.choice([-1.0, 1.0]) * np.sqrt(np.mean(ir[:, c] ** 2)) * 40
    ir = filt(butter(2, dark_hz, "low"), ir)
    nf = int(0.2 * n)
    ir[n - nf:] *= ramp(nf)[::-1, None]
    ir /= np.sqrt(np.sum(ir ** 2, axis=0, keepdims=True)) + 1e-12
    return ir


def reverb(send: np.ndarray, ir: np.ndarray) -> np.ndarray:
    """Overlap-add convolution: mono or stereo send -> stereo return of the same length."""
    mono = send if send.ndim == 1 else send.mean(axis=1)
    n = mono.shape[0]
    ret = np.zeros((n, 2), dtype=np.float32)
    ir = ir.astype(mono.dtype)
    block = 1 << 20
    for a in range(0, n, block):
        piece = mono[a:a + block]
        if not np.any(piece):
            continue
        for c in range(2):
            y = signal.oaconvolve(piece, ir[:, c], mode="full")
            m = min(y.shape[0], n - a)
            ret[a:a + m, c] += y[:m]
    return ret


# ---------------------------------------------------------------------------
# Measurements: loudness (BS.1770), true peak, discontinuities, spectrum
# ---------------------------------------------------------------------------

_SOS_K = None


def _k_weighting_sos() -> np.ndarray:
    global _SOS_K
    if _SOS_K is None:
        import pyloudnorm as pyln
        m = pyln.Meter(SR)
        rows = []
        for fl in m._filters.values():
            b = np.asarray(fl.b, dtype=np.float64)
            a = np.asarray(fl.a, dtype=np.float64)
            rows.append(np.concatenate([b / a[0], a / a[0]]))
        _SOS_K = np.array(rows)
    return _SOS_K


def lufs_integrated(x: np.ndarray) -> float:
    """Integrated loudness BS.1770-4 (pyloudnorm). −inf if silent."""
    import pyloudnorm as pyln
    x = np.asarray(x)
    if x.dtype not in (np.float32, np.float64):
        x = x.astype(np.float64)
    if x.ndim == 1:
        x = x[:, None]
    if x.shape[0] < int(0.4 * SR) + 1:
        x = np.vstack([x, np.zeros((int(0.4 * SR) + 1 - x.shape[0], x.shape[1]))])
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        v = pyln.Meter(SR).integrated_loudness(x)
    return float(v) if np.isfinite(v) else float("-inf")


def k_power(x: np.ndarray) -> np.ndarray:
    """Instantaneous K-weighted power (sum of channels), float32, block-wise."""
    xx = np.asarray(x)
    xx = xx[:, None] if xx.ndim == 1 else xx
    sos = _k_weighting_sos()
    zi = np.zeros((sos.shape[0], 2, xx.shape[1]))
    p = np.empty(xx.shape[0], np.float32)
    for a in range(0, xx.shape[0], 10 * SR):
        kw, zi = signal.sosfilt(sos, xx[a:a + 10 * SR].astype(np.float64), axis=0, zi=zi)
        p[a:a + 10 * SR] = np.sum(kw * kw, axis=1)
    return p


def lufs_sliding(x: np.ndarray, window_s: float = 0.4) -> np.ndarray:
    p = k_power(x)
    w = max(1, int(window_s * SR))
    m = ndimage.uniform_filter1d(p, w, mode="constant")
    del p
    np.maximum(m, np.float32(1e-20), out=m)
    np.log10(m, out=m)
    m *= np.float32(10.0)
    m += np.float32(-0.691)
    return m


def lufs_max(x: np.ndarray, window_s: float = 0.1) -> float:
    return float(np.max(lufs_sliding(x, window_s)))


def lufs_masked(x: np.ndarray, mask: np.ndarray) -> float:
    """Loudness over the masked samples only."""
    if not np.any(mask):
        return float("-inf")
    p = k_power(x)
    return float(-0.691 + 10.0 * np.log10(max(float(np.mean(p[mask], dtype=np.float64)), 1e-20)))


def peak_db(x: np.ndarray) -> float:
    if x.size == 0:
        return float(lin_db(0.0))
    return float(lin_db(max(float(np.max(np.abs(x[a:a + 10 * SR]))) for a in range(0, x.shape[0], 10 * SR))))


_FIR_TP = None


def _true_peak_fir() -> np.ndarray:
    global _FIR_TP
    if _FIR_TP is None:
        _FIR_TP = signal.firwin(49, 0.25, window=("kaiser", 6.0))
    return _FIR_TP


def true_peak_envelope(x: np.ndarray, threshold: float | None = None, block_s: float = 0.1) -> np.ndarray:
    """×4 oversampled peak per original sample, max over channels (only blocks above `threshold` are oversampled)."""
    xx = x[:, None] if x.ndim == 1 else x
    n = xx.shape[0]
    env = np.empty(n, np.float32)
    step = 10 * SR
    for a in range(0, n, step):
        env[a:a + step] = np.max(np.abs(xx[a:a + step]), axis=1)
    block = max(1, int(block_s * SR))
    nb = -(-n // block)
    peaks = np.pad(env, (0, nb * block - n)).reshape(nb, block).max(axis=1)
    chosen = np.arange(nb) if threshold is None else np.nonzero(peaks > threshold)[0]
    if chosen.size == 0:
        return env
    cuts = np.nonzero(np.diff(chosen) > 1)[0] + 1
    margin = 64
    max_blocks = 100
    for run_ in np.split(chosen, cuts):
        for k in range(0, len(run_), max_blocks):
            piece = run_[k:k + max_blocks]
            a, b = int(piece[0]) * block, min(n, (int(piece[-1]) + 1) * block)
            a0, b0 = max(0, a - margin), min(n, b + margin)
            up = signal.resample_poly(xx[a0:b0], 4, 1, axis=0, window=_true_peak_fir())
            m = b0 - a0
            upabs = np.max(np.abs(up[: m * 4]), axis=1).reshape(m, 4).max(axis=1)
            env[a:b] = np.maximum(env[a:b], upabs[a - a0:b - a0])
    return env


def true_peak_db(x: np.ndarray) -> float:
    if x.size == 0:
        return float("-inf")
    peak = float(np.max(np.abs(x)))
    if peak <= 0:
        return float("-inf")
    return float(lin_db(np.max(true_peak_envelope(x, threshold=peak * 10 ** (-6 / 20)))))


def limiter(x: np.ndarray, ceiling_db: float = -1.0, lookahead_ms: float = 2.0, hold_ms: float = 40.0) -> tuple:
    """Look-ahead soft limiter on the true peak (×4). Returns (y, max reduction dB)."""
    ceiling = 10.0 ** (ceiling_db / 20.0)
    env = true_peak_envelope(x, threshold=ceiling * 10 ** (-6 / 20))
    if env.max() <= ceiling:
        return x, 0.0
    g = np.minimum(np.float32(1.0), np.float32(ceiling) / np.maximum(env, np.float32(1e-12)))
    del env
    for ms in (lookahead_ms, hold_ms):
        w = max(3, int(ms * SR / 1000.0) | 1)
        g = ndimage.minimum_filter1d(g, w, mode="nearest")
        g = ndimage.uniform_filter1d(g, w, mode="nearest")
    g = g.astype(x.dtype)
    x *= g[:, None] if x.ndim == 2 else g
    return x, float(lin_db(g.min()))


def normalize(x: np.ndarray, target_lufs: float, ceiling_dbtp: float = -1.0, iterations: int = 4, curve: bool = False) -> tuple:
    """Integrated-loudness normalisation then true-peak limiting, iterated. Modifies x in place."""
    total = [1.0]

    def _limit(y, ceiling):
        before = y.copy() if curve else None
        y, r = limiter(y, ceiling)
        if curve and r < 0.0:
            with np.errstate(divide="ignore", invalid="ignore"):
                g = np.where(np.abs(before) > 1e-9, y / before, 1.0).min(axis=-1 if y.ndim == 2 else None)
            total[0] = total[0] * g.astype(np.float32)
        return y, r

    l0 = lufs_integrated(x)
    if not np.isfinite(l0):
        return x, {"lufs": l0, "lufs_before": l0, "true_peak_dbtp": true_peak_db(x), "limiter_reduction_db": 0.0}
    x *= x.dtype.type(10.0 ** ((target_lufs - l0) / 20.0))
    total[0] *= 10.0 ** ((target_lufs - l0) / 20.0)
    reduction, margin, lv = 0.0, 0.15, None
    tp = true_peak_db(x)
    for _ in range(iterations):
        x, r = _limit(x, ceiling_dbtp - margin)
        reduction = min(reduction, r)
        tp = true_peak_db(x)
        if tp > ceiling_dbtp:
            margin += tp - ceiling_dbtp + 0.05
            lv = None
            continue
        lv = lufs_integrated(x)
        if abs(lv - target_lufs) <= 0.05 or r == 0.0:
            break
        x *= x.dtype.type(10.0 ** ((target_lufs - lv) / 20.0))
        total[0] = total[0] * 10.0 ** ((target_lufs - lv) / 20.0)
        lv = None
    if lv is None:
        x, r = _limit(x, ceiling_dbtp - margin)
        reduction = min(reduction, r)
        tp = true_peak_db(x)
        lv = lufs_integrated(x)
    out = {"lufs": round(lv, 2), "lufs_before": round(l0, 2), "true_peak_dbtp": round(tp, 2), "limiter_reduction_db": round(reduction, 2)}
    if curve:
        out["_gain"] = total[0]
    return x, out


def discontinuities(x: np.ndarray, threshold: float = 12.0, window_ms: float = 2.0, floor_db: float = -60.0, block_s: float = 10.0) -> list:
    """Detects clicks: an isolated second derivative far above its neighbourhood. Returns [(time_s, ratio)] (≤ 50)."""
    xx = x[:, None] if x.ndim == 1 else x
    n = xx.shape[0]
    w = max(5, int(window_ms * SR / 1000.0) | 1)
    floor = 10.0 ** (floor_db / 20.0)
    found = []
    block = int(block_s * SR)
    for start in range(0, n, block):
        a, b = max(0, start - w), min(n, start + block + w)
        seg = xx[a:b]
        for c in range(seg.shape[1]):
            d2 = np.abs(np.diff(seg[:, c], 2))
            if d2.size < w:
                continue
            e = d2 ** 2
            local = ndimage.uniform_filter1d(e, w, mode="nearest") * w - e
            rms = np.sqrt(np.maximum(local, 0.0) / (w - 1)) + 1e-12
            r = d2 / rms
            idx = np.nonzero((r > threshold) & (d2 > floor))[0]
            for i in idx:
                pos = a + i + 1
                if start <= pos < start + block:
                    found.append((round(pos / SR, 4), round(float(r[i]), 1)))
    found.sort()
    return found[:50]


def band_energy(x: np.ndarray, bands=((20, 60), (60, 250), (250, 2000), (2000, 6000), (6000, 12000), (12000, 20000))) -> dict:
    mono = x if x.ndim == 1 else x.mean(axis=1)
    if mono.size < 4096:
        mono = np.pad(mono, (0, 4096 - mono.size))
    f, p = signal.welch(mono, fs=SR, nperseg=min(16384, mono.size))
    total = np.sum(p[(f >= 20) & (f <= 20000)]) + 1e-30
    out = {}
    for lo, hi in bands:
        e = np.sum(p[(f >= lo) & (f < hi)])
        out[f"{lo}-{hi} Hz"] = round(float(10 * np.log10(e / total + 1e-30)), 1)
    return out


def hums(x: np.ndarray, fmax: float = 1000.0) -> list:
    """Looks for fixed, stable spectral lines (hum) under fmax."""
    mono = x if x.ndim == 1 else x.mean(axis=1)
    if mono.size < SR:
        return []
    nper = 8192
    f, t, s = signal.spectrogram(mono, fs=SR, nperseg=nper, noverlap=nper // 2, mode="psd")
    active = 10 * np.log10(np.sum(s, axis=0) + 1e-30)
    frames = active > (np.max(active) - 50)
    if np.sum(frames) < 4:
        return []
    sel = f <= fmax
    sdb = 10 * np.log10(s[sel][:, frames] + 1e-30)
    neighbourhood = ndimage.median_filter(sdb, size=(15, 1), mode="nearest")
    salience = sdb - neighbourhood
    presence = np.mean(salience > 15, axis=1)
    q1, q3 = np.percentile(sdb, [25, 75], axis=1)
    lines = []
    for i in np.nonzero((presence > 0.9) & ((q3 - q1) < 3.0))[0]:
        lines.append({"f_hz": round(float(f[sel][i]), 1), "presence": round(float(presence[i]), 2)})
    return lines


def spectrogram_png(x: np.ndarray, out, title: str = "") -> str:
    """Spectrogram PNG (0–16 kHz + 0–600 Hz zoom) via matplotlib, else ffmpeg."""
    out = path(out)
    mono = x if x.ndim == 1 else x.mean(axis=1)
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        f, t, s = signal.spectrogram(mono, fs=SR, nperseg=4096, noverlap=3072, mode="psd")
        sdb = 10 * np.log10(s + 1e-14)
        top = np.max(sdb)
        fig, axes = plt.subplots(2, 1, figsize=(14, 8), gridspec_kw={"height_ratios": [3, 1.4]})
        for ax, fmax in zip(axes, (16000, 600)):
            sel = f <= fmax
            im = ax.pcolormesh(t, f[sel], sdb[sel], shading="auto", cmap="magma", vmin=top - 90, vmax=top)
            ax.set_ylabel("Hz")
        axes[0].set_title(title or rel(out))
        axes[1].set_xlabel("s")
        fig.colorbar(im, ax=axes, label="dB")
        fig.savefig(out, dpi=90)
        plt.close(fig)
        return "matplotlib"
    except ImportError:
        import subprocess
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
            sf.write(tmp.name, mono, SR, subtype="FLOAT")
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", tmp.name, "-lavfi",
                            "showspectrumpic=s=1400x700:legend=1:fscale=lin:stop=16000", str(out)], check=True)
        return "ffmpeg"
