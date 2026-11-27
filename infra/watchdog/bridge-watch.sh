#!/usr/bin/env bash
#
# R9 — a watcher OUTSIDE the home network and OUTSIDE bridge. The Dashboard, the board agents and Telegram all live inside bridge or behind the home
# router: when either dies they go quiet together, and the one tile that would have said so is on the page that is down (F9). This runs on another
# machine (the cloud VM), asks bridge's public addresses every minute, and when they have not answered for DEAD_AFTER_MIN minutes it speaks by
# itself — ntfy (a push to the phone, optionally forwarded to e-mail), never through bridge or Telegram.
#
#   bridge-watch.sh         one pass (a timer runs it every minute, see install.sh)
#   bridge-watch.sh test    sends a test message through the same channel, to check the settings
#
# A host is «up» when it answers HTTP 200 and, for the readiness address (api.bridge…/api/v1/health), says `"database":true`: a bridge that answers but
# cannot reach its database is not up. (The frontend host answers any path with its page, so it is asked for `/` and only has to say 200.) Two tries, a few seconds apart, so a lost packet is not an outage. The alarm is said once, repeated every
# REMIND_HOURS while it lasts, and once more when it is over.
#
# Who watches the watcher: with HEARTBEAT_URL set (a healthchecks.io check, period 1 min, grace ~10), every pass of THIS script pings it — whether
# bridge is up or not — so that if the VM itself dies, that service tells you. (Bridge has its own heartbeat to another check:
# EXTERNAL_HEARTBEAT_URL, bridge/apps/backend/src/external-heartbeat.)
#
# Settings (/etc/pipe-watchdog.env, mode 600): HOSTS, DEAD_AFTER_MIN (10), REMIND_HOURS (6), NTFY_URL (https://ntfy.sh/<your-secret-topic>),
# NTFY_EMAIL (optional: ntfy also mails it), HEARTBEAT_URL (optional), VANTAGE (default: the hostname), STATE_DIR. Tests: WATCH_NOW (epoch), RETRY_SLEEP.
# Never fails its caller: an alarm that cannot be sent is tried again on the next pass (it is not marked as said).
set -uo pipefail

ENV_FILE="${WATCH_ENV_FILE:-/etc/pipe-watchdog.env}"
if [ -r "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

HOSTS="${HOSTS:-https://bridge.ntlstl.dev/ https://api.bridge.ntlstl.dev/api/v1/health}"
DEAD_AFTER_MIN="${DEAD_AFTER_MIN:-10}"
REMIND_HOURS="${REMIND_HOURS:-6}"
STATE_DIR="${STATE_DIR:-/var/lib/pipe-watchdog}"
VANTAGE="${VANTAGE:-$(hostname)}"
RETRY_SLEEP="${RETRY_SLEEP:-5}"
NTFY_URL="${NTFY_URL:-}"
NTFY_EMAIL="${NTFY_EMAIL:-}"
HEARTBEAT_URL="${HEARTBEAT_URL:-}"
now="${WATCH_NOW:-$(date +%s)}"

mkdir -p "$STATE_DIR" 2>/dev/null || { echo "bridge-watch: cannot write $STATE_DIR" >&2; exit 0; }

log() { echo "[$(date -u +%FT%TZ)] $*"; }

# One message to the owner. Success = the channel took it.
say() { # urgent|default title text
  local priority="$1" title="$2" text="$3" args=()
  [ -n "$NTFY_URL" ] || { log "no NTFY_URL: cannot say: $title"; return 1; }
  args=(-fsS -m 20 -H "Title: $title" -H "Priority: $priority")
  [ "$priority" = urgent ] && args+=(-H "Tags: rotating_light") || args+=(-H "Tags: white_check_mark")
  [ -z "$NTFY_EMAIL" ] || args+=(-H "Email: $NTFY_EMAIL")
  curl "${args[@]}" -d "$text" "$NTFY_URL" >/dev/null 2>&1
}

if [ "${1:-}" = test ]; then
  if say default "watchdog: проверка" "Сторож на $VANTAGE жив и может писать сюда."; then echo "sent"; exit 0; fi
  echo "NOT sent — check NTFY_URL / the network of this machine" >&2
  exit 1
fi

# Whether one address is up: 200, and the readiness body when it is the readiness address.
up() { # url
  local url="$1" try body code
  for try in 1 2; do
    body="$(curl -sS -m 10 -w '\n%{http_code}' "$url" 2>/dev/null || true)"
    code="${body##*$'\n'}"
    body="${body%$'\n'*}"
    if [ "$code" = 200 ]; then
      case "$url" in
        */api/v1/health) case "$body" in *'"database":true'*) return 0;; esac;;
        *) return 0;;
      esac
    fi
    [ "$try" = 2 ] || sleep "$RETRY_SLEEP"
  done
  return 1
}

failed=""
for url in $HOSTS; do
  up "$url" || failed="$failed ${url#https://}"
done
failed="${failed# }"

down_file="$STATE_DIR/down_since"
said_file="$STATE_DIR/said_at"

# The watcher's own heartbeat: it is alive, whatever bridge is doing.
if [ -n "$HEARTBEAT_URL" ]; then curl -fsS -m 10 "$HEARTBEAT_URL" >/dev/null 2>&1 || log "own heartbeat not delivered"; fi

if [ -z "$failed" ]; then
  if [ -f "$said_file" ]; then
    since="$(cat "$down_file" 2>/dev/null || echo "$now")"
    if say default "bridge снова отвечает" "С точки $VANTAGE bridge снова отвечает (не отвечал $(( (now - since) / 60 )) мин)."; then
      rm -f "$said_file" "$down_file"
    fi
  else
    rm -f "$down_file"
  fi
  exit 0
fi

[ -f "$down_file" ] || echo "$now" > "$down_file"
since="$(cat "$down_file" 2>/dev/null || echo "$now")"
minutes=$(( (now - since) / 60 ))
log "down for ${minutes} min: $failed"

[ "$minutes" -ge "$DEAD_AFTER_MIN" ] || exit 0

if [ ! -f "$said_file" ]; then
  say urgent "bridge недоступен" "С точки $VANTAGE bridge не отвечает $minutes мин: $failed. Дашборд и платы молчат вместе с ним — проверьте интернет и роутер дома (известная причина: входящие 80/443 встали на роутере, service restart_firewall)." && echo "$now" > "$said_file"
elif [ $(( now - $(cat "$said_file") )) -ge $(( REMIND_HOURS * 3600 )) ]; then
  say urgent "bridge всё ещё недоступен" "С точки $VANTAGE bridge не отвечает уже $minutes мин: $failed." && echo "$now" > "$said_file"
fi
exit 0
