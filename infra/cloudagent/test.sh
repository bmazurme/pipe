#!/usr/bin/env bash
#
# Tests for collect.py, report.sh and install.sh with fake docker / curl / ss / openssl and a fake /proc — nothing is touched:
#   bash infra/cloudagent/test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0; BIN="$T/bin"; FIX="$T/fix"; PROCD="$T/proc"; mkdir -p "$BIN" "$FIX" "$PROCD"
export PATH="$BIN:$PATH" FIX PROC_DIR="$PROCD"
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/out" 2>/dev/null | head -14; fi; }
reset() { rm -rf "${FIX:?}"/*; : > "$T/out"; }

printf 'MemTotal:        2010000 kB\nMemFree:           94000 kB\nMemAvailable:     620000 kB\nSwapTotal:       2097152 kB\nSwapFree:        2000000 kB\n' > "$PROCD/meminfo"
printf '0.10 0.42 0.30 1/200 999\n' > "$PROCD/loadavg"
printf '432000.55 800000.00\n' > "$PROCD/uptime"

cat > "$BIN/docker" <<'SH'
#!/usr/bin/env bash
case "$1 $2" in
  "service ls") [ -f "$FIX/docker_down" ] && exit 1; cat "$FIX/service_ls" ;;
  "service ps") cat "$FIX/ps_$3" 2>/dev/null ;;
  "ps -a") [ -f "$FIX/docker_down" ] && exit 1; cat "$FIX/ps" ;;
  "stats --no-stream") cat "$FIX/stats" ;;
  "exec "*) cat "$FIX/psql" ;;
esac
SH
cat > "$BIN/curl" <<'SH'
#!/usr/bin/env bash
if printf '%s ' "$@" | grep -q -- '-w'; then
  url="${@: -1}"; f="$FIX/probe_$(printf '%s' "$url" | tr -c 'A-Za-z0-9' '_')"
  cat "$f" 2>/dev/null || printf '000 0.000'
  exit 0
fi
printf '%s\n' "$*" >> "$FIX/curl_args"
cat > "$FIX/curl_stdin"
exit "$(cat "$FIX/curl_code" 2>/dev/null || echo 0)"
SH
cat > "$BIN/ss" <<'SH'
#!/usr/bin/env bash
cat "$FIX/ss" 2>/dev/null
SH
cat > "$BIN/openssl" <<'SH'
#!/usr/bin/env bash
cat "$FIX/openssl" 2>/dev/null || exit 1
SH
cat > "$BIN/systemctl" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FIX/systemctl"
SH
chmod +x "$BIN"/*

basic() {
  printf 'bridge_backend|1/1\nbridge_worker|1/1\nnotes_client|0/1\nold_scaled|0/0\n' > "$FIX/service_ls"
  printf 'bridge_backend.1.abc|running|Up 2 hours (healthy)\nbridge_worker.1.def|running|Up 2 hours\nnotes_client.1.ghi|exited|Exited (1) 4 weeks ago\npostgres|running|Up 12 hours\nminio|exited|Exited (0) 1 hour ago\n' > "$FIX/ps"
  printf 'bridge_backend.1.abc|118.3MiB / 1.917GiB\nbridge_worker.1.def|25MiB / 1.917GiB\npostgres|60.5MiB / 1.917GiB\n' > "$FIX/stats"
  printf 'Failed 5 minutes ago\nFailed about an hour ago\nShutdown 2 hours ago\nFailed 3 days ago\nRunning 2 hours ago\n' > "$FIX/ps_notes_client"
}
get() { python3 -c 'import json,sys; d=json.load(sys.stdin); '"$1"; }

# ---------------------------------------------------------------- collect.py
reset; basic
python3 "$HERE/collect.py" > "$T/json" 2>"$T/out"
python3 - "$T/json" <<'PY' >"$T/out" 2>&1
import json, sys
d = json.load(open(sys.argv[1]))
assert d["uptimeSec"] == 432000, d["uptimeSec"]
assert d["load5"] == 0.42
assert d["memory"] == {"totalMb": 1962, "availableMb": 605, "swapTotalMb": 2048, "swapUsedMb": 95}, d["memory"]
assert d["disk"]["totalBytes"] > 0 and d["cpus"] >= 1
assert d["host"], d
PY
check "collect: reads memory, swap, load and uptime from /proc, the disk from statvfs" $?

python3 - "$T/json" <<'PY' >"$T/out" 2>&1
import json, sys
by = {s["name"]: s for s in json.load(open(sys.argv[1]))["services"]}
assert by["bridge_backend"] == {"name": "bridge_backend", "desired": 1, "running": 1, "health": "healthy", "restarts24h": 0, "critical": True, "memMb": 118}, by["bridge_backend"]
assert by["notes_client"]["running"] == 0 and by["notes_client"]["critical"] is False, by["notes_client"]
assert by["old_scaled"]["desired"] == 0
assert "postgres" not in by and "minio" not in by, "plain containers are only watched when CONTAINERS names them"
PY
check "collect: Swarm services with replicas, health, memory and criticality; plain containers only when asked" $?

python3 - "$T/json" <<'PY' >"$T/out" 2>&1
import json, sys
by = {s["name"]: s for s in json.load(open(sys.argv[1]))["services"]}
# Failed 5 minutes ago + Failed about an hour ago count; Shutdown (a normal update) and Failed 3 days ago do not.
assert by["notes_client"]["restarts24h"] == 2, by["notes_client"]
PY
check "collect: counts failed tasks of the last 24 hours, not shutdowns or old ones" $?

reset; basic
CONTAINERS="postgres minio:opt missing" python3 "$HERE/collect.py" > "$T/json" 2>"$T/out"
python3 - "$T/json" <<'PY' >"$T/out" 2>&1
import json, sys
by = {s["name"]: s for s in json.load(open(sys.argv[1]))["services"]}
assert by["postgres"] == {"name": "postgres", "desired": 1, "running": 1, "health": "none", "critical": True, "memMb": 60}, by["postgres"]
assert by["minio"]["running"] == 0 and by["minio"]["critical"] is False
assert by["missing"]["running"] == 0
PY
check "collect: CONTAINERS adds plain containers, ':opt' makes one non-critical, a missing one is down" $?

reset; touch "$FIX/docker_down"
python3 "$HERE/collect.py" > "$T/json" 2>"$T/out"
python3 - "$T/json" <<'PY' >"$T/out" 2>&1
import json, sys
services = json.load(open(sys.argv[1]))["services"]
assert services == [{"name": "docker", "desired": 1, "running": 0, "critical": True}], services
PY
check "collect: Docker not answering is reported as a critical service that is down" $?

reset; basic
printf 'LISTEN 0 4096 0.0.0.0:5432 0.0.0.0:*\nLISTEN 0 4096 127.0.0.1:5433 0.0.0.0:*\nLISTEN 0 4096 [::]:5432 [::]:*\nLISTEN 0 128 0.0.0.0:22 0.0.0.0:*\n' > "$FIX/ss"
EXPOSED_CHECK="5432 5433" python3 "$HERE/collect.py" | get 'print(d["exposedPorts"])' > "$T/out" 2>&1
[ "$(cat "$T/out")" = "[5432]" ]; check "collect: a port on every interface is exposed, one on 127.0.0.1 is not" $?

reset; basic
printf 'LISTEN 0 4096 127.0.0.1:5432 0.0.0.0:*\n' > "$FIX/ss"
python3 "$HERE/collect.py" | get 'print(d["exposedPorts"])' > "$T/out" 2>&1
[ "$(cat "$T/out")" = "[]" ]; check "collect: a Postgres bound to localhost is not reported" $?

reset; basic
printf '200 0.0384' > "$FIX/probe_https___api_bridge_test_health"
printf '502 0.2000' > "$FIX/probe_https___notes_test"
PROBES="https://api.bridge.test/health|1 https://notes.test|0 https://gone.test|1" python3 "$HERE/collect.py" > "$T/json" 2>"$T/out"
python3 - "$T/json" <<'PY' >"$T/out" 2>&1
import json, sys
p = json.load(open(sys.argv[1]))["probes"]
assert p[0] == {"name": "https://api.bridge.test/health", "ok": True, "critical": True, "httpCode": 200, "ms": 38}, p[0]
assert p[1] == {"name": "https://notes.test", "ok": False, "critical": False, "httpCode": 502, "ms": 200}, p[1]
assert p[2] == {"name": "https://gone.test", "ok": False, "critical": True}, p[2]
PY
check "collect: probes give code and time; no answer is not ok" $?

reset; basic
echo old > "$T/meta_old"; touch -t 202601010000 "$T/meta_old"; echo new > "$T/meta_new"
BACKUP_FILES="bridge=$T/meta_new notes=$T/meta_old places=$T/nope" python3 "$HERE/collect.py" > "$T/json" 2>"$T/out"
python3 - "$T/json" <<'PY' >"$T/out" 2>&1
import json, sys
b = {x["name"]: x["ageHours"] for x in json.load(open(sys.argv[1]))["backups"]}
assert b["bridge"] is not None and b["bridge"] < 1, b
assert b["notes"] > 1000, b
assert b["places"] is None, b
PY
check "collect: a backup's age is the age of its file; a missing file is null" $?

reset; basic
FUT="$(python3 -c 'import time; print(time.strftime("%b %e %H:%M:%S %Y GMT", time.gmtime(time.time() + 10*86400 + 3600)))')"
printf 'notAfter=%s\n' "$FUT" > "$FIX/openssl"
CERT_FILES="api=$T/x.pem" python3 "$HERE/collect.py" | get 'print(d["certs"][0]["name"], d["certs"][0]["days"])' > "$T/out" 2>&1
case "$(cat "$T/out")" in "api 10"|"api 9"|"api 11") true ;; *) false ;; esac; check "collect: days left of a certificate" $?

reset; basic
printf '1|0.4\n' > "$FIX/psql"
REPL_CONTAINER=bridge-pg python3 "$HERE/collect.py" | get 'print(d["replication"])' > "$T/out" 2>&1
[ "$(cat "$T/out")" = "{'connected': True, 'lagSec': 0.4}" ]; check "collect: a streaming standby and its lag" $?
printf '0|0\n' > "$FIX/psql"
REPL_CONTAINER=bridge-pg python3 "$HERE/collect.py" | get 'print(d["replication"])' > "$T/out" 2>&1
[ "$(cat "$T/out")" = "{'connected': False, 'lagSec': None}" ]; check "collect: no standby streaming is not connected" $?
rm -f "$FIX/psql"
REPL_CONTAINER=bridge-pg python3 "$HERE/collect.py" | get 'print(d["replication"]["connected"])' > "$T/out" 2>&1
[ "$(cat "$T/out")" = "False" ]; check "collect: Postgres not answering means not connected" $?
python3 "$HERE/collect.py" | get 'print("replication" in d)' > "$T/out" 2>&1
[ "$(cat "$T/out")" = "False" ]; check "collect: no replication section unless a container is named" $?

printf 'vm 3\n' > "$T/leader"; printf 'e676c710aabbccddeeff\n' > "$T/version"
LEADER_FILE="$T/leader" VERSION_FILE="$T/version" python3 "$HERE/collect.py" | get 'print(d["leader"], d["version"])' > "$T/out" 2>&1
[ "$(cat "$T/out")" = "{'site': 'vm', 'epoch': 3} e676c710aabbccddeeff" ]; check "collect: leader and version come from their files" $?

mv "$PROCD/meminfo" "$PROCD/meminfo.bak"
python3 "$HERE/collect.py" >"$T/json" 2>"$T/out"; code=$?
mv "$PROCD/meminfo.bak" "$PROCD/meminfo"
[ "$code" -ne 0 ] && [ ! -s "$T/json" ]; check "collect: without meminfo it prints nothing and fails" $?

# ---------------------------------------------------------------- report.sh
reset; basic
AGENT_ENV="$T/agent.env"
printf 'BRIDGE_API_URL=https://bridge.test\nBRIDGE_API_KEY=brk_secret\nCLOUD_HOST=yc-vm\n' > "$AGENT_ENV"
AGENT_ENV_FILE="$AGENT_ENV" bash "$HERE/report.sh" >"$T/out" 2>&1
grep -q 'boards/agent/cloud' "$FIX/curl_args"; check "report: posts to the cloud route of the boards agent" $?
grep -q '"host": "yc-vm"' "$FIX/curl_args"; check "report: the body is the collected JSON" $?
grep -q 'Authorization: Bearer brk_secret' "$FIX/curl_stdin" && ! grep -q 'brk_secret' "$FIX/curl_args"; check "report: the key travels on curl's stdin, never in its arguments" $?

reset; basic
printf 'BRIDGE_API_URL=https://bridge.test\n' > "$AGENT_ENV"
AGENT_ENV_FILE="$AGENT_ENV" bash "$HERE/report.sh" >"$T/out" 2>&1; code=$?
[ "$code" -eq 0 ] && [ ! -f "$FIX/curl_args" ] && grep -q 'nothing sent' "$T/out"; check "report: without a key it sends nothing and says so" $?

reset; basic; printf 'BRIDGE_API_URL=https://bridge.test\nBRIDGE_API_KEY=k\nBRIDGE_RESOLVE=api.test:443:10.0.0.1\n' > "$AGENT_ENV"
AGENT_ENV_FILE="$AGENT_ENV" bash "$HERE/report.sh" >"$T/out" 2>&1
grep -q -- '--resolve api.test:443:10.0.0.1' "$FIX/curl_args"; check "report: BRIDGE_RESOLVE pins the address" $?

reset; basic; printf 'BRIDGE_API_URL=https://bridge.test\nBRIDGE_API_KEY=k\n' > "$AGENT_ENV"; echo 22 > "$FIX/curl_code"
AGENT_ENV_FILE="$AGENT_ENV" bash "$HERE/report.sh" >"$T/out" 2>&1; code=$?
[ "$code" -eq 0 ] && grep -q 'could not send' "$T/out"; check "report: a refused report is logged and is not an error" $?

# ---------------------------------------------------------------- install.sh
reset; R="$T/root"; mkdir -p "$R"
ROOT="$R" bash "$HERE/install.sh" >"$T/out" 2>&1
[ -x "$R/usr/local/lib/pipe-cloudagent/report.sh" ] && [ -f "$R/usr/local/lib/pipe-cloudagent/collect.py" ]; check "install: puts report.sh and collect.py in place" $?
[ -f "$R/etc/pipe-cloudagent.env" ] && [ "$(stat -c %a "$R/etc/pipe-cloudagent.env" 2>/dev/null || stat -f %Lp "$R/etc/pipe-cloudagent.env")" = "600" ]; check "install: the settings file is created with mode 600" $?
grep -q '^BRIDGE_API_KEY=$' "$R/etc/pipe-cloudagent.env"; check "install: the template leaves the key empty for you to fill in" $?
( set -a; . "$R/etc/pipe-cloudagent.env"; ) >"$T/out" 2>&1; check "install: the template can be sourced by a shell" $?
grep -q 'OnUnitActiveSec=1min' "$R/etc/systemd/system/pipe-cloudagent.timer" && grep -q 'enable --now pipe-cloudagent.timer' "$FIX/systemctl"; check "install: a one-minute timer is enabled" $?
echo 'BRIDGE_API_KEY=mine' > "$R/etc/pipe-cloudagent.env"; ROOT="$R" bash "$HERE/install.sh" >"$T/out" 2>&1
grep -q 'BRIDGE_API_KEY=mine' "$R/etc/pipe-cloudagent.env"; check "install: an existing settings file is never overwritten" $?
ROOT="$R" bash "$HERE/install.sh" --remove >"$T/out" 2>&1
[ ! -e "$R/usr/local/lib/pipe-cloudagent" ] && [ ! -e "$R/etc/systemd/system/pipe-cloudagent.timer" ] && [ -f "$R/etc/pipe-cloudagent.env" ]; check "install --remove: takes the agent away, leaves the settings (and the key) for you" $?
R2="$T/root2"; mkdir -p "$R2"; ROOT="$R2" bash "$HERE/install.sh" --dry-run >"$T/out" 2>&1
[ ! -e "$R2/usr" ] && grep -q 'would' "$T/out"; check "install --dry-run: changes nothing" $?

# Cleanup of the template test above used a sourced shell; make sure a stray CRITICAL_REGEX line still parses once uncommented.
sed 's/^#CRITICAL_REGEX/CRITICAL_REGEX/' "$HERE/install.sh" | grep -q "CRITICAL_REGEX=\\\\'" ; check "install: the CRITICAL_REGEX example is quoted for a shell" $?

echo
echo "$PASS passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
