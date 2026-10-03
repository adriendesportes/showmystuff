#!/usr/bin/env bash
# One-command install of Show My Stuff:
#   curl -fsSL https://raw.githubusercontent.com/adriendesportes/showmystuff/main/install.sh | bash
# What it does (idempotent):
#   1. clones or updates the repository into $SMS_HOME (default ~/.showmystuff)
#   2. installs dependencies (npm, Python venv, Chromium)
#   3. links the `sms` command into ~/.local/bin
#   4. links the Claude Code skill into ~/.claude/skills/sms
# Options: SMS_HOME=/custom/path, SMS_REF=v0.1.0 (branch or tag), SMS_NO_SETUP=1 (skip dependencies)
set -euo pipefail

REPO="${SMS_REPO:-https://github.com/adriendesportes/showmystuff.git}"
SMS_HOME="${SMS_HOME:-$HOME/.showmystuff}"
REF="${SMS_REF:-main}"

say() { printf '\n\033[1m› %s\033[0m\n' "$*"; }

if ! command -v git >/dev/null 2>&1; then echo "git is required." >&2; exit 1; fi

if [[ -d "$SMS_HOME/.git" ]]; then
  say "Updating $SMS_HOME"
  git -C "$SMS_HOME" fetch --quiet --tags origin
  git -C "$SMS_HOME" checkout --quiet "$REF"
  if git -C "$SMS_HOME" symbolic-ref -q HEAD >/dev/null; then git -C "$SMS_HOME" pull --quiet --ff-only origin "$REF"; fi
else
  say "Cloning into $SMS_HOME"
  git clone --quiet --branch "$REF" "$REPO" "$SMS_HOME"
fi

if [[ "${SMS_NO_SETUP:-0}" != "1" ]]; then
  bash "$SMS_HOME/scripts/setup.sh"
fi

say "Linking the sms command"
mkdir -p "$HOME/.local/bin"
ln -sfn "$SMS_HOME/bin/sms" "$HOME/.local/bin/sms"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) echo "Add ~/.local/bin to your PATH, e.g.:  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac

say "Linking the Claude Code skill"
mkdir -p "$HOME/.claude/skills"
if [[ -d "$HOME/.claude/skills/sms" && ! -L "$HOME/.claude/skills/sms" ]]; then
  echo "~/.claude/skills/sms already exists as a real folder: left untouched (remove it to link the toolkit's skill)."
else
  ln -sfn "$SMS_HOME/skills/sms" "$HOME/.claude/skills/sms"
  echo "Skill available as /sms in Claude Code (restart Claude Code if it is running)."
fi

say "Checking the environment"
"$SMS_HOME/bin/sms" doctor || true

cat <<MSG

Show My Stuff is installed.
  Shell:       sms doctor · sms init my-demo · sms build
  Claude Code: type /sms and describe the software you want to show.
MSG
