#!/usr/bin/env bash
#
# Deploys worker + vpn-client (stack `bridgew`, or WORKER_STACK — see below). Run on white, after the core stack
# works — it reads ~/.pipe/bridge.env locally, and that file only exists there; WORKER_NODE_HOSTNAME (see below)
# decides which board the containers actually land on, not the host this script runs on.
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
# A second worker on another board: set WORKER_STACK (anything but the default `bridgew`) and WORKER_NODE_HOSTNAME
# (the new board's hostname) before any of the commands above — each is then scoped to that stack: its own
# worker-mode/xray-client files here, its own placement constraint in the stack file, its own `worker_state`
# volume and Swarm services. Nothing else (this board's existing worker, bridge.env, the core stack) is touched.
# Not redeployed by autodeploy yet — a second stack needs a manual re-run of the commands above for a new release.
#
#   OUT=~/.pipe/xray-client-bridgew2.json ./vless-to-xray.sh   # OUT must match deploy-worker.sh's own derived path below
#   WORKER_STACK=bridgew2 WORKER_NODE_HOSTNAME=ubuntu-red ./deploy-worker.sh --managed
#
# The values become Docker secrets (encrypted in the Swarm raft store, mounted as files); the temporary files
# this script writes live in a 0700 directory and are removed on exit.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$HOME/.pipe/bridge.env"
STACK="${WORKER_STACK:-bridgew}"
export WORKER_NODE_HOSTNAME="${WORKER_NODE_HOSTNAME:-ubuntu-green}"
# Only the default stack keeps the original, unsuffixed filenames — autodeploy and every existing board already
# expect those exact paths; a second stack gets its own so the two never collide.
SUFFIX=""; [ "$STACK" = bridgew ] || SUFFIX="-$STACK"
XRAY="$HOME/.pipe/xray-client$SUFFIX.json"
MODE_FILE="$HOME/.pipe/worker-mode$SUFFIX"
# The primary stack's vpn-client answers backend's own TELEGRAM_PROXY_URL (http://vpn-client:1080) on the shared
# telegram-proxy-net — only it may claim that alias. Any other stack gets a harmless one of its own.
export TELEGRAM_PROXY_ALIAS="${TELEGRAM_PROXY_ALIAS:-vpn-client$SUFFIX}"

# Which kind of worker this board runs is remembered, so the automatic deploy of a release (autodeploy calls this
# script with no flag) redeploys the SAME kind instead of silently putting the environment-key worker back:
#   --managed → a worker added in the UI · --legacy → the older worker with a bridge API key in the environment.
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
[ -s "$XRAY" ] || { echo "missing $XRAY (the Xray client config for your VPN server) — OUT=$XRAY ./vless-to-xray.sh" >&2; exit 1; }
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
