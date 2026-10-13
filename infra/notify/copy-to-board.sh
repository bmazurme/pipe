#!/usr/bin/env bash
#
# Puts notify-telegram on another board, with the bot's settings copied from a board that already has them — run from YOUR workstation:
#
#   infra/notify/copy-to-board.sh 192.168.50.13 [192.168.50.14 …]
#
# The settings (/etc/pipe-notify.env: the bot token and chat id) travel straight from the source board to the target through your
# terminal's ssh pipes: they are never printed, never written to a local file, never on a command line. The target gets the file as
# root:pi, mode 640 (the scripts that send run as the board's user), then a test message is sent.
#
# Environment: FROM (the board that has them, default 192.168.50.11), SSH_USER (pi).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
FROM="${FROM:-192.168.50.11}"
SSH_USER="${SSH_USER:-pi}"
[ $# -ge 1 ] || { echo "usage: $0 <board address> [<board address> …]" >&2; exit 2; }
ssh_() { local host="$1"; shift; ssh -o BatchMode=yes -o ConnectTimeout=8 "$SSH_USER@$host" "$@"; }

ssh_ "$FROM" 'sudo test -s /etc/pipe-notify.env' || { echo "REFUSED: $FROM has no /etc/pipe-notify.env to copy" >&2; exit 1; }

for target in "$@"; do
  [ "$target" != "$FROM" ] || { echo "skipping $target (it is the source)"; continue; }
  ssh_ "$target" true >/dev/null 2>&1 || { echo "REFUSED: $target does not answer over ssh" >&2; exit 1; }
  scp -q -o BatchMode=yes "$HERE/notify-telegram" "$SSH_USER@$target:/tmp/notify-telegram"
  ssh_ "$target" 'sudo install -m 755 /tmp/notify-telegram /usr/local/bin/notify-telegram && rm -f /tmp/notify-telegram'
  ssh_ "$FROM" 'sudo cat /etc/pipe-notify.env' | ssh_ "$target" 'sudo install -m 640 -o root -g '"$SSH_USER"' /dev/stdin /etc/pipe-notify.env'
  ssh_ "$target" '/usr/local/bin/notify-telegram "✅ notify-telegram настроен на $(hostname)"' && echo "$target: installed, test message sent" \
    || echo "$target: installed, but the test message did not go out — check the board's route to Telegram (docker network telegram-proxy-net)" >&2
done
