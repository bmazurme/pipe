#!/usr/bin/env bash
#
# Garage S3 across the Pi boards (docs/ha-dr-plan.md §6.3). Run from your workstation:
#
#   infra/garage/cluster.sh init      # install every node, connect them, assign the layout, create buckets + keys
#   infra/garage/cluster.sh status    # cluster, layout, buckets
#
# Secrets (RPC secret, admin token, S3 keys) are generated on the boards and moved between them over
# ssh pipes — they never reach this terminal. The S3 keys end up in /etc/garage/keys/<bucket>.env on
# the FIRST host (mode 600); read them there when configuring bridge.
#
# Environment:
#   HOSTS      boards, first = where keys are kept   (default: the four Pis)
#   CAPACITY   per node, what Garage may use         (default 50GB → ~66 GB usable at replication 3)
#   BUCKETS    buckets to create, each with its own key (default: bridge-uploads bridge-backups)
set -euo pipefail

read -ra HOSTS <<<"${HOSTS:-192.168.50.11 192.168.50.12 192.168.50.13 192.168.50.14}"
read -ra ZONES <<<"${ZONES:-pi-white pi-red pi-blue pi-green}"
CAPACITY="${CAPACITY:-50GB}"
read -ra BUCKETS <<<"${BUCKETS:-bridge-uploads bridge-backups}"
SSH_USER="${SSH_USER:-pi}"
HERE="$(cd "$(dirname "$0")" && pwd)"
FIRST="${HOSTS[0]}"

ssh_() { local h="$1"; shift; ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_USER@$h" "$@"; }
garage() { ssh_ "$FIRST" "sudo docker exec garage /garage $*"; }

cmd_status() {
  garage status
  echo; garage layout show 2>&1 | head -20
  echo; garage bucket list
}

cmd_init() {
  echo "== secrets"
  # Created once on the first host; copied to the others through a pipe (never printed).
  ssh_ "$FIRST" 'sudo install -d -m 700 /etc/garage
    [ -s /etc/garage/rpc_secret ] || openssl rand -hex 32 | sudo tee /etc/garage/rpc_secret >/dev/null
    [ -s /etc/garage/admin_token ] || openssl rand -base64 32 | sudo tee /etc/garage/admin_token >/dev/null
    sudo chmod 600 /etc/garage/rpc_secret /etc/garage/admin_token'
  for h in "${HOSTS[@]:1}"; do
    ssh_ "$FIRST" 'sudo tar -C /etc/garage -c rpc_secret' | ssh_ "$h" 'sudo install -d -m 700 /etc/garage && sudo tar -C /etc/garage -x && sudo chmod 600 /etc/garage/rpc_secret'
    # each board gets its OWN admin token (the admin API is localhost-only anyway)
    ssh_ "$h" '[ -s /etc/garage/admin_token ] || openssl rand -base64 32 | sudo tee /etc/garage/admin_token >/dev/null; sudo chmod 600 /etc/garage/admin_token'
  done

  echo "== nodes"
  for h in "${HOSTS[@]}"; do
    echo "-- $h"
    scp -q "$HERE/node.sh" "$SSH_USER@$h:/tmp/garage-node.sh"
    ssh_ "$h" 'sudo bash /tmp/garage-node.sh'
  done

  echo "== connect"
  for h in "${HOSTS[@]:1}"; do
    id="$(ssh_ "$h" 'sudo docker exec garage /garage node id -q' | tr -d '\r')"
    garage node connect "$id" >/dev/null || true
  done
  sleep 3

  echo "== layout"
  local i=0
  for h in "${HOSTS[@]}"; do
    full="$(ssh_ "$h" 'sudo docker exec garage /garage node id -q' | cut -d@ -f1)"
    # skip a node that already has a role (re-run)
    if garage layout show 2>/dev/null | grep -q "${full:0:16}"; then i=$((i + 1)); continue; fi
    garage layout assign -z "${ZONES[$i]}" -c "$CAPACITY" "${full:0:16}"
    i=$((i + 1))
  done
  if garage layout show 2>&1 | grep -qi "staged role changes"; then
    ver="$(garage layout show 2>&1 | grep -oE 'garage layout apply --version [0-9]+' | grep -oE '[0-9]+$' | head -1)"
    garage layout apply --version "${ver:-1}"
  fi

  echo "== buckets and keys"
  for b in "${BUCKETS[@]}"; do
    garage bucket create "$b" >/dev/null 2>&1 || true
    ssh_ "$FIRST" "sudo bash -s" <<REMOTE
set -e
g() { docker exec garage /garage "\$@"; }
install -d -m 700 /etc/garage/keys
if [ ! -s /etc/garage/keys/$b.env ]; then
  out="\$(g key create $b-key)"
  id="\$(printf '%s\n' "\$out" | awk '/Key ID/{print \$3}')"
  secret="\$(printf '%s\n' "\$out" | awk '/Secret key/{print \$3}')"
  [ -n "\$id" ] && [ -n "\$secret" ] || { echo "could not read the new key" >&2; exit 1; }
  umask 077
  printf 'S3_ENDPOINT=http://%s:3900\nS3_REGION=garage\nS3_BUCKET=$b\nS3_ACCESS_KEY_ID=%s\nS3_SECRET_ACCESS_KEY=%s\n' "$FIRST" "\$id" "\$secret" > /etc/garage/keys/$b.env
fi
g bucket allow $b --read --write --owner --key $b-key >/dev/null
REMOTE
  done

  echo; cmd_status
}

case "${1:-}" in
  init) cmd_init ;;
  status) cmd_status ;;
  *) echo "usage: $0 init|status" >&2; exit 2 ;;
esac
