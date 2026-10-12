#!/usr/bin/env bash
#
# Proves from YOUR machine that the Pi's latest backup restores — the only place that can do it once the
# backups are encrypted (the private age key lives with you, not on the boards).
#
#   AGE_IDENTITY=~/Documents/pipe-backup-key.txt infra/backup/verify-from-workstation.sh [host]
#
# host defaults to red (192.168.50.12, the pulled copy); use 192.168.50.11 for the primary. Needs ssh to the
# board, docker, and `age` for encrypted backups (brew install age). Works on macOS and Linux.
set -euo pipefail

HOST="${1:-192.168.50.12}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
TMP="$(mktemp -d)"
NAME="pipe-verify-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

sha_check() { if command -v sha256sum >/dev/null; then sha256sum -c "$1" >/dev/null; else shasum -a 256 -c "$1" >/dev/null; fi; }

echo "fetching latest from $HOST"
ssh -o BatchMode=yes "pi@$HOST" 'sudo tar -C /srv/backups/latest -c .' | tar -x -C "$TMP"
# shellcheck disable=SC1091
. "$TMP/meta.env"
(cd "$TMP" && sha_check "$FILE.sha256") || { echo "checksum mismatch" >&2; exit 1; }
echo "backup $CREATED, $RAW_BYTES bytes, encrypted: $ENCRYPTED"

if [ "$ENCRYPTED" = yes ]; then
  : "${AGE_IDENTITY:?AGE_IDENTITY (path to your private age key) is required for an encrypted backup}"
  age -d -i "$AGE_IDENTITY" -o "$TMP/restore.dump" "$TMP/$FILE"
  DUMP="$TMP/restore.dump"
else
  DUMP="$TMP/$FILE"
fi

docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=check -e POSTGRES_DB=restore "$PG_IMAGE" >/dev/null
ready=0
for _ in $(seq 1 120); do
  if docker exec "$NAME" pg_isready -h 127.0.0.1 -U postgres -d restore >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] || { echo "throwaway postgres did not become ready" >&2; exit 1; }

docker cp "$DUMP" "$NAME:/tmp/db.dump"
docker exec "$NAME" pg_restore --no-owner -U postgres -d restore /tmp/db.dump
tables="$(docker exec "$NAME" psql -U postgres -d restore -Atc "select count(*) from information_schema.tables where table_schema='public'")"
rows="$(docker exec "$NAME" psql -U postgres -d restore -Atc "select coalesce(sum(n_live_tup),0)::bigint from pg_stat_user_tables")"
echo "restored: $tables tables, ~$rows rows"
[ "$tables" -ge 1 ] || { echo "nothing restored" >&2; exit 1; }
