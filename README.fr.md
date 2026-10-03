# Show My Stuff (SMS)

**Transformez votre logiciel en vidéo de démonstration commentée, depuis Claude Code ou le terminal.**

De vraies captures de votre application filmées par une caméra virtuelle, des scènes de motion
design pour les idées, une voix off (voix gratuite en ligne, voix entièrement locale, ou ElevenLabs),
une musique originale générée, des bruitages, des sous-titres, et un MP4 en 1080p. Tout est
scripté : refaire une vidéo après un changement de texte prend quelques commandes et presque
aucun token.

[English version](README.md)

## Installation (une commande)

```bash
curl -fsSL https://raw.githubusercontent.com/adriendesportes/showmystuff/main/install.sh | bash
```

Le script clone l'outil dans `~/.showmystuff`, installe ses dépendances (paquets npm, environnement
Python, Chromium sans fenêtre), relie la commande `sms` dans `~/.local/bin` et le skill `/sms` dans
`~/.claude/skills`. Prérequis : Node ≥ 20, Python ≥ 3.10, ffmpeg, git.

Vous préférez le plugin Claude Code ? Dans Claude Code :

```
/plugin marketplace add adriendesportes/showmystuff
/plugin install showmystuff@showmystuff
```

Tapez ensuite `/sms` et décrivez le logiciel à montrer. Le skill installe l'outil à la première
utilisation si besoin.

## Depuis Claude Code

```
/sms  Je veux une vidéo de 2 minutes de mon appli de notes d'équipe sur http://localhost:3000.
      Public : nouveaux utilisateurs. Montrer le tableau de bord, la création d'une note et son partage.
      Voix française, thème sombre.
```

Le skill vérifie la machine (`sms doctor`), capture l'application, écrit le scénario avec vous,
fabrique l'audio, rend le fichier et vous montre des planches-contact à relire avant le rendu final.

## Depuis le terminal

```bash
sms doctor                              # la machine peut-elle capturer, parler et rendre ?
sms init ma-demo --lang fr --theme snow # un dossier de projet avec un scénario modèle
cd ma-demo
#   éditer capture-plan.json  (quels écrans, quels éléments cadrer)
sms capture                             # captures + cadres mesurés → public/captures/
#   éditer scenario.json      (texte de la voix avec {{repères}}, scènes, bruitages)
sms build                               # voix → chronologie → bruitages → musique → mixage → rendu → out/ma-demo.mp4
sms stills --scenes --sheet             # planches-contact à relire, out/stills/
sms preview                             # lecteur interactif avec le son
```

Exemple fourni : `cd examples/hello && sms capture && sms build`.

## Comment la vidéo est fabriquée

```
capture-plan.json ─► sms capture ──► public/captures/*.png + captures.json (cadres nommés)
scenario.json ─────► sms voice ────► build/voice/<scène>.wav + mots horodatés + repères
                 └─► sms timeline ─► build/timeline.json · sous-titres · plans audio
                     sms sfx / music / mix ─► build/audio/mix.wav   (−16 LUFS, musique baissée sous la voix)
                     sms render ───► out/<nom>.mp4  (H.264 1080p30, AAC, sous-titres ; --subtitles les incruste)
```

- **Scènes** : composants React rendus image par image dans Chromium (déterministe, aucune
  animation CSS). Intégrées : `Title`, `Chapter`, `Screen` (capture réelle + caméra, projecteurs,
  bulles, curseur, saisie, notifications), `Bullets`, `Statement`, `Compare`, `Steps`, `Outro`.
  Ajoutez les vôtres dans `scenes/index.tsx`.
- **Repères** : écrivez `{{nom}}` dans le texte de la voix ; chaque événement visuel s'exprime en
  `"cue:nom+0.5"`. Changez une phrase, les animations suivent.
- **Voix** : `edge:<voix>` (voix Microsoft Edge, gratuites, en ligne, mots horodatés),
  `say:<voix>` (macOS, hors ligne), `piper:<modèle.onnx>` (neuronale hors ligne),
  `elevenlabs:<modèle>:<voice_id>` (premium ; clé rangée par `sms key elevenlabs`, jamais dans le projet).
- **Musique** synthétisée d'après un plan dérivé des scènes (intensité par scène, accents sur les
  chapitres) ; **bruitages** synthétisés aussi. Aucun échantillon, aucun problème de licence.
- **Thèmes** : `paper` (clair chaud), `snow` (clair net), `slate` (sombre), plus toute couleur ou police.

## Confidentialité et sécurité

- Ne capturez que des instances locales ou des données de démonstration ; l'outil de capture refuse
  les URL non locales sans `--allow-remote`, et refuse les pages contenant les motifs `forbidden`
  que vous définissez.
- Aucune clé n'est jamais écrite dans un projet. `sms key elevenlabs` range la clé ElevenLabs dans le
  trousseau macOS (sous Linux : `~/.config/showmystuff/elevenlabs.key`, mode 600) ; la variable
  `ELEVENLABS_API_KEY` fonctionne aussi.
- Les fichiers générés (`build/`, `out/`, audio) sont ignorés par Git dans le modèle de projet.

## Licence

MIT. Polices : Fraunces, Inter, JetBrains Mono (SIL Open Font License, installées via npm).
Outils : React, Vite, Playwright, ffmpeg, numpy, scipy, pyloudnorm, edge-tts.
