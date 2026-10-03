# Show My Stuff (SMS)

**Turn your software into a narrated demo video, from Claude Code or your terminal.**

Real screenshots of your app filmed by a virtual camera, motion-design scenes for the ideas,
a voice-over (free online voice, fully offline voice, or ElevenLabs), original generated music,
sound effects, subtitles, and a 1080p MP4. Everything is scripted: rebuilding a video after a text
change takes a few commands and almost no tokens.

[Version française](README.fr.md)

## Install (one command)

```bash
curl -fsSL https://raw.githubusercontent.com/adriendesportes/showmystuff/main/install.sh | bash
```

It clones the toolkit into `~/.showmystuff`, installs its dependencies (npm packages, a Python
virtual environment, a headless Chromium), links the `sms` command into `~/.local/bin` and the
`/sms` skill into `~/.claude/skills`. Requirements: Node ≥ 20, Python ≥ 3.10, ffmpeg, git.

Prefer the Claude Code plugin? Inside Claude Code:

```
/plugin marketplace add adriendesportes/showmystuff
/plugin install showmystuff@showmystuff
```

Then type `/sms` and describe the software you want to show. The skill installs the toolkit on
first use if needed.

## Use it from Claude Code

```
/sms  I want a 2-minute video of my invoicing app running at http://localhost:3000.
      Audience: new users. Show the dashboard, creating an invoice and the reminders page.
      French voice, dark theme.
```

The skill checks the machine (`sms doctor`), captures the app, writes the scenario with you, builds
the audio and renders the file, and shows you contact sheets to review before the final render.

## Use it from the terminal

```bash
sms doctor                              # can this machine capture, speak and render?
sms init my-demo --lang en --theme snow # a project folder with a template scenario
cd my-demo
#   edit capture-plan.json  (which screens, which elements to zoom on)
sms capture                             # screenshots + measured frames → public/captures/
#   edit scenario.json      (voice-over text with {{cues}}, scenes, sound effects)
sms build                               # voice → timeline → sfx → music → mix → render → out/my-demo.mp4
sms stills --scenes --sheet             # contact sheets to review, out/stills/
sms preview                             # interactive player with sound
```

Try the included example: `cd examples/hello && sms capture && sms build`.

## How a video is made

```
capture-plan.json ─► sms capture ──► public/captures/*.png + captures.json (named frames)
scenario.json ─────► sms voice ────► build/voice/<scene>.wav + timed words + cues
                 └─► sms timeline ─► build/timeline.json · subtitles · audio plans
                     sms sfx / music / mix ─► build/audio/mix.wav   (−16 LUFS, ducked under the voice)
                     sms render ───► out/<name>.mp4  (H.264 1080p30, AAC, soft subtitles; --subtitles burns them in)
```

- **Scenes** are React components rendered frame by frame in headless Chromium (deterministic,
  no CSS animation). Built in: `Title`, `Chapter`, `Screen` (real capture + camera, spotlights,
  callouts, cursor, typing, notifications), `Bullets`, `Statement`, `Compare`, `Steps`, `Outro`.
  Add your own in `scenes/index.tsx`.
- **Cues**: write `{{name}}` in the voice-over text; every visual event is expressed as
  `"cue:name+0.5"`. Change a sentence, the animations follow.
- **Voices**: `edge:<voice>` (Microsoft Edge voices, free, online, word timings),
  `say:<voice>` (macOS, offline), `piper:<model.onnx>` (offline neural), `elevenlabs:<model>:<voice_id>`
  (premium; key stored with `sms key elevenlabs`, never in the project).
- **Music** is synthesised from a plan derived from the scenes (intensity per scene, accents on
  chapters); **sound effects** are synthesised too. No sample, no licence issue.
- **Themes**: `paper` (warm light), `snow` (clean light), `slate` (dark), plus any colour or font override.

## Repository layout

| Folder | Content |
|---|---|
| `bin/sms` | command line (Node, no dependency) |
| `skills/sms/` | the Claude Code skill (`SKILL.md` + references) |
| `engine/` | renderer: React + Vite + Playwright + ffmpeg, design system, built-in scenes |
| `audio/` | Python chain: voice (`tts.py`), effects (`sfx.py`), music (`music.py`), mix (`mix.py`), checks |
| `capture/` | screenshot tool driven by `capture-plan.json` |
| `scripts/` | `doctor.mjs` (environment check), `setup.sh` (dependencies) |
| `templates/project/` | what `sms init` copies |
| `examples/hello/` | a complete example with a fake web app |

## Privacy and safety

- Capture only local instances or demo data; the capture tool refuses non-local URLs unless
  `--allow-remote`, and refuses pages containing `forbidden` patterns you define.
- No key is ever written into a project. ElevenLabs keys live in the OS keychain
  (`sms key elevenlabs`) or in `ELEVENLABS_API_KEY`.
- Generated files (`build/`, `out/`, audio) are git-ignored by the project template.

## Licence

MIT. Fonts: Fraunces, Inter, JetBrains Mono (SIL Open Font License, installed through npm).
Tools: React, Vite, Playwright, ffmpeg, numpy, scipy, pyloudnorm, edge-tts.
