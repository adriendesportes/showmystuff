/** Title card: brand block on a dark panel, with optional floating documents. */
import { AbsoluteFill, useCurrentFrame, useSequenceDuration } from "../engine/frame";
import { ease, noise1, prog, spring } from "../engine/anim";
import { Doc } from "../ds/illustrations";
import { Eyebrow, DarkPanel, Logo, Rings } from "../ds/base";
import { C, F, config, type Tone } from "../ds/tokens";

type DocProp = { title: string; subtitle?: string; label?: string; tone?: Tone; signature?: boolean };

export function Title({
  title = config.brand?.name ?? "Your product",
  subtitle = config.brand?.tagline,
  eyebrow,
  logo = config.brand?.logoDark ?? config.brand?.logo,
  footnote,
  docs = [],
}: {
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  logo?: string;
  footnote?: string;
  docs?: DocProp[];
}) {
  const f = useCurrentFrame();
  const duration = useSequenceDuration();
  const sWord = (i: number) => spring({ frame: f - 8 - i * 6, config: { damping: 18, stiffness: 110 } });
  const rule = prog(f, 22, 36, ease.smooth);
  const sub = prog(f, 34, 24, ease.out);
  const end = Number.isFinite(duration) ? prog(f, duration - 16, 16, ease.in) : 0;
  const slowZoom = 1 + f * 0.0004;
  const words = title.split(" ");
  const size = words.join(" ").length > 14 ? 120 : 172;
  const positions = [
    { x: 1490, y: 230, r: -9, d: 6 },
    { x: 1640, y: 320, r: 4, d: 12 },
    { x: 1540, y: 470, r: -2, d: 18 },
  ];
  return (
    <AbsoluteFill>
      <DarkPanel />
      <Rings x={1500} y={560} r={330} at={0} color={C.gold} />
      <Rings x={1500} y={560} r={190} at={10} />
      {docs.slice(0, 3).map((p, i) => {
        const pos = positions[i];
        return (
          <div key={i} style={{ position: "absolute", left: pos.x, top: pos.y + noise1(f / 60, `t${i}`) * 10, transform: `rotate(${pos.r + noise1(f / 80, `r${i}`) * 1.5}deg)`, opacity: 1 - end }}>
            <Doc title={p.title} subtitle={p.subtitle} label={p.label ?? "Doc"} at={pos.d} width={215} signature={p.signature} signatureAt={pos.d + 22} tone={p.tone ?? "secondary"} />
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 190, top: 250, transform: `scale(${slowZoom})`, transformOrigin: "0 50%", opacity: 1 - end }}>
        {logo && <Logo src={logo} height={44} at={0} />}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 36, marginTop: logo ? 48 : 0 }}>
          <div style={{ font: `700 ${size}px/0.95 ${F.display}`, letterSpacing: "-0.04em", color: C.onDark, display: "flex", flexWrap: "wrap", gap: `0 ${size * 0.27}px`, maxWidth: 1300 }}>
            {words.map((m, i) => (
              <span key={i} style={{ display: "inline-block", overflow: "hidden", paddingBottom: 20, marginBottom: -20 }}>
                <span style={{ display: "inline-block", transform: `translateY(${(1 - sWord(i)) * 110}%)` }}>{m}</span>
              </span>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 34, height: 1, width: 1180 * rule, background: "rgb(255 255 255 / 22%)" }} />
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", width: 1180, marginTop: 26 }}>
          {subtitle && (
            <div style={{ font: `400 40px/1.3 ${F.sans}`, color: "rgb(255 255 255 / 78%)", opacity: sub, transform: `translateY(${(1 - sub) * 16}px)`, maxWidth: 900 }}>
              {subtitle}
            </div>
          )}
          {eyebrow && <Eyebrow at={40} size={17} color={C.goldSoft} rule={false}>{eyebrow}</Eyebrow>}
        </div>
      </div>
      {footnote && (
        <div style={{ position: "absolute", right: 70, bottom: 54, textAlign: "right", opacity: prog(f, 60, 20) * (1 - end) }}>
          <div style={{ font: `500 15px/1 ${F.mono}`, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgb(255 255 255 / 45%)" }}>{footnote}</div>
        </div>
      )}
    </AbsoluteFill>
  );
}
