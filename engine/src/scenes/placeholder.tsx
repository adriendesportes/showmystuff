import { AbsoluteFill, useCurrentFrame } from "../engine/frame";
import { useScene } from "../engine/timeline";
import { C, F } from "../ds/tokens";

/** Fallback scene: shows the scene id and the word being spoken, to time the edit. */
export function Placeholder() {
  const frame = useCurrentFrame();
  const s = useScene();
  const word = [...s.words].reverse().find((m) => frame >= m.f);
  return (
    <AbsoluteFill style={{ background: C.bg, alignItems: "center", justifyContent: "center", gap: 24 }}>
      <div style={{ font: `500 22px/1 ${F.mono}`, letterSpacing: "0.15em", textTransform: "uppercase", color: C.muted }}>
        {s.id} · {s.component}
      </div>
      <div style={{ font: `700 72px/1.1 ${F.display}`, color: C.ink }}>{word?.t ?? "…"}</div>
      <div style={{ font: `400 18px/1 ${F.mono}`, color: C.muted, fontVariantNumeric: "tabular-nums" }}>
        {frame} / {s.duration}
      </div>
    </AbsoluteFill>
  );
}
