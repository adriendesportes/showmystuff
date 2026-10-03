/** Chapter card: dark panel, big display number in gold, cascading title, optional step strip. */
import { AbsoluteFill, useCurrentFrame, useSequenceDuration } from "../engine/frame";
import { clamp, ease, prog, spring } from "../engine/anim";
import { DarkPanel, DisplayTitle, Eyebrow, Rings } from "./base";
import { StepStrip } from "./steps";
import { C, F } from "./tokens";

export function ChapterCard({
  number,
  total,
  title,
  subtitle,
  steps,
  step,
  previousStep,
  label = "Chapter",
}: {
  number: number;
  total?: number;
  title: string;
  subtitle?: string;
  steps?: string[];
  step?: number;
  previousStep?: number;
  label?: string;
}) {
  const f = useCurrentFrame();
  const duration = useSequenceDuration();
  const sNum = spring({ frame: f - 6, config: { damping: 18, stiffness: 90 } });
  const pExit = Number.isFinite(duration) ? prog(f, duration - 14, 14, ease.in) : 0;
  const numText = String(number).padStart(2, "0");
  return (
    <AbsoluteFill>
      <DarkPanel />
      <Rings x={1640} y={300} r={210} at={4} color={C.gold} />
      <Rings x={1640} y={300} r={120} at={12} />
      <div style={{ position: "absolute", left: 150, top: 150, overflow: "hidden", height: 330 }}>
        <div style={{ font: `700 330px/1 ${F.display}`, letterSpacing: "-0.06em", color: C.goldSoft, transform: `translateY(${(1 - sNum) * 100}%)`, opacity: 1 - pExit * 0.4 }}>
          {numText}
        </div>
      </div>
      <div style={{ position: "absolute", left: 160, top: 520, width: 1400 }}>
        <Eyebrow at={10} size={20} color={C.goldSoft}>{total ? `${label} ${number} of ${total}` : `${label} ${number}`}</Eyebrow>
        <DisplayTitle at={16} size={104} color={C.onDark} cascade={4} style={{ marginTop: 26 }}>
          {title}
        </DisplayTitle>
        {subtitle && (
          <div style={{ marginTop: 26, font: `400 30px/1.45 ${F.sans}`, color: C.onDarkMuted, maxWidth: 1100, opacity: prog(f, 30, 20), transform: `translateY(${(1 - prog(f, 30, 20)) * 14}px)` }}>
            {subtitle}
          </div>
        )}
      </div>
      {steps && step !== undefined && (
        <div style={{ position: "absolute", left: 210, bottom: 70, opacity: clamp(1 - pExit) }}>
          <StepStrip steps={steps} current={step} from={previousStep ?? Math.max(0, step - 1)} at={20} width={1500} />
        </div>
      )}
    </AbsoluteFill>
  );
}
