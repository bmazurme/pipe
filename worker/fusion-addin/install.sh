#!/usr/bin/env bash
#
# Puts the pipe add-in where Autodesk Fusion 360 looks for add-ins on macOS.
#
#   ./install.sh            copy the add-in (run it again after updating the repository)
#   ./install.sh --link     link the folder instead of copying (for work on the add-in itself)
#   ./install.sh --remove   take it out again
#
# Then, in Fusion 360: Utilities → Add-Ins → Scripts and Add-Ins (Shift+S) → Add-Ins → PipeFusion → «Run on Startup» and Run.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/PipeFusion" && pwd)"
DEST_DIR="${FUSION_ADDINS_DIR:-$HOME/Library/Application Support/Autodesk/Autodesk Fusion 360/API/AddIns}"
DEST="$DEST_DIR/PipeFusion"

case "${1:-}" in
  --remove)
    rm -rf "$DEST"
    echo "removed $DEST"
    exit 0
    ;;
  --link|"") ;;
  *) echo "usage: $0 [--link|--remove]" >&2; exit 2 ;;
esac

if [ ! -d "$(dirname "$DEST_DIR")" ] && [ -z "${FUSION_ADDINS_DIR:-}" ]; then
  echo "Fusion 360 does not seem to be installed for this user (no $(dirname "$DEST_DIR")). Start Fusion once, or set FUSION_ADDINS_DIR." >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
rm -rf "$DEST"

if [ "${1:-}" = "--link" ]; then
  ln -s "$SRC" "$DEST"
  echo "linked $DEST -> $SRC"
else
  cp -R "$SRC" "$DEST"
  rm -rf "$DEST/__pycache__"
  echo "copied to $DEST"
fi

echo "Next: in Fusion 360 open Scripts and Add-Ins (Shift+S), pick PipeFusion under Add-Ins, tick «Run on Startup» and press Run."
