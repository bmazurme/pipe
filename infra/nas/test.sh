#!/usr/bin/env bash
#
# Tests for the NAS pull container's scripts, with a fake rsync (no network). Linux only (flock, GNU date):
#   docker run --rm -v "$PWD":/r debian:bookworm-slim bash -c 'apt-get update -qq >/dev/null && apt-get install -y -qq openssh-client rsync util-linux coreutils >/dev/null && bash /r/infra/nas/test.sh'
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
cp "$HERE/../backup/pull.sh" "$T/pull.sh"; cp "$HERE/healthcheck.sh" "$T/healthcheck.sh"
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

echo; echo "passed $PASS, failed $FAILED"
[ "$FAILED" -eq 0 ]
