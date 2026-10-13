#!/usr/bin/env bash
#
# Tests for check.sh with a fake docker — nothing is touched:
#   docker run --rm -v "$PWD/../..":/r debian:bookworm-slim bash /r/infra/standby/test-check.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0; BIN="$T/bin"; FIX="$T/fix"; mkdir -p "$BIN" "$FIX"; export PATH="$BIN:$PATH" FIX
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/out"; fi; }
cat > "$BIN/docker" <<'SH'
#!/usr/bin/env bash
case "$1" in
  ps) echo abc123;;
  exec) cat "$FIX/status";;
  node) cat "$FIX/label";;
esac
SH
chmod +x "$BIN/docker"
alerts="$T/alerts"; cat > "$BIN/alert" <<'SH'
#!/usr/bin/env bash
echo "$1" >> "$FIX/alerts"
SH
chmod +x "$BIN/alert"
run() { ALERT_CMD="$BIN/alert" "$HERE/check.sh" > "$T/out" 2>&1; }
reset() { rm -f "$FIX"/*; }

reset; echo 't|streaming|5' > "$FIX/status"; run; [ $? -eq 0 ] && [ ! -f "$FIX/alerts" ]; check "a streaming replica: ok, no alert" $?
reset; echo 'f|none|-1' > "$FIX/status"; echo "" > "$FIX/label"; run; [ $? -ne 0 ] && grep -q 'NOT in recovery' "$FIX/alerts"; check "promoted by surprise (no failover label): alert" $?
reset; echo 'f|none|-1' > "$FIX/status"; echo "active" > "$FIX/label"; run; [ $? -eq 0 ] && [ ! -f "$FIX/alerts" ] && grep -q 'on purpose' "$T/out"; check "promoted on purpose (failover=active): no alert" $?
reset; echo 't|startup|-1' > "$FIX/status"; run; [ $? -ne 0 ] && grep -q "not streaming" "$FIX/alerts"; check "a replica that is not streaming: alert" $?
reset; echo 't|streaming|900' > "$FIX/status"; run; [ $? -ne 0 ] && grep -q "silent" "$FIX/alerts"; check "a silent primary: alert" $?
echo; echo "$PASS passed, $FAILED failed"; [ "$FAILED" -eq 0 ]
