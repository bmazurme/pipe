#!/usr/bin/env bash
#
# Replication health, from your workstation (ssh to both boards):
#
#   infra/standby/status.sh
#
# Primary: is the replica attached and streaming, how many bytes behind. Replica: is it in recovery, how old is the
# last replayed transaction. Exit 1 when the replica is not streaming or lags by more than MAX_LAG_BYTES (default 16 MB).
set -euo pipefail

PRIMARY="${PRIMARY:-192.168.50.11}"
STANDBY="${STANDBY:-192.168.50.12}"
MAX_LAG_BYTES="${MAX_LAG_BYTES:-16777216}"
DB_USER="${DB_USER:-bridge}"   # the superuser of the stack's database (POSTGRES_USER) — the replica holds a copy of it

# The SQL travels on stdin: ssh joins its arguments into one string, so a parameter would not arrive as such.
on_primary() {
  printf '%s\n' "$1" | ssh -o BatchMode=yes "pi@$PRIMARY" 'set -a; . ~/.pipe/bridge.env; set +a; c=$(docker ps --filter name=bridge_postgres -q | head -1); docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$c" psql -U "${POSTGRES_USER:-bridge}" -d "${POSTGRES_DB:-ntlstl-db}" -At -F "|"'
}

on_standby() {
  printf '%s\n' "$1" | ssh -o BatchMode=yes "pi@$STANDBY" 'c=$(docker ps --filter name=bridgesb_postgres-standby -q | head -1); [ -n "$c" ] && docker exec -i "$c" psql -U '"$DB_USER"' -At -F "|" postgres'
}

row="$(on_primary "SELECT application_name, state, sync_state, COALESCE(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn),-1)::bigint FROM pg_stat_replication")"
slot="$(on_primary "SELECT slot_name, active, COALESCE(pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)),'?') FROM pg_replication_slots")"
echo "primary ($PRIMARY):"
echo "  replication: ${row:-<no replica attached>}"
echo "  slot:        ${slot:-<none>}"

rec="$(on_standby "SELECT pg_is_in_recovery(), COALESCE(round(extract(epoch FROM now()-pg_last_xact_replay_timestamp())::numeric,1)::text,'n/a')" || true)"
echo "replica ($STANDBY):"
echo "  in_recovery|seconds since the last replayed transaction: ${rec:-<not running>}"

state="$(echo "$row" | cut -d'|' -f2)"
lag="$(echo "$row" | cut -d'|' -f4)"
[ "$state" = streaming ] || { echo "NOT STREAMING" >&2; exit 1; }
[ "${lag:-0}" -le "$MAX_LAG_BYTES" ] || { echo "LAG $lag bytes > $MAX_LAG_BYTES" >&2; exit 1; }
echo "ok: streaming, lag ${lag} bytes"
