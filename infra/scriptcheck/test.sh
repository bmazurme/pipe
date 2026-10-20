#!/usr/bin/env bash
#
# Tests for check-scripts.sh with a fake curl (no network):  bash infra/scriptcheck/test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0
mkdir -p "$T/bin" "$T/repo/infra/backup" "$T/repo/infra/notify" "$T/board"
export PATH="$T/bin:$PATH"

# serves $T/repo/<path> as if it were raw.githubusercontent.com/<owner>/<repo>/main/<path>; `FAKE_DOWN=1` makes GitHub unreachable
cat > "$T/bin/curl" <<'SH'
#!/usr/bin/env bash
out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; -*) shift;; *) url="$1"; shift;; esac; done
[ -z "${FAKE_DOWN:-}" ] || exit 7
path="${url#"$RAW_BASE"/}"
[ -f "$FAKE_REPO/$path" ] || exit 22
cp "$FAKE_REPO/$path" "$out"
SH
chmod +x "$T/bin/curl"
cat > "$T/bin/alert" <<'SH'
#!/usr/bin/env bash
printf '%s\n---\n' "$1" >> "$ALERTS"
SH
chmod +x "$T/bin/alert"

export FAKE_REPO="$T/repo" RAW_BASE="https://raw.example/o/r/main" ALERTS="$T/alerts" STATE_DIR="$T/state"
export ALERT_CMD="$T/bin/alert" SCRIPTCHECK_HOST="ubuntu-red" REPEAT_HOURS=24 SCRIPTCHECK_NOW=1000000
export SCRIPTCHECK_MANIFEST="$T/manifest"

# what the "board" has installed, and what the "repository" has
printf 'echo pull v2\n' > "$T/repo/infra/backup/uploads-pull.sh"
printf 'echo backup v1\n' > "$T/repo/infra/backup/backup.sh"
printf 'echo notify v1\n' > "$T/repo/infra/notify/notify-telegram"
printf '%s|infra/backup/uploads-pull.sh\n%s|infra/backup/backup.sh\n%s|infra/notify/notify-telegram\n%s|infra/backup/not-on-this-board.sh\n' \
  "$T/board/uploads-pull.sh" "$T/board/backup.sh" "$T/board/notify-telegram" "$T/board/not-installed.sh" > "$T/manifest"

install_board() { printf 'echo pull %s\n' "$1" > "$T/board/uploads-pull.sh"; cp "$T/repo/infra/backup/backup.sh" "$T/board/backup.sh"; cp "$T/repo/infra/notify/notify-telegram" "$T/board/notify-telegram"; }
run() { "$HERE/check-scripts.sh" "$@" > "$T/stdout" 2> "$T/stderr"; echo $? > "$T/code"; }
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/stdout" "$T/stderr"; fi; }
fresh() { rm -rf "$T/state" "$T/alerts"; }
alerts() { if [ -f "$T/alerts" ]; then grep -c -- '^---$' "$T/alerts"; else echo 0; fi; }

fresh; install_board v2; run
[ "$(cat "$T/code")" = 0 ] && [ "$(alerts)" = 0 ]; check "everything current: exit 0, no message" $?

fresh; install_board v1; run
[ "$(cat "$T/code")" = 0 ] && [ "$(alerts)" = 1 ] && grep -q 'ubuntu-red' "$T/alerts" && grep -q 'uploads-pull.sh' "$T/alerts" && ! grep -q 'backup.sh (' "$T/alerts"; check "an outdated script is named, with the board, and only that one" $?
grep -q 'infra/backup' "$T/alerts" && grep -q 'install' "$T/alerts"; check "…and the message says where to look to update it" $?

run
[ "$(alerts)" = 1 ]; check "the same state is not announced again" $?

SCRIPTCHECK_NOW=$((1000000 + 25 * 3600)) run
[ "$(alerts)" = 2 ]; check "…but is repeated once a day while it stays outdated" $?

printf 'echo backup v2\n' > "$T/repo/infra/backup/backup.sh"; SCRIPTCHECK_NOW=$((1000000 + 25 * 3600 + 60)) run
[ "$(alerts)" = 3 ] && grep -q 'backup.sh' "$T/alerts"; check "a second outdated script is news at once" $?

install_board v2; SCRIPTCHECK_NOW=$((1000000 + 26 * 3600)) run
[ "$(alerts)" = 4 ] && tail -3 "$T/alerts" | grep -q 'снова актуальны'; check "when everything is current again it says so, once" $?
SCRIPTCHECK_NOW=$((1000000 + 27 * 3600)) run
[ "$(alerts)" = 4 ]; check "…and then stays quiet" $?

fresh; install_board v1; FAKE_DOWN=1 run
[ "$(cat "$T/code")" = 0 ] && [ "$(alerts)" = 0 ] && grep -q 'nothing compared' "$T/stdout"; check "GitHub unreachable: logged, exit 0, no message" $?

fresh; rm -f "$T/repo/infra/backup/uploads-pull.sh"; install_board v1; run
[ "$(alerts)" = 0 ]; check "a script the repository no longer has is not reported as outdated" $?
printf 'echo pull v2\n' > "$T/repo/infra/backup/uploads-pull.sh"

fresh; install_board v1; run --status
grep -q 'STALE  uploads-pull.sh' "$T/stdout" && grep -q 'ok     backup.sh' "$T/stdout" && ! grep -q 'not-installed' "$T/stdout" && [ "$(alerts)" = 0 ]; check "--status lists what the board has, current or not, and sends nothing" $?

fresh; install_board v1; ALERT_CMD="" run
[ "$(cat "$T/code")" = 0 ]; check "no ALERT_CMD: still exit 0 (the check only logs)" $?

fresh; install_board v1; STATE_DIR="/proc/nope/state" run
[ "$(cat "$T/code")" = 0 ] && grep -q 'cannot write' "$T/stdout"; check "an unwritable state directory: said so, exit 0" $?

# the built-in list: every repository path it names must exist (a renamed script would otherwise silently stop being checked)
ROOT="$(cd "$HERE/../.." && pwd)"
missing="$(sed -n "/cat <<'LIST'/,/^LIST$/p" "$HERE/check-scripts.sh" | grep '|' | cut -d'|' -f2 | while read -r path; do [ -f "$ROOT/$path" ] || echo "$path"; done)"
[ -z "$missing" ]; check "every script in the built-in list exists in the repository${missing:+ — missing: $missing}" $?

echo; echo "passed $PASS, failed $FAILED"
[ "$FAILED" -eq 0 ]
