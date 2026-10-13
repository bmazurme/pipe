#!/usr/bin/env bash
#
# The board side of a failover: makes red the primary of the whole bridge stack. Run on red — by infra/failover/failover.sh
# from your workstation, which has already checked that white is really gone, asked you to confirm, and put the decrypted
# ~/.pipe/bridge.env here. Idempotent: a repeated run continues from where it stopped.
#
#   1. promote the replica to a read-write primary                       (standby/promote.sh)
#   2. restore the uploaded files into the `bridge_uploads` volume       (from /srv/uploads-mirror, the local copy)
#   3. move the "primary" role to this board: label it bridge-primary, take that label off the others, and mark the
#      cluster `failover=active` on this node — every deploy script refuses to run on another board while it is set,
#      so white, when it comes back, cannot redeploy the stack and revive its old database
#   4. deploy the stack here with POSTGRES_HOST=postgres-standby and no postgres service (POSTGRES_REPLICAS=0)
#   5. wait for the API to report a healthy database, and say so on Telegram
#
# What it does NOT do: change the router (80/443 → this board) — failover.sh prints that step — and it does not undo itself.
# Going back is deliberate (infra/failover/README.md).
set -euo pipefail

BRIDGE_DIR="${BRIDGE_DIR:-$HOME/bridge-pi}"
STANDBY_DIR="${STANDBY_DIR:-$HOME/standby}"
ENV_FILE="${ENV_FILE:-$HOME/.pipe/bridge.env}"
MIRROR="${UPLOADS_MIRROR:-/srv/uploads-mirror/current}"
VOLUME="${UPLOADS_VOLUME:-bridge_bridge_uploads}"
DB_USER="${DB_USER:-bridge}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3300/api/v1/health}"
MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-300}"
ME="$(hostname)"

log() { echo "[$(date -u +%FT%TZ)] $*"; }
notify() { if [ -x /usr/local/bin/notify-telegram ]; then /usr/local/bin/notify-telegram "$1" || true; fi; }

[ -s "$ENV_FILE" ] || { echo "no $ENV_FILE — failover.sh puts the decrypted secrets there" >&2; exit 1; }
[ -x "$BRIDGE_DIR/deploy.sh" ] || { echo "no $BRIDGE_DIR/deploy.sh — run infra/failover/prepare-red.sh first" >&2; exit 1; }

c="$(docker ps --filter name=bridgesb_postgres-standby -q | head -1)"
[ -n "$c" ] || { echo "the replica container is not running here" >&2; exit 1; }

# --- 1. promote
if [ "$(docker exec "$c" psql -U "$DB_USER" -Atc 'SELECT pg_is_in_recovery()' postgres)" = t ]; then
  log "promoting the replica"
  PROMOTE_CONFIRMED=yes "$STANDBY_DIR/promote.sh"
else
  log "the replica is already a primary — continuing"
fi

# --- 2. uploads — with STORAGE_DRIVER=s3 the files are in the Garage bucket, not in a volume: nothing to restore
if grep -q '^STORAGE_DRIVER=s3' "$ENV_FILE"; then
  log "STORAGE_DRIVER=s3: the files live in the bucket — no uploads volume to restore (the S3_* settings travel in the decrypted secrets)"
else
docker volume inspect "$VOLUME" >/dev/null 2>&1 || docker volume create "$VOLUME" >/dev/null
mountpoint="$(docker volume inspect "$VOLUME" -f '{{.Mountpoint}}')"
if [ -z "$(sudo ls -A "$mountpoint" 2>/dev/null)" ]; then
  # /srv/uploads-mirror is not readable by the board's user: look with sudo, or a perfectly good copy is reported missing.
  if sudo test -d "$MIRROR" && [ -n "$(sudo ls -A "$MIRROR" 2>/dev/null)" ]; then
    sudo rsync -a "$MIRROR/" "$mountpoint/"
    log "uploads restored from $MIRROR: $(sudo find "$mountpoint" -type f | wc -l) files"
  else
    log "WARNING: no uploads copy at $MIRROR — files that were only on white are lost (the Garage bucket bridge-uploads may still hold them)"
  fi
else
  log "the uploads volume already has files — left alone"
fi

fi

# --- 3. roles
for node in $(docker node ls -q); do
  host="$(docker node inspect "$node" --format '{{.Description.Hostname}}')"
  if [ "$host" != "$ME" ] && [ -n "$(docker node inspect "$node" --format '{{index .Spec.Labels "bridge-primary"}}')" ]; then
    docker node update --label-rm bridge-primary "$node" >/dev/null
    log "took the bridge-primary label off $host"
  fi
done
docker node update --label-add bridge-primary=true --label-add failover=active "$ME" >/dev/null
log "$ME is now bridge-primary, failover=active"

# --- 4. deploy
log "deploying the stack here (database: the promoted replica)"
( cd "$BRIDGE_DIR" && POSTGRES_HOST=postgres-standby POSTGRES_REPLICAS=0 ./deploy.sh ghcr stable )

# --- 5. health
waited=0
until curl -fsS --max-time 10 "$HEALTH_URL" 2>/dev/null | grep -q '"database":true'; do
  [ "$waited" -lt "$MAX_WAIT_SECONDS" ] || { notify "🔴 Переключение на $ME: API не поднялся за ${MAX_WAIT_SECONDS}с — смотрите docker service ps bridge_backend"; echo "API did not become healthy in ${MAX_WAIT_SECONDS}s" >&2; exit 1; }
  sleep 10
  waited=$((waited + 10))
done
log "the API reports a healthy database"
notify "✅ Переключение выполнено: bridge работает на $ME (база — бывшая реплика). Осталось перекинуть порты 80/443 роутера на $ME."
