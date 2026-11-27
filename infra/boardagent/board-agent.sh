#!/usr/bin/env bash
#
# The board's side of "update the scripts from the owner's button" — run on every board, as root, by two systemd timers:
#
#   board-agent.sh report   hourly: tell bridge which of this board's scripts are older than `main` (check-scripts.sh --json). Bridge
#                           announces an outdated board once on Telegram, with a button, and shows it on the page «Платы».
#   board-agent.sh selftest checks this agent (syntax, manifest, bridge reachable and answering, check-scripts --json) — what a new version has
#                           to pass before it replaces the running one
#   board-agent.sh apply    every minute: ask bridge whether the owner pressed that button for THIS board and, if so, install what it
#                           names. One request; nothing is done without a waiting decision. The same run also sends the board's vital signs
#                           (temperature, throttling, fan, load, memory, disk) every METRICS_EVERY_SEC seconds - the Dashboard tile and its graph.
#
# What a decision can and cannot do (the agent decides this, not bridge — a bridge that is wrong or hijacked must not be able to put
# code on a board):
#   - only scripts listed in the agent's own manifest (manifest.txt, copied by hand with the agent), to the place THAT list gives;
#   - only scripts that are already installed here (it does not put new files on a board);
#   - only from a commit that is on `main` (GitHub's compare says "behind" or "identical"), fetched from GitHub at that commit;
#   - the agent itself (board-agent.sh, manifest.txt — nothing else of infra/boardagent/) only through the self-update below: a broken
#     agent would leave the board with no way to be fixed from here, so the new version must first pass its own `selftest` (run from a
#     staging copy), the old one is kept in STATE_DIR/agent-prev, and if the new one then crashes on its first run the rollback unit
#     (rollback.sh, installed by hand with the agent) puts the old one back;
#   - every shell script passes `bash -n` before it replaces anything; the old file is kept, and everything is put back if any file
#     of the decision fails to install or to verify.
# The result goes back to bridge (a message on Telegram and the page).
#
# A second kind of decision, «update the worker» (the button on the page «Платы»): the board's own worker containers are named
# pipe-worker-pi-<colour> and run the project's image, ghcr.io/bmazurme/pipe-worker:stable. The agent pulls that image and recreates each
# such container with the SAME settings (read back from `docker inspect`, so nothing is typed from memory): the old one is stopped
# gracefully (the worker finishes the job it is on, up to its own stop timeout), renamed aside, the new one must stay up for a while, and if it
# does not the old container is put back and started. What it will touch is fixed HERE, not by bridge: only containers with that name
# pattern whose image is that repository, only the `stable` tag of it, and only a container whose settings it can reproduce exactly
# (named volumes, env, restart policy, limits — a bind mount, a published port, a device or extra privileges is refused, never guessed).
#
# Settings (/etc/pipe-boardagent.env, mode 600): BRIDGE_API_URL (https://api.bridge.ntlstl.dev), BRIDGE_API_KEY (a boards-only API key of
# the OWNER, brk_…), OWNER, REPO, BRANCH, STATE_DIR, BRIDGE_PI_DIR, MANIFEST_FILE, CHECK_SCRIPT, BOARD_HOST. Tests: GITHUB_API.
set -uo pipefail

OWNER="${OWNER:-bmazurme}"
REPO="${REPO:-pipe}"
BRANCH="${BRANCH:-main}"
GITHUB_API="${GITHUB_API:-https://api.github.com}"
RAW_HOST="${RAW_HOST:-https://raw.githubusercontent.com}"
STATE_DIR="${STATE_DIR:-/var/lib/pipe-boardagent}"
BRIDGE_PI_DIR="${BRIDGE_PI_DIR:-/home/pi/bridge-pi}"
MANIFEST_FILE="${MANIFEST_FILE:-/usr/local/lib/pipe-boardagent/manifest.txt}"
CHECK_SCRIPT="${CHECK_SCRIPT:-/usr/local/lib/pipe-scriptcheck/check-scripts.sh}"
HOST="${BOARD_HOST:-$(hostname)}"
AGENT_VERSION=4
# The vital signs go to bridge this often (a run of `apply` is every minute; one in two sends).
METRICS_EVERY_SEC="${METRICS_EVERY_SEC:-120}"
# The worker update: the only image it will pull and the only container names it will touch (see the header). Tests change the image.
WORKER_IMAGE="${WORKER_IMAGE:-ghcr.io/bmazurme/pipe-worker:stable}"
WORKER_NAME_RE='^pipe-worker-pi-[a-z0-9][a-z0-9-]{0,40}$'
# How long a new worker container must stay up before the old one is thrown away.
WORKER_STAY_UP_SEC="${WORKER_STAY_UP_SEC:-45}"
# The reliable way to bridge: the stack's own address inside the LAN (curl --resolve host:port:ip), so a request does not have to leave through the
# router and come back, and does not depend on the provider. If that address does not answer, the request is repeated the ordinary way. Set
# BRIDGE_RESOLVE= (empty) to turn it off, or to another host:port:ip.
BRIDGE_RESOLVE="${BRIDGE_RESOLVE-api.bridge.ntlstl.dev:443:192.168.50.10}"

log() { echo "[$(date -u +%FT%TZ)] $*"; }
need() { [ -n "${!1:-}" ] || { log "$1 is not set (/etc/pipe-boardagent.env) — nothing done"; exit 0; }; }

# One request; the key goes to curl as a config on stdin (printf is a builtin), never in argv, where any local user could read it via ps.
# bridge_request <seconds> <method> <path> [json-body] [host:port:ip to pin]
bridge_request() {
  local timeout="$1" method="$2" path="$3" body="${4:-}" resolve="${5:-}"
  local args=(-K - -fsS --max-time "$timeout" -X "$method")
  [ -z "$body" ] || args+=(-H 'Content-Type: application/json' --data "$body")
  [ -z "$resolve" ] || args+=(--resolve "$resolve")
  printf 'header = "Authorization: Bearer %s"\n' "$BRIDGE_API_KEY" | curl "${args[@]}" "$BRIDGE_API_URL$path"
}

# method path [json-body] [seconds] → body on stdout; fails on a non-2xx. Through the LAN address first; repeated the ordinary way only when
# that address could not be reached at all (curl 6/7/28/35/52/56) - never after an answer, so a request is not sent twice.
bridge() {
  local method="$1" path="$2" body="${3:-}" timeout="${4:-30}" code=0
  if [ -n "$BRIDGE_RESOLVE" ]; then
    bridge_request "$timeout" "$method" "$path" "$body" "$BRIDGE_RESOLVE" && return 0
    code=$?
    case "$code" in 6|7|28|35|52|56) ;; *) return "$code" ;; esac
  fi
  bridge_request "$timeout" "$method" "$path" "$body"
}

# The worker containers on this board — JSON [{name, image, running, restartCount, startedAt, oomKilled}] for bridge: «Обновить worker» is shown
# only where there are some, and the drift check (R1) reads the restarts.
list_worker_containers() { # names, one per line
  command -v docker >/dev/null 2>&1 || return 0
  docker ps -a --format '{{.Names}}' 2>/dev/null | grep -E "$WORKER_NAME_RE" || true
}

collect_workers() {
  local name rows=""
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    rows="$rows$(docker inspect -f '{{.Name}}|{{.Config.Image}}|{{.State.Running}}|{{.RestartCount}}|{{.State.StartedAt}}|{{.State.OOMKilled}}' "$name" 2>/dev/null)"$'\n'
  done < <(list_worker_containers)
  ROWS="$rows" python3 -c '
import json, os
out = []
for line in os.environ.get("ROWS", "").splitlines():
    parts = line.split("|")
    if len(parts) == 6 and parts[0].startswith("/"):
        row = {"name": parts[0][1:], "image": parts[1][:200], "running": parts[2] == "true", "oomKilled": parts[5] == "true"}
        # How many times docker restarted it by itself, and since when it has been up: a worker that crash-loops shows here, nowhere else.
        if parts[3].isdigit():
            row["restartCount"] = int(parts[3])
        if parts[4] and not parts[4].startswith("0001"):
            row["startedAt"] = parts[4][:40]
        out.append(row)
print(json.dumps(out[:8]))
'
}

# What the board can say about itself besides its scripts: the root disk (the first thing that quietly kills a Pi), and the SSH door —
# whether passwords still work and how many keys are authorized — so a board nobody can log in to, or one that anyone with a password
# can, shows on the page before it matters. Every field is optional: a probe that fails is left out, never guessed.
collect_health() {
  local used free inodes passwd keys active=true f
  read -r used free < <(df -Pm / 2>/dev/null | awk 'NR == 2 { gsub(/%/, "", $5); print $5, $4 }')
  inodes="$(df -Pi / 2>/dev/null | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
  passwd="$(sshd -T 2>/dev/null | awk '$1 == "passwordauthentication" { print $2; exit }')"
  keys=0
  for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
    [ -r "$f" ] && keys=$((keys + $(grep -cEv '^[[:space:]]*(#|$)' "$f" 2>/dev/null || true)))
  done
  systemctl is-active --quiet ssh 2>/dev/null || systemctl is-active --quiet sshd 2>/dev/null || active=false
  local workers
  workers="$(collect_workers 2>/dev/null)" || workers="[]"
  WORKERS_JSON="${workers:-[]}" DISK_USED="${used:-}" DISK_FREE_MB="${free:-}" INODES_USED="${inodes:-}" SSH_PASSWORD="${passwd:-}" SSH_KEYS="$keys" SSHD_ACTIVE="$active" python3 -c '
import json, os
def num(name):
    v = os.environ.get(name, "")
    return int(v) if v.isdigit() else None
health = {
    "diskUsedPct": num("DISK_USED"),
    "diskFreeMb": num("DISK_FREE_MB"),
    "inodesUsedPct": num("INODES_USED"),
    "sshPasswordAuth": {"yes": True, "no": False}.get(os.environ.get("SSH_PASSWORD", "")),
    "sshAuthorizedKeys": num("SSH_KEYS"),
    "sshdActive": os.environ.get("SSHD_ACTIVE") == "true",
}
try:
    workers = json.loads(os.environ.get("WORKERS_JSON") or "[]")
except ValueError:
    workers = []
if workers:
    health["workers"] = workers
print(json.dumps({k: v for k, v in health.items() if v is not None}))
'
}

do_report() {
  local report health
  report="$(BOARD_HOST="$HOST" "$CHECK_SCRIPT" --json)" || { log "check-scripts.sh --json failed — nothing reported"; return 1; }
  health="$(collect_health 2>/dev/null)" || health=""
  [ -n "$health" ] || health='{}'
  report="$(printf '%s' "$report" | HOST_NAME="$HOST" AGENT_VERSION="$AGENT_VERSION" HEALTH="$health" python3 -c '
import json, os, sys
data = json.load(sys.stdin)
data["host"] = os.environ["HOST_NAME"]
data["agentVersion"] = os.environ["AGENT_VERSION"]
try:
    data["health"] = json.loads(os.environ.get("HEALTH") or "{}")
except ValueError:
    pass
print(json.dumps(data))
')" || return 1
  if bridge POST /api/v1/boards/agent/report "$report" >/dev/null; then log "reported to bridge"; else log "bridge did not take the report"; return 1; fi
}

# A path in the manifest → where it lives on this board, or nothing.
installed_path_of() {
  local repo_path="$1" installed rp
  while IFS='|' read -r installed rp; do
    [ "$rp" = "$repo_path" ] || continue
    printf '%s' "${installed//@BRIDGE_PI@/$BRIDGE_PI_DIR}"
    return 0
  done < "$MANIFEST_FILE"
  return 1
}

finish() { # ok(true|false) message
  local body
  body="$(OK="$1" MSG="$2" python3 -c 'import json, os; print(json.dumps({"ok": os.environ["OK"] == "true", "message": os.environ["MSG"][:3900]}))')"
  bridge POST "/api/v1/boards/agent/updates/$UPDATE_ID/result" "$body" >/dev/null || log "bridge did not take the result"
}

restore() { # put every backed-up file back
  local pair
  for pair in "${DONE[@]:-}"; do
    [ -n "$pair" ] || continue
    cp -p "$BACKUP/$(basename "${pair%%|*}")" "${pair%%|*}" 2>/dev/null || true
  done
}

# What a new version of the agent has to pass before it replaces the running one. Keep it working in every future version: the version
# that is running calls it on the NEXT one.
do_selftest() {
  bash -n "$0" || { echo "selftest: syntax error in $0" >&2; return 1; }
  [ -s "$MANIFEST_FILE" ] || { echo "selftest: no manifest $MANIFEST_FILE" >&2; return 1; }
  awk -F'|' 'NF == 2 && $2 ~ /^infra\// { good++; next } NF { bad = 1 } END { exit (bad || good < 5) }' "$MANIFEST_FILE" \
    || { echo "selftest: the manifest is malformed (every line is 'installed path|infra/…', at least five lines)" >&2; return 1; }
  bridge GET "/api/v1/boards/agent/pending?host=$HOST" | python3 -c 'import json, sys; json.load(sys.stdin)["update"]' 2>/dev/null \
    || { echo "selftest: bridge does not answer the way the agent expects" >&2; return 1; }
  "$CHECK_SCRIPT" --json | python3 -c 'import json, sys; assert json.load(sys.stdin)["scripts"]' 2>/dev/null \
    || { echo "selftest: check-scripts.sh --json gives no usable report" >&2; return 1; }
  echo "selftest ok"
}

# The first run of a freshly installed agent that gets an answer from bridge proves it works: the marker the update left is dropped.
verify_self_update() {
  [ -f "$STATE_DIR/agent-update.pending" ] || return 0
  rm -f "$STATE_DIR/agent-update.pending"
  log "agent update verified"
}

# Replaces the agent (and its manifest) with the versions of this decision, safely. Only after `selftest` of the NEW pair passed.
update_self() { # work-dir, then the repo paths of the agent files that changed
  local work="$1"; shift
  local stage="$work/self" f dest base
  mkdir -p "$stage" "$STATE_DIR/agent-prev" || { finish false "cannot prepare the agent update"; return 1; }
  local agent_dest manifest_dest
  agent_dest="$(installed_path_of infra/boardagent/board-agent.sh)" || { finish false "the agent is not in the manifest"; return 1; }
  manifest_dest="$(installed_path_of infra/boardagent/manifest.txt)" || { finish false "the agent manifest is not in the manifest"; return 1; }
  # The staging pair: the new file where the decision has one, the installed one otherwise.
  cp "$agent_dest" "$stage/board-agent.sh" && cp "$manifest_dest" "$stage/manifest.txt" || { finish false "cannot copy the installed agent for the check"; return 1; }
  for f in "$@"; do cp "$work/$(basename "$f")" "$stage/$(basename "$f")"; done
  chmod 755 "$stage/board-agent.sh"

  local out
  out="$(MANIFEST_FILE="$stage/manifest.txt" bash "$stage/board-agent.sh" selftest 2>&1)" \
    || { finish false "the new agent did not pass its own check — nothing replaced: $(printf '%s' "$out" | tail -c 400)"; return 1; }

  rm -rf "$STATE_DIR/agent-prev"; mkdir -p "$STATE_DIR/agent-prev"
  cp -p "$agent_dest" "$STATE_DIR/agent-prev/board-agent.sh" && cp -p "$manifest_dest" "$STATE_DIR/agent-prev/manifest.txt" \
    || { finish false "could not keep the old agent — nothing replaced"; return 1; }
  echo "$UPDATE_ID $(date +%s)" > "$STATE_DIR/agent-update.pending"

  for f in "$@"; do
    base="$(basename "$f")"
    case "$base" in board-agent.sh) dest="$agent_dest" ;; *) dest="$manifest_dest" ;; esac
    if ! cp "$stage/$base" "$dest.new.$$" || ! chmod "$(stat -c %a "$dest" 2>/dev/null || stat -f %Lp "$dest" 2>/dev/null || echo 755)" "$dest.new.$$" || ! mv -f "$dest.new.$$" "$dest"; then
      rm -f "$dest.new.$$"
      cp -p "$STATE_DIR/agent-prev/board-agent.sh" "$agent_dest"; cp -p "$STATE_DIR/agent-prev/manifest.txt" "$manifest_dest"
      rm -f "$STATE_DIR/agent-update.pending"
      finish false "could not install the new agent — the old one is back"
      return 1
    fi
  done
  return 0
}

# The board's vital signs, for the Dashboard tile: the SoC temperature, whether the firmware is throttling or under-volted right now (the low four bits
# of `vcgencmd get_throttled`, the same reading infra/monitor alerts on), the fan, the NVMe temperature, load, memory, the root disk, uptime. A probe that
# fails is left out, never guessed. The hooks (THERMAL_FILE, LOADAVG_FILE, MEMINFO_FILE, UPTIME_FILE, HWMON_GLOB, NVME_GLOB) are for the tests.
collect_metrics() {
  local thermal="${THERMAL_FILE:-/sys/class/thermal/thermal_zone0/temp}" loadavg="${LOADAVG_FILE:-/proc/loadavg}"
  local meminfo="${MEMINFO_FILE:-/proc/meminfo}" uptime_file="${UPTIME_FILE:-/proc/uptime}"
  local soc fan nvme thr disk f
  soc="$(cat "$thermal" 2>/dev/null || true)"
  thr="$(vcgencmd get_throttled 2>/dev/null | sed -n 's/.*=0x\([0-9a-fA-F]*\).*/\1/p')"
  fan=""; for f in ${HWMON_GLOB:-/sys/class/hwmon/hwmon*/fan1_input}; do [ -r "$f" ] && { fan="$(cat "$f" 2>/dev/null)"; break; }; done
  nvme=""; for f in ${NVME_GLOB:-/sys/class/nvme/nvme0/hwmon*/temp1_input}; do [ -r "$f" ] && { nvme="$(cat "$f" 2>/dev/null)"; break; }; done
  disk="$(df -P / 2>/dev/null | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
  SOC_MILLI="$soc" THROTTLED_HEX="$thr" FAN_RPM="$fan" NVME_MILLI="$nvme" DISK_USED="$disk" LOADAVG_FILE="$loadavg" MEMINFO_FILE="$meminfo" UPTIME_FILE="$uptime_file" \
    python3 -c '
import json, os
def read(path):
    try:
        with open(path) as f:
            return f.read()
    except OSError:
        return ""
def integer(name):
    v = os.environ.get(name, "").strip()
    return int(v) if v.lstrip("-").isdigit() else None
out = {}
soc = integer("SOC_MILLI")
if soc is not None:
    out["socTempC"] = round(soc / 1000)
hexv = os.environ.get("THROTTLED_HEX", "").strip()
if hexv:
    try:
        out["throttled"] = int(hexv, 16) & 0xF
    except ValueError:
        pass
fan = integer("FAN_RPM")
if fan is not None:
    out["fanRpm"] = fan
nvme = integer("NVME_MILLI")
if nvme is not None:
    out["nvmeTempC"] = round(nvme / 1000)
parts = read(os.environ["LOADAVG_FILE"]).split()
if parts:
    try:
        out["load1"] = round(float(parts[0]), 2)
    except ValueError:
        pass
mem = {}
for line in read(os.environ["MEMINFO_FILE"]).splitlines():
    key, _, rest = line.partition(":")
    digits = rest.split()
    if digits and digits[0].isdigit():
        mem[key] = int(digits[0])
if mem.get("MemTotal") and "MemAvailable" in mem:
    out["memAvailPct"] = round(mem["MemAvailable"] * 100 / mem["MemTotal"])
    out["memTotalMb"] = round(mem["MemTotal"] / 1024)
disk = integer("DISK_USED")
if disk is not None:
    out["diskUsedPct"] = disk
up = read(os.environ["UPTIME_FILE"]).split()
if up:
    try:
        out["uptimeSec"] = int(float(up[0]))
    except ValueError:
        pass
print(json.dumps(out))
'
}

# Sends the vital signs at most every METRICS_EVERY_SEC seconds (the timer runs us every minute; a little slack keeps timer jitter from
# skipping a slot). Short timeout, and never an error for the caller: the decisions that `apply` is for must not wait on this.
do_metrics() {
  local last now body
  # METRICS_EVERY_SEC=0 turns it off.
  [ "$METRICS_EVERY_SEC" -gt 0 ] 2>/dev/null || return 0
  now="$(date +%s)"
  last="$(cat "$STATE_DIR/metrics-last" 2>/dev/null || echo 0)"
  [ $(( now - last )) -ge $(( METRICS_EVERY_SEC - 10 )) ] || return 0
  body="$(HOST_NAME="$HOST" METRICS="$(collect_metrics 2>/dev/null || echo '{}')" python3 -c '
import json, os
data = json.loads(os.environ.get("METRICS") or "{}")
data["host"] = os.environ["HOST_NAME"]
print(json.dumps(data))
' 2>/dev/null)" || return 0
  # The attempt is what is rate-limited, not only the success: a bridge that is down must not cost two timeouts every minute.
  echo "$now" > "$STATE_DIR/metrics-last"
  bridge POST /api/v1/boards/agent/metrics "$body" 10 >/dev/null 2>&1 || true
  return 0
}

# ---- «update the worker» ------------------------------------------------------------------------------------------------------------

# Reads one container's settings and prints the `docker run` arguments that reproduce them (NUL-separated), or a reason it will not do it
# (exit 3). Only what it can reproduce exactly is accepted — see the header.
worker_run_args() { # inspect-json image-env-json
  INSPECT="$1" IMAGE_ENV="$2" python3 -c '
import json, os, sys
c = json.loads(os.environ["INSPECT"])[0]
image_env = set(json.loads(os.environ.get("IMAGE_ENV") or "[]"))
hc, cfg = c.get("HostConfig") or {}, c.get("Config") or {}
def refuse(why):
    sys.stdout.write(why); sys.exit(3)
if hc.get("Privileged"): refuse("the container is privileged")
if hc.get("Devices"): refuse("the container has devices")
if hc.get("CapAdd"): refuse("the container adds capabilities")
if hc.get("PortBindings"): refuse("the container publishes ports")
if hc.get("NetworkMode") not in ("default", "bridge"): refuse("the container uses the network " + str(hc.get("NetworkMode")))
if hc.get("PidMode") or hc.get("IpcMode") not in ("", None, "private", "shareable"): refuse("the container shares a namespace")
if hc.get("Tmpfs"): refuse("the container has tmpfs mounts")
for m in c.get("Mounts") or []:
    if m.get("Type") != "volume": refuse("the container has a " + str(m.get("Type")) + " mount")
args = []
policy = (hc.get("RestartPolicy") or {}).get("Name") or ""
if policy and policy != "no": args += ["--restart", policy]
timeout = cfg.get("StopTimeout")
if isinstance(timeout, int) and timeout > 0: args += ["--stop-timeout", str(timeout)]
if hc.get("NanoCpus"): args += ["--cpus", ("%.3f" % (hc["NanoCpus"] / 1e9)).rstrip("0").rstrip(".")]
if hc.get("Memory"): args += ["--memory", str(hc["Memory"])]
if hc.get("CpuShares"): args += ["--cpu-shares", str(hc["CpuShares"])]
for m in c.get("Mounts") or []:
    args += ["-v", m["Name"] + ":" + m["Destination"] + ("" if m.get("RW", True) else ":ro")]
for e in cfg.get("Env") or []:
    if e not in image_env: args += ["-e", e]
sys.stdout.write("\0".join(args) + ("\0" if args else ""))
'
}

# One container: replace it with the new image, or put everything back. Prints a one-line account; returns 0 for «done or already current».
update_one_worker() { # name new-image-id work-dir
  local name="$1" new_id="$2" work="$3" repo_of_image inspect old_id old_env stop_t rc a
  inspect="$(docker inspect "$name" 2>/dev/null)" || { echo "$name: cannot be inspected"; return 1; }
  repo_of_image="$(docker inspect -f '{{.Config.Image}}' "$name" 2>/dev/null)"
  repo_of_image="${repo_of_image%@*}"; repo_of_image="${repo_of_image%:*}"
  [ "$repo_of_image" = "${WORKER_IMAGE%:*}" ] || { echo "$name: refused — it runs $repo_of_image, not ${WORKER_IMAGE%:*}"; return 1; }
  old_id="$(docker inspect -f '{{.Image}}' "$name" 2>/dev/null)"
  if [ "$old_id" = "$new_id" ]; then echo "$name: already on the current image"; return 0; fi
  old_env="$(docker image inspect -f '{{json .Config.Env}}' "$old_id" 2>/dev/null || echo '[]')"
  worker_run_args "$inspect" "$old_env" > "$work/args-$name"; rc=$?
  if [ "$rc" -ne 0 ]; then echo "$name: refused — $(head -c 300 "$work/args-$name")"; return 1; fi
  local args=()
  while IFS= read -r -d '' a; do args+=("$a"); done < "$work/args-$name"
  stop_t="$(docker inspect -f '{{.Config.StopTimeout}}' "$name" 2>/dev/null)"
  case "$stop_t" in ''|*[!0-9]*|0) stop_t=30 ;; esac

  log "stopping $name (up to ${stop_t}s for its current job)"
  docker stop -t "$stop_t" "$name" >/dev/null 2>&1 || { echo "$name: could not be stopped"; docker start "$name" >/dev/null 2>&1; return 1; }
  docker rename "$name" "old-$name" >/dev/null 2>&1 || { echo "$name: could not be renamed"; docker start "$name" >/dev/null 2>&1; return 1; }
  docker tag "$old_id" "pipe-worker-rollback:$name" >/dev/null 2>&1 || true

  local out waited=0 ok=0 state
  if out="$(docker run -d --name "$name" "${args[@]}" "$WORKER_IMAGE" 2>&1)"; then
    # It must stay up, not merely start: a worker that crashes on a bad image dies within seconds.
    while [ "$waited" -lt "$WORKER_STAY_UP_SEC" ]; do
      sleep "${WORKER_POLL_SEC:-3}"; waited=$((waited + ${WORKER_POLL_SEC:-3}))
      state="$(docker inspect -f '{{.State.Running}} {{.RestartCount}}' "$name" 2>/dev/null)"
      [ "$state" = "true 0" ] || { ok=0; break; }
      ok=1
    done
    [ "$WORKER_STAY_UP_SEC" -gt 0 ] || ok=1
  fi
  if [ "$ok" -ne 1 ]; then
    local why; why="$(docker logs --tail 5 "$name" 2>&1 | tr '\n' ' ' | head -c 300)"
    docker rm -f "$name" >/dev/null 2>&1
    docker rename "old-$name" "$name" >/dev/null 2>&1 && docker start "$name" >/dev/null 2>&1
    echo "$name: the new container did not stay up (${why:-$out}) — the old one is back"
    return 1
  fi
  docker rm "old-$name" >/dev/null 2>&1 || true
  echo "$name: updated (${old_id#sha256:} → ${new_id#sha256:})" | sed -E 's/([0-9a-f]{12})[0-9a-f]+/\1/g'
  return 0
}

apply_worker_update() { # decision id
  UPDATE_ID="$1"
  printf '%s' "$UPDATE_ID" | grep -qE '^[0-9]+$' || { log "bad worker decision id — nothing done"; return 0; }
  command -v docker >/dev/null 2>&1 || { finish false "docker is not available on this board"; return 0; }
  local names; names="$(list_worker_containers)"
  [ -n "$names" ] || { finish false "no worker container (pipe-worker-pi-…) on this board"; return 0; }

  log "worker decision $UPDATE_ID: $(printf '%s\n' "$names" | grep -c .) container(s)"
  local pulled new_id
  pulled="$(docker pull "$WORKER_IMAGE" 2>&1)" || { finish false "could not pull $WORKER_IMAGE: $(printf '%s' "$pulled" | tail -c 300)"; return 0; }
  new_id="$(docker image inspect -f '{{.Id}}' "$WORKER_IMAGE" 2>/dev/null)"
  [ -n "$new_id" ] || { finish false "pulled $WORKER_IMAGE but cannot read its id"; return 0; }

  local work name line results="" failed=0
  work="$(mktemp -d)"
  # One board at a time is the rule of the owner; several containers on one board go one after another, stopping at the first that fails.
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    if line="$(update_one_worker "$name" "$new_id" "$work")"; then results="$results$line; "; else results="$results$line"; failed=1; break; fi
  done <<< "$names"

  rm -rf "$work"
  results="${results%; }"
  if [ "$failed" -eq 0 ]; then finish true "$results"; else finish false "$results"; fi
  log "worker decision $UPDATE_ID: ${results:0:300}"
  do_report || true
  return 0
}

do_apply() {
  local pending
  do_metrics || true
  pending="$(bridge GET "/api/v1/boards/agent/pending?host=$HOST")" || { log "bridge unreachable — nothing done"; return 0; }
  verify_self_update
  # A decision to update the worker comes first (it is rare and long); a scripts decision waiting beside it is taken by the next run.
  local worker_id
  worker_id="$(printf '%s' "$pending" | python3 -c '
import json, sys
update = (json.load(sys.stdin) or {}).get("workerUpdate")
print(update["id"] if update else "")
' 2>/dev/null)" || worker_id=""
  if [ -n "$worker_id" ]; then apply_worker_update "$worker_id"; return 0; fi
  # id, sha, then one repo path per line; nothing at all when there is no decision
  local parsed
  parsed="$(printf '%s' "$pending" | python3 -c '
import json, sys
update = json.load(sys.stdin).get("update")
if update:
    print(update["id"]); print(update["sha"])
    for path in update["repoPaths"]: print(path)
' 2>/dev/null)" || { log "unreadable answer of bridge — nothing done"; return 0; }
  [ -n "$parsed" ] || return 0

  UPDATE_ID="$(printf '%s\n' "$parsed" | sed -n 1p)"
  local sha paths
  sha="$(printf '%s\n' "$parsed" | sed -n 2p)"
  paths="$(printf '%s\n' "$parsed" | sed -n '3,$p')"
  log "decision $UPDATE_ID: $(printf '%s\n' "$paths" | grep -c .) script(s) at ${sha:0:7}"

  printf '%s' "$UPDATE_ID" | grep -qE '^[0-9]+$' || { log "bad decision id — nothing done"; return 0; }
  if ! printf '%s' "$sha" | grep -qE '^[0-9a-f]{40}$'; then finish false "commit is not a sha"; return 0; fi

  # The commit must be on main: GitHub says the branch is ahead of it ("behind") or at it ("identical").
  local state
  state="$(curl -fsS --max-time 30 "$GITHUB_API/repos/$OWNER/$REPO/compare/$BRANCH...$sha" 2>/dev/null | python3 -c 'import json, sys; print(json.load(sys.stdin).get("status", ""))' 2>/dev/null || true)"
  case "$state" in
    behind|identical) ;;
    "") finish false "could not check on GitHub that ${sha:0:7} is on $BRANCH — try again"; return 0 ;;
    *) finish false "commit ${sha:0:7} is not on $BRANCH ($state) — refused"; return 0 ;;
  esac

  # Every path is checked before anything is touched.
  local rp dest
  local plan=()
  while IFS= read -r rp; do
    [ -n "$rp" ] || continue
    if ! printf '%s' "$rp" | grep -qE '^infra/[A-Za-z0-9_./-]+$' || printf '%s' "$rp" | grep -q '\.\.'; then finish false "refused a path: $rp"; return 0; fi
    case "$rp" in
      infra/boardagent/board-agent.sh|infra/boardagent/manifest.txt) ;;
      infra/boardagent/*) finish false "refused: only the agent and its manifest can be updated from here ($rp)"; return 0 ;;
    esac
    dest="$(installed_path_of "$rp")" || { finish false "refused: $rp is not in this board's manifest"; return 0; }
    [ -f "$dest" ] || { log "$rp is not installed here — skipped"; continue; }
    plan+=("$rp|$dest")
  done <<< "$paths"
  [ "${#plan[@]}" -gt 0 ] || { finish true "nothing of it is installed on this board"; return 0; }

  # Fetch and check everything first.
  local work item new_files=() rc
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' RETURN
  for item in "${plan[@]}"; do
    rp="${item%%|*}"
    if ! curl -fsSL --max-time 60 "$RAW_HOST/$OWNER/$REPO/$sha/$rp" -o "$work/$(basename "$rp")" 2>/dev/null || [ ! -s "$work/$(basename "$rp")" ]; then
      finish false "could not fetch $rp at ${sha:0:7}"; return 0
    fi
    if head -1 "$work/$(basename "$rp")" | grep -qE '^#!.*(ba|z)?sh'; then
      bash -n "$work/$(basename "$rp")" 2> "$work/syntax" || { finish false "$rp does not pass bash -n: $(head -c 300 "$work/syntax")"; return 0; }
    fi
  done

  # Install, keeping the old files; any failure puts them all back.
  BACKUP="$STATE_DIR/backup/$UPDATE_ID"
  mkdir -p "$BACKUP" || { finish false "cannot write $STATE_DIR"; return 0; }
  DONE=()
  local changed=() unchanged=0 mode tmp base self_changed=()
  for item in "${plan[@]}"; do
    rp="${item%%|*}"; dest="${item#*|}"; base="$(basename "$rp")"
    if cmp -s "$work/$base" "$dest"; then unchanged=$((unchanged + 1)); continue; fi
    # The agent's own files go last, through update_self (self-check, kept copy, rollback).
    case "$rp" in infra/boardagent/*) self_changed+=("$rp"); continue ;; esac
    cp -p "$dest" "$BACKUP/$(basename "$dest")" || { restore; finish false "could not back up $dest"; return 0; }
    DONE+=("$dest|$rp")
    mode="$(stat -c %a "$dest" 2>/dev/null || stat -f %Lp "$dest" 2>/dev/null || echo 755)"
    tmp="$dest.new.$$"
    if ! cp "$work/$base" "$tmp" || ! chmod "$mode" "$tmp" || ! mv -f "$tmp" "$dest"; then rm -f "$tmp"; restore; finish false "could not install $dest — the old files are back"; return 0; fi
    if ! cmp -s "$work/$base" "$dest"; then restore; finish false "$dest differs from the fetched file after installing — the old files are back"; return 0; fi
    changed+=("$base")
  done

  local note=""
  if [ "${#self_changed[@]}" -gt 0 ]; then
    if ! update_self "$work" "${self_changed[@]}"; then
      # update_self reported its own failure; the other files of the decision stay installed (they were fine).
      return 0
    fi
    note="; the agent itself updated (${self_changed[*]##*/}), kept as agent-prev until its first run succeeds"
  fi

  finish true "${#changed[@]} installed (${changed[*]:-none}), $unchanged already current; commit ${sha:0:7}$note"
  log "applied decision $UPDATE_ID: ${#changed[@]} installed, $unchanged current$note"
  # Tell bridge the new state at once, so the board shows as current without waiting for the hourly report.
  do_report || true
  return 0
}

case "${1:-}" in
  report|apply|selftest) ;;
  *) echo "usage: board-agent.sh report|apply|selftest" >&2; exit 2 ;;
esac

need BRIDGE_API_URL
need BRIDGE_API_KEY
if [ "$1" = selftest ]; then do_selftest; exit $?; fi
mkdir -p "$STATE_DIR" 2>/dev/null || { log "cannot write $STATE_DIR — nothing done"; exit 0; }
# One lock per kind of run: the minute check must never make the hourly report skip itself (and a report never delays a decision).
exec 9>"$STATE_DIR/lock-$1"
flock -n 9 || { log "another $1 run is in progress"; exit 0; }

if [ "$1" = report ]; then do_report || true; else do_apply; fi
exit 0
