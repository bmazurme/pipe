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
# The clock must not decide these tests: quiet hours are off except where a test turns them on with a fixed time.
export NOTIFY_QUIET_HOURS=off
export NOTIFY_QUEUE_DIR="$T/queue"

run() { "$HERE/notify-telegram" "$@" > "$T/stdout" 2> "$T/stderr"; echo $? > "$T/code"; }
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/stderr"; fi; }
fresh() { rm -f "$T/calls" "$T/argv" "$T/text" "$T/secrets"; rm -rf "$T/queue"; }
calls() { if [ -f "$T/calls" ]; then wc -l < "$T/calls" | tr -d " "; else echo 0; fi; }
held() { find "$T/queue" -type f -name "q-*" 2>/dev/null | wc -l | tr -d " "; }

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

# --- quiet hours (23:00-08:00 by default; the time is injected with NOTIFY_NOW)
fresh; NOTIFY_QUIET_HOURS=23:00-08:00 NOTIFY_NOW=03:15 run "deployed at night"
[ "$(cat "$T/code")" = 0 ] && [ "$(calls)" = 0 ] && [ "$(held)" = 1 ]; check "in the quiet hours a message is held, not sent" $?

fresh; for now in 23:00 23:59 00:00 07:59; do NOTIFY_QUIET_HOURS=23:00-08:00 NOTIFY_NOW=$now run "m $now"; done
[ "$(calls)" = 0 ] && [ "$(held)" = 4 ]; check "the window wraps midnight: 23:00, 23:59, 00:00 and 07:59 are all quiet" $?

fresh; NOTIFY_QUIET_HOURS=23:00-08:00 NOTIFY_NOW=08:00 run "morning"
[ "$(calls)" = 1 ] && [ "$(cat "$T/text")" = morning ]; check "08:00 is already out of the quiet hours: sent at once" $?

fresh; NOTIFY_QUIET_HOURS=23:00-08:00 NOTIFY_NOW=14:00 run "daytime"
[ "$(calls)" = 1 ]; check "daytime: sent at once" $?

fresh; NOTIFY_QUIET_HOURS=13:00-15:00 NOTIFY_NOW=14:00 run "inside a daytime window"; q1="$(held)"
NOTIFY_QUIET_HOURS=13:00-15:00 NOTIFY_NOW=12:00 run "outside it"
[ "$q1" = 1 ] && [ "$(calls)" = 2 ]; check "a window that does not wrap midnight works too (and flushes before the next message)" $?

fresh; NOTIFY_QUIET_HOURS=off NOTIFY_NOW=03:00 run "always"
[ "$(calls)" = 1 ] && [ "$(held)" = 0 ]; check "NOTIFY_QUIET_HOURS=off sends at any hour" $?

fresh; NOTIFY_QUIET_HOURS=23:00-08:00 NOTIFY_NOW=02:00 run "first"; NOTIFY_QUIET_HOURS=23:00-08:00 NOTIFY_NOW=03:00 run "second"
NOTIFY_QUIET_HOURS=23:00-08:00 NOTIFY_NOW=09:00 run "after"
[ "$(calls)" = 2 ] && [ "$(held)" = 0 ]; check "the first message after the window sends ONE digest, then itself, and empties the queue" $?

fresh; NOTIFY_QUIET_HOURS=23:00-08:00 NOTIFY_NOW=02:00 run "first one"; NOTIFY_QUIET_HOURS=23:00-08:00 NOTIFY_NOW=03:00 run "second one"
NOTIFY_QUIET_HOURS=23:00-08:00 NOTIFY_NOW=09:00 run --flush
grep -q 'тихие часы (2)' "$T/text" && grep -q 'first one' "$T/text" && grep -q 'second one' "$T/text" && [ "$(calls)" = 1 ]; check "--flush sends the held messages as one digest with a count" $?

fresh; NOTIFY_QUIET_HOURS=23:00-08:00 NOTIFY_NOW=02:00 run "kept"
NOTIFY_QUIET_HOURS=23:00-08:00 NOTIFY_NOW=03:00 run --flush
[ "$(calls)" = 0 ] && [ "$(held)" = 1 ]; check "--flush inside the quiet hours does nothing" $?

fresh; NOTIFY_QUIET_HOURS=23:00-08:00 NOTIFY_NOW=02:00 run "kept until it can go"
FAKE_OUT='{"ok":false}' NOTIFY_QUIET_HOURS=23:00-08:00 NOTIFY_NOW=09:00 run --flush
[ "$(held)" = 1 ]; check "a digest that did not go out stays queued for the next try" $?

fresh; mkdir -p "$T/ro" && chmod 500 "$T/ro"
NOTIFY_QUEUE_DIR="$T/ro/queue" NOTIFY_QUIET_HOURS=23:00-08:00 NOTIFY_NOW=03:00 run "cannot be queued"
chmod 700 "$T/ro"
[ "$(calls)" = 1 ] && [ "$(cat "$T/text")" = "cannot be queued" ]; check "a queue that cannot be written to never loses the message: it is sent at once" $?

echo; echo "passed $PASS, failed $FAILED"
[ "$FAILED" -eq 0 ]
