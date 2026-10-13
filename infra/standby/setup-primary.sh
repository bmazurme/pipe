#!/usr/bin/env bash
#
# Prepares the PRIMARY Postgres (the bridge_postgres service on white) to feed a streaming replica. Run on white:
#
#   ./setup-primary.sh
#
# Idempotent. It
#   - creates the replication role `replicator` (REPLICATION only, no other rights) with a generated password kept in
#     ~/.pipe/bridge.env as REPLICATION_PASSWORD (never printed),
#   - allows that role to connect for replication from the stack's overlay network (a line in pg_hba.conf, which lives
#     in the data volume and so survives restarts),
#   - creates the physical replication slot `standby_red` (the primary keeps the WAL the replica still needs) and caps
#     what a stuck replica can make the primary hold back (max_slot_wal_keep_size), so a dead replica can never fill
#     white's disk.
set -euo pipefail

ENV_FILE="$HOME/.pipe/bridge.env"
SLOT="${SLOT:-standby_red}"
KEEP="${MAX_SLOT_WAL_KEEP:-4GB}"
[ -f "$ENV_FILE" ] || { echo "no $ENV_FILE" >&2; exit 1; }

if ! grep -q '^REPLICATION_PASSWORD=.' "$ENV_FILE"; then
  umask 077
  printf 'REPLICATION_PASSWORD=%s\n' "$(openssl rand -hex 24)" >> "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "REPLICATION_PASSWORD: generated"
fi
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

c="$(docker ps --filter name=bridge_postgres -q | head -1)"
[ -n "$c" ] || { echo "the bridge_postgres container is not running on this node" >&2; exit 1; }
SUBNET="$(docker network inspect bridge_internal --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}')"
[ -n "$SUBNET" ] || { echo "network bridge_internal not found" >&2; exit 1; }

psql_() { docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$c" psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-bridge}" -d "${POSTGRES_DB:-ntlstl-db}" -Atq "$@"; }

# the password goes in through stdin, not the command line
psql_ <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replicator') THEN
    CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '${REPLICATION_PASSWORD}';
  ELSE
    ALTER ROLE replicator WITH REPLICATION LOGIN PASSWORD '${REPLICATION_PASSWORD}';
  END IF;
END
\$\$;
SQL
echo "role replicator: ok"

HBA=/var/lib/postgresql/data/pg_hba.conf
LINE="host replication replicator $SUBNET scram-sha-256"
docker exec "$c" sh -c "grep -qxF '$LINE' $HBA || echo '$LINE' >> $HBA"
echo "pg_hba: $LINE"

psql_ -c "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name='$SLOT') THEN 'slot exists' ELSE (SELECT 'slot created: ' || slot_name FROM pg_create_physical_replication_slot('$SLOT')) END"
psql_ -c "ALTER SYSTEM SET max_slot_wal_keep_size = '$KEEP'" >/dev/null
psql_ -c "SELECT pg_reload_conf()" >/dev/null
echo "max_slot_wal_keep_size = $KEEP; configuration reloaded"
echo "next: copy REPLICATION_PASSWORD to the replica node (see README), then ./setup-standby.sh there"
