#!/usr/bin/env bash
#
# Tells bridge how this NAS is doing - for the Dashboard tile. Runs inside the container (entrypoint.sh starts it every REPORT_MIN minutes).
#
#   report.sh          build the report and send it (silently does nothing without BRIDGE_API_KEY)
#   report.sh --dry    print the JSON and send nothing
#
# What it reads, all read-only: the backup copy it keeps (BACKUP_DIR), the RAID state (the host's /proc/mdstat, mounted at MDSTAT), the data
# volume the copy lives on (df), the disks' SMART (needs --device /dev/sdX --cap-add SYS_RAWIO), the host uptime.
#
# Settings: BRIDGE_API_KEY (the owner's boards-only key), BRIDGE_API_URL (default https://api.bridge.ntlstl.dev), BRIDGE_RESOLVE (curl
# --resolve value, e.g. api.bridge.ntlstl.dev:443:192.168.50.10 - goes to the stack's VIP inside the LAN instead of out through the router and
# back), NAS_NAME, DISKS (default "sda sdb"), BACKUP_DIR, MDSTAT, SMARTCTL.
set -uo pipefail

BACKUP_DIR="${BACKUP_DIR:-/srv/backups}"
MDSTAT="${MDSTAT:-/host/mdstat}"
SMARTCTL="${SMARTCTL:-smartctl}"
DISKS="${DISKS:-sda sdb}"
NAS_NAME="${NAS_NAME:-$(hostname)}"
BRIDGE_API_URL="${BRIDGE_API_URL:-https://api.bridge.ntlstl.dev}"

log() { echo "[$(date +%FT%T%z)] report: $*" >&2; }

# One disk as a JSON object. Raw values of the attributes that matter: 5 reallocated, 9 power-on hours, 194 temperature, 197 pending, 198 uncorrectable.
disk_json() {
  local dev="$1" health attrs model
  health="$("$SMARTCTL" -H "/dev/$dev" 2>/dev/null | grep -i 'overall-health' | grep -qi 'PASSED' && echo true || echo false)"
  model="$("$SMARTCTL" -i "/dev/$dev" 2>/dev/null | sed -n 's/^Device Model: *//p' | head -1)"
  attrs="$("$SMARTCTL" -A "/dev/$dev" 2>/dev/null)"
  attr() { echo "$attrs" | awk -v id="$1" '$1 == id { v = $10; sub(/[^0-9].*/, "", v); print v; exit }'; }
  jq -n --arg name "$dev" --arg model "$model" --argjson ok "$health" \
    --arg re "$(attr 5)" --arg poh "$(attr 9)" --arg temp "$(attr 194)" --arg pend "$(attr 197)" --arg unc "$(attr 198)" \
    '{name: $name, model: (if $model == "" then null else $model end), healthPassed: $ok,
      reallocated: ($re | tonumber? // null), powerOnHours: ($poh | tonumber? // null), tempC: ($temp | tonumber? // null),
      pending: ($pend | tonumber? // null), uncorrectable: ($unc | tonumber? // null)}'
}

build() {
  local created snapshots bytes latest raid_degraded=false raid_syncing=false raid_summary="" total used up
  created=""
  if [ -s "$BACKUP_DIR/last-success" ]; then created="$(date -u -d "@$(cat "$BACKUP_DIR/last-success")" +%FT%TZ)"; fi
  latest="$(readlink "$BACKUP_DIR/latest" 2>/dev/null | sed 's#.*/##')"
  snapshots="$(ls -1d "$BACKUP_DIR"/snapshots/[0-9]* 2>/dev/null | wc -l | tr -d ' ')"
  bytes="$(du -sk "$BACKUP_DIR" 2>/dev/null | awk '{print $1 * 1024}')"

  if [ -r "$MDSTAT" ]; then
    # "md1 : active raid1 sda2[0] sdb2[1]" then "... [2/2] [UU]"; an underscore in the brackets is a missing member
    raid_summary="$(awk '/^md[0-9]+ :/ {name = $1} /\[[U_]+\]$/ {print name " " $NF}' "$MDSTAT" | tr '\n' ' ' | sed 's/ $//')"
    echo "$raid_summary" | grep -q '_' && raid_degraded=true
    grep -qE 'resync|recovery|reshape' "$MDSTAT" && raid_syncing=true
  fi

  read -r total used < <(df -k "$BACKUP_DIR" 2>/dev/null | awk 'NR == 2 {print $2 * 1024, $3 * 1024}')
  up="$(cut -d. -f1 /proc/uptime 2>/dev/null)"

  local disks="[]" d
  for d in $DISKS; do
    [ -e "/dev/$d" ] || continue
    disks="$(echo "$disks" | jq --argjson one "$(disk_json "$d")" '. + [$one]')"
  done

  jq -n --arg host "$NAS_NAME" --arg created "$created" --arg latest "$latest" \
    --arg snaps "${snapshots:-0}" --arg bytes "${bytes:-0}" --arg total "${total:-0}" --arg used "${used:-0}" --arg up "${up:-0}" \
    --arg raid "$raid_summary" --argjson degraded "$raid_degraded" --argjson syncing "$raid_syncing" --argjson disks "$disks" \
    '{host: $host, uptimeSec: ($up | tonumber),
      backup: {createdAt: (if $created == "" then null else $created end), latest: (if $latest == "" then null else $latest end), snapshots: ($snaps | tonumber), bytes: ($bytes | tonumber)},
      raid: {summary: $raid, degraded: $degraded, syncing: $syncing},
      volume: {totalBytes: ($total | tonumber), usedBytes: ($used | tonumber)},
      disks: $disks}'
}

body="$(build)" || { log "could not build the report"; exit 1; }

if [ "${1:-}" = "--dry" ]; then echo "$body"; exit 0; fi
[ -n "${BRIDGE_API_KEY:-}" ] || exit 0

resolve=()
[ -z "${BRIDGE_RESOLVE:-}" ] || resolve=(--resolve "$BRIDGE_RESOLVE")
# The key goes to curl as a config on stdin, never in argv.
printf 'header = "Authorization: Bearer %s"\n' "$BRIDGE_API_KEY" \
  | curl -K - -fsS --max-time 30 "${resolve[@]}" -X POST -H 'Content-Type: application/json' --data "$body" "$BRIDGE_API_URL/api/v1/boards/agent/nas" >/dev/null \
  || { log "bridge did not take the report"; exit 1; }
