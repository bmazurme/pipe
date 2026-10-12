#!/usr/bin/env bash
#
# Builds the replica on THIS node (red) and starts it. Run on red, after setup-primary.sh on white and after
# REPLICATION_PASSWORD has been copied to ~/.pipe/standby.env here (see README):
#
#   ./setup-standby.sh
#
# Takes a base backup of the primary over the stack's overlay network into the volume `standby_pgdata`
# (pg_basebackup -R writes standby.signal and primary_conninfo, -X stream carries the WAL, -S uses the slot made on
# the primary), then deploys the `bridgesb` stack. Refuses to touch a volume that already holds a database.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$HOME/.pipe/standby.env"
VOLUME=standby_pgdata
SLOT="${SLOT:-standby_red}"
IMAGE=postgres:16-alpine
[ -f "$ENV_FILE" ] || { echo "no $ENV_FILE — copy REPLICATION_PASSWORD here first" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
: "${REPLICATION_PASSWORD:?REPLICATION_PASSWORD is missing in $ENV_FILE}"

if docker volume inspect "$VOLUME" >/dev/null 2>&1; then
  if docker run --rm -v "$VOLUME":/d alpine sh -c '[ -n "$(ls -A /d)" ]'; then
    echo "volume $VOLUME already holds data — not touching it (remove the stack and the volume to rebuild the replica)" >&2
    exit 1
  fi
else
  docker volume create "$VOLUME" >/dev/null
fi

# the postgres user of the image is uid 70; the data directory must be its own and mode 700
docker run --rm -v "$VOLUME":/d alpine sh -c 'chown 70:70 /d && chmod 700 /d'

echo "taking the base backup from the primary…"
docker run --rm --user postgres --network bridge_internal -e PGPASSWORD="$REPLICATION_PASSWORD" -v "$VOLUME":/var/lib/postgresql/data "$IMAGE" \
  pg_basebackup -h postgres -p 5432 -U replicator -D /var/lib/postgresql/data -R -X stream -S "$SLOT" -P -c fast

docker stack deploy -c "$HERE/bridge-standby.yml" bridgesb
echo "deployed; check with: docker stack ps bridgesb  and  ./status.sh from your workstation"
