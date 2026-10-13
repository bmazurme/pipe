#!/usr/bin/env bash
#
# Tests for notify-telegram with a fake docker (no network):  bash infra/notify/test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0
mkdir -p "$T/bin"
export PATH="$T/bin:$PATH"

cat > "$T/bin/docker" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$FAKE_DIR/argv"
printf '%s' "${NOTIFY_TEXT:-}" > "$FAKE_DIR/text"
printf '%s|%s' "${TELEGRAM_BOT_TOKEN:-}" "${TELEGRAM_CHAT_ID:-}" > "$FAKE_DIR/secrets"
echo x >> "$FAKE_DIR/calls"
printf '%s' "${FAKE_OUT:-{\"ok\":true,\"result\":{}}}"
SH
chmod +x "$T/bin/docker"
export FAKE_DIR="$T"
printf 'TELEGRAM_BOT_TOKEN=123456:SECRET-token_abc\nTELEGRAM_CHAT_ID=42\n' > "$T/notify.env"
export NOTIFY_ENV_FILE="$T/notify.env"

run() { "$HERE/notify-telegram" "$@" > "$T/stdout" 2> "$T/stderr"; echo $? > "$T/code"; }
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/stderr"; fi; }
fresh() { rm -f "$T/calls" "$T/argv" "$T/text" "$T/secrets"; }

fresh; run "hello"
[ "$(cat "$T/code")" = 0 ] && [ ! -s "$T/stderr" ]; check "a delivered message: exit 0, nothing on stderr" $?
[ "$(cat "$T/secrets")" = '123456:SECRET-token_abc|42' ]; check "the token and chat id reach the container as environment variables" $?
! grep -q 'SECRET-token' "$T/argv"; check "the token is NOT on the docker command line" $?
grep -qx 'telegram-proxy-net' "$T/argv" && grep -q 'NOTIFY_PROXY=http://vpn-client:1080' "$T/argv"; check "it joins the shared network and uses the VPN proxy" $?

fresh; msg=$'multi\nline "quoted" $HOME `ls` ✅ кириллица'; run "$msg"
[ "$(cat "$T/text")" = "$msg" ]; check "newlines, quotes, \$ and backticks, emoji and Cyrillic arrive unchanged" $?

fresh; long="$(head -c 6000 /dev/zero | tr '\0' 'a')"; run "$long"
[ "$(wc -c < "$T/text" | tr -d ' ')" = 4000 ]; check "a text longer than Telegram's limit is cut to 4000 characters" $?

fresh; FAKE_OUT='{"ok":false,"description":"chat not found"}' run "x"
[ "$(cat "$T/code")" = 0 ]; check "a rejected message still exits 0 (an alert must not break its caller)" $?
grep -q 'not delivered' "$T/stderr"; check "…and says so on stderr" $?

fresh; FAKE_OUT='curl: (7) Failed to connect to https://api.telegram.org/bot123456:SECRET-token_abc/sendMessage' run "x"
! grep -q 'SECRET-token' "$T/stderr" && grep -q 'bot<token>' "$T/stderr"; check "a token echoed back in an error is masked in the log" $?

fresh; NOTIFY_ENV_FILE="$T/missing.env" run "x"
[ "$(cat "$T/code")" = 0 ] && grep -q 'cannot read' "$T/stderr" && [ ! -f "$T/calls" ]; check "no settings file: says so, exit 0, no container started" $?

fresh; printf 'TELEGRAM_BOT_TOKEN=abc\n' > "$T/partial.env"; NOTIFY_ENV_FILE="$T/partial.env" run "x"
[ "$(cat "$T/code")" = 0 ] && grep -q 'missing' "$T/stderr" && [ ! -f "$T/calls" ]; check "a missing chat id is reported, nothing sent" $?

fresh; run
[ "$(cat "$T/code")" = 0 ] && grep -q usage "$T/stderr" && [ ! -f "$T/calls" ]; check "no text: usage, nothing sent" $?

echo; echo "passed $PASS, failed $FAILED"
[ "$FAILED" -eq 0 ]
