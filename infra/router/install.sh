#!/usr/bin/env bash
#
# Installs the router agent on THIS board (blue; sudo, idempotent):
#
#   scp -r infra/router pi@HOST:/tmp/ && ssh -t pi@HOST 'sudo bash /tmp/router/install.sh [--dry-run] [--remove]'
#
#   /usr/local/lib/pipe-router/router-agent.sh      the agent
#   pipe-router-agent.timer                         every minute
#   /etc/pipe-router/id_ed25519                     a key made here, once, and kept (its public half is printed: add it to the router)
#   /etc/pipe-router.env                            the settings (made once from a template, never overwritten)
# Needs the board agent's /etc/pipe-boardagent.env (BRIDGE_API_URL and the boards-only BRIDGE_API_KEY), ssh, python3, curl.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${ROOT:-}"   # test hook: a directory standing in for /
DRY=0; REMOVE=0
for a in "$@"; do case "$a" in --dry-run) DRY=1;; --remove) REMOVE=1;; *) echo "unknown argument: $a" >&2; exit 2;; esac; done
log() { echo "[$(date +%T)] $*"; }
run() { if [ "$DRY" = 1 ]; then echo "  would: $*"; else "$@"; fi; }
put() { if [ "$DRY" = 1 ]; then echo "  would write $1"; else mkdir -p "$(dirname "$1")"; printf '%s' "$2" > "$1"; fi; }

[ "$DRY" = 1 ] || [ -n "$ROOT" ] || [ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }

LIB="$ROOT/usr/local/lib/pipe-router"
DIR="$ROOT/etc/pipe-router"
ENV_FILE="$ROOT/etc/pipe-router.env"

if [ "$REMOVE" = 1 ]; then
  run systemctl disable --now pipe-router-agent.timer 2>/dev/null || true
  run rm -f "$ROOT/etc/systemd/system/pipe-router-agent.service" "$ROOT/etc/systemd/system/pipe-router-agent.timer"
  run rm -rf "$LIB"
  run systemctl daemon-reload
  log "removed the agent and the timer; the key ($DIR) and the settings ($ENV_FILE) are left — delete them by hand, and take the key off the router"
  exit 0
fi

if [ -z "$ROOT" ]; then
  [ -r /etc/pipe-boardagent.env ] || echo "WARNING: /etc/pipe-boardagent.env is missing — the agent cannot authenticate to bridge (install infra/boardagent first)" >&2
  for tool in ssh ssh-keygen python3 curl flock; do command -v "$tool" >/dev/null || echo "WARNING: $tool is missing" >&2; done
fi

run mkdir -p "$LIB"
run install -m 755 "$HERE/router-agent.sh" "$LIB/"
run mkdir -p "$ROOT/var/lib/pipe-router"

# The key lives in a directory only root can enter. Made once: a second run keeps it, so the router does not have to be told again.
if [ "$DRY" = 1 ]; then
  echo "  would make $DIR/id_ed25519 if it is not there"
else
  mkdir -p "$DIR"; chmod 700 "$DIR"
  if [ ! -f "$DIR/id_ed25519" ]; then
    ssh-keygen -q -t ed25519 -N '' -C "pipe-router-agent@$(hostname)" -f "$DIR/id_ed25519"
    log "made a new key $DIR/id_ed25519"
  fi
fi

if [ ! -f "$ENV_FILE" ]; then
  put "$ENV_FILE" $'# Settings of the router agent (infra/router). BRIDGE_API_URL / BRIDGE_API_KEY come from /etc/pipe-boardagent.env.\nROUTER_HOST=192.168.50.1\nROUTER_USER=admin\n# ROUTER_PORT=22\n# ROUTER_NAME=router            # how the router is called in bridge\n# PING_TARGET=1.1.1.1           # what "the internet" is, for the check after a reboot\n# WAIT_UP_SEC=300               # how long to wait for the router and the internet to come back\n'
  [ "$DRY" = 1 ] || chmod 600 "$ENV_FILE"
fi

put "$ROOT/etc/systemd/system/pipe-router-agent.service" $'[Unit]\nDescription=Read the router and tell bridge; reboot it when asked\n\n[Service]\nType=oneshot\nExecStart=/usr/local/lib/pipe-router/router-agent.sh\n# a reboot waits for the router to come back: up to ~10 minutes\nTimeoutStartSec=900\n'
put "$ROOT/etc/systemd/system/pipe-router-agent.timer" $'[Unit]\nDescription=Read the router every minute\n\n[Timer]\nOnBootSec=2min\nOnUnitActiveSec=1min\nAccuracySec=5s\n\n[Install]\nWantedBy=timers.target\n'
run systemctl daemon-reload
run systemctl enable --now pipe-router-agent.timer

log "router agent: every minute"
if [ "$DRY" != 1 ] && [ -f "$DIR/id_ed25519.pub" ]; then
  echo
  echo "Add this public key to the router (web interface: Administration → System → «Authorized Keys», with SSH enabled for the LAN):"
  echo
  cat "$DIR/id_ed25519.pub"
  echo
  echo "Then check it: sudo $LIB/router-agent.sh probe"
fi
