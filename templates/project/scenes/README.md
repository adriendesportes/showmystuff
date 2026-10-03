# Custom scenes (optional)

Create `scenes/index.tsx` exporting a `SCENES` record to add your own React scenes.
The key is the `component` name used in `scenario.json`; props come from the scene's `props`.

```tsx
import { AbsoluteFill, useCurrentFrame } from "@sms/engine/frame";
import { useAt } from "@sms/engine/timeline";
import { Background, DisplayTitle, Eyebrow } from "@sms/ds/base";
import { prog, ease } from "@sms/engine/anim";

export function Hello({ title = "Hello" }: { title?: string }) {
  const f = useCurrentFrame();           // frame relative to the scene
  const at = useAt();                     // resolves "cue:name+0.5", "end-1", seconds → frames
  const p = prog(f, at("cue:go", 20), 24, ease.out);
  return (
    <AbsoluteFill>
      <Background />
      <Eyebrow at={4} style={{ position: "absolute", left: 96, top: 72 }}>Custom scene</Eyebrow>
      <DisplayTitle at={10} style={{ position: "absolute", left: 96, top: 300, opacity: p }}>{title}</DisplayTitle>
    </AbsoluteFill>
  );
}

export const SCENES = { Hello };
```

Rules: every value must be a pure function of the current frame (no CSS transitions,
no timers, no randomness without a seed). Use `useAt()` so that timings follow the voice
when the text changes. The design system lives in `@sms/ds/*` (base, screen, illustrations,
steps, chapter, tokens).
