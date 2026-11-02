#!/usr/bin/env bash
#
# Tells bridge how the UPS is doing (the Dashboard's «ИБП» tile). Runs every minute on the board whose USB cable is in the UPS, next to NUT.
#
#   report.sh            reads `upsc` and posts the answer to POST /api/v1/boards/agent/ups
#
# Settings: the board agent's /etc/pipe-boardagent.env (BRIDGE_API_URL, BRIDGE_API_KEY — the boards-only key of the OWNER, BOARD_HOST),
# plus UPS_NAME (default cyberpower, the section of /etc/nut/ups.conf), UPS_HOST (default localhost) and BRIDGE_RESOLVE (see board-agent.sh).
# NUT not answering (the driver or the cable is down) is not reported: bridge turns a missing report into «ИБП не присылает данные» by itself.
set -uo pipefail

ENV_FILE="${AGENT_ENV_FILE:-/etc/pipe-boardagent.env}"
if [ -r "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi
UPS_NAME="${UPS_NAME:-cyberpower}"
UPS_HOST="${UPS_HOST:-localhost}"
HOST="${BOARD_HOST:-$(hostname)}"
BRIDGE_RESOLVE="${BRIDGE_RESOLVE-api.bridge.ntlstl.dev:443:192.168.50.10}"

log() { echo "[$(date -u +%FT%TZ)] $*" >&2; }
[ -n "${BRIDGE_API_URL:-}" ] && [ -n "${BRIDGE_API_KEY:-}" ] || { log "BRIDGE_API_URL / BRIDGE_API_KEY are not set ($ENV_FILE) — nothing sent"; exit 0; }

values="$(upsc "$UPS_NAME@$UPS_HOST" 2>/dev/null)" || { log "upsc $UPS_NAME@$UPS_HOST failed — nothing sent"; exit 0; }
[ -n "$values" ] || { log "upsc answered nothing — nothing sent"; exit 0; }

# The JSON is built by python, from the environment, so no value can break out of it. A reading the UPS did not give is null.
body="$(UPSC_OUT="$values" REPORT_HOST="$HOST" python3 - <<'PY'
import json, os

values = {}
for line in os.environ["UPSC_OUT"].splitlines():
    key, sep, value = line.partition(": ")
    if sep:
        values[key.strip()] = value.strip()


def number(key, integer=False):
    try:
        parsed = float(values[key])
    except (KeyError, ValueError):
        return None
    return int(round(parsed)) if integer else parsed


status = values.get("ups.status", "")
if not status:
    raise SystemExit(1)

print(json.dumps({
    "host": os.environ["REPORT_HOST"],
    "status": status,
    "model": values.get("ups.model") or values.get("device.model"),
    "chargePct": number("battery.charge", True),
    "runtimeSec": number("battery.runtime", True),
    "loadPct": number("ups.load", True),
    "inputVolts": number("input.voltage"),
    "batteryVolts": number("battery.voltage"),
    "nominalWatts": number("ups.realpower.nominal", True),
    "testResult": values.get("ups.test.result"),
}))
PY
)" || { log "upsc gave no ups.status — nothing sent"; exit 0; }

# The key goes to curl as a config on stdin (printf is a builtin), never in argv, where any local user could read it via ps.
send() { # [host:port:ip to pin]
  local args=(-K - -fsS --max-time 20 -X POST -H 'Content-Type: application/json' --data "$body")
  [ -z "${1:-}" ] || args+=(--resolve "$1")
  printf 'header = "Authorization: Bearer %s"\n' "$BRIDGE_API_KEY" | curl "${args[@]}" "$BRIDGE_API_URL/api/v1/boards/agent/ups"
}

# Through the LAN address of the stack first; the ordinary way only when that address could not be reached at all — never after an answer.
code=0
if [ -n "$BRIDGE_RESOLVE" ]; then
  send "$BRIDGE_RESOLVE" && exit 0
  code=$?
  case "$code" in 6|7|28|35|52|56) ;; *) log "bridge refused the report (curl $code)"; exit 0 ;; esac
fi
send >/dev/null || log "could not send the report to bridge (curl $?)"
exit 0
