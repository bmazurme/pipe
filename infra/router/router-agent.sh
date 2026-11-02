#!/usr/bin/env bash
#
# The router's agent, on a board (blue). Run every minute by pipe-router-agent.timer.
#
#   router-agent.sh          one round: read the router over SSH, tell bridge (Dashboard's «Роутер» tile); if bridge hands back a reboot the
#                            owner asked for in Telegram, reboot the router, wait for it and the internet to come back, tell bridge how it went
#   router-agent.sh probe    print what the router answers (and what would be sent), send nothing, reboot nothing — to see that the key works
#
# bridge never connects to the router or to this board: this agent asks, so the reboot is a request it picks up with its own report.
#
# Settings: /etc/pipe-boardagent.env (BRIDGE_API_URL, BRIDGE_API_KEY — the boards-only key of the OWNER) and /etc/pipe-router.env:
#   ROUTER_HOST (192.168.50.1)  ROUTER_USER (admin)  ROUTER_PORT (22)  ROUTER_NAME (router: how it is called in bridge)
#   ROUTER_DIR (/etc/pipe-router: the key id_ed25519 and the pinned known_hosts)  PING_TARGET (1.1.1.1: what «the internet» is)
#   WAIT_DOWN_SEC (60: how long to wait for it to go down)  WAIT_UP_SEC (300: for it and the internet to come back)  BRIDGE_RESOLVE
# Read from the router: nvram wan0_state_t / wan0_auxstate_t / link_internet / wan0_ipaddr, /proc/uptime, the WAN counters, a ping from the
# router. Every one is optional: what the firmware does not answer is left out, never guessed.
set -uo pipefail

for f in "${AGENT_ENV_FILE:-/etc/pipe-boardagent.env}" "${ROUTER_ENV_FILE:-/etc/pipe-router.env}"; do
  if [ -r "$f" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$f"
    set +a
  fi
done
ROUTER_HOST="${ROUTER_HOST:-192.168.50.1}"
ROUTER_USER="${ROUTER_USER:-admin}"
ROUTER_PORT="${ROUTER_PORT:-22}"
ROUTER_NAME="${ROUTER_NAME:-router}"
ROUTER_DIR="${ROUTER_DIR:-/etc/pipe-router}"
ROUTER_KEY="${ROUTER_KEY:-$ROUTER_DIR/id_ed25519}"
KNOWN_HOSTS="${KNOWN_HOSTS:-$ROUTER_DIR/known_hosts}"
STATE_DIR="${STATE_DIR:-/var/lib/pipe-router}"
PING_TARGET="${PING_TARGET:-1.1.1.1}"
POLL_SEC="${POLL_SEC:-2}"
WAIT_DOWN_SEC="${WAIT_DOWN_SEC:-60}"
WAIT_UP_SEC="${WAIT_UP_SEC:-300}"
BRIDGE_RESOLVE="${BRIDGE_RESOLVE-api.bridge.ntlstl.dev:443:192.168.50.10}"

log() { echo "[$(date -u +%FT%TZ)] $*" >&2; }

# One command on the router. The host key is pinned on the first connection and refused if it ever changes.
router_ssh() {
  ssh -i "$ROUTER_KEY" -p "$ROUTER_PORT" -o BatchMode=yes -o IdentitiesOnly=yes -o PasswordAuthentication=no \
    -o ConnectTimeout=8 -o ServerAliveInterval=5 -o ServerAliveCountMax=2 \
    -o UserKnownHostsFile="$KNOWN_HOSTS" -o StrictHostKeyChecking=accept-new "$ROUTER_USER@$ROUTER_HOST" "$@"
}
ping_ok() { ping -c 1 -W 2 "$1" >/dev/null 2>&1; }

# What the router says about itself, as key=value lines (run on the router by `sh -s`; busybox only).
collect() {
  router_ssh "sh -s -- $PING_TARGET" <<'REMOTE'
echo "model=$(nvram get productid 2>/dev/null)"
echo "uptime=$(cut -d. -f1 /proc/uptime 2>/dev/null)"
echo "wan_state=$(nvram get wan0_state_t 2>/dev/null)"
echo "wan_aux=$(nvram get wan0_auxstate_t 2>/dev/null)"
echo "link_internet=$(nvram get link_internet 2>/dev/null)"
echo "wan_ip=$(nvram get wan0_ipaddr 2>/dev/null)"
wif="$(nvram get wan0_pppoe_ifname 2>/dev/null)"
[ -n "$wif" ] || wif="$(nvram get wan0_ifname 2>/dev/null)"
echo "wan_if=$wif"
[ -z "$wif" ] || echo "wan_counters=$(grep "^ *$wif:" /proc/net/dev 2>/dev/null | sed 's/^[^:]*://' | awk '{print $1, $9}')"
echo "ping_begin"
ping -c 3 -W 2 "$1" 2>&1 | tail -3
echo "ping_end"
REMOTE
}

# The JSON for bridge, from the router's answer (RAW), whether it answered ping (REACHABLE) and let us in (SSHOK). Speeds come from the counters
# of the previous round (kept in $STATE_DIR/last): not shown for the first round, nor when a counter went backwards (the router rebooted).
build_report() { # reachable sshok raw
  mkdir -p "$STATE_DIR" 2>/dev/null || true
  REACHABLE="$1" SSHOK="$2" RAW="$3" NAME="$ROUTER_NAME" LAST="$STATE_DIR/last" python3 - <<'PY'
import json, os, re, time

values, ping_lines, in_ping = {}, [], False
for line in os.environ["RAW"].splitlines():
    if line == "ping_begin":
        in_ping = True
    elif line == "ping_end":
        in_ping = False
    elif in_ping:
        ping_lines.append(line)
    elif "=" in line:
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()


def integer(key):
    try:
        return int(values[key])
    except (KeyError, ValueError):
        return None


report = {
    "host": os.environ["NAME"],
    "reachable": os.environ["REACHABLE"] == "1",
    "sshOk": os.environ["SSHOK"] == "1",
}

if report["sshOk"]:
    report["model"] = values.get("model") or None
    report["uptimeSec"] = integer("uptime")
    report["wanState"] = integer("wan_state")
    report["wanAux"] = integer("wan_aux")
    internet = integer("link_internet")
    report["internetOk"] = None if internet is None else internet == 2
    report["wanIp"] = values.get("wan_ip") or None

    text = "\n".join(ping_lines)
    loss = re.search(r"(\d+)% packet loss", text)
    avg = re.search(r"=\s*[\d.]+/([\d.]+)/[\d.]+", text)
    report["pingLossPct"] = int(loss.group(1)) if loss else None
    report["pingMs"] = float(avg.group(1)) if avg else None

    counters = values.get("wan_counters", "").split()
    now = time.time()
    last_path = os.environ["LAST"]
    if len(counters) == 2 and all(c.isdigit() for c in counters):
        rx, tx = int(counters[0]), int(counters[1])
        try:
            with open(last_path) as handle:
                at, last_rx, last_tx = (float(x) for x in handle.read().split())
            seconds = now - at
            if 20 <= seconds <= 600 and rx >= last_rx and tx >= last_tx:
                report["rxBps"] = round((rx - last_rx) * 8 / seconds)
                report["txBps"] = round((tx - last_tx) * 8 / seconds)
        except (OSError, ValueError):
            pass
        try:
            with open(last_path, "w") as handle:
                handle.write(f"{now} {rx} {tx}")
        except OSError:
            pass

print(json.dumps(report))
PY
}

# One request to bridge; the key goes to curl as a config on stdin (printf is a builtin), never in argv, where any local user could read it via ps.
# bridge_request <path> <json> [host:port:ip to pin]  → the answer on stdout
bridge_request() {
  local args=(-K - -fsS --max-time 20 -X POST -H 'Content-Type: application/json' --data "$2")
  [ -z "${3:-}" ] || args+=(--resolve "$3")
  printf 'header = "Authorization: Bearer %s"\n' "$BRIDGE_API_KEY" | curl "${args[@]}" "$BRIDGE_API_URL$1"
}

# Through the LAN address of the stack first; the ordinary way only when that address could not be reached at all — never after an answer.
bridge() {
  local code=0
  if [ -n "$BRIDGE_RESOLVE" ]; then
    bridge_request "$1" "$2" "$BRIDGE_RESOLVE" && return 0
    code=$?
    case "$code" in 6|7|28|35|52|56) ;; *) return "$code" ;; esac
  fi
  bridge_request "$1" "$2"
}

# Reboots the router and says how it went. The ssh connection dies with the router, so its status says little; what counts is that the router
# stops answering and then comes back, and that the internet comes back after it.
do_reboot() { # request-id
  local id="$1" started="$SECONDS" down=0 up=0 internet=0 tries step=$((POLL_SEC > 0 ? POLL_SEC : 1)) detail ok=true
  log "rebooting the router (request $id)"
  # The connection dies with the router, so ssh's own status says nothing: what counts is whether the router goes down below.
  router_ssh reboot >/dev/null 2>&1 || true

  for ((tries = 0; tries < WAIT_DOWN_SEC / step; tries++)); do
    ping_ok "$ROUTER_HOST" || { down=1; break; }
    sleep "$POLL_SEC"
  done
  if [ "$down" = 0 ]; then
    detail="роутер не перестал отвечать за ${WAIT_DOWN_SEC} с — команда, видимо, не сработала"
    ok=false
  else
    local went_down="$SECONDS"
    for ((tries = 0; tries < WAIT_UP_SEC / step; tries++)); do
      ping_ok "$ROUTER_HOST" && { up=1; break; }
      sleep "$POLL_SEC"
    done
    if [ "$up" = 0 ]; then
      detail="роутер не вернулся за $((WAIT_UP_SEC / 60)) мин — нужно проверить его на месте"
      ok=false
    else
      local came_back="$SECONDS"
      for ((tries = 0; tries < WAIT_UP_SEC / step; tries++)); do
        ping_ok "$PING_TARGET" && { internet=1; break; }
        sleep "$POLL_SEC"
      done
      detail="роутер был недоступен $((came_back - went_down)) с"
      if [ "$internet" = 1 ]; then detail="$detail, интернет вернулся через $((SECONDS - started)) с после команды"
      else detail="$detail, но интернета ещё нет — проверьте провайдера"; fi
    fi
  fi

  local body attempt
  body="$(RESULT_OK="$ok" RESULT_DETAIL="$detail" python3 -c 'import json, os; print(json.dumps({"ok": os.environ["RESULT_OK"] == "true", "detail": os.environ["RESULT_DETAIL"]}))')"
  for attempt in 1 2 3 4 5; do
    bridge "/api/v1/boards/agent/router/reboots/$id/result" "$body" >/dev/null && return 0
    log "could not tell bridge how the reboot went (attempt $attempt)"
    sleep $((POLL_SEC > 0 ? 10 : 0))
  done

  return 0
}

do_round() {
  local reachable=0 sshok=0 raw="" body answer id
  ping_ok "$ROUTER_HOST" && reachable=1
  if [ "$reachable" = 1 ]; then
    if raw="$(collect 2>"$STATE_DIR/ssh.err")" && [ -n "$raw" ] && grep -q '^uptime=' <<<"$raw"; then
      sshok=1
    else
      log "cannot read the router over SSH: $(head -c 200 "$STATE_DIR/ssh.err" 2>/dev/null)"
    fi
  fi
  body="$(build_report "$reachable" "$sshok" "$raw")" || { log "could not build the report"; return 0; }

  if [ "${1:-}" = probe ]; then
    echo "--- the router answered:"; echo "$raw"; echo "--- would send:"; echo "$body"
    return 0
  fi

  answer="$(bridge /api/v1/boards/agent/router "$body")" || { log "bridge refused the report"; return 0; }
  id="$(ANSWER="$answer" python3 -c 'import json, os
try:
    value = json.loads(os.environ["ANSWER"]).get("rebootRequestId")
except ValueError:
    value = None
print(value if isinstance(value, int) else "")' 2>/dev/null)"
  [ -z "$id" ] && return 0
  if [ "$sshok" = 1 ]; then
    do_reboot "$id"
  else
    # bridge hands a request out only for a router that could be read; if the login broke since, say so instead of leaving it hanging.
    bridge "/api/v1/boards/agent/router/reboots/$id/result" '{"ok": false, "detail": "агент не смог войти на роутер по SSH — роутер не трогали"}' >/dev/null || true
  fi
}

case "${1:-}" in
  ""|probe) ;;
  *) echo "usage: router-agent.sh [probe]" >&2; exit 2 ;;
esac

[ "${1:-}" = probe ] || { [ -n "${BRIDGE_API_URL:-}" ] && [ -n "${BRIDGE_API_KEY:-}" ] || { log "BRIDGE_API_URL / BRIDGE_API_KEY are not set — nothing done"; exit 0; }; }
[[ "$PING_TARGET" =~ ^[A-Za-z0-9.:-]+$ ]] || { log "PING_TARGET is not a host name or an address — nothing done"; exit 0; }
[ -r "$ROUTER_KEY" ] || { log "no key $ROUTER_KEY — run install.sh and add its public key to the router"; exit 0; }
mkdir -p "$STATE_DIR" 2>/dev/null || { log "cannot write $STATE_DIR — nothing done"; exit 0; }
# One round at a time: a reboot waits for minutes, and the next minute's round must not start a second one.
exec 9>"$STATE_DIR/lock"
flock -n 9 || { log "another round is in progress"; exit 0; }

do_round "${1:-}"
exit 0
