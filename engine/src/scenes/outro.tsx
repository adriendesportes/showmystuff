/** Closing card: brand, one line, a URL or call to action. */
import { AbsoluteFill, useCurrentFrame, useSequenceDuration } from "../engine/frame";
import { clamp, ease, prog } from "../engine/anim";
import { useAt, type At } from "../engine/timeline";
import { Background, DarkPanel, DisplayTitle, Logo, Rings } from "../ds/base";
import { C, F, config } from "../ds/tokens";

export function Outro({ title, text, url = config.brand?.url, logo = config.brand?.logo, cta, footnote, dark = true, at: start }: { title?: string; text?: string; url?: string; logo?: string; cta?: string; footnote?: string; dark?: boolean; at?: At }) {
  const f = useCurrentFrame();
  const at = useAt();
  const duration = useSequenceDuration();
  const t0 = at(start, 14);
  const pLogo = prog(f, t0, 18, ease.out);
  const pText = prog(f, t0 + 26, 20, ease.out);
  const pUrl = prog(f, t0 + 40, 20, ease.out);
  const end = Number.isFinite(duration) ? prog(f, duration - 14, 14, ease.in) : 0;
  const name = title ?? config.brand?.name ?? "";
  const fg = dark ? C.onDark : C.ink;
  const muted = dark ? C.onDarkMuted : C.muted;
  return (
    <AbsoluteFill>
      {dark ? <DarkPanel /> : <Background />}
      {dark && <Rings x={1600} y={300} r={240} at={0} color={C.gold} />}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: 1 - end }}>
        <div style={{ overflow: "hidden", padding: "6px 8px 10px", margin: "-6px -8px -10px" }}>
          <div style={{ transform: `translateY(${(1 - pLogo) * 104}%)`, opacity: clamp(pLogo * 3) }}>
            {logo ? <Logo src={dark ? config.brand?.logoDark ?? logo : logo} height={96} /> : <DisplayTitle at={t0} size={120} color={fg} align="center">{name}</DisplayTitle>}
          </div>
        </div>
        {text && <div style={{ marginTop: 44, font: `400 40px/1.3 ${F.display}`, fontStyle: "italic", color: fg, opacity: pText, transform: `translateY(${(1 - pText) * 10}px)`, textAlign: "center", maxWidth: 1300 }}>{text}</div>}
        <div style={{ marginTop: 40, width: 80, height: 2, background: C.gold, transform: `scaleX(${prog(f, t0 + 30, 22, ease.smooth)})` }} />
        {(url || cta) && (
          <div style={{ marginTop: 34, display: "flex", alignItems: "center", gap: 24, opacity: pUrl, transform: `translateY(${(1 - pUrl) * 8}px)` }}>
            {cta && <span style={{ padding: "14px 26px", background: C.accent, color: C.white, borderRadius: 4, font: `600 24px/1 ${F.sans}`, boxShadow: "4px 4px 0 rgb(0 0 0 / 18%)" }}>{cta}</span>}
            {url && <span style={{ font: `500 22px/1 ${F.mono}`, letterSpacing: "0.06em", color: muted }}>{url}</span>}
          </div>
        )}
      </div>
      {footnote && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 56, textAlign: "center", font: `500 15px/1 ${F.mono}`, letterSpacing: "0.16em", textTransform: "uppercase", color: muted, opacity: pUrl * (1 - end) }}>{footnote}</div>
      )}
    </AbsoluteFill>
  );
}
