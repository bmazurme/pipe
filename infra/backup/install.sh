#!/usr/bin/env bash
#
# Installs the daily backup on a Pi (run as root, from this directory):
#
#   scp -r infra/backup pi@HOST:/tmp/ && ssh -t pi@HOST 'sudo bash /tmp/backup/install.sh'
#
# Puts the scripts in /usr/local/lib/pipe-backup, a settings template in /etc/pipe-backup.env
# (mode 600, never overwritten), and systemd units:
#   pipe-backup.timer        every day 03:00 Moscow time (+ up to 5 min jitter), catches up after downtime
#   pipe-backup-check.timer  hourly: fails (journal + ALERT_CMD) when the last success is > 26 h old
# The timers are installed but NOT enabled until /etc/pipe-backup.env has a DATABASE_URL — run
# `sudo systemctl enable --now pipe-backup.timer pipe-backup-check.timer` afterwards.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
LIB=/usr/local/lib/pipe-backup
ENV=/etc/pipe-backup.env

command -v age >/dev/null || { apt-get update -qq || true; apt-get install -y -qq age; }
command -v docker >/dev/null || { echo "docker is required (see infra/pi/README.md)" >&2; exit 1; }

install -d -m 755 "$LIB"
install -m 755 "$SRC/backup.sh" "$SRC/restore-check.sh" "$LIB/"
install -d -m 700 /srv/backups

if [ ! -f "$ENV" ]; then
  install -m 600 /dev/null "$ENV"
  cat > "$ENV" <<'CONF'
# Settings for pipe-backup. Mode 600: DATABASE_URL carries the password.
# Read by systemd (EnvironmentFile): no quotes, no `export`, one KEY=value per line.
DATABASE_URL=
BACKUP_DIR=/srv/backups
# pg_dump / pg_restore come from a container, so the client always matches the server (16):
PG_DUMP=docker run --rm --network host postgres:16-alpine pg_dump
PG_RESTORE=docker run --rm -i postgres:16-alpine pg_restore
# age public key (age-keygen prints it); keep the PRIVATE key off this machine's backup disk:
AGE_RECIPIENT=
# ALERT_CMD=/usr/local/bin/notify-telegram
CONF
  echo "created $ENV — fill in DATABASE_URL (and AGE_RECIPIENT)"
fi

cat > /etc/systemd/system/pipe-backup.service <<UNIT
[Unit]
Description=Daily database backup (verify first, replace after)
Wants=network-online.target docker.service
After=network-online.target docker.service

[Service]
Type=oneshot
EnvironmentFile=$ENV
ExecStart=$LIB/backup.sh
Nice=10
UNIT

cat > /etc/systemd/system/pipe-backup.timer <<'UNIT'
[Unit]
Description=Daily database backup at 03:00 Moscow time

[Timer]
OnCalendar=*-*-* 03:00:00 Europe/Moscow
RandomizedDelaySec=5min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

cat > /etc/systemd/system/pipe-backup-check.service <<UNIT
[Unit]
Description=Is the last database backup recent enough?

[Service]
Type=oneshot
EnvironmentFile=$ENV
ExecStart=$LIB/backup.sh --check
UNIT

cat > /etc/systemd/system/pipe-backup-check.timer <<'UNIT'
[Unit]
Description=Hourly backup freshness check

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
echo "installed. Next: edit $ENV, run $LIB/backup.sh once by hand, then:"
echo "  systemctl enable --now pipe-backup.timer pipe-backup-check.timer"
