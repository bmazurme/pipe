#!/usr/bin/env bash
#
# Watches the board that holds the bridge stack (the node labelled bridge-primary — white, or red after a failover) from ANOTHER board.
# Run by pipe-primary-watch.timer every minute on blue (a manager that carries no load and is not the primary, not the replica).
#
# After CONFIRM_RUNS (3) bad minutes in a row it sends Telegram: what it saw (host down or only the service), how old the replica is,
# and the exact command to switch over — it does NOT switch by itself: that needs your age key and your typed word (docs/ha-dr-plan.md §8).
# Repeats every 30 min while it lasts, says so when the primary is back.
#
# It refuses to judge when IT is the one cut off: if this board cannot reach the gateway or any other board, nothing is said about the primary.
#
# Environment: PRIMARY_FALLBACK (192.168.50.11, used when the Swarm cannot say who is primary), GATEWAY (192.168.50.1),
#              PEERS (other boards to prove this board's own network: "192.168.50.12 192.168.50.14"), REPLICA_HOST (192.168.50.12),
#              HEALTH_PORT (3300), SSH_USER (pi).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CONFIRM_RUNS="${CONFIRM_RUNS:-3}"
REPEAT_SECONDS="${REPEAT_SECONDS:-1800}"
# shellcheck source=monitor-lib.sh
. "$HERE/monitor-lib.sh"

PRIMARY_FALLBACK="${PRIMARY_FALLBACK:-192.168.50.11}"
GATEWAY="${GATEWAY:-192.168.50.1}"
PEERS="${PEERS:-192.168.50.12 192.168.50.14}"
REPLICA_HOST="${REPLICA_HOST:-192.168.50.12}"
HEALTH_PORT="${HEALTH_PORT:-3300}"
SSH_USER="${SSH_USER:-pi}"
ME="$(hostname)"

up() { ping -c 1 -W 2 "$1" >/dev/null 2>&1; }

# 1. who is the primary? (the label is the truth; the fallback only when the Swarm cannot answer)
primary_ip="$PRIMARY_FALLBACK"; primary_name="$PRIMARY_FALLBACK"; failed_over=0
for node in $(docker node ls -q 2>/dev/null); do
  if [ -n "$(docker node inspect "$node" --format '{{index .Spec.Labels "bridge-primary"}}' 2>/dev/null)" ]; then
    primary_name="$(docker node inspect "$node" --format '{{.Description.Hostname}}' 2>/dev/null)"
    primary_ip="$(docker node inspect "$node" --format '{{.Status.Addr}}' 2>/dev/null)"
    [ -n "$(docker node inspect "$node" --format '{{index .Spec.Labels "failover"}}' 2>/dev/null)" ] && failed_over=1
    break
  fi
done

# 2. is THIS board connected? Otherwise stay silent.
reach=0
up "$GATEWAY" && reach=1
for peer in $PEERS; do [ "$peer" != "$primary_ip" ] && up "$peer" && reach=1; done
if [ "$reach" = 0 ]; then
  echo "this board ($ME) cannot reach the gateway or any other board — not judging $primary_name"
  exit 0
fi

# 3. the primary: the API must say the database is healthy
health="$(curl -fsS -m 6 "http://$primary_ip:$HEALTH_PORT/api/v1/health" 2>/dev/null || true)"
bad=1; case "$health" in *'"database":true'*) bad=0;; esac

if [ "$bad" = 1 ]; then
  if up "$primary_ip"; then what="плата отвечает на ping, но API/база не здоровы"; else what="плата не отвечает (ни ping, ни API)"; fi
  lag=""
  seconds="$(ssh -o BatchMode=yes -o ConnectTimeout=5 "$SSH_USER@$REPLICA_HOST" 'c=$(docker ps --filter name=bridgesb_postgres-standby -q | head -1); [ -n "$c" ] && docker exec "$c" psql -U bridge -Atc "select round(extract(epoch from now()-pg_last_xact_replay_timestamp()))::int" postgres' 2>/dev/null || true)"
  [ -n "$seconds" ] && lag=" Реплика на red: последняя применённая транзакция ${seconds} с назад."

  if [ "$failed_over" = 1 ]; then
    advice="Основная роль сейчас на $primary_name (после переключения): автоматического решения нет — проверьте питание и сеть платы, затем infra/failover/README.md."
  else
    advice=$'Если плата действительно недоступна (питание, сеть, диск), с вашей машины:\n  AGE_IDENTITY=<ваш ключ age> infra/failover/failover.sh --dry-run\nпотом то же без --dry-run и слово FAILOVER. Скрипт откажется, пока плата отвечает. Сначала проверьте, не выключена ли она случайно.'
  fi
  problem="🔴 Основная плата $primary_name ($primary_ip): $what — уже ${CONFIRM_RUNS} проверки подряд (наблюдает $ME).${lag}"$'\n'"$advice"
else
  problem=""
fi

transition "primary" "$bad" "$problem" "✅ Основная плата $primary_name снова отвечает, база здорова."
[ "$bad" = 0 ] && echo "ok: $primary_name ($primary_ip) healthy" || echo "bad: $primary_name ($primary_ip) not healthy"
exit 0
