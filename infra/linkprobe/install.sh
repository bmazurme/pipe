#!/usr/bin/env bash
#
# Installs the channel probe on THIS machine (sudo, idempotent) — any place whose view of the VPN servers you want on the Dashboard:
# a Pi at home, the cloud VM, a laptop-turned-server, a beacon in another network.
#
#   scp -r infra/linkprobe USER@HOST:/tmp/ && ssh -t USER@HOST 'sudo bash /tmp/linkprobe/install.sh [--dry-run] [--remove]'
#
#   /usr/local/lib/pipe-linkprobe/probe.py   the probe
#   /etc/pipe-linkprobe.env                  settings (mode 600), created only if missing — YOU put the boards-only key in it
#   pipe-linkprobe.timer                     every minute
# Needs python3. Reads nothing but the channel list from bridge; changes nothing on the machine.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${ROOT:-}"   # test hook: a directory standing in for /
DRY=0; REMOVE=0
for a in "$@"; do case "$a" in --dry-run) DRY=1;; --remove) REMOVE=1;; *) echo "unknown argument: $a" >&2; exit 2;; esac; done
log() { echo "[$(date +%T)] $*"; }
run() { if [ "$DRY" = 1 ]; then echo "  would: $*"; else "$@"; fi; }
put() { if [ "$DRY" = 1 ]; then echo "  would write $1"; else mkdir -p "$(dirname "$1")"; printf '%s' "$2" > "$1"; fi; }

[ "$DRY" = 1 ] || [ -n "$ROOT" ] || [ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }

LIB="$ROOT/usr/local/lib/pipe-linkprobe"
ENVF="$ROOT/etc/pipe-linkprobe.env"

if [ "$REMOVE" = 1 ]; then
  run systemctl disable --now pipe-linkprobe.timer 2>/dev/null || true
  run rm -f "$ROOT/etc/systemd/system/pipe-linkprobe.service" "$ROOT/etc/systemd/system/pipe-linkprobe.timer"
  run rm -rf "$LIB"
  run systemctl daemon-reload
  log "removed (the settings file $ENVF is left; delete it yourself if the key in it is no longer needed)"
  exit 0
fi

[ -n "$ROOT" ] || command -v python3 >/dev/null || { echo "python3 is missing" >&2; exit 1; }

run mkdir -p "$LIB"
run install -m 755 "$HERE/probe.py" "$LIB/"

if [ ! -e "$ENVF" ]; then
  put "$ENVF" $'# Settings of the channel probe (infra/linkprobe). Mode 600: the key below can post to the owner\'s Dashboard.\n#\n# One or SEVERAL bridge addresses (space or comma separated), tried in order: a place whose network blocks one still reports through another.\nBRIDGE_API_URL="https://api.bridge.ntlstl.dev"\n# A boards-only personal API key of the OWNER (bridge: Профиль → API-ключи → «только для плат»). Never in chat, never in the repository.\nBRIDGE_API_KEY=\n# The name of this place in the tile (default: the hostname). Make it say where it is: home-white, yc-vm, hotel, phone-hotspot…\n#VANTAGE=home-white\n#PROBE_TIMEOUT=6\n'
  [ "$DRY" = 1 ] || chmod 600 "$ENVF"
  log "created $ENVF — put BRIDGE_API_KEY (and a VANTAGE name) in it (sudoedit), then: systemctl start pipe-linkprobe.service"
else
  log "$ENVF exists — left as it is"
fi

put "$ROOT/etc/systemd/system/pipe-linkprobe.service" $'[Unit]\nDescription=Probe the VPN channels from here and tell bridge\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=oneshot\nEnvironmentFile=-/etc/pipe-linkprobe.env\nExecStart=/usr/bin/python3 /usr/local/lib/pipe-linkprobe/probe.py\nNice=10\n'
put "$ROOT/etc/systemd/system/pipe-linkprobe.timer" $'[Unit]\nDescription=Probe the VPN channels, every minute\n\n[Timer]\nOnBootSec=1min\nOnUnitActiveSec=1min\nAccuracySec=5s\n\n[Install]\nWantedBy=timers.target\n'

run systemctl daemon-reload
run systemctl enable --now pipe-linkprobe.timer
log "channel probe: every minute → the Dashboard's «Каналы связи» tile"
