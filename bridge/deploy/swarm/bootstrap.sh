#!/usr/bin/env bash
#
# One-time preparation of the deploy target: turns a VM into a single-node
# swarm manager and checks the things the bridge stack depends on.
#
# Run it on the VM (not from CI):
#
#   scp deploy/swarm/bootstrap.sh <user>@<vm>:~/ && ssh <user>@<vm> 'bash ~/bootstrap.sh'
#
# It is idempotent — re-running it on a node that is already a manager only
# re-prints the checks.
set -euo pipefail

BACKEND_PORT=${BACKEND_PUBLISHED_PORT:-3300}
FRONTEND_PORT=${FRONTEND_PUBLISHED_PORT:-3305}
REGISTRY_HOST=${REGISTRY_HOST:-cr.yandex}

info() { printf '\033[0;36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[0;33m[!]\033[0m %s\n' "$1"; }
fail() {
  printf '\033[0;31m[x]\033[0m %s\n' "$1" >&2
  exit 1
}

command -v docker >/dev/null || fail 'docker not found on this host'

HOST_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')
[ -n "${HOST_IP:-}" ] || fail 'could not determine the primary IPv4 address of this host'

info "Host address: ${HOST_IP}"

# --- swarm -------------------------------------------------------------------
SWARM_STATE=$(docker info --format '{{.Swarm.LocalNodeState}}')
if [ "$SWARM_STATE" = 'active' ]; then
  info "Swarm already active (node is $(docker info --format '{{if .Swarm.ControlAvailable}}manager{{else}}worker{{end}}'))"
else
  info "Initialising swarm on ${HOST_IP}"
  docker swarm init --advertise-addr "$HOST_IP"
fi

docker info --format '{{.Swarm.ControlAvailable}}' | grep -q true ||
  fail 'this node is not a swarm manager — the stack deploy expects a manager here'

# --- port availability -------------------------------------------------------
for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  if ss -ltn "sport = :${port}" 2>/dev/null | grep -q LISTEN; then
    warn "port ${port} is already in use — the swarm task will not be able to bind it"
  else
    info "port ${port} is free"
  fi
done

# --- egress to the container registry ----------------------------------------
# CI forwards its registry credentials with --with-registry-auth, but the node
# still has to be able to reach the registry to pull the image.
info "Checking that ${REGISTRY_HOST} is reachable from this host"
if curl -sf -o /dev/null --max-time 5 "https://${REGISTRY_HOST}/v2/"; then
  info "${REGISTRY_HOST} is reachable"
else
  warn "could not reach https://${REGISTRY_HOST}/v2/ — the node will not be able to"
  warn 'pull images. Check egress/NAT on the VM.'
fi

# --- Postgres reachability -----------------------------------------------
info 'Remember: Postgres is not part of this stack. Make sure POSTGRES_HOST'
info 'points at an address this VM can reach (its own IP if Postgres runs'
info 'here in a separate compose stack, a managed instance otherwise).'

cat <<EOF

Done. Set these GitHub secrets so the deploy job can reach this node — see
README.md for the full list:

  SWARM_HOST         ${HOST_IP}   # or the VM's public address, if CI connects over the internet
  SWARM_USER         $(whoami)
  SWARM_SSH_KEY      <private key whose public half is in ~/.ssh/authorized_keys here>
  SWARM_SSH_KNOWN_HOSTS
$(ssh-keyscan -t ed25519 "$HOST_IP" 2>/dev/null | sed 's/^/                     /')

Registry credentials are pushed from the runner with --with-registry-auth, so
this node does not need its own docker login to the registry.
EOF
