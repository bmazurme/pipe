#!/usr/bin/env bash
#
# After a failover, bring white back as the REPLICA of red (red stays the primary) — run from your workstation:
#
#   infra/failover/failback.sh [--dry-run]
#
# Safe by construction: it never starts white's own stack and never touches white's old database volume
# (`bridge_pgdata` — the diverged copy; keep it until you are sure). It
#   1. checks: red really is the primary (out of recovery, labelled failover=active) and answers; white answers over ssh
#      and runs NO bridge services (a living old primary next to the new one is the thing to avoid);
#   2. on red: makes sure the role `replicator` may stream (pg_hba line for the overlay network) and creates the slot
#      `standby_white` (capped by max_slot_wal_keep_size, like standby_red);
#   3. on white: takes a base backup of red's database into a NEW volume `standby_pgdata` (refuses to reuse a volume
#      that holds data) and starts it as stack `bridgesw` (bridge-standby-white.yml);
#   4. waits until white is streaming, and prints how to read the state.
# The failover=active label stays on red: white's deploy scripts and auto-deploy keep refusing to run. Afterwards
# pg_stat_replication on red shows white streaming.
#
# Environment: RED (192.168.50.12), WHITE (192.168.50.11), SSH_USER (pi), SLOT (standby_white).
set -euo pipefail

RED="${RED:-192.168.50.12}"
WHITE="${WHITE:-192.168.50.11}"
SSH_USER="${SSH_USER:-pi}"
SLOT="${SLOT:-standby_white}"
KEEP="${MAX_SLOT_WAL_KEEP:-4GB}"
DB_USER="${DB_USER:-bridge}"
WAIT_SECONDS="${WAIT_SECONDS:-180}"
HERE="$(cd "$(dirname "$0")" && pwd)"
DRY_RUN=0
[ "${1:-}" = --dry-run ] && DRY_RUN=1

ssh_() { local host="$1"; shift; ssh -o BatchMode=yes -o ConnectTimeout=8 "$SSH_USER@$host" "$@"; }
say() { printf '%s\n' "$*"; }
die() { printf 'REFUSED: %s\n' "$*" >&2; exit 1; }

# Runs SQL (stdin) in red's database container, whatever the stack calls it: the promoted replica.
red_psql() { ssh_ "$RED" 'c=$(docker ps --filter name=bridgesb_postgres-standby -q | head -1); [ -n "$c" ] && docker exec -i "$c" psql -v ON_ERROR_STOP=1 -U '"$DB_USER"' -At -F "|" postgres'; }

# --- 1. checks
ssh_ "$RED" true >/dev/null 2>&1 || die "red ($RED) does not answer over ssh."
ssh_ "$WHITE" true >/dev/null 2>&1 || die "white ($WHITE) does not answer over ssh — bring it up first (with its stack OFF)."

recovery="$(printf '%s\n' 'SELECT pg_is_in_recovery()' | red_psql 2>/dev/null)" || die "red's database container is not running."
[ "$recovery" = f ] || die "red's database is still a replica (in recovery) — it is not the primary; nothing to follow."

label="$(ssh_ "$RED" 'docker node inspect self --format "{{index .Spec.Labels \"failover\"}}"')"
[ "$label" = active ] || die "red is not marked failover=active — this is not the state after failover.sh; do not continue."

running="$(ssh_ "$WHITE" 'docker ps --format "{{.Names}}" | grep -E "^(bridge_|bridgesb_|bridgew_)" || true')"
[ -z "$running" ] || die "white runs bridge services ($(echo "$running" | tr '\n' ' ')) — switch them off first (docker stack rm bridge); a second primary must not be alive."

if ssh_ "$WHITE" 'docker volume inspect standby_pgdata >/dev/null 2>&1 && docker run --rm -v standby_pgdata:/d alpine sh -c "[ -n \"\$(ls -A /d)\" ]"'; then
  die "white already has a non-empty volume standby_pgdata — not touching it (a replica from an earlier run? check docker stack ps bridgesw)."
fi
ssh_ "$WHITE" 'grep -q "^REPLICATION_PASSWORD=." ~/.pipe/bridge.env' || die "no REPLICATION_PASSWORD in white's ~/.pipe/bridge.env."
say "ok: red is the primary (failover=active), white answers and runs no bridge services, no replica volume yet."

if [ "$DRY_RUN" = 1 ]; then
  say "dry run: would allow replication and create slot $SLOT on red, take a base backup into white's new volume standby_pgdata and start stack bridgesw. Nothing was changed."
  exit 0
fi

# --- 2. you decide
say
read -r -p "Make white ($WHITE) a replica of red ($RED)? White's old database volume is left untouched. Type FAILBACK to continue: " answer
[ "$answer" = FAILBACK ] || { say "cancelled."; exit 1; }

# --- 3. red: the replicator role (already replicated from white, but make sure), pg_hba, the slot
pw="$(ssh_ "$WHITE" 'grep "^REPLICATION_PASSWORD=" ~/.pipe/bridge.env | cut -d= -f2-')"
# the password goes through stdin, never on a command line
printf "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='replicator') THEN CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '%s'; ELSE ALTER ROLE replicator WITH REPLICATION LOGIN PASSWORD '%s'; END IF; END \$\$;\n" "$pw" "$pw" | red_psql >/dev/null
unset pw
subnet="$(ssh_ "$RED" "docker network inspect bridge_internal --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'")"
[ -n "$subnet" ] || die "network bridge_internal not found on red."
line="host replication replicator $subnet scram-sha-256"
ssh_ "$RED" 'c=$(docker ps --filter name=bridgesb_postgres-standby -q | head -1); hba=/var/lib/postgresql/data/pg_hba.conf; docker exec "$c" sh -c "grep -qxF '"'$line'"' $hba || echo '"'$line'"' >> $hba"'
printf "%s;\n" "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name='$SLOT') THEN 'slot exists' ELSE (SELECT 'slot created' FROM pg_create_physical_replication_slot('$SLOT')) END" \
  "ALTER SYSTEM SET max_slot_wal_keep_size = '$KEEP'" "SELECT pg_reload_conf()" | red_psql >/dev/null
say "red: replication allowed, slot $SLOT ready."

# --- 4. white: base backup into a new volume, then the replica service
scp -q -o BatchMode=yes "$HERE/bridge-standby-white.yml" "$SSH_USER@$WHITE:/tmp/bridge-standby-white.yml"
ssh_ "$WHITE" bash -s -- "$SLOT" <<'REMOTE'
set -euo pipefail
slot="$1"
set -a; . ~/.pipe/bridge.env; set +a
docker volume create standby_pgdata >/dev/null
docker run --rm -v standby_pgdata:/d alpine sh -c 'chown 70:70 /d && chmod 700 /d'
echo "taking the base backup from red…"
docker run --rm --user postgres --network bridge_internal -e PGPASSWORD="$REPLICATION_PASSWORD" -v standby_pgdata:/var/lib/postgresql/data postgres:16-alpine \
  pg_basebackup -h postgres-standby -p 5432 -U replicator -D /var/lib/postgresql/data -R -X stream -S "$slot" -P -c fast
docker stack deploy -c /tmp/bridge-standby-white.yml bridgesw
REMOTE

# --- 5. is white streaming?
waited=0
until [ "$(printf '%s\n' "SELECT count(*) FROM pg_stat_replication WHERE state='streaming'" | red_psql)" -ge 1 ] 2>/dev/null; do
  [ "$waited" -lt "$WAIT_SECONDS" ] || die "white did not start streaming within ${WAIT_SECONDS}s — docker service logs bridgesw_postgres-standby-white on white."
  sleep 5; waited=$((waited + 5))
done
say "white is streaming from red."
say
say "DONE. red is the primary, white its replica. White's old volume bridge_pgdata is untouched (diverged copy — remove it only when you are sure)."
say "Check on red: SELECT client_addr, state, replay_lag FROM pg_stat_replication;  (the database container is bridgesb_postgres-standby)."
say "Not done here: the backups/Garage/uploads jobs and the autodeploy timer still point at white as the primary — see infra/failover/README.md → \"Going back\"."
