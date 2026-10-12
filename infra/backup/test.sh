#!/usr/bin/env bash
#
# Tests for backup.sh with fake pg_dump / pg_restore (no database needed). Linux only
# (flock, mv -T, sha256sum), so on a Mac run it in a container:
#   docker run --rm -v "$PWD/../..":/r debian:bookworm-slim bash /r/infra/backup/test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0

# The fake "dump" is whatever $DUMP_FILE holds; the fake restore lists it as a TOC.
cat > "$T/pg_dump" <<'SH'
#!/usr/bin/env bash
[ -z "${DUMP_FAIL:-}" ] || exit 3
cat "$DUMP_FILE"
SH
cat > "$T/pg_restore" <<'SH'
#!/usr/bin/env bash
content="$(cat)"
case "$content" in *CORRUPT*) exit 1;; esac
case "$content" in *NODATA*) echo "; Archive created";;
  *) echo "1; 1259 16385 TABLE DATA public users postgres";; esac
SH
chmod +x "$T/pg_dump" "$T/pg_restore"

export PG_DUMP="$T/pg_dump" PG_RESTORE="$T/pg_restore" DATABASE_URL=fake BACKUP_DIR="$T/backups"
export ALERT_CMD="$T/alert" DUMP_FILE="$T/dump"
cat > "$T/alert" <<'SH'
#!/usr/bin/env bash
echo "$1" >> "$ALERTS"
SH
chmod +x "$T/alert"
export ALERTS="$T/alerts"

dump_of() { # size marker
  { printf '%s\n' "${2:-ok}"; head -c "$1" /dev/zero | tr '\0' 'x'; } > "$DUMP_FILE"
}
run() { "$HERE/backup.sh" >"$T/out" 2>&1; }
latest_stamp() { readlink "$BACKUP_DIR/latest"; }

check() { # description, condition-exit-code
  if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/out"; fi
}

# 1. first backup
dump_of 5000; run; check "first backup succeeds" $?
first="$(latest_stamp)"
[ -f "$BACKUP_DIR/latest/db.dump" ] && [ -f "$BACKUP_DIR/latest/db.dump.sha256" ]; check "latest holds the dump and its checksum" $?
(cd "$BACKUP_DIR/latest" && sha256sum -c db.dump.sha256 >/dev/null); check "checksum verifies" $?

# 2. a normal second backup replaces it and, with KEEP=1, leaves one snapshot
sleep 1; dump_of 5200; run; check "second backup succeeds" $?
[ "$(latest_stamp)" != "$first" ]; check "latest moved to the new snapshot" $?
[ "$(ls "$BACKUP_DIR/snapshots" | wc -l)" -eq 1 ]; check "only one snapshot kept" $?

good="$(latest_stamp)"; good_sum="$(sha256sum "$BACKUP_DIR/latest/db.dump" | cut -d' ' -f1)"
unchanged() { [ "$(latest_stamp)" = "$good" ] && [ "$(sha256sum "$BACKUP_DIR/latest/db.dump" | cut -d' ' -f1)" = "$good_sum" ]; }

# 3. bad dumps must never replace the last good copy
sleep 1; : > "$DUMP_FILE"; run; [ $? -ne 0 ]; check "empty dump is rejected" $?
unchanged; check "…and latest is untouched" $?

dump_of 10 ok; run; [ $? -ne 0 ]; check "dump below MIN_BYTES is rejected" $?
unchanged; check "…and latest is untouched" $?

dump_of 5000 CORRUPT; run; [ $? -ne 0 ]; check "unreadable dump (pg_restore --list fails) is rejected" $?
unchanged; check "…and latest is untouched" $?

dump_of 5000 NODATA; run; [ $? -ne 0 ]; check "dump without table data is rejected" $?
unchanged; check "…and latest is untouched" $?

dump_of 1000 ok; run; [ $? -ne 0 ]; check "dump shrunk below 50% of the previous is rejected" $?
unchanged; check "…and latest is untouched" $?

DUMP_FAIL=1 run; [ $? -ne 0 ]; check "pg_dump failure is rejected" $?
unchanged; check "…and latest is untouched" $?

[ -z "$(ls -A "$BACKUP_DIR/snapshots" | grep '^\.incoming')" ]; check "no half-written snapshot is left behind" $?
[ "$(wc -l < "$ALERTS")" -ge 6 ]; check "every failure raised an alert" $?

# 4. a big but valid change is accepted with a warning
: > "$ALERTS"; sleep 1; dump_of 8000; run; check "a 50% bigger dump is accepted" $?
grep -q "size changed" "$ALERTS"; check "…with a size-change warning" $?

# 5. encryption (only when age is available)
if command -v age >/dev/null && command -v age-keygen >/dev/null; then
  age-keygen -o "$T/key.txt" 2>/dev/null
  recipient="$(grep 'public key' "$T/key.txt" | awk '{print $NF}')"
  sleep 1; dump_of 8100; AGE_RECIPIENT="$recipient" run; check "encrypted backup succeeds" $?
  [ -f "$BACKUP_DIR/latest/db.dump.age" ] && [ ! -f "$BACKUP_DIR/latest/db.dump" ]; check "only ciphertext is stored" $?
  age -d -i "$T/key.txt" "$BACKUP_DIR/latest/db.dump.age" | cmp -s - "$DUMP_FILE"; check "it decrypts back to the dump" $?
else
  echo "skip encryption tests (age not installed)"
fi

# 6. --check
"$HERE/backup.sh" --check >"$T/out" 2>&1; check "--check passes right after a backup" $?
echo $(( $(date +%s) - 30 * 3600 )) > "$BACKUP_DIR/last-success"
"$HERE/backup.sh" --check >"$T/out" 2>&1; [ $? -ne 0 ]; check "--check fails when the last backup is older than 26 h" $?

echo; echo "passed $PASS, failed $FAILED"
[ "$FAILED" -eq 0 ]
