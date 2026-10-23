#!/usr/bin/env bash
#
# Installs the board agent (run as root, on each board — by hand, like every script of this kind; the agent never updates itself):
#
#   scp -r infra/boardagent pi@HOST:~/ && ssh -t pi@HOST 'sudo bash ~/boardagent/install.sh'
#   then, once per board:  sudo nano /etc/pipe-boardagent.env      # BRIDGE_API_KEY = a boards-only API key of the owner (brk_…)
#
#   install.sh --remove     stop and remove it
#
# Needs infra/scriptcheck installed first (the agent asks it what is outdated). Two timers: a report hourly, a check for the owner's
# decision every minute. Bridge now announces an outdated board on Telegram (with the update button), so the older message of
# check-scripts.sh would be a second, button-less copy of it: ALERT_CMD is switched off in /etc/pipe-scriptcheck.env (kept as a comment).
set -euo pipefail

LIB=/usr/local/lib/pipe-boardagent
SRC="$(cd "$(dirname "$0")" && pwd)"

if [ "${1:-}" = "--remove" ]; then
  systemctl disable --now pipe-boardagent-report.timer pipe-boardagent-apply.timer 2>/dev/null || true
  rm -f /etc/systemd/system/pipe-boardagent-{report,apply}.{service,timer}
  rm -rf "$LIB"
  systemctl daemon-reload
  echo "removed (the settings in /etc/pipe-boardagent.env and the state in /var/lib/pipe-boardagent are left)"
  exit 0
fi

for tool in curl python3 flock; do command -v "$tool" >/dev/null || { echo "$tool is required" >&2; exit 1; }; done
[ -x /usr/local/lib/pipe-scriptcheck/check-scripts.sh ] || { echo "install infra/scriptcheck first" >&2; exit 1; }

install -d -m 755 "$LIB"
install -m 755 "$SRC/board-agent.sh" "$LIB/board-agent.sh"
install -m 644 "$SRC/manifest.txt" "$LIB/manifest.txt"

if [ ! -f /etc/pipe-boardagent.env ]; then
  umask 077
  cat > /etc/pipe-boardagent.env <<'ENV'
BRIDGE_API_URL=https://api.bridge.ntlstl.dev
# A boards-only API key of the OWNER (bridge: Profile → API keys → «только для плат»): it can call the board agent's routes and nothing
# else, so a key lifted from a board does not open the owner's account. Without it the agent does nothing.
BRIDGE_API_KEY=
# BOARD_HOST=ubuntu-red      # the name shown in bridge; default is the hostname
# BRIDGE_PI_DIR=/home/pi/bridge-pi
ENV
  chmod 600 /etc/pipe-boardagent.env
fi

for kind in report apply; do
  cat > "/etc/systemd/system/pipe-boardagent-$kind.service" <<UNIT
[Unit]
Description=pipe board agent ($kind)
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
EnvironmentFile=-/etc/pipe-boardagent.env
StateDirectory=pipe-boardagent
Environment=STATE_DIR=/var/lib/pipe-boardagent
ExecStart=$LIB/board-agent.sh $kind
Nice=10
UNIT
done

cat > /etc/systemd/system/pipe-boardagent-report.timer <<'UNIT'
[Unit]
Description=Hourly: tell bridge which scripts of this board are outdated

[Timer]
OnBootSec=5min
OnUnitActiveSec=1h
RandomizedDelaySec=2min

[Install]
WantedBy=timers.target
UNIT
cat > /etc/systemd/system/pipe-boardagent-apply.timer <<'UNIT'
[Unit]
Description=Every minute: has the owner allowed an update of this board's scripts?

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=10s

[Install]
WantedBy=timers.target
UNIT

if [ -f /etc/pipe-scriptcheck.env ] && grep -qE '^ALERT_CMD=' /etc/pipe-scriptcheck.env; then
  sed -i -E 's/^ALERT_CMD=/# (bridge announces now, with a button) ALERT_CMD=/' /etc/pipe-scriptcheck.env
  echo "switched off ALERT_CMD in /etc/pipe-scriptcheck.env: bridge sends the message now"
fi

systemctl daemon-reload
systemctl enable --now pipe-boardagent-report.timer pipe-boardagent-apply.timer
echo "installed. Put a boards-only API key of the owner into /etc/pipe-boardagent.env, then: sudo systemctl start pipe-boardagent-report.service"
