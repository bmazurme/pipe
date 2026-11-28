#!/usr/bin/env bash
#
# S11 — does THIS copy of the backup key still open the newest backup? An age key that sits in a drawer, on a USB stick or on paper is a hope until
# it has decrypted something. Run it once per copy, with that copy's file, and it tells bridge which copy worked and when — the Dashboard counts
# verified copies (two are wanted: losing the only copy of the key loses every backup) and nags when one has not been tried for 150 days.
#
#   key-check.sh --label mac   --identity ~/Documents/pipe-backup-key.txt
#   key-check.sh --label usb   --identity /Volumes/KEYS/pipe-backup-key.txt
#   key-check.sh --label paper --identity /tmp/typed-in-from-paper.txt      # shred the file afterwards
#
# It fetches the newest backup (BACKUP_DIR for a local one, or SOURCE_HOST over ssh — the same as restore-drill.sh), checks its checksum, and
# decrypts it with the given key. It does NOT restore it (that is restore-drill.sh's job): decrypting the whole file with authentication, and
# finding the Postgres dump header inside, is the proof the key is the right one and the copy is intact. The key file is only read, never copied
# or printed. Settings (SOURCE_HOST, BRIDGE_URL, BRIDGE_API_KEY) come from the same file as restore-drill.sh: KEYCHECK_ENV, then
# /etc/pipe-restore-drill.env, then ~/.config/pipe/restore-drill.env.
#
# Exit: 0 = this copy opened the backup (reported); 1 = it did not (reported, with the reason); 2 = it worked but the report could not be delivered;
# 3 = skipped, nothing reported (the source cannot be reached from here right now); 64 = bad usage.
# Written for bash 3.2 (a Mac's) as well as Linux.
set -uo pipefail

for conf in "${KEYCHECK_ENV:-}" /etc/pipe-restore-drill.env "$HOME/.config/pipe/restore-drill.env"; do
  # shellcheck disable=SC1090
  if [ -n "$conf" ] && [ -r "$conf" ]; then set -a; . "$conf"; set +a; break; fi
done

SSH="${SSH:-ssh}"
CURL="${CURL:-curl}"
SOURCE_HOST="${SOURCE_HOST:-192.168.50.12}"

log() { echo "[$(date -u +%FT%TZ)] $*"; }

LABEL="" IDENTITY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --label) LABEL="${2:-}"; shift 2;;
    --identity) IDENTITY="${2:-}"; shift 2;;
    -h|--help) sed -n '2,24p' "$0"; exit 0;;
    *) echo "unknown argument: $1" >&2; exit 64;;
  esac
done

case "$LABEL" in
  '') echo "--label is required (mac, usb, paper…)" >&2; exit 64;;
  *[!A-Za-z0-9._\ -]*) echo "--label: letters, digits, space . _ - only" >&2; exit 64;;
esac
[ "${#LABEL}" -le 40 ] || { echo "--label: at most 40 characters" >&2; exit 64; }
[ -n "$IDENTITY" ] || { echo "--identity (the key file of this copy) is required" >&2; exit 64; }

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

json_str() { printf '%s' "$1" | tr '\n\r\t' '   ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | cut -c1-480; }

CREATED=""

deliver() { # 0 = delivered (or dropped as unacceptable), 1 = not
  [ -n "${BRIDGE_URL:-}" ] && [ -n "${BRIDGE_API_KEY:-}" ] || return 1
  local code
  code=$($CURL -sS -o /dev/null -w '%{http_code}' --max-time 30 -X POST \
    -H 'Content-Type: application/json' -H "X-Api-Key: $BRIDGE_API_KEY" \
    --data-binary "@$1" "${BRIDGE_URL%/}/api/v1/boards/agent/key-check" 2>/dev/null) || return 1
  case "$code" in 2??|400) return 0;; *) return 1;; esac
}

report() { # ok(true|false) error ; returns 0 delivered or not configured, 2 not delivered
  {
    printf '{"label":"%s","ok":%s' "$(json_str "$LABEL")" "$1"
    [ -z "$CREATED" ] || printf ',"backupCreatedAt":"%s"' "$(json_str "$CREATED")"
    [ -z "${2:-}" ] || printf ',"error":"%s"' "$(json_str "$2")"
    printf '}\n'
  } > "$TMP/report.json"
  if [ -z "${BRIDGE_URL:-}" ] || [ -z "${BRIDGE_API_KEY:-}" ]; then log "BRIDGE_URL / BRIDGE_API_KEY not set — result is not reported"; return 0; fi
  deliver "$TMP/report.json" || { log "could not deliver the report to bridge"; return 2; }
}

fail() {
  log "KEY CHECK FAILED ($LABEL): $1"
  report false "$1" || true
  exit 1
}

# --- the key file: readable, and it looks like an age identity (never printed)
[ -r "$IDENTITY" ] || fail "the key file is not readable: $IDENTITY"
grep -q '^AGE-SECRET-KEY-' "$IDENTITY" 2>/dev/null || fail "the file is not an age identity (no AGE-SECRET-KEY- line)"
command -v age >/dev/null 2>&1 || fail "age is not installed (brew install age / apt install age)"

# --- the newest backup
if [ -n "${BACKUP_DIR:-}" ]; then
  [ -e "$BACKUP_DIR/latest" ] || fail "no $BACKUP_DIR/latest"
  cp -RL "$BACKUP_DIR/latest/." "$TMP/" 2>/dev/null || fail "cannot read $BACKUP_DIR/latest"
else
  log "fetching latest from $SOURCE_HOST"
  { $SSH -o BatchMode=yes -o ConnectTimeout=20 "pi@$SOURCE_HOST" 'sudo tar -C /srv/backups/latest -c .' | tar -x -C "$TMP"; } 2>/dev/null \
    || { log "skipped: cannot fetch the latest backup from $SOURCE_HOST (off the home network?) — nothing reported"; exit 3; }
fi

[ -f "$TMP/meta.env" ] || fail "the backup has no meta.env"
FILE="" ENCRYPTED=""
# shellcheck disable=SC1091
. "$TMP/meta.env"
CREATED="${CREATED:-}"

if [ "${ENCRYPTED:-no}" != yes ]; then
  log "the newest backup is not encrypted — there is no key to check (set AGE_RECIPIENT in /etc/pipe-backup.env)"
  exit 0
fi

[ -n "$FILE" ] && [ -f "$TMP/$FILE" ] || fail "the backup's file is missing"
if command -v sha256sum >/dev/null 2>&1; then ok_sum() { (cd "$TMP" && sha256sum -c "$FILE.sha256" >/dev/null 2>&1); }; else ok_sum() { (cd "$TMP" && shasum -a 256 -c "$FILE.sha256" >/dev/null 2>&1); }; fi
ok_sum || fail "checksum mismatch — the copy of the backup on disk is damaged (this says nothing about the key)"

# --- the proof: decrypt all of it (age authenticates every chunk), and find the Postgres custom-format header inside
age -d -i "$IDENTITY" -o "$TMP/out.dump" "$TMP/$FILE" >"$TMP/age.log" 2>&1 \
  || fail "this key does not open the backup: $(tail -n 1 "$TMP/age.log")"
[ "$(head -c 5 "$TMP/out.dump")" = "PGDMP" ] || fail "decrypted, but the result is not a Postgres dump (no PGDMP header)"

log "key '$LABEL' opened the backup $CREATED"
report true
