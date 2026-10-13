#!/usr/bin/env bash
#
# Tests for clock-before-docker.sh and swarm-heal.sh with fake systemctl/docker/timedatectl — nothing is touched:
#   docker run --rm -v "$PWD/../..":/r debian:bookworm-slim bash /r/infra/pi/test-clock.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0; BIN="$T/bin"; FIX="$T/fix"; mkdir -p "$BIN" "$FIX"; export PATH="$BIN:$PATH" FIX
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/out"; fi; }

cat > "$BIN/systemctl" <<'SH'
#!/usr/bin/env bash
case "$1 $2 $3" in
  "is-active --quiet chrony") [ -f "$FIX/chrony" ];;
  "is-active --quiet systemd-timesyncd") [ -f "$FIX/timesyncd" ];;
  *) echo "systemctl $*" >> "$FIX/log";;
esac
SH
cat > "$BIN/docker" <<'SH'
#!/usr/bin/env bash
cat "$FIX/swarm"
SH
cat > "$BIN/timedatectl" <<'SH'
#!/usr/bin/env bash
cat "$FIX/synced"
SH
cat > "$BIN/id" <<'SH'
#!/usr/bin/env bash
echo 0
SH
chmod +x "$BIN"/*

inst() { ROOT="$T/root" "$HERE/clock-before-docker.sh" "$@" > "$T/out" 2>&1; }
reset() { rm -rf "$FIX"/* "$T/root"; }

reset; inst; c=$?; [ $c -ne 0 ] && grep -q 'no time-sync daemon' "$T/out"; check "no sync daemon: refused" $?
reset; touch "$FIX/chrony"; inst; c=$?
[ $c -eq 0 ] && grep -q 'systemctl enable chrony-wait.service' "$FIX/log"; check "chrony: enables chrony-wait.service" $?
grep -q 'TimeoutStartSec=120' "$T/root/etc/systemd/system/chrony-wait.service.d/10-timeout.conf"; check "…with a 120 s timeout (a board without internet still starts Docker)" $?
grep -q 'After=time-sync.target' "$T/root/etc/systemd/system/docker.service.d/10-time-sync.conf"; check "…docker waits for time-sync.target" $?
[ -x "$T/root/usr/local/sbin/pipe-swarm-heal" ] && grep -q 'OnUnitActiveSec=2min' "$T/root/etc/systemd/system/pipe-swarm-heal.timer" && grep -q 'enable --now pipe-swarm-heal.timer' "$FIX/log"; check "…installs and starts the heal timer" $?
reset; touch "$FIX/timesyncd"; inst; grep -q 'systemctl enable systemd-time-wait-sync.service' "$FIX/log"; check "timesyncd: enables systemd-time-wait-sync.service" $?
reset; touch "$FIX/timesyncd"; inst --dry-run; c=$?
[ $c -eq 0 ] && [ ! -d "$T/root" ] && [ ! -f "$FIX/log" ] && grep -q 'would' "$T/out"; check "dry run changes nothing" $?
reset; touch "$FIX/timesyncd"; inst; inst; c=$?; [ $c -eq 0 ]; check "idempotent: a second run works" $?

heal() { "$HERE/swarm-heal.sh" > "$T/out" 2>&1; }
reset; echo active > "$FIX/swarm"; echo yes > "$FIX/synced"; heal; [ ! -f "$FIX/log" ]; check "heal: swarm active → nothing" $?
reset; echo error > "$FIX/swarm"; echo no > "$FIX/synced"; heal; [ ! -f "$FIX/log" ] && grep -q 'not synchronised' "$T/out"; check "heal: swarm error but clock not synced → waits, no restart" $?
reset; echo error > "$FIX/swarm"; echo yes > "$FIX/synced"; heal; grep -q 'systemctl restart docker' "$FIX/log"; check "heal: swarm error and clock synced → restarts docker" $?
reset; echo pending > "$FIX/swarm"; echo yes > "$FIX/synced"; heal; [ ! -f "$FIX/log" ]; check "heal: any other state (pending, inactive) → hands off" $?

echo; echo "$PASS passed, $FAILED failed"; [ "$FAILED" -eq 0 ]
