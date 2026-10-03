// Takes the screenshots described by a capture plan, with named frames measured on the page.
//   node capture.mjs --project DIR [--plan capture-plan.json] [--serve ./site] [--base-url http://localhost:3000]
//                    [--only id1,id2] [--allow-remote] [--headed] [--timeout 30000]
//
// Plan (capture-plan.json):
// {
//   "baseUrl": "http://localhost:3000",          // local by default; remote hosts need --allow-remote
//   "viewport": { "width": 1440, "height": 900 }, "scale": 2, "locale": "en-US", "timezone": "Europe/Paris",
//   "colorScheme": "light", "hideSelectors": ["#cookie-banner"], "css": ".ads{display:none}",
//   "forbidden": ["ACME Real Customer", "\\b\\d{16}\\b"],   // regexes that must not appear in a capture
//   "login": { "goto": "/login", "actions": [ {"fill": ["#email", "demo@example.test"]}, {"click": "button[type=submit]"}, {"waitForUrl": "/dashboard"} ] },
//   "captures": [
//     { "id": "dashboard", "goto": "/dashboard", "fullPage": true,
//       "actions": [ {"click": "text=Projects"}, {"wait": 500} ],
//       "frames": { "kpis": ".kpi-row", "search": "input[name=q]", "first-row": "table tbody tr >> nth=0" } }
//   ]
// }
// Actions: goto, click, fill [sel, text], type [sel, text], press [sel, key], hover, select [sel, value],
//          check, wait (ms), waitFor (selector), waitForUrl (substring or regex), scroll (y or selector),
//          evaluate (JS string), setViewport {width,height}.
// Outputs: <project>/public/captures/<id>.png and captures.json (frames in CSS px from the top of the page).
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 && !String(args[i + 1] ?? "--").startsWith("--") ? args[i + 1] : undefined; };
const flag = (n) => args.includes(`--${n}`);
const project = resolve(opt("project") ?? process.env.SMS_PROJECT ?? ".");
const planFile = resolve(opt("plan") ?? join(project, "capture-plan.json"));
if (!existsSync(planFile)) throw new Error(`Capture plan not found: ${planFile}`);
const plan = JSON.parse(readFileSync(planFile, "utf8"));
const only = opt("only")?.split(",").map((s) => s.trim()).filter(Boolean);
const timeout = Number(opt("timeout") ?? plan.timeout ?? 30000);
const outDir = join(project, "public/captures");
mkdirSync(outDir, { recursive: true });

const { chromium } = await import(join(HOME, "engine/node_modules/playwright/index.mjs"));

// Optional static server for a folder (demo sites, exported HTML).
let server = null;
let baseUrl = opt("base-url") ?? plan.baseUrl ?? "";
const serveDir = opt("serve") ?? plan.serve;
if (serveDir) {
  const dir = resolve(project, serveDir);
  const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webp": "image/webp" };
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = normalize(join(dir, path));
    if (!file.startsWith(dir)) return void res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) return void res.writeHead(404).end("not found");
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  console.log(`Serving ${dir} at ${baseUrl}`);
}
if (!baseUrl) throw new Error("No baseUrl: set it in the plan, pass --base-url, or --serve <folder>");
const host = new URL(baseUrl).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) && !flag("allow-remote") && !plan.allowRemote) {
  throw new Error(`Base URL ${baseUrl} is not local. Screenshots of a remote site may expose real data; pass --allow-remote if you really mean it.`);
}

const forbidden = (plan.forbidden ?? []).map((re) => new RegExp(re, "iu"));
const browser = await chromium.launch({ headless: !flag("headed"), channel: plan.channel }).catch(async (e) => {
  for (const channel of ["chrome", "msedge"]) {
    try { return await chromium.launch({ headless: !flag("headed"), channel }); } catch { /* next */ }
  }
  throw e;
});
const context = await browser.newContext({
  viewport: plan.viewport ?? { width: 1440, height: 900 },
  deviceScaleFactor: plan.scale ?? 2,
  locale: plan.locale ?? "en-US",
  timezoneId: plan.timezone ?? "UTC",
  colorScheme: plan.colorScheme ?? "light",
  reducedMotion: "reduce",
  ...(plan.storageState && existsSync(resolve(project, plan.storageState)) ? { storageState: resolve(project, plan.storageState) } : {}),
});
context.setDefaultTimeout(timeout);
const css = [plan.css ?? "", ...(plan.hideSelectors ?? []).map((s) => `${s}{visibility:hidden !important}`), "*{caret-color:transparent !important}"].join("\n");
await context.addInitScript((styleText) => {
  const add = () => {
    const style = document.createElement("style");
    style.setAttribute("data-sms", "");
    style.textContent = styleText;
    document.documentElement.appendChild(style);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add);
  else add();
}, css);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const abs = (u) => (/^https?:/.test(u) ? u : baseUrl.replace(/\/$/, "") + (u.startsWith("/") ? u : `/${u}`));

async function settle() {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
  await page.waitForTimeout(plan.settleMs ?? 300);
}

async function act(action) {
  const [name, value] = Object.entries(action)[0];
  switch (name) {
    case "goto": await page.goto(abs(value), { waitUntil: "domcontentloaded" }); return settle();
    case "click": return page.locator(value).first().click();
    case "dblclick": return page.locator(value).first().dblclick();
    case "hover": return page.locator(value).first().hover();
    case "fill": return page.locator(value[0]).first().fill(String(value[1]));
    case "type": return page.locator(value[0]).first().pressSequentially(String(value[1]), { delay: 20 });
    case "press": return Array.isArray(value) ? page.locator(value[0]).first().press(value[1]) : page.keyboard.press(value);
    case "select": return page.locator(value[0]).first().selectOption(String(value[1]));
    case "check": return page.locator(value).first().check();
    case "uncheck": return page.locator(value).first().uncheck();
    case "wait": return page.waitForTimeout(Number(value));
    case "waitFor": return page.locator(value).first().waitFor();
    case "waitForUrl": return page.waitForURL(value.startsWith("/") && value.endsWith("/") && value.length > 2 ? new RegExp(value.slice(1, -1)) : (u) => u.href.includes(value));
    case "scroll": return typeof value === "number" ? page.evaluate((y) => window.scrollTo(0, y), value) : page.locator(value).first().scrollIntoViewIfNeeded();
    case "evaluate": return page.evaluate(value);
    case "setViewport": return page.setViewportSize(value);
    case "focus": return page.locator(value).first().focus();
    case "blur": return page.evaluate(() => document.activeElement?.blur());
    default: throw new Error(`Unknown action "${name}"`);
  }
}

async function measureFrames(frames = {}) {
  const out = {};
  for (const [name, selector] of Object.entries(frames)) {
    try {
      const loc = page.locator(selector).first();
      const box = await loc.boundingBox({ timeout: 5000 });
      if (!box) { console.log(`    frame "${name}": not visible`); continue; }
      const scrollY = await page.evaluate(() => window.scrollY);
      out[name] = { x: Math.round(box.x * 10) / 10, y: Math.round((box.y + scrollY) * 10) / 10, w: Math.round(box.width * 10) / 10, h: Math.round(box.height * 10) / 10 };
    } catch (e) {
      console.log(`    frame "${name}": ${String(e.message).split("\n")[0]}`);
    }
  }
  return out;
}

async function scanForbidden() {
  if (!forbidden.length) return [];
  const text = await page.evaluate(() => document.body?.innerText ?? "");
  const values = await page.evaluate(() => [...document.querySelectorAll("input:not([type=hidden]):not([type=password]), textarea")].map((i) => i.value).join("\n"));
  const hits = [];
  for (const re of forbidden) {
    const m = (text + "\n" + values).match(re);
    if (m) hits.push(m[0]);
  }
  return hits;
}

const index = [];
const existing = join(outDir, "captures.json");
const previous = existsSync(existing) ? JSON.parse(readFileSync(existing, "utf8")) : [];
const t0 = Date.now();
let failures = 0;

try {
  if (plan.login) {
    console.log("Login…");
    if (plan.login.goto) await act({ goto: plan.login.goto });
    for (const a of plan.login.actions ?? []) await act(a);
    await settle();
  }
  for (const c of plan.captures ?? []) {
    if (only && !only.includes(c.id)) { const old = previous.find((p) => p.id === c.id); if (old) index.push(old); continue; }
    console.log(`• ${c.id}`);
    try {
      if (c.goto) await act({ goto: c.goto });
      for (const a of c.actions ?? []) await act(a);
      await settle();
      const frames = await measureFrames(c.frames);
      const hits = await scanForbidden();
      if (hits.length) {
        console.log(`    ! forbidden content found: ${hits.join(", ")} — capture skipped`);
        failures++;
        continue;
      }
      const viewport = page.viewportSize();
      const pageHeight = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
      const fullPage = c.fullPage !== false;
      if (fullPage && pageHeight > viewport.height) {
        // Enlarging the viewport instead of fullPage keeps sticky sidebars (100vh) coherent.
        await page.setViewportSize({ width: viewport.width, height: Math.min(pageHeight, plan.maxPageHeight ?? 6000) });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(150);
      } else await page.evaluate(() => window.scrollTo(0, 0));
      const file = `${c.id}.png`;
      await page.screenshot({ path: join(outDir, file), type: "png", animations: "disabled" });
      const finalHeight = fullPage ? Math.min(pageHeight, plan.maxPageHeight ?? 6000) : viewport.height;
      if (fullPage && pageHeight > viewport.height) await page.setViewportSize(viewport);
      const title = c.title ?? (await page.title().catch(() => "")) ?? "";
      index.push({ id: c.id, url: c.goto ?? "", title, width: viewport.width, viewportHeight: viewport.height, pageHeight: finalHeight, scale: plan.scale ?? 2, frames, file });
      console.log(`    → ${file} (${viewport.width}×${finalHeight} CSS px, ${Object.keys(frames).length} frame(s))`);
    } catch (e) {
      failures++;
      console.log(`    ✗ ${String(e.message).split("\n")[0]}`);
    }
  }
} finally {
  writeFileSync(existing, JSON.stringify(index, null, 2) + "\n");
  await browser.close();
  if (server) await new Promise((r) => server.close(r));
}
if (errors.length) console.log(`Page errors seen: ${[...new Set(errors)].slice(0, 5).join(" | ")}`);
console.log(`${index.length} capture(s) in ${outDir} (${((Date.now() - t0) / 1000).toFixed(1)} s)${failures ? ` · ${failures} failed` : ""}`);
process.exit(failures ? 1 : 0);
