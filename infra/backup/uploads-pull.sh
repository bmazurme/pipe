#!/usr/bin/env bash
#
# Keeps a copy of bridge's uploaded files (the `bridge_uploads` volume: parcels in transit, chat attachments) on THIS machine
# (red) and mirrors it to the Garage bucket `bridge-uploads`. The board pulls — the primary has no way to reach the copy.
#
#   SOURCE=pi@192.168.50.11:/ uploads-pull.sh        (the path is relative to what the restricted key exposes: the volume itself)
#   BACKUP_DIR=/srv/uploads-mirror uploads-pull.sh --check
#
# A mirror that follows deletions is a trap — an accidental wipe on the primary would wipe the copy at the next run. So:
#   - files the primary deleted are not removed here but moved to deleted/<date>/ (kept KEEP_DELETED_DAYS, default 14);
#   - a run that would delete more than half of the files (and more than 10) is refused and alerted (FORCE=1 overrides);
#   - the Garage mirror then follows the local copy (rclone sync, --max-delete 50).
#
# Two sources. UPLOADS_FROM=primary (default): rsync from the primary's volume, then mirror to Garage as above. UPLOADS_FROM=s3: bridge
# itself writes the files to the Garage bucket (STORAGE_DRIVER=s3), so the bucket is the SOURCE and this copy is the backup of it —
# the direction is reversed (bucket → here), never here → bucket (that would delete what bridge wrote). Same deleted-files bin and
# mass-delete guard.
#
# Settings (/etc/pipe-uploads.env for the timer):
#   UPLOADS_FROM      primary (default) | s3 — with s3 the S3_* settings below are the SOURCE, and SOURCE is not needed
#   SOURCE            required with UPLOADS_FROM=primary, rsync source ending in /
#   BACKUP_DIR        default /srv/uploads-mirror   (current/, deleted/, last-success)
#   SSH_KEY           default /root/.ssh/pull_uploads
#   KEEP_DELETED_DAYS default 14
#   MAX_AGE_HOURS     default 26 (--check)
#   S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY   optional; with them the copy is mirrored to Garage
#   RCLONE, DEST      override for tests (a native rclone command and a destination path)
#   ALERT_CMD         optional, run with the message as $1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/srv/uploads-mirror}"
SSH_KEY="${SSH_KEY:-/root/.ssh/pull_uploads}"
KEEP_DELETED_DAYS="${KEEP_DELETED_DAYS:-14}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"

log() { echo "[$(date -u +%FT%TZ)] $*"; }
alert() { log "ALERT: $1" >&2; if [ -n "${ALERT_CMD:-}" ]; then $ALERT_CMD "$1" || true; fi; }
fail() { alert "uploads copy failed — the local copy is unchanged: $1"; exit 1; }

if [ "${1:-}" = "--check" ]; then
  [ -f "$BACKUP_DIR/last-success" ] || { alert "no successful uploads copy recorded in $BACKUP_DIR"; exit 1; }
  age_s=$(( $(date +%s) - $(cat "$BACKUP_DIR/last-success") ))
  [ "$age_s" -le $(( MAX_AGE_HOURS * 3600 )) ] || { alert "the last uploads copy is $(( age_s / 3600 )) h old (limit ${MAX_AGE_HOURS} h)"; exit 1; }
  log "ok: last uploads copy $(( age_s / 3600 )) h ago"
  exit 0
fi

[ "${UPLOADS_FROM:-primary}" = s3 ] || : "${SOURCE:?SOURCE is required}"
umask 077
CURRENT="$BACKUP_DIR/current"
mkdir -p "$CURRENT" "$BACKUP_DIR/deleted"
exec 9>"$BACKUP_DIR/.lock"
flock -n 9 || { log "another run is active"; exit 1; }

stamp="$(date -u +%F)"

if [ "${UPLOADS_FROM:-primary}" = s3 ]; then
# ---- the bucket is the source
if [ -n "${RCLONE:-}" ]; then
  read -ra RC <<<"$RCLONE"; REMOTE="${DEST:?DEST is required with RCLONE}"; LOCAL="$CURRENT"; BIN="$BACKUP_DIR/deleted/$stamp"
else
  : "${S3_ENDPOINT:?S3_ENDPOINT is required}" "${S3_BUCKET:?S3_BUCKET is required}" "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required}" "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required}"
  ENVFILE="$(mktemp)"; chmod 600 "$ENVFILE"
  trap 'rm -f "$ENVFILE"' EXIT
  cat > "$ENVFILE" <<CONF
RCLONE_CONFIG_GARAGE_TYPE=s3
RCLONE_CONFIG_GARAGE_PROVIDER=Other
RCLONE_CONFIG_GARAGE_ENDPOINT=${S3_ENDPOINT%%,*}
RCLONE_CONFIG_GARAGE_REGION=${S3_REGION:-garage}
RCLONE_CONFIG_GARAGE_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID
RCLONE_CONFIG_GARAGE_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY
CONF
  RC=(docker run --rm --network host --env-file "$ENVFILE" -v "$BACKUP_DIR:/data" rclone/rclone)
  REMOTE="garage:$S3_BUCKET"; LOCAL="/data/current"; BIN="/data/deleted/$stamp"
fi
remote_files="$("${RC[@]}" lsf -R --files-only "$REMOTE" 2>/dev/null | sort)" || fail "cannot list the bucket"
have="$(find "$CURRENT" -type f | wc -l | tr -d ' ')"
if [ -z "$remote_files" ] && [ "$have" -gt 0 ] && [ -z "${FORCE:-}" ]; then
  fail "the bucket looks EMPTY while the local copy has $have files — refused (FORCE=1 if the bucket really was emptied)"
fi
deleting="$(comm -13 <(printf '%s\n' "$remote_files") <(cd "$CURRENT" && find . -type f | sed 's#^\./##' | sort) | wc -l | tr -d ' ')"
if [ "$deleting" -gt 10 ] && [ "$deleting" -gt $(( have / 2 )) ] && [ -z "${FORCE:-}" ]; then
  fail "this run would delete $deleting of $have files — refused (set FORCE=1 if that is really what happened in the bucket)"
fi
log "pulling the bucket"
"${RC[@]}" sync "$REMOTE" "$LOCAL" --backup-dir "$BIN" >/dev/null 2>&1 || fail "rclone sync from the bucket failed"
find "$BACKUP_DIR/deleted" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DELETED_DAYS" -exec rm -rf {} + 2>/dev/null || true
mirrored=", from the bucket"
else
SSH_CMD="ssh -i $SSH_KEY -o BatchMode=yes -o ConnectTimeout=20"

# What would this run delete? (itemize lines starting with "*deleting")
plan="$(rsync -a --delete --dry-run --itemize-changes -e "$SSH_CMD" "$SOURCE" "$CURRENT/" 2>&1)" || fail "rsync (dry run): $(printf '%s' "$plan" | tail -c 200)"
deleting="$(printf '%s\n' "$plan" | grep -c '^\*deleting' || true)"
have="$(find "$CURRENT" -type f | wc -l | tr -d ' ')"
if [ "$deleting" -gt 10 ] && [ "$deleting" -gt $(( have / 2 )) ] && [ -z "${FORCE:-}" ]; then
  fail "this run would delete $deleting of $have files — refused (set FORCE=1 if that is really what happened on the primary)"
fi

log "pulling $SOURCE"
rsync -a --delete --backup --backup-dir="$BACKUP_DIR/deleted/$stamp" -e "$SSH_CMD" "$SOURCE" "$CURRENT/" || fail "rsync error"

# the deleted-files bin: keep KEEP_DELETED_DAYS
find "$BACKUP_DIR/deleted" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DELETED_DAYS" -exec rm -rf {} + 2>/dev/null || true

# --- Garage
mirrored=""
if [ -n "${RCLONE:-}" ] || [ -n "${S3_ENDPOINT:-}" ]; then
  ENVFILE=""
  if [ -z "${RCLONE:-}" ]; then
    : "${S3_BUCKET:?S3_BUCKET is required}" "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required}" "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required}"
    ENVFILE="$(mktemp)"; chmod 600 "$ENVFILE"
    cat > "$ENVFILE" <<CONF
RCLONE_CONFIG_GARAGE_TYPE=s3
RCLONE_CONFIG_GARAGE_PROVIDER=Other
RCLONE_CONFIG_GARAGE_ENDPOINT=$S3_ENDPOINT
RCLONE_CONFIG_GARAGE_REGION=${S3_REGION:-garage}
RCLONE_CONFIG_GARAGE_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID
RCLONE_CONFIG_GARAGE_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY
CONF
    trap 'rm -f "$ENVFILE"' EXIT
    RCLONE_CMD=(docker run --rm --network host --env-file "$ENVFILE" -v "$CURRENT:/data:ro" rclone/rclone)
    SRC="/data"; TARGET="garage:$S3_BUCKET"
  else
    read -ra RCLONE_CMD <<<"$RCLONE"; SRC="$CURRENT"; TARGET="${DEST:?DEST is required with RCLONE}"
  fi
  "${RCLONE_CMD[@]}" sync "$SRC" "$TARGET" --max-delete 50 >/dev/null 2>&1 || fail "the Garage mirror (rclone sync) failed — the local copy is up to date, the S3 one is not"
  mirrored=", mirrored to Garage"
fi
fi

date +%s > "$BACKUP_DIR/last-success"
log "ok: $(find "$CURRENT" -type f | wc -l | tr -d ' ') files in $CURRENT (${deleting} deleted upstream, kept in deleted/$stamp)$mirrored"
