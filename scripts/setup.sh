#!/usr/bin/env bash
# Installs everything Show My Stuff needs, idempotently:
#   - engine npm dependencies (React, Vite, Playwright, fonts)
#   - a Python virtual environment with the audio dependencies
#   - the Playwright Chromium build (unless a system Chrome is preferred with --no-chromium)
# Usage: bash scripts/setup.sh [--no-chromium] [--python /path/to/python3]
set -euo pipefail

SMS_HOME="${SMS_HOME:-$(cd "$(dirname "$0")/.." && pwd)}"
NO_CHROMIUM=0
PYTHON_BIN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-chromium) NO_CHROMIUM=1 ;;
    --python) PYTHON_BIN="$2"; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\n\033[1m› %s\033[0m\n' "$*"; }

# ---- Node ----------------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js >= 20 is required (https://nodejs.org). Aborting." >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 20 )); then
  echo "Node.js >= 20 is required (found $(node --version)). Aborting." >&2
  exit 1
fi

say "Engine dependencies (npm)"
cd "$SMS_HOME/engine"
if [[ -f package-lock.json ]]; then npm ci --no-audit --no-fund --loglevel error; else npm install --no-audit --no-fund --loglevel error; fi

# ---- Python --------------------------------------------------------------------------------
say "Python environment"
cd "$SMS_HOME"
pick_python() {
  if [[ -n "$PYTHON_BIN" ]]; then echo "$PYTHON_BIN"; return; fi
  for c in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$c" >/dev/null 2>&1; then
      if "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then echo "$c"; return; fi
    fi
  done
  echo ""
}
PY="$(pick_python)"
if [[ -z "$PY" ]]; then
  echo "Python >= 3.10 is required (https://www.python.org or 'brew install python'). Aborting." >&2
  exit 1
fi
if [[ ! -x .venv/bin/python && ! -x .venv/Scripts/python.exe ]]; then
  if command -v uv >/dev/null 2>&1; then uv venv --python "$PY" .venv >/dev/null; else "$PY" -m venv .venv; fi
fi
VPY=".venv/bin/python"; [[ -x "$VPY" ]] || VPY=".venv/Scripts/python.exe"
if command -v uv >/dev/null 2>&1; then
  uv pip install --python "$VPY" -q -r audio/requirements.txt
else
  "$VPY" -m pip install -q --upgrade pip
  "$VPY" -m pip install -q -r audio/requirements.txt
fi
echo "python: $("$VPY" --version) in $SMS_HOME/.venv"

# ---- Browser -------------------------------------------------------------------------------
if (( NO_CHROMIUM == 0 )); then
  say "Chromium for Playwright (screenshots and rendering)"
  cd "$SMS_HOME/engine"
  npx --no-install playwright install chromium
else
  echo "Skipping Chromium download: the system Chrome/Edge will be used."
fi

# ---- ffmpeg --------------------------------------------------------------------------------
say "ffmpeg"
if command -v ffmpeg >/dev/null 2>&1; then
  ffmpeg -version | head -1
else
  echo "ffmpeg is NOT installed. Install it: macOS 'brew install ffmpeg', Debian/Ubuntu 'sudo apt install ffmpeg', Windows 'winget install ffmpeg'." >&2
fi

say "Done. Run: $SMS_HOME/bin/sms doctor"
