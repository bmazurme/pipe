#!/usr/bin/env bash
#
# Tests for router-agent.sh and install.sh with fake ssh / ping / curl / ssh-keygen — nothing is touched:
#   docker run --rm -v "$PWD":/r python:3.12-slim bash /r/infra/router/test.sh      (Linux: GNU tools; it runs in CI's infra job)
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0; BIN="$T/bin"; FIX="$T/fix"; mkdir -p "$BIN" "$FIX"; export PATH="$BIN:$PATH" FIX
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/out" 2>/dev/null | head -12; fi; }
reset() { rm -rf "${FIX:?}"/* "$T/state"; : > "$T/out"; }

# ping: the answers for a target come from $FIX/ping_<target> (one line per call: up / down; the last one stays); no file means up.
cat > "$BIN/ping" <<'SH'
#!/usr/bin/env bash
target="${@: -1}"
file="$FIX/ping_$target"
[ -f "$file" ] || exit 0
answer="$(head -1 "$file")"
[ "$(wc -l < "$file")" -le 1 ] || sed -i 1d "$file"
[ "$answer" = up ]
SH
cat > "$BIN/ssh" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FIX/ssh_calls"
if [ "${@: -1}" = reboot ]; then
  echo reboot >> "$FIX/reboots"
  exit "$(cat "$FIX/ssh_reboot_rc" 2>/dev/null || echo 255)"
fi
[ -f "$FIX/router_raw" ] && cat "$FIX/router_raw"
exit "$(cat "$FIX/ssh_rc" 2>/dev/null || echo 0)"
SH
cat > "$BIN/curl" <<'SH'
#!/usr/bin/env bash
url="${@: -1}"
body=""; prev=""
for a in "$@"; do [ "$prev" = --data ] && body="$a"; prev="$a"; done
printf '%s\n' "$*" >> "$FIX/curl_args"
cat >> "$FIX/curl_stdin"
case "$url" in
  */router/reboots/*/result) printf '%s\n' "$body" >> "$FIX/results"; exit "$(cat "$FIX/result_rc" 2>/dev/null || echo 0)" ;;
  */boards/agent/router) printf '%s\n' "$body" >> "$FIX/reports"; cat "$FIX/bridge_answer" 2>/dev/null || echo '{"rebootRequestId": null}'; exit "$(cat "$FIX/curl_code" 2>/dev/null || echo 0)" ;;
esac
SH
cat > "$BIN/sleep" <<'SH'
#!/usr/bin/env bash
exit 0
SH
cat > "$BIN/ssh-keygen" <<'SH'
#!/usr/bin/env bash
prev=""; file=""
for a in "$@"; do [ "$prev" = -f ] && file="$a"; prev="$a"; done
printf 'PRIVATE\n' > "$file"; printf 'ssh-ed25519 AAAAFAKE pipe-router-agent@test\n' > "$file.pub"
echo "ssh-keygen $*" >> "$FIX/keygen_calls"
SH
cat > "$BIN/systemctl" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FIX/systemctl"
SH
chmod +x "$BIN"/*

mkdir -p "$T/rdir"; printf 'KEY\n' > "$T/rdir/id_ed25519"
printf 'BRIDGE_API_URL=https://bridge.test\nBRIDGE_API_KEY=brk_secret\n' > "$T/agent.env"
export AGENT_ENV_FILE="$T/agent.env" ROUTER_ENV_FILE="$T/none.env" ROUTER_DIR="$T/rdir" STATE_DIR="$T/state"
export BRIDGE_RESOLVE= POLL_SEC=0 WAIT_DOWN_SEC=6 WAIT_UP_SEC=6 ROUTER_NAME=asus

RAW='model=RT-AX58U
uptime=400000
wan_state=2
wan_aux=0
link_internet=2
wan_ip=89.207.218.46
wan_if=eth0
wan_counters=1000000 500000
ping_begin
3 packets transmitted, 3 packets received, 0% packet loss
round-trip min/avg/max = 10.1/12.4/15.2 ms
ping_end'
agent() { bash "$HERE/router-agent.sh" "$@" >"$T/out" 2>&1; }
report_json() { head -1 "$FIX/reports"; }
pyassert() { python3 -c "import json, sys; d = json.loads(sys.argv[1]); $2" "$(report_json)" >"$T/out" 2>&1; }

# ---------------------------------------------------------------- the report
reset; printf '%s\n' "$RAW" > "$FIX/router_raw"; agent
pyassert x 'assert d == {"host": "asus", "reachable": True, "sshOk": True, "model": "RT-AX58U", "uptimeSec": 400000, "wanState": 2, "wanAux": 0, "internetOk": True, "wanIp": "89.207.218.46", "pingLossPct": 0, "pingMs": 12.4}, d'
check "report: everything the router says, as numbers, with no speed on the first round" $?
grep -q 'ping -c 3 -W 2 1.1.1.1 ' "$FIX/ssh_calls" && grep -q -- '-o BatchMode=yes' "$FIX/ssh_calls" && grep -q 'StrictHostKeyChecking=accept-new' "$FIX/ssh_calls"; check "report: the ping target is in the commands sent to the router; the key only, no password; the host key is pinned" $?
! grep -q -E '(^| )sh( -s|$)' "$FIX/ssh_calls"; check "report: never through «sh -s» (on this firmware sh is Broadcom's memory-write tool, not a shell)" $?
grep -q 'Bearer brk_secret' "$FIX/curl_stdin" && ! grep -q brk_secret "$FIX/curl_args"; check "report: the key goes to curl on stdin, never in the arguments" $?
[ ! -f "$FIX/reboots" ]; check "report: nothing is rebooted when bridge hands out no request" $?

reset; printf '%s\n' "$RAW" > "$FIX/router_raw"; mkdir -p "$T/state"; echo "$(( $(date +%s) - 60 )) 0 0" > "$T/state/last"; agent
pyassert x 'assert 120000 <= d["rxBps"] <= 134500 and 60000 <= d["txBps"] <= 67500 and abs(d["rxBps"] - 2 * d["txBps"]) < 10, d'
check "report: the speed is the counters' difference over the time since the previous round" $?
reset; printf '%s\n' "$RAW" > "$FIX/router_raw"; mkdir -p "$T/state"; echo "$(( $(date +%s) - 60 )) 9000000 9000000" > "$T/state/last"; agent
pyassert x 'assert "rxBps" not in d and "txBps" not in d, d'
check "report: counters that went backwards (the router rebooted) give no speed" $?

reset; echo down > "$FIX/ping_192.168.50.1"; agent
pyassert x 'assert d == {"host": "asus", "reachable": False, "sshOk": False}, d' && [ ! -f "$FIX/ssh_calls" ]
check "report: a router that does not answer ping is reported as unreachable, with no ssh attempt" $?
reset; echo 255 > "$FIX/ssh_rc"; agent
pyassert x 'assert d == {"host": "asus", "reachable": True, "sshOk": False}, d'
check "report: a router that answers ping but lets the key in not is reported with sshOk false" $?
reset; printf 'something=else\n' > "$FIX/router_raw"; agent
pyassert x 'assert d["sshOk"] is False, d'
check "report: an answer without the uptime is not taken for a login" $?
reset; printf '%s\n' "wan_state=2" "uptime=5" "ping_begin" "ping: bad address" "ping_end" > "$FIX/router_raw"; agent
pyassert x 'assert d["wanState"] == 2 and d["pingMs"] is None and d["pingLossPct"] is None and d["internetOk"] is None, d'
check "report: what the router did not answer is null, not guessed" $?
reset; echo 22 > "$FIX/curl_code"; printf '%s\n' "$RAW" > "$FIX/router_raw"; agent; rc=$?
[ "$rc" = 0 ] && [ ! -f "$FIX/reboots" ]; check "report: a refusal by bridge is logged, nothing is rebooted, and it is not an error" $?

# ---------------------------------------------------------------- the reboot
UP_DOWN_UP() { printf 'up\nup\ndown\ndown\nup\n' > "$FIX/ping_192.168.50.1"; }
reset; printf '%s\n' "$RAW" > "$FIX/router_raw"; echo '{"rebootRequestId": 5}' > "$FIX/bridge_answer"; UP_DOWN_UP; printf 'down\nup\n' > "$FIX/ping_1.1.1.1"; agent
[ "$(wc -l < "$FIX/reboots")" = 1 ] && grep -q '/api/v1/boards/agent/router/reboots/5/result' "$FIX/curl_args"; check "reboot: a request from bridge reboots the router once and reports back to that request" $?
python3 -c "import json; d = json.loads(open('$FIX/results').readline()); assert d['ok'] is True and 'роутер был недоступен' in d['detail'] and 'интернет вернулся' in d['detail'], d" >"$T/out" 2>&1
check "reboot: the router went down and came back, and so did the internet: ok, with the times" $?

reset; printf '%s\n' "$RAW" > "$FIX/router_raw"; echo '{"rebootRequestId": 5}' > "$FIX/bridge_answer"; echo up > "$FIX/ping_192.168.50.1"; agent
python3 -c "import json; d = json.loads(open('$FIX/results').readline()); assert d['ok'] is False and 'не перестал отвечать' in d['detail'], d" >"$T/out" 2>&1
check "reboot: a router that never stops answering is reported as a command that did not work" $?
reset; printf '%s\n' "$RAW" > "$FIX/router_raw"; echo '{"rebootRequestId": 5}' > "$FIX/bridge_answer"; printf 'up\nup\ndown\n' > "$FIX/ping_192.168.50.1"; agent
python3 -c "import json; d = json.loads(open('$FIX/results').readline()); assert d['ok'] is False and 'не вернулся' in d['detail'], d" >"$T/out" 2>&1
check "reboot: a router that does not come back is reported as such" $?
reset; printf '%s\n' "$RAW" > "$FIX/router_raw"; echo '{"rebootRequestId": 5}' > "$FIX/bridge_answer"; UP_DOWN_UP; echo down > "$FIX/ping_1.1.1.1"; agent
python3 -c "import json; d = json.loads(open('$FIX/results').readline()); assert d['ok'] is True and 'интернета ещё нет' in d['detail'], d" >"$T/out" 2>&1
check "reboot: the router back but the internet not: still done, and says the internet is missing" $?
reset; printf '%s\n' "$RAW" > "$FIX/router_raw"; echo '{"rebootRequestId": 5}' > "$FIX/bridge_answer"; UP_DOWN_UP; echo 22 > "$FIX/result_rc"; agent; rc=$?
[ "$rc" = 0 ] && [ "$(wc -l < "$FIX/results")" = 5 ]; check "reboot: a verdict bridge does not take is tried five times, then given up, without an error" $?
reset; printf '%s\n' "$RAW" > "$FIX/router_raw"; echo '{"rebootRequestId": null}' > "$FIX/bridge_answer"; agent
[ ! -f "$FIX/reboots" ]; check "reboot: «no request» in the answer is no reboot" $?
reset; printf '%s\n' "$RAW" > "$FIX/router_raw"; echo 'not json' > "$FIX/bridge_answer"; agent; rc=$?
[ "$rc" = 0 ] && [ ! -f "$FIX/reboots" ]; check "reboot: an answer that is not JSON is no reboot either" $?
reset; printf '%s\n' "$RAW" > "$FIX/router_raw"; echo '{"rebootRequestId": 5}' > "$FIX/bridge_answer"; echo 255 > "$FIX/ssh_rc"; agent
[ ! -f "$FIX/reboots" ] && python3 -c "import json; d = json.loads(open('$FIX/results').readline()); assert d['ok'] is False and 'не смог войти' in d['detail'], d" >"$T/out" 2>&1; check "reboot: a request that arrives when the router cannot be read is not carried out, and is answered with why" $?

# ---------------------------------------------------------------- probe, guards
reset; printf '%s\n' "$RAW" > "$FIX/router_raw"; echo '{"rebootRequestId": 5}' > "$FIX/bridge_answer"; agent probe
grep -q 'model=RT-AX58U' "$T/out" && grep -q '"wanIp": "89.207.218.46"' "$T/out" && [ ! -f "$FIX/curl_args" ] && [ ! -f "$FIX/reboots" ]; check "probe: shows what the router answered and what would be sent, sends and reboots nothing" $?
reset; ROUTER_DIR="$T/nokey" agent; rc=$?
[ "$rc" = 0 ] && [ ! -f "$FIX/ssh_calls" ] && grep -q 'no key' "$T/out"; check "guard: without the key it says so and does nothing" $?
reset; AGENT_ENV_FILE="$T/none" agent; rc=$?
[ "$rc" = 0 ] && [ ! -f "$FIX/ssh_calls" ]; check "guard: without the bridge settings it does nothing" $?
reset; PING_TARGET='1.1.1.1; reboot' agent; rc=$?
[ "$rc" = 0 ] && [ ! -f "$FIX/ssh_calls" ]; check "guard: a ping target that is not an address is refused" $?
reset; agent nonsense; rc=$?
[ "$rc" = 2 ]; check "guard: an unknown argument is a usage error" $?

# ---------------------------------------------------------------- install.sh
R="$T/root"; reset
ROOT="$R" bash "$HERE/install.sh" >"$T/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ -x "$R/usr/local/lib/pipe-router/router-agent.sh" ] && [ -f "$R/etc/pipe-router/id_ed25519" ]; check "install: copies the agent and makes the key" $?
grep -q 'ssh-ed25519 AAAAFAKE' "$T/out" && grep -q 'Authorized Keys' "$T/out"; check "install: prints the public key and where to add it" $?
grep -q '^ROUTER_HOST=192.168.50.1$' "$R/etc/pipe-router.env" && [ "$(stat -c %a "$R/etc/pipe-router.env")" = 600 ] && [ "$(stat -c %a "$R/etc/pipe-router")" = 700 ]; check "install: settings from a template, readable by root only; the key's directory too" $?
grep -q '^enable --now pipe-router-agent.timer$' "$FIX/systemctl"; check "install: the timer is enabled" $?
grep -q 'ExecStart=/usr/local/lib/pipe-router/router-agent.sh' "$R/etc/systemd/system/pipe-router-agent.service" && grep -q 'OnUnitActiveSec=1min' "$R/etc/systemd/system/pipe-router-agent.timer" && grep -q 'TimeoutStartSec=900' "$R/etc/systemd/system/pipe-router-agent.service"; check "install: a service that may wait for a reboot, and a one-minute timer" $?
echo 'ROUTER_USER=me' >> "$R/etc/pipe-router.env"; printf 'MINE\n' > "$R/etc/pipe-router/id_ed25519"
ROOT="$R" bash "$HERE/install.sh" >"$T/out" 2>&1
grep -q 'ROUTER_USER=me' "$R/etc/pipe-router.env" && [ "$(cat "$R/etc/pipe-router/id_ed25519")" = MINE ] && [ "$(wc -l < "$FIX/keygen_calls")" = 1 ]; check "install: a second run keeps the settings and the key" $?
ROOT="$R" bash "$HERE/install.sh" --remove >"$T/out" 2>&1
[ ! -e "$R/usr/local/lib/pipe-router" ] && [ ! -e "$R/etc/systemd/system/pipe-router-agent.timer" ] && [ -f "$R/etc/pipe-router/id_ed25519" ] && [ -f "$R/etc/pipe-router.env" ]; check "install: --remove takes the agent and the timer away and leaves the key and the settings" $?
ROOT="$T/dry" bash "$HERE/install.sh" --dry-run >"$T/out" 2>&1
[ ! -e "$T/dry" ] && grep -q 'would' "$T/out"; check "install: --dry-run touches nothing" $?

echo; echo "$PASS passed, $FAILED failed"
[ "$FAILED" = 0 ]
