import { useCurrentFrame } from "../engine/frame";
import { ease, lerp, prog } from "../engine/anim";
import { timeline } from "../engine/timeline";
import { C, F, config } from "./tokens";

/** Curtain sweeping the screen: covers the outgoing scene, then reveals the incoming one. */
export function Curtain({ p }: { p: number }) {
  const cover = p < 0.5 ? ease.smooth(p * 2) : 1 - ease.smooth((p - 0.5) * 2);
  const fromLeft = p < 0.5;
  const width = cover * 100;
  return (
    <div style={{ position: "absolute", top: 0, bottom: 0, left: fromLeft ? 0 : `${100 - width}%`, width: `${width}%`, background: `linear-gradient(165deg, ${C.dark}, ${C.darkDeep})` }}>
      <div style={{ position: "absolute", top: 0, bottom: 0, [fromLeft ? "right" : "left"]: 0, width: 5, background: `linear-gradient(180deg, ${C.accentBright}, ${C.accent})` }} />
    </div>
  );
}

const NO_TAG = new Set(["Chapter", "Title", "Outro"]);

/**
 * Global overlay: chapter tag (mono, top left) on content scenes and a 4 px
 * progress bar at the bottom that advances one notch per chapter.
 */
export function Overlay() {
  const f = useCurrentFrame();
  const show = config.overlay ?? {};
  const withTag = show.chapterTag !== false;
  const withBar = show.progress !== false;
  const scenes = timeline.scenes;
  const i = scenes.findLastIndex((s) => f >= s.start);
  if (i < 0) return null;
  const sc = scenes[i];
  const nChapters = show.chapterCount ?? Math.max(1, timeline.chapters.length);

  const started = timeline.chapters.filter((c) => c.start <= f).sort((a, b) => a.start - b.start);
  const current = started.at(-1);
  let bar = 0;
  if (current) {
    const p = prog(f, current.start + 6, 18, ease.smooth);
    bar = lerp((current.num - 1) / nChapters, current.num / nChapters, p);
  }
  const endBar = sc.component === "Outro" ? 1 - prog(f, sc.start + 10, 20, ease.in) : 1;

  const chap = timeline.chapters.find((c) => c.num === sc.chapter);
  const tagOk = withTag && !!chap && !NO_TAG.has(sc.component);
  const prev = scenes[i - 1];
  const prevTag = prev && prev.chapter === sc.chapter && !NO_TAG.has(prev.component);
  const aTag = tagOk ? (prevTag ? 1 : prog(f, sc.start + sc.transition.frames, 16, ease.out)) : 0;

  return (
    <>
      {aTag > 0 && chap && (
        <div style={{ position: "absolute", left: 40, top: 26, display: "flex", alignItems: "center", gap: 12, padding: "9px 14px 9px 12px", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 3, boxShadow: "3px 3px 0 rgb(0 0 0 / 8%)", opacity: aTag, transform: `translateY(${(1 - aTag) * -8}px)`, zIndex: 50 }}>
          <span style={{ font: `600 14px/1 ${F.mono}`, letterSpacing: "0.14em", color: C.accent }}>{String(chap.num).padStart(2, "0")}</span>
          <span style={{ width: 18, height: 1, background: C.line }} />
          <span style={{ font: `500 14px/1 ${F.mono}`, letterSpacing: "0.14em", textTransform: "uppercase", color: C.muted }}>{chap.title}</span>
        </div>
      )}
      {withBar && bar > 0 && (
        <div style={{ position: "absolute", left: 0, bottom: 0, height: 4, width: `${bar * 100}%`, background: `linear-gradient(90deg, ${C.secondary}, ${C.accent} 70%, ${C.accentBright})`, opacity: endBar }} />
      )}
    </>
  );
}
