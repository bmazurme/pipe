#!/usr/bin/env bash
# Shared by resource-check.sh and primary-watch.sh: an alert that fires once a problem has been seen CONFIRM_RUNS times in a row,
# repeats every REPEAT_SECONDS while it lasts, and says so when it is over — so a flapping value does not flood Telegram and a
# long problem is not forgotten. One small state file per check.
#
#   transition NAME BAD(0|1) "problem text" "recovered text"
STATE_DIR="${STATE_DIR:-/var/lib/pipe-monitor}"
CONFIRM_RUNS="${CONFIRM_RUNS:-2}"
REPEAT_SECONDS="${REPEAT_SECONDS:-21600}"
NOTIFY_CMD="${NOTIFY_CMD:-/usr/local/bin/notify-telegram}"

notify() { if [ -x "$NOTIFY_CMD" ]; then "$NOTIFY_CMD" "$1" || true; else echo "ALERT: $1" >&2; fi; }

transition() {
  local name="$1" bad="$2" problem="$3" recovered="$4"
  local file="$STATE_DIR/$name" runs=0 alerted=0 now
  now="$(date +%s)"
  mkdir -p "$STATE_DIR"
  [ -f "$file" ] && read -r runs alerted < "$file" || true
  runs="${runs:-0}"; alerted="${alerted:-0}"

  if [ "$bad" = 1 ]; then
    runs=$((runs + 1))
    if [ "$runs" -ge "$CONFIRM_RUNS" ] && { [ "$alerted" = 0 ] || [ $((now - alerted)) -ge "$REPEAT_SECONDS" ]; }; then
      notify "$problem"
      alerted="$now"
    fi
  else
    if [ "$alerted" != 0 ]; then notify "$recovered"; fi
    runs=0; alerted=0
  fi
  printf '%s %s\n' "$runs" "$alerted" > "$file"
}
