import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "./engine/frame";
import { clamp, ease } from "./engine/anim";
import { SceneProvider, timeline, type SceneTimeline, type TransitionType } from "./engine/timeline";
import { SCENES, Placeholder } from "./scenes";
import { Curtain, Overlay } from "./ds/overlay";
import { Subtitles } from "./ds/subtitles";
import { C } from "./ds/tokens";

/** Styles of a scene during its incoming transition (p from 0 to 1). */
function enterStyle(type: TransitionType, p: number): CSSProperties {
  const e = ease.out(p);
  switch (type) {
    case "fade":
      return { opacity: ease.smooth(p) };
    case "slide":
      return { transform: `translateX(${(1 - e) * 100}%)`, boxShadow: "-8px 0 0 rgb(0 0 0 / 10%)" };
    case "zoom":
      return { opacity: ease.smooth(p), transform: `scale(${0.98 + 0.02 * e})` };
    case "wipe":
      return { clipPath: `inset(0 ${(1 - ease.smooth(p)) * 100}% 0 0)` };
    case "curtain":
      return { opacity: p >= 0.5 ? 1 : 0 };
    default:
      return {};
  }
}

/** Styles of the outgoing scene during the next one's transition. */
function exitStyle(type: TransitionType, p: number): CSSProperties {
  const e = ease.smooth(p);
  switch (type) {
    case "slide":
      return { transform: `translateX(${-e * 12}%)`, opacity: 1 - 0.5 * e };
    case "zoom":
      return { transform: `scale(${1 + 0.04 * e})`, opacity: 1 - e };
    case "wipe":
      return { transform: `translateX(${-e * 6}%)` };
    case "curtain":
      return { opacity: p < 0.5 ? 1 : 0 };
    default:
      return {};
  }
}

function RenderedScene({ scene, next }: { scene: SceneTimeline; next?: SceneTimeline }) {
  const frame = useCurrentFrame();
  const local = frame - scene.start;
  let style: CSSProperties = {};
  const T = scene.transition.frames;
  if (T > 0 && local < T) style = { ...style, ...enterStyle(scene.transition.type, clamp(local / T)) };
  if (next && next.transition.frames > 0 && frame >= next.start) {
    const p = clamp((frame - next.start) / next.transition.frames);
    style = { ...style, ...exitStyle(next.transition.type, p) };
  }
  const Component = SCENES[scene.component] ?? Placeholder;
  return (
    <Sequence from={scene.start} durationInFrames={scene.duration} style={{ overflow: "hidden", willChange: "transform, opacity", ...style }}>
      <SceneProvider value={scene}>
        <Component {...(scene.props ?? {})} />
      </SceneProvider>
    </Sequence>
  );
}

/** Wipe edge: accent rule accompanying the reveal. */
function WipeEdge({ p }: { p: number }): ReactNode {
  const x = ease.smooth(p) * 100;
  return <div style={{ position: "absolute", top: 0, bottom: 0, left: `calc(${x}% - 3px)`, width: 6, background: `linear-gradient(180deg, ${C.accentBright}, ${C.accent})`, opacity: p > 0.02 && p < 0.98 ? 1 : 0 }} />;
}

export function Video() {
  const frame = useCurrentFrame();
  const scenes = timeline.scenes;
  const active: ReactNode[] = [];
  const overlays: ReactNode[] = [];
  scenes.forEach((s, i) => {
    if (frame < s.start || frame >= s.start + s.duration) return;
    active.push(<RenderedScene key={s.id} scene={s} next={scenes[i + 1]} />);
    const T = s.transition.frames;
    const local = frame - s.start;
    if (T > 0 && local < T) {
      const p = clamp(local / T);
      if (s.transition.type === "wipe") overlays.push(<WipeEdge key={`w-${s.id}`} p={p} />);
      if (s.transition.type === "curtain") overlays.push(<Curtain key={`c-${s.id}`} p={p} />);
    }
  });
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      {active}
      {overlays}
      <Overlay />
      <Subtitles />
    </AbsoluteFill>
  );
}
