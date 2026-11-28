#!/usr/bin/env bash
#
# Installs the monthly restore drill (R7) where the backup's PRIVATE age key lives — normally your Mac, see install-drill-mac.sh; this
# one is for a Linux machine (run as root, from this directory):
#
#   sudo bash install-drill.sh
#
# Puts restore-drill.sh in /usr/local/lib/pipe-backup, a settings template in /etc/pipe-restore-drill.env (mode 600, never overwritten) and
# pipe-restore-drill.timer: every Monday 06:00 Moscow time, catching up after downtime; the script itself does the drill only when the last
# good one is 30+ days old (--if-due 30), so «weekly trigger» means «monthly drill» without a calendar that skips a month on a 31-day edge.
# The timer is installed but NOT enabled until the env file has BRIDGE_URL / BRIDGE_API_KEY and (for encrypted backups) AGE_IDENTITY:
#   systemctl enable --now pipe-restore-drill.timer
#
# Do NOT put the age private key on a board that holds the backups: that board would then hold the data AND the key to read it.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
LIB=/usr/local/lib/pipe-backup
ENV=/etc/pipe-restore-drill.env

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
command -v age >/dev/null || { apt-get update -qq || true; apt-get install -y -qq age; }

install -d -m 755 "$LIB"
install -m 755 "$SRC/restore-drill.sh" "$LIB/"

if [ ! -f "$ENV" ]; then
  install -m 600 /dev/null "$ENV"
  cat > "$ENV" <<'CONF'
# Settings for pipe-restore-drill. Mode 600. Read by the script itself and by systemd: plain KEY=value, no quotes.
# Where the backup comes from: a local directory (on the board that holds it) or a board over ssh (a workstation):
#BACKUP_DIR=/srv/backups
SOURCE_HOST=192.168.50.12
# The private age key file (encrypted backups). Only on a machine that is allowed to read the data.
AGE_IDENTITY=
# Where to report: bridge, and a personal API key with scope «boards» (Profile → API keys).
BRIDGE_URL=
BRIDGE_API_KEY=
CONF
  echo "created $ENV — fill in BRIDGE_URL, BRIDGE_API_KEY, AGE_IDENTITY"
fi

cat > /etc/systemd/system/pipe-restore-drill.service <<UNIT
[Unit]
Description=Restore drill: restore the latest backup into a throwaway Postgres and report
Wants=network-online.target docker.service
After=network-online.target docker.service

[Service]
Type=oneshot
EnvironmentFile=$ENV
ExecStart=$LIB/restore-drill.sh --if-due 30
# 3 = skipped (Docker down, source unreachable): not a failure of the unit
SuccessExitStatus=3
Nice=10
TimeoutStartSec=2h
UNIT

cat > /etc/systemd/system/pipe-restore-drill.timer <<'UNIT'
[Unit]
Description=Weekly trigger of the restore drill (it runs when 30 days have passed)

[Timer]
OnCalendar=Mon *-*-* 06:00:00 Europe/Moscow
RandomizedDelaySec=30min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
echo "installed. Next: edit $ENV, run $LIB/restore-drill.sh once by hand, then:"
echo "  systemctl enable --now pipe-restore-drill.timer"
