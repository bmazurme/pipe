#!/usr/bin/env bash
#
# Schedules check.sh every 5 minutes on the replica node (run as root on red):
#   scp -r infra/standby pi@192.168.50.12:~/ && ssh -t pi@192.168.50.12 'sudo bash ~/standby/install-check.sh'
# A failing run shows up in `systemctl --failed` and `journalctl -u pipe-standby-check`; set ALERT_CMD in
# /etc/pipe-standby.env to be told by message.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
LIB=/usr/local/lib/pipe-backup
install -d -m 755 "$LIB"
install -m 755 "$SRC/check.sh" "$LIB/standby-check.sh"
[ -f /etc/pipe-standby.env ] || { printf '# DB_USER=bridge\n# MAX_SILENT_SECONDS=180\n# ALERT_CMD=/usr/local/bin/notify-telegram\n' > /etc/pipe-standby.env; chmod 600 /etc/pipe-standby.env; }

cat > /etc/systemd/system/pipe-standby-check.service <<UNIT
[Unit]
Description=Is the Postgres replica still streaming from the primary?
Wants=docker.service
After=docker.service

[Service]
Type=oneshot
EnvironmentFile=/etc/pipe-standby.env
ExecStart=$LIB/standby-check.sh
UNIT
cat > /etc/systemd/system/pipe-standby-check.timer <<'UNIT'
[Unit]
Description=Replica health check every 5 minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now pipe-standby-check.timer >/dev/null
echo "installed: pipe-standby-check.timer (every 5 min)"
