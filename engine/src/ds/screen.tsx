/**
 * Screen demo: a real screenshot of the application inside a stylised browser
 * window, filmed by a virtual camera (zoom, pan, scroll), with a cursor,
 * spotlights, callouts and typed text. "Page" coordinates = CSS px of the
 * capture (origin at the top of the full page).
 */
import type { CSSProperties, ReactNode } from "react";
import { useCurrentFrame, Img } from "../engine/frame";
import { clamp, ease, interpolate, lerp, prog, spring } from "../engine/anim";
import { WIDTH as SCENE_W, HEIGHT as SCENE_H, FPS } from "../engine/config";
import { C, F, IS_DARK, RADIUS, S } from "./tokens";

export type Rect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };
export type View = { at: number; src: string; fade?: number; height?: number };
export type CameraKey = { at: number; target?: Rect | "window"; zoom?: number; duration?: number; fill?: number };
export type ScrollKey = { at: number; y: number; duration?: number };
export type CursorKey = { arrive: number; x: number; y: number; duration?: number; click?: boolean; hidden?: boolean };
export type Spotlight = { at: number; until?: number; rect: Rect; radius?: number };
export type Callout = {
  at: number;
  until?: number;
  anchor: Point;
  title?: string;
  text: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  distance?: number;
  width?: number;
  tone?: "dark" | "light";
};
export type UrlKey = { at: number; url: string };
export type Typing = { at: number; rect: Rect; text: string; cps?: number; size?: number; background?: string; until?: number };

export const BAR = 46;

type Cam = { cx: number; cy: number; s: number };

function blend(a: Cam, b: Cam, p: number): Cam {
  return { cx: lerp(a.cx, b.cx, p), cy: lerp(a.cy, b.cy, p), s: Math.exp(lerp(Math.log(a.s), Math.log(b.s), p)) };
}

export function useScreenGeometry(width: number, viewportHeight: number, margins = { x: 110, y: 64 }) {
  const worldW = width;
  const worldH = BAR + viewportHeight;
  const s0 = Math.min((SCENE_W - 2 * margins.x) / worldW, (SCENE_H - 2 * margins.y) / worldH);
  return { worldW, worldH, s0 };
}

/** Main screen-demo component. */
export function Screen({
  width = 1440,
  viewportHeight = 900,
  views,
  camera = [],
  scroll = [],
  cursor = [],
  spotlights = [],
  callouts = [],
  typing = [],
  url = [],
  enter = "rise",
  at = 0,
  exit,
  pageOverlay,
  page,
  veil = 0.56,
  opacity = 1,
  style,
}: {
  width?: number;
  viewportHeight?: number;
  views: View[];
  camera?: CameraKey[];
  scroll?: ScrollKey[];
  cursor?: CursorKey[];
  spotlights?: Spotlight[];
  callouts?: Callout[];
  typing?: Typing[];
  url?: UrlKey[];
  enter?: "rise" | "none";
  at?: number;
  exit?: number;
  /** Extra elements in page coordinates (follow camera and scroll). */
  pageOverlay?: (f: number) => ReactNode;
  /** Page recreated in React (page coordinates), displayed instead of captures. */
  page?: (f: number) => ReactNode;
  /** Opacity of the veil around spotlights (default 0.56). */
  veil?: number;
  /** Global opacity of the window. */
  opacity?: number;
  style?: CSSProperties;
}) {
  const f = useCurrentFrame();
  const { worldW, worldH, s0 } = useScreenGeometry(width, viewportHeight);

  // Scroll (page CSS px).
  const scrollAt = (t: number) => {
    let y = 0;
    for (const k of scroll) {
      if (t < k.at) break;
      y = lerp(y, k.y, ease.smooth(clamp((t - k.at) / (k.duration ?? 30))));
    }
    return y;
  };
  const sy = scrollAt(f);
  const pageToWorld = (p: Point, t = f): Point => ({ x: p.x, y: BAR + p.y - scrollAt(t) });

  // Camera.
  const initial: Cam = { cx: worldW / 2, cy: worldH / 2, s: s0 };
  const camTarget = (k: CameraKey, t: number): Cam => {
    if (!k.target || k.target === "window") return { ...initial, s: k.zoom ?? s0 };
    const r = k.target;
    const c = pageToWorld({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, t);
    const fill = k.fill ?? 0.62;
    let s = k.zoom ?? Math.min((SCENE_W * fill) / r.w, (SCENE_H * fill) / r.h);
    s = clamp(s, s0, 3.2);
    let { x: cx, y: cy } = c;
    const halfW = SCENE_W / 2 / s;
    const halfH = SCENE_H / 2 / s;
    if (worldW > 2 * halfW) cx = clamp(cx, halfW - 30 / s, worldW - halfW + 30 / s);
    if (worldH > 2 * halfH) cy = clamp(cy, halfH - 30 / s, worldH - halfH + 30 / s);
    return { cx, cy, s };
  };
  const state = (i: number, t: number): Cam => {
    if (i === 0) return initial;
    const k = camera[i - 1];
    if (t < k.at) return state(i - 1, t);
    const from = state(i - 1, k.at);
    return blend(from, camTarget(k, t), ease.smooth(clamp((t - k.at) / (k.duration ?? 32))));
  };
  const cam = state(camera.length, f);
  const toScreen = (m: Point): Point => ({ x: SCENE_W / 2 + (m.x - cam.cx) * cam.s, y: SCENE_H / 2 + (m.y - cam.cy) * cam.s });

  // Window enter / exit.
  const pin = enter === "none" ? 1 : prog(f, at, 46, ease.out);
  const pout = exit === undefined ? 0 : prog(f, exit, 22, ease.in);
  const ty = (1 - pin) * 40 + pout * 30;
  const sc = 0.96 + 0.04 * pin;
  const op = clamp(pin * 1.6) * (1 - pout) * opacity;

  // Active view and cross-fade.
  const sorted = [...views].sort((a, b) => a.at - b.at);
  const idx = Math.max(0, sorted.findLastIndex((v) => f >= v.at));
  const active = sorted[idx] ?? { at: 0, src: "" };
  const previous = idx > 0 ? sorted[idx - 1] : null;
  const fade = active.fade ?? 8;
  const pFade = previous ? clamp((f - active.at) / fade) : 1;

  // Cursor.
  const cursorPos = (() => {
    if (!cursor.length) return null;
    const keys = [...cursor].sort((a, b) => a.arrive - b.arrive);
    let p: Point = { x: keys[0].x, y: keys[0].y };
    let click = -999;
    let hidden = keys[0].hidden ?? false;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const d = k.duration ?? 22;
      const depart = k.arrive - d;
      if (f < depart) break;
      const q = ease.smooth(clamp((f - depart) / d));
      const from = p;
      const arc = Math.sin(Math.PI * q) * Math.hypot(k.x - from.x, k.y - from.y) * 0.08;
      const nx = -(k.y - from.y);
      const ny = k.x - from.x;
      const nn = Math.hypot(nx, ny) || 1;
      p = { x: lerp(from.x, k.x, q) + (nx / nn) * arc, y: lerp(from.y, k.y, q) + (ny / nn) * arc };
      if (f >= k.arrive) p = { x: k.x, y: k.y };
      if (k.click && f >= k.arrive) click = k.arrive;
      hidden = k.hidden ?? false;
    }
    return { p, click, hidden };
  })();

  const activeUrl = [...url].sort((a, b) => a.at - b.at).findLast((u) => f >= u.at)?.url ?? "";
  const imageHeight = (v: View) => v.height ?? viewportHeight;
  const worldTransform = `translate(${SCENE_W / 2 - cam.cx * cam.s}px, ${SCENE_H / 2 - cam.cy * cam.s}px) scale(${cam.s})`;
  const veilColor = IS_DARK ? "15 23 42" : "247 242 234";

  return (
    <div style={{ position: "absolute", inset: 0, opacity: op, ...style }}>
      <div style={{ position: "absolute", inset: 0, transform: `translateY(${ty}px) scale(${sc})`, transformOrigin: "50% 50%" }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: worldW, height: worldH, transformOrigin: "0 0", transform: worldTransform }}>
          {/* Window */}
          <div style={{ position: "absolute", inset: 0, borderRadius: RADIUS, overflow: "hidden", background: C.surface, boxShadow: `8px 10px 0 rgb(0 0 0 / 8%), ${S.window}, 0 0 0 1px rgb(0 0 0 / 14%)` }}>
            <BrowserBar url={activeUrl} />
            <div style={{ position: "absolute", left: 0, top: BAR, width, height: viewportHeight, overflow: "hidden", background: C.surface }}>
              <div style={{ position: "absolute", left: 0, top: -sy, width }}>
                {page ? (
                  page(f)
                ) : (
                  <>
                    {previous && pFade < 1 && (
                      <Img src={previous.src} style={{ position: "absolute", left: 0, top: 0, width, height: imageHeight(previous) }} />
                    )}
                    {active.src && <Img src={active.src} style={{ position: "absolute", left: 0, top: 0, width, height: imageHeight(active), opacity: pFade }} />}
                  </>
                )}
                {typing.map((s, i) => <TypedField key={i} typing={s} f={f} />)}
                {pageOverlay?.(f)}
              </div>
            </div>
          </div>
          {/* Spotlights (world coordinates) */}
          {spotlights.map((sp, i) => {
            const a = enterExitLocal(f, sp.at, sp.until);
            if (a <= 0) return null;
            const m = pageToWorld({ x: sp.rect.x, y: sp.rect.y });
            const margin = 8;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: m.x - margin,
                  top: m.y - margin,
                  width: sp.rect.w + 2 * margin,
                  height: sp.rect.h + 2 * margin,
                  borderRadius: sp.radius ?? 3,
                  boxShadow: `0 0 0 6000px rgb(${veilColor} / ${a * veil * 100}%), 0 0 0 ${4 / cam.s}px rgb(0 0 0 / ${a * 10}%)`,
                  outline: `${1.5 / cam.s}px solid ${C.ink}`,
                  outlineOffset: 0,
                  opacity: 1,
                }}
              />
            );
          })}
          {/* Cursor */}
          {cursorPos && !cursorPos.hidden && (() => {
            const m = pageToWorld(cursorPos.p);
            const dc = f - cursorPos.click;
            const pressed = dc >= -2 && dc < 8 ? interpolate(dc, [-2, 0, 8], [1, 0.82, 1]) : 1;
            const wave = dc >= 0 && dc < 12 ? dc / 12 : -1;
            return (
              <div style={{ position: "absolute", left: m.x, top: m.y, transform: `scale(${1 / cam.s})`, transformOrigin: "0 0" }}>
                {wave >= 0 && (
                  <div
                    style={{
                      position: "absolute",
                      left: -32 * ease.out(wave),
                      top: -32 * ease.out(wave),
                      width: 64 * ease.out(wave),
                      height: 64 * ease.out(wave),
                      borderRadius: "50%",
                      border: `2px solid ${C.accentBright}`,
                      opacity: 1 - wave,
                    }}
                  />
                )}
                <CursorArrow scale={pressed} />
              </div>
            );
          })()}
        </div>
      </div>
      {/* Callouts (screen coordinates) */}
      {callouts.map((b, i) => {
        const a = enterExitLocal(f, b.at, b.until);
        if (a <= 0) return null;
        const e = toScreen(pageToWorld(b.anchor));
        return <CalloutBox key={i} callout={b} screen={e} a={a} f={f} />;
      })}
    </div>
  );
}

function enterExitLocal(f: number, at: number, until?: number) {
  const pin = prog(f, at, 12, ease.out);
  const pout = until === undefined ? 0 : prog(f, until, 12, ease.in);
  return pin * (1 - pout);
}

function BrowserBar({ url }: { url: string }) {
  return (
    <div style={{ position: "absolute", left: 0, top: 0, right: 0, height: BAR, display: "flex", alignItems: "center", gap: 18, padding: "0 18px", background: C.bgDeep, borderBottom: `1px solid ${C.line}` }}>
      <div style={{ display: "flex", gap: 8 }}>
        {["#e8857a", "#e9c46a", "#8fc9a0"].map((c) => (
          <span key={c} style={{ width: 12, height: 12, borderRadius: "50%", background: c, boxShadow: "inset 0 0 0 1px rgb(0 0 0 / 12%)" }} />
        ))}
      </div>
      <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 520, height: 28, padding: "0 14px", borderRadius: 6, background: C.surface, border: `1px solid ${C.line}`, color: C.muted, font: `500 13px/1 ${F.mono}`, letterSpacing: "0.02em" }}>
          <svg width="11" height="13" viewBox="0 0 11 13" fill="none"><rect x="1" y="5.5" width="9" height="7" rx="1.5" fill={C.muted} /><path d="M3 5.5V4a2.5 2.5 0 0 1 5 0v1.5" stroke={C.muted} strokeWidth="1.4" /></svg>
          {url}
        </div>
      </div>
      <div style={{ width: 52 }} />
    </div>
  );
}

/** Pointer with a white outline. */
export function CursorArrow({ scale = 1 }: { scale?: number }) {
  return (
    <svg width="34" height="40" viewBox="0 0 34 40" style={{ position: "absolute", left: -4, top: -3, transform: `scale(${scale})`, transformOrigin: "4px 3px", filter: "drop-shadow(2px 2px 0 rgb(0 0 0 / 22%))" }}>
      <path d="M5 3 L5 31 L12.5 24.2 L17.6 35.4 L22.6 33.2 L17.6 22.3 L27.6 21.6 Z" fill={C.ink} stroke={C.white} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function CalloutBox({ callout, screen, a, f }: { callout: Callout; screen: Point; a: number; f: number }) {
  const side = callout.side ?? "right";
  const dist = callout.distance ?? 120;
  const width = callout.width ?? 420;
  const dx = side === "right" ? dist : side === "left" ? -dist : 0;
  const dy = side === "bottom" ? dist : side === "top" ? -dist : 0;
  const dark = (callout.tone ?? "dark") === "dark";
  const s = spring({ frame: f - callout.at, config: { damping: 20, stiffness: 140 } });
  const ox = side === "left" ? -width : side === "right" ? 0 : -width / 2;
  const oyPct = side === "top" ? -100 : side === "bottom" ? 0 : -50;
  // Keep the box inside the canvas (a frame that touches the right edge would push it off screen).
  const margin = 24;
  const bx = clamp(screen.x + dx, margin - ox, SCENE_W - width - margin - ox);
  const estH = 120;
  const by = clamp(screen.y + dy, margin + (side === "top" ? estH : side === "bottom" ? 0 : estH / 2), SCENE_H - margin - (side === "bottom" ? estH : side === "top" ? 0 : estH / 2));
  const lx = screen.x + dx * clamp(a * 1.2);
  const ly = screen.y + dy * clamp(a * 1.2);
  return (
    <>
      <svg style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }} width={SCENE_W} height={SCENE_H}>
        <line x1={screen.x} y1={screen.y} x2={lx} y2={ly} stroke={C.accentBright} strokeWidth={2.5} strokeDasharray="2 6" strokeLinecap="round" opacity={a} />
        <circle cx={screen.x} cy={screen.y} r={7 * a} fill={C.accentBright} />
        <circle cx={screen.x} cy={screen.y} r={16 * a} fill="none" stroke={C.accentBright} strokeOpacity={0.4 * a} strokeWidth={2} />
      </svg>
      <div
        style={{
          position: "absolute",
          left: bx + ox,
          top: by,
          width,
          transform: `translateY(${oyPct}%) translateY(${(1 - s) * 16}px) scale(${0.94 + 0.06 * s})`,
          opacity: a,
          padding: "20px 24px 22px",
          background: dark ? `linear-gradient(140deg, ${C.dark}, ${C.darkDeep})` : C.surface,
          color: dark ? C.onDark : C.ink,
          border: dark ? "1px solid rgb(255 255 255 / 8%)" : `1px solid ${C.line}`,
          boxShadow: `6px 6px 0 rgb(0 0 0 / ${dark ? 20 : 10}%)`,
          borderLeft: `5px solid ${C.accentBright}`,
          borderRadius: RADIUS,
        }}
      >
        {callout.title && (
          <div style={{ font: `500 14px/1.2 ${F.mono}`, letterSpacing: "0.14em", textTransform: "uppercase", color: dark ? C.goldSoft : C.muted, marginBottom: 9 }}>{callout.title}</div>
        )}
        <div style={{ font: `500 25px/1.38 ${F.sans}` }}>{callout.text}</div>
      </div>
    </>
  );
}

/** Text typed into a field (above the capture, page coordinates). */
function TypedField({ typing, f }: { typing: Typing; f: number }) {
  if (f < typing.at || (typing.until !== undefined && f >= typing.until)) return null;
  const cps = typing.cps ?? 14;
  const n = Math.min(typing.text.length, Math.floor(((f - typing.at) / FPS) * cps));
  const blink = Math.floor((f - typing.at) / Math.round(FPS / 2)) % 2 === 0 || n < typing.text.length;
  const r = typing.rect;
  return (
    <div
      style={{
        position: "absolute",
        left: r.x,
        top: r.y,
        width: r.w,
        height: r.h,
        display: "flex",
        alignItems: "center",
        padding: "0 11px",
        background: typing.background ?? C.surface,
        border: `1px solid ${C.ink}66`,
        boxShadow: `0 0 0 3px ${C.ink}14`,
        borderRadius: 3,
        font: `400 ${typing.size ?? 14}px/1 ${F.sans}`,
        color: C.ink,
        whiteSpace: "pre",
      }}
    >
      {typing.text.slice(0, n)}
      <span style={{ width: 1.5, height: (typing.size ?? 14) * 1.25, background: C.ink, marginLeft: 1, opacity: blink ? 1 : 0 }} />
    </div>
  );
}
