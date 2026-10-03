// Shared helpers of render.mjs and stills.mjs: project resolution, Vite build, static server, browser.
import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ENGINE = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const SMS_HOME = resolve(ENGINE, "..");

/** Project directory: --project, SMS_PROJECT, or the nearest ancestor holding showmystuff.json. */
export function projectDir(a = {}) {
  let p = a.project ?? process.env.SMS_PROJECT;
  if (!p) {
    let d = process.cwd();
    while (true) {
      if (existsSync(join(d, "showmystuff.json"))) { p = d; break; }
      const up = resolve(d, "..");
      if (up === d) break;
      d = up;
    }
  }
  if (!p || !existsSync(join(p, "showmystuff.json"))) {
    throw new Error("No project found: run from a project folder (showmystuff.json) or pass --project <dir>");
  }
  return resolve(p);
}

export function readConfig(project) {
  return JSON.parse(readFileSync(join(project, "showmystuff.json"), "utf8"));
}

export function readTimeline(project) {
  const f = join(project, "build/timeline.json");
  if (!existsSync(f)) throw new Error("build/timeline.json missing: run `sms timeline` first");
  return JSON.parse(readFileSync(f, "utf8"));
}

export function args() {
  const a = {};
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    if (!v[i].startsWith("--")) continue;
    const k = v[i].slice(2);
    const next = v[i + 1];
    if (next === undefined || next.startsWith("--")) a[k] = true;
    else {
      a[k] = next;
      i++;
    }
  }
  return a;
}

export function run(cmd, params, options = {}) {
  return new Promise((ok, ko) => {
    const p = spawn(cmd, params, { stdio: "inherit", cwd: ENGINE, ...options });
    p.on("exit", (code) => (code === 0 ? ok() : ko(new Error(`${cmd} ${params.join(" ")} → exit code ${code}`))));
    p.on("error", ko);
  });
}

/** Builds the site into `dir` for the given project (one folder per process: parallel agents are fine). */
export async function build(project, dir) {
  const vite = join(ENGINE, "node_modules/.bin/vite");
  if (!existsSync(vite)) throw new Error("Engine dependencies missing: run `sms setup`");
  await run(vite, ["build", "--logLevel", "warn"], { env: { ...process.env, SMS_PROJECT: project, SMS_DIST: dir } });
}

export function tempDist(project) {
  return join(project, "build", `.dist-${process.pid}`);
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".wav": "audio/wav", ".mp3": "audio/mpeg",
};

/** Serves a built folder on a free local port. */
export function serve(dir) {
  return new Promise((ok) => {
    const server = createServer((req, res) => {
      const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      let file = normalize(join(dir, path));
      if (!file.startsWith(dir)) {
        res.writeHead(403).end();
        return;
      }
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(dir, "index.html");
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "max-age=3600" });
      createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      ok({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

/** Launches the bundled Chromium; falls back to the system Chrome/Edge if the download is missing. */
export async function browser() {
  const { chromium } = await import("playwright");
  const flags = ["--force-color-profile=srgb", "--hide-scrollbars", "--font-render-hinting=none", "--disable-lcd-text"];
  try {
    return await chromium.launch({ headless: true, args: flags });
  } catch (e) {
    for (const channel of ["chrome", "msedge"]) {
      try {
        return await chromium.launch({ headless: true, channel, args: flags });
      } catch { /* try next */ }
    }
    throw new Error(`No browser available (${e.message}). Run: sms setup`);
  }
}

/** Opens a render page ready to receive __setFrame. */
export async function renderPage(nav, url, size, frame = 0, extra = "") {
  const page = await nav.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 });
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log(`  [page ${m.type()}] ${m.text()}`);
  });
  page.on("pageerror", (e) => {
    console.log(`  [page exception] ${e.message}`);
    page.__error = page.__error ?? e.message;
  });
  await page.goto(`${url}/?render=1&frame=${frame}${extra}`);
  await page.waitForFunction(() => window.__ready === true || !!window.__error, null, { timeout: 120000 });
  await failIfSceneError(page, frame);
  return page;
}

async function failIfSceneError(page, frame) {
  const message = page.__error ?? (await page.evaluate(() => window.__error ?? null));
  if (message) throw new Error(`Scene error at frame ${frame}: ${message.split("\n")[0]} — fix the scenario (missing capture frame or prop) and run again.`);
}

export async function grab(page, frame, type = "jpeg") {
  await page.evaluate((f) => window.__setFrame(f), frame);
  await failIfSceneError(page, frame);
  return page.screenshot(type === "png" ? { type: "png" } : { type: "jpeg", quality: 97 });
}
