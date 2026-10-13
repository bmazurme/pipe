#!/usr/bin/env bash
#
# PLANNED switch back: white is the primary again, red the replica again — after a failover, when both boards are up
# and white is red's replica (failback.sh). Run from your workstation. The site is DOWN for the few minutes between
# "stop writing" and "healthy on white" (the database is copied back, a base backup, seconds for a database this size).
#
#   infra/failover/switchback.sh [--dry-run]
#
# Nothing is deleted: white's diverged database and red's promoted copy are COPIED aside (bridge_pgdata_diverged_<date-time>,
# standby_pgdata_prev_<date-time>) before the volumes are emptied, and the copy is checked before it is trusted.
#
#   1. checks: red is the primary (failover=active), white is its replica and streams, both answer, ~/standby and
#      ~/bridge-pi are in place;
#   2. stop writing: backend, frontend and Caddy scaled to 0 on red (the site is down from here);
#   3. uploads: files uploaded while red was the primary are copied from red's volume into white's (additive);
#   4. white: the replica stack is removed; bridge_pgdata (the diverged old copy) is copied aside, then a base backup of red's
#      database is taken into bridge_pgdata — white now holds the current data and nothing marks it a standby;
#   5. roles: bridge-primary moves to white, failover=active comes off red (so white may deploy again);
#   6. white: the normal deploy (deploy.sh ghcr stable) starts the stack on its own database; wait until the API is healthy;
#   7. white's replication role/slot (standby/setup-primary.sh), then red's promoted copy is copied aside, emptied and rebuilt
#      as a replica (standby/setup-standby.sh);
#   8. wait until red streams from white.
# Then the floating address (infra/vip) follows Caddy to white by itself.
#
# Environment: RED (192.168.50.12), WHITE (192.168.50.11), SSH_USER (pi), MAX_WAIT_SECONDS (300).
set -euo pipefail

RED="${RED:-192.168.50.12}"
WHITE="${WHITE:-192.168.50.11}"
SSH_USER="${SSH_USER:-pi}"
DB_USER="${DB_USER:-bridge}"
MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-300}"
STAMP="$(date +%Y%m%d-%H%M)"
HERE="$(cd "$(dirname "$0")" && pwd)"
DRY_RUN=0
[ "${1:-}" = --dry-run ] && DRY_RUN=1

ssh_() { local host="$1"; shift; ssh -o BatchMode=yes -o ConnectTimeout=8 "$SSH_USER@$host" "$@"; }
say() { printf '%s\n' "$*"; }
die() { printf 'REFUSED: %s\n' "$*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }
red_psql() { ssh_ "$RED" 'c=$(docker ps --filter name=bridgesb_postgres-standby -q | head -1); [ -n "$c" ] && docker exec -i "$c" psql -v ON_ERROR_STOP=1 -U '"$DB_USER"' -At -F "|" postgres'; }

# What to do if it stops half way (the site is down once the application is scaled to 0).
RECOVERY=""
trap 'rc=$?; [ "$rc" -eq 0 ] || [ -z "$RECOVERY" ] || printf "\nSTOPPED. %s\n" "$RECOVERY" >&2' EXIT

# --- 1. checks
step "checks"
ssh_ "$RED" true >/dev/null 2>&1 || die "red ($RED) does not answer over ssh."
ssh_ "$WHITE" true >/dev/null 2>&1 || die "white ($WHITE) does not answer over ssh."
[ "$(printf '%s\n' 'SELECT pg_is_in_recovery()' | red_psql 2>/dev/null)" = f ] || die "red's database is not a primary — this is not the state after a failover."
[ "$(ssh_ "$RED" 'docker node inspect self --format "{{index .Spec.Labels \"failover\"}}"')" = active ] || die "red is not marked failover=active."
streaming="$(printf '%s\n' "SELECT count(*) FROM pg_stat_replication WHERE state='streaming'" | red_psql 2>/dev/null || echo 0)"
[ "${streaming:-0}" -ge 1 ] || die "white is not streaming from red — run infra/failover/failback.sh first (the base backup of the replica is the safety net here)."
ssh_ "$WHITE" 'test -x ~/bridge-pi/deploy.sh && test -x ~/standby/setup-primary.sh && grep -q "^POSTGRES_PASSWORD=." ~/.pipe/bridge.env' || die "white is not prepared (no ~/bridge-pi/deploy.sh, ~/standby/setup-primary.sh or ~/.pipe/bridge.env)."
ssh_ "$RED" 'test -x ~/standby/setup-standby.sh && test -s ~/.pipe/standby.env' || die "red has no ~/standby/setup-standby.sh or ~/.pipe/standby.env."
for v in "$WHITE:bridge_pgdata_diverged_$STAMP" "$RED:standby_pgdata_prev_$STAMP"; do
  if ssh_ "${v%%:*}" "docker volume inspect ${v#*:} >/dev/null 2>&1"; then die "${v%%:*} already has the volume ${v#*:} — a switch back ran today; look at it first."; fi
done
say "ok: red is the primary, white streams from it, both boards are prepared."

if [ "$DRY_RUN" = 1 ]; then
  say "dry run: would stop the site, copy uploads red→white, rebuild white's database from red's, move the roles, deploy on white, rebuild red as its replica. Nothing was changed."
  exit 0
fi

# --- 2. you decide
say
say "The site goes DOWN for a few minutes. White's old database and red's current one are copied aside, not deleted."
read -r -p "Make white the primary again? Type SWITCHBACK to continue: " answer
[ "$answer" = SWITCHBACK ] || { say "cancelled."; exit 1; }

# --- 3. stop writing
step "stopping the application on red"
RECOVERY="To bring the site back on red: ssh $SSH_USER@$RED docker service scale bridge_backend=1 bridge_frontend=1 bridge_caddy=1  (nothing was emptied yet)."
ssh_ "$RED" 'docker service scale bridge_backend=0 bridge_frontend=0 bridge_caddy=0 >/dev/null; for i in $(seq 1 30); do [ -z "$(docker ps -q --filter name=bridge_backend --filter name=bridge_frontend --filter name=bridge_caddy)" ] && break; sleep 2; done'
say "the application is stopped on red; no more writes."

# --- 4. uploads (additive: nothing on white is deleted or overwritten)
step "uploads red → white"
ssh_ "$RED" 'sudo tar -C "$(docker volume inspect bridge_bridge_uploads -f "{{.Mountpoint}}")" -cf - .' \
  | ssh_ "$WHITE" 'docker volume inspect bridge_bridge_uploads >/dev/null 2>&1 || docker volume create bridge_bridge_uploads >/dev/null; sudo tar -C "$(docker volume inspect bridge_bridge_uploads -f "{{.Mountpoint}}")" --skip-old-files -xf -'
say "uploads copied (existing files on white were kept)."

# --- 5. white's database from red's
step "white: the database, rebuilt from red's current one"
RECOVERY="red still has everything. If white's bridge_pgdata is empty or half-filled, the old copy is bridge_pgdata_diverged_$STAMP on white. Bring the site back on red: docker service scale bridge_backend=1 bridge_frontend=1 bridge_caddy=1 (on red)."
ssh_ "$RED" 'c=$(docker ps --filter name=bridgesb_postgres-standby -q | head -1); docker exec "$c" psql -U '"$DB_USER"' -Atc "CHECKPOINT" postgres >/dev/null'
ssh_ "$WHITE" bash -s -- "$STAMP" <<'REMOTE'
set -euo pipefail
stamp="$1"
set -a; . ~/.pipe/bridge.env; set +a
docker stack rm bridgesw >/dev/null 2>&1 || true
for i in $(seq 1 30); do [ -z "$(docker ps -q --filter name=bridgesw_)" ] && break; sleep 2; done
docker volume inspect bridge_pgdata >/dev/null 2>&1 || docker volume create bridge_pgdata >/dev/null
# the diverged old copy: aside, and checked, before the volume is emptied
docker volume create "bridge_pgdata_diverged_$stamp" >/dev/null
docker run --rm -v bridge_pgdata:/from -v "bridge_pgdata_diverged_$stamp":/to alpine sh -c 'cp -a /from/. /to/ && [ "$(find /from | wc -l)" = "$(find /to | wc -l)" ]' \
  || { echo "the copy of the old database did not check out — NOT emptying bridge_pgdata" >&2; exit 1; }
echo "old database kept as bridge_pgdata_diverged_$stamp"
docker run --rm -v bridge_pgdata:/d alpine sh -c 'rm -rf /d/* /d/.[!.]* 2>/dev/null; chown 70:70 /d && chmod 700 /d'
docker run --rm --user postgres --network bridge_internal -e PGPASSWORD="$REPLICATION_PASSWORD" -v bridge_pgdata:/var/lib/postgresql/data postgres:16-alpine \
  pg_basebackup -h postgres-standby -p 5432 -U replicator -D /var/lib/postgresql/data -X stream -P -c fast
echo "base backup taken into bridge_pgdata"
REMOTE

# --- 6. roles
step "roles"
ssh_ "$RED" "docker node update --label-rm failover --label-rm bridge-primary ubuntu-red >/dev/null"
say "red: failover and bridge-primary labels removed (white may deploy; deploy.sh gives white the primary label)."

# --- 7. deploy on white
step "deploying the stack on white"
RECOVERY="red's database is untouched and still the primary-grade copy. Look at docker service ps bridge_backend on white; to give the site back to red: remove bridge-primary from white, label red failover=active + bridge-primary, scale bridge_backend/frontend/caddy to 1 on red."
ssh_ "$WHITE" '~/bridge-pi/deploy.sh ghcr stable'
waited=0
until ssh_ "$WHITE" 'curl -fsS --max-time 10 http://127.0.0.1:3300/api/v1/health' 2>/dev/null | grep -q '"database":true'; do
  [ "$waited" -lt "$MAX_WAIT_SECONDS" ] || die "the API on white did not become healthy in ${MAX_WAIT_SECONDS}s — red still holds its copy; docker service ps bridge_backend on white."
  sleep 10; waited=$((waited + 10))
done
say "the API on white reports a healthy database."

# --- 8. replication back: white feeds red
step "replication: white → red"
RECOVERY="The site is up on white. Red's replica is not rebuilt: its old database is standby_pgdata (or standby_pgdata_prev_$STAMP); rebuild with ~/standby/setup-standby.sh on red once its volume is empty."
ssh_ "$WHITE" '~/standby/setup-primary.sh'
ssh_ "$RED" bash -s -- "$STAMP" <<'REMOTE'
set -euo pipefail
stamp="$1"
docker stack rm bridgesb >/dev/null 2>&1 || true
for i in $(seq 1 30); do [ -z "$(docker ps -q --filter name=bridgesb_)" ] && break; sleep 2; done
docker volume create "standby_pgdata_prev_$stamp" >/dev/null
docker run --rm -v standby_pgdata:/from -v "standby_pgdata_prev_$stamp":/to alpine sh -c 'cp -a /from/. /to/ && [ "$(find /from | wc -l)" = "$(find /to | wc -l)" ]' \
  || { echo "the copy of red's database did not check out — NOT emptying standby_pgdata" >&2; exit 1; }
echo "red's promoted database kept as standby_pgdata_prev_$stamp"
docker run --rm -v standby_pgdata:/d alpine sh -c 'rm -rf /d/* /d/.[!.]* 2>/dev/null; true'
~/standby/setup-standby.sh
REMOTE
waited=0
until PRIMARY="$WHITE" STANDBY="$RED" "$HERE/../standby/status.sh" >/dev/null 2>&1; do
  [ "$waited" -lt "$MAX_WAIT_SECONDS" ] || die "red is not streaming from white after ${MAX_WAIT_SECONDS}s — docker service logs bridgesb_postgres-standby on red."
  sleep 5; waited=$((waited + 5))
done
say "red streams from white."

say
say "DONE. white is the primary again, red its replica. The site runs on white; the floating address follows Caddy (≈15 s)."
say "Kept, delete yourself when sure: white bridge_pgdata_diverged_$STAMP, red standby_pgdata_prev_$STAMP, white standby_pgdata (the old replica volume)."
say "Check: curl https://api.bridge.ntlstl.dev/api/v1/health ; infra/standby/status.sh ; tomorrow's 03:00 backup on white."
