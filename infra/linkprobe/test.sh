#!/usr/bin/env bash
#
# Tests for the channel probe: probe.py's own unit tests (real local sockets, a fake bridge) and install.sh with a fake systemctl.
# Nothing outside a temp directory is touched:  bash infra/linkprobe/test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0; BIN="$T/bin"; FIX="$T/fix"; mkdir -p "$BIN" "$FIX"; export PATH="$BIN:$PATH" FIX
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/out" 2>/dev/null | head -14; fi; }
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$*" >> "$FIX/systemctl"\n' > "$BIN/systemctl"; chmod +x "$BIN/systemctl"

( cd "$HERE" && python3 -m unittest discover -s . -p 'test_probe.py' ) > "$T/out" 2>&1
tail -3 "$T/out" | grep -q "^OK"; check "probe.py: unit tests (classification, real sockets, the whole run against a fake bridge)" $?

R="$T/root"; mkdir -p "$R"
ROOT="$R" bash "$HERE/install.sh" > "$T/out" 2>&1
[ -x "$R/usr/local/lib/pipe-linkprobe/probe.py" ]; check "install: puts probe.py in place" $?
[ "$(stat -c %a "$R/etc/pipe-linkprobe.env" 2>/dev/null || stat -f %Lp "$R/etc/pipe-linkprobe.env")" = "600" ]; check "install: the settings file is mode 600" $?
grep -q '^BRIDGE_API_KEY=$' "$R/etc/pipe-linkprobe.env"; check "install: the template leaves the key empty for you" $?
( set -a; . "$R/etc/pipe-linkprobe.env"; echo "$BRIDGE_API_URL" ) > "$T/out" 2>&1; grep -q "https://api.bridge.ntlstl.dev" "$T/out"; check "install: the template can be sourced by a shell" $?
grep -q 'EnvironmentFile=-/etc/pipe-linkprobe.env' "$R/etc/systemd/system/pipe-linkprobe.service" && grep -q 'OnUnitActiveSec=1min' "$R/etc/systemd/system/pipe-linkprobe.timer" && grep -q 'enable --now pipe-linkprobe.timer' "$FIX/systemctl"; check "install: a one-minute timer reading the settings file is enabled" $?
echo 'BRIDGE_API_KEY=mine' > "$R/etc/pipe-linkprobe.env"; ROOT="$R" bash "$HERE/install.sh" > "$T/out" 2>&1
grep -q 'BRIDGE_API_KEY=mine' "$R/etc/pipe-linkprobe.env"; check "install: an existing settings file is never overwritten" $?
ROOT="$R" bash "$HERE/install.sh" --remove > "$T/out" 2>&1
[ ! -e "$R/usr/local/lib/pipe-linkprobe" ] && [ ! -e "$R/etc/systemd/system/pipe-linkprobe.timer" ] && [ -f "$R/etc/pipe-linkprobe.env" ]; check "install --remove: takes the probe away, leaves the settings (and the key) for you" $?
R2="$T/root2"; mkdir -p "$R2"; ROOT="$R2" bash "$HERE/install.sh" --dry-run > "$T/out" 2>&1
[ ! -e "$R2/usr" ] && grep -q would "$T/out"; check "install --dry-run: changes nothing" $?

echo; echo "$PASS passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
