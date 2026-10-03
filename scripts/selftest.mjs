// Smoke test without network: builds the template project with estimated voices
// (no synthesis), generates sfx, music and mix, and renders three still frames.
//   node scripts/selftest.mjs
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SMS = join(HOME, "bin/sms");
const dir = mkdtempSync(join(tmpdir(), "sms-selftest-"));
const project = join(dir, "project");
cpSync(join(HOME, "templates/project"), project, { recursive: true });
// Point the template's capture plan at the example demo site so the Screen scene has an image.
const plan = JSON.parse(readFileSync(join(project, "capture-plan.json"), "utf8"));
delete plan.baseUrl;
plan.serve = join(HOME, "examples/hello/demo-site");
writeFileSync(join(project, "capture-plan.json"), JSON.stringify(plan, null, 2));

const steps = [
  ["capture", ["capture"]],
  ["timeline (estimated voices)", ["timeline"]],
  ["sfx", ["sfx"]],
  ["music", ["music"]],
  ["mix", ["mix"]],
  ["stills", ["stills", "--frames", "10,200,400", "--out", "out/selftest"]],
];
let failed = false;
for (const [name, args] of steps) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [SMS, ...args, "--project", project], { encoding: "utf8" });
  const ok = r.status === 0;
  failed ||= !ok;
  console.log(`${ok ? "✓" : "✗"} ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (!ok) console.log((r.stdout + r.stderr).trim().split("\n").slice(-12).join("\n"));
}
const stills = join(project, "out/selftest");
const n = existsSync(stills) ? readFileSync(join(project, "build/timeline.json"), "utf8").length && 3 : 0;
console.log(failed ? `\nSelf-test FAILED (artefacts kept in ${dir})` : `\nSelf-test passed (${n} stills, mix.wav and timeline built in ${project})`);
if (!failed && !process.argv.includes("--keep")) rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
