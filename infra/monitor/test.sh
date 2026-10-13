#!/usr/bin/env bash
#
# Tests for monitor-lib.sh, resource-check.sh, primary-watch.sh and install.sh with fake commands — nothing is touched:
#   docker run --rm -v "$PWD/../..":/r debian:bookworm-slim bash /r/infra/monitor/test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0; BIN="$T/bin"; FIX="$T/fix"; mkdir -p "$BIN" "$FIX"; export PATH="$BIN:$PATH" FIX
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/out" 2>/dev/null | head -12; fi; }

export STATE_DIR="$T/state" NOTIFY_CMD="$BIN/notify"
cat > "$BIN/notify" <<'SH'
#!/usr/bin/env bash
printf '%s\n--\n' "$1" >> "$FIX/sent"
SH
chmod +x "$BIN/notify"
sent() { grep -c '^--$' "$FIX/sent" 2>/dev/null || echo 0; }
reset() { rm -rf "$FIX"/* "$STATE_DIR"; }

# ---------------------------------------------------------------- monitor-lib: the alert state machine
# shellcheck source=monitor-lib.sh
. "$HERE/monitor-lib.sh"
reset; CONFIRM_RUNS=2
transition x 1 "P" "R"; [ "$(sent)" = 0 ]; check "lib: the first bad run is not yet an alert (needs 2 in a row)" $?
transition x 1 "P" "R"; [ "$(sent)" = 1 ] && grep -q '^P$' "$FIX/sent"; check "lib: the second bad run in a row alerts once" $?
transition x 1 "P" "R"; transition x 1 "P" "R"; [ "$(sent)" = 1 ]; check "lib: a continuing problem does not repeat before REPEAT_SECONDS" $?
printf '2 %s\n' "$(( $(date +%s) - 7 * 3600 ))" > "$STATE_DIR/x"; transition x 1 "P" "R"; [ "$(sent)" = 2 ]; check "lib: …but reminds after REPEAT_SECONDS (6 h)" $?
transition x 0 "P" "R"; [ "$(sent)" = 3 ] && tail -2 "$FIX/sent" | head -1 | grep -q '^R$'; check "lib: recovery is announced" $?
transition x 0 "P" "R"; [ "$(sent)" = 3 ]; check "lib: an OK run after recovery says nothing" $?
reset; transition y 1 "P" "R"; transition y 0 "P" "R"; transition y 1 "P" "R"; [ "$(sent)" = 0 ]; check "lib: a flapping value (bad, ok, bad) never reaches the threshold" $?

# ---------------------------------------------------------------- resource-check
LOAD="$T/loadavg"; MEM="$T/meminfo"; TH="$T/temp"
cat > "$BIN/nproc" <<'SH'
#!/usr/bin/env bash
echo 4
SH
cat > "$BIN/df" <<'SH'
#!/usr/bin/env bash
printf 'Use%%\n %s%%\n' "$(cat "$FIX/disk")"
SH
cat > "$BIN/vcgencmd" <<'SH'
#!/usr/bin/env bash
echo "throttled=0x$(cat "$FIX/throttled")"
SH
cat > "$BIN/docker" <<'SH'
#!/usr/bin/env bash
cat "$FIX/swarm"
SH
chmod +x "$BIN"/*
healthy() { echo "0.05 0.05 0.05 1/100 1" > "$LOAD"; printf 'MemTotal: 8000000 kB\nMemAvailable: 7000000 kB\n' > "$MEM"; echo 48000 > "$TH"; echo 12 > "$FIX/disk"; echo 0 > "$FIX/throttled"; echo active > "$FIX/swarm"; }
rc() { LOADAVG_FILE="$LOAD" MEMINFO_FILE="$MEM" THERMAL_FILE="$TH" CONFIRM_RUNS=1 "$HERE/resource-check.sh" > "$T/out" 2>&1; }

reset; healthy; rc; c=$?; [ $c -eq 0 ] && [ "$(sent)" = 0 ] && grep -q '^ok:' "$T/out"; check "resource: a healthy board says nothing" $?
reset; healthy; echo "3.0 3.0 3.0 1/100 1" > "$LOAD"; rc; grep -q 'нагрузка CPU' "$FIX/sent"; check "resource: sustained load (15 min avg 0.75/core) alerts" $?
reset; healthy; echo "9.0 0.1 0.1 1/100 1" > "$LOAD"; rc; [ "$(sent)" = 0 ]; check "resource: a short spike (1 min) does not" $?
reset; healthy; printf 'MemTotal: 8000000 kB\nMemAvailable: 1000000 kB\n' > "$MEM"; rc; grep -q 'свободной памяти' "$FIX/sent"; check "resource: memory below 25 % available alerts" $?
reset; healthy; echo 91 > "$FIX/disk"; rc; grep -q 'диск заполнен' "$FIX/sent"; check "resource: a disk over 80 % alerts" $?
reset; healthy; echo 78000 > "$TH"; rc; grep -q '78°C' "$FIX/sent"; check "resource: 78 °C alerts" $?
reset; healthy; echo 1 > "$FIX/throttled"; rc; grep -q 'питания/частоты' "$FIX/sent"; check "resource: under-voltage right now alerts" $?
reset; healthy; echo 50000 > "$FIX/throttled"; rc; [ "$(sent)" = 0 ]; check "resource: throttling that happened earlier (sticky bits above 0xF) does not" $?
reset; healthy; echo error > "$FIX/swarm"; rc; grep -q 'не в Swarm' "$FIX/sent"; check "resource: Swarm in error alerts" $?
reset; healthy; echo 91 > "$FIX/disk"; rc; healthy; rc; grep -q 'места на диске достаточно' "$FIX/sent"; check "resource: …and its recovery is announced" $?

# ---------------------------------------------------------------- primary-watch
cat > "$BIN/ping" <<'SH'
#!/usr/bin/env bash
ip="${@: -1}"; [ ! -f "$FIX/down-$ip" ]
SH
cat > "$BIN/curl" <<'SH'
#!/usr/bin/env bash
url="${@: -1}"; ip="${url#http://}"; ip="${ip%%:*}"
[ -f "$FIX/nohealth-$ip" ] && exit 22
echo '{"status":"ok","database":true,"pendingMigrations":false}'
SH
cat > "$BIN/ssh" <<'SH'
#!/usr/bin/env bash
echo 97
SH
cat > "$BIN/hostname" <<'SH'
#!/usr/bin/env bash
echo ubuntu-blue
SH
cat > "$BIN/docker" <<'SH'
#!/usr/bin/env bash
# docker node ls -q / docker node inspect <id> --format <fmt>
case "$*" in
  "node ls -q") [ -f "$FIX/no-swarm" ] && exit 1; echo n1; echo n2;;
  *"inspect n1"*"bridge-primary"*) cat "$FIX/primary-label-n1";;
  *"inspect n2"*"bridge-primary"*) cat "$FIX/primary-label-n2";;
  *"inspect n1"*"Hostname"*) echo ubuntu-white;;
  *"inspect n2"*"Hostname"*) echo ubuntu-red;;
  *"inspect n1"*"Status.Addr"*) echo 192.168.50.11;;
  *"inspect n2"*"Status.Addr"*) echo 192.168.50.12;;
  *"inspect n1"*failover*) cat "$FIX/failover-n1";;
  *"inspect n2"*failover*) cat "$FIX/failover-n2";;
esac
SH
chmod +x "$BIN"/*
pw_reset() { reset; echo true > "$FIX/primary-label-n1"; : > "$FIX/primary-label-n2"; : > "$FIX/failover-n1"; : > "$FIX/failover-n2"; }
pw() { CONFIRM_RUNS=3 "$HERE/primary-watch.sh" > "$T/out" 2>&1; }

pw_reset; pw; [ "$(sent)" = 0 ] && grep -q '^ok: ubuntu-white' "$T/out"; check "watch: a healthy primary says nothing" $?
pw_reset; touch "$FIX/down-192.168.50.11" "$FIX/nohealth-192.168.50.11"; pw; pw; [ "$(sent)" = 0 ]; check "watch: two bad minutes are not enough (needs 3 in a row)" $?
pw; [ "$(sent)" = 1 ]; check "watch: the third bad minute alerts once" $?
grep -q 'не отвечает (ни ping, ни API)' "$FIX/sent" && grep -q 'failover.sh --dry-run' "$FIX/sent" && grep -q '97 с назад' "$FIX/sent"; check "watch: the message says what it saw, the replica's age and the command to switch" $?
rm -f "$FIX/down-192.168.50.11" "$FIX/nohealth-192.168.50.11"; pw; [ "$(sent)" = 2 ] && tail -2 "$FIX/sent" | head -1 | grep -q 'снова отвечает'; check "watch: the primary coming back is announced" $?
pw_reset; touch "$FIX/nohealth-192.168.50.11"; pw; pw; pw; grep -q 'отвечает на ping, но API/база не здоровы' "$FIX/sent"; check "watch: a board that pings but whose API is sick is told apart from a dead one" $?
pw_reset; touch "$FIX/down-192.168.50.11" "$FIX/nohealth-192.168.50.11" "$FIX/down-192.168.50.1" "$FIX/down-192.168.50.12" "$FIX/down-192.168.50.14"; pw; pw; pw; [ "$(sent)" = 0 ] && grep -q 'cannot reach' "$T/out"; check "watch: when THIS board is cut off (no gateway, no peers) it judges nothing — no false alarm" $?
pw_reset; echo true > "$FIX/failover-n1"; : > "$FIX/primary-label-n1"; echo true > "$FIX/primary-label-n2"; echo true > "$FIX/failover-n2"; touch "$FIX/down-192.168.50.12" "$FIX/nohealth-192.168.50.12"; pw; pw; pw; grep -q 'после переключения' "$FIX/sent" && ! grep -q 'failover.sh --dry-run' "$FIX/sent"; check "watch: after a failover (primary = red) it does not suggest failing over again" $?
pw_reset; touch "$FIX/no-swarm" "$FIX/down-192.168.50.11" "$FIX/nohealth-192.168.50.11"; pw; pw; pw; grep -q '192.168.50.11' "$FIX/sent"; check "watch: when the Swarm cannot say who is primary, it falls back to white's address" $?

# ---------------------------------------------------------------- install.sh
cat > "$BIN/systemctl" <<'SH'
#!/usr/bin/env bash
echo "systemctl $*" >> "$FIX/sc"
SH
cat > "$BIN/id" <<'SH'
#!/usr/bin/env bash
echo 0
SH
chmod +x "$BIN/systemctl" "$BIN/id"
inst() { ROOT="$T/root" "$HERE/install.sh" "$@" > "$T/out" 2>&1; }
reset; rm -rf "$T/root"; inst; c=$?
[ $c -eq 0 ] && [ -x "$T/root/usr/local/lib/pipe-monitor/resource-check.sh" ] && grep -q 'OnUnitActiveSec=5min' "$T/root/etc/systemd/system/pipe-resource-check.timer" && grep -q 'enable --now pipe-resource-check.timer' "$FIX/sc"; check "install: every board gets the resource check every 5 minutes" $?
[ ! -f "$T/root/etc/systemd/system/pipe-primary-watch.timer" ] && grep -q 'disable --now pipe-primary-watch.timer' "$FIX/sc"; check "install: …and NOT the primary watch (and any earlier one is switched off)" $?
reset; rm -rf "$T/root"; inst --watch-primary; grep -q 'OnUnitActiveSec=1min' "$T/root/etc/systemd/system/pipe-primary-watch.timer" && grep -q 'enable --now pipe-primary-watch.timer' "$FIX/sc"; check "install: --watch-primary adds the one-minute watch" $?
reset; rm -rf "$T/root"; inst --watch-primary; inst --watch-primary; [ $? -eq 0 ]; check "install: idempotent" $?
reset; rm -rf "$T/root"; inst --dry-run --watch-primary; [ ! -d "$T/root" ] && [ ! -f "$FIX/sc" ] && grep -q 'would' "$T/out"; check "install: a dry run changes nothing" $?

echo; echo "$PASS passed, $FAILED failed"; [ "$FAILED" -eq 0 ]
