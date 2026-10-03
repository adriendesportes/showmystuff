import { existsSync, readFileSync, statSync, createReadStream } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The engine is shared by every project. The project directory is given by
 * SMS_PROJECT; its files are mapped onto the `@project/*` virtual paths and
 * its `public/` folder is served at the root (captures, assets).
 */
const ENGINE = fileURLToPath(new URL(".", import.meta.url));
const PROJECT = resolve(process.env.SMS_PROJECT ?? join(ENGINE, "../templates/project"));
const STUBS = join(ENGINE, "project-stubs");

function projectFile(relative: string, stub: string) {
  const p = join(PROJECT, relative);
  return existsSync(p) ? p : join(STUBS, stub);
}

const scenesIndex = ["scenes/index.tsx", "scenes/index.ts"].map((f) => join(PROJECT, f)).find(existsSync);

const MIME: Record<string, string> = {
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".json": "application/json", ".srt": "text/plain; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml",
};

/** Dev only: serves <project>/build/* under /build/ (the audio mix for the preview player). */
function serveProjectBuild(): Plugin {
  return {
    name: "sms-serve-project-build",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? "").split("?")[0]);
        if (!url.startsWith("/build/")) return next();
        const file = join(PROJECT, url);
        if (!file.startsWith(join(PROJECT, "build")) || !existsSync(file) || statSync(file).isDirectory()) return next();
        res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
  };
}

const config = existsSync(join(PROJECT, "showmystuff.json")) ? JSON.parse(readFileSync(join(PROJECT, "showmystuff.json"), "utf8")) : {};

export default defineConfig({
  root: ENGINE,
  publicDir: existsSync(join(PROJECT, "public")) ? join(PROJECT, "public") : false,
  plugins: [react(), serveProjectBuild()],
  resolve: {
    alias: [
      { find: "@project/timeline.json", replacement: projectFile("build/timeline.json", "timeline.json") },
      { find: "@project/subtitles.json", replacement: projectFile("build/subtitles.json", "subtitles.json") },
      { find: "@project/captures.json", replacement: projectFile("public/captures/captures.json", "captures.json") },
      { find: "@project/config.json", replacement: projectFile("showmystuff.json", "config.json") },
      { find: "@project/scenes", replacement: scenesIndex ?? join(STUBS, "scenes.ts") },
      { find: "@sms", replacement: join(ENGINE, "src") },
    ],
  },
  server: { host: "127.0.0.1", port: Number(process.env.SMS_PORT ?? config.previewPort ?? 5190), strictPort: false, fs: { allow: [ENGINE, PROJECT] } },
  build: { assetsInlineLimit: 0, chunkSizeWarningLimit: 6000, outDir: process.env.SMS_DIST ?? join(ENGINE, "dist"), emptyOutDir: true },
  logLevel: (process.env.SMS_LOGLEVEL as "info" | "warn") ?? "warn",
});
