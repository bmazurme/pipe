#!/usr/bin/env bash
#
# Deploys the Pi stack. Run on white (the node labelled bridge-primary), from this directory:
#
#   ./deploy.sh            # uses ~/.pipe/bridge.env and the image tag build-images.sh left in ~/.pipe/image-tag
#   ./deploy.sh status     # services, replicas, health
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$HOME/.pipe/bridge.env"
STACK=bridge

if [ "${1:-}" = status ]; then
  docker stack services "$STACK"
  docker stack ps "$STACK" --no-trunc --format '{{.Name}}\t{{.CurrentState}}\t{{.Error}}' | head -20
  exit 0
fi

[ -f "$ENV_FILE" ] || { echo "no $ENV_FILE — run ./secrets.sh init" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

missing=()
for k in POSTGRES_PASSWORD JWT_SECRET REFRESH_JWT_SECRET CREDENTIALS_ENC_KEY EMAILS; do
  [ -n "${!k:-}" ] || missing+=("$k")
done
[ ${#missing[@]} -eq 0 ] || { echo "missing in $ENV_FILE: ${missing[*]} (./secrets.sh set KEY)" >&2; exit 1; }
[ -n "${YANDEX_ID:-}" ] || echo "WARNING: YANDEX_ID is empty — nobody will be able to sign in" >&2

IMAGE_TAG="${IMAGE_TAG:-$(cat "$HOME/.pipe/image-tag" 2>/dev/null || true)}"
[ -n "$IMAGE_TAG" ] || { echo "no image tag — run build-images.sh from your workstation" >&2; exit 1; }
for img in bridge-backend bridge-frontend; do
  docker image inspect "localhost/pipe/$img:$IMAGE_TAG" >/dev/null 2>&1 || { echo "image localhost/pipe/$img:$IMAGE_TAG is not on this node" >&2; exit 1; }
done
export IMAGE_TAG
CADDYFILE_HASH="$(sha256sum "$HERE/Caddyfile" | cut -c1-12)"
export CADDYFILE_HASH

# shared by backend and vpn-client (Telegram goes out through the VPN proxy); idempotent
docker network inspect telegram-proxy-net >/dev/null 2>&1 || docker network create -d overlay --attachable telegram-proxy-net >/dev/null

node="$(hostname)"
docker node update --label-add bridge-primary=true "$node" >/dev/null

cd "$HERE"
docker stack deploy --resolve-image never -c bridge-pi.yml "$STACK"
echo "deployed tag $IMAGE_TAG; watch with: ./deploy.sh status"
