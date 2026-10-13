#!/usr/bin/env bash
#
# Makes a board come back into the Swarm after a power cut. Idempotent; run on every board (sudo):
#
#   scp infra/pi/{clock-before-docker.sh,swarm-heal.sh} pi@HOST:/tmp/ && ssh -t pi@HOST 'sudo bash /tmp/clock-before-docker.sh [--dry-run]'
#
# The problem (seen in the failover rehearsal): the Pi has no battery clock, so after a cold start the date is the last saved one,
# months back. dockerd starts, sees the Swarm root certificate as "not yet valid" and leaves the cluster (Swarm: error) until
# someone restarts it. docker-prep.sh already made dockerd wait for time-sync.target — but that target is reached at once unless
# a *wait* unit is enabled, so nothing waited. This script:
#   1. enables the wait unit of whichever sync daemon the board runs (chrony-wait.service, or systemd-time-wait-sync.service
#      for timesyncd) with TimeoutStartSec=120, so a board without internet still starts Docker after two minutes;
#   2. keeps the docker.service drop-in (After=/Wants=time-sync.target);
#   3. installs pipe-swarm-heal.timer: every 2 minutes, if Swarm is in `error` and the clock is synchronised, restart Docker
#      (a net for when step 1 timed out, or the daemon was too slow).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DRY=0; [ "${1:-}" = --dry-run ] && DRY=1
ROOT="${ROOT:-}"   # test hook: a directory standing in for /
log() { echo "[$(date +%T)] $*"; }
run() { if [ "$DRY" = 1 ]; then echo "  would: $*"; else "$@"; fi; }
put() { # file content
  if [ "$DRY" = 1 ]; then echo "  would write $1"; else mkdir -p "$(dirname "$1")"; printf '%s' "$2" > "$1"; fi
}

[ "$DRY" = 1 ] || [ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }

if systemctl is-active --quiet chrony 2>/dev/null; then WAIT=chrony-wait.service
elif systemctl is-active --quiet systemd-timesyncd 2>/dev/null; then WAIT=systemd-time-wait-sync.service
else echo "no time-sync daemon (chrony / systemd-timesyncd) is running here — fix that first" >&2; exit 1; fi
log "sync daemon found; wait unit: $WAIT"

put "$ROOT/etc/systemd/system/$WAIT.d/10-timeout.conf" $'[Service]\nTimeoutStartSec=120\n'
put "$ROOT/etc/systemd/system/docker.service.d/10-time-sync.conf" $'[Unit]\nAfter=time-sync.target\nWants=time-sync.target\n'
run systemctl enable "$WAIT"

run mkdir -p "$ROOT/usr/local/sbin"
run install -m 755 "$HERE/swarm-heal.sh" "$ROOT/usr/local/sbin/pipe-swarm-heal"
put "$ROOT/etc/systemd/system/pipe-swarm-heal.service" $'[Unit]\nDescription=Restart Docker if it started with a wrong clock and stayed out of the Swarm\n\n[Service]\nType=oneshot\nExecStart=/usr/local/sbin/pipe-swarm-heal\n'
put "$ROOT/etc/systemd/system/pipe-swarm-heal.timer" $'[Unit]\nDescription=Check that this board is in the Swarm\n\n[Timer]\nOnBootSec=3min\nOnUnitActiveSec=2min\n\n[Install]\nWantedBy=timers.target\n'
run systemctl daemon-reload
run systemctl enable --now pipe-swarm-heal.timer
log "done: after a power cut Docker now waits (up to 2 min) for the clock, and the timer repairs the rest"
