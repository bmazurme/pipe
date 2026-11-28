#!/usr/bin/env bash
#
# Tests for key-check.sh with a fake ssh / curl and REAL age (the point of the check is that age says yes or no): nothing outside a temp directory.
#   bash infra/backup/test-key-check.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

if ! command -v age >/dev/null 2>&1 || ! command -v age-keygen >/dev/null 2>&1; then
  echo "skip: age is not installed (brew install age / apt install age)"
  exit 0
fi

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0

sum() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

cat > "$T/ssh" <<'SH'
#!/usr/bin/env bash
[ -z "${FAKE_SSH_DOWN:-}" ] || exit 255
tar -C "$FAKE_LATEST" -c .
SH
cat > "$T/curl" <<'SH'
#!/usr/bin/env bash
[ -z "${FAKE_CURL_FAIL:-}" ] || exit 7
echo "$*" >> "$CURL_LOG"
for a in "$@"; do case "$a" in @*) cat "${a#@}" > "$POSTED";; esac; done
echo "${FAKE_HTTP:-204}"
SH
chmod +x "$T/ssh" "$T/curl"
export SSH="$T/ssh" CURL="$T/curl" CURL_LOG="$T/curl.log" POSTED="$T/posted.json"
export KEYCHECK_ENV="$T/none.env" BRIDGE_URL="http://bridge.test" BRIDGE_API_KEY="boards-key"
unset SOURCE_HOST

age-keygen -o "$T/key-a.txt" 2>/dev/null
age-keygen -o "$T/key-b.txt" 2>/dev/null
pub_a="$(grep -o 'age1[a-z0-9]*' "$T/key-a.txt" | head -1)"

BK="$T/bk"; export BACKUP_DIR="$BK"

make_backup() { # encrypted(yes|no) header
  rm -rf "$BK"; mkdir -p "$BK/snapshots/s1"
  printf '%s rest of a dump\n' "${2:-PGDMP}" > "$T/plain.dump"
  local f=db.dump
  if [ "${1:-yes}" = yes ]; then age -r "$pub_a" -o "$BK/snapshots/s1/db.dump.age" "$T/plain.dump"; f=db.dump.age; else cp "$T/plain.dump" "$BK/snapshots/s1/db.dump"; fi
  (cd "$BK/snapshots/s1" && sum "$f" > "$f.sha256")
  printf 'CREATED=20261209T030000Z\nRAW_BYTES=7\nTABLES_WITH_DATA=1\nFILE=%s\nENCRYPTED=%s\n' "$f" "${1:-yes}" > "$BK/snapshots/s1/meta.env"
  ln -s snapshots/s1 "$BK/latest"
}

reset() { rm -f "$T/out" "$CURL_LOG" "$POSTED"; : > "$CURL_LOG"; unset FAKE_SSH_DOWN FAKE_CURL_FAIL FAKE_HTTP; }
run() { "$HERE/key-check.sh" "$@" >"$T/out" 2>&1; }
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/out"; fi; }
posted_has() { grep -q -- "$1" "$POSTED" 2>/dev/null; }

make_backup yes

reset; run --label mac --identity "$T/key-a.txt"; check "the right key opens the newest backup (exit 0)" $?
posted_has '"label":"mac"' && posted_has '"ok":true' && posted_has '"backupCreatedAt":"20261209T030000Z"'; check "…and the report says which copy, ok, and which backup" $?
grep -q -- "-H X-Api-Key: boards-key" "$CURL_LOG" && grep -q "/api/v1/boards/agent/key-check" "$CURL_LOG"; check "…goes to the boards-agent route with the key" $?
! grep -q "AGE-SECRET-KEY" "$T/out" "$POSTED"; check "…and the key itself is nowhere in the output or the report" $?

reset; run --label usb --identity "$T/key-b.txt"; [ $? -eq 1 ]; check "a different key fails (exit 1)" $?
posted_has '"ok":false' && posted_has 'does not open the backup'; check "…and the failure is reported with a reason" $?

reset; run --label paper --identity "$T/missing.txt"; [ $? -eq 1 ]; check "a missing key file fails" $?
posted_has 'not readable'; check "…and says it is not readable" $?

echo "not a key" > "$T/notakey.txt"
reset; run --label paper --identity "$T/notakey.txt"; [ $? -eq 1 ]; check "a file that is not an age identity fails" $?
posted_has 'not an age identity'; check "…and says so" $?

# the backup itself is the problem, not the key
make_backup yes; echo tampered >> "$BK/latest/db.dump.age"
reset; run --label mac --identity "$T/key-a.txt"; [ $? -eq 1 ]; check "a damaged backup fails the check" $?
posted_has 'checksum mismatch' && posted_has 'says nothing about the key'; check "…and says the copy of the BACKUP is what is damaged" $?

make_backup yes PLAINTEXT
reset; run --label mac --identity "$T/key-a.txt"; [ $? -eq 1 ]; check "a decrypted file that is not a Postgres dump fails" $?
posted_has 'PGDMP'; check "…and names the missing header" $?

make_backup no
reset; run --label mac --identity "$T/key-a.txt"; [ $? -eq 0 ]; check "an unencrypted backup: nothing to check, exit 0" $?
[ ! -s "$CURL_LOG" ] && grep -q "not encrypted" "$T/out"; check "…nothing reported, and it says why" $?

make_backup yes
reset; ( unset BACKUP_DIR; export SOURCE_HOST=10.0.0.9 FAKE_SSH_DOWN=1; run --label mac --identity "$T/key-a.txt" ); [ $? -eq 3 ]; check "source unreachable → skipped (exit 3)" $?
[ ! -s "$CURL_LOG" ]; check "…and nothing is reported" $?
reset; export FAKE_LATEST="$BK/latest"; ( unset BACKUP_DIR; export SOURCE_HOST=10.0.0.9; run --label mac --identity "$T/key-a.txt" ); check "from a remote board over ssh it works" $?

reset; FAKE_CURL_FAIL=1 run --label mac --identity "$T/key-a.txt"; [ $? -eq 2 ]; check "a report that cannot be delivered → exit 2" $?
reset; ( unset BRIDGE_URL BRIDGE_API_KEY; run --label mac --identity "$T/key-a.txt" ); [ $? -eq 0 ]; check "without BRIDGE_URL it only prints" $?

reset; run --identity "$T/key-a.txt"; [ $? -eq 64 ]; check "no --label is a usage error" $?
reset; run --label 'bad;label' --identity "$T/key-a.txt"; [ $? -eq 64 ]; check "a label with odd characters is refused" $?
reset; run --label mac; [ $? -eq 64 ]; check "no --identity is a usage error" $?

echo; echo "passed $PASS, failed $FAILED"
[ "$FAILED" -eq 0 ]
