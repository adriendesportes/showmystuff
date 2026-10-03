import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import "./styles.css";
import { FrameProvider, waitForResources } from "./engine/frame";
import { FPS, HEIGHT, WIDTH } from "./engine/config";
import { timeline } from "./engine/timeline";
import { F } from "./ds/tokens";
import { Video } from "./Video";

declare global {
  interface Window {
    __ready?: boolean;
    __totalFrames?: number;
    __setFrame?: (f: number) => Promise<void>;
  }
}

/** Fonts used by the theme: force their loading before any capture. */
const FONT_PROBES = [400, 500, 600, 700].flatMap((w) => [`${w} 20px ${F.sans}`, `${w} 20px ${F.display}`, `${w} 20px ${F.mono}`]);

async function loadFonts() {
  await Promise.all(FONT_PROBES.map((p) => document.fonts.load(p, "Àéèçœ€ 0123456789 Ağüß").catch(() => undefined)));
  await document.fonts.ready;
}

const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function Scene({ frame }: { frame: number }) {
  return (
    <div style={{ width: WIDTH, height: HEIGHT, position: "relative", overflow: "hidden" }}>
      <FrameProvider value={frame}>
        <Video />
      </FrameProvider>
    </div>
  );
}

/** Render mode: driven frame by frame by scripts/render.mjs. */
function RenderHost() {
  const start = Number(new URLSearchParams(location.search).get("frame") ?? 0);
  const [frame, setFrame] = useState(start);
  useEffect(() => {
    window.__totalFrames = timeline.totalFrames;
    window.__setFrame = async (f: number) => {
      flushSync(() => setFrame(f));
      await waitForResources();
      await nextPaint();
    };
    loadFonts().then(async () => {
      await waitForResources();
      window.__ready = true;
    });
  }, []);
  return <Scene frame={frame} />;
}

const fmt = (f: number) => {
  const s = f / FPS;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, "0")}`;
};

/** Preview mode: player with sound, scrubber and scene buttons. */
function Player() {
  const total = timeline.totalFrames;
  const readHash = () => Number(/f=(\d+)/.exec(location.hash)?.[1] ?? 0);
  const [frame, setFrame] = useState(readHash);
  const [playing, setPlaying] = useState(false);
  const [scale, setScale] = useState(0.5);
  const audio = useRef<HTMLAudioElement | null>(null);
  const t0 = useRef({ perf: 0, frame: 0 });

  useEffect(() => {
    const a = new Audio("/build/audio/mix.wav");
    a.preload = "auto";
    a.addEventListener("error", () => (audio.current = null));
    audio.current = a;
    const resize = () => setScale(Math.min((innerWidth - 32) / WIDTH, (innerHeight - 150) / HEIGHT));
    resize();
    addEventListener("resize", resize);
    return () => removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    history.replaceState(null, "", `#f=${frame}`);
  }, [frame]);

  const toggle = useCallback(() => {
    setPlaying((p) => {
      const a = audio.current;
      if (!p) {
        t0.current = { perf: performance.now(), frame };
        if (a) {
          a.currentTime = frame / FPS;
          a.play().catch(() => undefined);
        }
      } else a?.pause();
      return !p;
    });
  }, [frame]);

  useEffect(() => {
    if (!playing) return;
    let id = 0;
    const loop = () => {
      const a = audio.current;
      const f = a && !a.paused && a.readyState >= 2
        ? Math.floor(a.currentTime * FPS)
        : t0.current.frame + Math.floor(((performance.now() - t0.current.perf) / 1000) * FPS);
      if (f >= total) {
        setPlaying(false);
        a?.pause();
        setFrame(total - 1);
        return;
      }
      setFrame(f);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [playing, total]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      }
      if (e.code === "ArrowRight") setFrame((f) => Math.min(total - 1, f + (e.shiftKey ? FPS : 1)));
      if (e.code === "ArrowLeft") setFrame((f) => Math.max(0, f - (e.shiftKey ? FPS : 1)));
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [toggle, total]);

  const scene = timeline.scenes.findLast((s) => frame >= s.start) ?? timeline.scenes[0];
  return (
    <div style={{ minHeight: "100vh", background: "#15151a", color: "#f3f1ee", fontFamily: F.sans, padding: 16 }}>
      <div style={{ width: WIDTH * scale, height: HEIGHT * scale, margin: "0 auto", boxShadow: "0 20px 60px #0008" }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }}>
          <Scene frame={frame} />
        </div>
      </div>
      <div style={{ maxWidth: WIDTH * scale, margin: "14px auto 0", display: "grid", gap: 8, fontSize: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button onClick={toggle} style={{ padding: "6px 14px" }}>{playing ? "Pause" : "Play"}</button>
          <span style={{ fontFamily: F.mono }}>
            {fmt(frame)} / {fmt(total)} · frame {frame} · scene <b>{scene?.id}</b>
          </span>
          <span style={{ opacity: 0.6 }}>space: play/pause · ←/→: frame · shift+←/→: second</span>
        </div>
        <input type="range" min={0} max={total - 1} value={frame} onChange={(e) => setFrame(Number(e.target.value))} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {timeline.scenes.map((s) => (
            <button key={s.id} onClick={() => setFrame(s.start)} style={{ fontSize: 11, opacity: s === scene ? 1 : 0.6 }}>
              {s.id}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const render = new URLSearchParams(location.search).has("render");
createRoot(document.getElementById("root")!).render(render ? <RenderHost /> : <StrictMode><Player /></StrictMode>);
