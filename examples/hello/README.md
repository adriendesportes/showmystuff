# Example: Notely

A complete, self-contained project: a small fake web app (`demo-site/`, static HTML),
a capture plan, and a scenario that uses every built-in scene. Nothing here is real data.

```bash
cd examples/hello
sms capture            # screenshots of demo-site/ (served locally)
sms build              # voice (edge, free) → timeline → sfx → music → mix → render → out/hello.mp4
sms stills --scenes --sheet    # contact sheets in out/stills/ to review the result
```

To try an offline voice on macOS: set `"voice": "say:Samantha"` in `scenario.json`.
