/** Burned-in subtitles (enabled by ?subtitles=1). */
import { useCurrentFrame } from "../engine/frame";
import { ease, prog } from "../engine/anim";
import { timeline } from "../engine/timeline";
import cues from "@project/subtitles.json";
import { C, F, IS_DARK } from "./tokens";

type Cue = { start: number; end: number; lines: string[] };
const ACTIVE = typeof location !== "undefined" && new URLSearchParams(location.search).has("subtitles");
const DARK_SCENES = new Set(["Chapter", "Title", "Outro"]);

export function Subtitles() {
  const f = useCurrentFrame();
  if (!ACTIVE) return null;
  const r = (cues as Cue[]).find((x) => f >= x.start && f < x.end);
  if (!r) return null;
  const sc = timeline.scenes.findLast((s) => f >= s.start);
  const dark = IS_DARK || (sc ? DARK_SCENES.has(sc.component) : false);
  const a = prog(f, r.start, 4, ease.out) * (1 - prog(f, r.end - 4, 4, ease.in));
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 64, display: "flex", justifyContent: "center", opacity: a }}>
      <div
        style={{
          maxWidth: 1180,
          padding: "10px 18px",
          borderRadius: 3,
          textAlign: "center",
          font: `500 33px/1.35 ${F.sans}`,
          color: dark ? "#ffffff" : C.ink,
          background: dark ? "rgb(0 0 0 / 70%)" : "rgb(255 255 255 / 94%)",
          border: dark ? "1px solid rgb(255 255 255 / 10%)" : `1px solid ${C.line}`,
        }}
      >
        {r.lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}
