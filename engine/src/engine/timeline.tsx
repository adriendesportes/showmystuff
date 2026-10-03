import { createContext, useContext } from "react";
import data from "@project/timeline.json";
import { resolveAt } from "../../shared/timing.mjs";

export type TransitionType = "cut" | "fade" | "slide" | "zoom" | "wipe" | "curtain";

export type Word = { f: number; d: number; t: string };

export type SceneTimeline = {
  id: string;
  component: string;
  /** Absolute start frame. */
  start: number;
  /** Duration in frames (including the overlap of the incoming transition). */
  duration: number;
  /** Incoming transition: overlaps the end of the previous scene. */
  transition: { type: TransitionType; frames: number };
  /** Voice-over, in frames relative to the scene start. */
  voice: { start: number; duration: number } | null;
  /** Cues placed in the text ({{name}}), in frames relative to the scene start. */
  cues: Record<string, number>;
  /** Timed words (frames relative to the scene start). */
  words: Word[];
  chapter: number | null;
  props?: Record<string, unknown>;
};

export type Chapter = { num: number; title: string; start: number; end: number };

export type Timeline = {
  fps: number;
  width: number;
  height: number;
  totalFrames: number;
  scenes: SceneTimeline[];
  chapters: Chapter[];
};

export const timeline = data as unknown as Timeline;

const SceneContext = createContext<SceneTimeline | null>(null);
export const SceneProvider = SceneContext.Provider;

export function useScene(): SceneTimeline {
  const s = useContext(SceneContext);
  if (!s) throw new Error("useScene outside of a scene");
  return s;
}

const warned = new Set<string>();
function warnOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

/** Frame (relative to the scene) where the voice says the cue `{{name}}`; `fallback` if absent. */
export function useCue(name: string, fallback = 0): number {
  const s = useScene();
  const v = s.cues[name];
  if (v === undefined) {
    warnOnce(`${s.id}:${name}`, `Missing cue: ${s.id} → {{${name}}}`);
    return fallback;
  }
  return v;
}

/** All cues of the scene, with fallbacks. */
export function useCues<T extends string>(names: Record<T, number>): Record<T, number> {
  const s = useScene();
  const res = {} as Record<T, number>;
  for (const k of Object.keys(names) as T[]) res[k] = s.cues[k] ?? names[k];
  return res;
}

export type At = number | string | undefined;

/**
 * Resolves time expressions of the scene's props ("cue:name+0.5", "end-1", seconds…) into frames.
 * Returns a function so that a scene can resolve many values cheaply.
 */
export function useAt(): (at: At, fallback?: number) => number {
  const s = useScene();
  const ctx = { fps: timeline.fps, cues: s.cues, duration: s.duration, voiceStart: s.voice?.start ?? 0, id: s.id };
  return (at, fallback = 0) => resolveAt(at, ctx, { fallback, warn: (m: string) => warnOnce(`${s.id}:${String(at)}`, m) });
}
