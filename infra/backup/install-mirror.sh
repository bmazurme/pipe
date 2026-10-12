#!/usr/bin/env bash
#
# Sets up the Garage S3 mirror on the second Pi (run as root, after install-pull.sh):
#
#   scp -r infra/backup pi@192.168.50.12:/tmp/ && ssh -t pi@192.168.50.12 'sudo bash /tmp/backup/install-mirror.sh'
#
# It needs the bridge-backups S3 key in /etc/pipe-backup-s3.env (mode 600): S3_ENDPOINT, S3_REGION, S3_BUCKET,
# S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY. Garage's cluster.sh keeps it on the first board in
# /etc/garage/keys/bridge-backups.env — copy it over without printing it, e.g. from your workstation:
#   ssh pi@192.168.50.11 'sudo cat /etc/garage/keys/bridge-backups.env' | ssh pi@192.168.50.12 'sudo tee /etc/pipe-backup-s3.env >/dev/null'
# and set S3_ENDPOINT to THIS board's own Garage node (http://<this ip>:3900) so the mirror does not depend on the primary.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
LIB=/usr/local/lib/pipe-backup
ENV=/etc/pipe-backup-s3.env
[ -s "$ENV" ] || { echo "missing $ENV — see the header of this script" >&2; exit 1; }
chmod 600 "$ENV"

install -d -m 755 "$LIB"
install -m 755 "$SRC/mirror-s3.sh" "$LIB/"
docker pull -q rclone/rclone >/dev/null

cat > /etc/systemd/system/pipe-backup-mirror.service <<UNIT
[Unit]
Description=Copy the latest verified database backup to the Garage S3 bucket
Wants=network-online.target docker.service
After=network-online.target docker.service pipe-backup-pull.service

[Service]
Type=oneshot
EnvironmentFile=$ENV
ExecStart=$LIB/mirror-s3.sh
Nice=10
UNIT
cat > /etc/systemd/system/pipe-backup-mirror.timer <<'UNIT'
[Unit]
Description=Daily S3 mirror of the database backup at 03:45 Moscow time

[Timer]
OnCalendar=*-*-* 03:45:00 Europe/Moscow
RandomizedDelaySec=5min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
echo "installed. Test: sudo systemctl start pipe-backup-mirror.service; then: sudo systemctl enable --now pipe-backup-mirror.timer"
