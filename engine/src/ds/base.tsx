/**
 * Animated building blocks: backgrounds, texts, chips, dots, buttons, cards,
 * rules, rings, icons. Convention: `at` = frame (relative to the sequence) where the entrance starts.
 */
import type { CSSProperties, ReactNode } from "react";
import { useCurrentFrame } from "../engine/frame";
import { clamp, ease, interpolate, noise1, prog, spring } from "../engine/anim";
import { C, F, IS_DARK, RADIUS, S, TONES, paperTexture, type Tone } from "./tokens";
import { ICONS } from "./icons";

/* ---- Backgrounds -------------------------------------------------------- */

/** Light (or themed) background with two slowly drifting light halos. */
export function Background({ lines = false, deep = false, style }: { lines?: boolean; deep?: boolean; style?: CSSProperties }) {
  const f = useCurrentFrame();
  const x1 = 22 + noise1(f / 160, "h1") * 8;
  const y1 = 18 + noise1(f / 190, "h2") * 6;
  const x2 = 78 + noise1(f / 170, "h3") * 8;
  const y2 = 82 + noise1(f / 210, "h4") * 6;
  const halo = IS_DARK ? "rgb(255 255 255 / 5%)" : "rgb(255 255 255 / 55%)";
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: [
          paperTexture(44),
          `radial-gradient(ellipse 55% 60% at ${x1}% ${y1}%, ${halo}, transparent 70%)`,
          `radial-gradient(ellipse 50% 55% at ${x2}% ${y2}%, ${C.goldSoft}22, transparent 70%)`,
          deep ? C.bgDeep : C.bg,
        ].filter((v) => v !== "none").join(", "),
        ...style,
      }}
    >
      {lines && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `repeating-linear-gradient(180deg, transparent 0 63px, ${C.line}88 63px 64px)`,
            maskImage: "linear-gradient(90deg, transparent, black 12%, black 88%, transparent)",
          }}
        />
      )}
    </div>
  );
}

/** Dark panel (title cards, chapters), with a dotted grain and an accent halo. */
export function DarkPanel({ style, halo = true }: { style?: CSSProperties; halo?: boolean }) {
  const f = useCurrentFrame();
  const hx = 88 + noise1(f / 150, "p1") * 5;
  const hy = 14 + noise1(f / 170, "p2") * 5;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: [
          "radial-gradient(circle at 18% 17%, rgb(255 255 255 / 5%) 0 1px, transparent 1.4px) 0 0 / 15px 15px",
          halo ? `radial-gradient(circle at ${hx}% ${hy}%, ${C.accentBright}2a 0 160px, transparent 420px)` : "",
          `linear-gradient(165deg, ${C.dark}, ${C.darkDeep})`,
        ].filter(Boolean).join(", "),
        ...style,
      }}
    />
  );
}

/** Concentric rings (ornament of dark panels), opening on entrance. */
export function Rings({ x, y, r = 120, at = 0, color = C.accentBright, style }: { x: number; y: number; r?: number; at?: number; color?: string; style?: CSSProperties }) {
  const f = useCurrentFrame();
  const p = prog(f, at, 40, ease.out);
  const breathe = 1 + Math.sin((f - at) / 45) * 0.012;
  const rings = [
    { k: 1, a: 0.26 },
    { k: 1.22, a: 0.1 },
    { k: 1.45, a: 0.05 },
  ];
  return (
    <div style={{ position: "absolute", left: x, top: y, width: 0, height: 0, ...style }}>
      {rings.map((ring, i) => {
        const pi = clamp(p * 1.25 - i * 0.12);
        const d = r * 2 * ring.k * (0.6 + 0.4 * ease.out(pi)) * breathe;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: -d / 2,
              top: -d / 2,
              width: d,
              height: d,
              borderRadius: "50%",
              border: `1px solid ${color}`,
              opacity: ring.a * pi,
            }}
          />
        );
      })}
    </div>
  );
}

/* ---- Texts -------------------------------------------------------------- */

/** Uppercase mono label (eyebrow), revealed letter by letter behind a short rule. */
export function Eyebrow({ children, at = 0, size = 18, color = C.muted, rule = true, style }: { children: string; at?: number; size?: number; color?: string; rule?: boolean; style?: CSSProperties }) {
  const f = useCurrentFrame();
  const n = children.length;
  const p = prog(f, at, Math.min(26, 8 + n * 0.7), ease.out);
  const visible = Math.round(n * p);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.8, ...style }}>
      {rule && <div style={{ width: 46 * ease.out(clamp(p * 1.6)), height: 2, background: C.accentBright }} />}
      <span style={{ font: `500 ${size}px/1.2 ${F.mono}`, letterSpacing: "0.14em", textTransform: "uppercase", color, whiteSpace: "pre" }}>
        {children.slice(0, visible)}
        <span style={{ opacity: 0 }}>{children.slice(visible)}</span>
      </span>
    </div>
  );
}

/** Display title: each word rises behind a mask, in cascade. `\n` forces a line break. */
export function DisplayTitle({
  children,
  at = 0,
  size = 96,
  color = C.ink,
  cascade = 3,
  align = "left",
  lineHeight = 0.98,
  accent,
  weight = 700,
  style,
}: {
  children: string;
  at?: number;
  size?: number;
  color?: string;
  cascade?: number;
  align?: "left" | "center" | "right";
  lineHeight?: number;
  /** Words (without punctuation) to colour with the accent. */
  accent?: string[];
  weight?: number;
  style?: CSSProperties;
}) {
  const f = useCurrentFrame();
  const lines = children.split("\n");
  let k = 0;
  return (
    <div style={{ font: `${weight} ${size}px/${lineHeight} ${F.display}`, letterSpacing: "-0.03em", color, textAlign: align, ...style }}>
      {lines.map((line, li) => (
        <div key={li} style={{ display: "block" }}>
          {line.split(" ").map((word, wi, arr) => {
            const i = k++;
            const p = prog(f, at + i * cascade, 22, ease.out);
            const bare = word.replace(/[.,;:!?«»"()]/g, "");
            const isAccent = accent?.includes(bare);
            return (
              <span key={wi}>
                <span style={{ display: "inline-block", overflow: "hidden", verticalAlign: "top", paddingBottom: size * 0.1, marginBottom: -size * 0.1 }}>
                  <span style={{ display: "inline-block", transform: `translateY(${(1 - p) * 110}%)`, opacity: clamp(p * 2), color: isAccent ? C.accent : undefined }}>
                    {word}
                  </span>
                </span>
                {wi < arr.length - 1 ? " " : null}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Paragraph fading in while rising. */
export function Text({ children, at = 0, size = 28, color = C.muted, weight = 400, style }: { children: ReactNode; at?: number; size?: number; color?: string; weight?: number; style?: CSSProperties }) {
  const f = useCurrentFrame();
  const p = prog(f, at, 20, ease.out);
  return (
    <div style={{ font: `${weight} ${size}px/1.5 ${F.sans}`, color, opacity: p, transform: `translateY(${(1 - p) * 18}px)`, ...style }}>
      {children}
    </div>
  );
}

/** Number counting up to its value (tabular digits). */
export function Counter({ value, at = 0, duration = 40, suffix = "", prefix = "", locale, decimals = 0, style }: { value: number; at?: number; duration?: number; suffix?: string; prefix?: string; locale?: string; decimals?: number; style?: CSSProperties }) {
  const f = useCurrentFrame();
  const p = prog(f, at, duration, ease.out);
  const v = value * p;
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
  return (
    <span style={{ fontVariantNumeric: "tabular-nums", ...style }}>
      {prefix}
      {nf.format(v)}
      {suffix}
    </span>
  );
}

/* ---- Interface elements ------------------------------------------------- */

export function Dot({ tone = "ok", size = 14, at = 0, pulse = false, style }: { tone?: Tone; size?: number; at?: number; pulse?: boolean; style?: CSSProperties }) {
  const f = useCurrentFrame();
  const s = spring({ frame: f - at, config: { damping: 21, stiffness: 160 } });
  const c = TONES[tone].dot;
  const cycle = ((f - at) % 50) / 50;
  return (
    <span style={{ position: "relative", display: "inline-block", width: size, height: size, flex: "0 0 auto", ...style }}>
      {pulse && f >= at && (
        <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `2px solid ${c}`, transform: `scale(${1 + cycle * 1.6})`, opacity: (1 - cycle) * 0.6 }} />
      )}
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: c, opacity: s, boxShadow: `0 0 0 2px ${C.surface}` }} />
    </span>
  );
}

/** Status chip. */
export function Chip({ tone = "neutral", children, at = 0, size = 20, dot = false, style }: { tone?: Tone; children: ReactNode; at?: number; size?: number; dot?: boolean; style?: CSSProperties }) {
  const f = useCurrentFrame();
  const s = spring({ frame: f - at, config: { damping: 21, stiffness: 170 } });
  const t = TONES[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.5,
        padding: `${size * 0.36}px ${size * 0.62}px`,
        borderRadius: RADIUS,
        color: t.fg,
        background: t.bg,
        font: `600 ${size}px/1.2 ${F.sans}`,
        whiteSpace: "nowrap",
        opacity: clamp(s * 1.5),
        transform: `translateY(${(1 - s) * 10}px) scale(${0.96 + 0.04 * s})`,
        transformOrigin: "left center",
        ...style,
      }}
    >
      {dot && <span style={{ width: size * 0.5, height: size * 0.5, borderRadius: "50%", background: t.dot }} />}
      {children}
    </span>
  );
}

/** Button; `click` = frame of the press (push down then release). */
export function Button({ children, variant = "primary", click, size = 22, style }: { children: ReactNode; variant?: "primary" | "secondary" | "ok"; click?: number; size?: number; style?: CSSProperties }) {
  const f = useCurrentFrame();
  const press = click === undefined ? 0 : interpolate(f, [click - 2, click, click + 4], [0, 1, 0]);
  const v = {
    primary: { color: C.white, background: C.accent, border: `1px solid ${C.accent}`, shadowA: 0.22 },
    secondary: { color: C.ink, background: C.surface, border: `1px solid ${C.line}`, shadowA: 0.08 },
    ok: { color: C.white, background: C.ok, border: `1px solid ${C.ok}`, shadowA: 0.16 },
  }[variant];
  const d = variant === "secondary" ? 1.3 * (1 - press * 0.3) : 4 - 1.3 * press;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: size * 0.4,
        minHeight: size * 2.4,
        padding: `${size * 0.55}px ${size * 1.05}px`,
        borderRadius: RADIUS,
        font: `600 ${size}px/1 ${F.sans}`,
        color: v.color,
        background: v.background,
        border: v.border,
        boxShadow: `${d}px ${d}px 0 rgb(0 0 0 / ${v.shadowA * 100}%)`,
        transform: `translate(${press * 1.3}px, ${press * 1.3}px)`,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** Card settling with a light spring. */
export function Card({ children, at = 0, style, high = false, from = 40 }: { children: ReactNode; at?: number; style?: CSSProperties; high?: boolean; from?: number }) {
  const f = useCurrentFrame();
  const s = spring({ frame: f - at, config: { damping: 18, stiffness: 120 } });
  return (
    <div
      style={{
        padding: 28,
        border: `1px solid ${C.line}`,
        borderRadius: RADIUS,
        background: C.surface,
        boxShadow: high ? S.cardHigh : S.card,
        opacity: clamp(s * 1.4),
        transform: `translateY(${(1 - s) * from}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Rule drawn from left to right. */
export function Rule({ at = 0, duration = 30, color = C.line, thickness = 1, style }: { at?: number; duration?: number; color?: string; thickness?: number; style?: CSSProperties }) {
  const f = useCurrentFrame();
  const p = prog(f, at, duration, ease.smooth);
  return <div style={{ height: thickness, background: color, width: `${p * 100}%`, ...style }} />;
}

/** Square monogram with an offset shadow. */
export function Monogram({ initials, size = 78, at = 0, background = C.secondary, color = C.white, style }: { initials: string; size?: number; at?: number; background?: string; color?: string; style?: CSSProperties }) {
  const f = useCurrentFrame();
  const s = spring({ frame: f - at, config: { damping: 20, stiffness: 150 } });
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        width: size,
        height: size,
        color,
        background,
        borderRadius: RADIUS,
        boxShadow: `${6 * s}px ${6 * s}px 0 rgb(0 0 0 / 16%)`,
        font: `600 ${size * 0.26}px/1 ${F.mono}`,
        letterSpacing: "0.06em",
        transform: `translateY(${(1 - s) * 14}px) scale(${0.96 + 0.04 * s})`,
        opacity: clamp(s * 2),
        ...style,
      }}
    >
      {initials}
    </div>
  );
}

/** Stroke icon; `trace` (0→1) draws the strokes progressively. */
export function Icon({ name, size = 32, color = "currentColor", trace, strokeWidth = 1.7, style }: { name: string; size?: number; color?: string; trace?: number; strokeWidth?: number; style?: CSSProperties }) {
  const raw = ICONS[name] ?? ICONS.sparkle;
  const content = trace === undefined ? raw : raw.replace(/<(path|circle|rect|line|polyline)/g, `<$1 pathLength="1" stroke-dasharray="1" stroke-dashoffset="${1 - clamp(trace)}"`);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ color, flex: "0 0 auto", ...style }}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: content }}
    />
  );
}

/** Generic entrance (fade + rise + slight zoom) to wrap any block; optional exit. */
export function Appear({ children, at = 0, duration = 22, dy = 26, scale = 0.985, exit, style }: { children: ReactNode; at?: number; duration?: number; dy?: number; scale?: number; exit?: number; style?: CSSProperties }) {
  const f = useCurrentFrame();
  const pin = prog(f, at, duration, ease.out);
  const pout = exit === undefined ? 0 : prog(f, exit, 16, ease.in);
  const p = pin * (1 - pout);
  return (
    <div style={{ opacity: p, transform: `translateY(${(1 - pin) * dy - pout * 14}px) scale(${scale + (1 - scale) * pin})`, ...style }}>
      {children}
    </div>
  );
}

/** Logo: an image from public/assets (SVG/PNG) or, by default, the brand name as a wordmark. */
export function Logo({ src, name, height = 44, color = C.ink, at = 0, style }: { src?: string; name?: string; height?: number; color?: string; at?: number; style?: CSSProperties }) {
  const f = useCurrentFrame();
  const p = prog(f, at, 20, ease.out);
  if (src) return <img src={src.startsWith("/") || src.startsWith("http") ? src : `/${src}`} alt="" style={{ height, width: "auto", display: "block", opacity: p, ...style }} />;
  return <div style={{ font: `700 ${height * 0.72}px/1 ${F.display}`, letterSpacing: "-0.02em", color, opacity: p, ...style }}>{name ?? ""}</div>;
}
