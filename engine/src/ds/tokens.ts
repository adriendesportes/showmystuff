/**
 * Theme tokens. A preset is chosen in showmystuff.json (`theme.preset`) and any
 * colour or font can be overridden there (`theme.colors`, `theme.fonts`).
 */
import rawConfig from "@project/config.json";

export type Palette = {
  bg: string; bgDeep: string; surface: string; surfaceAlt: string; line: string;
  ink: string; muted: string;
  accent: string; accentSoft: string; accentBright: string;
  secondary: string; secondarySoft: string;
  ok: string; okSoft: string; okDot: string;
  warn: string; warnSoft: string; warnDot: string;
  danger: string; dangerSoft: string;
  dark: string; darkDeep: string; onDark: string; onDarkMuted: string;
  gold: string; goldSoft: string;
  white: string;
};

export type Fonts = { display: string; sans: string; mono: string };

export type ThemeConfig = {
  preset?: "paper" | "slate" | "snow";
  colors?: Partial<Palette>;
  fonts?: Partial<Fonts>;
  texture?: "dots" | "none";
  radius?: number;
};

const PRESETS: Record<NonNullable<ThemeConfig["preset"]>, Palette> = {
  paper: {
    bg: "#f7f2ea", bgDeep: "#efe6d8", surface: "#fffcf7", surfaceAlt: "#f3ebdf", line: "#e3d8c8",
    ink: "#2b2520", muted: "#6f655c",
    accent: "#b8512a", accentSoft: "#f8e3d8", accentBright: "#ff7a59",
    secondary: "#4c5fa8", secondarySoft: "#e5e9f7",
    ok: "#2f7d6d", okSoft: "#dff0ea", okDot: "#4fa391",
    warn: "#9a6a14", warnSoft: "#fbe8b3", warnDot: "#dfa032",
    danger: "#b3263d", dangerSoft: "#fbe1e6",
    dark: "#241f2e", darkDeep: "#191522", onDark: "#fff8f0", onDarkMuted: "rgb(255 248 240 / 62%)",
    gold: "#d3a65b", goldSoft: "#f3dfb9",
    white: "#ffffff",
  },
  slate: {
    bg: "#0f172a", bgDeep: "#0b1220", surface: "#1e293b", surfaceAlt: "#243247", line: "#334155",
    ink: "#e6edf7", muted: "#94a3b8",
    accent: "#38bdf8", accentSoft: "#0c3a56", accentBright: "#7dd3fc",
    secondary: "#a78bfa", secondarySoft: "#2e2456",
    ok: "#34d399", okSoft: "#0d3b2e", okDot: "#34d399",
    warn: "#fbbf24", warnSoft: "#3f2d08", warnDot: "#fbbf24",
    danger: "#f87171", dangerSoft: "#4a1d1d",
    dark: "#060a14", darkDeep: "#02040a", onDark: "#f1f5f9", onDarkMuted: "rgb(241 245 249 / 60%)",
    gold: "#fbbf24", goldSoft: "#5a3e0b",
    white: "#ffffff",
  },
  snow: {
    bg: "#ffffff", bgDeep: "#f1f5f9", surface: "#ffffff", surfaceAlt: "#f8fafc", line: "#e2e8f0",
    ink: "#0f172a", muted: "#64748b",
    accent: "#4f46e5", accentSoft: "#e0e7ff", accentBright: "#818cf8",
    secondary: "#0ea5e9", secondarySoft: "#e0f2fe",
    ok: "#15803d", okSoft: "#dcfce7", okDot: "#22c55e",
    warn: "#a16207", warnSoft: "#fef3c7", warnDot: "#f59e0b",
    danger: "#b91c1c", dangerSoft: "#fee2e2",
    dark: "#1e1b4b", darkDeep: "#141238", onDark: "#eef2ff", onDarkMuted: "rgb(238 242 255 / 62%)",
    gold: "#d97706", goldSoft: "#fde68a",
    white: "#ffffff",
  },
};

type Config = { theme?: ThemeConfig; brand?: { name?: string; logo?: string; logoDark?: string; url?: string; tagline?: string }; overlay?: { chapterTag?: boolean; progress?: boolean; chapterCount?: number }; subtitles?: { style?: "box" | "plain" } };
export const config = rawConfig as Config;

const themeConfig: ThemeConfig = config.theme ?? {};
export const PRESET = themeConfig.preset ?? "paper";
export const C: Palette = { ...PRESETS[PRESET], ...(themeConfig.colors ?? {}) };
export const F: Fonts = {
  sans: '"Inter Variable", Inter, system-ui, sans-serif',
  display: '"Fraunces Variable", Fraunces, Georgia, "Times New Roman", serif',
  mono: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace',
  ...(themeConfig.fonts ?? {}),
};
export const RADIUS = themeConfig.radius ?? 4;
export const TEXTURE = themeConfig.texture ?? (PRESET === "paper" ? "dots" : "none");
export const IS_DARK = PRESET === "slate";

/** Shadows: soft card shadow, and an offset "stamp" shadow for buttons and monograms. */
export const S = {
  card: `0 1px 0 rgb(0 0 0 / 4%), 0 9px 28px rgb(0 0 0 / ${IS_DARK ? 30 : 7}%)`,
  cardHigh: `0 2px 0 rgb(0 0 0 / 5%), 0 30px 70px rgb(0 0 0 / ${IS_DARK ? 45 : 16}%)`,
  stamp: (n = 3, a = 0.22) => `${n}px ${n}px 0 rgb(0 0 0 / ${a * 100}%)`,
  window: `0 40px 90px rgb(0 0 0 / ${IS_DARK ? 50 : 22}%), 0 8px 24px rgb(0 0 0 / 10%)`,
} as const;

/** Dotted paper texture. */
export const paperTexture = (opacity = 44) =>
  TEXTURE === "none" ? "none" : `radial-gradient(circle at 18% 17%, rgb(255 255 255 / ${opacity}%) 0 1px, transparent 1.4px) 0 0 / 15px 15px`;

export type Tone = "ok" | "danger" | "warn" | "neutral" | "accent" | "secondary" | "gold";

export const TONES: Record<Tone, { fg: string; bg: string; dot: string }> = {
  ok: { fg: C.ok, bg: C.okSoft, dot: C.okDot },
  danger: { fg: C.danger, bg: C.dangerSoft, dot: C.danger },
  warn: { fg: C.warn, bg: C.warnSoft, dot: C.warnDot },
  neutral: { fg: C.muted, bg: C.surfaceAlt, dot: C.line },
  accent: { fg: C.accent, bg: C.accentSoft, dot: C.accent },
  secondary: { fg: C.secondary, bg: C.secondarySoft, dot: C.secondary },
  gold: { fg: C.ink, bg: C.goldSoft, dot: C.gold },
};

/** Safe margins (px) of the 1920×1080 frame. */
export const SAFE = { x: 96, y: 64 } as const;
