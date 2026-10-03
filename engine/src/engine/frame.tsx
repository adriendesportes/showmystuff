import { createContext, useContext, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";

/** Current frame, relative to the enclosing sequence. */
const FrameContext = createContext<number>(0);
/** Duration (frames) of the enclosing sequence. */
const DurationContext = createContext<number>(Infinity);

export const FrameProvider = FrameContext.Provider;
export const useCurrentFrame = () => useContext(FrameContext);
export const useSequenceDuration = () => useContext(DurationContext);

export function AbsoluteFill({ children, style, className }: { children?: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <div className={className} style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", ...style }}>
      {children}
    </div>
  );
}

/**
 * Shifts time for its children: at frame `from` of the parent, children see frame 0.
 * Outside [from, from + durationInFrames) nothing is rendered.
 */
export function Sequence({
  from = 0,
  durationInFrames = Infinity,
  children,
  layout = "absolute",
  style,
}: {
  from?: number;
  durationInFrames?: number;
  children?: ReactNode;
  layout?: "absolute" | "none";
  style?: CSSProperties;
}) {
  const parent = useCurrentFrame();
  const local = parent - from;
  if (local < 0 || local >= durationInFrames) return null;
  const content = layout === "none" ? children : <AbsoluteFill style={style}>{children}</AbsoluteFill>;
  return (
    <FrameContext.Provider value={local}>
      <DurationContext.Provider value={durationInFrames}>{content}</DurationContext.Provider>
    </FrameContext.Provider>
  );
}

/* ---- Resource waiting (a delayRender equivalent) -------------------------- */

let pending = 0;
const wakeups: Array<() => void> = [];

export function delayRender(): () => void {
  pending++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    pending--;
    if (pending === 0) wakeups.splice(0).forEach((r) => r());
  };
}

export function waitForResources(): Promise<void> {
  return pending === 0 ? Promise.resolve() : new Promise((r) => wakeups.push(r));
}

/** Image that holds the capture until it is loaded and decoded. */
export function Img({ src, style, className, alt = "" }: { src: string; style?: CSSProperties; className?: string; alt?: string }) {
  const ref = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const img = ref.current;
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) return;
    const end = delayRender();
    const finish = () => {
      img.decode().catch(() => undefined).finally(end);
    };
    img.addEventListener("load", finish, { once: true });
    img.addEventListener("error", () => {
      console.error(`Image not found: ${src}`);
      end();
    }, { once: true });
    return end;
  }, [src]);
  return <img ref={ref} src={src} alt={alt} decoding="sync" draggable={false} className={className} style={style} />;
}
