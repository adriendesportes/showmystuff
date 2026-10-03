/**
 * Access to the project's screenshots (public/captures/*.png + captures.json written by `sms capture`).
 * Coordinates are CSS px relative to the TOP of the captured page.
 */
import index from "@project/captures.json";

export type Rect = { x: number; y: number; w: number; h: number };

export type Capture = {
  id: string;
  url?: string;
  title?: string;
  width: number;
  viewportHeight: number;
  pageHeight: number;
  scale?: number;
  frames: Record<string, Rect>;
  file?: string;
};

const ENTRIES = new Map((index as unknown as Capture[]).map((e) => [e.id, e]));

export function hasCapture(id: string): boolean {
  return ENTRIES.has(id);
}

export function capture(id: string): Capture & { src: string } {
  const e = ENTRIES.get(id);
  if (!e) throw new Error(`Unknown capture "${id}" (see public/captures/captures.json)`);
  return { ...e, src: `/captures/${e.file ?? `${id}.png`}` };
}

/** Named frame of a capture (explicit error if missing). */
export function frame(id: string, name: string): Rect {
  const r = capture(id).frames?.[name];
  if (!r) throw new Error(`Frame "${name}" not found in capture "${id}"`);
  return r;
}

/** Grows a rect by `m` px on each side. */
export function pad(r: Rect, m: number): Rect {
  return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };
}

/** Centre of a rect (cursor target). */
export function centre(r: Rect, dx = 0, dy = 0) {
  return { x: r.x + r.w / 2 + dx, y: r.y + r.h / 2 + dy };
}
