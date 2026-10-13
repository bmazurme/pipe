#!/usr/bin/env bash
#
# Deploys worker + vpn-client (stack `bridgew`). Run on white, after the core stack works:
#
#   ./secrets.sh set WORKER_BRIDGE_API_KEY       # a personal API key made in bridge: Profile → Access → API keys (brk_…)
#   ./secrets.sh set CLAUDE_CODE_OAUTH_TOKEN     # `claude setup-token` on a machine where you are logged in to Claude
#   ./vless-to-xray.sh                           # paste your vless:// Reality link (hidden) → ~/.pipe/xray-client.json
#   ./deploy-worker.sh                           # (./deploy-worker.sh status to look)
#   ./deploy-worker.sh ghcr [tag]                # pull the worker image from GHCR instead of the node's own copy
#
# The values become Docker secrets (encrypted in the Swarm raft store, mounted as files); the temporary files
# this script writes live in a 0700 directory and are removed on exit.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$HOME/.pipe/bridge.env"
XRAY="$HOME/.pipe/xray-client.json"
STACK=bridgew

if [ "${1:-}" = status ]; then
  docker stack services "$STACK"
  docker stack ps "$STACK" --no-trunc --format '{{.Name}}\t{{.Node}}\t{{.CurrentState}}\t{{.Error}}' | head -10
  exit 0
fi

# A failover to ANOTHER board is active (infra/failover labels it `failover=active`): this board must not redeploy the
# stack — that would bring the old primary and its diverged database back next to the promoted one.
other="$(docker node ls -q 2>/dev/null | xargs -r docker node inspect --format '{{.Description.Hostname}} {{index .Spec.Labels "failover"}}' 2>/dev/null | awk -v me="$(hostname)" '$2=="active" && $1!=me {print $1}' | head -1 || true)"
[ -z "$other" ] || { echo "a failover to $other is active — refusing to deploy from $(hostname). Failback is a deliberate procedure: infra/failover/README.md" >&2; exit 1; }

[ -f "$ENV_FILE" ] || { echo "no $ENV_FILE" >&2; exit 1; }
[ -s "$XRAY" ] || { echo "missing $XRAY (the Xray client config for your VPN server)" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
missing=()
for k in WORKER_BRIDGE_API_KEY CLAUDE_CODE_OAUTH_TOKEN; do [ -n "${!k:-}" ] || missing+=("$k"); done
[ ${#missing[@]} -eq 0 ] || { echo "missing in $ENV_FILE: ${missing[*]} (./secrets.sh set KEY)" >&2; exit 1; }
grep -qE 'VPN_SERVER_IP_HERE|CLIENT_UUID_HERE|REALITY_' "$XRAY" && { echo "$XRAY still has the example placeholders" >&2; exit 1; }

RESOLVE=never
if [ "${1:-}" = ghcr ]; then
  WORKER_IMAGE_TAG="${2:-latest}"
  IMAGE_WORKER=ghcr.io/bmazurme/pipe-worker
  export IMAGE_WORKER
  RESOLVE=always
else
  WORKER_IMAGE_TAG="${WORKER_IMAGE_TAG:-$(cat "$HOME/.pipe/worker-image-tag" 2>/dev/null || true)}"
  [ -n "$WORKER_IMAGE_TAG" ] || { echo "no worker image tag — run build-worker-image.sh from your workstation" >&2; exit 1; }
fi
export WORKER_IMAGE_TAG

TMP="$(mktemp -d)"
chmod 700 "$TMP"
trap 'rm -rf "$TMP"' EXIT
printf %s "$WORKER_BRIDGE_API_KEY" > "$TMP/bridge_api_key"
printf %s "$CLAUDE_CODE_OAUTH_TOKEN" > "$TMP/claude_token"
cp "$XRAY" "$TMP/xray.json"
hash() { sha256sum "$1" | cut -c1-12; }
XRAY_CONFIG_FILE="$TMP/xray.json"
WORKER_BRIDGE_API_KEY_FILE="$TMP/bridge_api_key"
WORKER_CLAUDE_CODE_OAUTH_TOKEN_FILE="$TMP/claude_token"
XRAY_CONFIG_HASH="$(hash "$XRAY_CONFIG_FILE")"
WORKER_BRIDGE_API_KEY_HASH="$(hash "$WORKER_BRIDGE_API_KEY_FILE")"
WORKER_CLAUDE_CODE_OAUTH_TOKEN_HASH="$(hash "$WORKER_CLAUDE_CODE_OAUTH_TOKEN_FILE")"
export XRAY_CONFIG_FILE WORKER_BRIDGE_API_KEY_FILE WORKER_CLAUDE_CODE_OAUTH_TOKEN_FILE
export XRAY_CONFIG_HASH WORKER_BRIDGE_API_KEY_HASH WORKER_CLAUDE_CODE_OAUTH_TOKEN_HASH

# shared by backend and vpn-client (Telegram goes out through the VPN proxy); idempotent
docker network inspect telegram-proxy-net >/dev/null 2>&1 || docker network create -d overlay --attachable telegram-proxy-net >/dev/null

cd "$HERE"
docker stack deploy --resolve-image "$RESOLVE" -c worker-pi.yml "$STACK"
echo "deployed worker tag $WORKER_IMAGE_TAG; watch with: ./deploy-worker.sh status"
