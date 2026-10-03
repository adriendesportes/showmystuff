/** Step strip: past steps in gold, current step in accent with a ripple, future steps hollow. */
import type { CSSProperties } from "react";
import { useCurrentFrame } from "../engine/frame";
import { ease, lerp, prog } from "../engine/anim";
import { C, F } from "./tokens";

export function StepStrip({
  steps,
  current,
  from,
  at = 0,
  dark = true,
  width = 1500,
  style,
}: {
  steps: string[];
  /** Index of the highlighted step. */
  current: number;
  /** Start index of the progression (animates from `from` to `current`). */
  from?: number;
  at?: number;
  dark?: boolean;
  width?: number;
  style?: CSSProperties;
}) {
  const f = useCurrentFrame();
  const n = steps.length;
  const gap = n > 1 ? width / (n - 1) : width;
  const pLine = prog(f, at, 40, ease.smooth);
  const pMove = prog(f, at + 18, 34, ease.smooth);
  const position = lerp(from ?? current, current, pMove);
  const line = dark ? "rgb(255 255 255 / 16%)" : C.line;
  const text = dark ? "rgb(255 255 255 / 46%)" : C.muted;
  const textActive = dark ? C.onDark : C.ink;
  return (
    <div style={{ position: "relative", width, height: 110, ...style }}>
      <div style={{ position: "absolute", left: 0, top: 22, height: 2, width: width * pLine, background: line }} />
      <div style={{ position: "absolute", left: 0, top: 21, height: 4, width: Math.max(0, position * gap) * pLine, background: `linear-gradient(90deg, ${C.gold}, ${C.accentBright})` }} />
      {steps.map((e, i) => {
        const pi = prog(f, at + 4 + i * 3, 20, ease.out);
        const past = i < position - 0.02;
        const now = Math.abs(i - current) < 0.01 && pMove > 0.85;
        const x = i * gap;
        const r = now ? 13 : 8;
        const cycle = ((f - at) % 48) / 48;
        return (
          <div key={e} style={{ position: "absolute", left: x, top: 0, width: 0, opacity: pi }}>
            {now && (
              <div style={{ position: "absolute", left: -24 * (1 + cycle), top: 23 - 24 * (1 + cycle), width: 48 * (1 + cycle), height: 48 * (1 + cycle), borderRadius: "50%", border: `2px solid ${C.accentBright}`, opacity: (1 - cycle) * 0.6 }} />
            )}
            <div style={{ position: "absolute", left: -r, top: 23 - r, width: 2 * r, height: 2 * r, borderRadius: "50%", background: now ? C.accentBright : past ? C.gold : dark ? C.darkDeep : C.bg, border: `2px solid ${now ? C.accentBright : past ? C.gold : line}`, transform: `scale(${0.4 + 0.6 * pi})` }} />
            <div style={{ position: "absolute", top: 52, left: -gap / 2, width: gap, textAlign: "center", font: `${now ? 600 : 500} ${now ? 17 : 15}px/1.25 ${F.mono}`, letterSpacing: "0.1em", textTransform: "uppercase", color: now ? textActive : past ? (dark ? C.goldSoft : C.ink) : text, transform: `translateY(${(1 - pi) * 10}px)` }}>
              {e}
            </div>
          </div>
        );
      })}
    </div>
  );
}
