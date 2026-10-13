#!/usr/bin/env bash
#
# Makes the replica the primary — ONLY when the real primary (white) is gone for good or you are failing over on
# purpose. Run on red. It asks you to type PROMOTE: a promoted replica cannot be turned back into a replica without
# a new base backup, and if white is actually still alive you would end up with two diverging databases.
#
#   ./promote.sh
#
# After it, the data lives on red only. The rest of a failover (docs/ha-dr-plan.md §8, infra/standby/README.md):
# start the bridge stack on red against this database, point the router's 80/443 forwards to red, and rebuild a new
# replica or restore white from backups before going back.
set -euo pipefail

DB_USER="${DB_USER:-bridge}"   # the superuser of the stack's database (POSTGRES_USER)

c="$(docker ps --filter name=bridgesb_postgres-standby -q | head -1)"
[ -n "$c" ] || { echo "the standby container is not running here" >&2; exit 1; }
[ "$(docker exec "$c" psql -U "$DB_USER" -Atc 'SELECT pg_is_in_recovery()' postgres)" = t ] || { echo "already a primary" >&2; exit 1; }

echo "last replayed transaction: $(docker exec "$c" psql -U "$DB_USER" -Atc "SELECT COALESCE(pg_last_xact_replay_timestamp()::text,'n/a')" postgres)"
# infra/failover/failover-red.sh has already asked (on the workstation) and passes PROMOTE_CONFIRMED=yes.
if [ "${PROMOTE_CONFIRMED:-}" != yes ]; then
  read -r -p "Promote this replica to the primary? Type PROMOTE to continue: " answer
  [ "$answer" = PROMOTE ] || { echo "cancelled"; exit 1; }
fi

docker exec "$c" psql -U "$DB_USER" -Atc 'SELECT pg_promote(wait => true, wait_seconds => 60)' postgres
[ "$(docker exec "$c" psql -U "$DB_USER" -Atc 'SELECT pg_is_in_recovery()' postgres)" = f ] && echo "promoted: this node is now a read-write primary"
