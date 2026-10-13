#!/usr/bin/env bash
#
# Daily database backup with "verify first, replace after" (docs/ha-dr-plan.md §6).
#
# Dumps Postgres (custom format), checks the dump, optionally encrypts it with age, and
# only then atomically points `latest` at it — a bad or empty dump never replaces the last
# good copy. By default only that one copy is kept (KEEP=1, the owner's decision).
#
#   DATABASE_URL=postgres://user:pass@host:5432/db backup.sh          # one run
#   backup.sh --check                                                   # exit 1 if the last success is too old
#
# Layout under BACKUP_DIR:
#   snapshots/<utc-stamp>/db.dump[.age]  db.dump[.age].sha256  meta.env
#   latest -> snapshots/<utc-stamp>      (symlink, swapped atomically)
#   last-success                          (epoch seconds, for --check / monitoring)
#
# Settings (environment; /etc/pipe-backup.env when run by the systemd timer):
#   DATABASE_URL        required for a run
#   BACKUP_DIR          default /srv/backups
#   PG_DUMP, PG_RESTORE commands, default pg_dump / pg_restore. The dump is written to stdout and
#                       restore --list reads stdin, so a container works too, e.g.
#                       PG_DUMP="docker run --rm --network host postgres:16-alpine pg_dump"
#                       PG_RESTORE="docker run --rm -i postgres:16-alpine pg_restore"
#   AGE_RECIPIENT       age public key; set = the stored file is encrypted (db.dump.age)
#   MIN_BYTES           default 1024      — smaller than this is rejected as empty
#   MIN_RATIO_PERCENT   default 50        — smaller than this share of the previous dump is rejected
#   WARN_CHANGE_PERCENT default 30        — a bigger change is accepted but recorded as a warning
#   KEEP                default 1         — how many snapshots to keep
#   MAX_AGE_HOURS       default 26        — for --check
#   ALERT_CMD           optional; run with the message as $1 on failure / warning
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/srv/backups}"
PG_DUMP="${PG_DUMP:-pg_dump}"
PG_RESTORE="${PG_RESTORE:-pg_restore}"
MIN_BYTES="${MIN_BYTES:-1024}"
MIN_RATIO_PERCENT="${MIN_RATIO_PERCENT:-50}"
WARN_CHANGE_PERCENT="${WARN_CHANGE_PERCENT:-30}"
KEEP="${KEEP:-1}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"

log() { echo "[$(date -u +%FT%TZ)] $*"; }

alert() {
  log "ALERT: $1" >&2
  if [ -n "${ALERT_CMD:-}" ]; then $ALERT_CMD "$1" || true; fi
}

if [ "${1:-}" = "--check" ]; then
  if [ ! -f "$BACKUP_DIR/last-success" ]; then
    alert "no successful backup recorded in $BACKUP_DIR"; exit 1
  fi
  age_s=$(( $(date +%s) - $(cat "$BACKUP_DIR/last-success") ))
  if [ "$age_s" -gt $(( MAX_AGE_HOURS * 3600 )) ]; then
    alert "last successful backup is $(( age_s / 3600 )) h old (limit ${MAX_AGE_HOURS} h)"; exit 1
  fi
  log "ok: last backup $(( age_s / 3600 )) h ago"
  exit 0
fi

: "${DATABASE_URL:?DATABASE_URL is required}"

umask 077
mkdir -p "$BACKUP_DIR/snapshots"
exec 9>"$BACKUP_DIR/.lock"
flock -n 9 || { log "another backup is running"; exit 1; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$BACKUP_DIR/snapshots/.incoming-$STAMP"
mkdir -p "$WORK"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT
fail() { alert "backup failed — latest is unchanged: $1"; exit 1; }

log "dumping"
# shellcheck disable=SC2086
$PG_DUMP --format=custom --no-owner --dbname="$DATABASE_URL" > "$WORK/db.dump" || fail "pg_dump exited with an error"

raw_bytes=$(wc -c < "$WORK/db.dump" | tr -d ' ')
[ "$raw_bytes" -ge "$MIN_BYTES" ] || fail "dump is only $raw_bytes bytes (minimum $MIN_BYTES)"

# shellcheck disable=SC2086
toc=$($PG_RESTORE --list < "$WORK/db.dump") || fail "pg_restore cannot read the dump"
tables=$(printf '%s\n' "$toc" | grep -c ' TABLE DATA ' || true)
[ "$tables" -ge 1 ] || fail "dump contains no table data"

warning=""
if [ -L "$BACKUP_DIR/latest" ] && [ -f "$BACKUP_DIR/latest/meta.env" ]; then
  prev_bytes=$(grep '^RAW_BYTES=' "$BACKUP_DIR/latest/meta.env" | cut -d= -f2)
  if [ -n "$prev_bytes" ] && [ "$prev_bytes" -gt 0 ]; then
    ratio=$(( raw_bytes * 100 / prev_bytes ))
    [ "$ratio" -ge "$MIN_RATIO_PERCENT" ] || fail "dump is ${ratio}% of the previous one ($raw_bytes vs $prev_bytes bytes) — suspiciously small"
    change=$(( ratio > 100 ? ratio - 100 : 100 - ratio ))
    if [ "$change" -gt "$WARN_CHANGE_PERCENT" ]; then
      warning="size changed by ${change}% ($prev_bytes -> $raw_bytes bytes)"
    fi
  fi
fi

file="db.dump"
if [ -n "${AGE_RECIPIENT:-}" ]; then
  log "encrypting"
  age -r "$AGE_RECIPIENT" -o "$WORK/db.dump.age" "$WORK/db.dump" || fail "age failed"
  rm -f "$WORK/db.dump"
  file="db.dump.age"
fi
(cd "$WORK" && sha256sum "$file" > "$file.sha256" && sha256sum -c "$file.sha256" >/dev/null) || fail "checksum"

cat > "$WORK/meta.env" <<META
CREATED=$STAMP
RAW_BYTES=$raw_bytes
TABLES_WITH_DATA=$tables
FILE=$file
ENCRYPTED=$([ -n "${AGE_RECIPIENT:-}" ] && echo yes || echo no)
META

# Everything checked — now swap. `ln` + `mv -T` renames the symlink in one step, so a reader
# sees either the old snapshot or the new one, never a half-written state.
mv "$WORK" "$BACKUP_DIR/snapshots/$STAMP"
trap - EXIT
ln -sfn "snapshots/$STAMP" "$BACKUP_DIR/latest.new"
mv -T "$BACKUP_DIR/latest.new" "$BACKUP_DIR/latest"
date +%s > "$BACKUP_DIR/last-success"

# keep only the newest $KEEP snapshots
# shellcheck disable=SC2012
ls -1dt "$BACKUP_DIR"/snapshots/[0-9]* 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -rf

log "ok: $BACKUP_DIR/latest -> snapshots/$STAMP ($raw_bytes bytes, $tables tables with data)"
[ -z "$warning" ] || alert "backup accepted, but $warning"
