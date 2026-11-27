#!/usr/bin/env bash
#
# Installs the external watcher on THIS machine — the cloud VM, not a Pi (sudo, idempotent):
#
#   scp -r infra/watchdog USER@VM:/tmp/ && ssh -t USER@VM 'sudo bash /tmp/watchdog/install.sh [--dry-run] [--remove]'
#
#   /usr/local/lib/pipe-watchdog/bridge-watch.sh
#   /etc/pipe-watchdog.env                settings template (mode 600), created only if missing — YOU put the ntfy topic in it
#   pipe-watchdog.timer                   every minute
# Needs curl. Read-only on everything: it only asks bridge's public addresses and sends a message when they stop answering.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${ROOT:-}"   # test hook: a directory standing in for /
DRY=0; REMOVE=0
for a in "$@"; do case "$a" in --dry-run) DRY=1;; --remove) REMOVE=1;; *) echo "unknown argument: $a" >&2; exit 2;; esac; done
log() { echo "[$(date +%T)] $*"; }
run() { if [ "$DRY" = 1 ]; then echo "  would: $*"; else "$@"; fi; }
put() { if [ "$DRY" = 1 ]; then echo "  would write $1"; else mkdir -p "$(dirname "$1")"; printf '%s' "$2" > "$1"; fi; }

[ "$DRY" = 1 ] || [ -n "$ROOT" ] || [ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }

LIB="$ROOT/usr/local/lib/pipe-watchdog"
ENVF="$ROOT/etc/pipe-watchdog.env"
UNITS="$ROOT/etc/systemd/system"

if [ "$REMOVE" = 1 ]; then
  run systemctl disable --now pipe-watchdog.timer 2>/dev/null || true
  run rm -f "$UNITS/pipe-watchdog.service" "$UNITS/pipe-watchdog.timer"
  run rm -rf "$LIB"
  run systemctl daemon-reload
  log "removed (the settings file $ENVF and the state in /var/lib/pipe-watchdog are left)"
  exit 0
fi

if [ -z "$ROOT" ]; then
  command -v curl >/dev/null || { echo "curl is missing" >&2; exit 1; }
fi

run mkdir -p "$LIB"
run install -m 755 "$HERE/bridge-watch.sh" "$LIB/bridge-watch.sh"

if [ ! -e "$ENVF" ]; then
  put "$ENVF" $'# Settings of the external watcher (infra/watchdog). Mode 600: the ntfy topic below is a secret (anyone who knows it can read and write it).\n#\n# Where to speak: a topic nobody can guess — `openssl rand -hex 12` — on https://ntfy.sh (subscribe to it in the ntfy app on the phone).\nNTFY_URL=\n# Also forward every message to e-mail through ntfy (optional):\n#NTFY_EMAIL=you@example.com\n#\n# What to ask (space-separated; the …/api/v1/health address must answer "database":true):\n#HOSTS="https://bridge.ntlstl.dev/ https://api.bridge.ntlstl.dev/api/v1/health"\n#DEAD_AFTER_MIN=10\n#REMIND_HOURS=6\n#\n# A dead man\'s hand for THIS machine: a healthchecks.io check (period 1 minute, grace ~10), pinged on every pass.\n#HEARTBEAT_URL=\n#VANTAGE=yc-vm\n'
  [ "$DRY" = 1 ] || chmod 600 "$ENVF"
  log "created $ENVF — put NTFY_URL in it (sudoedit), then check it: sudo $LIB/bridge-watch.sh test"
else
  log "$ENVF exists — left as it is"
fi

put "$UNITS/pipe-watchdog.service" $'[Unit]\nDescription=Ask bridge\'s public addresses from outside the home network; speak (ntfy) when they stop answering\nAfter=network-online.target\n\n[Service]\nType=oneshot\nExecStart=/usr/local/lib/pipe-watchdog/bridge-watch.sh\nNice=10\nTimeoutStartSec=90\n'
put "$UNITS/pipe-watchdog.timer" $'[Unit]\nDescription=Run the external watcher every minute\n\n[Timer]\nOnBootSec=1min\nOnUnitActiveSec=1min\nAccuracySec=10s\n\n[Install]\nWantedBy=timers.target\n'
run systemctl daemon-reload
run systemctl enable --now pipe-watchdog.timer
log "installed. Next: put NTFY_URL in $ENVF and run: sudo $LIB/bridge-watch.sh test"
