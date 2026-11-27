#!/usr/bin/env bash
#
# Tests for board-agent.sh with a fake curl (no network, nothing outside a temp directory):  bash infra/boardagent/test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'chmod -R u+w "$T" 2>/dev/null; rm -rf "$T"' EXIT
PASS=0; FAILED=0
mkdir -p "$T/bin" "$T/repo" "$T/board" "$T/calls"
export PATH="$T/bin:$PATH"

SHA="$(printf 'c823ea56%032d' 0)"

# One fake curl for everything the agent talks to: the bridge (answers from files, records what it was sent), GitHub's compare API and
# raw.githubusercontent.com (serves $FAKE_REPO/<sha>/<path>, or $FAKE_REPO/main/<path> for check-scripts.sh's comparison).
cat > "$T/bin/curl" <<'SH'
#!/usr/bin/env bash
out=""; url=""; method=GET; data=""; resolved=""
printf '%s\n' "$@" >> "$FAKE_ARGV"
while [ $# -gt 0 ]; do
  case "$1" in
    --resolve) resolved="$2"; shift 2 ;;
    -o) out="$2"; shift 2 ;;
    -X) method="$2"; shift 2 ;;
    -K) cat >> "$FAKE_STDIN"; shift 2 ;;
    --data) data="$2"; shift 2 ;;
    -H|--max-time) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
case "$url" in
  "$BRIDGE_API_URL"*)
    [ -z "${FAKE_BRIDGE_DOWN:-}" ] || exit 7
    # the LAN address does not answer: connection failure, but only when it is the pinned request
    [ -z "$resolved" ] || [ -z "${FAKE_RESOLVE_DOWN:-}" ] || exit 7
    case "${url#"$BRIDGE_API_URL"}" in /api/v1/boards/agent/metrics) [ -z "${FAKE_METRICS_FAIL:-}" ] || exit 22 ;; esac
    path="${url#"$BRIDGE_API_URL"}"
    case "$path" in
      /api/v1/boards/agent/pending*) cat "$FAKE_PENDING" ;;
      *) n=$(( $(ls "$FAKE_CALLS" | wc -l) + 1 )); printf '%s %s\n%s\n' "$method" "$path" "$data" > "$FAKE_CALLS/$n" ;;
    esac ;;
  "$GHCR_HOST"/token*) [ -z "${FAKE_GHCR_DOWN:-}" ] || exit 22; echo '{"token":"t"}' ;;
  "$GHCR_HOST"/v2/*/manifests/*) [ -z "${FAKE_GHCR_DOWN:-}" ] || exit 22; [ -n "${FAKE_LATEST:-}" ] || exit 22; printf 'HTTP/2 200\r\ndocker-content-digest: %s\r\n\r\n' "$FAKE_LATEST" ;;
  "$GITHUB_API"/repos/*/compare/*) printf '{"status": "%s"}' "$FAKE_COMPARE" ;;
  "$RAW_HOST"/*) path="${url#"$RAW_HOST"/*/*/}"; [ -f "$FAKE_REPO/$path" ] || exit 22; cp "$FAKE_REPO/$path" "$out" ;;
  *) path="${url#"$RAW_BASE"/}"; [ -f "$FAKE_REPO/main/$path" ] || exit 22; cp "$FAKE_REPO/main/$path" "$out" ;;
esac
SH
chmod +x "$T/bin/curl"
# the lock is the boards' flock; here nothing else runs
printf '#!/bin/sh\nexit 0\n' > "$T/bin/flock"; chmod +x "$T/bin/flock"

export METRICS_EVERY_SEC=0 BRIDGE_RESOLVE="" BRIDGE_API_URL="https://bridge.example" BRIDGE_API_KEY="brk_test" GITHUB_API="https://api.github.example" GHCR_HOST="https://ghcr.example" RAW_HOST="https://raw.example"
export RAW_BASE="https://raw.example/o/r/main" FAKE_REPO="$T/repo" FAKE_PENDING="$T/pending.json" FAKE_CALLS="$T/calls" FAKE_COMPARE=behind FAKE_ARGV="$T/argv" FAKE_STDIN="$T/stdin"
export STATE_DIR="$T/state" BOARD_HOST="ubuntu-red" BRIDGE_PI_DIR="$T/board/bridge-pi" MANIFEST_FILE="$T/manifest.txt"
export CHECK_SCRIPT="$HERE/../scriptcheck/check-scripts.sh" SCRIPTCHECK_MANIFEST="$T/manifest.txt" MAIN_SHA="$SHA" STATE_DIR_CHECK="$T/check-state"
export STATE_DIR="$T/state"

mkdir -p "$T/repo/$SHA/infra/backup" "$T/repo/$SHA/infra/notify" "$T/repo/main/infra/backup" "$T/repo/main/infra/notify" "$T/board/bridge-pi"
printf '#!/usr/bin/env bash\necho pull v2\n' > "$T/repo/$SHA/infra/backup/uploads-pull.sh"
printf '#!/usr/bin/env bash\necho backup v1\n' > "$T/repo/$SHA/infra/backup/backup.sh"
printf '#!/usr/bin/env bash\necho notify v2\n' > "$T/repo/$SHA/infra/notify/notify-telegram"
cp "$T/repo/$SHA/infra/backup/"* "$T/repo/main/infra/backup/"; cp "$T/repo/$SHA/infra/notify/"* "$T/repo/main/infra/notify/"
printf '%s|infra/backup/uploads-pull.sh\n%s|infra/backup/backup.sh\n%s|infra/notify/notify-telegram\n@BRIDGE_PI@/deploy.sh|infra/bridge-pi/deploy.sh\n%s|infra/backup/not-on-this-board.sh\n%s|infra/boardagent/board-agent.sh\n%s|infra/boardagent/manifest.txt\n' \
  "$T/board/uploads-pull.sh" "$T/board/backup.sh" "$T/board/notify-telegram" "$T/board/nothing.sh" "$T/board/agent.sh" "$T/board/manifest.txt" > "$T/manifest.txt"

board() { # what the board has: uploads-pull old, the others as in the repository
  printf '#!/usr/bin/env bash\necho pull v1\n' > "$T/board/uploads-pull.sh"; chmod 750 "$T/board/uploads-pull.sh"
  cp "$T/repo/$SHA/infra/backup/backup.sh" "$T/board/backup.sh"
  printf '#!/usr/bin/env bash\necho notify v1\n' > "$T/board/notify-telegram"; chmod 755 "$T/board/notify-telegram"
  printf '#!/usr/bin/env bash\necho agent\n' > "$T/board/agent.sh"
  printf 'old manifest\n' > "$T/board/manifest.txt"
}
decision() { # id path…
  local id="$1"; shift
  python3 -c 'import json, sys; print(json.dumps({"update": {"id": int(sys.argv[1]), "sha": sys.argv[2], "repoPaths": sys.argv[3:]}}))' "$id" "${DEC_SHA:-$SHA}" "$@" > "$T/pending.json"
}
agent() { bash "$HERE/board-agent.sh" "$@" > "$T/stdout" 2> "$T/stderr"; echo $? > "$T/code"; }
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/stdout" "$T/stderr"; fi; }
fresh() { rm -rf "$T/state" "$T/calls"; mkdir -p "$T/calls"; unset DEC_SHA; FAKE_COMPARE=behind; board; }
calls() { ls "$T/calls" | wc -l | tr -d ' '; }
last_result() { f="$(grep -l 'updates/.*/result' "$T"/calls/* | tail -1)"; sed -n 2p "$f"; }
board_has() { grep -q "$2" "$T/board/$1"; }

# ---- manifest: the same list as the one check-scripts.sh carries
python3 - "$HERE/../scriptcheck/check-scripts.sh" "$HERE/manifest.txt" <<'PY'
import re, sys
built_in = re.search(r"cat <<'LIST'\n(.*?)\nLIST", open(sys.argv[1]).read(), re.S).group(1).strip().splitlines()
mine = open(sys.argv[2]).read().strip().splitlines()
sys.exit(0 if built_in == mine else 1)
PY
check "the agent's manifest is the list check-scripts.sh compares" $?

# ---- report
fresh; agent report
[ "$(calls)" = 1 ] && grep -q 'POST /api/v1/boards/agent/report' "$T/calls/1"; check "report: posts to bridge" $?
# The board also reports its root disk and its SSH door; a probe that cannot be made is left out, never invented.
python3 - "$T/calls/1" <<'PY'
import json, sys
body = json.loads(open(sys.argv[1]).read().split("\n", 1)[1])
health = body.get("health")
assert isinstance(health, dict), health
used = health.get("diskUsedPct")
assert isinstance(used, int) and 0 <= used <= 100, health
assert isinstance(health.get("diskFreeMb"), int), health
assert isinstance(health.get("sshAuthorizedKeys"), int), health
assert isinstance(health.get("sshdActive"), bool), health
assert all(v is not None for v in health.values()), health
PY
check "report: carries the board's disk and ssh health" $?
python3 - "$T/calls/1" "$SHA" <<'PY'
import json, sys
body = json.loads(open(sys.argv[1]).read().split("\n", 1)[1])
scripts = {s["repoPath"]: s["status"] for s in body["scripts"]}
ok = (body["host"] == "ubuntu-red" and body["mainSha"] == sys.argv[2] and body["agentVersion"] == "7"
      and scripts == {"infra/backup/uploads-pull.sh": "outdated", "infra/backup/backup.sh": "current", "infra/notify/notify-telegram": "outdated"})
sys.exit(0 if ok else 1)
PY
check "…with the board's name, the commit and which scripts are outdated" $?

# the two kinds of run do not share a lock
fresh; echo '{"update": null}' > "$T/pending.json"; agent report; agent apply
[ -f "$T/state/lock-report" ] && [ -f "$T/state/lock-apply" ] && [ ! -e "$T/state/lock" ]; check "report and apply each have their own lock" $?

# ---- apply: nothing to do
fresh; echo '{"update": null}' > "$T/pending.json"; agent apply
[ "$(cat "$T/code")" = 0 ] && [ "$(calls)" = 0 ] && board_has uploads-pull.sh 'pull v1'; check "no decision: nothing is done and nothing is sent" $?

fresh; FAKE_BRIDGE_DOWN=1 agent apply; unset FAKE_BRIDGE_DOWN
[ "$(cat "$T/code")" = 0 ] && board_has uploads-pull.sh 'pull v1'; check "bridge unreachable: nothing is done" $?

# ---- apply: the happy path
fresh; decision 11 infra/backup/uploads-pull.sh infra/notify/notify-telegram; agent apply
board_has uploads-pull.sh 'pull v2' && board_has notify-telegram 'notify v2'; check "a decision installs the scripts it names" $?
[ "$(stat -c %a "$T/board/uploads-pull.sh" 2>/dev/null || stat -f %Lp "$T/board/uploads-pull.sh")" = 750 ]; check "…keeping the mode of the installed file" $?
[ -f "$T/state/backup/11/uploads-pull.sh" ] && grep -q 'pull v1' "$T/state/backup/11/uploads-pull.sh"; check "…and keeps the old file" $?
grep -q '"ok": true' <<< "$(last_result)" && grep -q '2 installed' <<< "$(last_result)"; check "…and tells bridge it worked" $?
grep -q 'POST /api/v1/boards/agent/report' "$T"/calls/*; check "…and reports the new state at once" $?

# ---- apply: unchanged / not installed here
fresh; decision 12 infra/backup/backup.sh; agent apply
grep -q '"ok": true' <<< "$(last_result)" && grep -q '1 already current' <<< "$(last_result)"; check "a script that is already current is left alone" $?

fresh; decision 13 infra/backup/not-on-this-board.sh; agent apply
grep -q '"ok": true' <<< "$(last_result)" && [ ! -e "$T/board/nothing.sh" ]; check "a script this board does not have is not created" $?

# ---- apply: what it refuses
fresh; FAKE_COMPARE=ahead; decision 14 infra/backup/uploads-pull.sh; agent apply
board_has uploads-pull.sh 'pull v1' && grep -q '"ok": false' <<< "$(last_result)" && grep -q 'not on main' <<< "$(last_result)"; check "refuses a commit that is not on main" $?

fresh; FAKE_COMPARE=diverged; decision 15 infra/backup/uploads-pull.sh; agent apply
board_has uploads-pull.sh 'pull v1'; check "…also a diverged one" $?

fresh; decision 16 infra/boardagent/rollback.sh; agent apply
grep -q 'only the agent and its manifest' <<< "$(last_result)"; check "refuses the rest of infra/boardagent (the installer and the rollback stay manual)" $?

fresh; decision 17 infra/backup/uploads-pull.sh infra/evil/other.sh; agent apply
board_has uploads-pull.sh 'pull v1' && grep -q 'not in this board' <<< "$(last_result)"; check "refuses a path outside its own manifest — and then changes nothing at all" $?

fresh; decision 18 'infra/../etc/passwd'; agent apply
grep -q 'refused a path' <<< "$(last_result)"; check "refuses a path that climbs out" $?

fresh; DEC_SHA=nothex decision 19 infra/backup/uploads-pull.sh; agent apply
board_has uploads-pull.sh 'pull v1' && grep -q 'not a sha' <<< "$(last_result)"; check "refuses a commit that is not a sha" $?

fresh; decision 20 infra/backup/uploads-pull.sh infra/notify/notify-telegram
printf '#!/usr/bin/env bash\nif then fi\n' > "$T/repo/$SHA/infra/notify/notify-telegram"; agent apply
board_has uploads-pull.sh 'pull v1' && board_has notify-telegram 'notify v1' && grep -q 'bash -n' <<< "$(last_result)"; check "a script that does not pass bash -n stops the whole decision before anything is replaced" $?
printf '#!/usr/bin/env bash\necho notify v2\n' > "$T/repo/$SHA/infra/notify/notify-telegram"

fresh; decision 21 infra/backup/uploads-pull.sh; rm -f "$T/repo/$SHA/infra/backup/uploads-pull.sh"; agent apply
board_has uploads-pull.sh 'pull v1' && grep -q 'could not fetch' <<< "$(last_result)"; check "a file that cannot be fetched at that commit changes nothing" $?
printf '#!/usr/bin/env bash\necho pull v2\n' > "$T/repo/$SHA/infra/backup/uploads-pull.sh"

# ---- the agent updates itself: checked first, old one kept, a marker until the new one has run
mkdir -p "$T/repo/$SHA/infra/boardagent"
new_agent() { # selftest result (ok|fail), marker text the new manifest must contain
  printf '#!/usr/bin/env bash\n[ "${1:-}" = selftest ] && { grep -q NEW-MANIFEST "$MANIFEST_FILE" || exit 3; [ "%s" = ok ] && { echo selftest ok; exit 0; }; echo "selftest: broken" >&2; exit 1; }\necho agent v2\n' "$1" > "$T/repo/$SHA/infra/boardagent/board-agent.sh"
  printf 'NEW-MANIFEST\n' > "$T/repo/$SHA/infra/boardagent/manifest.txt"
}

fresh; new_agent ok; decision 30 infra/boardagent/board-agent.sh infra/boardagent/manifest.txt; agent apply
board_has agent.sh 'agent v2' && board_has manifest.txt 'NEW-MANIFEST'; check "the agent and its manifest are replaced once the new pair passes its self-check (which saw the NEW manifest)" $?
grep -q 'echo agent' "$T/state/agent-prev/board-agent.sh" && grep -q 'old manifest' "$T/state/agent-prev/manifest.txt"; check "…the old pair is kept" $?
[ -f "$T/state/agent-update.pending" ] && grep -q '^30 ' "$T/state/agent-update.pending"; check "…a marker stays until the new agent has run" $?
grep -q '"ok": true' <<< "$(last_result)" && grep -q 'the agent itself updated' <<< "$(last_result)"; check "…and bridge is told the agent was updated" $?

echo '{"update": null}' > "$T/pending.json"; agent apply
[ ! -f "$T/state/agent-update.pending" ]; check "the first run that gets an answer from bridge removes the marker (the update is verified)" $?

fresh; new_agent fail; decision 31 infra/boardagent/board-agent.sh infra/boardagent/manifest.txt; agent apply
board_has agent.sh 'echo agent' && board_has manifest.txt 'old manifest' && [ ! -e "$T/state/agent-update.pending" ] && grep -q 'did not pass its own check' <<< "$(last_result)" && grep -q 'selftest: broken' <<< "$(last_result)"; check "a new agent that fails its self-check replaces nothing, and says why" $?

fresh; new_agent ok; printf '#!/usr/bin/env bash\nif then fi\n' > "$T/repo/$SHA/infra/boardagent/board-agent.sh"; decision 32 infra/boardagent/board-agent.sh; agent apply
board_has agent.sh 'echo agent' && grep -q 'bash -n' <<< "$(last_result)"; check "a new agent with a syntax error is refused before anything" $?

fresh; new_agent ok; decision 33 infra/backup/uploads-pull.sh infra/boardagent/board-agent.sh infra/boardagent/manifest.txt; agent apply
board_has uploads-pull.sh 'pull v2' && board_has agent.sh 'agent v2'; check "the other scripts of the decision are installed too, the agent last" $?

# the real self-check of this agent
fresh; echo '{"update": null}' > "$T/pending.json"; agent selftest
[ "$(cat "$T/code")" = 0 ] && grep -q 'selftest ok' "$T/stdout"; check "selftest: the agent as it is passes" $?
printf 'not a manifest line\n' > "$T/bad-manifest.txt"; MANIFEST_FILE="$T/bad-manifest.txt" agent selftest
[ "$(cat "$T/code")" != 0 ] && grep -q 'manifest is malformed' "$T/stderr"; check "selftest: a malformed manifest fails it" $?
echo 'not json' > "$T/pending.json"; agent selftest
[ "$(cat "$T/code")" != 0 ] && grep -q 'bridge does not answer' "$T/stderr"; check "selftest: a bridge that does not answer as expected fails it" $?
echo '{"update": null}' > "$T/pending.json"

# ---- rollback.sh: the previous agent comes back after a crashed first run
mkdir -p "$T/rb/state/agent-prev" "$T/rb/lib"
printf 'broken new agent\n' > "$T/rb/lib/board-agent.sh"; printf 'new manifest\n' > "$T/rb/lib/manifest.txt"
printf 'old agent\n' > "$T/rb/state/agent-prev/board-agent.sh"; printf 'old manifest\n' > "$T/rb/state/agent-prev/manifest.txt"
STATE_DIR="$T/rb/state" LIB="$T/rb/lib" "$HERE/rollback.sh" > "$T/stdout" 2> "$T/stderr"; echo $? > "$T/code"
[ "$(cat "$T/code")" = 0 ] && grep -q 'broken new agent' "$T/rb/lib/board-agent.sh" && grep -q 'new manifest' "$T/rb/lib/manifest.txt"; check "rollback.sh: without a marker (the agent ran fine) it does nothing" $?
echo "30 1" > "$T/rb/state/agent-update.pending"
ALERT_CMD="echo ALERTED" STATE_DIR="$T/rb/state" LIB="$T/rb/lib" "$HERE/rollback.sh" > "$T/stdout" 2> "$T/stderr"; echo $? > "$T/code"
[ "$(cat "$T/code")" = 0 ] && grep -q 'old agent' "$T/rb/lib/board-agent.sh" && grep -q 'old manifest' "$T/rb/lib/manifest.txt" && [ ! -e "$T/rb/state/agent-update.pending" ]; check "rollback.sh: with the marker it puts the old pair back and drops the marker" $?
grep -q 'ALERTED' "$T/stdout"; check "…and says so through ALERT_CMD" $?
echo "31 1" > "$T/rb/state/agent-update.pending"; rm -rf "$T/rb/state/agent-prev"
STATE_DIR="$T/rb/state" LIB="$T/rb/lib" "$HERE/rollback.sh" > "$T/stdout" 2> "$T/stderr"; echo $? > "$T/code"
[ "$(cat "$T/code")" = 1 ] && grep -q 'was not kept' "$T/stderr"; check "rollback.sh: with no kept copy it says so instead of guessing" $?

# ---- apply: a failure half-way puts the first file back
if [ "$(id -u)" != 0 ]; then
  fresh; mkdir -p "$T/board/ro"; printf '#!/usr/bin/env bash\necho notify v1\n' > "$T/board/ro/notify-telegram"; chmod 755 "$T/board/ro/notify-telegram"
  sed -i.bak "s#$T/board/notify-telegram#$T/board/ro/notify-telegram#" "$T/manifest.txt"
  decision 22 infra/backup/uploads-pull.sh infra/notify/notify-telegram
  chmod 555 "$T/board/ro"; agent apply; chmod 755 "$T/board/ro"
  board_has uploads-pull.sh 'pull v1' && board_has ro/notify-telegram 'notify v1' && grep -q '"ok": false' <<< "$(last_result)"; check "a failure half-way puts the files already replaced back" $?
else
  echo "skip a failure half-way (running as root)"
fi

# ---- the bridge key never appears on curl's command line, only in the config on its stdin
fresh; : > "$T/argv"; : > "$T/stdin"; decision 40 infra/backup/uploads-pull.sh; agent apply
[ -s "$T/argv" ] && ! grep -q 'brk_test' "$T/argv" && ! grep -qi 'authorization: bearer brk' "$T/argv" && grep -q 'Authorization: Bearer brk_test' "$T/stdin"; check "apply: the bridge key is on curl's stdin, not in its argv" $?
: > "$T/argv"; : > "$T/stdin"; agent selftest
! grep -q 'brk_test' "$T/argv" && grep -q 'Authorization: Bearer brk_test' "$T/stdin"; check "selftest: the bridge key is on curl's stdin, not in its argv" $?

# ---- the vital signs
echo "# metrics"
mkdir -p "$T/sys/hwmon0" "$T/sys/nvme0"
echo 52300 > "$T/sys/thermal"
echo "1.37 0.80 0.50 1/300 1234" > "$T/sys/loadavg"
printf 'MemTotal:        8000000 kB\nMemFree:          100000 kB\nMemAvailable:    6000000 kB\n' > "$T/sys/meminfo"
echo "86400.55 12345.00" > "$T/sys/uptime"
echo 4200 > "$T/sys/hwmon0/fan1_input"
echo 41850 > "$T/sys/nvme0/temp1_input"
printf '#!/usr/bin/env bash\necho "throttled=0x50005"\n' > "$T/bin/vcgencmd"; chmod +x "$T/bin/vcgencmd"
export THERMAL_FILE="$T/sys/thermal" LOADAVG_FILE="$T/sys/loadavg" MEMINFO_FILE="$T/sys/meminfo" UPTIME_FILE="$T/sys/uptime" \
  HWMON_GLOB="$T/sys/hwmon0/fan1_input" NVME_GLOB="$T/sys/nvme0/temp1_input"
echo '{"update": null}' > "$T/pending.json"
metrics_call() { grep -l 'POST /api/v1/boards/agent/metrics' "$T"/calls/* 2>/dev/null | head -1; }

fresh; METRICS_EVERY_SEC=120 agent apply
f="$(metrics_call)"; [ -n "$f" ]; check "metrics: apply posts the vital signs to bridge" $?
python3 - "$f" <<'PY'
import json, sys
body = json.loads(open(sys.argv[1]).read().split("\n", 1)[1])
want = {"host": "ubuntu-red", "socTempC": 52, "throttled": 5, "fanRpm": 4200, "nvmeTempC": 42, "load1": 1.37, "memAvailPct": 75, "memTotalMb": 7812, "uptimeSec": 86400}
bad = {k: (body.get(k), v) for k, v in want.items() if body.get(k) != v}
disk = body.get("diskUsedPct")
sys.exit(0 if not bad and isinstance(disk, int) and 0 <= disk <= 100 else 1)
PY
check "metrics: temperature, the low throttling bits, fan, NVMe, load, memory, disk and uptime are read" $?

n="$(calls)"; METRICS_EVERY_SEC=120 agent apply
[ "$(calls)" = "$n" ]; check "metrics: a run a minute later does not post again (every 2 minutes)" $?
echo $(( $(date +%s) - 125 )) > "$T/state/metrics-last"; METRICS_EVERY_SEC=120 agent apply
[ "$(calls)" -gt "$n" ]; check "metrics: after the interval it posts again" $?

fresh; METRICS_EVERY_SEC=0 agent apply
[ -z "$(metrics_call)" ]; check "metrics: METRICS_EVERY_SEC=0 turns them off" $?

echo "# metrics: a missing probe is left out, never guessed"
fresh; HWMON_GLOB="$T/nowhere/*" NVME_GLOB="$T/nowhere/*" THERMAL_FILE="$T/nowhere" MEMINFO_FILE="$T/nowhere" METRICS_EVERY_SEC=120 agent apply
f="$(metrics_call)"
python3 - "$f" <<'PY'
import json, sys
body = json.loads(open(sys.argv[1]).read().split("\n", 1)[1])
sys.exit(0 if body["host"] == "ubuntu-red" and not {"socTempC", "fanRpm", "nvmeTempC", "memAvailPct"} & set(body) and body.get("throttled") == 5 else 1)
PY
check "metrics: fields without a source are absent, the others still go" $?

echo "# metrics never get in the way of a decision"
fresh; decision 7 infra/backup/uploads-pull.sh
FAKE_METRICS_FAIL=1 METRICS_EVERY_SEC=120 agent apply
[ "$(cat "$T/code")" = 0 ] && board_has uploads-pull.sh "pull v2" && [ -z "$(metrics_call)" ]; check "metrics: bridge refusing them does not stop an update from being applied" $?
[ -s "$T/state/metrics-last" ]; check "metrics: the attempt is what is rate-limited, so a refusing bridge is not hammered" $?
echo '{"update": null}' > "$T/pending.json"

echo "# the reliable way to bridge: the LAN address first, the ordinary way when it does not answer"
fresh; : > "$T/argv"; BRIDGE_RESOLVE=api.bridge.ntlstl.dev:443:192.0.2.10 agent report
grep -qx -- '--resolve' "$T/argv" && grep -qx 'api.bridge.ntlstl.dev:443:192.0.2.10' "$T/argv" && [ "$(calls)" = 1 ]; check "resolve: a request goes to the pinned address first" $?
fresh; : > "$T/argv"; FAKE_RESOLVE_DOWN=1 BRIDGE_RESOLVE=api.bridge.ntlstl.dev:443:192.0.2.10 agent report
[ "$(calls)" = 1 ] && [ "$(grep -cx -- '--resolve' "$T/argv")" = 1 ]; check "resolve: when that address cannot be reached the request is repeated the ordinary way (and delivered once)" $?
fresh; : > "$T/argv"; FAKE_METRICS_FAIL=1 BRIDGE_RESOLVE=api.bridge.ntlstl.dev:443:192.0.2.10 METRICS_EVERY_SEC=120 agent apply
[ "$(grep -c 'agent/metrics' "$T/argv")" = 1 ]; check "resolve: an answer of 4xx/5xx is not a reason to send the request a second time" $?
fresh; : > "$T/argv"; BRIDGE_RESOLVE= agent report
! grep -qx -- '--resolve' "$T/argv"; check "resolve: BRIDGE_RESOLVE= (empty) turns the pinning off" $?

# ---- «update the worker»: a fake docker that keeps its containers in $FD/state.json and writes every command to $FD/log
FD="$T/docker"; mkdir -p "$FD"
cat > "$T/bin/docker" <<'PY'
#!/usr/bin/env python3
import json, os, sys
fd = os.environ["FAKE_DOCKER"]
state_path = os.path.join(fd, "state.json")
state = json.load(open(state_path)) if os.path.exists(state_path) else {"containers": {}, "images": {}, "pull_id": "sha256:new", "worker_image": "ghcr.io/bmazurme/pipe-worker:stable"}
def save(): json.dump(state, open(state_path, "w"))
with open(os.path.join(fd, "log"), "a") as log: log.write(" ".join(sys.argv[1:]) + "\n")
a = sys.argv[1:]
def fmt(template, c):
    r = template
    for k, v in {"{{.Name}}": c["inspect"]["Name"], "{{.Config.Image}}": c["inspect"]["Config"]["Image"],
                 "{{.State.Running}}": str(c["running"]).lower(), "{{.Image}}": c["inspect"]["Image"],
                 "{{.Config.StopTimeout}}": str(c["inspect"]["Config"].get("StopTimeout", "<nil>")),
                 "{{.RestartCount}}": str(c.get("restarts", 0)),
                 "{{.State.StartedAt}}": c.get("started", "2026-11-27T01:00:00.123456789Z"),
                 "{{.State.OOMKilled}}": str(c.get("oom", False)).lower()}.items():
        r = r.replace(k, v)
    return r
if a[:1] == ["ps"]:
    print("\n".join(state["containers"])); sys.exit(0)
if a[:1] == ["inspect"]:
    rest = a[1:]; f = None
    if rest[:1] == ["-f"]: f, rest = rest[1], rest[2:]
    c = state["containers"].get(rest[0])
    if c is None: sys.exit(1)
    print(fmt(f, c) if f else json.dumps([c["inspect"]])); sys.exit(0)
if a[:2] == ["image", "inspect"]:
    ref = a[-1]
    if "{{.Id}}" in a: print(state["pull_id"]); sys.exit(0)
    if any("RepoDigests" in x for x in a):
        for d in state["images"].get(ref, {}).get("digests", []): print(d)
        sys.exit(0)
    print(json.dumps(state["images"].get(ref, {}).get("env", []))); sys.exit(0)
if a[:1] == ["pull"]:
    if state.get("pull_fail"): print("pull access denied", file=sys.stderr); sys.exit(1)
    print("pulled"); sys.exit(0)
if a[:1] == ["stop"]:
    state["containers"][a[-1]]["running"] = False; save(); sys.exit(0)
if a[:1] == ["start"]:
    state["containers"][a[-1]]["running"] = True; save(); sys.exit(0)
if a[:1] == ["rename"]:
    c = state["containers"].pop(a[1]); c["inspect"]["Name"] = "/" + a[2]; state["containers"][a[2]] = c; save(); sys.exit(0)
if a[:1] == ["rm"]:
    state["containers"].pop(a[-1], None); save(); sys.exit(0)
if a[:1] == ["tag"]: sys.exit(0)
if a[:1] == ["logs"]: print("boom: cannot start"); sys.exit(0)
if a[:1] == ["run"]:
    if state.get("run_fails"): print("docker: error", file=sys.stderr); sys.exit(125)
    name = a[a.index("--name") + 1]
    template = json.loads(json.dumps(state["template"]))
    template["Name"] = "/" + name; template["Image"] = state["pull_id"]
    state["containers"][name] = {"inspect": template, "running": not state.get("run_crashes")}
    save(); print("newid"); sys.exit(0)
sys.exit(0)
PY
chmod +x "$T/bin/docker"
export FAKE_DOCKER="$FD"

# EXTRA_HOSTCONFIG / EXTRA_MOUNTS (JSON) add to the container's HostConfig and Mounts — for the hardening cases.
worker_inspect() { # name image-in-config bind-mount(0|1) → the inspect JSON of a worker container
  python3 - "$1" "$2" "$3" <<'PY'
import json, os, sys
name, image, bind = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
host = {"RestartPolicy": {"Name": "unless-stopped"}, "NanoCpus": 2000000000, "Memory": 4294967296, "CpuShares": 512, "NetworkMode": "bridge"}
host.update(json.loads(os.environ.get("EXTRA_HOSTCONFIG") or "{}"))
mounts = [{"Type": "bind", "Source": "/etc", "Destination": "/etc"} if bind else {"Type": "volume", "Name": name + "-state", "Destination": "/app/.worker-state", "RW": True}]
mounts += json.loads(os.environ.get("EXTRA_MOUNTS") or "[]")
print(json.dumps({"Name": "/" + name, "Image": "sha256:old",
  "Config": {"Image": image, "StopTimeout": 900, "Env": ["PATH=/usr/bin", "NODE_VERSION=22", "BRIDGE_API_URL=https://api.bridge.ntlstl.dev", "WORKER_SHUTDOWN_GRACE_SEC=840"]},
  "HostConfig": host, "Mounts": mounts}))
PY
}
docker_world() { # name [image] [bind] [extra state key=value…]  — one worker container on the board
  local name="$1" image="${2:-ghcr.io/bmazurme/pipe-worker:stable}" bind="${3:-0}"
  rm -rf "$FD"; mkdir -p "$FD"
  python3 - "$FD/state.json" "$name" "$(worker_inspect "$name" "$image" "$bind")" <<'PY'
import json, sys
path, name, inspect = sys.argv[1:]
inspect = json.loads(inspect)
json.dump({"containers": {name: {"inspect": inspect, "running": True}} if name else {},
           "images": {"sha256:old": {"env": ["PATH=/usr/bin", "NODE_VERSION=22"]}},
           "pull_id": "sha256:new", "worker_image": "ghcr.io/bmazurme/pipe-worker:stable", "template": inspect}, open(path, "w"))
PY
}
docker_state() { python3 -c 'import json, sys; print(json.dumps(json.load(open(sys.argv[1]))["containers"]))' "$FD/state.json"; }
docker_set() { python3 - "$FD/state.json" "$1" "$2" <<'PY'
import json, sys
path, key, value = sys.argv[1:]
s = json.load(open(path)); s[key] = value == "true"; json.dump(s, open(path, "w"))
PY
}
worker_decision() { printf '{"update": null, "workerUpdate": {"id": %s}}' "$1" > "$T/pending.json"; }
export WORKER_STAY_UP_SEC=2 WORKER_POLL_SEC=1

echo "# the worker containers on a board are reported, so bridge knows where «Обновить worker» applies"
fresh; docker_world pipe-worker-pi-red; echo '{"update": null}' > "$T/pending.json"; agent report
python3 - "$T/calls/1" <<'PY'
import json, sys
body = json.loads(open(sys.argv[1]).read().split("\n", 1)[1])
sys.exit(0 if body["health"].get("workers") == [{"name": "pipe-worker-pi-red", "image": "ghcr.io/bmazurme/pipe-worker:stable", "running": True, "oomKilled": False, "restartCount": 0, "startedAt": "2026-11-27T01:00:00.123456789Z"}] else 1)
PY
check "report: lists the board's worker containers with their image and state" $?

echo "# R2: which release a worker container runs, and which one stable is now"
digest_world() { # container's digest ('' = none)
  docker_world pipe-worker-pi-red
  python3 - "$FD/state.json" "$1" <<'PY'
import json, sys
path, digest = sys.argv[1:]
s = json.load(open(path))
s["images"]["sha256:old"]["digests"] = ["ghcr.io/bmazurme/pipe-worker@" + digest, "other.example/x@sha256:" + "9" * 64] if digest else []
json.dump(s, open(path, "w"))
PY
}
D1="sha256:$(printf '1%.0s' $(seq 64))"; D2="sha256:$(printf '2%.0s' $(seq 64))"
health_field() { python3 - "$T/calls/1" "$1" <<'PY'
import json, sys
body = json.loads(open(sys.argv[1]).read().split("\n", 1)[1])
h = body["health"]
key = sys.argv[2]
if key == "digest": print((h.get("workers") or [{}])[0].get("digest", "-"))
else: print(h.get(key, "-"))
PY
}
fresh; digest_world "$D1"; echo '{"update": null}' > "$T/pending.json"; FAKE_LATEST="$D2" agent report
[ "$(health_field digest)" = "$D1" ]; check "digest: the worker container's release is reported (the manifest-list digest of ITS repository)" $?
[ "$(health_field workerImageLatest)" = "$D2" ]; check "digest: what stable is now is reported next to it" $?
fresh; digest_world ""; echo '{"update": null}' > "$T/pending.json"; FAKE_LATEST="$D2" agent report
[ "$(health_field digest)" = "-" ]; check "digest: a container whose image was not pulled from the registry says nothing (no guess)" $?
fresh; digest_world "$D1"; echo '{"update": null}' > "$T/pending.json"; FAKE_GHCR_DOWN=1 FAKE_LATEST="$D2" agent report
[ "$(health_field workerImageLatest)" = "-" ] && [ "$(health_field digest)" = "$D1" ]; check "digest: a registry that does not answer leaves out the latest, and the report still goes" $?
[ "$(cat "$T/code")" = 0 ]; check "digest: ...with exit 0" $?
fresh; rm -rf "$FD"; mkdir -p "$FD"; echo '{"update": null}' > "$T/pending.json"; FAKE_LATEST="$D2" agent report
[ "$(health_field workerImageLatest)" = "-" ]; check "digest: a board with no worker container does not ask the registry at all" $?

echo "# S1(3): the agent says whether the worker egress filter is in place (so a missing or flushed one shows on the «Дрейф» tile)"
egress_reported() { python3 - "$T/calls/1" "$1" <<'PY'
import json, sys
body = json.loads(open(sys.argv[1]).read().split("\n", 1)[1])
want = {"true": True, "false": False, "absent": None}[sys.argv[2]]
sys.exit(0 if body["health"].get("workerEgress", None) is want else 1)
PY
}
cat > "$T/egress-ok" <<'SH'
#!/usr/bin/env bash
[ "$1" = check ] && exit 0
SH
cat > "$T/egress-no" <<'SH'
#!/usr/bin/env bash
exit 1
SH
chmod +x "$T/egress-ok" "$T/egress-no"
fresh; docker_world pipe-worker-pi-red; echo '{"update": null}' > "$T/pending.json"; EGRESS_SCRIPT="$T/egress-ok" agent report
egress_reported true; check "egress: reported as in place when the script's check says so" $?
fresh; docker_world pipe-worker-pi-red; echo '{"update": null}' > "$T/pending.json"; EGRESS_SCRIPT="$T/egress-no" agent report
egress_reported false; check "egress: reported as NOT in place when the check fails" $?
fresh; docker_world pipe-worker-pi-red; echo '{"update": null}' > "$T/pending.json"; EGRESS_SCRIPT="$T/nonexistent" agent report
egress_reported false; check "egress: reported as NOT in place when the filter is not installed at all" $?
fresh; rm -rf "$FD"; mkdir -p "$FD"; EGRESS_SCRIPT="$T/egress-no" agent report
egress_reported absent; check "egress: nothing said on a board with no worker container (it has no filter to miss)" $?
fresh; rm -rf "$FD"; mkdir -p "$FD"; agent report
python3 - "$T/calls/1" <<'PY'
import json, sys
body = json.loads(open(sys.argv[1]).read().split("\n", 1)[1])
sys.exit(0 if "workers" not in body["health"] else 1)
PY
check "report: a board with no worker container reports none" $?
fresh; docker_world "old-pipe-worker-pi-red"; agent report
python3 - "$T/calls/1" <<'PY'
import json, sys
body = json.loads(open(sys.argv[1]).read().split("\n", 1)[1])
sys.exit(0 if "workers" not in body["health"] else 1)
PY
check "report: the container an update sets aside (old-pipe-worker-pi-…) is not taken for a worker" $?

echo "# update the worker: the happy path"
fresh; docker_world pipe-worker-pi-red; worker_decision 21; agent apply
grep -q '"ok": true' <<< "$(last_result)" && grep -q 'updated' <<< "$(last_result)"; check "worker: pulls the image, recreates the container and tells bridge it worked" $?
run="$(grep '^run ' "$FD/log")"
grep -q -- '--name pipe-worker-pi-red' <<< "$run" && grep -q -- '--restart unless-stopped' <<< "$run" && grep -q -- '--stop-timeout 900' <<< "$run" \
  && grep -q -- '--cpus 2 ' <<< "$run" && grep -q -- '--memory 4294967296' <<< "$run" && grep -q -- '--cpu-shares 512' <<< "$run" \
  && grep -q -- '-v pipe-worker-pi-red-state:/app/.worker-state' <<< "$run" && grep -q -- '-e BRIDGE_API_URL=https://api.bridge.ntlstl.dev' <<< "$run" \
  && grep -q -- '-e WORKER_SHUTDOWN_GRACE_SEC=840' <<< "$run" && grep -q 'ghcr.io/bmazurme/pipe-worker:stable$' <<< "$run"; check "worker: the new container gets the same settings, read back from the old one" $?
! grep -q 'NODE_VERSION\|PATH=' <<< "$run"; check "worker: what the image itself sets is not copied over" $?
grep -q '^stop -t 900 pipe-worker-pi-red' "$FD/log"; check "worker: the old one is stopped gracefully, with its own timeout" $?
python3 - "$FD/state.json" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))["containers"]
sys.exit(0 if list(c) == ["pipe-worker-pi-red"] and c["pipe-worker-pi-red"]["running"] and c["pipe-worker-pi-red"]["inspect"]["Image"] == "sha256:new" else 1)
PY
check "worker: only the new container is left, running" $?
grep -q 'POST /api/v1/boards/agent/report' "$T"/calls/*; check "worker: the new state is reported at once" $?
! grep -q 'updates/.*/result' "$T"/calls/* || grep -q 'agent/updates/21/result' "$T"/calls/*; check "worker: the result goes to the decision that asked for it" $?

echo "# update the worker: when it is not needed or not safe"
fresh; docker_world pipe-worker-pi-red; python3 - "$FD/state.json" <<'PY'
import json, sys
s = json.load(open(sys.argv[1])); s["pull_id"] = "sha256:old"; json.dump(s, open(sys.argv[1], "w"))
PY
worker_decision 22; agent apply
grep -q '"ok": true' <<< "$(last_result)" && grep -q 'already on the current image' <<< "$(last_result)" && ! grep -q '^stop \|^run ' "$FD/log"; check "worker: already on the current image — nothing is stopped or started" $?

fresh; docker_world pipe-worker-pi-red; docker_set run_crashes true; worker_decision 23; agent apply
python3 - "$FD/state.json" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))["containers"]
ok = list(c) == ["pipe-worker-pi-red"] and c["pipe-worker-pi-red"]["running"] and c["pipe-worker-pi-red"]["inspect"]["Image"] == "sha256:old"
sys.exit(0 if ok else 1)
PY
check "worker: a new container that does not stay up is thrown away and the old one is back, running" $?
grep -q '"ok": false' <<< "$(last_result)" && grep -q 'did not stay up' <<< "$(last_result)"; check "worker: …and bridge is told it failed, with why" $?

fresh; docker_world pipe-worker-pi-red; docker_set run_fails true; worker_decision 24; agent apply
python3 - "$FD/state.json" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))["containers"]
sys.exit(0 if list(c) == ["pipe-worker-pi-red"] and c["pipe-worker-pi-red"]["running"] else 1)
PY
check "worker: when docker run itself fails the old container is restored" $?

fresh; docker_world pipe-worker-pi-red "nginx:latest"; worker_decision 25; agent apply
grep -q '"ok": false' <<< "$(last_result)" && grep -q 'refused' <<< "$(last_result)" && ! grep -q '^stop ' "$FD/log"; check "worker: a container on some other image is refused, not touched" $?

fresh; docker_world pipe-worker-pi-red "ghcr.io/bmazurme/pipe-worker:stable" 1; worker_decision 26; agent apply
grep -q '"ok": false' <<< "$(last_result)" && grep -q 'bind mount' <<< "$(last_result)" && ! grep -q '^stop ' "$FD/log"; check "worker: a container with a bind mount is refused (it will not guess), and not stopped" $?

fresh; docker_world ""; worker_decision 27; agent apply
grep -q '"ok": false' <<< "$(last_result)" && grep -q 'no worker container' <<< "$(last_result)"; check "worker: a board with no worker container says so" $?

fresh; docker_world pipe-worker-pi-red; docker_set pull_fail true; worker_decision 28; agent apply
grep -q '"ok": false' <<< "$(last_result)" && grep -q 'could not pull' <<< "$(last_result)" && ! grep -q '^stop ' "$FD/log"; check "worker: an image that cannot be pulled leaves the running worker alone" $?

fresh; docker_world pipe-worker-pi-red; echo '{"update": null, "workerUpdate": null}' > "$T/pending.json"; agent apply
[ "$(calls)" = 0 ] && ! grep -q '^pull \|^stop \|^run ' "$FD/log" 2>/dev/null; check "worker: no decision, no docker commands" $?
fresh; docker_world pipe-worker-pi-red; printf '{"update": null, "workerUpdate": {"id": "1; rm -rf /"}}' > "$T/pending.json"; agent apply
! grep -q '^pull \|^stop \|^run ' "$FD/log" 2>/dev/null; check "worker: a decision id that is not a number is not acted on" $?


echo "# update the worker: container hardening (S1)"
HARD_HC='{"CapDrop":["ALL"],"CapAdd":["SETUID","SETGID","SETPCAP"],"SecurityOpt":["no-new-privileges"],"ReadonlyRootfs":true,"Tmpfs":{"/tmp":"rw,nosuid,nodev,size=128m","/home/pipe-runner":"rw,nosuid,nodev,uid=101,gid=102,mode=0700,size=384m"}}'
HARD_MOUNTS='[{"Type":"volume","Name":"pipe-worker-pi-red-work","Destination":"/app/.worker-work","RW":true},{"Type":"tmpfs","Destination":"/tmp"},{"Type":"tmpfs","Destination":"/home/pipe-runner"}]'
count() { grep -o -e "$1" <<< "$run" | wc -l | tr -d ' '; }

fresh; EXTRA_HOSTCONFIG="$HARD_HC" EXTRA_MOUNTS="$HARD_MOUNTS" docker_world pipe-worker-pi-red; worker_decision 30; agent apply
run="$(grep '^run ' "$FD/log")"
grep -q '"ok": true' <<< "$(last_result)"; check "hardening: an already hardened container is recreated, not refused" $?
grep -q -- '--cap-drop ALL' <<< "$run" && grep -q -- '--cap-add SETUID' <<< "$run" && grep -q -- '--cap-add SETGID' <<< "$run" && grep -q -- '--cap-add SETPCAP' <<< "$run" \
  && grep -q -- '--security-opt no-new-privileges' <<< "$run" && grep -q -- '--read-only' <<< "$run" \
  && grep -q -- '--tmpfs /tmp:rw,nosuid,nodev,size=128m' <<< "$run" && grep -q -- '--tmpfs /home/pipe-runner:rw,nosuid,nodev,uid=101,gid=102,mode=0700,size=384m' <<< "$run" \
  && grep -q -- '-v pipe-worker-pi-red-work:/app/.worker-work' <<< "$run"; check "hardening: every flag, tmpfs and volume of the old container is carried over" $?
grep -q 'hardened' <<< "$(last_result)"; check "hardening: the result says the worker is hardened" $?

fresh; docker_world pipe-worker-pi-red; worker_decision 31; agent apply
run="$(grep '^run ' "$FD/log")"
! grep -q -- '--read-only\|--cap-drop\|--tmpfs\|no-new-privileges' <<< "$run" && ! grep -q 'hardened' <<< "$(last_result)"; check "hardening: off by default — a plain container stays plain" $?

fresh; docker_world pipe-worker-pi-red; worker_decision 32; WORKER_HARDEN=1 agent apply
run="$(grep '^run ' "$FD/log")"
grep -q -- '--cap-drop ALL' <<< "$run" && grep -q -- '--cap-add SETUID' <<< "$run" && grep -q -- '--cap-add SETGID' <<< "$run" && grep -q -- '--cap-add SETPCAP' <<< "$run" \
  && grep -q -- '--security-opt no-new-privileges' <<< "$run" && grep -q -- '--read-only' <<< "$run" \
  && grep -q -- '--tmpfs /tmp:rw,nosuid,nodev,size=128m' <<< "$run" && grep -q -- '--tmpfs /home/pipe-runner:rw,nosuid,nodev,uid=101,gid=102,mode=0700,size=384m' <<< "$run"; check "hardening: WORKER_HARDEN=1 adds the whole set to a plain container" $?
grep -q -- '-v pipe-worker-pi-red-work:/app/.worker-work' <<< "$run" && grep -q -- '-v pipe-worker-pi-red-state:/app/.worker-state' <<< "$run"; check "hardening: …and a volume for the work directory, next to the state one" $?
grep -q 'hardened' <<< "$(last_result)"; check "hardening: …and says so" $?

fresh; EXTRA_HOSTCONFIG="$HARD_HC" EXTRA_MOUNTS="$HARD_MOUNTS" docker_world pipe-worker-pi-red; worker_decision 33; WORKER_HARDEN=1 agent apply
run="$(grep '^run ' "$FD/log")"
[ "$(count '--read-only')" = 1 ] && [ "$(count '--cap-add SETUID')" = 1 ] && [ "$(count '--cap-drop ALL')" = 1 ] && [ "$(count '--tmpfs /tmp')" = 1 ] \
  && [ "$(count 'app/.worker-work')" = 1 ]; check "hardening: on a container that already has it, nothing is doubled" $?

fresh; WORKER_HARDEN=1 EXTRA_HOSTCONFIG='{"WORKER":0}' docker_world pipe-worker-pi-red; worker_decision 34; WORKER_HARDEN=1 WORKER_HARDEN_TMP_SIZE=64m WORKER_HARDEN_HOME_SIZE=200m agent apply
run="$(grep '^run ' "$FD/log")"
grep -q -- '--tmpfs /tmp:rw,nosuid,nodev,size=64m' <<< "$run" && grep -q 'size=200m' <<< "$run"; check "hardening: the tmpfs sizes can be set for the board" $?

echo "# update the worker: what it still refuses"
for case in \
  'CapAdd SYS_ADMIN|{"CapAdd":["SYS_ADMIN"]}|adds capabilities' \
  'CapAdd NET_ADMIN beside the allowed ones|{"CapAdd":["SETUID","NET_ADMIN"]}|adds capabilities' \
  'a custom seccomp profile|{"SecurityOpt":["seccomp=unconfined"]}|security option' \
  'apparmor unconfined|{"SecurityOpt":["apparmor=unconfined"]}|security option' \
  'a tmpfs at /data|{"Tmpfs":{"/data":"rw"}}|tmpfs at /data' \
  'a tmpfs with exec tricks in its options|{"Tmpfs":{"/tmp":"rw;rm -rf /"}}|options it will not copy' \
  'a privileged container|{"Privileged":true}|privileged'; do
  desc="${case%%|*}"; rest="${case#*|}"; hc="${rest%%|*}"; why="${rest#*|}"
  fresh; EXTRA_HOSTCONFIG="$hc" docker_world pipe-worker-pi-red; worker_decision 40; agent apply
  grep -q '"ok": false' <<< "$(last_result)" && grep -q "$why" <<< "$(last_result)" && ! grep -q '^stop ' "$FD/log"; check "hardening: $desc is refused, and the worker is left running" $?
done

fresh; EXTRA_HOSTCONFIG='{"CapAdd":["CAP_SETUID"],"SecurityOpt":["no-new-privileges:true"]}' docker_world pipe-worker-pi-red; worker_decision 41; agent apply
run="$(grep '^run ' "$FD/log")"
grep -q '"ok": true' <<< "$(last_result)" && grep -q -- '--cap-add SETUID' <<< "$run" && grep -q -- '--security-opt no-new-privileges' <<< "$run"; check "hardening: the CAP_ prefix and no-new-privileges:true are understood" $?


echo
echo "passed $PASS, failed $FAILED"
[ "$FAILED" -eq 0 ]
