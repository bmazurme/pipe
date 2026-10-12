#!/usr/bin/env bash
#
# Proves the latest backup actually restores: loads it into a throwaway Postgres container
# and counts what came back. A backup that was never restored is a hope, not a backup —
# run this after changes and now and then (monthly) from cron.
#
#   BACKUP_DIR=/srv/backups restore-check.sh
#   AGE_IDENTITY=~/.config/age/key.txt restore-check.sh      # when backups are encrypted
#
# Needs docker (the postgres image is pulled on first use). Exit 0 = restored, tables found.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/srv/backups}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
LATEST="$BACKUP_DIR/latest"
[ -L "$LATEST" ] || { echo "no $LATEST" >&2; exit 1; }

# shellcheck disable=SC1091
. "$LATEST/meta.env"
(cd "$LATEST" && sha256sum -c "$FILE.sha256" >/dev/null) || { echo "checksum mismatch" >&2; exit 1; }

TMP="$(mktemp -d)"
NAME="pipe-restore-check-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

if [ "$ENCRYPTED" = yes ]; then
  : "${AGE_IDENTITY:?AGE_IDENTITY (private key file) is required for an encrypted backup}"
  age -d -i "$AGE_IDENTITY" -o "$TMP/db.dump" "$LATEST/$FILE"
else
  cp "$LATEST/$FILE" "$TMP/db.dump"
fi

docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=check -e POSTGRES_DB=restore "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U postgres -d restore >/dev/null 2>&1 && break
  sleep 1
done

docker cp "$TMP/db.dump" "$NAME:/tmp/db.dump"
docker exec "$NAME" pg_restore --no-owner -U postgres -d restore /tmp/db.dump

tables=$(docker exec "$NAME" psql -U postgres -d restore -Atc "select count(*) from information_schema.tables where table_schema='public'")
rows=$(docker exec "$NAME" psql -U postgres -d restore -Atc "select coalesce(sum(n_live_tup),0)::bigint from pg_stat_user_tables")
echo "restored: $tables tables, ~$rows rows (backup $CREATED, $RAW_BYTES bytes)"
[ "$tables" -ge 1 ] || { echo "nothing restored" >&2; exit 1; }
