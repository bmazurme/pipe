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
