/**
 * Screen scene, fully data-driven from scenario.json props. Every `at`/`until`
 * accepts seconds or a time expression ("cue:name+0.5", "end-1"). Every target
 * accepts "frame:<name>" (a named frame of a capture), "window", or a rect.
 */
import type { ReactNode } from "react";
import { AbsoluteFill } from "../engine/frame";
import { useAt, type At } from "../engine/timeline";
import { Background, Eyebrow } from "../ds/base";
import { Screen as ScreenDemo, type CameraKey, type Callout, type CursorKey, type Rect, type ScrollKey, type Spotlight, type Typing, type View } from "../ds/screen";
import { capture, centre, hasCapture, pad } from "../ds/captures";
import { Notification } from "../ds/illustrations";
import type { Tone } from "../ds/tokens";

type Point = { x: number; y: number };
type Target = string | Rect;
type PointTarget = string | Point;

export type ScreenProps = {
  capture?: string;
  views?: { at: At; capture: string; fade?: number }[];
  url?: string | { at: At; url: string }[];
  camera?: { at: At; target?: Target | "window"; zoom?: number; duration?: number; fill?: number }[];
  scroll?: { at: At; y: number | string; duration?: number }[];
  cursor?: { at: At; target: PointTarget; click?: boolean; duration?: number; hidden?: boolean }[];
  spotlights?: { at: At; until?: At; target: Target; pad?: number; radius?: number }[];
  callouts?: { at: At; until?: At; anchor: PointTarget; title?: string; text: ReactNode; side?: Callout["side"]; distance?: number; width?: number; tone?: Callout["tone"] }[];
  typing?: { at: At; until?: At; target: Target; text: string; cps?: number; size?: number }[];
  notifications?: { at: At; until?: At; title: string; text?: string; tone?: Tone; icon?: string }[];
  enter?: "rise" | "none";
  exit?: At;
  background?: boolean;
  eyebrow?: string;
  width?: number;
  viewportHeight?: number;
};

export function Screen(props: ScreenProps) {
  const at = useAt();
  const viewsIn = props.views ?? (props.capture ? [{ at: 0, capture: props.capture }] : []);
  const ids = viewsIn.map((v) => v.capture).filter(hasCapture);
  const first = ids[0] ? capture(ids[0]) : null;
  const width = props.width ?? first?.width ?? 1440;
  const viewportHeight = props.viewportHeight ?? first?.viewportHeight ?? 900;

  const findFrame = (name: string): Rect => {
    for (const id of ids) {
      const r = capture(id).frames?.[name];
      if (r) return r;
    }
    throw new Error(`Frame "${name}" not found in captures ${ids.join(", ") || "(none)"}`);
  };
  const rect = (t: Target, margin = 0): Rect => (typeof t === "string" ? pad(findFrame(t.replace(/^frame:/, "")), margin) : pad(t, margin));
  const point = (t: PointTarget, side?: Callout["side"]): Point => {
    if (typeof t !== "string") return t;
    const r = findFrame(t.replace(/^frame:/, ""));
    if (side === "right") return { x: r.x + r.w, y: r.y + r.h / 2 };
    if (side === "left") return { x: r.x, y: r.y + r.h / 2 };
    if (side === "top") return { x: r.x + r.w / 2, y: r.y };
    if (side === "bottom") return { x: r.x + r.w / 2, y: r.y + r.h };
    return centre(r);
  };

  const views: View[] = viewsIn.map((v) => {
    const c = hasCapture(v.capture) ? capture(v.capture) : null;
    return { at: at(v.at), src: c?.src ?? `/captures/${v.capture}.png`, height: c?.pageHeight ?? viewportHeight, fade: v.fade };
  });
  const camera: CameraKey[] = (props.camera ?? []).map((k) => ({ at: at(k.at), target: !k.target || k.target === "window" ? "window" : rect(k.target), zoom: k.zoom, duration: k.duration, fill: k.fill }));
  const scroll: ScrollKey[] = (props.scroll ?? []).map((k) => ({ at: at(k.at), y: typeof k.y === "number" ? k.y : Math.max(0, rect(k.y).y - 40), duration: k.duration }));
  const cursor: CursorKey[] = (props.cursor ?? []).map((k) => ({ arrive: at(k.at), ...point(k.target), click: k.click, duration: k.duration, hidden: k.hidden }));
  const spotlights: Spotlight[] = (props.spotlights ?? []).map((k) => ({ at: at(k.at), until: k.until === undefined ? undefined : at(k.until), rect: rect(k.target, k.pad ?? 0), radius: k.radius }));
  const callouts: Callout[] = (props.callouts ?? []).map((k) => ({ at: at(k.at), until: k.until === undefined ? undefined : at(k.until), anchor: point(k.anchor, k.side ?? "right"), title: k.title, text: k.text, side: k.side, distance: k.distance, width: k.width, tone: k.tone }));
  const typing: Typing[] = (props.typing ?? []).map((k) => ({ at: at(k.at), until: k.until === undefined ? undefined : at(k.until), rect: rect(k.target), text: k.text, cps: k.cps, size: k.size }));
  const url = typeof props.url === "string" ? [{ at: 0, url: props.url }] : (props.url ?? []).map((u) => ({ at: at(u.at), url: u.url }));

  return (
    <AbsoluteFill>
      {props.background !== false && <Background />}
      {props.eyebrow && <Eyebrow at={10} style={{ position: "absolute", left: 96, top: 72 }}>{props.eyebrow}</Eyebrow>}
      <ScreenDemo width={width} viewportHeight={viewportHeight} views={views} camera={camera} scroll={scroll} cursor={cursor} spotlights={spotlights} callouts={callouts} typing={typing} url={url} enter={props.enter ?? "rise"} exit={props.exit === undefined ? undefined : at(props.exit)} />
      {(props.notifications ?? []).map((n, i) => (
        <Notification key={i} at={at(n.at)} until={n.until === undefined ? undefined : at(n.until)} title={n.title} text={n.text} tone={n.tone} icon={n.icon} />
      ))}
    </AbsoluteFill>
  );
}
