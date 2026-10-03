# scenario.json

```json
{
  "title": "Product — a short tour",
  "language": "en",                               // ISO code: voice language hint + subtitle rules
  "voice": "edge:en-US-AriaNeural",               // or "say:Samantha", "piper:/path/model.onnx",
                                                  //    "elevenlabs:eleven_v4:<voice_id>",
                                                  //    or {"provider":"edge","voice":"…","rate":"-5%","pitch":"+0Hz"}
  "music": { "bpm": 94, "seed": 3, "gain_db": 0, "enabled": true },
  "sfxGain": 0,                                   // global offset (dB) for all sound effects
  "chapters": [{ "num": 1, "title": "Why" }],     // used by Chapter scenes, the overlay tag and the progress bar
  "scenes": [ … ]
}
```

## A scene

```json
{
  "id": "s03-dashboard",                 // unique; used for file names and `sms stills --scene`
  "component": "Screen",                 // built-in or custom component name
  "chapter": 2,                          // optional: links to chapters[]
  "text": "This is the {{home}}dashboard. {{kpis}}Four numbers …",   // voice-over; omit for silent scenes
  "voice": "edge:en-US-GuyNeural",       // optional per-scene override
  "duration": 5,                         // seconds; otherwise computed from the voice (before + voice + after)
  "minDuration": 2,
  "before": 0.45, "after": 0.7,          // silence before / after the voice (s)
  "transition": { "type": "fade", "duration": 0.6 },   // cut | fade | slide | zoom | wipe | curtain
  "transitionSfx": true,                 // slide/wipe/curtain → whoosh, zoom → whoosh-short (default true)
  "music": 1,                            // intensity 0..3, inherited by the next scenes
  "accent": true,                        // musical accent on the scene start (impact)
  "voiceGain": 0,
  "props": { … },                        // component props (see scenes.md)
  "sfx": [ { "type": "pop", "at": "cue:kpis", "gain": -14, "pan": 0 },
           { "type": "key", "at": "cue:title", "n": 10, "interval": 0.07, "gain": -18 } ]
}
```

## Text mark-up

- `{{name}}` marks the start of the **following** word. Names: letters, digits, `-`, `_`. A repeated
  name becomes `name_2`. The marker is removed from the spoken text and the subtitles.
- `[shown|spoken]` makes the voice read "spoken" while subtitles show "shown":
  `[API|A P I]`, `[v2|version two]`, `[SQL|sequel]`.
- Keep sentences short; one breath per sentence. Numbers: write them as the voice should say them.

## Time expressions (`at`, `until`, `exit`)

| Value | Meaning |
|---|---|
| `2.5` | seconds from the scene start |
| `"cue:name"` | when the voice says the word after `{{name}}` |
| `"cue:name+0.5"` / `"cue:name-0.3"` | with an offset in seconds |
| `"voice"` | when the voice starts |
| `"start"`, `"end"`, `"end-1.2"` | scene boundaries |

`sms timeline` warns when a cue referenced in props or sfx does not exist in the text.

## Sound effects (`type`)

`whoosh`, `whoosh-short`, `click`, `pop`, `ding`, `tick`, `key` (burst with `n`, `interval`), `key-1..4`,
`riser`, `impact-soft`, `page`, `stamp`. Gains: 0 dB = present under the voice, −6 discreet, −12 subtle.

## Music

`music` on a scene sets the intensity until changed: 0 pad only, 1 + piano, 2 + bass & soft drums,
3 + arpeggio. `accent: true` adds a rise and a soft hit at the scene start (chapter cards, title,
outro). Change `music.seed` for another variation of the same cue sheet.

## Rhythm guidelines

- Title 4–6 s · Chapter 3–3.5 s · Screen 10–25 s · Bullets/Compare/Steps 10–20 s · Outro 5–7 s.
- 60–180 s total. One visual change every 2–4 s, driven by cues.
- A state the voice names should stay still at least 1.5 s before the next camera move.
