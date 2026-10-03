---
name: sms
description: Make a narrated demo video of the user's software (screenshots of the real app, motion-design scenes, voice-over, music, subtitles, MP4). Use when asked to show, present, demo or record a product, app or feature as a video.
---

# Show My Stuff (SMS)

You produce a polished demo video from the user's software with ready-made tools. Do not rewrite
the pipeline: every heavy step is a command. Spend tokens on the story, the screenshots and the
scenario, not on code.

## 0. Locate the toolkit (once per session)

```bash
SMS_HOME="${SMS_HOME:-${CLAUDE_PLUGIN_ROOT:-$HOME/.showmystuff}}"
[ -x "$SMS_HOME/bin/sms" ] || { curl -fsSL https://raw.githubusercontent.com/adriendesportes/showmystuff/main/install.sh | SMS_NO_SETUP=1 bash; SMS_HOME="$HOME/.showmystuff"; }
alias sms="$SMS_HOME/bin/sms"
sms doctor
```

If `sms doctor` reports a blocking problem, run `sms setup` (installs npm deps, a Python venv and
Chromium), then `sms doctor` again. Tell the user what is missing only if setup cannot fix it
(for example ffmpeg). If a `~/.local/bin/sms` link exists, plain `sms` works too.

## 1. Brief (keep it short)

Ask only what you cannot infer; propose defaults in the same message:
- What software, which audience, which 3 to 6 things must be seen. Target length: 60 to 180 s.
- How to reach the app locally (URL, login, demo data). **Only capture local instances or demo
  data.** Never screenshot real customer data; if the app needs a login, prefer a demo account.
- Language of the voice and subtitles; voice provider:
  - `edge` (default, free, online, good quality, word timings),
  - `say` (macOS, fully offline) or `piper` (offline, needs a model),
  - `elevenlabs` (premium): key via `sms key elevenlabs` or `ELEVENLABS_API_KEY`, never in a file of the project.
- Theme: `paper` (warm light), `snow` (clean light), `slate` (dark). Brand name, logo (SVG/PNG), URL.

## 2. Project

```bash
sms init <folder> --name <slug> --lang <en|fr|…> --theme <paper|snow|slate>
```
Edit `showmystuff.json` (brand, output) and `capture-plan.json` (see
`references/capture-plan.md`). Add a logo under `public/assets/`.

## 3. Screenshots of the real application

Write `capture-plan.json`: one capture per screen state, each with **named frames** (CSS selectors
of the elements the camera will zoom on). Then:

```bash
sms capture            # → public/captures/<id>.png + captures.json (frame boxes)
```

Look at a couple of PNGs (Read tool) to check that nothing confidential or broken is visible.
Use `forbidden` in the plan to make the tool refuse captures containing given strings.
If the site is static HTML, `"serve": "./folder"` serves it. Remote URLs need `--allow-remote`.

## 4. Scenario

Write `scenario.json`: the voice-over text per scene with `{{cues}}` where the image should react,
and props for the built-in scenes. Read `references/scenario.md` (format and rules) and
`references/scenes.md` (built-in scenes and their props) **before** writing it. Key rules:
- One idea per scene, 8 to 25 s each. Sentences short and spoken, present tense.
- Put a `{{cue}}` before the word that should trigger each visual change; every `at` in props and
  sfx is a time expression: `"cue:name"`, `"cue:name+0.5"`, `"end-1"`, or seconds.
- Alternate: Title → Chapter → Screen scenes (real captures with camera moves, spotlights,
  callouts, cursor, typing) → Bullets/Compare/Steps/Statement for ideas → Outro.
- Do not invent product facts. Use the user's words for features.

## 5. Build

```bash
sms build              # voice → timeline → sfx → music → mix → render → check
```
First build of a project: run the steps separately (`sms voice`, `sms timeline`, then
`sms stills --scenes --sheet`) and **look at the contact sheets** in `out/stills/` with the Read
tool before rendering. Fix framing (frames, `fill`, `zoom`), overlaps, text that is cut.
Then `sms render` (and `sms render --subtitles` for a burned-in version). `sms check` verifies the MP4.

Rebuilds are cheap: voices are cached per sentence, music and sfx are deterministic.
Changing one sentence = `sms voice && sms timeline && sms music && sms mix && sms render`.

## 6. Deliver

Report: output path, duration, voice used, and what the user may want to tweak (text of a scene,
a frame, the theme). Offer `sms preview` (interactive player with sound) for a review.

## Commands (all accept `--project <dir>`)

| Command | Purpose |
|---|---|
| `sms doctor [--url URL]` | environment check, real headless screenshot test, voices available |
| `sms setup` | install dependencies (idempotent) |
| `sms init <dir>` | scaffold a project |
| `sms capture [plan] [--only id] [--serve dir]` | screenshots + frame measurements |
| `sms voices <edge|say|elevenlabs|piper> [--lang fr]` | list voices |
| `sms voice [--only ids] [--force]` | synthesise the voice-over (cached) |
| `sms timeline [--strict]` | timeline, subtitles (SRT + burn-in data), audio plans; validates cues |
| `sms sfx` · `sms music [--seed N]` · `sms mix` | audio generation |
| `sms audio` | the four audio steps in order |
| `sms stills --scenes --sheet` / `--scene ID --every 0.5` | review frames |
| `sms render [--subtitles] [--from f --to f]` | MP4 (H.264, AAC, soft subtitles) |
| `sms build` | audio + render + check |
| `sms preview` | interactive player (space, arrows) |
| `sms check` | ffprobe the output |

## Custom scenes

When a built-in scene cannot express an idea, add a React scene in `<project>/scenes/index.tsx`
(see `references/custom-scenes.md`). Keep it a pure function of the frame; use `useAt()` for cues.

## Safety

- Capture only local or demo environments; never store keys or tokens in the project; the
  ElevenLabs key lives in the OS keychain or an environment variable.
- Everything the user may publish must be checkable: list the captures used and the voice provider
  in your final message.
