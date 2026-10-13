#!/usr/bin/env bash
#
# Tests for copy-to-board.sh with a fake ssh/scp — no board is touched:
#   docker run --rm -v "$PWD/../..":/r debian:bookworm-slim bash /r/infra/notify/test-copy.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0; BIN="$T/bin"; FIX="$T/fix"; mkdir -p "$BIN" "$FIX"; export PATH="$BIN:$PATH" FIX
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/out" | head -8; fi; }
SECRET="TELEGRAM_BOT_TOKEN=123:SECRETVALUE"
cat > "$BIN/ssh" <<'SH'
#!/usr/bin/env bash
args=("$@"); host=""; cmd=""
for i in "${!args[@]}"; do case "${args[$i]}" in pi@*) host="${args[$i]#pi@}"; cmd="${args[*]:$((i+1))}"; break;; esac; done
echo "$host: $cmd" >> "$FIX/log"
case "$cmd" in
  true) [ ! -f "$FIX/down-$host" ];;
  "sudo test -s /etc/pipe-notify.env") [ ! -f "$FIX/no-source" ];;
  "sudo cat /etc/pipe-notify.env") echo "$SECRET";;
  *"/dev/stdin"*) cat > "$FIX/received-$host";;
  */usr/local/bin/notify-telegram\ \"*) [ ! -f "$FIX/send-fails" ];;
esac
SH
cat > "$BIN/scp" <<'SH'
#!/usr/bin/env bash
echo "scp $*" >> "$FIX/log"
SH
chmod +x "$BIN"/*
export SECRET
run() { "$HERE/copy-to-board.sh" "$@" > "$T/out" 2>&1; }
reset() { rm -rf "$FIX"/*; }

reset; run; [ $? -eq 2 ]; check "no target: usage" $?
reset; touch "$FIX/no-source"; run 192.168.50.13; [ $? -ne 0 ] && grep -q 'has no' "$T/out"; check "a source without the settings: refused" $?
reset; touch "$FIX/down-192.168.50.13"; run 192.168.50.13; [ $? -ne 0 ] && grep -q 'does not answer' "$T/out"; check "a target that does not answer: refused" $?
reset; run 192.168.50.13 192.168.50.14; c=$?
[ $c -eq 0 ] && [ "$(cat "$FIX/received-192.168.50.13")" = "$SECRET" ] && [ "$(cat "$FIX/received-192.168.50.14")" = "$SECRET" ]; check "the settings reach every target through the pipe" $?
! grep -q 'SECRETVALUE' "$T/out" && ! grep -q 'SECRETVALUE' "$FIX/log"; check "the secret is never printed and never on a command line" $?
grep -q 'install -m 640 -o root -g pi /dev/stdin /etc/pipe-notify.env' "$FIX/log"; check "the file lands root:pi mode 640" $?
grep -q 'install -m 755 /tmp/notify-telegram' "$FIX/log"; check "notify-telegram itself is installed" $?
reset; run 192.168.50.11; grep -q 'skipping' "$T/out" && ! grep -q 'dev/stdin' "$FIX/log"; check "the source board is skipped" $?
reset; touch "$FIX/send-fails"; run 192.168.50.13; [ $? -eq 0 ] && grep -q 'test message did not go out' "$T/out"; check "a failing test message is reported without failing the install" $?
echo; echo "$PASS passed, $FAILED failed"; [ "$FAILED" -eq 0 ]
