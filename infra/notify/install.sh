#!/usr/bin/env bash
#
# Installs notify-telegram on a board and, optionally, points the infrastructure scripts at it. Run as root:
#
#   scp -r infra/notify pi@HOST:~/ && ssh -t pi@HOST 'sudo bash ~/notify/install.sh'
#
# It needs /etc/pipe-notify.env with TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (mode 600). On white those two already live
# in ~/.pipe/bridge.env and are copied; on another board put them there yourself (copy over ssh, never print them).
# Then it sets ALERT_CMD / NOTIFY_CMD in whichever of these env files exist on this board and does not have one yet:
# /etc/pipe-autodeploy.env /etc/pipe-backup.env /etc/pipe-backup-pull.env /etc/pipe-backup-s3.env /etc/pipe-standby.env
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
install -m 755 "$SRC/notify-telegram" /usr/local/bin/notify-telegram

if [ ! -s /etc/pipe-notify.env ]; then
  BRIDGE_ENV="$(getent passwd "${SUDO_USER:-pi}" | cut -d: -f6)/.pipe/bridge.env"
  if [ -r "$BRIDGE_ENV" ]; then
    umask 077
    grep -E '^(TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID)=' "$BRIDGE_ENV" > /etc/pipe-notify.env
    echo "/etc/pipe-notify.env: copied TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID from $BRIDGE_ENV"
  else
    echo "no /etc/pipe-notify.env and no $BRIDGE_ENV — create /etc/pipe-notify.env (mode 600) with TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID" >&2
    exit 1
  fi
fi
chmod 600 /etc/pipe-notify.env
# The auto-deploy (white) and failover-red.sh (red) run as the board's user (not root) and call notify-telegram, so that
# user must be able to read the file. Both boards hold the very same token in ~/.pipe/bridge.env — nothing new is exposed.
if id "${DEPLOY_USER:-pi}" >/dev/null 2>&1; then
  chgrp "$(id -gn "${DEPLOY_USER:-pi}")" /etc/pipe-notify.env
  chmod 640 /etc/pipe-notify.env
  echo "/etc/pipe-notify.env: readable by ${DEPLOY_USER:-pi} (the auto-deploy runs as that user)"
fi

# Quiet hours (see notify-telegram): what is held back during the night waits in this directory, writable by the board's user
# (the auto-deploy runs as it), and a timer sends it as one digest once the window is over.
install -d -m 770 -o root -g "$(id -gn "${DEPLOY_USER:-pi}" 2>/dev/null || echo root)" /var/lib/pipe-notify
cat > /etc/systemd/system/pipe-notify-flush.service <<'UNIT'
[Unit]
Description=Send the Telegram messages held back during the quiet hours

[Service]
Type=oneshot
ExecStart=/usr/local/bin/notify-telegram --flush
UNIT
cat > /etc/systemd/system/pipe-notify-flush.timer <<'UNIT'
[Unit]
Description=Every 10 minutes: deliver the messages held back during the quiet hours

[Timer]
OnBootSec=2min
OnUnitActiveSec=10min

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now pipe-notify-flush.timer >/dev/null && echo "pipe-notify-flush.timer: enabled (quiet hours ${NOTIFY_QUIET_HOURS:-23:00-08:00} Europe/Moscow — NOTIFY_QUIET_HOURS / NOTIFY_TZ in /etc/pipe-notify.env change it, off disables)"

wire() { # file variable
  local file="$1" var="$2"
  [ -f "$file" ] || return 0
  if grep -qE "^$var=" "$file"; then
    echo "$file: $var already set — left alone"
  else
    sed -i "/^# $var=/d" "$file"
    printf '%s=/usr/local/bin/notify-telegram\n' "$var" >> "$file"
    echo "$file: $var set"
  fi
}
wire /etc/pipe-autodeploy.env NOTIFY_CMD
for f in /etc/pipe-backup.env /etc/pipe-backup-pull.env /etc/pipe-backup-s3.env /etc/pipe-standby.env; do wire "$f" ALERT_CMD; done

docker pull -q "${NOTIFY_CURL_IMAGE:-curlimages/curl:8.10.1}" >/dev/null && echo "curl image ready"
echo "test: notify-telegram \"hello from \$(hostname)\""
