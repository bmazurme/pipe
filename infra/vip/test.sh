#!/usr/bin/env bash
#
# Tests for install.sh (--dry-run, fake ip/ping) and the two keepalived scripts (fake docker/notify):
#   docker run --rm -v "$PWD/../..":/r debian:bookworm-slim bash /r/infra/vip/test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0; BIN="$T/bin"; FIX="$T/fix"; mkdir -p "$BIN" "$FIX"; export PATH="$BIN:$PATH" FIX
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/out"; fi; }

cat > "$BIN/ip" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *"route get"*) echo "192.168.50.12 dev eth0 src 192.168.50.11 uid 1000";;
  *"addr show"*) [ -f "$FIX/holds-vip" ] && echo "2: eth0 inet 192.168.50.10/24 scope global eth0";;
esac
SH
cat > "$BIN/ping" <<'SH'
#!/usr/bin/env bash
[ -f "$FIX/vip-answers" ]
SH
cat > "$BIN/docker" <<'SH'
#!/usr/bin/env bash
[ -f "$FIX/caddy-running" ] && echo abc123
exit 0
SH
cat > "$BIN/systemctl" <<'SH'
#!/usr/bin/env bash
[ -f "$FIX/ka-running" ]
SH
cat > "$BIN/hostname" <<'SH'
#!/usr/bin/env bash
echo ubuntu-white
SH
chmod +x "$BIN"/*

inst() { "$HERE/install.sh" "$@" > "$T/out" 2>&1; }

rm -f "$FIX"/*; inst --dry-run; [ $? -ne 0 ] && grep -q -- '--peer' "$T/out"; check "no peer: refused" $?
rm -f "$FIX"/*; inst --dry-run --peer 192.168.50.12; c=$?
[ $c -eq 0 ] && grep -q 'unicast_src_ip 192.168.50.11' "$T/out" && grep -q '192.168.50.10/24 dev eth0' "$T/out" && grep -q 'interface eth0' "$T/out"; check "renders interface, own address, VIP, peer" $?
grep -qE '^\s+192\.168\.50\.12$' "$T/out" && ! grep -q '@' "$T/out"; check "…every placeholder filled, peer listed" $?
grep -q 'weight -50' "$T/out" && ! grep -qE '^\s+nopreempt' "$T/out"; check "…the Caddy check lowers priority, and preempt is on (the Caddy holder must be able to take the address)" $?
rm -f "$FIX"/*; touch "$FIX/vip-answers"; inst --dry-run --peer 192.168.50.12; [ $? -ne 0 ] && grep -q 'already answers' "$T/out"; check "a VIP that already answers is refused" $?
rm -f "$FIX"/*; touch "$FIX/vip-answers" "$FIX/holds-vip"; inst --dry-run --peer 192.168.50.12; [ $? -eq 0 ]; check "…unless this board already holds it (re-run)" $?
rm -f "$FIX"/*; touch "$FIX/vip-answers" "$FIX/ka-running"; inst --dry-run --peer 192.168.50.12; [ $? -eq 0 ]; check "…or keepalived already runs here (a re-run to change the config while the other board holds the address)" $?
rm -f "$FIX"/*; inst --dry-run --peer 192.168.50.12 --vip 192.168.50.11; [ $? -ne 0 ] && grep -q 'equals this board' "$T/out"; check "VIP equal to the board's own address: refused" $?
rm -f "$FIX"/*; inst --peer 192.168.50.12 >/dev/null 2>&1 </dev/null; [ "$(id -u)" = 0 ] || [ $? -ne 0 ]; check "without --dry-run needs root" $?

rm -f "$FIX"/*; "$HERE/vip-check-caddy"; [ $? -ne 0 ]; check "check script: no Caddy here → unhealthy" $?
touch "$FIX/caddy-running"; "$HERE/vip-check-caddy"; check "check script: Caddy running → healthy" $?

mkdir -p "$T/usr"; cat > "$BIN/notify-telegram" <<'SH'
#!/usr/bin/env bash
echo "$1" >> "$FIX/sent"
SH
chmod +x "$BIN/notify-telegram"
"$HERE/vip-notify" INSTANCE x >/dev/null 2>&1; [ $? -eq 0 ]; check "notify script ignores states it does not know and never fails" $?
NOTIFY_TELEGRAM="$BIN/notify-telegram" "$HERE/vip-notify" MASTER 192.168.50.10; grep -q 'ubuntu-white.*192.168.50.10' "$FIX/sent"; check "notify MASTER sends the message with the board and the VIP" $?
rm -f "$FIX"/*; inst --dry-run --peer 192.168.50.12; grep -q 'notify_master "/usr/local/bin/vip-notify MASTER 192.168.50.10"' "$T/out"; check "the config passes state and VIP to the notify script explicitly" $?
echo; echo "$PASS passed, $FAILED failed"; [ "$FAILED" -eq 0 ]
