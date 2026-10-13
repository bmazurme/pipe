#!/usr/bin/env bash
#
# Switches bridge's file storage from the local volume to the Garage bucket `bridge-uploads` (STORAGE_DRIVER=s3). Run ON THE PRIMARY (white):
#
#   sudo infra/garage/enable-s3-storage.sh [--dry-run] [--deploy]
#
#   1. copies every file of the uploads volume into the bucket (rclone copy — never deletes) and CHECKS that each one arrived
#      (rclone check, size+hash); on any difference it stops BEFORE touching the settings;
#   2. adds STORAGE_DRIVER=s3 and the S3_* settings to ~/.pipe/bridge.env (the bucket's key is copied from /etc/garage/keys/bridge-uploads.env
#      on this board — the secret is never printed, never passes through a terminal or a log);
#   3. with --deploy: runs the normal deploy (deploy.sh ghcr stable) so the backend restarts with the new driver.
# Idempotent: a second run copies what is new and leaves the settings alone. The old volume is NOT deleted (it is your way back: set
# STORAGE_DRIVER=local and redeploy — files written to the bucket meanwhile would then not be visible, so do that only soon after).
#
# BEFORE this: stop the uploads pull on red (the old direction would delete what bridge writes into the bucket) — see
# infra/backup/README.md "Uploads: the bucket as the source"; AFTER: switch red's pull to UPLOADS_FROM=s3.
#
# Environment: KEYFILE (/etc/garage/keys/bridge-uploads.env), VOLUME (bridge_bridge_uploads), ENV_FILE (~/.pipe/bridge.env of the invoking user),
#              ENDPOINTS (comma list, default the four boards, white first), BRIDGE_DIR (~/bridge-pi).
set -euo pipefail

KEYFILE="${KEYFILE:-/etc/garage/keys/bridge-uploads.env}"
VOLUME="${VOLUME:-bridge_bridge_uploads}"
OWNER_HOME="$(getent passwd "${SUDO_USER:-$(id -un)}" | cut -d: -f6)"
ENV_FILE="${ENV_FILE:-$OWNER_HOME/.pipe/bridge.env}"
BRIDGE_DIR="${BRIDGE_DIR:-$OWNER_HOME/bridge-pi}"
ENDPOINTS="${ENDPOINTS:-http://192.168.50.11:3900,http://192.168.50.12:3900,http://192.168.50.13:3900,http://192.168.50.14:3900}"
DRY=0; DEPLOY=0
for a in "$@"; do case "$a" in --dry-run) DRY=1;; --deploy) DEPLOY=1;; *) echo "unknown argument: $a" >&2; exit 2;; esac; done
log() { echo "[$(date +%T)] $*"; }
die() { echo "REFUSED: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run with sudo (the bucket key is root-only)"
[ -r "$KEYFILE" ] || die "no $KEYFILE on this board"
[ -f "$ENV_FILE" ] || die "no $ENV_FILE"
for k in S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do grep -q "^$k=." "$KEYFILE" || die "$KEYFILE has no $k"; done
docker volume inspect "$VOLUME" >/dev/null 2>&1 || die "no volume $VOLUME on this board"

# rclone gets the key through a temp env-file (mode 600, removed on exit): not on a command line, not in a log
ENVF="$(mktemp)"; chmod 600 "$ENVF"; trap 'rm -f "$ENVF"' EXIT
(
  set -a; . "$KEYFILE"; set +a
  cat <<CONF
RCLONE_CONFIG_GARAGE_TYPE=s3
RCLONE_CONFIG_GARAGE_PROVIDER=Other
RCLONE_CONFIG_GARAGE_ENDPOINT=${ENDPOINTS%%,*}
RCLONE_CONFIG_GARAGE_REGION=${S3_REGION:-garage}
RCLONE_CONFIG_GARAGE_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID
RCLONE_CONFIG_GARAGE_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY
CONF
) > "$ENVF"
BUCKET="$(grep '^S3_BUCKET=' "$KEYFILE" | cut -d= -f2-)"
rc() { docker run --rm --network host --env-file "$ENVF" -v "$VOLUME":/data:ro rclone/rclone "$@"; }

files="$(docker run --rm -v "$VOLUME":/d:ro alpine sh -c 'find /d -type f | wc -l')"
log "the volume holds $files file(s); bucket: $BUCKET; endpoints: $ENDPOINTS"
rc lsd "garage:" >/dev/null 2>&1 || die "cannot reach the bucket's endpoint ${ENDPOINTS%%,*} with this key"

if [ "$DRY" = 1 ]; then
  echo "dry run: would copy $files file(s) to the bucket, verify them, add STORAGE_DRIVER=s3 + S3_* to $ENV_FILE$([ "$DEPLOY" = 1 ] && echo ', deploy'). Nothing was changed."
  exit 0
fi

log "copying the volume into the bucket (nothing is deleted)"
rc copy /data "garage:$BUCKET" >/dev/null 2>&1 || die "rclone copy failed — settings untouched"
rc check /data "garage:$BUCKET" --one-way >/dev/null 2>&1 || die "the check after the copy found a difference — settings untouched; compare with: rclone check"
log "every file of the volume is in the bucket and identical"

if grep -q '^STORAGE_DRIVER=s3' "$ENV_FILE"; then
  log "$ENV_FILE already says STORAGE_DRIVER=s3 — settings left alone"
else
  umask 077
  (
    set -a; . "$KEYFILE"; set +a
    {
      echo "# bridge file storage: the Garage bucket (infra/garage/enable-s3-storage.sh)"
      echo "STORAGE_DRIVER=s3"
      echo "S3_ENDPOINT=$ENDPOINTS"
      echo "S3_REGION=${S3_REGION:-garage}"
      echo "S3_BUCKET=$S3_BUCKET"
      echo "S3_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID"
      echo "S3_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY"
    } >> "$ENV_FILE"
  )
  chmod 600 "$ENV_FILE"
  log "$ENV_FILE: STORAGE_DRIVER=s3 and the S3_* settings added (the key itself was not shown)"
fi

if [ "$DEPLOY" = 1 ]; then
  log "deploying"
  sudo -u "${SUDO_USER:-root}" "$BRIDGE_DIR/deploy.sh" ghcr stable
else
  echo "next: ~/bridge-pi/deploy.sh ghcr stable   (or rerun with --deploy)"
fi
