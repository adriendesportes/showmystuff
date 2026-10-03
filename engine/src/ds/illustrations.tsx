/** Motion-design illustrations: document sheet, stamp, notification, avatar. */
import type { CSSProperties } from "react";
import { useCurrentFrame } from "../engine/frame";
import { clamp, ease, interpolate, prog, spring } from "../engine/anim";
import { C, F, RADIUS, TONES, type Tone } from "./tokens";

/** Stylised document sheet (quote, order, invoice…). */
export function Doc({
  title,
  subtitle,
  label = "PDF",
  at = 0,
  width = 240,
  signature = false,
  signatureAt,
  tone = "secondary",
  style,
}: {
  title: string;
  subtitle?: string;
  label?: string;
  at?: number;
  width?: number;
  signature?: boolean;
  signatureAt?: number;
  tone?: Tone;
  style?: CSSProperties;
}) {
  const f = useCurrentFrame();
  const s = spring({ frame: f - at, config: { damping: 18, stiffness: 120 } });
  const h = width * 1.32;
  const corner = width * 0.16;
  const pSig = signature ? prog(f, signatureAt ?? at + 18, 26, ease.smooth) : 0;
  const t = TONES[tone];
  const sh = 5 * clamp((s - 0.7) / 0.3);
  return (
    <div style={{ position: "relative", width, height: h, opacity: clamp(s * 1.5), transform: `translateY(${(1 - s) * 24}px)`, filter: `drop-shadow(${sh}px ${sh}px 0 rgb(0 0 0 / 10%))`, ...style }}>
      <div style={{ position: "absolute", inset: 0, background: C.surface, clipPath: `polygon(0 0, calc(100% - ${corner}px) 0, 100% ${corner}px, 100% 100%, 0 100%)`, border: `1px solid ${C.line}` }} />
      <div style={{ position: "absolute", right: 0, top: 0, width: corner, height: corner, background: C.surfaceAlt, clipPath: "polygon(0 0, 0 100%, 100% 100%)" }} />
      <div style={{ position: "absolute", left: width * 0.1, top: width * 0.12, right: width * 0.22 }}>
        <span style={{ display: "inline-block", padding: "4px 8px", background: t.bg, color: t.fg, font: `600 ${width * 0.055}px/1 ${F.mono}`, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</span>
      </div>
      <div style={{ position: "absolute", left: width * 0.1, right: width * 0.1, top: width * 0.3 }}>
        <div style={{ font: `600 ${width * 0.085}px/1.2 ${F.sans}`, color: C.ink }}>{title}</div>
        {subtitle && <div style={{ marginTop: 6, font: `400 ${width * 0.058}px/1.3 ${F.sans}`, color: C.muted }}>{subtitle}</div>}
        {[0.92, 0.78, 0.86, 0.6, 0.82, 0.5].map((w, i) => (
          <div key={i} style={{ marginTop: i === 0 ? width * 0.08 : width * 0.045, height: width * 0.024, width: `${w * 100}%`, background: `${C.muted}2a`, borderRadius: 2 }} />
        ))}
      </div>
      {signature && (
        <svg style={{ position: "absolute", left: width * 0.48, bottom: width * 0.1 }} width={width * 0.42} height={width * 0.2} viewBox="0 0 100 46">
          <path d="M4 34 C 14 6, 22 6, 24 30 S 34 44, 40 22 S 52 8, 56 30 S 70 40, 76 18 S 90 20, 96 26" fill="none" stroke={C.ink} strokeWidth={3} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - pSig} />
        </svg>
      )}
    </div>
  );
}

/** Status stamp printed with a light impact. */
export function Stamp({ text, tone = "ok", at = 0, size = 46, rotation = -4, style }: { text: string; tone?: Tone; at?: number; size?: number; rotation?: number; style?: CSSProperties }) {
  const f = useCurrentFrame();
  const p = prog(f, at, 8, ease.in);
  const settle = spring({ frame: f - at - 8, config: { damping: 18, stiffness: 220 } });
  const scale = f < at + 8 ? interpolate(p, [0, 1], [1.45, 1]) : 1 + (1 - settle) * 0.02;
  const t = TONES[tone];
  if (f < at) return null;
  return (
    <div
      style={{
        display: "inline-block",
        padding: `${size * 0.22}px ${size * 0.5}px`,
        border: `${Math.max(3, size * 0.08)}px solid ${t.fg}`,
        color: t.fg,
        background: `${t.bg}cc`,
        font: `700 ${size}px/1 ${F.mono}`,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        transform: `rotate(${clamp(rotation, -6, 6)}deg) scale(${scale})`,
        opacity: clamp(p * 3),
        boxShadow: "4px 4px 0 rgb(0 0 0 / 14%)",
        ...style,
      }}
    >
      {text}
    </div>
  );
}

/** Toast notification sliding in from the right. */
export function Notification({ title, text, at = 0, until, tone = "ok", icon = "✓", style }: { title: string; text?: string; at?: number; until?: number; tone?: Tone; icon?: string; style?: CSSProperties }) {
  const f = useCurrentFrame();
  const s = spring({ frame: f - at, config: { damping: 19, stiffness: 130 } });
  const out = until === undefined ? 0 : prog(f, until, 14, ease.in);
  const t = TONES[tone];
  if (f < at) return null;
  return (
    <div
      style={{
        position: "absolute",
        right: 80,
        top: 92,
        display: "flex",
        gap: 16,
        alignItems: "flex-start",
        minWidth: 380,
        maxWidth: 520,
        padding: "18px 22px",
        background: C.surface,
        border: `1px solid ${C.line}`,
        borderLeft: `5px solid ${t.dot}`,
        borderRadius: RADIUS,
        boxShadow: "6px 6px 0 rgb(0 0 0 / 10%)",
        opacity: clamp(s * 1.5) * (1 - out),
        transform: `translateX(${(1 - s) * 60 + out * 40}px)`,
        ...style,
      }}
    >
      <div style={{ display: "grid", placeItems: "center", width: 36, height: 36, borderRadius: "50%", background: t.bg, color: t.fg, font: `700 18px/1 ${F.sans}`, flex: "0 0 auto" }}>{icon}</div>
      <div>
        <div style={{ font: `600 22px/1.25 ${F.sans}`, color: C.ink }}>{title}</div>
        {text && <div style={{ marginTop: 4, font: `400 18px/1.35 ${F.sans}`, color: C.muted }}>{text}</div>}
      </div>
    </div>
  );
}

/** Person in a process: round badge with initials, name and role. */
export function Avatar({ initials, name, role, background = C.goldSoft, color = C.darkDeep, at = 0, size = 120, active = true, style }: { initials: string; name: string; role?: string; background?: string; color?: string; at?: number; size?: number; active?: boolean; style?: CSSProperties }) {
  const f = useCurrentFrame();
  const s = spring({ frame: f - at, config: { damping: 20, stiffness: 140 } });
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, opacity: clamp(s * 1.6) * (active ? 1 : 0.42), transform: `translateY(${(1 - s) * 30}px)`, ...style }}>
      <div style={{ display: "grid", placeItems: "center", width: size, height: size, borderRadius: "50%", background, color, font: `700 ${size * 0.3}px/1 ${F.mono}`, boxShadow: `0 0 0 ${size * 0.06}px ${C.surface}, 4px 4px 0 ${size * 0.06}px rgb(0 0 0 / 10%)`, transform: `scale(${0.96 + 0.04 * s})` }}>
        {initials}
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ font: `600 ${size * 0.24}px/1.2 ${F.sans}`, color: C.ink }}>{name}</div>
        {role && <div style={{ marginTop: 4, font: `400 ${size * 0.17}px/1.2 ${F.sans}`, color: C.muted }}>{role}</div>}
      </div>
    </div>
  );
}
