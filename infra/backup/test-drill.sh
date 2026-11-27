#!/usr/bin/env bash
#
# Tests for restore-drill.sh with a fake docker / ssh / curl: no Postgres, no network, nothing outside a temp directory.
#   bash infra/backup/test-drill.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0

sum() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

# --- fakes ---------------------------------------------------------------------------------------------------------------------------
cat > "$T/docker" <<'SH'
#!/usr/bin/env bash
echo "$*" >> "$DOCKER_LOG"
case "$1" in
  info) [ -z "${FAKE_DOCKER_DOWN:-}" ];;
  run|rm|cp) exit 0;;
  exec)
    shift 2
    case "$1" in
      pg_isready) exit 0;;
      pg_restore) [ -z "${FAKE_RESTORE_FAIL:-}" ] || { echo "pg_restore: error: boom" >&2; exit 1; }; exit 0;;
      psql)
        sql="${*: -1}"
        case "$sql" in
          *query_to_xml*) echo "${FAKE_TOTALS:-12|3456}";;
          *"from migrations"*) echo "${FAKE_MIGRATION:-AddRestoreDrills1800300000000}";;
          *'public."'*)
            t="${sql#*public.\"}"; t="${t%\"*}"
            [ "$t" != "${FAKE_MISSING:-}" ] || exit 1
            var="FAKE_COUNT_$t"; echo "${!var:-5}";;
          *) exit 1;;
        esac;;
    esac;;
esac
SH
cat > "$T/ssh" <<'SH'
#!/usr/bin/env bash
[ -z "${FAKE_SSH_DOWN:-}" ] || exit 255
echo "$*" >> "$SSH_LOG"
tar -C "$FAKE_LATEST" -c .
SH
cat > "$T/curl" <<'SH'
#!/usr/bin/env bash
[ -z "${FAKE_CURL_FAIL:-}" ] || exit 7
echo "$*" >> "$CURL_LOG"
for a in "$@"; do case "$a" in @*) cat "${a#@}" > "$POSTED";; esac; done
echo "${FAKE_HTTP:-204}"
SH
chmod +x "$T/docker" "$T/ssh" "$T/curl"

export DOCKER="$T/docker" SSH="$T/ssh" CURL="$T/curl"
export DOCKER_LOG="$T/docker.log" SSH_LOG="$T/ssh.log" CURL_LOG="$T/curl.log" POSTED="$T/posted.json"
export STATE_DIR="$T/state" DRILL_ENV="$T/none.env" DRILL_HOST=testhost
export BRIDGE_URL="http://bridge.test" BRIDGE_API_KEY="boards-key"
export READY_SLEEP=0
unset AGE_IDENTITY SOURCE_HOST

BK="$T/bk"; export BACKUP_DIR="$BK"

make_backup() { # encrypted? (yes|no)
  rm -rf "$BK"; mkdir -p "$BK/snapshots/s1"
  local f=db.dump
  if [ "${1:-no}" = yes ]; then
    age-keygen -o "$T/key.txt" 2>/dev/null
    age -r "$(grep -o 'age1[a-z0-9]*' "$T/key.txt" | head -1)" -o "$BK/snapshots/s1/db.dump.age" <(echo "a dump")
    f=db.dump.age
  else
    echo "a dump" > "$BK/snapshots/s1/db.dump"
  fi
  (cd "$BK/snapshots/s1" && sum "$f" > "$f.sha256")
  printf 'CREATED=20261209T030000Z\nRAW_BYTES=7\nTABLES_WITH_DATA=10\nFILE=%s\nENCRYPTED=%s\n' "$f" "${1:-no}" > "$BK/snapshots/s1/meta.env"
  ln -s snapshots/s1 "$BK/latest"
}

reset() { rm -rf "$STATE_DIR" "$T/out" "$DOCKER_LOG" "$SSH_LOG" "$CURL_LOG" "$POSTED"; : > "$DOCKER_LOG"; : > "$CURL_LOG"; unset FAKE_DOCKER_DOWN FAKE_RESTORE_FAIL FAKE_TOTALS FAKE_MISSING FAKE_COUNT_users FAKE_SSH_DOWN FAKE_CURL_FAIL FAKE_HTTP KEY_TABLES REQUIRED_TABLES; }
run() { "$HERE/restore-drill.sh" "$@" >"$T/out" 2>&1; }
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/out"; fi; }
posted_has() { grep -q "$1" "$POSTED" 2>/dev/null; }
drills() { grep -c '^run ' "$DOCKER_LOG"; }

make_backup no

# 1. a good drill
reset; run; check "a good drill exits 0" $?
posted_has '"ok":true'; check "…reports ok:true" $?
posted_has '"backupCreatedAt":"20261209T030000Z"'; check "…names the backup it restored" $?
posted_has '"tables":12,"rows":3456'; check "…reports the exact table and row totals" $?
posted_has '"counts":{"users":5,"api_keys":5,"jobs":5,"chats":5,"workers":5,"improve_runs":5}'; check "…and the key tables' counts, each once" $?
posted_has '"lastMigration":"AddRestoreDrills1800300000000"'; check "…and the schema version" $?
posted_has '"host":"testhost"'; check "…and where it ran" $?
grep -Eq '"restoreSeconds":[0-9]+' "$POSTED"; check "…and how long the restore took" $?
[ -f "$STATE_DIR/last-ok" ]; check "…and moves the last-ok clock" $?
grep -q -- "-H X-Api-Key: boards-key" "$CURL_LOG" && grep -q "http://bridge.test/api/v1/boards/agent/restore-drill" "$CURL_LOG"; check "…to the boards-agent route with the key" $?
if command -v python3 >/dev/null 2>&1; then python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$POSTED"; check "…and the payload is valid JSON" $?; fi

# 2. failures are reported, and do not move the clock
reset; echo tampered >> "$BK/latest/db.dump"; run; [ $? -eq 1 ]; check "a damaged copy fails the drill (exit 1)" $?
posted_has '"ok":false' && posted_has 'checksum mismatch'; check "…and says so to bridge" $?
[ ! -f "$STATE_DIR/last-ok" ]; check "…without moving the last-ok clock" $?
make_backup no

reset; FAKE_RESTORE_FAIL=1 run; [ $? -eq 1 ]; check "pg_restore failing fails the drill" $?
posted_has '"ok":false' && posted_has 'boom'; check "…with pg_restore's own words" $?

reset; FAKE_COUNT_users=0 run; [ $? -eq 1 ]; check "a required table that came back empty fails the drill" $?
posted_has 'came back empty'; check "…and says which" $?

reset; FAKE_MISSING=users run; [ $? -eq 1 ]; check "a required table that is missing fails the drill" $?

reset; FAKE_TOTALS='4|10' run; [ $? -eq 1 ]; check "fewer tables with rows than the dump held fails the drill" $?
posted_has 'only 4 tables'; check "…and says so" $?

reset; FAKE_TOTALS='0|0' run; [ $? -eq 1 ]; check "an empty restore fails the drill" $?

reset; FAKE_MISSING=jobs run; [ $? -eq 0 ]; check "a missing NON-required key table is skipped, not fatal" $?
posted_has '"users":5' && ! posted_has '"jobs"'; check "…and left out of the counts" $?

reset; KEY_TABLES='users; drop table x' run; [ $? -eq 1 ]; check "a key table name that is not a plain name is refused" $?

reset; rm -f "$BK/latest"; run; [ $? -eq 1 ]; check "no latest backup fails the drill" $?
make_backup no

reset; sed -i.bak 's/^FILE=.*/FILE=gone.dump/' "$BK/snapshots/s1/meta.env"; run; [ $? -eq 1 ]; check "a meta.env that names a missing file fails the drill" $?
make_backup no

# 3. environment problems skip, they do not alert
reset; FAKE_DOCKER_DOWN=1 run; [ $? -eq 3 ]; check "Docker not running → skipped (exit 3)" $?
[ ! -s "$CURL_LOG" ]; check "…and nothing is reported" $?

reset; ( unset BACKUP_DIR; export SOURCE_HOST=10.0.0.9 FAKE_SSH_DOWN=1; run ); [ $? -eq 3 ]; check "source host unreachable → skipped (exit 3)" $?
[ ! -s "$CURL_LOG" ]; check "…and nothing is reported" $?

reset; export FAKE_LATEST="$BK/latest"; ( unset BACKUP_DIR; export SOURCE_HOST=10.0.0.9; run ); [ $? -eq 0 ]; check "a drill from a remote board (ssh + tar) works" $?
grep -q "pi@10.0.0.9" "$SSH_LOG"; check "…asking that board" $?

# 4. --if-due
reset; run --if-due 30; check "--if-due with no history does the drill" $?
[ "$(drills)" = 1 ]; check "…once" $?
run --if-due 30; check "--if-due right after a good drill exits 0" $?
[ "$(drills)" = 1 ] && grep -q "not due" "$T/out"; check "…without doing another" $?
echo $(( $(date +%s) - 40 * 86400 )) > "$STATE_DIR/last-ok"
run --if-due 30; [ "$(drills)" = 2 ]; check "--if-due with a drill 40 days old does it again" $?

reset; FAKE_RESTORE_FAIL=1 run --if-due 30; echo $(( $(date +%s) - 40 * 86400 )) > "$STATE_DIR/last-ok"; before="$(cat "$STATE_DIR/last-ok")"
FAKE_RESTORE_FAIL=1 run --if-due 30; [ "$(cat "$STATE_DIR/last-ok")" = "$before" ]; check "a failed drill does not postpone the next attempt" $?

# 5. delivering the report
reset; FAKE_CURL_FAIL=1 run; [ $? -eq 2 ]; check "a report that cannot be delivered → exit 2" $?
[ -f "$STATE_DIR/pending.json" ] && [ -f "$STATE_DIR/last-ok" ]; check "…it is kept for later, and the good drill still counts" $?
run --if-due 30; [ $? -eq 0 ]; check "the next run, with bridge back, is fine" $?
posted_has '"ok":true' && [ ! -f "$STATE_DIR/pending.json" ]; check "…it sends the kept report first and clears it" $?

reset; FAKE_HTTP=500 run; [ $? -eq 2 ] && [ -f "$STATE_DIR/pending.json" ]; check "a 500 from bridge keeps the report too" $?
reset; FAKE_HTTP=400 run; [ $? -eq 0 ] && [ ! -f "$STATE_DIR/pending.json" ]; check "a 400 (malformed — it would never be accepted) is dropped, not kept forever" $?

reset; ( unset BRIDGE_URL BRIDGE_API_KEY; run ); [ $? -eq 0 ]; check "without BRIDGE_URL the drill still runs and only prints" $?
grep -q "not reported" "$T/out"; check "…and says it was not reported" $?

# 6. an error message with quotes and a newline is still valid JSON
if command -v python3 >/dev/null 2>&1; then
  reset; FAKE_RESTORE_FAIL=1 run
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["ok"] is False and d["error"]' "$POSTED"; check "a failure payload is valid JSON too" $?
fi

# 7. encrypted backups (only when age is available)
if command -v age >/dev/null 2>&1 && command -v age-keygen >/dev/null 2>&1; then
  make_backup yes
  reset; run; [ $? -eq 1 ]; check "encrypted: without the key the drill fails" $?
  posted_has 'AGE_IDENTITY'; check "…and says the key is what is missing" $?
  reset; AGE_IDENTITY="$T/key.txt" run; check "encrypted: with the key it restores" $?
  age-keygen -o "$T/other.txt" 2>/dev/null
  reset; AGE_IDENTITY="$T/other.txt" run; [ $? -eq 1 ]; check "encrypted: the wrong key fails the drill" $?
  posted_has 'could not decrypt'; check "…and says it could not decrypt" $?
else
  echo "skip encryption tests (age not installed)"
fi

echo; echo "passed $PASS, failed $FAILED"
[ "$FAILED" -eq 0 ]
