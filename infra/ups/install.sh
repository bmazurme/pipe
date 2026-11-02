#!/usr/bin/env bash
#
# Installs the UPS reporting and the Telegram alerts on THIS board — the one whose USB cable is in the UPS and which runs NUT as the master
# (sudo, idempotent):
#
#   scp -r infra/ups pi@HOST:/tmp/ && ssh -t pi@HOST 'sudo bash /tmp/ups/install.sh [--dry-run] [--remove]'
#
#   pipe-ups-report.timer   every minute: report.sh → the Dashboard's «ИБП» tile
#   /etc/nut/upsmon.conf    a marked block with NOTIFYCMD and NOTIFYFLAG … SYSLOG+EXEC (replaced on every run); nut-monitor is restarted
# Needs NUT (the master, MODE=netserver) with the UPS section «cyberpower», the board agent's /etc/pipe-boardagent.env (the boards-only key)
# and /usr/local/bin/notify-telegram (infra/notify).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${ROOT:-}"   # test hook: a directory standing in for /
DRY=0; REMOVE=0
for a in "$@"; do case "$a" in --dry-run) DRY=1;; --remove) REMOVE=1;; *) echo "unknown argument: $a" >&2; exit 2;; esac; done
log() { echo "[$(date +%T)] $*"; }
run() { if [ "$DRY" = 1 ]; then echo "  would: $*"; else "$@"; fi; }
put() { if [ "$DRY" = 1 ]; then echo "  would write $1"; else mkdir -p "$(dirname "$1")"; printf '%s' "$2" > "$1"; fi; }

[ "$DRY" = 1 ] || [ -n "$ROOT" ] || [ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }

LIB="$ROOT/usr/local/lib/pipe-ups"
CONF="$ROOT/etc/nut/upsmon.conf"
BEGIN="# >>> pipe-ups (managed by infra/ups/install.sh) >>>"
END="# <<< pipe-ups <<<"

# upsmon.conf without our block, printed (the command substitution that reads it drops the empty lines the block leaves at the end).
without_block() { [ -f "$CONF" ] && awk -v b="$BEGIN" -v e="$END" '$0 == b { skip = 1; next } $0 == e { skip = 0; next } !skip' "$CONF" || true; }

write_conf() { # block text, or empty to remove
  [ -f "$CONF" ] || { echo "WARNING: $CONF does not exist — NUT is not set up here; the alerts are not wired" >&2; return 0; }
  local rest
  rest="$(without_block)"
  if [ "$DRY" = 1 ]; then echo "  would update $CONF"; return 0; fi
  { printf '%s\n' "$rest"; [ -z "$1" ] || printf '\n%s\n%s\n%s\n' "$BEGIN" "$1" "$END"; } > "$CONF.new"
  chmod --reference="$CONF" "$CONF.new" 2>/dev/null || chmod 640 "$CONF.new"
  chown --reference="$CONF" "$CONF.new" 2>/dev/null || true
  mv "$CONF.new" "$CONF"
}

if [ "$REMOVE" = 1 ]; then
  run systemctl disable --now pipe-ups-report.timer 2>/dev/null || true
  run rm -f "$ROOT/etc/systemd/system/pipe-ups-report.service" "$ROOT/etc/systemd/system/pipe-ups-report.timer"
  run rm -rf "$LIB"
  write_conf ""
  run systemctl daemon-reload
  run systemctl restart nut-monitor 2>/dev/null || true
  log "removed"
  exit 0
fi

if [ -z "$ROOT" ]; then
  [ -x /usr/local/bin/notify-telegram ] || echo "WARNING: /usr/local/bin/notify-telegram is missing — the alerts would only go to the journal (install infra/notify first)" >&2
  [ -r /etc/pipe-boardagent.env ] || echo "WARNING: /etc/pipe-boardagent.env is missing — the report cannot authenticate to bridge (install infra/boardagent first)" >&2
  command -v upsc >/dev/null || echo "WARNING: upsc is missing — NUT is not installed here" >&2
fi

run mkdir -p "$LIB"
run install -m 755 "$HERE/report.sh" "$HERE/notify.sh" "$LIB/"

put "$ROOT/etc/systemd/system/pipe-ups-report.service" $'[Unit]\nDescription=Tell bridge how the UPS is doing\nAfter=nut-server.service\n\n[Service]\nType=oneshot\nExecStart=/usr/local/lib/pipe-ups/report.sh\n'
put "$ROOT/etc/systemd/system/pipe-ups-report.timer" $'[Unit]\nDescription=Tell bridge how the UPS is doing, every minute\n\n[Timer]\nOnBootSec=2min\nOnUnitActiveSec=1min\nAccuracySec=5s\n\n[Install]\nWantedBy=timers.target\n'

write_conf "NOTIFYCMD /usr/local/lib/pipe-ups/notify.sh
NOTIFYFLAG ONBATT SYSLOG+EXEC
NOTIFYFLAG ONLINE SYSLOG+EXEC
NOTIFYFLAG LOWBATT SYSLOG+EXEC
NOTIFYFLAG FSD SYSLOG+EXEC
NOTIFYFLAG COMMBAD SYSLOG+EXEC
NOTIFYFLAG COMMOK SYSLOG+EXEC
NOTIFYFLAG REPLBATT SYSLOG+EXEC"

run systemctl daemon-reload
run systemctl enable --now pipe-ups-report.timer
run systemctl restart nut-monitor 2>/dev/null || true
log "UPS report: every minute; Telegram alerts: ONBATT ONLINE LOWBATT FSD COMMBAD COMMOK REPLBATT"
