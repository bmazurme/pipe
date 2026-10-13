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

# 7. pull.sh (the copy on a second machine) — needs rsync
if command -v rsync >/dev/null; then
  SRC_LATEST="$BACKUP_DIR/latest/"
  PULL_DIR="$T/pulled"
  pull() { BACKUP_DIR="$PULL_DIR" SOURCE="$SRC_LATEST" "$HERE/pull.sh" >"$T/out" 2>&1; }
  # a fresh, good source copy
  rm -f "$BACKUP_DIR/last-success"
  sleep 1; dump_of 8200; run
  pull; check "pull: first pull succeeds" $?
  cmp -s "$BACKUP_DIR/latest/db.dump" "$PULL_DIR/latest/db.dump"; check "pull: the copy equals the source" $?
  (cd "$PULL_DIR/latest" && sha256sum -c db.dump.sha256 >/dev/null); check "pull: checksum verifies there too" $?
  want="$(readlink "$PULL_DIR/latest")"
  pull; check "pull: pulling the same backup again is fine" $?
  [ "$(readlink "$PULL_DIR/latest")" = "$want" ]; check "pull: …and changes nothing" $?
  BACKUP_DIR="$PULL_DIR" "$HERE/backup.sh" --check >"$T/out" 2>&1; check "pull: freshness check passes (age is the backup's own)" $?

  # a newer backup arrives
  sleep 1; dump_of 8300; run; pull; check "pull: a newer backup is taken over" $?
  [ "$(readlink "$PULL_DIR/latest")" != "$want" ] && [ "$(ls "$PULL_DIR/snapshots" | wc -l)" -eq 1 ]; check "pull: latest moved, one snapshot kept" $?
  want="$(readlink "$PULL_DIR/latest")"; want_sum="$(sha256sum "$PULL_DIR/latest/db.dump" | cut -d' ' -f1)"
  pulled_unchanged() { [ "$(readlink "$PULL_DIR/latest")" = "$want" ] && [ "$(sha256sum "$PULL_DIR/latest/db.dump" | cut -d' ' -f1)" = "$want_sum" ]; }

  # a damaged source copy must not replace the good one
  sleep 1; dump_of 8400; run
  printf 'tampered' >> "$BACKUP_DIR/latest/db.dump"
  pull; [ $? -ne 0 ]; check "pull: a copy whose checksum fails is rejected" $?
  pulled_unchanged; check "pull: …and the local copy is untouched" $?

  # an unreachable source
  BACKUP_DIR="$PULL_DIR" SOURCE="$T/does-not-exist/" "$HERE/pull.sh" >"$T/out" 2>&1; [ $? -ne 0 ]; check "pull: an unreachable source fails" $?
  pulled_unchanged; check "pull: …and the local copy is untouched" $?

  # an OLDER backup than the one here (replayed source) is refused
  older="$T/older"; mkdir -p "$older"
  cp -a "$PULL_DIR/latest/." "$older/"
  sed -i 's/^CREATED=.*/CREATED=20200101T000000Z/' "$older/meta.env"
  BACKUP_DIR="$PULL_DIR" SOURCE="$older/" "$HERE/pull.sh" >"$T/out" 2>&1; [ $? -ne 0 ]; check "pull: an older backup than the local one is refused" $?
  pulled_unchanged; check "pull: …and the local copy is untouched" $?
else
  echo "skip pull tests (rsync not installed)"
fi

# 8. mirror-s3.sh — against a local directory standing in for the bucket (needs rclone)
if command -v rclone >/dev/null; then
  BUCKET="$T/bucket"; mkdir -p "$BUCKET"
  mirror() { RCLONE=rclone DEST="$BUCKET" BACKUP_DIR="$BACKUP_DIR" "$HERE/mirror-s3.sh" >"$T/out" 2>&1; }
  sleep 1; dump_of 8500; run
  mirror; check "mirror: first upload succeeds" $?
  created="$(grep '^CREATED=' "$BACKUP_DIR/latest/meta.env" | cut -d= -f2)"
  [ "$(cat "$BUCKET/LATEST")" = "$created" ]; check "mirror: LATEST names the uploaded snapshot" $?
  (cd "$BUCKET/snapshots/$created" && sha256sum -c ./*.sha256 >/dev/null); check "mirror: the uploaded files verify" $?
  mirror; check "mirror: uploading the same snapshot again is fine" $?
  [ "$(ls "$BUCKET/snapshots" | wc -l)" -eq 1 ]; check "mirror: …and does not duplicate it" $?

  sleep 1; dump_of 8600; run; mirror; check "mirror: a newer backup is uploaded" $?
  new="$(grep '^CREATED=' "$BACKUP_DIR/latest/meta.env" | cut -d= -f2)"
  [ "$(cat "$BUCKET/LATEST")" = "$new" ] && [ "$new" != "$created" ]; check "mirror: LATEST moved to it" $?
  [ "$(ls "$BUCKET/snapshots")" = "$new" ]; check "mirror: the old snapshot was removed (KEEP=1)" $?

  # nothing to upload -> fails and leaves the bucket as it was
  before="$(cat "$BUCKET/LATEST")"
  RCLONE=rclone DEST="$BUCKET" BACKUP_DIR="$T/empty" "$HERE/mirror-s3.sh" >"$T/out" 2>&1; [ $? -ne 0 ]; check "mirror: no local backup -> fails" $?
  [ "$(cat "$BUCKET/LATEST")" = "$before" ]; check "mirror: …and LATEST is untouched" $?

  # an unwritable destination -> fails before LATEST is touched
  : > "$T/not-a-dir"
  RCLONE=rclone DEST="$T/not-a-dir/x" BACKUP_DIR="$BACKUP_DIR" "$HERE/mirror-s3.sh" >"$T/out" 2>&1; [ $? -ne 0 ]; check "mirror: an unwritable destination fails" $?
  [ "$(cat "$BUCKET/LATEST")" = "$before" ]; check "mirror: …and LATEST is untouched" $?
else
  echo "skip mirror tests (rclone not installed)"
fi

# 9. uploads-pull.sh — the uploaded files: a copy that survives an accidental wipe (needs rsync, rclone)
if command -v rsync >/dev/null && command -v rclone >/dev/null; then
  SRCU="$T/primary-uploads"; UP="$T/uploads-mirror"; UBUCKET="$T/uploads-bucket"
  mkdir -p "$SRCU/chat" "$UBUCKET"
  for i in $(seq 1 12); do echo "parcel $i" > "$SRCU/f$i.zip"; done; echo "attachment" > "$SRCU/chat/a.png"
  upl() { BACKUP_DIR="$UP" SOURCE="$SRCU/" RCLONE=rclone DEST="$UBUCKET" "$HERE/uploads-pull.sh" "$@" >"$T/out" 2>&1; }

  upl; check "uploads: first pull succeeds" $?
  diff -r "$SRCU" "$UP/current" >/dev/null; check "uploads: the copy equals the source, subfolders included" $?
  diff -r "$SRCU" "$UBUCKET" >/dev/null; check "uploads: …and it is mirrored to the bucket" $?
  BACKUP_DIR="$UP" "$HERE/uploads-pull.sh" --check >"$T/out" 2>&1; check "uploads: freshness check passes" $?

  echo "changed" > "$SRCU/f1.zip"; echo "new" > "$SRCU/f13.zip"; rm -f "$SRCU/f2.zip"
  upl; check "uploads: a normal change (edit, add, delete) is taken over" $?
  [ "$(cat "$UP/current/f1.zip")" = changed ] && [ -f "$UP/current/f13.zip" ] && [ ! -f "$UP/current/f2.zip" ]; check "uploads: the copy follows it" $?
  [ -f "$UP/deleted/$(date -u +%F)/f2.zip" ]; check "uploads: the deleted file is kept in deleted/<date>, not lost" $?
  [ -f "$UP/deleted/$(date -u +%F)/f1.zip" ] && [ "$(cat "$UP/deleted/$(date -u +%F)/f1.zip")" = "parcel 1" ]; check "uploads: so is the previous version of an overwritten one" $?
  [ ! -f "$UBUCKET/f2.zip" ] && [ "$(cat "$UBUCKET/f1.zip")" = changed ]; check "uploads: the bucket mirror follows the local copy" $?

  before="$(find "$UP/current" -type f | wc -l | tr -d ' ')"
  mkdir -p "$T/wiped"; mv "$SRCU" "$T/primary-saved"; mkdir -p "$SRCU"      # the primary lost everything
  upl; [ $? -ne 0 ]; check "uploads: a run that would delete almost everything is refused" $?
  grep -q "would delete" "$T/out"; check "uploads: …and says why" $?
  [ "$(find "$UP/current" -type f | wc -l | tr -d ' ')" = "$before" ]; check "uploads: …and the copy is untouched" $?
  [ "$(find "$UBUCKET" -type f | wc -l | tr -d ' ')" -ge 12 ]; check "uploads: …and so is the bucket" $?
  FORCE=1 upl; check "uploads: FORCE=1 overrides when it really is what happened" $?
  rm -rf "$SRCU"; mv "$T/primary-saved" "$SRCU"

  mkdir -p "$UP/deleted/2020-01-01" "$UP/deleted/$(date -u +%F)x"; touch -d '40 days ago' "$UP/deleted/2020-01-01"
  upl; check "uploads: another run" $?
  [ ! -d "$UP/deleted/2020-01-01" ] && [ -d "$UP/deleted/$(date -u +%F)" ]; check "uploads: deleted/ older than the retention is pruned, today's is kept" $?

  echo $(( $(date +%s) - 30 * 3600 )) > "$UP/last-success"
  BACKUP_DIR="$UP" "$HERE/uploads-pull.sh" --check >"$T/out" 2>&1; [ $? -ne 0 ]; check "uploads: --check fails when the last copy is older than 26 h" $?

  BACKUP_DIR="$T/other" SOURCE="$T/does-not-exist/" "$HERE/uploads-pull.sh" >"$T/out" 2>&1; [ $? -ne 0 ]; check "uploads: an unreachable source fails" $?
else
  echo "skip uploads tests (rsync and rclone are needed)"
fi

echo; echo "passed $PASS, failed $FAILED"
[ "$FAILED" -eq 0 ]
