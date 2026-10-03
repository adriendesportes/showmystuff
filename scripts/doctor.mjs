// Environment check: can this machine capture screenshots, synthesise a voice and render a video?
//   node doctor.mjs [--json] [--url http://localhost:3000] [--quick]
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir, platform, cpus, freemem, totalmem } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = process.env.SMS_HOME ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = join(HOME, "engine");
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const checks = [];
let blocking = 0;

function add(name, status, detail = "", hint = "") {
  checks.push({ name, status, detail, hint });
  if (status === "fail") blocking++;
}
function sh(cmd, a = [], o = {}) {
  const r = spawnSync(cmd, a, { encoding: "utf8", timeout: o.timeout ?? 20000, ...o });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim(), status: r.status };
}
const which = (c) => sh(process.platform === "win32" ? "where" : "which", [c]).ok;

// ---- System ---------------------------------------------------------------------------------
add("system", "ok", `${platform()} · ${cpus().length} CPU · ${(freemem() / 1e9).toFixed(1)} / ${(totalmem() / 1e9).toFixed(1)} GB free RAM`);
const nodeMajor = Number(process.versions.node.split(".")[0]);
add("node", nodeMajor >= 20 ? "ok" : "fail", `v${process.versions.node}`, nodeMajor >= 20 ? "" : "Install Node.js >= 20 (https://nodejs.org)");

// ---- ffmpeg ---------------------------------------------------------------------------------
{
  const r = sh("ffmpeg", ["-version"]);
  if (!r.ok) add("ffmpeg", "fail", "not found", "macOS: brew install ffmpeg · Debian/Ubuntu: sudo apt install ffmpeg · Windows: winget install ffmpeg");
  else {
    const version = r.out.split("\n")[0].replace(/ Copyright.*$/, "");
    const enc = sh("ffmpeg", ["-hide_banner", "-encoders"]).out;
    const hasX264 = /\blibx264\b/.test(enc);
    const hasAac = /\baac\b/.test(enc);
    add("ffmpeg", hasX264 && hasAac ? "ok" : "fail", `${version}${hasX264 ? "" : " · libx264 missing"}${hasAac ? "" : " · aac missing"}`, hasX264 ? "" : "Install an ffmpeg build with libx264");
    add("ffprobe", sh("ffprobe", ["-version"]).ok ? "ok" : "warn", "", "ffprobe is used by `sms check`");
  }
}

// ---- Engine dependencies ----------------------------------------------------------------------
const nodeModules = join(ENGINE, "node_modules");
add("engine deps", existsSync(join(nodeModules, "vite")) && existsSync(join(nodeModules, "playwright")) ? "ok" : "fail", existsSync(nodeModules) ? "" : "node_modules missing", "Run: sms setup");

// ---- Python -----------------------------------------------------------------------------------
const PY = ["/.venv/bin/python", "/.venv/Scripts/python.exe"].map((p) => join(HOME, p)).find(existsSync);
if (!PY) add("python env", "fail", "virtual environment missing", "Run: sms setup");
else {
  const v = sh(PY, ["--version"]).out;
  const mods = sh(PY, ["-c", "import numpy, scipy, soundfile, pyloudnorm, edge_tts; print('ok')"]);
  add("python env", mods.ok ? "ok" : "fail", `${v}${mods.ok ? "" : " · missing modules"}`, mods.ok ? "" : "Run: sms setup");
  const mpl = sh(PY, ["-c", "import matplotlib"]).ok;
  add("matplotlib (optional)", mpl ? "ok" : "warn", mpl ? "" : "spectrograms will use ffmpeg instead", "");
}

// ---- Browser + real screenshot test -----------------------------------------------------------
async function browserCheck() {
  let chromium;
  try {
    ({ chromium } = await import(join(nodeModules, "playwright/index.mjs")));
  } catch {
    add("browser", "fail", "playwright not installed", "Run: sms setup");
    return;
  }
  const flags = ["--force-color-profile=srgb", "--hide-scrollbars"];
  let browser = null;
  let how = "";
  try {
    browser = await chromium.launch({ headless: true, args: flags });
    how = "bundled Chromium";
  } catch (e) {
    for (const channel of ["chrome", "msedge"]) {
      try {
        browser = await chromium.launch({ headless: true, channel, args: flags });
        how = `system ${channel}`;
        break;
      } catch { /* next */ }
    }
    if (!browser) {
      add("browser", "fail", String(e.message).split("\n")[0], "Run: sms setup   (downloads Chromium) — or install Google Chrome");
      return;
    }
  }
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.setContent("<html><body style='margin:0;background:#2b6cb0;color:#fff;font:40px sans-serif;padding:40px'>Show My Stuff ✓ Àéî</body></html>");
    const png = await page.screenshot({ type: "png" });
    const dir = mkdtempSync(join(tmpdir(), "sms-doctor-"));
    const ok = png.length > 1000;
    rmSync(dir, { recursive: true, force: true });
    add("screenshot", ok ? "ok" : "fail", `${how} · ${(png.length / 1024).toFixed(0)} KB test image`, ok ? "" : "Headless screenshot failed");
    const url = opt("url");
    if (url) {
      try {
        const res = await page.goto(url, { timeout: 15000, waitUntil: "domcontentloaded" });
        add("target url", res && res.ok() ? "ok" : "warn", `${url} → HTTP ${res?.status() ?? "?"}`, "Start your application locally before `sms capture`");
      } catch (e) {
        add("target url", "warn", `${url} unreachable (${String(e.message).split("\n")[0]})`, "Start your application locally before `sms capture`");
      }
    }
    await page.close();
  } finally {
    await browser.close();
  }
}

// ---- Voices -----------------------------------------------------------------------------------
function voiceChecks() {
  const hasSay = process.platform === "darwin" && which("say");
  add("voice: say (offline, macOS)", hasSay ? "ok" : "warn", hasSay ? "available" : process.platform === "darwin" ? "not found" : "macOS only", "");
  const piper = which("piper");
  add("voice: piper (offline)", piper ? "ok" : "warn", piper ? "binary found" : "not installed (optional)", piper ? "" : "Optional: https://github.com/rhasspy/piper + a .onnx voice model");
  if (!flag("quick")) {
    const net = sh(process.execPath, ["-e", "fetch('https://speech.platform.bing.com', {method:'HEAD'}).then(r=>{console.log('ok');process.exit(0)}).catch(e=>{console.log(String(e.cause?.code||e.message));process.exit(1)})"], { timeout: 12000 });
    add("voice: edge (free, online)", net.ok ? "ok" : "warn", net.ok ? "network reachable" : `no network (${net.out.split("\n")[0]})`, net.ok ? "" : "Offline: use say/piper, or an already-cached voice");
  }
  let key = !!process.env.ELEVENLABS_API_KEY;
  if (!key && process.platform === "darwin") {
    key = ["showmystuff-elevenlabs", "elevenlabs"].some((s) => sh("security", ["find-generic-password", "-s", s]).ok);
  }
  if (!key) key = existsSync(join(process.env.HOME ?? "", ".config/showmystuff/elevenlabs.key"));
  add("voice: elevenlabs (premium)", key ? "ok" : "warn", key ? "API key found (not displayed)" : "no API key", key ? "" : "Optional: sms key elevenlabs   (or export ELEVENLABS_API_KEY)");
}

// ---- Disk -------------------------------------------------------------------------------------
{
  const r = sh("df", ["-k", HOME]);
  if (r.ok) {
    const line = r.out.trim().split("\n").at(-1).split(/\s+/);
    const freeGb = Number(line[3]) / 1e6;
    add("disk space", freeGb > 5 ? "ok" : "warn", `${freeGb.toFixed(1)} GB free`, "Renders need a few GB of temporary space");
  }
}

await browserCheck();
voiceChecks();

const project = opt("project") ?? process.env.SMS_PROJECT;
if (project && existsSync(join(project, "showmystuff.json"))) add("project", "ok", project);

if (flag("json")) {
  console.log(JSON.stringify({ ok: blocking === 0, checks }, null, 2));
} else {
  const icon = { ok: "✓", warn: "!", fail: "✗" };
  for (const c of checks) {
    console.log(`${icon[c.status]} ${c.name.padEnd(30)} ${c.detail}${c.status !== "ok" && c.hint ? `\n    → ${c.hint}` : ""}`);
  }
  console.log(blocking === 0 ? "\nReady: screenshots, voice and rendering can run on this machine." : `\n${blocking} blocking problem(s): fix them before building a video.`);
}
process.exit(blocking === 0 ? 0 : 1);
