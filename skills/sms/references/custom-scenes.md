# Custom scenes

Create `<project>/scenes/index.tsx` exporting `SCENES`. Each component receives the scene `props`.

```tsx
import { AbsoluteFill, useCurrentFrame, useSequenceDuration } from "@sms/engine/frame";
import { useAt, useScene } from "@sms/engine/timeline";
import { clamp, ease, prog, spring, interpolate } from "@sms/engine/anim";
import { Background, DarkPanel, DisplayTitle, Eyebrow, Text, Chip, Card, Icon, Counter, Appear } from "@sms/ds/base";
import { Screen } from "@sms/ds/screen";                 // the window + camera component
import { capture, frame, pad, centre } from "@sms/ds/captures";
import { Doc, Stamp, Notification, Avatar } from "@sms/ds/illustrations";
import { StepStrip } from "@sms/ds/steps";
import { C, F, S, TONES } from "@sms/ds/tokens";

export function Metric({ label, value }: { label: string; value: number }) {
  const f = useCurrentFrame();
  const at = useAt();
  const t0 = at("cue:number", 20);
  return (
    <AbsoluteFill>
      <Background />
      <div style={{ position: "absolute", left: 96, top: 320 }}>
        <Eyebrow at={6}>{label}</Eyebrow>
        <div style={{ font: `700 220px/1 ${F.display}`, color: C.ink, opacity: prog(f, t0, 20, ease.out) }}>
          <Counter value={value} at={t0} duration={40} />
        </div>
      </div>
    </AbsoluteFill>
  );
}

export const SCENES = { Metric };
```

Principles
- Everything is a pure function of `useCurrentFrame()`; no CSS animation, no timers, no `Math.random()`
  (use `random(seed)` / `noise1(x, seed)` from `@sms/engine/anim`).
- Use `useAt()` for every timing so the scene follows the voice when the text changes.
- `prog(f, start, duration, easing)` → 0..1; `spring({ frame: f - at, config: { damping: 18 } })`.
- Images: use `Img` from `@sms/engine/frame` (it holds the frame until decoded).
- Safe area: 96 px left/right, 64 px top/bottom. Fonts and colours: `F`, `C` from tokens.
- Type-check with the project `tsconfig.json` (`npx tsc -p <project>` from the engine folder) or just
  `sms stills --scene <id> --every 0.5 --sheet` and look.
