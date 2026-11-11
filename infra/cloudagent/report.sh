#!/usr/bin/env bash
#
# Tells bridge how the cloud VM and its services are doing (the Dashboard's «Облако (VM)» tile). Runs every minute on the VM.
#
#   report.sh            collect.py gathers the facts, this posts them to POST /api/v1/boards/agent/cloud
#
# Settings: /etc/pipe-cloudagent.env — BRIDGE_API_URL (the PUBLIC address, https://api.bridge.ntlstl.dev: after a failover the VM must report to
# whoever leads, not to its own old database), BRIDGE_API_KEY (the boards-only key of the OWNER, brk_…), BRIDGE_RESOLVE (optional host:port:ip
# to pin), and everything collect.py reads (its header lists them). Nothing to send (no meminfo, bridge not configured) is not an error here:
# bridge turns a missing report into «VM не присылает отчёт» by itself, loudly.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${AGENT_ENV_FILE:-/etc/pipe-cloudagent.env}"
if [ -r "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi
BRIDGE_RESOLVE="${BRIDGE_RESOLVE-}"

log() { echo "[$(date -u +%FT%TZ)] $*" >&2; }
[ -n "${BRIDGE_API_URL:-}" ] && [ -n "${BRIDGE_API_KEY:-}" ] || { log "BRIDGE_API_URL / BRIDGE_API_KEY are not set ($ENV_FILE) — nothing sent"; exit 0; }

body="$(python3 "$HERE/collect.py")" || { log "collect.py failed — nothing sent"; exit 0; }
[ -n "$body" ] || { log "collect.py printed nothing — nothing sent"; exit 0; }

# The key goes to curl as a config on stdin (printf is a builtin), never in argv, where any local user could read it via ps.
args=(-K - -fsS --max-time 20 -X POST -H 'Content-Type: application/json' --data "$body")
[ -z "$BRIDGE_RESOLVE" ] || args+=(--resolve "$BRIDGE_RESOLVE")
printf 'header = "Authorization: Bearer %s"\n' "$BRIDGE_API_KEY" | curl "${args[@]}" "$BRIDGE_API_URL/api/v1/boards/agent/cloud" >/dev/null \
  || log "could not send the report to bridge (curl $?)"
exit 0
