// Builds the timeline from the scenario and the voice durations.
//   Inputs : <project>/scenario.json, <project>/build/voice/<id>.json (when the voice exists)
//   Outputs: build/timeline.json (frames), build/subtitles.json (frames), out/subtitles.srt,
//            build/audio/timeline.json (seconds), build/audio/music-plan.json
//   node build-timeline.mjs [--project DIR] [--strict]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveAt, cueName } from "../shared/timing.mjs";
import { args, projectDir, readConfig } from "./lib.mjs";

const BUILTIN = new Set(["Title", "Chapter", "Screen", "Bullets", "Statement", "Compare", "Steps", "Outro", "Placeholder"]);
const TRANSITION_SFX = { slide: "whoosh", wipe: "whoosh", curtain: "whoosh", zoom: "whoosh-short" };

const a = args();
const project = projectDir(a);
const config = readConfig(project);
const scenarioPath = join(project, "scenario.json");
if (!existsSync(scenarioPath)) throw new Error(`Missing ${scenarioPath}`);
const scenario = JSON.parse(readFileSync(scenarioPath, "utf8"));
const FPS = Number(config.fps ?? 30);
const WIDTH = Number(config.width ?? 1920);
const HEIGHT = Number(config.height ?? 1080);
mkdirSync(join(project, "build/audio"), { recursive: true });
mkdirSync(join(project, "out"), { recursive: true });
const sec = (s) => Math.round(s * FPS);
const warnings = [];
const warn = (m) => { warnings.push(m); console.warn(`  ! ${m}`); };
const estimated = [];
const hasCustomScenes = ["scenes/index.tsx", "scenes/index.ts"].some((f) => existsSync(join(project, f)));

/** Estimated duration of a voice not synthesised yet (≈ 14 characters per second). */
function estimateVoice(text) {
  const clean = text.replace(/\{\{[^}]+\}\}/g, "").replace(/\[([^|\]]+)\|[^\]]*\]/g, "$1");
  const words = clean.split(/\s+/).filter(Boolean);
  const duration = clean.length / 14 + 0.3;
  const step = (duration - 0.2) / Math.max(1, words.length);
  const cues = {};
  const re = /\{\{([^}]+)\}\}/g;
  let m;
  while ((m = re.exec(text))) {
    const before = text.slice(0, m.index).replace(/\{\{[^}]+\}\}/g, "");
    cues[m[1].trim()] = (before.length / Math.max(1, clean.length)) * duration;
  }
  let t = 0.1;
  const res = { duration_s: duration, words: [], cues };
  for (const w of words) {
    res.words.push({ t, d: step * 0.9, text: w });
    t += step;
  }
  return res;
}

const ids = new Set();
const scenes = [];
let cursor = 0;
let intensity = 1;
const sfx = [];
const voice = [];
const sections = [];

for (const [i, s] of (scenario.scenes ?? []).entries()) {
  if (!s.id) throw new Error(`Scene #${i} has no id`);
  if (ids.has(s.id)) throw new Error(`Duplicate scene id: ${s.id}`);
  ids.add(s.id);
  const component = s.component ?? (s.text ? "Placeholder" : "Placeholder");
  if (!BUILTIN.has(component) && !hasCustomScenes) warn(`${s.id}: component "${component}" is not built in and the project has no scenes/index.tsx (a placeholder will be shown)`);
  const T = i === 0 ? 0 : sec(s.transition?.duration ?? 0);
  const start = Math.max(0, cursor - T);
  let v = null;
  if (s.text) {
    const file = join(project, "build/voice", `${s.id}.json`);
    if (existsSync(file)) v = JSON.parse(readFileSync(file, "utf8"));
    else {
      v = estimateVoice(s.text);
      estimated.push(s.id);
    }
  }
  const voiceStart = T + sec(s.before ?? 0.45);
  const duration = s.duration
    ? sec(s.duration)
    : Math.max(sec(s.minDuration ?? 2), v ? voiceStart + sec(v.duration_s) + sec(s.after ?? 0.7) : T + sec(2));
  const cues = {};
  if (v) for (const [k, t] of Object.entries(v.cues ?? {})) cues[k] = voiceStart + Math.round(t * FPS);
  const words = v ? v.words.map((m) => ({ f: voiceStart + Math.round(m.t * FPS), d: Math.max(1, Math.round(m.d * FPS)), t: m.text })) : [];
  const scene = {
    id: s.id,
    component,
    start,
    duration,
    transition: { type: i === 0 ? "cut" : s.transition?.type ?? "cut", frames: T },
    voice: v ? { start: voiceStart, duration: Math.round(v.duration_s * FPS) } : null,
    cues,
    words,
    chapter: s.chapter ?? null,
    props: s.props ?? {},
  };
  scenes.push(scene);
  if (v) voice.push({ id: s.id, file: `../voice/${s.id}.wav`, start_s: (start + voiceStart) / FPS, gain_db: s.voiceGain ?? 0 });

  // Validate the cue references used in props (recursively) and sfx.
  const ctx = { fps: FPS, cues, duration, voiceStart, id: s.id };
  const checkAt = (val, where) => {
    const c = cueName(val);
    if (c && cues[c] === undefined) warn(`${s.id}: ${where} refers to {{${c}}} which is not in the text`);
  };
  const walk = (o, path) => {
    if (Array.isArray(o)) o.forEach((x, k) => walk(x, `${path}[${k}]`));
    else if (o && typeof o === "object") for (const [k, x] of Object.entries(o)) {
      if ((k === "at" || k === "until" || k === "exit") && typeof x === "string") checkAt(x, `${path}.${k}`);
      else walk(x, `${path}.${k}`);
    }
  };
  walk(scene.props, "props");

  // Sound effects: times in seconds from the scene start, or relative to a cue.
  const type = scene.transition.type;
  if (T > 0 && s.transitionSfx !== false && TRANSITION_SFX[type]) {
    sfx.push({ type: TRANSITION_SFX[type], start_s: start / FPS, gain_db: -15 + (scenario.sfxGain ?? 0), pan: 0, scene: s.id });
  }
  for (const e of s.sfx ?? []) {
    checkAt(e.at, "sfx");
    const t0 = (start + resolveAt(e.at, ctx, { warn })) / FPS;
    if (e.n) {
      // Burst (keystrokes): alternates key-1 to key-4.
      for (let k = 0; k < e.n; k++) {
        const jitter = ((k * 37) % 7) / 7 - 0.5;
        sfx.push({ type: `${e.type}-${(k % 4) + 1}`, start_s: t0 + k * (e.interval ?? 0.07) * (1 + jitter * 0.3), gain_db: (e.gain ?? -18) - (k % 3) + (scenario.sfxGain ?? 0), pan: e.pan ?? 0, scene: s.id });
      }
    } else sfx.push({ type: e.type, start_s: t0, gain_db: (e.gain ?? -10) + (scenario.sfxGain ?? 0), pan: e.pan ?? 0, scene: s.id });
  }

  // Music: intensity per scene (inherited otherwise), accent on demand.
  if (s.music !== undefined) intensity = s.music;
  const last = sections.at(-1);
  if (last && last.intensity === intensity && !s.accent) last.end_s = (start + duration) / FPS;
  else sections.push({ start_s: start / FPS, end_s: (start + duration) / FPS, intensity, accent_start: !!s.accent });

  cursor = start + duration;
}

const totalFrames = cursor;
if (!totalFrames) throw new Error("Empty scenario: no scenes");
const chapters = (scenario.chapters ?? []).map((c) => {
  const own = scenes.filter((s) => s.chapter === c.num);
  return { num: c.num, title: c.title, start: own[0]?.start ?? 0, end: own.length ? Math.max(...own.map((s) => s.start + s.duration)) : 0 };
});
for (let i = 1; i < sections.length; i++) sections[i - 1].end_s = sections[i].start_s;

writeFileSync(join(project, "build/timeline.json"), JSON.stringify({ fps: FPS, width: WIDTH, height: HEIGHT, totalFrames, scenes, chapters }, null, 1));
const musicCfg = scenario.music ?? {};
writeFileSync(join(project, "build/audio/timeline.json"), JSON.stringify({ duration_s: totalFrames / FPS, voice, sfx, music: musicCfg.enabled === false ? null : { file: "music.wav", gain_db: musicCfg.gain_db ?? 0 } }, null, 1));
writeFileSync(join(project, "build/audio/music-plan.json"), JSON.stringify({ duration_s: totalFrames / FPS, bpm: musicCfg.bpm ?? 94, seed: musicCfg.seed ?? 3, sections }, null, 1));

// ---- Subtitles: optimal grouping of words into cues (≤ 2 lines of `maxChars`) ------------------
const MAX = Number(config.subtitles?.maxChars ?? 42);
const MIN_S = 1.0, MAX_S = 6.0, TRAIL_S = 0.25, GAP_S = 0.08;
const FUNCTION_WORDS = {
  en: "the a an and or of to in on at for with by from as is are was be that this these those it its his her their our your my we you they he she i not no but so if than then into over under up out off".split(" "),
  fr: "le la les l' un une des du de d' à au aux et ou en pour par sur dans avec sans que qu' qui ne n' se s' ce cet cette ces son sa ses leur leurs mon ma mes notre nos votre vos il elle on vous nous je j' y dont c' plus très ni mais puis".split(" "),
  es: "el la los las un una unos unas y o de del a en por para con sin que se su sus mi mis tu tus lo al es son no".split(" "),
  de: "der die das ein eine einer eines und oder von zu in im am an auf für mit ohne dass sich ist sind nicht wir ihr sie es ich du".split(" "),
  it: "il lo la i gli le un una uno e o di del della dei delle a al alla in con per su che si non è sono".split(" "),
  pt: "o a os as um uma uns umas e ou de do da dos das em no na nos nas para por com sem que se é são não".split(" "),
};
const lang = String(scenario.language ?? config.language ?? "en").slice(0, 2).toLowerCase();
const FW = new Set(FUNCTION_WORDS[lang] ?? []);
const nu = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}'’]/gu, "").replace(/’/g, "'");
const endsSentence = (w) => /[.!?…][\s»”)"]*$/.test(w);
function cutCost(word, line) {
  const m = word.trimEnd();
  let c;
  if (endsSentence(m)) c = 0;
  else if (/[:;][\s»”)"]*$/.test(m)) c = line ? 0.5 : 1;
  else if (/[,—–][\s»”)"]*$/.test(m)) c = line ? 1 : 2;
  else c = line ? 3 : 5;
  if (FW.has(nu(m)) || nu(m).endsWith("'")) c += 4;
  return c;
}
function splitLines(texts) {
  const all = texts.join(" ");
  if (all.length <= MAX) return [[all], 0];
  let best = null;
  for (let k = 1; k < texts.length; k++) {
    const l1 = texts.slice(0, k).join(" ");
    const l2 = texts.slice(k).join(" ");
    if (l1.length > MAX || l2.length > MAX) continue;
    const c = Math.abs(l1.length - l2.length) / 10 + cutCost(texts[k - 1], true);
    if (!best || c < best[1]) best = [[l1, l2], c];
  }
  return best;
}
function segment(words) {
  const n = words.length;
  const best = Array(n + 1).fill(Infinity);
  const prev = Array(n + 1).fill(null);
  best[0] = 0;
  for (let i = 0; i < n; i++) {
    if (best[i] === Infinity) continue;
    for (let j = i + 1; j <= Math.min(n, i + 30); j++) {
      const g = words.slice(i, j);
      const start = g[0].t;
      const end = g.at(-1).t + g.at(-1).d;
      if (end - start > MAX_S && j > i + 1) break;
      const lines = splitLines(g.map((m) => m.text));
      if (!lines) break;
      let cost = 1 + lines[1];
      if (j < n) {
        cost += cutCost(g.at(-1).text, false);
        cost -= 2.5 * Math.min(Math.max(words[j].t - end, 0), 0.6);
        if (g.map((m) => m.text).join(" ").length < 14) cost += 1.5;
      }
      if (end - start < MIN_S) cost += 4 * (MIN_S - (end - start));
      for (let k = 0; k < g.length - 1; k++) {
        if (endsSentence(g[k].text)) {
          const firstLineEnd = lines[0].length === 2 && lines[0][0].endsWith(g[k].text) && g.slice(0, k + 1).map((x) => x.text).join(" ").length === lines[0][0].length;
          cost += firstLineEnd ? 1 : 2.5;
        }
      }
      if (best[i] + cost < best[j]) {
        best[j] = best[i] + cost;
        prev[j] = [i, lines[0]];
      }
    }
  }
  const out = [];
  let j = n;
  while (j > 0) {
    const [i, lines] = prev[j];
    out.push({ start: words[i].t, speechEnd: words[j - 1].t + words[j - 1].d, lines });
    j = i;
  }
  return out.reverse();
}
const all = [];
for (const sc of scenes) {
  const words = sc.words.map((m) => ({ t: (sc.start + m.f) / FPS, d: m.d / FPS, text: m.t.replace(/ | /g, " ") })).filter((m) => m.text.trim());
  if (words.length) all.push(...segment(words));
}
all.sort((x, y) => x.start - y.start);
for (let k = 0; k < all.length; k++) {
  const s = all[k];
  const next = k + 1 < all.length ? all[k + 1].start - GAP_S : Infinity;
  let end = Math.max(s.speechEnd + TRAIL_S, s.start + MIN_S);
  end = Math.min(end, next, s.start + MAX_S);
  s.end = Math.max(end, Math.min(s.speechEnd, next), s.start + 0.3);
}
writeFileSync(join(project, "build/subtitles.json"), JSON.stringify(all.map((s) => ({ start: Math.round(s.start * FPS), end: Math.round(s.end * FPS), lines: s.lines }))));
const tc = (t) => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000), mi = Math.floor(ms / 60000) % 60, se = Math.floor(ms / 1000) % 60, r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(se).padStart(2, "0")},${String(r).padStart(3, "0")}`;
};
writeFileSync(join(project, "out/subtitles.srt"), all.map((r, i) => `${i + 1}\n${tc(r.start)} --> ${tc(r.end)}\n${r.lines.join("\n")}\n`).join("\n"));

const mn = Math.floor(totalFrames / FPS / 60);
console.log(`Timeline: ${scenes.length} scene(s), ${totalFrames} frames (${mn} min ${Math.round(totalFrames / FPS - mn * 60)} s), ${sfx.length} sound effect(s), ${sections.length} music section(s), ${all.length} subtitle(s).`);
if (estimated.length) console.log(`Estimated voices (not synthesised yet): ${estimated.join(", ")} → run \`sms voice\` then \`sms timeline\` again.`);
if (a.strict && warnings.length) {
  console.error(`${warnings.length} warning(s) in strict mode.`);
  process.exit(1);
}
