#!/usr/bin/env bash
#
# Installs the check of the board's own scripts against the repository (run as root, on each board):
#
#   scp -r infra/scriptcheck pi@HOST:~/ && ssh -t pi@HOST 'sudo bash ~/scriptcheck/install.sh'
#
# An hourly timer runs check-scripts.sh; it messages ALERT_CMD (notify-telegram, when that is installed) once when a script on this
# board is older than the one on main, and once when everything is current again. Nothing here changes any other script.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
LIB=/usr/local/lib/pipe-scriptcheck

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
install -d -m 755 "$LIB"
install -m 755 "$SRC/check-scripts.sh" "$LIB/check-scripts.sh"

if [ ! -f /etc/pipe-scriptcheck.env ]; then
  {
    echo '# OWNER=bmazurme'
    echo '# REPO=pipe'
    echo '# REPEAT_HOURS=24'
    if [ -x /usr/local/bin/notify-telegram ]; then echo 'ALERT_CMD=/usr/local/bin/notify-telegram'; else echo '# ALERT_CMD=/usr/local/bin/notify-telegram'; fi
  } > /etc/pipe-scriptcheck.env
  chmod 644 /etc/pipe-scriptcheck.env
fi

cat > /etc/systemd/system/pipe-scriptcheck.service <<UNIT
[Unit]
Description=Compare the scripts installed on this board with the repository
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
EnvironmentFile=-/etc/pipe-scriptcheck.env
StateDirectory=pipe-scriptcheck
Environment=STATE_DIR=/var/lib/pipe-scriptcheck
ExecStart=$LIB/check-scripts.sh
Nice=10
UNIT

cat > /etc/systemd/system/pipe-scriptcheck.timer <<'UNIT'
[Unit]
Description=Hourly: are this board's scripts older than the repository's?

[Timer]
OnBootSec=10min
OnUnitActiveSec=1h
RandomizedDelaySec=2min

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now pipe-scriptcheck.timer >/dev/null
echo "pipe-scriptcheck.timer: enabled (hourly)"
echo "now:"
"$LIB/check-scripts.sh" --status || true
