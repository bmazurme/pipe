#!/usr/bin/env bash
#
# Installs the cloud VM's reporting agent on THIS machine (sudo, idempotent):
#
#   scp -r infra/cloudagent USER@VM:/tmp/ && ssh -t USER@VM 'sudo bash /tmp/cloudagent/install.sh [--dry-run] [--remove]'
#
#   /usr/local/lib/pipe-cloudagent/        report.sh + collect.py
#   /etc/pipe-cloudagent.env               settings template (mode 600), created only if missing — YOU put the boards-only key in it
#   pipe-cloudagent.timer                  every minute: report.sh → the Dashboard's «Облако (VM)» tile
# Needs python3 and curl; docker for the services section. Read-only on everything it looks at.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${ROOT:-}"   # test hook: a directory standing in for /
DRY=0; REMOVE=0
for a in "$@"; do case "$a" in --dry-run) DRY=1;; --remove) REMOVE=1;; *) echo "unknown argument: $a" >&2; exit 2;; esac; done
log() { echo "[$(date +%T)] $*"; }
run() { if [ "$DRY" = 1 ]; then echo "  would: $*"; else "$@"; fi; }
put() { if [ "$DRY" = 1 ]; then echo "  would write $1"; else mkdir -p "$(dirname "$1")"; printf '%s' "$2" > "$1"; fi; }

[ "$DRY" = 1 ] || [ -n "$ROOT" ] || [ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }

LIB="$ROOT/usr/local/lib/pipe-cloudagent"
ENVF="$ROOT/etc/pipe-cloudagent.env"

if [ "$REMOVE" = 1 ]; then
  run systemctl disable --now pipe-cloudagent.timer 2>/dev/null || true
  run rm -f "$ROOT/etc/systemd/system/pipe-cloudagent.service" "$ROOT/etc/systemd/system/pipe-cloudagent.timer"
  run rm -rf "$LIB"
  run systemctl daemon-reload
  log "removed (the settings file $ENVF is left; delete it yourself if the key in it is no longer needed)"
  exit 0
fi

if [ -z "$ROOT" ]; then
  command -v python3 >/dev/null || { echo "python3 is missing" >&2; exit 1; }
  command -v curl >/dev/null || { echo "curl is missing" >&2; exit 1; }
  command -v docker >/dev/null || echo "WARNING: docker is missing — the report will say Docker is down" >&2
fi

run mkdir -p "$LIB"
run install -m 755 "$HERE/report.sh" "$HERE/collect.py" "$LIB/"

if [ ! -e "$ENVF" ]; then
  put "$ENVF" $'# Settings of the cloud VM agent (infra/cloudagent). Mode 600: the key below can post to the owner\'s Dashboard.\n#\n# Where bridge answers — the PUBLIC address, so that after a failover the VM reports to whoever leads.\nBRIDGE_API_URL=https://api.bridge.ntlstl.dev\n# A boards-only personal API key of the OWNER (bridge: Профиль → API-ключи → «только для плат»). Never in chat, never in the repository.\nBRIDGE_API_KEY=\n\n# Name shown in the Dashboard (default: the hostname).\n#CLOUD_HOST=yc-vm\n# Plain containers to watch ("name" is critical, "name:opt" is not):\n#CONTAINERS="postgres bridge-pg pgadmin-4:opt minio:opt prometheus:opt coi-grafana-1:opt coi-loki-1:opt"\n# Swarm services whose name matches are critical:\n#CRITICAL_REGEX=\'^(bridge_|bridge-pg|notes_|places_)\'\n# Public addresses to ask ("url|1" critical, "url|0" not):\n#PROBES="https://api.bridge.ntlstl.dev/api/v1/health|1 https://notes.ntlstl.dev|0 https://ntlstl.dev|0"\n# Ports that must NOT listen on every interface:\n#EXPOSED_CHECK="5432"\n# Backups: the age of each file is the age of the copy.\n#BACKUP_FILES="bridge=/srv/backups/bridge/latest/meta.env notes=/srv/backups/notes/latest/meta.env"\n#CERT_FILES="api.bridge.ntlstl.dev=/etc/letsencrypt/live/api.bridge.ntlstl.dev/fullchain.pem"\n# The primary Postgres container: its standby\'s lag.\n#REPL_CONTAINER=bridge-pg\n#VERSION_FILE=/etc/pipe-cloudagent.version\n'
  [ "$DRY" = 1 ] || chmod 600 "$ENVF"
  log "created $ENVF — put BRIDGE_API_KEY in it (sudoedit), then: systemctl start pipe-cloudagent.service"
else
  log "$ENVF exists — left as it is"
fi

put "$ROOT/etc/systemd/system/pipe-cloudagent.service" $'[Unit]\nDescription=Tell bridge how the cloud VM and its services are doing\nAfter=docker.service network-online.target\n\n[Service]\nType=oneshot\nExecStart=/usr/local/lib/pipe-cloudagent/report.sh\nNice=10\n'
put "$ROOT/etc/systemd/system/pipe-cloudagent.timer" $'[Unit]\nDescription=Tell bridge how the cloud VM is doing, every minute\n\n[Timer]\nOnBootSec=1min\nOnUnitActiveSec=1min\nAccuracySec=5s\n\n[Install]\nWantedBy=timers.target\n'

run systemctl daemon-reload
run systemctl enable --now pipe-cloudagent.timer
log "cloud agent: every minute → the Dashboard's «Облако (VM)» tile"
