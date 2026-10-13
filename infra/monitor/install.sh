#!/usr/bin/env bash
#
# Installs the monitoring on THIS board (sudo, idempotent):
#
#   scp -r infra/monitor pi@HOST:/tmp/ && ssh -t pi@HOST 'sudo bash /tmp/monitor/install.sh [--watch-primary] [--dry-run]'
#
#   every board:   pipe-resource-check.timer  (every 5 min)   — load, memory, disk, heat/throttling, Swarm membership → Telegram
#   --watch-primary (blue only):  pipe-primary-watch.timer (every minute) — watches the board that holds the stack; tells you, with the
#                                 command, when it stops answering. Do NOT enable it on white (it cannot see its own death) or on red.
# Needs /usr/local/bin/notify-telegram (infra/notify). Messages only on a confirmed problem and on recovery.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${ROOT:-}"   # test hook: a directory standing in for /
WATCH=0; DRY=0
for a in "$@"; do case "$a" in --watch-primary) WATCH=1;; --dry-run) DRY=1;; *) echo "unknown argument: $a" >&2; exit 2;; esac; done
log() { echo "[$(date +%T)] $*"; }
run() { if [ "$DRY" = 1 ]; then echo "  would: $*"; else "$@"; fi; }
put() { if [ "$DRY" = 1 ]; then echo "  would write $1"; else mkdir -p "$(dirname "$1")"; printf '%s' "$2" > "$1"; fi; }

[ "$DRY" = 1 ] || [ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
if [ -z "$ROOT" ] && [ ! -x /usr/local/bin/notify-telegram ]; then
  echo "WARNING: /usr/local/bin/notify-telegram is missing — alerts would only go to the journal (install infra/notify first)" >&2
fi

LIB="$ROOT/usr/local/lib/pipe-monitor"
run mkdir -p "$LIB"
run install -m 755 "$HERE/monitor-lib.sh" "$HERE/resource-check.sh" "$HERE/primary-watch.sh" "$LIB/"
run mkdir -p "$ROOT/var/lib/pipe-monitor"

unit() { # name description script interval
  put "$ROOT/etc/systemd/system/$1.service" $'[Unit]\nDescription='"$2"$'\n\n[Service]\nType=oneshot\nExecStart=/usr/local/lib/pipe-monitor/'"$3"$'\n'
  put "$ROOT/etc/systemd/system/$1.timer" $'[Unit]\nDescription='"$2"$'\n\n[Timer]\nOnBootSec=3min\nOnUnitActiveSec='"$4"$'\nAccuracySec=10s\n\n[Install]\nWantedBy=timers.target\n'
}
unit pipe-resource-check "Is this board healthy (load, memory, disk, heat, Swarm)" resource-check.sh 5min
run systemctl daemon-reload
run systemctl enable --now pipe-resource-check.timer
log "resource check: every 5 minutes"

if [ "$WATCH" = 1 ]; then
  unit pipe-primary-watch "Does the board holding the bridge stack still answer" primary-watch.sh 1min
  run systemctl daemon-reload
  run systemctl enable --now pipe-primary-watch.timer
  log "primary watch: every minute (this board is the observer)"
else
  run systemctl disable --now pipe-primary-watch.timer 2>/dev/null || true
fi
