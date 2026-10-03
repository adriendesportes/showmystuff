// Final render: N browsers each capture a contiguous range of frames, each range is
// encoded by its own ffmpeg, then the parts are concatenated and muxed with the audio
// mix and the subtitles.
//
//   node render.mjs [--project DIR] [--workers 8] [--from 0] [--to N] [--out out/x.mp4]
//                   [--skip-build] [--crf 16] [--subtitles] [--no-audio] [--no-subs]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join, resolve } from "node:path";
import { args, browser, build, grab, projectDir, readConfig, readTimeline, renderPage, run, serve, tempDist } from "./lib.mjs";

const a = args();
const project = projectDir(a);
const config = readConfig(project);
const timeline = readTimeline(project);
const FPS = timeline.fps;
const size = { width: timeline.width, height: timeline.height };
const from = Number(a.from ?? 0);
const to = Math.min(Number(a.to ?? timeline.totalFrames), timeline.totalFrames);
const workers = Math.max(1, Number(a.workers ?? config.render?.workers ?? Math.max(1, cpus().length - 2)));
const crf = String(a.crf ?? config.render?.crf ?? 16);
const burnIn = !!a.subtitles;
const defaultOut = config.output ?? `out/${config.name ?? "video"}.mp4`;
const out = resolve(project, a.out ?? (burnIn ? defaultOut.replace(/\.mp4$/, "-subtitled.mp4") : defaultOut));
const tmp = join(project, "build/.render");
const AUDIO = join(project, "build/audio/mix.wav");
const SRT = join(project, "out/subtitles.srt");
const dist = a["skip-build"] && existsSync(join(project, "build/dist")) ? join(project, "build/dist") : tempDist(project);

if (dist !== join(project, "build/dist")) {
  console.log("Building the site (Vite)…");
  await build(project, dist);
}
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
mkdirSync(resolve(out, ".."), { recursive: true });

const server = await serve(dist);
const nav = await browser();
const total = to - from;
const chunk = Math.ceil(total / workers);
const ranges = Array.from({ length: workers }, (_, i) => [from + i * chunk, Math.min(to, from + (i + 1) * chunk)]).filter(([x, y]) => y > x);
let done = 0;
const t0 = Date.now();

function encoder(file) {
  const ff = spawn("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-vf", "scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p",
    "-c:v", "libx264", "-preset", config.render?.preset ?? "slow", "-crf", crf, "-tune", "animation",
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
    "-g", String(FPS * 2), "-bf", "2",
    file,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const finished = new Promise((ok, ko) => ff.on("exit", (c) => (c === 0 ? ok() : ko(new Error(`ffmpeg ${file} → ${c}`)))));
  return { ff, finished };
}

async function worker([x, y], i) {
  const page = await renderPage(nav, server.url, size, x, burnIn ? "&subtitles=1" : "");
  const file = join(tmp, `part-${String(i).padStart(2, "0")}.mp4`);
  const { ff, finished } = encoder(file);
  for (let f = x; f < y; f++) {
    const img = await grab(page, f);
    if (!ff.stdin.write(img)) await new Promise((r) => ff.stdin.once("drain", r));
    done++;
    if (done % 150 === 0) {
      const elapsed = (Date.now() - t0) / 1000;
      const left = (elapsed / done) * (total - done);
      const eta = left < 90 ? `${Math.ceil(left)} s` : `${Math.ceil(left / 60)} min`;
      console.log(`  ${done}/${total} frames · ${(done / elapsed).toFixed(1)} fps · ~${eta} left`);
    }
  }
  ff.stdin.end();
  await finished;
  await page.close();
  return file;
}

console.log(`Rendering ${total} frames (${(total / FPS).toFixed(1)} s) with ${ranges.length} browser(s)…`);
const parts = await Promise.all(ranges.map((p, i) => worker(p, i)));
await nav.close();
await server.close();

const list = join(tmp, "list.txt");
writeFileSync(list, parts.map((m) => `file '${m}'`).join("\n"));
const video = join(tmp, "video.mp4");
await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", video]);

const complete = from === 0 && to === timeline.totalFrames;
const inputs = ["-i", video];
const maps = ["-map", "0:v"];
const codecs = ["-c:v", "copy"];
let n = 1;
if (existsSync(AUDIO) && !a["no-audio"]) {
  inputs.push(...(complete ? [] : ["-ss", String(from / FPS)]), "-i", AUDIO);
  maps.push("-map", `${n}:a`);
  codecs.push("-c:a", "aac", "-b:a", "192k");
  n++;
} else if (!a["no-audio"]) console.log("  (no audio mix found: run `sms audio` to add voice and music)");
if (existsSync(SRT) && complete && !a["no-subs"]) {
  const lang = config.language ?? "und";
  inputs.push("-i", SRT);
  maps.push("-map", `${n}:s`);
  codecs.push("-c:s", "mov_text", "-metadata:s:s:0", `language=${lang}`);
  n++;
}
await run("ffmpeg", ["-y", "-loglevel", "error", ...inputs, ...maps, ...codecs, "-movflags", "+faststart", out]);
rmSync(tmp, { recursive: true, force: true });
if (dist !== join(project, "build/dist")) rmSync(dist, { recursive: true, force: true });
console.log(`Done in ${((Date.now() - t0) / 60000).toFixed(1)} min → ${out}`);
