import timeline from "@project/timeline.json";

/** Frame rate and frame size come from the project's timeline (built by `sms timeline`). */
export const FPS: number = (timeline as { fps: number }).fps ?? 30;
export const WIDTH: number = (timeline as { width: number }).width ?? 1920;
export const HEIGHT: number = (timeline as { height: number }).height ?? 1080;
