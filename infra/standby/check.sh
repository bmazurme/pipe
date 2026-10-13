#!/usr/bin/env bash
#
# Is the replica still attached to the primary? Run on red (install-check.sh schedules it every 5 minutes):
#
#   ./check.sh            exit 1 and ALERT_CMD when the WAL receiver is not streaming, or the primary has been silent
#                         for more than MAX_SILENT_SECONDS (default 180). A node promoted on purpose (label failover=active, set
#                         by infra/failover) is not alerted about.
#
# It asks the replica's WAL receiver, not the replay clock: the walsender sends keepalives every ~30 s, so
# last_msg_receipt_time stays fresh even when nobody writes — an idle database is not a broken replica.
set -euo pipefail

DB_USER="${DB_USER:-bridge}"
MAX_SILENT_SECONDS="${MAX_SILENT_SECONDS:-180}"
alert() { echo "ALERT: $1" >&2; if [ -n "${ALERT_CMD:-}" ]; then $ALERT_CMD "$1" || true; fi; }

c="$(docker ps --filter name=bridgesb_postgres-standby -q | head -1)"
[ -n "$c" ] || { alert "the standby container is not running"; exit 1; }

out="$(docker exec "$c" psql -U "$DB_USER" -At -F '|' postgres -c "SELECT pg_is_in_recovery(), COALESCE((SELECT status FROM pg_stat_wal_receiver LIMIT 1),'none'), COALESCE((SELECT round(extract(epoch FROM now()-last_msg_receipt_time))::int FROM pg_stat_wal_receiver LIMIT 1),-1)" 2>&1)" \
  || { alert "cannot query the standby: $out"; exit 1; }
IFS='|' read -r in_recovery status silent <<<"$out"

if [ "$in_recovery" != t ]; then
  # promoted ON PURPOSE (infra/failover labels the node failover=active): nothing to alert about
  if [ "$(docker node inspect self --format '{{index .Spec.Labels "failover"}}' 2>/dev/null || true)" = active ]; then
    echo "ok: this node was promoted on purpose (failover=active)"; exit 0
  fi
  alert "this node is NOT in recovery — it has been promoted (or is a primary)"; exit 1
fi
[ "$status" = streaming ] || { alert "WAL receiver status is '$status', not streaming"; exit 1; }
[ "$silent" -ge 0 ] && [ "$silent" -le "$MAX_SILENT_SECONDS" ] || { alert "the primary has been silent for ${silent}s (limit ${MAX_SILENT_SECONDS}s)"; exit 1; }
echo "ok: streaming, last message from the primary ${silent}s ago"
