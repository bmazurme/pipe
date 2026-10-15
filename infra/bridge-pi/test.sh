#!/usr/bin/env bash
#
# Tests for secrets.sh with HOME pointed at a temp dir (the real ~/.pipe is never touched):  bash infra/bridge-pi/test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0
export HOME="$T/home"
mkdir -p "$HOME"
FILE="$HOME/.pipe/bridge.env"
# a fake openssl: the test needs neither the real binary nor real randomness
mkdir -p "$T/bin"
printf '#!/usr/bin/env bash\necho "fake-$RANDOM$RANDOM$RANDOM$RANDOM"\n' > "$T/bin/openssl"
chmod +x "$T/bin/openssl"
export PATH="$T/bin:$PATH"

run() { bash "$HERE/secrets.sh" "$@" > "$T/stdout" 2> "$T/stderr"; echo $? > "$T/code"; }
setv() { printf '%s\n' "$2" | bash "$HERE/secrets.sh" set "$1" > "$T/stdout" 2> "$T/stderr"; echo $? > "$T/code"; }
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/stderr"; fi; }
mode() { stat -c %a "$FILE" 2>/dev/null || stat -f %Lp "$FILE"; }
val() { grep "^$1=" "$FILE" | cut -d= -f2-; }

run init
[ "$(cat "$T/code")" = 0 ]; check "init: exit 0" $?
n=0; for k in POSTGRES_PASSWORD JWT_SECRET REFRESH_JWT_SECRET CREDENTIALS_ENC_KEY; do [ "$(grep -c "^$k=." "$FILE")" = 1 ] && n=$((n + 1)); done
[ "$n" = 4 ]; check "init: generates all four keys, one line each" $?
[ "$(mode)" = 600 ]; check "init: file is mode 600" $?

cp "$FILE" "$T/before"
run init
cmp -s "$FILE" "$T/before" && grep -q 'already set' "$T/stdout"; check "a second init leaves the keys byte-identical" $?
[ "$(mode)" = 600 ]; check "second init: file is mode 600" $?

setv YANDEX_ID first
[ "$(cat "$T/code")" = 0 ] && [ "$(val YANDEX_ID)" = first ] && [ "$(mode)" = 600 ]; check "set stores a value, file stays mode 600" $?
setv YANDEX_ID second
[ "$(cat "$T/code")" = 0 ] && [ "$(grep -c '^YANDEX_ID=' "$FILE")" = 1 ] && [ "$(val YANDEX_ID)" = second ]; check "set replaces an existing key without duplicating the line" $?
cmp -s <(grep -v '^YANDEX_ID=' "$FILE") "$T/before"; check "set leaves the other keys untouched" $?
[ "$(mode)" = 600 ]; check "after replacing: file is mode 600" $?

cp "$FILE" "$T/before_reject"
setv YANDEX_ID ""
[ "$(cat "$T/code")" = 1 ] && cmp -s "$FILE" "$T/before_reject"; check "set rejects an empty value: exit 1, file unchanged" $?
setv YANDEX_ID "   "
[ "$(cat "$T/code")" = 1 ] && cmp -s "$FILE" "$T/before_reject"; check "set rejects a whitespace-only value: exit 1, file unchanged" $?
setv YANDEX_ID "abc def"
[ "$(cat "$T/code")" = 1 ] && cmp -s "$FILE" "$T/before_reject"; check "set rejects a value with inner whitespace: exit 1, file unchanged" $?
setv YANDEX_ID $'abc\tdef'
[ "$(cat "$T/code")" = 1 ] && cmp -s "$FILE" "$T/before_reject"; check "set rejects a value with a tab: exit 1, file unchanged" $?
[ "$(mode)" = 600 ]; check "after rejections: file is mode 600" $?

run check
out="$(cat "$T/stdout" "$T/stderr")"
[ "$(cat "$T/code")" = 0 ] && grep -q 'MISSING  YANDEX_SECRET' "$T/stdout" && grep -q 'set      YANDEX_ID' "$T/stdout"; check "check reports set and missing keys by name" $?
rm -f "$FILE"; bash "$HERE/secrets.sh" init > /dev/null 2>&1; run check
grep -q 'MISSING  YANDEX_ID' "$T/stdout"; check "check output contains MISSING YANDEX_ID" $?
setv YANDEX_SECRET "s3cr3t-value_XYZ"; run check
leak=0; out="$(cat "$T/stdout" "$T/stderr")"
while IFS='=' read -r _ v; do [ -n "$v" ] && case "$out" in *"$v"*) leak=1;; esac; done < "$FILE"
[ "$leak" = 0 ] && grep -q 'set      YANDEX_SECRET' "$T/stdout"; check "check never prints any stored value" $?
[ "$(mode)" = 600 ]; check "after check: file is mode 600" $?

[ -z "$(find "$HOME/.pipe" -name '.env.*')" ]; check "no temp files left behind in the secrets dir" $?

run bogus
[ "$(cat "$T/code")" = 2 ]; check "an unknown command: usage, exit 2" $?

echo; echo "passed $PASS, failed $FAILED"
[ "$FAILED" -eq 0 ]
