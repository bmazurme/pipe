#!/usr/bin/env bash
#
# Installs the auto-deploy on white (run as root, from this directory):
#
#   scp -r infra/autodeploy pi@192.168.50.11:~/ && ssh -t pi@192.168.50.11 'sudo bash ~/autodeploy/install.sh'
#
# A systemd service that runs autodeploy.sh as the board's user `pi` (it needs the docker socket and ~/bridge-pi),
# and a timer: 3 minutes after boot, then every 5 minutes. A failed deploy shows up as a failed unit
# (`systemctl --failed`, `journalctl -u pipe-autodeploy`); set NOTIFY_CMD in /etc/pipe-autodeploy.env for a message.
# Disable with `sudo systemctl disable --now pipe-autodeploy.timer` — the stacks simply stay as they are.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
LIB=/usr/local/lib/pipe-autodeploy
USER_NAME="${DEPLOY_USER:-pi}"
HOME_DIR="$(getent passwd "$USER_NAME" | cut -d: -f6)"

command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }
install -d -m 755 "$LIB"
install -m 755 "$SRC/autodeploy.sh" "$LIB/autodeploy.sh"
[ -f /etc/pipe-autodeploy.env ] || {
  printf '# OWNER=bmazurme\n# REPO=pipe\n# MAX_WAIT_SECONDS=420\n# NOTIFY_CMD=/usr/local/bin/notify-telegram\n' > /etc/pipe-autodeploy.env
  chmod 644 /etc/pipe-autodeploy.env
}

cat > /etc/systemd/system/pipe-autodeploy.service <<UNIT
[Unit]
Description=Deploy the newest stable bridge release to this Swarm (verify, roll back on failure)
Wants=network-online.target docker.service
After=network-online.target docker.service

[Service]
Type=oneshot
User=$USER_NAME
Environment=HOME=$HOME_DIR
EnvironmentFile=-/etc/pipe-autodeploy.env
ExecStart=$LIB/autodeploy.sh
# a deploy plus its health wait can take a while; never let two overlap (the script also locks)
TimeoutStartSec=20min
Nice=10
UNIT

cat > /etc/systemd/system/pipe-autodeploy.timer <<'UNIT'
[Unit]
Description=Look for a new stable bridge release every 5 minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
RandomizedDelaySec=30s

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now pipe-autodeploy.timer >/dev/null
echo "installed: pipe-autodeploy.timer (every 5 min). Look: sudo -u $USER_NAME $LIB/autodeploy.sh status"
