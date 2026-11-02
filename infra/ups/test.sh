#!/usr/bin/env bash
#
# Tests for report.sh, notify.sh and install.sh with fake upsc / curl / notify-telegram — nothing is touched:
#   bash infra/ups/test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0; BIN="$T/bin"; FIX="$T/fix"; mkdir -p "$BIN" "$FIX"; export PATH="$BIN:$PATH" FIX
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/out" 2>/dev/null | head -12; fi; }
reset() { rm -rf "${FIX:?}"/*; : > "$T/out"; }

cat > "$BIN/upsc" <<'SH'
#!/usr/bin/env bash
[ -f "$FIX/upsc_fail" ] && { echo "Error: Data stale" >&2; exit 1; }
if [ -n "${2:-}" ]; then grep -E "^$2: " "$FIX/upsc" | head -1 | sed 's/^[^:]*: //'; exit 0; fi
cat "$FIX/upsc"
SH
cat > "$BIN/curl" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FIX/curl_args"
cat > "$FIX/curl_stdin"
exit "$(cat "$FIX/curl_code" 2>/dev/null || echo 0)"
SH
cat > "$BIN/notify-telegram" <<'SH'
#!/usr/bin/env bash
printf '%s|%s\n' "${NOTIFY_QUIET_HOURS:-unset}" "$1" >> "$FIX/sent"
SH
cat > "$BIN/systemctl" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FIX/systemctl"
SH
chmod +x "$BIN/upsc" "$BIN/curl" "$BIN/notify-telegram" "$BIN/systemctl"

set_ups() { # status charge runtime load
  cat > "$FIX/upsc" <<EOT
battery.charge: $2
battery.runtime: $3
battery.voltage: 28.2
device.model: UT1050EG
input.voltage: 231.0
ups.load: $4
ups.model: UT1050EG
ups.realpower.nominal: 630
ups.status: $1
ups.test.result: No test initiated
EOT
}
AGENT_ENV="$T/agent.env"
printf 'BRIDGE_API_URL=https://bridge.test\nBRIDGE_API_KEY=brk_secret\nBOARD_HOST=ubuntu-blue\n' > "$AGENT_ENV"
export AGENT_ENV_FILE="$AGENT_ENV" BRIDGE_RESOLVE=

# ---------------------------------------------------------------- report.sh
reset; set_ups "OL CHRG" 90 4539 9
bash "$HERE/report.sh" >"$T/out" 2>&1
grep -q 'boards/agent/ups' "$FIX/curl_args"; check "report: posts to the UPS route of the boards agent" $?
body="$(sed -n 's/.*--data \(.*\) https.*/\1/p' "$FIX/curl_args")"
python3 - "$body" <<'PY' >"$T/out" 2>&1
import json, sys
data = json.loads(sys.argv[1])
assert data == {"host": "ubuntu-blue", "status": "OL CHRG", "model": "UT1050EG", "chargePct": 90, "runtimeSec": 4539, "loadPct": 9,
                "inputVolts": 231.0, "batteryVolts": 28.2, "nominalWatts": 630, "testResult": "No test initiated"}, data
PY
check "report: the body carries the readings as numbers, the status and the board name" $?
grep -q 'Bearer brk_secret' "$FIX/curl_stdin" && ! grep -q 'brk_secret' "$FIX/curl_args"; check "report: the key goes to curl on stdin, never in the arguments" $?

reset; set_ups "OB DISCHRG" 70 1800 30; sed -i '/battery.runtime/d; /ups.load/d' "$FIX/upsc"
bash "$HERE/report.sh" >"$T/out" 2>&1
body="$(sed -n 's/.*--data \(.*\) https.*/\1/p' "$FIX/curl_args")"
python3 - "$body" <<'PY' >"$T/out" 2>&1
import json, sys
data = json.loads(sys.argv[1])
assert data["status"] == "OB DISCHRG" and data["runtimeSec"] is None and data["loadPct"] is None, data
PY
check "report: a reading the UPS did not give is null, not guessed" $?

reset; : > "$FIX/upsc_fail"; bash "$HERE/report.sh" >"$T/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ ! -f "$FIX/curl_args" ]; check "report: NUT not answering sends nothing and does not fail" $?
reset; set_ups "OL" 100 100 1; sed -i '/ups.status/d' "$FIX/upsc"; bash "$HERE/report.sh" >"$T/out" 2>&1
[ ! -f "$FIX/curl_args" ]; check "report: an answer without ups.status sends nothing" $?
reset; set_ups "OL" 100 100 1; AGENT_ENV_FILE="$T/none" bash "$HERE/report.sh" >"$T/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ ! -f "$FIX/curl_args" ]; check "report: without the key nothing is sent and it is not an error" $?
reset; set_ups "OL" 100 100 1; echo 22 > "$FIX/curl_code"; bash "$HERE/report.sh" >"$T/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(wc -l < "$FIX/curl_args")" = 1 ]; check "report: a refusal by bridge is logged, not repeated, and not an error" $?
reset; set_ups "OL" 100 100 1; echo 7 > "$FIX/curl_code"
BRIDGE_RESOLVE=api.bridge.test:443:192.168.50.10 bash "$HERE/report.sh" >"$T/out" 2>&1
[ "$(wc -l < "$FIX/curl_args")" = 2 ] && head -1 "$FIX/curl_args" | grep -q -- '--resolve api.bridge.test:443:192.168.50.10'; check "report: an unreachable LAN address is retried the ordinary way" $?

# ---------------------------------------------------------------- notify.sh
export NOTIFY_TELEGRAM="$BIN/notify-telegram"
note() { NOTIFYTYPE="$1" bash "$HERE/notify.sh" "ignored" >"$T/out" 2>&1; }

reset; set_ups "OB DISCHRG" 80 2700 12; note ONBATT
grep -q '^off|⚡ Питание пропало.*заряд 80 %, хватит примерно на 45 мин, нагрузка 12 %' "$FIX/sent"; check "notify: the mains gone says so, with charge, minutes and load, and ignores the quiet hours" $?
reset; set_ups "OL CHRG" 80 2700 12; note ONLINE
grep -q '^off|✅ Питание вернулось' "$FIX/sent"; check "notify: the mains back says so" $?
for type in LOWBATT FSD COMMBAD COMMOK REPLBATT; do
  reset; set_ups "OB LB" 5 120 12; note "$type"
  [ "$(wc -l < "$FIX/sent")" = 1 ]; check "notify: $type sends one message" $?
done
reset; set_ups "OL" 100 4000 10; note SHUTDOWN; note NOCOMM; note ""
[ ! -f "$FIX/sent" ]; check "notify: types nobody needs to read in Telegram send nothing" $?
reset; : > "$FIX/upsc_fail"; note ONBATT
grep -q '^off|⚡ Питание пропало — ИБП работает от батареи\. Платы' "$FIX/sent"; check "notify: still says it when the UPS cannot be read (no figures, no stray brackets)" $?

# ---------------------------------------------------------------- install.sh
reset
R="$T/root"; mkdir -p "$R/etc/nut"
printf 'MONITOR cyberpower@localhost 1 upsmon-primary x primary\nMINSUPPLIES 1\n' > "$R/etc/nut/upsmon.conf"
ROOT="$R" bash "$HERE/install.sh" >"$T/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ -x "$R/usr/local/lib/pipe-ups/report.sh" ] && [ -x "$R/usr/local/lib/pipe-ups/notify.sh" ]; check "install: copies both scripts" $?
grep -q '^enable --now pipe-ups-report.timer$' "$FIX/systemctl" && grep -q '^restart nut-monitor$' "$FIX/systemctl"; check "install: the timer is enabled and nut-monitor restarted" $?
grep -q 'ExecStart=/usr/local/lib/pipe-ups/report.sh' "$R/etc/systemd/system/pipe-ups-report.service" && grep -q 'OnUnitActiveSec=1min' "$R/etc/systemd/system/pipe-ups-report.timer"; check "install: a service and a one-minute timer" $?
grep -q '^NOTIFYCMD /usr/local/lib/pipe-ups/notify.sh$' "$R/etc/nut/upsmon.conf" && grep -q '^NOTIFYFLAG ONBATT SYSLOG+EXEC$' "$R/etc/nut/upsmon.conf" && grep -q '^MINSUPPLIES 1$' "$R/etc/nut/upsmon.conf"; check "install: the alerts are wired into upsmon.conf, the rest of it kept" $?
ROOT="$R" bash "$HERE/install.sh" >"$T/out" 2>&1
[ "$(grep -c '^NOTIFYCMD' "$R/etc/nut/upsmon.conf")" = 1 ] && [ "$(grep -c 'pipe-ups (managed' "$R/etc/nut/upsmon.conf")" = 1 ]; check "install: a second run replaces the block, it does not add another" $?
ROOT="$R" bash "$HERE/install.sh" --remove >"$T/out" 2>&1
! grep -q 'NOTIFY' "$R/etc/nut/upsmon.conf" && grep -q '^MINSUPPLIES 1$' "$R/etc/nut/upsmon.conf" && [ ! -e "$R/usr/local/lib/pipe-ups" ]; check "install: --remove takes the block and the files away and keeps the rest" $?
rm -rf "$R/etc/nut"; ROOT="$R" bash "$HERE/install.sh" >"$T/out" 2>&1; rc=$?
[ "$rc" = 0 ] && grep -q 'NUT is not set up' "$T/out"; check "install: without NUT it warns and still installs the report" $?
ROOT="$T/dry" bash "$HERE/install.sh" --dry-run >"$T/out" 2>&1
[ ! -e "$T/dry" ] && grep -q 'would' "$T/out"; check "install: --dry-run touches nothing" $?

echo; echo "$PASS passed, $FAILED failed"
[ "$FAILED" = 0 ]
