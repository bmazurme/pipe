#!/usr/bin/env bash
#
# Pulls the latest verified backup from the primary onto THIS machine (the copy on a second Pi).
# The Pi pulls — the primary has no way to reach the copy, so a compromised primary cannot touch it.
#
#   SOURCE=pi@192.168.50.11:latest/ pull.sh
#
# Same rule as backup.sh: the pulled copy is verified (checksum, meta, not older than what is already
# here) before it replaces anything; a failed pull leaves the last good copy untouched.
#
# Settings:
#   SOURCE        required; rsync source, a path relative to the primary's /srv/backups when the key is
#                 restricted with `rrsync -ro /srv/backups` (see install-pull.sh), e.g. pi@192.168.50.11:latest/
#   BACKUP_DIR    default /srv/backups
#   SSH_KEY       default /root/.ssh/pull_backups
#   KEEP          default 1
#   ALERT_CMD     optional; run with the message as $1
#
# last-success is set from the backup's own creation time, so `backup.sh --check` here also notices a
# primary that stopped producing backups, not just a broken pull.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/srv/backups}"
SSH_KEY="${SSH_KEY:-/root/.ssh/pull_backups}"
KEEP="${KEEP:-1}"
: "${SOURCE:?SOURCE is required}"

log() { echo "[$(date -u +%FT%TZ)] $*"; }
alert() { log "ALERT: $1" >&2; if [ -n "${ALERT_CMD:-}" ]; then $ALERT_CMD "$1" || true; fi; }

umask 077
mkdir -p "$BACKUP_DIR/snapshots"
exec 9>"$BACKUP_DIR/.lock"
flock -n 9 || { log "another run is active"; exit 1; }

WORK="$BACKUP_DIR/snapshots/.incoming-$$"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT
fail() { alert "pull failed — the local copy is unchanged: $1"; exit 1; }

mkdir -p "$WORK"
log "pulling $SOURCE"
rsync -a --delete -e "ssh -i $SSH_KEY -o BatchMode=yes -o ConnectTimeout=20" "$SOURCE" "$WORK/" || fail "rsync error"

[ -f "$WORK/meta.env" ] || fail "no meta.env in the pulled copy"
# shellcheck disable=SC1091
. "$WORK/meta.env"
[ -n "${CREATED:-}" ] && [ -n "${FILE:-}" ] || fail "meta.env is incomplete"
[ -f "$WORK/$FILE" ] && [ -f "$WORK/$FILE.sha256" ] || fail "dump or checksum file missing"
(cd "$WORK" && sha256sum -c "$FILE.sha256" >/dev/null) || fail "checksum mismatch"

if [ -L "$BACKUP_DIR/latest" ] && [ -f "$BACKUP_DIR/latest/meta.env" ]; then
  have="$(grep '^CREATED=' "$BACKUP_DIR/latest/meta.env" | cut -d= -f2)"
  if [ "$CREATED" = "$have" ]; then
    log "already have $CREATED"
    created_epoch="$(date -u -d "$(echo "$CREATED" | sed -E 's/^(....)(..)(..)T(..)(..)(..)Z$/\1-\2-\3T\4:\5:\6Z/')" +%s)"
    echo "$created_epoch" > "$BACKUP_DIR/last-success"
    exit 0
  fi
  [[ "$CREATED" > "$have" ]] || fail "the source copy ($CREATED) is older than the one here ($have)"
fi

mv "$WORK" "$BACKUP_DIR/snapshots/$CREATED"
trap - EXIT
ln -sfn "snapshots/$CREATED" "$BACKUP_DIR/latest.new"
mv -T "$BACKUP_DIR/latest.new" "$BACKUP_DIR/latest"
date -u -d "$(echo "$CREATED" | sed -E 's/^(....)(..)(..)T(..)(..)(..)Z$/\1-\2-\3T\4:\5:\6Z/')" +%s > "$BACKUP_DIR/last-success"

# shellcheck disable=SC2012
ls -1dt "$BACKUP_DIR"/snapshots/[0-9]* 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -rf
log "ok: $BACKUP_DIR/latest -> snapshots/$CREATED"
