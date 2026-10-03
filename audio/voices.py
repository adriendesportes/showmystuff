#!/usr/bin/env python3
"""Lists the voices available for a provider.

Usage:
    python voices.py edge [--lang fr]          # free online voices (Microsoft Edge)
    python voices.py say                       # macOS built-in voices
    python voices.py elevenlabs [--search Rachel] [--add]
    python voices.py piper                     # models found in PIPER_MODELS or ~/.local/share/piper
"""
from __future__ import annotations

import argparse
import asyncio
import os
import subprocess
import sys
import urllib.parse
from pathlib import Path


def edge(lang: str) -> None:
    import edge_tts
    voices = asyncio.run(edge_tts.list_voices())
    rows = [v for v in voices if not lang or v["Locale"].lower().startswith(lang.lower())]
    rows.sort(key=lambda v: (v["Locale"], v["ShortName"]))
    for v in rows:
        tags = ", ".join(v.get("VoiceTag", {}).get("VoicePersonalities", [])[:3])
        print(f"  edge:{v['ShortName']:<36} {v['Gender']:<7} {tags}")
    print(f"{len(rows)} voice(s). Use e.g. \"voice\": \"edge:{rows[0]['ShortName']}\"" if rows else "no voice for this language")


def say() -> None:
    if sys.platform != "darwin":
        raise SystemExit("`say` exists only on macOS")
    out = subprocess.run(["say", "-v", "?"], capture_output=True, text=True).stdout
    for line in out.splitlines():
        print(f"  say:{line}")
    print("Use e.g. \"voice\": \"say:Samantha\" (System Settings → Accessibility → Spoken Content adds higher-quality voices).")


def elevenlabs(search: str, add: bool) -> None:
    from tts import elevenlabs_call
    models = elevenlabs_call("GET", "/v1/models")
    print("MODELS:")
    for m in models:
        if m.get("can_do_text_to_speech"):
            print(f"  {m['model_id']:<28} {m.get('name', '')}")
    q = urllib.parse.quote(search)
    mine = elevenlabs_call("GET", f"/v2/voices?search={q}&page_size=50")
    print("\nVOICES OF THE ACCOUNT:")
    for v in mine.get("voices", []):
        labels = v.get("labels", {}) or {}
        print(f"  elevenlabs:eleven_v4:{v['voice_id']}  {v['name']}  {labels.get('language', '')} {labels.get('accent', '')} {labels.get('gender', '')}")
    if search:
        shared = elevenlabs_call("GET", f"/v1/shared-voices?search={q}&page_size=20")
        print("\nSHARED LIBRARY:")
        for v in shared.get("voices", []):
            print(f"  {v['voice_id']}  {v['name']}  lang={v.get('language')} accent={v.get('accent')} use={v.get('use_case')}")
        if add and shared.get("voices") and not mine.get("voices"):
            v = shared["voices"][0]
            r = elevenlabs_call("POST", f"/v1/voices/add/{v['public_owner_id']}/{v['voice_id']}", {"new_name": v["name"]})
            print(f"\nVoice added to the account: {r}")


def piper() -> None:
    dirs = [Path(p) for p in os.environ.get("PIPER_MODELS", "").split(os.pathsep) if p] + [Path.home() / ".local/share/piper", Path.home() / "piper"]
    found = [m for d in dirs if d.exists() for m in d.rglob("*.onnx")]
    for m in found:
        print(f"  piper:{m}")
    print(f"{len(found)} model(s). Download voices from https://github.com/rhasspy/piper/blob/master/VOICES.md" if not found else "")


def main() -> None:
    p = argparse.ArgumentParser(description="Lists voices per provider.")
    p.add_argument("provider", choices=["edge", "say", "elevenlabs", "piper"])
    p.add_argument("--lang", default="", help="edge: locale prefix (fr, en-GB…)")
    p.add_argument("--search", default="", help="elevenlabs: name to search")
    p.add_argument("--add", action="store_true", help="elevenlabs: add the first shared voice found to the account")
    a = p.parse_args()
    {"edge": lambda: edge(a.lang), "say": say, "elevenlabs": lambda: elevenlabs(a.search, a.add), "piper": piper}[a.provider]()


if __name__ == "__main__":
    main()
