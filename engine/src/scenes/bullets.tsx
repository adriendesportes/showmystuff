/** Headline + list of points revealed on cues (or cascaded). */
import { AbsoluteFill, useCurrentFrame } from "../engine/frame";
import { clamp, ease, prog } from "../engine/anim";
import { useAt, type At } from "../engine/timeline";
import { Background, DisplayTitle, Eyebrow, Icon } from "../ds/base";
import { C, F, SAFE } from "../ds/tokens";

type Item = { text: string; detail?: string; icon?: string; at?: At };

export function Bullets({ eyebrow, title, items, accent, layout = "list", start = 0.4, every = 0.9 }: { eyebrow?: string; title?: string; items: Item[]; accent?: string[]; layout?: "list" | "grid"; start?: number; every?: number }) {
  const f = useCurrentFrame();
  const at = useAt();
  const times = items.map((it, i) => at(it.at, at(start) + i * at(every)));
  const grid = layout === "grid";
  return (
    <AbsoluteFill>
      <Background />
      <div style={{ position: "absolute", left: SAFE.x, top: 110, right: SAFE.x }}>
        {eyebrow && <Eyebrow at={4}>{eyebrow}</Eyebrow>}
        {title && <DisplayTitle at={10} size={grid ? 72 : 80} accent={accent} style={{ marginTop: 22, maxWidth: 1500 }}>{title}</DisplayTitle>}
        <div style={{ display: grid ? "grid" : "flex", gridTemplateColumns: grid ? "repeat(auto-fit, minmax(380px, 1fr))" : undefined, flexDirection: "column", gap: grid ? 28 : 22, marginTop: title ? 64 : 40, maxWidth: grid ? 1728 : 1300 }}>
          {items.map((it, i) => {
            const p = prog(f, times[i], 20, ease.out);
            const trace = prog(f, times[i] + 4, 22, ease.smooth);
            return (
              <div key={i} style={{ display: "flex", gap: 22, alignItems: "flex-start", opacity: p, transform: `translateX(${(1 - p) * -18}px)`, padding: grid ? 26 : 0, background: grid ? C.surface : "transparent", border: grid ? `1px solid ${C.line}` : "none", borderRadius: 6, boxShadow: grid ? "4px 4px 0 rgb(0 0 0 / 6%)" : "none" }}>
                <div style={{ display: "grid", placeItems: "center", width: 52, height: 52, borderRadius: "50%", background: C.accentSoft, color: C.accent, flex: "0 0 auto" }}>
                  <Icon name={it.icon ?? "check"} size={28} trace={trace} strokeWidth={2} />
                </div>
                <div>
                  <div style={{ font: `600 ${grid ? 28 : 34}px/1.3 ${F.sans}`, color: C.ink }}>{it.text}</div>
                  {it.detail && <div style={{ marginTop: 6, font: `400 ${grid ? 20 : 24}px/1.45 ${F.sans}`, color: C.muted, opacity: clamp(p * 1.2) }}>{it.detail}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}
