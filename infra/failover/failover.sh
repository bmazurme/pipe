#!/usr/bin/env bash
#
# Fail the whole bridge stack over from white to red — run from YOUR workstation, when white is gone:
#
#   AGE_IDENTITY=~/Documents/pipe-backup-key.txt infra/failover/failover.sh [--dry-run]
#
# It deliberately cannot be done by accident or by a script of its own:
#   - it REFUSES while white answers (ping or ssh): a promoted replica next to a living primary is two diverging
#     databases, the one thing worse than an outage;
#   - it needs your age private key — the secrets on red are stored only encrypted (prepare-red.sh); this is the step
#     that decrypts them, here, and sends them to red over ssh;
#   - it shows the replica's state and waits for you to type FAILOVER.
# Then it runs failover-red.sh on red (promote, uploads, roles, deploy, health) and prints what is left: the router.
#
# Environment: PRIMARY (192.168.50.11), STANDBY (192.168.50.12), SSH_USER (pi), AGE_IDENTITY (required),
#              I_KNOW_WHITE_IS_ALIVE=yes to go on although white answers (you must have switched it off yourself).
set -euo pipefail

PRIMARY="${PRIMARY:-192.168.50.11}"
STANDBY="${STANDBY:-192.168.50.12}"
SSH_USER="${SSH_USER:-pi}"
DRY_RUN=0
[ "${1:-}" = --dry-run ] && DRY_RUN=1

ssh_() { local host="$1"; shift; ssh -o BatchMode=yes -o ConnectTimeout=8 "$SSH_USER@$host" "$@"; }
say() { printf '%s\n' "$*"; }
die() { printf 'REFUSED: %s\n' "$*" >&2; exit 1; }

# --- 0. what we need here
[ -n "${AGE_IDENTITY:-}" ] && [ -r "${AGE_IDENTITY:-}" ] || die "AGE_IDENTITY (your private age key file) is required — the secrets on $STANDBY are encrypted to it"
command -v age >/dev/null || die "age is not installed here (brew install age)"

# --- 1. is white really gone?
if [ "${I_KNOW_WHITE_IS_ALIVE:-}" != yes ]; then
  if ping -c 2 -W 2 "$PRIMARY" >/dev/null 2>&1; then
    die "white ($PRIMARY) answers ping. If the board is up, fix IT — do not fail over a living primary. (Planned switch? switch white's services off first, then I_KNOW_WHITE_IS_ALIVE=yes.)"
  fi
  if ssh_ "$PRIMARY" true >/dev/null 2>&1; then
    die "white ($PRIMARY) answers over ssh — it is not gone."
  fi
fi
say "white ($PRIMARY) does not answer."

# --- 2. is red ready?
ssh_ "$STANDBY" true >/dev/null 2>&1 || die "red ($STANDBY) does not answer over ssh — nothing to fail over to."
state="$(printf '%s\n' "SELECT pg_is_in_recovery(), COALESCE(round(extract(epoch FROM now()-pg_last_xact_replay_timestamp())::numeric,0)::text,'n/a')" \
  | ssh_ "$STANDBY" 'c=$(docker ps --filter name=bridgesb_postgres-standby -q | head -1); [ -n "$c" ] && docker exec -i "$c" psql -U bridge -At -F "|" postgres' 2>/dev/null)" \
  || die "the replica container is not running on red."
in_recovery="${state%%|*}"; behind="${state#*|}"
if [ "$in_recovery" = t ]; then
  say "the replica on red is a standby; its last replayed transaction is ${behind}s old (that is the data you can lose, plus anything the primary wrote after its last message)."
else
  say "the replica on red is already a primary (an earlier run got that far) — the rest will continue."
fi
ssh_ "$STANDBY" 'test -s ~/.pipe/bridge.env.age && test -x ~/bridge-pi/deploy.sh && test -x ~/failover/failover-red.sh' \
  || die "red is not prepared (no encrypted secrets / stack scripts) — run infra/failover/prepare-red.sh while white is up."

if [ "$DRY_RUN" = 1 ]; then
  say "dry run: would decrypt the secrets, copy them to red, run failover-red.sh there, and print the router step. Nothing was changed."
  exit 0
fi

# --- 3. you decide
say
read -r -p "Make red ($STANDBY) the primary of the whole stack? This cannot be undone by this script. Type FAILOVER to continue: " answer
[ "$answer" = FAILOVER ] || { say "cancelled."; exit 1; }

# --- 4. the secrets: encrypted on red → decrypted here with YOUR key → red, mode 600
ssh_ "$STANDBY" 'cat ~/.pipe/bridge.env.age' | age -d -i "$AGE_IDENTITY" | ssh_ "$STANDBY" 'umask 077; cat > ~/.pipe/bridge.env'
ssh_ "$STANDBY" 'grep -q "^JWT_SECRET=." ~/.pipe/bridge.env' || die "the decrypted secrets on red look empty — wrong key, or the encrypted copy is damaged."
say "secrets decrypted onto red."

# --- 5. the board does the rest
# shellcheck disable=SC2088  # the ~ is meant for the remote shell
ssh_ "$STANDBY" '~/failover/failover-red.sh'

say
say "DONE on the board. What is left is yours:"
say "  1. Router (ASUS) → Virtual Server: forward TCP 80 and 443 to $STANDBY (instead of $PRIMARY). DNS stays as it is."
say "  2. Check: curl https://api.bridge.ntlstl.dev/api/v1/health   (the certificates are re-issued by Caddy once the ports point at red)"
say "  3. When white is back: do NOT start its stack. infra/failover/README.md → \"Going back\"."
