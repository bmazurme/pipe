#!/usr/bin/env bash
#
# Keeps the Pi stacks on the newest `stable` release — pull model, run on white by a systemd timer:
# nothing reaches the board from outside, the board looks at GHCR itself.
#
#   autodeploy.sh            one pass: deploy a new release if there is one, roll back if it does not come up healthy
#   autodeploy.sh status     what is deployed, what is published, the last failure
#
# A "release" is what .github/workflows/publish-images.yml marks `stable` after it published ALL THREE images of
# a commit (backend, frontend, worker). Its id is the three image digests plus the commit; when it differs from
# the deployed one:
#   1. the stack files of THAT commit (infra/bridge-pi/{bridge-pi,worker-pi}.yml, Caddyfile) are fetched — only the
#      declarative files; the shell scripts in ~/bridge-pi are updated by hand on purpose: whatever is merged to
#      main may change a stack, but should not be able to change what runs as the board's user without you
#   2. deploy.sh ghcr stable / deploy-worker.sh ghcr stable roll the services
#   3. it waits (MAX_WAIT_SECONDS) for every service to be at its replica count and the API to report a healthy
#      database; if not, the services this deploy touched go back to their previous spec (`docker service rollback`),
#      the stack files go back too, and this release is remembered as failed so it is not retried every five
#      minutes — the next release (or `status` + a manual deploy) is
#
# Database migrations run forward with the new backend and are NOT rolled back: keep them additive (a new column is
# harmless to the old code; a dropped one is not).
#
# Settings (/etc/pipe-autodeploy.env, read by the unit): OWNER, REPO, API_URL, BRIDGE_DIR, STATE_DIR,
# MAX_WAIT_SECONDS, NOTIFY_CMD (run with the message as $1: deployed / rolled back).
set -euo pipefail

OWNER="${OWNER:-bmazurme}"
REPO="${REPO:-pipe}"
API_URL="${API_URL:-https://api.bridge.ntlstl.dev}"
BRIDGE_DIR="${BRIDGE_DIR:-$HOME/bridge-pi}"
STATE_DIR="${STATE_DIR:-$HOME/.pipe/autodeploy}"
MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-420}"
IMAGES=(pipe-bridge-backend pipe-bridge-frontend pipe-worker)
SERVICES_FILE_GLOB=(bridge-pi.yml worker-pi.yml Caddyfile)

log() { echo "[$(date -u +%FT%TZ)] $*"; }
notify() { log "$1"; if [ -n "${NOTIFY_CMD:-}" ]; then $NOTIFY_CMD "$1" || true; fi; }

mkdir -p "$STATE_DIR"

registry_digest() { # image → the digest of its `stable` index, or nothing
  local image="$1" token
  token="$(curl -fsS --max-time 20 "https://ghcr.io/token?scope=repository:$OWNER/$image:pull&service=ghcr.io" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')" || return 1
  curl -fsSI --max-time 20 \
    -H "Authorization: Bearer $token" \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json' \
    "https://ghcr.io/v2/$OWNER/$image/manifests/stable" \
    | tr -d '\r' | awk -F': ' 'tolower($1)=="docker-content-digest"{print $2}'
}

# The commit the last fully successful publication was made from.
release_sha() {
  curl -fsS --max-time 20 \
    "https://api.github.com/repos/$OWNER/$REPO/actions/workflows/publish-images.yml/runs?branch=main&status=success&per_page=1" \
    | python3 -c 'import sys,json; r=json.load(sys.stdin)["workflow_runs"]; print(r[0]["head_sha"] if r else "")'
}

services_snapshot() { # "<name> <version index>" for every service of both stacks
  for stack in bridge bridgew; do
    docker stack services "$stack" --format '{{.Name}}' 2>/dev/null | while read -r name; do
      echo "$name $(docker service inspect "$name" --format '{{.Version.Index}}')"
    done
  done
}

healthy() {
  local bad
  bad="$(docker service ls --format '{{.Name}} {{.Replicas}}' | awk '$1 ~ /^(bridge|bridgew)_/ {split($2,a,"/"); if (a[1] != a[2]) print $1}')"
  [ -z "$bad" ] || return 1
  curl -fsS --max-time 10 "$API_URL/api/v1/health" | grep -q '"database":true'
}

# Swarm rolls a failing backend back by itself (failure_action: rollback in the stack): then everything is
# "healthy" again — on the OLD version. The running images must be this release's, or it did not deploy.
running_matches_release() { # digests in IMAGES order
  local backend="$1" frontend="$2" worker="$3" spec
  for pair in "bridge_backend $backend" "bridge_frontend $frontend" "bridgew_worker $worker"; do
    set -- $pair
    spec="$(docker service inspect "$1" --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' 2>/dev/null)"
    case "$spec" in *"@$2"*) ;; *) return 1 ;; esac
  done
}

wait_healthy() {
  local waited=0
  # the old tasks are still counted for a moment after the update starts: ask twice, a few seconds apart
  while [ "$waited" -lt "$MAX_WAIT_SECONDS" ]; do
    if healthy; then
      sleep 8
      healthy && return 0
    fi
    sleep 10
    waited=$((waited + 10))
  done

  return 1
}

if [ "${1:-}" = status ]; then
  echo "deployed:  $(cat "$STATE_DIR/deployed.txt" 2>/dev/null || echo '<nothing recorded>')"
  echo "failed:    $(cat "$STATE_DIR/failed.txt" 2>/dev/null || echo '<none>')"
  echo "published: $(release_sha 2>/dev/null || echo '<unreachable>')"
  docker service ls --format '  {{.Name}} {{.Replicas}} {{.Image}}' | sed -E 's/@sha256:[a-f0-9]+//' | grep -E '  (bridge|bridgew)_' | sort || true
  exit 0
fi

exec 9>"$STATE_DIR/lock"
flock -n 9 || { log "another pass is running"; exit 0; }

# --- a failover to another board is active: do nothing (the old primary must not be brought back by a routine deploy)
other="$(docker node ls -q 2>/dev/null | xargs -r docker node inspect --format '{{.Description.Hostname}} {{index .Spec.Labels "failover"}}' 2>/dev/null | awk -v me="$(hostname)" '$2=="active" && $1!=me {print $1}' | head -1 || true)"
if [ -n "$other" ]; then
  log "a failover to $other is active — not deploying from $(hostname)"
  exit 0
fi

# --- what is published
sha="$(release_sha)" || { log "GitHub unreachable — nothing done"; exit 0; }
[ -n "$sha" ] || { log "no successful publication yet"; exit 0; }
digests=""
for image in "${IMAGES[@]}"; do
  d="$(registry_digest "$image")" || { log "GHCR unreachable — nothing done"; exit 0; }
  [ -n "$d" ] || { log "no stable tag for $image yet"; exit 0; }
  digests="$digests $d"
done
release_id="$(printf '%s %s' "$sha" "$digests" | sha256sum | cut -c1-16)"

if [ "$release_id" = "$(cut -d' ' -f1 "$STATE_DIR/deployed.txt" 2>/dev/null || true)" ]; then
  exit 0   # up to date, say nothing
fi
if [ "$release_id" = "$(cut -d' ' -f1 "$STATE_DIR/failed.txt" 2>/dev/null || true)" ]; then
  log "release $release_id (${sha:0:8}) already failed here — waiting for a newer one"
  exit 0
fi

log "new release $release_id (commit ${sha:0:8})"

# --- the stack files of that commit
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
for file in "${SERVICES_FILE_GLOB[@]}"; do
  curl -fsSL --max-time 30 "https://raw.githubusercontent.com/$OWNER/$REPO/$sha/infra/bridge-pi/$file" -o "$work/$file" \
    || { log "could not fetch $file of ${sha:0:8} — nothing done"; exit 0; }
  [ -s "$work/$file" ] || { log "$file of ${sha:0:8} is empty — nothing done"; exit 0; }
done
grep -q '^services:' "$work/bridge-pi.yml" && grep -q '^services:' "$work/worker-pi.yml" \
  || { notify "⚠️ release ${sha:0:8}: the stack files look wrong — not deployed"; echo "$release_id ${sha:0:8} bad-stack-files" > "$STATE_DIR/failed.txt"; exit 0; }

# --- deploy
before="$(services_snapshot)"
backup="$STATE_DIR/previous-files"
rm -rf "$backup"; mkdir -p "$backup"
for file in "${SERVICES_FILE_GLOB[@]}"; do
  cp -p "$BRIDGE_DIR/$file" "$backup/$file" 2>/dev/null || true
  cp "$work/$file" "$BRIDGE_DIR/$file"
done

deploy_failed=0
( cd "$BRIDGE_DIR" && ./deploy.sh ghcr stable && ./deploy-worker.sh ghcr stable ) || deploy_failed=1

if [ "$deploy_failed" = 0 ] && wait_healthy; then
  # shellcheck disable=SC2086
  if running_matches_release $digests; then
    echo "$release_id ${sha:0:8} $(date -u +%FT%TZ)" > "$STATE_DIR/deployed.txt"
    rm -f "$STATE_DIR/failed.txt"
    notify "✅ Pi: развёрнута версия ${sha:0:8} (релиз $release_id)"
    exit 0
  fi

  # healthy, but on the old images: Swarm already rolled back. Rolling back again would go FORWARD to the bad one.
  for file in "${SERVICES_FILE_GLOB[@]}"; do
    [ -f "$backup/$file" ] && cp "$backup/$file" "$BRIDGE_DIR/$file"
  done
  echo "$release_id ${sha:0:8} $(date -u +%FT%TZ)" > "$STATE_DIR/failed.txt"
  notify "🔴 Pi: версия ${sha:0:8} не прошла проверку Swarm — он сам откатил сервисы на предыдущую"
  exit 1
fi

# --- not healthy: put back what this deploy touched
log "release $release_id did not come up healthy — rolling back"
after="$(services_snapshot)"
while read -r name index; do
  [ -n "$name" ] || continue
  old="$(printf '%s\n' "$before" | awk -v n="$name" '$1==n {print $2}')"
  if [ -n "$old" ] && [ "$old" != "$index" ]; then
    docker service rollback "$name" >/dev/null 2>&1 && log "rolled back $name" || log "could not roll back $name"
  fi
done <<<"$after"
for file in "${SERVICES_FILE_GLOB[@]}"; do
  [ -f "$backup/$file" ] && cp "$backup/$file" "$BRIDGE_DIR/$file"
done
echo "$release_id ${sha:0:8} $(date -u +%FT%TZ)" > "$STATE_DIR/failed.txt"
notify "🔴 Pi: версия ${sha:0:8} не поднялась (проверка здоровья) — откат на предыдущую; новый релиз попробуем, когда он появится"
exit 1
