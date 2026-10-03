/**
 * Pure animation helpers: every value is a function of the current frame,
 * which keeps frame-by-frame rendering deterministic.
 */
import { FPS } from "./config";

export type Extrapolation = "clamp" | "extend";
export type EasingFn = (t: number) => number;

/** Piecewise linear interpolation, clamped by default. */
export function interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  options: { easing?: EasingFn; extrapolateLeft?: Extrapolation; extrapolateRight?: Extrapolation } = {},
): number {
  const { easing = (t: number) => t, extrapolateLeft = "clamp", extrapolateRight = "clamp" } = options;
  if (inputRange.length !== outputRange.length || inputRange.length < 2) {
    throw new Error("interpolate: input and output ranges must have the same length (>= 2)");
  }
  let i = 1;
  while (i < inputRange.length - 1 && input > inputRange[i]) i++;
  const a = inputRange[i - 1];
  const b = inputRange[i];
  const oa = outputRange[i - 1];
  const ob = outputRange[i];
  let t = b === a ? 1 : (input - a) / (b - a);
  if (t < 0 && extrapolateLeft === "clamp") t = 0;
  if (t > 1 && extrapolateRight === "clamp") t = 1;
  const e = t >= 0 && t <= 1 ? easing(t) : t;
  return oa + (ob - oa) * e;
}

/** Cubic Bézier curve (same semantics as CSS cubic-bezier). */
export function bezier(x1: number, y1: number, x2: number, y2: number): EasingFn {
  const A = (a1: number, a2: number) => 1 - 3 * a2 + 3 * a1;
  const B = (a1: number, a2: number) => 3 * a2 - 6 * a1;
  const C = (a1: number) => 3 * a1;
  const calc = (t: number, a1: number, a2: number) => ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
  const slope = (t: number, a1: number, a2: number) => 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1);
  const xToT = (x: number) => {
    let t = x;
    for (let k = 0; k < 8; k++) {
      const s = slope(t, x1, x2);
      if (Math.abs(s) < 1e-6) break;
      t -= (calc(t, x1, x2) - x) / s;
    }
    let lo = 0;
    let hi = 1;
    t = Math.min(1, Math.max(0, t));
    for (let k = 0; k < 30 && Math.abs(calc(t, x1, x2) - x) > 1e-6; k++) {
      if (calc(t, x1, x2) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : calc(xToT(x), y1, y2));
}

const out = (f: EasingFn): EasingFn => (t) => 1 - f(1 - t);
const inOut = (f: EasingFn): EasingFn => (t) => (t < 0.5 ? f(t * 2) / 2 : 1 - f((1 - t) * 2) / 2);

export const Easing = {
  linear: ((t: number) => t) as EasingFn,
  quad: ((t: number) => t * t) as EasingFn,
  cubic: ((t: number) => t * t * t) as EasingFn,
  quint: ((t: number) => t ** 5) as EasingFn,
  sin: ((t: number) => 1 - Math.cos((t * Math.PI) / 2)) as EasingFn,
  expo: ((t: number) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1)))) as EasingFn,
  back: (s = 1.70158): EasingFn => (t) => t * t * ((s + 1) * t - s),
  bezier,
  out,
  inOut,
};

/** House curves: composed, editorial, never bouncy. */
export const ease = {
  /** Fast start, very soft landing (element entrances). */
  out: bezier(0.16, 1, 0.3, 1),
  /** Discreet acceleration (element exits). */
  in: bezier(0.7, 0, 0.84, 0),
  /** Symmetric camera move. */
  smooth: bezier(0.65, 0, 0.35, 1),
  /** Slight anticipation (cards settling). */
  settle: bezier(0.34, 1.36, 0.64, 1),
  linear: (t: number) => t,
};

export type SpringConfig = { mass?: number; stiffness?: number; damping?: number; overshootClamping?: boolean };

/** Damped spring in closed form (0 → 1), evaluated at the frame's time. */
export function spring(opts: {
  frame: number;
  fps?: number;
  config?: SpringConfig;
  from?: number;
  to?: number;
  delay?: number;
}): number {
  const { frame, fps = FPS, config = {}, from = 0, to = 1, delay = 0 } = opts;
  const { mass = 1, stiffness = 100, damping = 16, overshootClamping = false } = config;
  const t = (frame - delay) / fps;
  if (t <= 0) return from;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  let x: number;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    x = 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  } else if (zeta === 1) {
    x = 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  } else {
    const s = Math.sqrt(zeta * zeta - 1);
    const r1 = -w0 * (zeta - s);
    const r2 = -w0 * (zeta + s);
    x = 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
  }
  if (overshootClamping) x = Math.min(1, x);
  return from + (to - from) * x;
}

/** 0→1 progress between two frames with a curve (the most used shortcut). */
export function prog(frame: number, start: number, duration: number, easing: EasingFn = ease.out): number {
  return interpolate(frame, [start, start + Math.max(1, duration)], [0, 1], { easing });
}

/** Enter then exit: 0→1 on [a, a+din], 1 until b, then 1→0 on [b, b+dout]. */
export function enterExit(frame: number, a: number, din: number, b: number, dout: number): number {
  if (frame < b) return prog(frame, a, din, ease.out);
  return 1 - prog(frame, b, dout, ease.in);
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const sec = (s: number) => Math.round(s * FPS);

function hash(seed: string | number): number {
  const s = String(seed);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic random in [0, 1). */
export function random(seed: string | number): number {
  let t = (hash(seed) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Smooth 1D value noise in [-1, 1], for organic drifts. */
export function noise1(x: number, seed: string | number = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = random(`${seed}:${i}`) * 2 - 1;
  const b = random(`${seed}:${i + 1}`) * 2 - 1;
  return a + (b - a) * u;
}
