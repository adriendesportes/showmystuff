/** One big sentence (a claim, a quote), optionally on a dark panel. */
import { AbsoluteFill, useCurrentFrame } from "../engine/frame";
import { ease, prog } from "../engine/anim";
import { useAt, type At } from "../engine/timeline";
import { Background, DarkPanel, DisplayTitle, Eyebrow, Rings } from "../ds/base";
import { C, F } from "../ds/tokens";

export function Statement({ text, at: start, accent, eyebrow, author, dark = false, size }: { text: string; at?: At; accent?: string[]; eyebrow?: string; author?: string; dark?: boolean; size?: number }) {
  const f = useCurrentFrame();
  const at = useAt();
  const t0 = at(start, 10);
  const fontSize = size ?? (text.length > 90 ? 64 : text.length > 50 ? 80 : 96);
  const pAuthor = prog(f, t0 + 40, 20, ease.out);
  return (
    <AbsoluteFill>
      {dark ? <DarkPanel /> : <Background />}
      {dark && <Rings x={1560} y={760} r={260} at={0} color={C.gold} />}
      <div style={{ position: "absolute", left: 0, right: 0, top: "50%", transform: "translateY(-50%)", padding: "0 180px", textAlign: "center" }}>
        {eyebrow && <Eyebrow at={t0 - 10} color={dark ? C.goldSoft : C.muted} style={{ justifyContent: "center", marginBottom: 36 }}>{eyebrow}</Eyebrow>}
        <DisplayTitle at={t0} size={fontSize} align="center" accent={accent} color={dark ? C.onDark : C.ink} weight={500} lineHeight={1.12}>
          {text}
        </DisplayTitle>
        <div style={{ margin: "40px auto 0", width: 80 * prog(f, t0 + 24, 24, ease.smooth), height: 2, background: C.gold }} />
        {author && <div style={{ marginTop: 28, font: `400 28px/1.4 ${F.sans}`, color: dark ? C.onDarkMuted : C.muted, opacity: pAuthor, transform: `translateY(${(1 - pAuthor) * 10}px)` }}>{author}</div>}
      </div>
    </AbsoluteFill>
  );
}
