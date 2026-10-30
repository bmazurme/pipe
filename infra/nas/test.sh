#!/usr/bin/env bash
#
# Tests for the NAS pull container's scripts, with a fake rsync (no network). Linux only (flock, GNU date):
#   docker run --rm -v "$PWD":/r debian:bookworm-slim bash -c 'apt-get update -qq >/dev/null && apt-get install -y -qq openssh-client rsync util-linux coreutils jq >/dev/null && bash /r/infra/nas/test.sh'
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; [ ! -s "$T/out" ] || sed 's/^/     | /' "$T/out"; fi; }

export BACKUP_DIR="$T/backups" KEYS_DIR="$T/keys" TZ=Europe/Moscow KEEP=3 SOURCE="pi@192.0.2.12:latest/"
export SSH_KEY="$T/keys/ssh/pull_backups"
mkdir -p "$T/bin" "$T/home"
export PATH="$T/bin:$PATH"
# /root/.ssh is a symlink into the keys volume; tests run as whoever, so point it at a scratch HOME
export HOME="$T/home"
sed "s#/root/.ssh#$T/home/.ssh#g" "$HERE/entrypoint.sh" > "$T/entrypoint.sh"
cp "$HERE/../backup/pull.sh" "$T/pull.sh"; cp "$HERE/healthcheck.sh" "$T/healthcheck.sh"; cp "$HERE/report.sh" "$T/report.sh"
sed -i "s#/usr/local/bin/pull.sh#$T/pull.sh#" "$T/entrypoint.sh"
chmod +x "$T"/*.sh

# a fake source: what rrsync would serve from the Pi's /srv/backups/latest/
make_source() { # created-stamp
  rm -rf "$T/src"; mkdir -p "$T/src"
  printf 'dump of %s' "$1" > "$T/src/db.dump.age"
  (cd "$T/src" && sha256sum db.dump.age > db.dump.age.sha256)
  printf 'CREATED=%s\nFILE=db.dump.age\n' "$1" > "$T/src/meta.env"
}
cat > "$T/bin/rsync" <<'SH'
#!/usr/bin/env bash
[ -z "${FAKE_RSYNC_FAIL:-}" ] || exit 23
dest="${@: -1}"
cp -a "$FAKE_SRC/." "$dest"
SH
chmod +x "$T/bin/rsync"
export FAKE_SRC="$T/src"
run() { "$T/entrypoint.sh" "$@" > "$T/out" 2>&1; }

echo "# schedule"
now=$(date +%s)
soon="$(date -d @$((now + 150)) +%H:%M)"
secs="$("$T/entrypoint.sh" seconds_until "$soon")"
[ "$secs" -ge 60 ] && [ "$secs" -le 210 ]; check "a time a couple of minutes ahead is waited for (got ${secs}s)" $?
past="$(date -d @$((now - 150)) +%H:%M)"
secs="$("$T/entrypoint.sh" seconds_until "$past")"
[ "$secs" -ge 86000 ] && [ "$secs" -le 86400 ]; check "a time that already passed is waited for until tomorrow (got ${secs}s)" $?

echo "# keygen"
FROM_IP=192.168.50.216 run keygen; code=$?
[ "$code" -eq 0 ]; check "keygen: exit 0 (an unreachable host key is only a warning)" $?
[ -f "$SSH_KEY" ] && [ -f "$SSH_KEY.pub" ]; check "keygen: the key is made in the keys volume" $?
grep -q '^restrict,from="192.168.50.216",command="sudo --preserve-env=SSH_ORIGINAL_COMMAND rrsync -ro /srv/backups" ssh-ed25519 ' "$T/out"; check "keygen: prints the restricted authorized_keys line (read-only rrsync, only from the NAS)" $?
grep -q 'pi@192.0.2.12:~/.ssh/authorized_keys' "$T/out"; check "keygen: says which account's file the line goes to" $?
before="$(cat "$SSH_KEY.pub")"; FROM_IP=192.168.50.216 run keygen
[ "$(cat "$SSH_KEY.pub")" = "$before" ]; check "keygen: a second run keeps the same key" $?

echo "# a pull"
make_source 20261030T030000Z
run once; code=$?
[ "$code" -eq 0 ]; check "once: pulls and exits 0" $?
[ "$(readlink "$BACKUP_DIR/latest")" = snapshots/20261030T030000Z ] && [ -f "$BACKUP_DIR/latest/db.dump.age" ]; check "once: latest points at the pulled snapshot" $?
[ -s "$BACKUP_DIR/last-success" ]; check "once: last-success is written" $?

echo "# keeps history"
for stamp in 20261031T030000Z 20261101T030000Z 20261102T030000Z 20261103T030000Z; do make_source "$stamp"; run once; done
[ "$(ls "$BACKUP_DIR/snapshots" | wc -l)" -eq 3 ] && [ "$(readlink "$BACKUP_DIR/latest")" = snapshots/20261103T030000Z ]; check "KEEP=3: the three newest snapshots stay, latest is the newest" $?

echo "# a failing source never touches the copy"
FAKE_RSYNC_FAIL=1 run once; code=$?
[ "$code" -ne 0 ] && [ "$(readlink "$BACKUP_DIR/latest")" = snapshots/20261103T030000Z ]; check "rsync failure: non-zero exit, the last good copy is untouched" $?
make_source 20261101T030000Z; run once; code=$?
[ "$code" -ne 0 ] && [ "$(readlink "$BACKUP_DIR/latest")" = snapshots/20261103T030000Z ]; check "an older source is refused" $?

echo "# health"
date +%s > "$BACKUP_DIR/last-success"
BACKUP_DIR="$BACKUP_DIR" "$T/healthcheck.sh" > "$T/out" 2>&1; check "healthy right after a pull" $?
echo $(( $(date +%s) - 30 * 3600 )) > "$BACKUP_DIR/last-success"
BACKUP_DIR="$BACKUP_DIR" "$T/healthcheck.sh" > "$T/out" 2>&1; code=$?
[ "$code" -ne 0 ] && grep -q '30 h old' "$T/out"; check "unhealthy when the copy is 30 hours old, and says so" $?
rm -f "$BACKUP_DIR/last-success"
BACKUP_DIR="$BACKUP_DIR" "$T/healthcheck.sh" > "$T/out" 2>&1; code=$?
[ "$code" -ne 0 ]; check "unhealthy before any pull" $?

echo "# the report for the Dashboard (needs jq)"
if command -v jq >/dev/null; then
  mkdir -p "$T/disks"
  cat > "$T/mdstat-ok" <<'MD'
Personalities : [linear] [raid0] [raid1]
md1 : active raid1 sda2[0] sdb2[1]
      1900391288 blocks super 1.0 [2/2] [UU]
      bitmap: 1/1 pages [32KB], 131072KB chunk

md0 : active raid1 sdb1[1] sda1[0]
      2094080 blocks super 1.2 [2/2] [UU]

unused devices: <none>
MD
  sed 's/\[2\/2\] \[UU\]/[2\/1] [U_]/' "$T/mdstat-ok" > "$T/mdstat-degraded"
  cat > "$T/bin/smartctl" <<'SH'
#!/usr/bin/env bash
dev="${@: -1}"
case "$1" in
  -H) if [ "${FAKE_SMART_FAIL:-}" = "$dev" ]; then echo "SMART overall-health self-assessment test result: FAILED!"; else echo "SMART overall-health self-assessment test result: PASSED"; fi;;
  -i) echo "Device Model:     WDC WD20EFRX-68EUZN0";;
  -A) cat <<'A'
  5 Reallocated_Sector_Ct   0x0033   200   200   140    Pre-fail  Always       -       0
  9 Power_On_Hours          0x0032   050   050   000    Old_age   Always       -       36848
194 Temperature_Celsius     0x0022   103   091   000    Old_age   Always       -       44 (Min/Max 20/51)
197 Current_Pending_Sector  0x0032   200   200   000    Old_age   Always       -       2
198 Offline_Uncorrectable   0x0030   100   253   000    Old_age   Offline      -       0
A
  ;;
esac
SH
  chmod +x "$T/bin/smartctl"
  # "devices" for the DISKS loop: /dev/sdX is checked with -e, so point the script at files that exist
  sed "s#\"/dev/\$d\"#\"$T/disks/\$d\"#; s#\"/dev/\$dev\"#\"/dev/\$dev\"#" "$HERE/report.sh" > "$T/report-t.sh"; chmod +x "$T/report-t.sh"
  touch "$T/disks/sda" "$T/disks/sdb"
  cat > "$T/bin/curl" <<'SH'
#!/usr/bin/env bash
echo "$@" >> "$FAKE_CURL_ARGS"
cat > "$FAKE_CURL_STDIN"
for a in "$@"; do last="$a"; done
printf '%s\n' "$last" > "$FAKE_CURL_URL"
# the --data body is the argument after --data
while [ $# -gt 0 ]; do [ "$1" = --data ] && { printf '%s' "$2" > "$FAKE_CURL_BODY"; break; }; shift; done
[ -z "${FAKE_CURL_FAIL:-}" ]
SH
  chmod +x "$T/bin/curl"
  export FAKE_CURL_ARGS="$T/curl-args" FAKE_CURL_STDIN="$T/curl-stdin" FAKE_CURL_URL="$T/curl-url" FAKE_CURL_BODY="$T/curl-body"
  rep() { MDSTAT="${MDSTAT_FILE:-$T/mdstat-ok}" NAS_NAME=TestNAS DISKS="sda sdb" "$T/report-t.sh" "$@" > "$T/out" 2>&1; }

  # the state the history test left (3 snapshots kept, latest = the newest) with a known creation time
  date -u -d 2026-10-30T00:02:07Z +%s > "$BACKUP_DIR/last-success"
  rep --dry; check "report --dry: prints valid JSON" $?
  jq -e '.host == "TestNAS" and .raid.degraded == false and .raid.syncing == false and (.raid.summary | test("md1 \\[UU\\]")) and (.disks | length == 2)' "$T/out" >/dev/null; check "report: RAID clean, both disks listed" $?
  jq -e '.disks[0] | .name == "sda" and .healthPassed == true and .reallocated == 0 and .powerOnHours == 36848 and .tempC == 44 and .pending == 2 and .uncorrectable == 0 and .model == "WDC WD20EFRX-68EUZN0"' "$T/out" >/dev/null; check "report: the SMART numbers are read (raw values, the temperature without its Min/Max)" $?
  jq -e '.backup.snapshots == 3 and .backup.latest == "20261103T030000Z" and .backup.createdAt == "2026-10-30T00:02:07Z" and .backup.bytes > 0 and .volume.totalBytes > 0' "$T/out" >/dev/null; check "report: the backup it keeps (latest, count, size) and the volume" $?
  MDSTAT_FILE="$T/mdstat-degraded" rep --dry
  jq -e '.raid.degraded == true' "$T/out" >/dev/null; check "report: a missing RAID member is degraded" $?
  FAKE_SMART_FAIL=/dev/sdb rep --dry
  jq -e '.disks[1].healthPassed == false and .disks[0].healthPassed == true' "$T/out" >/dev/null; check "report: a disk failing SMART is marked, the other is not" $?

  rm -f "$T/curl-args" "$T/curl-body"
  rep; code=$?
  [ "$code" -eq 0 ] && [ ! -e "$T/curl-args" ]; check "report: without BRIDGE_API_KEY nothing is sent" $?
  BRIDGE_API_KEY=brk_secret BRIDGE_RESOLVE=api.test:443:192.0.2.10 BRIDGE_API_URL=https://api.test rep; code=$?
  [ "$code" -eq 0 ] && [ "$(cat "$T/curl-url")" = https://api.test/api/v1/boards/agent/nas ]; check "report: with a key it POSTs to the boards-agent route" $?
  grep -q -- '--resolve api.test:443:192.0.2.10' "$T/curl-args"; check "report: goes to the stack's address when BRIDGE_RESOLVE is set" $?
  grep -q 'Authorization: Bearer brk_secret' "$T/curl-stdin" && ! grep -q brk_secret "$T/curl-args"; check "report: the key is on curl's stdin, not in its arguments" $?
  jq -e '.host == "TestNAS"' "$T/curl-body" >/dev/null; check "report: the body that is sent is the report" $?
  FAKE_CURL_FAIL=1 BRIDGE_API_KEY=brk_secret BRIDGE_API_URL=https://api.test rep; code=$?
  [ "$code" -ne 0 ] && grep -q 'did not take' "$T/out"; check "report: bridge refusing it is a non-zero exit with a message" $?
else
  echo "skip the report tests: jq is not installed"
fi

echo; echo "passed $PASS, failed $FAILED"
[ "$FAILED" -eq 0 ]
