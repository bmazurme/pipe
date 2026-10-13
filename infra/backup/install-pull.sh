#!/usr/bin/env bash
#
# Sets up the copy side (run as root on the SECOND Pi, e.g. red):
#
#   scp -r infra/backup pi@192.168.50.12:/tmp/ && ssh -t pi@192.168.50.12 'sudo bash /tmp/backup/install-pull.sh'
#
# Creates a dedicated SSH key, installs pull.sh and a daily timer (03:30 Moscow, after the primary's 03:00
# backup) plus an hourly freshness check, and prints the line to add to the PRIMARY's authorized_keys. That
# line restricts the key to read-only access to /srv/backups through rrsync — nothing else, no shell.
#
# Environment: PRIMARY (default 192.168.50.11), PRIMARY_USER (default pi).
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
LIB=/usr/local/lib/pipe-backup
PRIMARY="${PRIMARY:-192.168.50.11}"
PRIMARY_USER="${PRIMARY_USER:-pi}"
KEY=/root/.ssh/pull_backups
MYIP="$(ip -4 -o addr show dev eth0 | awk '{print $4}' | cut -d/ -f1 | head -1)"

command -v rsync >/dev/null || { apt-get update -qq || true; apt-get install -y -qq rsync; }
install -d -m 755 "$LIB"
install -m 755 "$SRC/pull.sh" "$SRC/backup.sh" "$SRC/restore-check.sh" "$LIB/"
install -d -m 700 /srv/backups /root/.ssh
[ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N '' -C "pipe-backup-pull@$(hostname)" -f "$KEY"

# the primary's host key is recorded once, so BatchMode does not stall on the first pull
ssh-keyscan -H "$PRIMARY" >> /root/.ssh/known_hosts 2>/dev/null || true

cat > /etc/pipe-backup-pull.env <<CONF
SOURCE=$PRIMARY_USER@$PRIMARY:latest/
BACKUP_DIR=/srv/backups
SSH_KEY=$KEY
CONF

cat > /etc/systemd/system/pipe-backup-pull.service <<UNIT
[Unit]
Description=Pull the latest verified database backup from the primary
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
EnvironmentFile=/etc/pipe-backup-pull.env
ExecStart=$LIB/pull.sh
Nice=10
UNIT
cat > /etc/systemd/system/pipe-backup-pull.timer <<'UNIT'
[Unit]
Description=Daily backup pull at 03:30 Moscow time

[Timer]
OnCalendar=*-*-* 03:30:00 Europe/Moscow
RandomizedDelaySec=5min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
cat > /etc/systemd/system/pipe-backup-pull-check.service <<UNIT
[Unit]
Description=Is the pulled database backup recent enough?

[Service]
Type=oneshot
EnvironmentFile=/etc/pipe-backup-pull.env
ExecStart=$LIB/backup.sh --check
UNIT
cat > /etc/systemd/system/pipe-backup-pull-check.timer <<'UNIT'
[Unit]
Description=Hourly pulled-backup freshness check

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload

echo
echo "Add this ONE line to $PRIMARY_USER@$PRIMARY:~/.ssh/authorized_keys:"
echo
echo "restrict,from=\"$MYIP\",command=\"sudo --preserve-env=SSH_ORIGINAL_COMMAND rrsync -ro /srv/backups\" $(cat "$KEY.pub")"
echo
echo "then test: sudo systemctl start pipe-backup-pull.service, and enable the timers:"
echo "  sudo systemctl enable --now pipe-backup-pull.timer pipe-backup-pull-check.timer"
