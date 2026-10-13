#!/usr/bin/env bash
#
# Sets up the copy of bridge's uploaded files on the second Pi (run as root on red):
#
#   scp -r infra/backup pi@192.168.50.12:/tmp/ && ssh -t pi@192.168.50.12 'sudo bash /tmp/backup/install-uploads.sh'
#
# Creates a dedicated SSH key, installs uploads-pull.sh, /etc/pipe-uploads.env, a daily timer (04:10 Moscow, after the
# database backup, the pull and the S3 mirror) and an hourly freshness check; prints the line to add to the PRIMARY's
# authorized_keys. That line restricts the key to read-only access to the uploads volume through rrsync — no shell,
# no writes, nothing else on the board.
#
# The Garage mirror needs the bridge-uploads S3 key in /etc/pipe-uploads.env (S3_ENDPOINT, S3_REGION, S3_BUCKET,
# S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY) — see the README for the one-line copy that does not print it.
#
# Environment: PRIMARY (default 192.168.50.11), PRIMARY_USER (default pi),
#              VOLUME_PATH (default /var/lib/docker/volumes/bridge_bridge_uploads/_data).
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
LIB=/usr/local/lib/pipe-backup
PRIMARY="${PRIMARY:-192.168.50.11}"
PRIMARY_USER="${PRIMARY_USER:-pi}"
VOLUME_PATH="${VOLUME_PATH:-/var/lib/docker/volumes/bridge_bridge_uploads/_data}"
KEY=/root/.ssh/pull_uploads
MYIP="$(ip -4 -o addr show dev eth0 | awk '{print $4}' | cut -d/ -f1 | head -1)"

command -v rsync >/dev/null || { apt-get update -qq || true; apt-get install -y -qq rsync; }
install -d -m 755 "$LIB"
install -m 755 "$SRC/uploads-pull.sh" "$LIB/"
install -d -m 700 /srv/uploads-mirror /root/.ssh
[ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N '' -C "pipe-uploads-pull@$(hostname)" -f "$KEY"
ssh-keyscan -H "$PRIMARY" >> /root/.ssh/known_hosts 2>/dev/null || true

if [ ! -f /etc/pipe-uploads.env ]; then
  install -m 600 /dev/null /etc/pipe-uploads.env
  cat > /etc/pipe-uploads.env <<CONF
SOURCE=$PRIMARY_USER@$PRIMARY:./
BACKUP_DIR=/srv/uploads-mirror
SSH_KEY=$KEY
# Garage mirror (optional): S3_ENDPOINT=http://$MYIP:3900  S3_REGION=garage  S3_BUCKET=bridge-uploads  S3_ACCESS_KEY_ID=…  S3_SECRET_ACCESS_KEY=…
# ALERT_CMD=/usr/local/bin/notify-telegram
CONF
fi

cat > /etc/systemd/system/pipe-uploads-pull.service <<UNIT
[Unit]
Description=Copy bridge's uploaded files from the primary (and mirror them to Garage)
Wants=network-online.target docker.service
After=network-online.target docker.service

[Service]
Type=oneshot
EnvironmentFile=/etc/pipe-uploads.env
ExecStart=$LIB/uploads-pull.sh
Nice=10
UNIT
cat > /etc/systemd/system/pipe-uploads-pull.timer <<'UNIT'
[Unit]
Description=Daily copy of the uploaded files at 04:10 Moscow time

[Timer]
OnCalendar=*-*-* 04:10:00 Europe/Moscow
RandomizedDelaySec=5min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
cat > /etc/systemd/system/pipe-uploads-check.service <<UNIT
[Unit]
Description=Is the copy of the uploaded files recent enough?

[Service]
Type=oneshot
EnvironmentFile=/etc/pipe-uploads.env
ExecStart=$LIB/uploads-pull.sh --check
UNIT
cat > /etc/systemd/system/pipe-uploads-check.timer <<'UNIT'
[Unit]
Description=Hourly freshness check of the uploads copy

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
echo "restrict,from=\"$MYIP\",command=\"sudo --preserve-env=SSH_ORIGINAL_COMMAND rrsync -ro $VOLUME_PATH\" $(cat "$KEY.pub")"
echo
echo "then: sudo systemctl start pipe-uploads-pull.service, and enable the timers:"
echo "  sudo systemctl enable --now pipe-uploads-pull.timer pipe-uploads-check.timer"
