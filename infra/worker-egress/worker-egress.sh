#!/usr/bin/env bash
#
# S1(3): a worker container may reach the internet and nothing at home. `claude --dangerously-skip-permissions` runs whatever the task
# text (or a poisoned issue) tells it to, so the container is treated as hostile: it must not be able to open the router's admin page,
# the NAS, Postgres on white, or the board's own sshd. What it legitimately talks to — bridge's PUBLIC address, the VPN servers, the AI
# providers, GitHub/GitLab — is all public; nothing a worker does needs a private address (checked on red, 2026-11-27: every connection
# of a running worker went to a public IP).
#
#   worker-egress.sh apply    install the rules (idempotent; the timer repeats it, so a flushed firewall heals itself)
#   worker-egress.sh check    exit 0 when the rules are in place, 1 when not — silent (the board agent asks this for the «Дрейф» tile)
#   worker-egress.sh status   the rules, and how many connection attempts each private range has already refused (a worker that
#                             knocks on the LAN is worth a look: that is what a prompt injection does)
#   worker-egress.sh verify   a throwaway container on the default bridge tries the router, this board's own address and a public
#                             address: refused for the first two, open for the last — the real thing, not the rules' text
#   worker-egress.sh remove   take the rules out again
#
# How: one chain, PIPE-WORKER-EGRESS, hooked twice — from DOCKER-USER (traffic the container sends THROUGH the board: the LAN, other
# containers) and from INPUT (traffic sent TO the board itself: sshd, anything listening on its addresses; DOCKER-USER never sees
# that). Replies to connections that came IN (Portainer's page on blue) pass first. The refusal is an ICMP "administratively
# prohibited", so a blocked connect fails at once with EHOSTUNREACH instead of hanging, and the counters say what was tried.
#
# Settings (/etc/pipe-worker-egress.env): EGRESS_ALLOW — private CIDRs that may still be reached, space-separated (default none).
# EGRESS_SUBNET / EGRESS_IFACE — the network the workers are on (default: Docker's `bridge`, docker0). EGRESS_WAIT — seconds `apply` waits
# for Docker's DOCKER-USER chain (the unit sets 60: at boot Docker may still be starting). Tests: IPTABLES (the command).
set -uo pipefail

IPT="${IPTABLES:-iptables}"
CHAIN="${EGRESS_CHAIN:-PIPE-WORKER-EGRESS}"
IFACE="${EGRESS_IFACE:-docker0}"
ALLOW="${EGRESS_ALLOW:-}"
# Every range that is not the public internet: RFC 1918, link-local, and carrier-grade NAT (Tailscale and the like).
PRIVATE="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10"
VERIFY_IMAGE="${VERIFY_IMAGE:-}"

log() { echo "[$(date -u +%FT%TZ)] $*"; }
die() { log "$*" >&2; exit 1; }

subnet() {
  if [ -n "${EGRESS_SUBNET:-}" ]; then echo "$EGRESS_SUBNET"; return; fi
  local s
  s="$(docker network inspect bridge -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}' 2>/dev/null)"
  echo "${s:-172.17.0.0/16}"
}

SUBNET="$(subnet)"
# What the rules say, so a change of settings is noticed: the first rule carries a fingerprint of them.
SIGNATURE="pipe-worker-egress cfg=$(printf '%s|%s|%s|%s' "$SUBNET" "$IFACE" "$ALLOW" "$PRIVATE" | cksum | cut -d' ' -f1)"

rule_replies() { echo "-m conntrack --ctstate ESTABLISHED,RELATED -m comment --comment \"$SIGNATURE\" -j RETURN"; }

# Rules of the chain in order, one per line.
desired_rules() {
  local c
  echo "-A $CHAIN -m conntrack --ctstate ESTABLISHED,RELATED -m comment --comment \"$SIGNATURE\" -j RETURN"
  for c in $ALLOW; do echo "-A $CHAIN -d $c -j RETURN"; done
  for c in $PRIVATE; do echo "-A $CHAIN -d $c -j REJECT --reject-with icmp-admin-prohibited"; done
}

hook_docker_user() { echo "DOCKER-USER -s $SUBNET -j $CHAIN"; }
hook_input() { echo "INPUT -i $IFACE -s $SUBNET -j $CHAIN"; }

ipt_check_rule() { # chain args…
  # shellcheck disable=SC2086
  $IPT -C "$@" 2>/dev/null
}

in_place() {
  $IPT -S "$CHAIN" >/dev/null 2>&1 || return 1
  # shellcheck disable=SC2046
  eval "ipt_check_rule $(hook_docker_user)" || return 1
  # shellcheck disable=SC2046
  eval "ipt_check_rule $(hook_input)" || return 1
  # The chain is exactly what we would build: same rule count, and the first rule carries the current settings.
  local want have
  want="$(desired_rules | wc -l | tr -d ' ')"
  have="$($IPT -S "$CHAIN" 2>/dev/null | grep -c -- "^-A $CHAIN ")"
  [ "$want" = "$have" ] || return 1
  eval "ipt_check_rule $CHAIN $(rule_replies)" || return 1
}

cmd_apply() {
  # At boot docker may still be starting: wait for its chain (the unit sets EGRESS_WAIT), then give up and let the timer try again.
  local waited=0
  until $IPT -S DOCKER-USER >/dev/null 2>&1; do
    [ "$waited" -ge "${EGRESS_WAIT:-0}" ] && die "no DOCKER-USER chain — is docker running?"
    sleep 2; waited=$((waited + 2))
  done
  if in_place; then log "already in place"; return 0; fi

  $IPT -N "$CHAIN" 2>/dev/null || true
  # Hooks first (the chain is empty, so nothing is refused yet), then the rules: no moment when a hook points at a missing chain.
  eval "ipt_check_rule $(hook_docker_user)" || eval "$IPT -I $(hook_docker_user)" || die "could not hook DOCKER-USER"
  eval "ipt_check_rule $(hook_input)" || eval "$IPT -I $(hook_input)" || die "could not hook INPUT"
  $IPT -F "$CHAIN" || die "could not empty $CHAIN"
  local line
  while IFS= read -r line; do
    eval "$IPT $line" || die "could not add: $line"
  done < <(desired_rules)
  log "worker containers on $SUBNET ($IFACE) can no longer reach: $PRIVATE${ALLOW:+ (except $ALLOW)}"
}

cmd_remove() {
  while eval "ipt_check_rule $(hook_docker_user)"; do eval "$IPT -D $(hook_docker_user)" || break; done
  while eval "ipt_check_rule $(hook_input)"; do eval "$IPT -D $(hook_input)" || break; done
  $IPT -F "$CHAIN" 2>/dev/null || true
  $IPT -X "$CHAIN" 2>/dev/null || true
  log "removed"
}

cmd_check() { in_place; }

cmd_status() {
  if in_place; then echo "in place: workers on $SUBNET cannot reach $PRIVATE${ALLOW:+ (except $ALLOW)}"; else echo "NOT in place"; fi
  # The packet counters of the refusing rules: how often something in a container tried a private address.
  $IPT -vnxL "$CHAIN" 2>/dev/null | awk '$3 == "REJECT" { printf "  refused %s packet(s) to %s\n", $1, $9 }' || true
  in_place
}

pick_image() {
  if [ -n "$VERIFY_IMAGE" ]; then echo "$VERIFY_IMAGE"; return; fi
  local name
  name="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -E '^pipe-worker-pi-' | head -1)"
  [ -n "$name" ] && docker inspect -f '{{.Config.Image}}' "$name" 2>/dev/null
}

# What a connect ends in: the ICMP refusal arrives as EHOSTUNREACH; a closed port answers ECONNREFUSED (so it was NOT stopped on the way).
PROBE_JS='
const net = require("net");
const targets = process.argv.slice(1);
Promise.all(targets.map((t) => new Promise((done) => {
  const [host, port] = t.split(":");
  const socket = net.connect({ host, port: Number(port), timeout: 4000 });
  socket.on("connect", () => { socket.destroy(); done(t + " connected"); });
  socket.on("timeout", () => { socket.destroy(); done(t + " TIMEOUT"); });
  socket.on("error", (e) => done(t + " " + e.code));
}))).then((lines) => console.log(lines.join("\n")));
'

cmd_verify() {
  command -v docker >/dev/null || die "docker is required"
  local image gateway own out failed=0
  image="$(pick_image)"
  [ -n "$image" ] || die "no worker image to run the probe with (set VERIFY_IMAGE)"
  gateway="${VERIFY_GATEWAY:-$(ip route 2>/dev/null | awk '/^default/ { print $3; exit }')}"
  own="${VERIFY_OWN:-$(ip -4 -o addr show scope global 2>/dev/null | awk '{ sub(/\/.*/, "", $4); print $4; exit }')}"
  [ -n "$gateway" ] && [ -n "$own" ] || die "could not work out the router's and the board's own address"

  out="$(docker run --rm --network "${VERIFY_NETWORK:-bridge}" --entrypoint node "$image" -e "$PROBE_JS" "$gateway:80" "$own:22" "1.1.1.1:443" 2>&1)" \
    || die "the probe container failed: $out"
  echo "$out"

  # The two private targets must be stopped (refused or silent), the public one must connect.
  echo "$out" | grep -qE "^$gateway:80 (EHOSTUNREACH|TIMEOUT)$" || { log "FAIL: the router is reachable from a container"; failed=1; }
  echo "$out" | grep -qE "^$own:22 (EHOSTUNREACH|TIMEOUT)$" || { log "FAIL: the board itself is reachable from a container"; failed=1; }
  echo "$out" | grep -qE "^1\.1\.1\.1:443 connected$" || { log "FAIL: the internet is NOT reachable from a container"; failed=1; }
  [ "$failed" = 0 ] && log "verified: private addresses refused, the internet open"
  return "$failed"
}

case "${1:-}" in
  apply) cmd_apply ;;
  remove) cmd_remove ;;
  check) cmd_check ;;
  status) cmd_status ;;
  verify) cmd_verify ;;
  *) echo "usage: $0 apply|check|status|verify|remove" >&2; exit 2 ;;
esac
