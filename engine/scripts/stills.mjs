// Still frames for visual review, and contact sheets.
//   node stills.mjs --frames 0,120,300
//   node stills.mjs --every 2                (one frame every 2 s)
//   node stills.mjs --scenes                 (start+20, middle and end-20 of each scene)
//   node stills.mjs --scene s03 --every 0.5
//   options: --out out/stills  --skip-build  --sheet (contact sheets of 12)  --subtitles
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { args, browser, build, grab, projectDir, readTimeline, renderPage, serve, tempDist } from "./lib.mjs";

const a = args();
const project = projectDir(a);
const timeline = readTimeline(project);
const FPS = timeline.fps;
const size = { width: timeline.width, height: timeline.height };
const out = resolve(project, a.out ?? "out/stills");
let frames = [];
let window_ = [0, timeline.totalFrames];
if (a.scene) {
  const s = timeline.scenes.find((x) => x.id === a.scene);
  if (!s) throw new Error(`Unknown scene: ${a.scene} (known: ${timeline.scenes.map((x) => x.id).join(", ")})`);
  window_ = [s.start, s.start + s.duration];
}
if (a.frames) frames = String(a.frames).split(",").map(Number);
else if (a.every) {
  const step = Math.max(1, Math.round(Number(a.every) * FPS));
  for (let f = window_[0]; f < window_[1]; f += step) frames.push(f);
} else if (a.scenes) {
  for (const s of timeline.scenes) frames.push(s.start + Math.min(20, s.duration - 1), s.start + Math.floor(s.duration / 2), s.start + Math.max(0, s.duration - 20));
} else frames = [window_[0]];
frames = [...new Set(frames)].filter((f) => f >= 0 && f < timeline.totalFrames).sort((x, y) => x - y);

const persistent = join(project, "build/dist");
const dist = a["skip-build"] ? persistent : tempDist(project);
if (dist !== persistent || !existsSync(join(dist, "index.html"))) await build(project, dist);
mkdirSync(out, { recursive: true });
// Only previous stills and sheets are removed, never other files of a user-supplied folder.
for (const f of readdirSync(out)) if (/^(\d{6}-.*|sheet-\d+)\.png$/.test(f)) rmSync(join(out, f), { force: true });
const server = await serve(dist);
const nav = await browser();
const page = await renderPage(nav, server.url, size, frames[0] ?? 0, a.subtitles ? "&subtitles=1" : "");
const files = [];
const abort = (e) => { console.error(`\n${e instanceof Error ? e.message : String(e)}`); if (dist !== persistent) rmSync(dist, { recursive: true, force: true }); process.exit(1); };
process.on("unhandledRejection", abort);
process.on("uncaughtException", abort);
for (const f of frames) {
  const s = timeline.scenes.findLast((x) => f >= x.start);
  const name = `${String(f).padStart(6, "0")}-${s?.id ?? "x"}.png`;
  writeFileSync(join(out, name), await grab(page, f, "png"));
  files.push(name);
}
await nav.close();
await server.close();
if (dist !== persistent) rmSync(dist, { recursive: true, force: true });

if (a.sheet) {
  // Contact sheet rendered by the browser (no dependency on ffmpeg drawtext).
  const nav2 = await browser();
  const p2 = await nav2.newPage({ viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 1 });
  for (let i = 0, k = 1; i < files.length; i += 12, k++) {
    const batch = files.slice(i, i + 12);
    const cells = batch.map((f) => {
      const b64 = readFileSync(join(out, f)).toString("base64");
      return `<figure><img src="data:image/png;base64,${b64}"><figcaption>${f.replace(".png", "")}</figcaption></figure>`;
    }).join("");
    await p2.setContent(`<style>body{margin:0;background:#111;font:14px monospace;color:#fff}main{display:grid;grid-template-columns:repeat(3,640px);gap:0}figure{margin:0;position:relative}img{width:640px;height:360px;display:block}figcaption{position:absolute;left:6px;top:6px;background:#000a;padding:2px 6px}</style><main>${cells}</main>`);
    await p2.waitForFunction(() => [...document.images].every((im) => im.complete));
    await p2.locator("main").screenshot({ path: join(out, `sheet-${String(k).padStart(2, "0")}.png`) });
  }
  await nav2.close();
}
console.log(`${files.length} frame(s) → ${out}${a.sheet ? " (plus contact sheets sheet-*.png)" : ""}`);
