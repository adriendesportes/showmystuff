/** Numbered steps (a process), revealed one by one along a vertical line. */
import { AbsoluteFill, useCurrentFrame } from "../engine/frame";
import { ease, prog } from "../engine/anim";
import { useAt, type At } from "../engine/timeline";
import { Background, DisplayTitle, Eyebrow, Icon } from "../ds/base";
import { C, F, SAFE } from "../ds/tokens";

type Step = { title: string; text?: string; icon?: string; at?: At };

export function Steps({ eyebrow, title, steps = [], start = 0.5, every = 1.2, current }: { eyebrow?: string; title?: string; steps: Step[]; start?: number; every?: number; current?: number }) {
  const f = useCurrentFrame();
  const at = useAt();
  const times = steps.map((s, i) => at(s.at, at(start) + i * at(every)));
  const rowH = steps.length > 4 ? 128 : 160;
  return (
    <AbsoluteFill>
      <Background />
      <div style={{ position: "absolute", left: SAFE.x, right: SAFE.x, top: 96 }}>
        {eyebrow && <Eyebrow at={2}>{eyebrow}</Eyebrow>}
        {title && <DisplayTitle at={8} size={72} style={{ marginTop: 20 }}>{title}</DisplayTitle>}
        <div style={{ position: "relative", marginTop: title ? 54 : 30, paddingLeft: 24 }}>
          {steps.length > 1 && <div style={{ position: "absolute", left: 24 + 36, top: 36, width: 2, height: Math.max(0, (steps.length - 1) * rowH) * prog(f, times[0] + 10, times.at(-1)! - times[0] + 20, ease.linear), background: C.line }} />}
          {steps.map((s, i) => {
            const p = prog(f, times[i], 22, ease.out);
            const isCurrent = current === i;
            return (
              <div key={i} style={{ position: "relative", display: "flex", gap: 32, alignItems: "flex-start", height: rowH, opacity: p, transform: `translateX(${(1 - p) * -20}px)` }}>
                <div style={{ display: "grid", placeItems: "center", width: 72, height: 72, borderRadius: "50%", background: isCurrent ? C.accent : C.surface, color: isCurrent ? C.white : C.accent, border: `2px solid ${isCurrent ? C.accent : C.line}`, font: `700 30px/1 ${F.display}`, boxShadow: "4px 4px 0 rgb(0 0 0 / 8%)", flex: "0 0 auto", zIndex: 1 }}>
                  {s.icon ? <Icon name={s.icon} size={34} /> : i + 1}
                </div>
                <div style={{ paddingTop: 10 }}>
                  <div style={{ font: `600 ${steps.length > 4 ? 30 : 36}px/1.2 ${F.sans}`, color: C.ink }}>{s.title}</div>
                  {s.text && <div style={{ marginTop: 8, font: `400 ${steps.length > 4 ? 20 : 24}px/1.4 ${F.sans}`, color: C.muted, maxWidth: 1200 }}>{s.text}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}
