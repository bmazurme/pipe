#!/usr/bin/env bash
#
# NUT's NOTIFYCMD on the master (upsmon calls it with NOTIFYTYPE in the environment and the message as $1): says the important things about
# the power in Telegram, at once — also in the quiet hours, because a power cut at night is exactly what you want to know about.
#
#   ONBATT   the mains is gone                     ONLINE   the mains is back
#   LOWBATT  the battery is nearly flat            FSD      the boards are being shut down
#   COMMBAD  the UPS stopped answering over USB    COMMOK   it answers again
#   REPLBATT the battery needs replacing
# Anything else (SHUTDOWN, NOCOMM, NOPARENT, …) is only left in the journal by upsmon itself. Never fails: an alert must not break upsmon.
set -uo pipefail

NOTIFY="${NOTIFY_TELEGRAM:-/usr/local/bin/notify-telegram}"
UPS_NAME="${UPS_NAME:-cyberpower}"
UPS_HOST="${UPS_HOST:-localhost}"
HOST="$(hostname)"

# One reading from the UPS, or empty when it does not answer.
reading() { upsc "$UPS_NAME@$UPS_HOST" "$1" 2>/dev/null | head -1; }
minutes() { local s="$1"; [[ "$s" =~ ^[0-9]+$ ]] && echo $(((s + 30) / 60)); }

charge="$(reading battery.charge)"
left="$(minutes "$(reading battery.runtime)")"
load="$(reading ups.load)"
detail=""
[ -z "$charge" ] || detail="заряд ${charge} %"
[ -z "$left" ] || detail="${detail:+$detail, }хватит примерно на ${left} мин"
[ -z "$load" ] || detail="${detail:+$detail, }нагрузка ${load} %"
detail="${detail:+ ($detail)}"

case "${NOTIFYTYPE:-}" in
  ONBATT)   text="⚡ Питание пропало — ИБП работает от батареи${detail}. Платы выключатся сами, когда батарея почти кончится." ;;
  ONLINE)   text="✅ Питание вернулось, ИБП снова от сети${detail}." ;;
  LOWBATT)  text="🪫 Батарея ИБП почти разряжена${detail}. Сейчас платы начнут выключаться." ;;
  FSD)      text="⏻ ИБП даёт команду выключиться: платы останавливаются. После возвращения питания ИБП сам включит выходы, платы загрузятся сами." ;;
  COMMBAD)  text="⚠️ ИБП не отвечает по USB (${HOST}). Платы не узнают, если пропадёт питание — проверьте кабель и NUT." ;;
  COMMOK)   text="✅ Связь с ИБП по USB восстановлена (${HOST})." ;;
  REPLBATT) text="🔋 Батарею ИБП пора заменить${detail}." ;;
  *) exit 0 ;;
esac

# The quiet hours of notify-telegram would hold this until morning; a power cut is not something to wait with.
NOTIFY_QUIET_HOURS=off "$NOTIFY" "$text" || true
exit 0
