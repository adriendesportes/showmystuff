/** Two columns (before / after, without / with). */
import { AbsoluteFill, useCurrentFrame } from "../engine/frame";
import { ease, prog } from "../engine/anim";
import { useAt, type At } from "../engine/timeline";
import { Background, DisplayTitle, Eyebrow, Icon } from "../ds/base";
import { C, F, SAFE, TONES, type Tone } from "../ds/tokens";

type Column = { title: string; items: string[]; tone?: Tone; icon?: string; at?: At };

function Col({ col, start, strike }: { col: Column; start: number; strike: boolean }) {
  const f = useCurrentFrame();
  const t = TONES[col.tone ?? (strike ? "danger" : "ok")];
  const p = prog(f, start, 22, ease.out);
  return (
    <div style={{ flex: 1, padding: 40, background: C.surface, border: `1px solid ${C.line}`, borderTop: `6px solid ${t.dot}`, borderRadius: 6, boxShadow: "6px 6px 0 rgb(0 0 0 / 6%)", opacity: p, transform: `translateY(${(1 - p) * 30}px)` }}>
      <div style={{ font: `500 17px/1 ${F.mono}`, letterSpacing: "0.14em", textTransform: "uppercase", color: t.fg }}>{col.title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 34 }}>
        {(col.items ?? []).map((it, i) => {
          const pi = prog(f, start + 14 + i * 9, 18, ease.out);
          const ps = strike ? prog(f, start + 30 + i * 9, 16, ease.smooth) : 0;
          return (
            <div key={i} style={{ display: "flex", gap: 16, alignItems: "flex-start", opacity: pi, transform: `translateX(${(1 - pi) * -12}px)` }}>
              <Icon name={col.icon ?? (strike ? "x" : "check")} size={26} color={t.fg} strokeWidth={2.2} style={{ marginTop: 5 }} />
              <div style={{ position: "relative", font: `500 29px/1.35 ${F.sans}`, color: strike ? C.muted : C.ink }}>
                {it}
                {strike && <div style={{ position: "absolute", left: 0, top: "52%", height: 3, width: `${ps * 100}%`, background: t.dot }} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Compare({ eyebrow, title, left = { title: "Before", items: [] }, right = { title: "After", items: [] }, at: start, strikeLeft = true }: { eyebrow?: string; title?: string; left: Column; right: Column; at?: At; strikeLeft?: boolean }) {
  const at = useAt();
  const t0 = at(start, 12);
  return (
    <AbsoluteFill>
      <Background />
      <div style={{ position: "absolute", left: SAFE.x, right: SAFE.x, top: 96 }}>
        {eyebrow && <Eyebrow at={2}>{eyebrow}</Eyebrow>}
        {title && <DisplayTitle at={8} size={72} style={{ marginTop: 20 }}>{title}</DisplayTitle>}
        <div style={{ display: "flex", gap: 48, marginTop: title ? 56 : 30 }}>
          <Col col={left} start={at(left.at, t0)} strike={strikeLeft} />
          <Col col={right} start={at(right.at, t0 + 30)} strike={false} />
        </div>
      </div>
    </AbsoluteFill>
  );
}
