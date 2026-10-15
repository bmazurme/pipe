#!/usr/bin/env bash
#
# Connects the running worker container to bridge with the one-time code from the Worker page (Worker'ы → Добавить).
# Run from YOUR workstation (it reaches the board over ssh, where the worker container lives):
#
#   infra/bridge-pi/enroll-worker.sh <code> [board]        board defaults to 192.168.50.14 (green)
#
#   # a second worker (WORKER_STACK from deploy-worker.sh --managed), on whichever board it was deployed to:
#   WORKER_STACK=bridgew2 infra/bridge-pi/enroll-worker.sh <code> 192.168.50.13
#
# The worker's own key is written inside its state volume by the worker itself; this script only hands over the code, which
# is single-use and expires in 30 minutes — it never sees or prints the key. The worker picks the key up within seconds.
set -euo pipefail

CODE="${1:-}"
BOARD="${2:-${WORKER_BOARD:-192.168.50.14}}"
SSH_USER="${SSH_USER:-pi}"
STACK="${WORKER_STACK:-bridgew}"
[ -n "$CODE" ] || { echo "usage: $0 <enrollment code> [board]" >&2; exit 2; }
case "$CODE" in brn_*) ;; *) echo "that does not look like an enrollment code (it starts with brn_)" >&2; exit 2;; esac

# the code travels through stdin all the way into the worker process (`enrollCli.js -`), never on a command line, where any
# user on the board could read it in `ps`
printf '%s\n' "$CODE" | ssh -o BatchMode=yes "$SSH_USER@$BOARD" \
  "c=\$(docker ps --filter name=${STACK}_worker -q | head -1); [ -n \"\$c\" ] || { echo \"no worker container on this board for stack '$STACK' — deploy it first: WORKER_STACK=$STACK ./deploy-worker.sh --managed\" >&2; exit 1; }; docker exec -i \"\$c\" node dist/enrollCli.js -"
