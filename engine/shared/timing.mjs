/**
 * Time expressions shared by the timeline builder (Node) and the renderer (browser).
 *
 * An `at` value is either a number of seconds from the start of the scene, or a string:
 *   "cue:name"        the frame where the voice says the word that follows {{name}}
 *   "cue:name+0.5"    …plus 0.5 s (or "-0.3")
 *   "voice"           when the voice starts (same offsets allowed)
 *   "start" | "end"   first / last frame of the scene (same offsets allowed)
 * Resolution returns frames relative to the scene start.
 */
const EXPR = /^(cue:([\w-]+)|voice|end|start)\s*([+-]\s*\d+(?:\.\d+)?)?$/;

/**
 * @param {number|string|undefined} at
 * @param {{fps:number, cues:Record<string,number>, duration:number, voiceStart:number, id?:string}} ctx
 * @param {{fallback?:number, warn?:(m:string)=>void}} [opts]
 */
export function resolveAt(at, ctx, opts = {}) {
  const warn = opts.warn ?? (() => {});
  if (at === undefined || at === null) return opts.fallback ?? 0;
  if (typeof at === "number") return Math.round(at * ctx.fps);
  const m = EXPR.exec(String(at).trim());
  if (!m) {
    warn(`${ctx.id ?? "scene"}: unreadable time expression "${at}"`);
    return opts.fallback ?? 0;
  }
  const offset = m[3] ? Math.round(Number(m[3].replace(/\s+/g, "")) * ctx.fps) : 0;
  if (m[2]) {
    const f = ctx.cues[m[2]];
    if (f === undefined) {
      warn(`${ctx.id ?? "scene"}: cue {{${m[2]}}} not found in the text`);
      return (opts.fallback ?? 0) + offset;
    }
    return f + offset;
  }
  if (m[1] === "voice") return ctx.voiceStart + offset;
  if (m[1] === "end") return ctx.duration + offset;
  return offset;
}

/** True when `at` refers to a cue that exists (useful to validate a scenario). */
export function cueName(at) {
  if (typeof at !== "string") return null;
  const m = EXPR.exec(at.trim());
  return m && m[2] ? m[2] : null;
}
