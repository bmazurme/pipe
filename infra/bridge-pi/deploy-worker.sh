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
# A worker added in the UI needs none of the two secrets above (it enrols with a one-time code and gets its Claude tokens,
# provider keys and settings from bridge):
#   ./deploy-worker.sh --managed [ghcr [tag]]    # worker-managed-pi.yml: no bridge API key, no Claude token, a state volume
#                                                # (remembered in ~/.pipe/worker-mode: later runs, autodeploy's included, stay managed;
#                                                #  --legacy goes back to the environment-key worker)
#   infra/bridge-pi/enroll-worker.sh <code>      # from your workstation, with the code the Worker page showed
#
# The values become Docker secrets (encrypted in the Swarm raft store, mounted as files); the temporary files
# this script writes live in a 0700 directory and are removed on exit.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$HOME/.pipe/bridge.env"
XRAY="$HOME/.pipe/xray-client.json"
STACK=bridgew

# Which kind of worker this board runs is remembered, so the automatic deploy of a release (autodeploy calls this
# script with no flag) redeploys the SAME kind instead of silently putting the environment-key worker back:
#   --managed → a worker added in the UI · --legacy → the older worker with a bridge API key in the environment.
MODE_FILE="$HOME/.pipe/worker-mode"
MANAGED=0
if [ "$(cat "$MODE_FILE" 2>/dev/null || true)" = managed ]; then MANAGED=1; fi
case "${1:-}" in
  --managed) MANAGED=1; shift ;;
  --legacy) MANAGED=0; shift ;;
esac

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
if [ "$MANAGED" = 0 ]; then
  missing=()
  for k in WORKER_BRIDGE_API_KEY CLAUDE_CODE_OAUTH_TOKEN; do [ -n "${!k:-}" ] || missing+=("$k"); done
  [ ${#missing[@]} -eq 0 ] || { echo "missing in $ENV_FILE: ${missing[*]} (./secrets.sh set KEY)" >&2; exit 1; }
fi
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
cp "$XRAY" "$TMP/xray.json"
hash() { sha256sum "$1" | cut -c1-12; }
XRAY_CONFIG_FILE="$TMP/xray.json"
XRAY_CONFIG_HASH="$(hash "$XRAY_CONFIG_FILE")"
export XRAY_CONFIG_FILE XRAY_CONFIG_HASH

STACK_FILE=worker-managed-pi.yml
if [ "$MANAGED" = 0 ]; then
  STACK_FILE=worker-pi.yml
  printf %s "$WORKER_BRIDGE_API_KEY" > "$TMP/bridge_api_key"
  printf %s "$CLAUDE_CODE_OAUTH_TOKEN" > "$TMP/claude_token"
  WORKER_BRIDGE_API_KEY_FILE="$TMP/bridge_api_key"
  WORKER_CLAUDE_CODE_OAUTH_TOKEN_FILE="$TMP/claude_token"
  WORKER_BRIDGE_API_KEY_HASH="$(hash "$WORKER_BRIDGE_API_KEY_FILE")"
  WORKER_CLAUDE_CODE_OAUTH_TOKEN_HASH="$(hash "$WORKER_CLAUDE_CODE_OAUTH_TOKEN_FILE")"
  export WORKER_BRIDGE_API_KEY_FILE WORKER_CLAUDE_CODE_OAUTH_TOKEN_FILE
  export WORKER_BRIDGE_API_KEY_HASH WORKER_CLAUDE_CODE_OAUTH_TOKEN_HASH
fi

# shared by backend and vpn-client (Telegram goes out through the VPN proxy); idempotent
docker network inspect telegram-proxy-net >/dev/null 2>&1 || docker network create -d overlay --attachable telegram-proxy-net >/dev/null

mkdir -p "$(dirname "$MODE_FILE")"
[ "$MANAGED" = 1 ] && echo managed > "$MODE_FILE" || echo legacy > "$MODE_FILE"

cd "$HERE"
docker stack deploy --resolve-image "$RESOLVE" -c "$STACK_FILE" "$STACK"
echo "deployed worker tag $WORKER_IMAGE_TAG ($STACK_FILE); watch with: ./deploy-worker.sh status"
[ "$MANAGED" = 0 ] || echo "next: Worker page → Worker'ы → Добавить, then from your workstation: infra/bridge-pi/enroll-worker.sh <code>"
