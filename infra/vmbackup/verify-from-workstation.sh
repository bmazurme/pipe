#!/usr/bin/env bash
#
# Proves from YOUR machine that the NAS's latest backup of notes and places restores — the only place that can, because the private age key lives
# with you, not on the NAS and not on the VM.
#
#   AGE_IDENTITY=~/Documents/pipe-backup-key.txt infra/vmbackup/verify-from-workstation.sh
#
# Copies the latest snapshot off the NAS (read-only), checks SHA256SUMS, decrypts each file, restores every database into a throw-away Postgres
# (docker) and lists what is in it, and checks that the files and the configuration are readable archives. Needs ssh to the NAS (NAS_KEY), docker
# and `age` (brew install age). Works on macOS and Linux. Nothing is written outside a temporary directory.
set -euo pipefail

NAS_HOST="${NAS_HOST:-192.168.50.216}"
NAS_KEY="${NAS_KEY:-$HOME/.ssh/nas_ed25519}"
NAS_USER="${NAS_USER:-sshd}"
NAS_VM_DIR="${NAS_VM_DIR:-/mnt/HD/HD_a2/Nas_Prog/pipe-backup-pull/vm-backups}"
PG_IMAGE="${PG_IMAGE:-postgres:13-alpine}"
: "${AGE_IDENTITY:?AGE_IDENTITY (path to your private age key) is required}"
TMP="$(mktemp -d)"
NAME="pipe-vm-verify-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
sha_check() { if command -v sha256sum >/dev/null; then sha256sum -c "$1" >/dev/null; else shasum -a 256 -c "$1" >/dev/null; fi; }

echo "fetching the latest snapshot from the NAS"
ssh -i "$NAS_KEY" -o IdentitiesOnly=yes -o BatchMode=yes "$NAS_USER@$NAS_HOST" "tar -C '$NAS_VM_DIR/latest' -c ." | tar -x -C "$TMP"
# meta.env is read as data, never sourced (an older snapshot has DBS=notes-db places, which a shell would try to run).
CREATED="$(sed -n 's/^CREATED=//p' "$TMP/meta.env" | head -1)"
DBS="$(sed -n 's/^DBS=//p' "$TMP/meta.env" | head -1 | tr -d '"')"
[ -n "$CREATED" ] && [ -n "$DBS" ] || { echo "meta.env of the snapshot is unreadable" >&2; exit 1; }
echo "snapshot $CREATED (databases: $DBS)"
(cd "$TMP" && sha_check SHA256SUMS) || { echo "checksum mismatch" >&2; exit 1; }
echo "ok   checksums"

docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=check "$PG_IMAGE" >/dev/null
ready=0
for _ in $(seq 1 120); do docker exec "$NAME" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && { ready=1; break; }; sleep 1; done
[ "$ready" = 1 ] || { echo "the verification Postgres did not start" >&2; exit 1; }

bad=0
for db in $DBS; do
  age -d -i "$AGE_IDENTITY" -o "$TMP/$db.dump" "$TMP/$db.dump.age"
  docker exec "$NAME" createdb -U postgres "$db"
  if docker exec -i "$NAME" pg_restore -U postgres -d "$db" --no-owner < "$TMP/$db.dump"; then
    tables="$(docker exec "$NAME" psql -U postgres -d "$db" -Atc "select count(*) from pg_stat_user_tables")"
    rows="$(docker exec "$NAME" psql -U postgres -d "$db" -Atc "select coalesce(sum(n_live_tup), 0) from pg_stat_user_tables")"
    echo "ok   $db restores: $tables tables, about $rows rows"
    [ "$tables" -gt 0 ] || { echo "FAIL $db has no tables" >&2; bad=1; }
  else
    echo "FAIL $db did not restore" >&2; bad=1
  fi
done

for part in files:files.tar.age config:config.tar.age; do
  name="${part%%:*}"; file="${part#*:}"
  age -d -i "$AGE_IDENTITY" -o "$TMP/$name.tar" "$TMP/$file"
  if tar -tf "$TMP/$name.tar" >/dev/null; then echo "ok   $name: $(tar -tf "$TMP/$name.tar" | wc -l | tr -d ' ') entries"; else echo "FAIL $name is not a readable archive" >&2; bad=1; fi
done
[ "$bad" = 0 ] && echo "the latest backup of notes and places restores" || { echo "THE BACKUP DOES NOT FULLY RESTORE" >&2; exit 1; }
