# Built-in scenes and their props

All `at`/`until`/`exit` values accept time expressions (see scenario.md). Targets accept
`"frame:<name>"` (a named frame measured by `sms capture`), `"window"` (Screen camera) or a rect
`{ "x", "y", "w", "h" }` in CSS px of the capture. Points accept `"frame:<name>"` or `{ "x", "y" }`.

## Title
`{ title?, subtitle?, eyebrow?, logo?, footnote?, docs?: [{ title, subtitle?, label?, tone?, signature? }] }`
Defaults come from `showmystuff.json` → `brand`. Dark panel, big display title, up to 3 floating documents.

## Chapter
`{ number, title, subtitle?, total?, label?, steps?: string[], step?: number }`
Dark interstitial; `steps`/`step` draws a progress strip (same `steps` on every chapter).

## Screen — the workhorse
```json
{
  "capture": "dashboard",                        // or "views": [{ "at": 0, "capture": "a" }, { "at": "cue:x", "capture": "b", "fade": 8 }]
  "url": "app.example.com/dashboard",            // or [{ "at": 0, "url": "…" }]
  "camera":   [{ "at": "cue:kpis", "target": "frame:kpis", "duration": 34, "fill": 0.62, "zoom": 1.8 }, { "at": "end-1", "target": "window" }],
  "scroll":   [{ "at": "cue:down", "y": 600 }],  // y in px or "frame:name" (scrolls so the frame is near the top)
  "cursor":   [{ "at": "cue:go", "target": "frame:button", "duration": 24 }, { "at": "cue:go+0.5", "target": "frame:button", "click": true, "duration": 1 }],
  "spotlights": [{ "at": "cue:kpis", "until": "cue:next", "target": "frame:kpis", "pad": 6 }],
  "callouts": [{ "at": "cue:kpis+0.3", "until": "cue:next", "anchor": "frame:kpis", "side": "right|left|top|bottom", "title": "Label", "text": "One short sentence.", "width": 420, "distance": 120, "tone": "dark|light" }],
  "typing":   [{ "at": "cue:title", "until": "cue:save", "target": "frame:title", "text": "Q3 plan", "cps": 16, "size": 15 }],
  "notifications": [{ "at": "cue:save+0.6", "until": "end-0.6", "title": "Saved", "text": "…", "tone": "ok" }],
  "enter": "rise|none", "exit": "end-0.5", "background": true, "eyebrow": "Dashboard"
}
```
- `fill` (0–1) = how much of the frame the target should fill; `zoom` overrides (1 = window scale).
- Spotlights dim everything but the target; keep one spotlight at a time.
- Callouts anchor on a frame edge according to `side`. Keep text under ~60 characters.
- A cursor key moves during `duration` frames and arrives at `at`; a second key with `click: true`
  at the same place presses. Put a `click` sfx at the same time.
- `typing` draws a field over the capture: use the `frame` of the input and a `size` close to the app's font size.
- To show a state change, add a second capture in `views` (the image cross-fades).

## Bullets
`{ eyebrow?, title?, accent?: string[], layout?: "list"|"grid", start?: 0.4, every?: 0.9,
   items: [{ text, detail?, icon?, at? }] }` — icons: check, arrow, plus, x, doc, mail, folder, bell,
lock, star, search, chart, clock, user, users, settings, bolt, link, cloud, shield, play, camera,
sparkle, calendar, card, cart, home, phone, layers, refresh, download, upload, eye, globe, heart.

## Statement
`{ text, at?, accent?: string[], eyebrow?, author?, dark?: boolean, size?: number }` — one big sentence.

## Compare
`{ eyebrow?, title?, at?, strikeLeft?: true, left: { title, items: string[], tone?, icon?, at? }, right: { … } }`
Left column items get struck through (before / after).

## Steps
`{ eyebrow?, title?, start?, every?, current?: number, steps: [{ title, text?, icon?, at? }] }` — numbered process.

## Outro
`{ title?, text?, url?, logo?, cta?, footnote?, dark?: true, at? }` — brand, one line, call to action.

## Placeholder
Shown for unknown components: scene id and the spoken word, to time an edit before the visuals exist.

## Theme (showmystuff.json)
```json
"theme": { "preset": "paper|snow|slate", "colors": { "accent": "#b8512a" }, "fonts": { "display": "Georgia, serif" }, "texture": "dots|none", "radius": 4 }
```
Colour keys: bg, bgDeep, surface, surfaceAlt, line, ink, muted, accent, accentSoft, accentBright,
secondary, secondarySoft, ok, okSoft, okDot, warn, warnSoft, warnDot, danger, dangerSoft, dark,
darkDeep, onDark, onDarkMuted, gold, goldSoft, white.
