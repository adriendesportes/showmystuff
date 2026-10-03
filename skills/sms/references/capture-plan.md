# capture-plan.json

```json
{
  "baseUrl": "http://localhost:3000",       // local only, unless --allow-remote (never capture real customer data)
  "serve": "./demo-site",                   // alternative: serve a static folder on a local port
  "viewport": { "width": 1440, "height": 900 }, "scale": 2,
  "locale": "en-US", "timezone": "UTC", "colorScheme": "light",
  "hideSelectors": ["#cookie-banner", ".intercom-launcher"],
  "css": ".debug-badge { display: none }",
  "forbidden": ["Real Customer Ltd", "\\b\\d{16}\\b"],    // regexes: a capture containing them is refused
  "settleMs": 300, "maxPageHeight": 6000, "storageState": "auth.json",
  "login": { "goto": "/login", "actions": [ { "fill": ["#email", "demo@example.test"] }, { "fill": ["#password", "demo"] }, { "click": "button[type=submit]" }, { "waitForUrl": "/dashboard" } ] },
  "captures": [
    {
      "id": "dashboard", "title": "Dashboard", "goto": "/dashboard", "fullPage": true,
      "actions": [ { "click": "text=Projects" }, { "wait": 400 } ],
      "frames": { "kpis": ".kpi-row", "table": "table", "first-row": "table tbody tr >> nth=0", "cta": "a.btn-primary" }
    }
  ]
}
```

- **Frames** are what the video camera zooms on, where spotlights go, where the cursor clicks and
  where typing is drawn. Name every element the voice-over will mention. Selectors follow Playwright
  syntax (`text=`, `>> nth=`, `role=button[name="Save"]`, CSS).
- One capture per **state**: before / after a click, filled / empty form. Reuse `goto` + `actions`.
- `fullPage: true` (default) captures the whole page by enlarging the viewport (sticky sidebars stay
  coherent); the Screen scene can then `scroll`.
- Login credentials in the plan must be demo credentials. For a session cookie, export a Playwright
  `storageState` file instead and reference it (keep it out of git).
- After capturing, open one or two PNGs to verify there is nothing unexpected.

Outputs: `public/captures/<id>.png` and `public/captures/captures.json`
(`{ id, url, width, viewportHeight, pageHeight, scale, frames: { name: { x, y, w, h } } }`).
