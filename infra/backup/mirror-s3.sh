#!/usr/bin/env bash
#
# Copies the latest (already encrypted, already verified) backup to the Garage S3 bucket `bridge-backups`.
# Runs on the second Pi after pull.sh — the Pi pushes, the primary has no access to this copy.
#
#   mirror-s3.sh
#
# Same rule as the rest: verify first, replace after. The copy goes to an immutable prefix
# `snapshots/<CREATED>/`, is compared with the local files (rclone check), and only then is the pointer
# object `LATEST` (it holds the snapshot name) rewritten. Older snapshots beyond KEEP are removed last.
# A crash at any point leaves LATEST pointing at the previous complete snapshot.
#
# Settings (/etc/pipe-backup-s3.env when run by the systemd timer):
#   S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY   (the key file Garage's cluster.sh
#                       wrote, /etc/garage/keys/bridge-backups.env, copied here)
#   BACKUP_DIR          default /srv/backups (the local copy to upload)
#   KEEP                default 1
#   RCLONE, DEST        override for tests: a native rclone command and a destination path
#   ALERT_CMD           optional; run with the message as $1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/srv/backups}"
KEEP="${KEEP:-1}"

log() { echo "[$(date -u +%FT%TZ)] $*"; }
alert() { log "ALERT: $1" >&2; if [ -n "${ALERT_CMD:-}" ]; then $ALERT_CMD "$1" || true; fi; }
fail() { alert "S3 mirror failed — the previous snapshot is still the latest: $1"; exit 1; }

[ -L "$BACKUP_DIR/latest" ] && [ -f "$BACKUP_DIR/latest/meta.env" ] || fail "no local backup in $BACKUP_DIR/latest"
# shellcheck disable=SC1091
. "$BACKUP_DIR/latest/meta.env"
[ -n "${CREATED:-}" ] || fail "meta.env has no CREATED"

ENVFILE=""
if [ -z "${RCLONE:-}" ]; then
  : "${S3_ENDPOINT:?S3_ENDPOINT is required}" "${S3_BUCKET:?S3_BUCKET is required}"
  : "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required}" "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required}"
  # Credentials go in through an env file, not the command line (visible in `ps`).
  ENVFILE="$(mktemp)"
  chmod 600 "$ENVFILE"
  cat > "$ENVFILE" <<CONF
RCLONE_CONFIG_GARAGE_TYPE=s3
RCLONE_CONFIG_GARAGE_PROVIDER=Other
RCLONE_CONFIG_GARAGE_ENDPOINT=$S3_ENDPOINT
RCLONE_CONFIG_GARAGE_REGION=${S3_REGION:-garage}
RCLONE_CONFIG_GARAGE_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID
RCLONE_CONFIG_GARAGE_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY
CONF
  trap 'rm -f "$ENVFILE"' EXIT
  RCLONE_CMD=(docker run --rm -i --network host --env-file "$ENVFILE" -v "$BACKUP_DIR:/data:ro" rclone/rclone)
  SRC="/data/latest/"
  DEST="garage:$S3_BUCKET"
else
  read -ra RCLONE_CMD <<<"$RCLONE"
  SRC="$BACKUP_DIR/latest/"
  : "${DEST:?DEST is required with RCLONE}"
fi
rc() { "${RCLONE_CMD[@]}" "$@"; }

snap="snapshots/$CREATED"
log "uploading $CREATED to $snap"
rc copy "$SRC" "$DEST/$snap" || fail "upload"
rc check "$SRC" "$DEST/$snap" --one-way >/dev/null 2>&1 || fail "the uploaded copy does not match the local one"

printf '%s' "$CREATED" | rc rcat "$DEST/LATEST" || fail "writing LATEST"

# keep the newest $KEEP snapshots, drop the rest (names sort chronologically)
rc lsf "$DEST/snapshots" --dirs-only 2>/dev/null | tr -d '/' | sort | head -n -"$KEEP" | while read -r old; do
  [ -n "$old" ] && [ "$old" != "$CREATED" ] && rc purge "$DEST/snapshots/$old" && log "removed old snapshot $old"
done

date +%s > "$BACKUP_DIR/last-mirror"
log "ok: $DEST LATEST=$CREATED"
