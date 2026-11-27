#!/usr/bin/env bash
#
# R7 — the restore drill. Takes the latest backup, restores it into a throwaway Postgres, checks that what came back is really the
# database (the key tables hold rows, every table that had data in the dump has data now), measures how long it took, and reports the
# result to bridge — success or failure — so the Dashboard can say «last restored N days ago» and Telegram can say «not done for 35 days».
# restore-check.sh is the quick on-the-board version of this; this one is the monthly exercise with a number and a record.
#
#   restore-drill.sh                  one drill now
#   restore-drill.sh --if-due 30      do it only when the last SUCCESSFUL drill is 30+ days old (a weekly trigger → a monthly drill that
#                                     also catches up after the machine was off; this is what the timers run)
#
# Where the backup comes from (first that applies):
#   BACKUP_DIR=/srv/backups           a local directory holding `latest` (the Pi itself)
#   SOURCE_HOST=192.168.50.12         ssh pi@HOST 'sudo tar -C /srv/backups/latest -c .' (a workstation; the default, red)
# Encrypted backups need AGE_IDENTITY (the private key file) — so the drill runs where that key lives, not on a board that must never hold it.
#
# Report: BRIDGE_URL (https://…, no trailing slash) and BRIDGE_API_KEY — a personal key made with scope «boards» (Profile → API keys): it can
# post to the boards-agent routes and do nothing else. A report that cannot be delivered is kept in STATE_DIR/pending.json and sent first thing
# on the next run, so a bridge that was down for an hour does not lose the news. Without BRIDGE_URL the result is only printed.
#
# Settings may live in DRILL_ENV (default /etc/pipe-restore-drill.env, then ~/.config/pipe/restore-drill.env); plain KEY=value lines.
#   KEY_TABLES      tables whose exact row counts are recorded and compared drill to drill   (default: users api_keys jobs chats workers improve_runs)
#   REQUIRED_TABLES must exist and hold rows, or the drill fails                             (default: users)
#   PG_IMAGE        default postgres:16-alpine (the server's major version)
#   STATE_DIR       default ~/.local/state/pipe-restore-drill, /var/lib/pipe-restore-drill for root
#   DRILL_HOST      the name reported as «where it ran» (default: this machine's short hostname)
#   DOCKER, SSH, CURL   commands (tests put fakes here)
#
# Exit: 0 = restored and verified; 1 = the drill failed (and was reported); 2 = it passed but the report could not be delivered;
# 3 = skipped, nothing reported: Docker is not running or the source cannot be reached from here right now (a laptop off the home network is not
# a broken backup — the 35-day alert is what catches a drill that never gets to run).
# Written for bash 3.2 (a Mac's) as well as Linux.
set -uo pipefail

for conf in "${DRILL_ENV:-}" /etc/pipe-restore-drill.env "$HOME/.config/pipe/restore-drill.env"; do
  # shellcheck disable=SC1090
  if [ -n "$conf" ] && [ -r "$conf" ]; then set -a; . "$conf"; set +a; break; fi
done

DOCKER="${DOCKER:-docker}"
SSH="${SSH:-ssh}"
CURL="${CURL:-curl}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
KEY_TABLES="${KEY_TABLES:-users api_keys jobs chats workers improve_runs}"
REQUIRED_TABLES="${REQUIRED_TABLES:-users}"
SOURCE_HOST="${SOURCE_HOST:-192.168.50.12}"
if [ "$(id -u)" = 0 ]; then STATE_DIR="${STATE_DIR:-/var/lib/pipe-restore-drill}"; else STATE_DIR="${STATE_DIR:-$HOME/.local/state/pipe-restore-drill}"; fi
DRILL_HOST="${DRILL_HOST:-$(hostname -s 2>/dev/null | tr -c 'A-Za-z0-9._\n-' '-' | sed 's/^[^A-Za-z0-9]*//' | cut -c1-60)}"
[ -n "$DRILL_HOST" ] || DRILL_HOST=drill

log() { echo "[$(date -u +%FT%TZ)] $*"; }

IF_DUE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --if-due) IF_DUE="${2:?--if-due needs a number of days}"; shift 2;;
    -h|--help) sed -n '2,36p' "$0"; exit 0;;
    *) echo "unknown argument: $1" >&2; exit 64;;
  esac
done

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR" 2>/dev/null || true

# ---------------------------------------------------------------- report delivery
json_str() { printf '%s' "$1" | tr '\n\r\t' '   ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | cut -c1-480; }

# 0 = delivered, 1 = not (or no bridge configured)
deliver() { # file
  [ -n "${BRIDGE_URL:-}" ] && [ -n "${BRIDGE_API_KEY:-}" ] || return 1
  local code
  code=$($CURL -sS -o /dev/null -w '%{http_code}' --max-time 30 -X POST \
    -H 'Content-Type: application/json' -H "X-Api-Key: $BRIDGE_API_KEY" \
    --data-binary "@$1" "${BRIDGE_URL%/}/api/v1/boards/agent/restore-drill" 2>/dev/null) || return 1
  case "$code" in
    2??) return 0;;
    # A report bridge refuses as malformed will never be accepted — keeping it would block every later one.
    400) log "bridge refused the report as malformed (400) — dropping it"; return 0;;
    *) log "bridge answered $code"; return 1;;
  esac
}

flush_pending() {
  [ -f "$STATE_DIR/pending.json" ] || return 0
  if deliver "$STATE_DIR/pending.json"; then rm -f "$STATE_DIR/pending.json"; log "delivered the report kept from an earlier run"; fi
}

report() { # file ; returns 0 delivered / printed-only, 2 kept for later
  if [ -z "${BRIDGE_URL:-}" ] || [ -z "${BRIDGE_API_KEY:-}" ]; then log "BRIDGE_URL / BRIDGE_API_KEY not set — result is not reported"; return 0; fi
  if deliver "$1"; then return 0; fi
  cp "$1" "$STATE_DIR/pending.json"
  log "could not deliver the report — kept in $STATE_DIR/pending.json, it goes out on the next run"
  return 2
}

flush_pending

# ---------------------------------------------------------------- due?
if [ -n "$IF_DUE" ] && [ -f "$STATE_DIR/last-ok" ]; then
  last="$(cat "$STATE_DIR/last-ok" 2>/dev/null || echo 0)"
  age_days=$(( ( $(date +%s) - last ) / 86400 ))
  if [ "$age_days" -lt "$IF_DUE" ]; then log "not due: the last good drill was $age_days day(s) ago (every $IF_DUE)"; exit 0; fi
fi

# ---------------------------------------------------------------- the drill
TMP="$(mktemp -d)"
NAME="pipe-restore-drill-$$"
cleanup() { $DOCKER rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

CREATED=""

# A failed drill is still a result: report it, so «the backup does not restore» reaches the owner on the day it is found.
fail() {
  log "DRILL FAILED: $1"
  {
    printf '{"host":"%s","ok":false' "$(json_str "$DRILL_HOST")"
    [ -z "$CREATED" ] || printf ',"backupCreatedAt":"%s"' "$(json_str "$CREATED")"
    printf ',"error":"%s"}\n' "$(json_str "$1")"
  } > "$TMP/report.json"
  report "$TMP/report.json" || true
  exit 1
}

sha_check() { if command -v sha256sum >/dev/null 2>&1; then sha256sum -c "$1" >/dev/null 2>&1; else shasum -a 256 -c "$1" >/dev/null 2>&1; fi; }

skip() { log "skipped: $1 — nothing reported, the next run tries again"; exit 3; }

$DOCKER info >/dev/null 2>&1 || skip "Docker is not running"

if [ -n "${BACKUP_DIR:-}" ]; then
  [ -e "$BACKUP_DIR/latest" ] || fail "no $BACKUP_DIR/latest"
  log "using the local backup in $BACKUP_DIR/latest"
  cp -RL "$BACKUP_DIR/latest/." "$TMP/" 2>/dev/null || fail "cannot read $BACKUP_DIR/latest"
else
  log "fetching latest from $SOURCE_HOST"
  { $SSH -o BatchMode=yes -o ConnectTimeout=20 "pi@$SOURCE_HOST" 'sudo tar -C /srv/backups/latest -c .' | tar -x -C "$TMP"; } 2>/dev/null \
    || skip "cannot fetch the latest backup from $SOURCE_HOST (off the home network?)"
fi

[ -f "$TMP/meta.env" ] || fail "the backup has no meta.env"
FILE="" ENCRYPTED="" TABLES_WITH_DATA=0 RAW_BYTES=0
# shellcheck disable=SC1091
. "$TMP/meta.env"
CREATED="${CREATED:-}"
[ -n "$FILE" ] && [ -f "$TMP/$FILE" ] || fail "the backup's dump file is missing"
(cd "$TMP" && sha_check "$FILE.sha256") || fail "checksum mismatch — the copy on disk is damaged"
log "backup $CREATED, ${RAW_BYTES} bytes, encrypted: ${ENCRYPTED:-no}"

started="$(date +%s)"

if [ "${ENCRYPTED:-no}" = yes ]; then
  [ -n "${AGE_IDENTITY:-}" ] && [ -r "${AGE_IDENTITY:-}" ] || fail "the backup is encrypted and AGE_IDENTITY (the private key file) is not set or not readable here"
  command -v age >/dev/null 2>&1 || fail "age is not installed (brew install age / apt install age)"
  age -d -i "$AGE_IDENTITY" -o "$TMP/restore.dump" "$TMP/$FILE" 2>/dev/null || fail "age could not decrypt the backup with this key"
  DUMP="$TMP/restore.dump"
else
  DUMP="$TMP/$FILE"
fi

$DOCKER run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=restore "$PG_IMAGE" >/dev/null 2>&1 || fail "cannot start the throwaway Postgres ($PG_IMAGE)"
# The image first runs a temporary server (unix socket only), then restarts: only TCP answers for the final one.
ready=0
for _ in $(seq 1 ${READY_TRIES:-120}); do
  if $DOCKER exec "$NAME" pg_isready -h 127.0.0.1 -U postgres -d restore >/dev/null 2>&1; then ready=1; break; fi
  sleep "${READY_SLEEP:-1}"
done
[ "$ready" = 1 ] || fail "the throwaway Postgres did not become ready"

$DOCKER cp "$DUMP" "$NAME:/tmp/db.dump" >/dev/null 2>&1 || fail "cannot copy the dump into the container"
$DOCKER exec "$NAME" pg_restore --no-owner -U postgres -d restore /tmp/db.dump >"$TMP/restore.log" 2>&1 \
  || fail "pg_restore failed: $(tail -n 3 "$TMP/restore.log" | tr '\n' ' ')"

restore_seconds=$(( $(date +%s) - started ))

q() { $DOCKER exec "$NAME" psql -U postgres -d restore -Atc "$1" 2>/dev/null; }

# Exact numbers (pg_stat's estimates are not): every public table counted once.
totals="$(q "select count(*) filter (where n > 0), coalesce(sum(n), 0) from (select (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint as n from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') t")" \
  || fail "cannot count the restored tables"
tables="${totals%%|*}"
rows="${totals##*|}"
case "$tables$rows" in *[!0-9]*|'') fail "unreadable table counts: '$totals'";; esac

[ "$tables" -ge 1 ] || fail "nothing came back: no table has rows"
[ "$tables" -ge "${TABLES_WITH_DATA:-0}" ] || fail "only $tables tables have rows, the dump held data for $TABLES_WITH_DATA"

counts=""
counts_seen=""
for t in $KEY_TABLES $REQUIRED_TABLES; do
  case "$t" in *[!a-z0-9_]*|'') fail "KEY_TABLES / REQUIRED_TABLES: '$t' is not a plain table name";; esac
  case " $counts_seen " in *" $t "*) continue;; esac
  counts_seen="$counts_seen $t"
  n="$(q "select count(*) from public.\"$t\"")"
  case "$n" in
    ''|*[!0-9]*)
      case " $REQUIRED_TABLES " in *" $t "*) fail "table $t is missing from the restored database";; esac
      continue;;
  esac
  counts="${counts:+$counts,}\"$t\":$n"
  case " $REQUIRED_TABLES " in *" $t "*) [ "$n" -gt 0 ] || fail "table $t came back empty";; esac
done

migration="$(q "select name from migrations order by id desc limit 1" || true)"

log "restored in ${restore_seconds}s: $tables tables with rows, $rows rows; key tables: {${counts}}; last migration: ${migration:-unknown}"

{
  printf '{"host":"%s","ok":true,"backupCreatedAt":"%s","restoreSeconds":%s,"tables":%s,"rows":%s,"counts":{%s}' \
    "$(json_str "$DRILL_HOST")" "$(json_str "$CREATED")" "$restore_seconds" "$tables" "$rows" "$counts"
  [ -z "$migration" ] || printf ',"lastMigration":"%s"' "$(json_str "$migration")"
  printf '}\n'
} > "$TMP/report.json"

# Only a verified drill moves the clock: a failed one must not postpone the next attempt.
date +%s > "$STATE_DIR/last-ok"

report "$TMP/report.json"
