#!/usr/bin/env bash
# Tests for bridge-watch.sh and its installer with a fake curl and a controlled clock. No network.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
FIX="$T/fix"; BIN="$T/bin"; STATE="$T/state"
mkdir -p "$FIX/resp" "$BIN" "$STATE"
pass=0; fail=0
check() { if [ "$2" = 0 ]; then echo "ok   $1"; pass=$((pass + 1)); else echo "FAIL $1"; fail=$((fail + 1)); [ -f "$T/out" ] && sed 's/^/     | /' "$T/out"; fi; }

# fake curl: a probe address answers from $FIX/resp/<host> (first line the HTTP code, the rest the body; no file = no answer); ntfy and the
# heartbeat are recorded
cat > "$BIN/curl" <<'SH'
#!/usr/bin/env bash
url="" ; data="" ; headers=""
while [ $# -gt 0 ]; do
  case "$1" in
    -H) headers="$headers|$2"; shift 2;;
    -d) data="$2"; shift 2;;
    -m|-w) shift 2;;
    -*) shift;;
    *) url="$1"; shift;;
  esac
done
case "$url" in
  https://ntfy.example/*)
    [ -z "${FIX_NTFY_DOWN:-}" ] || exit 22
    printf '%s\t%s\t%s\n' "$url" "$headers" "$data" >> "$FIX/ntfy.log"; exit 0;;
  https://hc.example/*)
    [ -z "${FIX_HC_DOWN:-}" ] || exit 22
    echo "$url" >> "$FIX/heartbeat.log"; exit 0;;
  *)
    host="${url#https://}"; host="${host%%/*}"
    [ -f "$FIX/resp/$host" ] || exit 28
    code="$(head -1 "$FIX/resp/$host")"
    tail -n +2 "$FIX/resp/$host"
    printf '\n%s' "$code";;
esac
SH
chmod +x "$BIN/curl"
# the installer talks to systemd; here it is a no-op
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/systemctl"; chmod +x "$BIN/systemctl"
export PATH="$BIN:$PATH" FIX STATE_DIR="$STATE" WATCH_ENV_FILE=/nonexistent RETRY_SLEEP=0 \
  HOSTS="https://bridge.example/api/v1/health https://api.example/api/v1/health https://site.example/" \
  NTFY_URL=https://ntfy.example/secret-topic VANTAGE=yc-vm

up_all() {
  printf '200\n{"status":"ok","database":true}' > "$FIX/resp/bridge.example"
  printf '200\n{"status":"ok","database":true}' > "$FIX/resp/api.example"
  printf '200\n<html>hi</html>' > "$FIX/resp/site.example"
}
reset() { rm -rf "$STATE"/* "$FIX/ntfy.log" "$FIX/heartbeat.log"; up_all; unset FIX_NTFY_DOWN FIX_HC_DOWN HEARTBEAT_URL NTFY_EMAIL; export NTFY_URL=https://ntfy.example/secret-topic; }
run() { WATCH_NOW="$1" bash "$HERE/bridge-watch.sh" "${@:2}" > "$T/out" 2>&1; }
said() { [ -f "$FIX/ntfy.log" ] && wc -l < "$FIX/ntfy.log" | tr -d ' ' || echo 0; }
min() { echo $((1800000000 + $1 * 60)); }

echo "# everything up"
reset; run "$(min 0)"; check "up: exit 0" $?
[ "$(said)" = 0 ] && [ ! -e "$STATE/down_since" ]; check "up: nothing said, no state kept" $?

echo "# down, but not for long enough"
reset; rm "$FIX/resp/bridge.example"
run "$(min 0)"; [ -f "$STATE/down_since" ] && [ "$(said)" = 0 ]; check "first failing pass: the start is noted, nothing said" $?
run "$(min 5)"; [ "$(said)" = 0 ]; check "5 minutes: still nothing said" $?
run "$(min 9)"; [ "$(said)" = 0 ]; check "9 minutes: still nothing said" $?

echo "# the dead man's hand: ten minutes of silence"
run "$(min 10)"; check "10 minutes: exit 0" $?
[ "$(said)" = 1 ]; check "10 minutes: ONE urgent message" $?
grep -q 'Priority: urgent' "$FIX/ntfy.log" && grep -q 'Title: bridge недоступен' "$FIX/ntfy.log"; check "...urgent, titled" $?
grep -q 'с точки yc-vm bridge не отвечает 10 мин: bridge.example/api/v1/health' "$FIX/ntfy.log" || grep -q 'С точки yc-vm bridge не отвечает 10 мин: bridge.example/api/v1/health' "$FIX/ntfy.log"; check "...says from where, for how long, and which address" $?
grep -q 'api.example' "$FIX/ntfy.log"; [ $? -ne 0 ]; check "...and only the address that is down" $?
run "$(min 11)"; run "$(min 30)"; [ "$(said)" = 1 ]; check "30 minutes: not said again" $?
run "$(min 370)"; [ "$(said)" = 2 ]; check "after REMIND_HOURS (6 h): a reminder, once" $?
grep -q 'всё ещё недоступен' "$FIX/ntfy.log"; check "...worded as a reminder" $?

echo "# recovery"
up_all; run "$(min 380)"; [ "$(said)" = 3 ]; check "back up after an alarm: one message" $?
tail -1 "$FIX/ntfy.log" | grep -q 'Priority: default' && tail -1 "$FIX/ntfy.log" | grep -q 'снова отвечает'; check "...a calm one, saying it is back" $?
[ ! -e "$STATE/down_since" ] && [ ! -e "$STATE/said_at" ]; check "...and the state is cleared" $?
run "$(min 381)"; [ "$(said)" = 3 ]; check "...nothing more after that" $?

echo "# a blip is not an outage"
reset; rm "$FIX/resp/api.example"; run "$(min 0)"; run "$(min 3)"
up_all; run "$(min 4)"
[ "$(said)" = 0 ] && [ ! -e "$STATE/down_since" ]; check "down 4 minutes, then up: nothing said, nothing kept" $?

echo "# what counts as down"
reset; printf '200\n{"status":"degraded","database":false}' > "$FIX/resp/api.example"
run "$(min 0)"; run "$(min 10)"
grep -q 'api.example/api/v1/health' "$FIX/ntfy.log"; check "the readiness address answering 200 with database:false is DOWN" $?
reset; printf '503\n{}' > "$FIX/resp/api.example"
run "$(min 0)"; run "$(min 10)"; [ "$(said)" = 1 ]; check "HTTP 503 is down" $?
reset; printf '200\nwhatever' > "$FIX/resp/site.example"; rm "$FIX/resp/bridge.example"; run "$(min 0)"; run "$(min 10)"
grep -q 'site.example' "$FIX/ntfy.log"; [ $? -ne 0 ]; check "an address that is not the readiness one is up with any 200 body" $?
reset; printf '404\n' > "$FIX/resp/site.example"; run "$(min 0)"; run "$(min 10)"
grep -q 'site.example' "$FIX/ntfy.log"; check "...and down with a 404" $?
reset; rm "$FIX/resp"/*; run "$(min 0)"; run "$(min 10)"
grep -q 'bridge.example.*api.example.*site.example' "$FIX/ntfy.log"; check "nothing answering at all: all three are named" $?

echo "# the channel is down"
reset; rm "$FIX/resp/bridge.example"; run "$(min 0)"
FIX_NTFY_DOWN=1 run "$(min 10)"; check "ntfy unreachable: exit 0 (never fails its caller)" $?
[ ! -e "$STATE/said_at" ]; check "...and the alarm is NOT marked as said" $?
unset FIX_NTFY_DOWN; run "$(min 11)"
[ "$(said)" = 1 ] && [ -e "$STATE/said_at" ]; check "...the next pass says it" $?
reset; unset NTFY_URL; rm "$FIX/resp/bridge.example"; run "$(min 0)"; run "$(min 10)"; check "no NTFY_URL: logs it, exit 0" $?
grep -q 'no NTFY_URL' "$T/out"; check "...and says why" $?

echo "# e-mail through ntfy, and the watcher's own heartbeat"
reset; export NTFY_EMAIL=me@example.com; rm "$FIX/resp/bridge.example"; run "$(min 0)"; run "$(min 10)"
grep -q 'Email: me@example.com' "$FIX/ntfy.log"; check "NTFY_EMAIL: the message is also forwarded to e-mail" $?
reset; rm "$FIX/resp/bridge.example"; run "$(min 0)"; run "$(min 10)"
grep -q 'Email:' "$FIX/ntfy.log"; [ $? -ne 0 ]; check "no NTFY_EMAIL: no e-mail header" $?
reset; export HEARTBEAT_URL=https://hc.example/ping/abc; run "$(min 0)"; rm "$FIX/resp/bridge.example"; run "$(min 1)"
[ "$(wc -l < "$FIX/heartbeat.log" | tr -d ' ')" = 2 ]; check "the watcher pings its own heartbeat on every pass — also while bridge is down" $?
FIX_HC_DOWN=1 run "$(min 2)"; check "a heartbeat that does not get through does not fail the pass" $?

echo "# test mode"
reset; run "$(min 0)" test; check "test: sent" $?
grep -q 'проверка' "$FIX/ntfy.log"; check "test: through the same channel" $?
FIX_NTFY_DOWN=1 run "$(min 0)" test; [ $? -ne 0 ]; check "test: says NOT sent (exit 1) when the channel is down" $?

echo "# the installer"
R="$T/root"; mkdir -p "$R"
ROOT="$R" bash "$HERE/install.sh" > "$T/out" 2>&1; check "install: runs" $?
[ -x "$R/usr/local/lib/pipe-watchdog/bridge-watch.sh" ] && [ -f "$R/etc/systemd/system/pipe-watchdog.timer" ] && [ -f "$R/etc/systemd/system/pipe-watchdog.service" ]; check "install: script and units are in place" $?
[ "$(stat -c %a "$R/etc/pipe-watchdog.env" 2>/dev/null || stat -f %Lp "$R/etc/pipe-watchdog.env")" = 600 ]; check "install: the settings file (it holds a secret) is mode 600" $?
echo "NTFY_URL=https://ntfy.example/mine" > "$R/etc/pipe-watchdog.env"; ROOT="$R" bash "$HERE/install.sh" > "$T/out" 2>&1
grep -q 'mine' "$R/etc/pipe-watchdog.env"; check "install again: a settings file that exists is left alone" $?
grep -q 'OnUnitActiveSec=1min' "$R/etc/systemd/system/pipe-watchdog.timer"; check "install: the timer runs every minute" $?
bash "$HERE/install.sh" --dry-run > "$T/out" 2>&1; check "install --dry-run: runs without root" $?
bash "$HERE/install.sh" --bogus > "$T/out" 2>&1; [ $? -eq 2 ]; check "install: an unknown argument is refused" $?

echo; echo "passed $pass, failed $fail"
[ "$fail" = 0 ]
