#!/usr/bin/env bash
#
# Tests for enable-s3-storage.sh with fake docker/id — nothing is touched:
#   docker run --rm -v "$PWD/../..":/r debian:bookworm-slim bash /r/infra/garage/test-enable-s3.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0; BIN="$T/bin"; FIX="$T/fix"; mkdir -p "$BIN" "$FIX"; export PATH="$BIN:$PATH" FIX
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/out"; fi; }

cat > "$BIN/id" <<'SH'
#!/usr/bin/env bash
case "$1" in -u) echo 0;; -un) echo root;; *) echo root;; esac
SH
cat > "$BIN/docker" <<'SH'
#!/usr/bin/env bash
echo "docker $*" >> "$FIX/log"
case "$*" in
  "volume inspect"*) [ ! -f "$FIX/no-volume" ];;
  *alpine*) echo 7;;
  *"rclone/rclone lsd"*) [ ! -f "$FIX/unreachable" ];;
  *"rclone/rclone copy"*) [ ! -f "$FIX/copy-fails" ];;
  *"rclone/rclone check"*) [ ! -f "$FIX/differs" ];;
esac
SH
chmod +x "$BIN"/*

SECRET_ID="GKtestkeyid123"; SECRET="verysecretvalue987"
KEYFILE="$T/bridge-uploads.env"
reset() { rm -rf "$FIX"/*; printf 'S3_ENDPOINT=http://10.0.0.1:3900\nS3_REGION=garage\nS3_BUCKET=bridge-uploads\nS3_ACCESS_KEY_ID=%s\nS3_SECRET_ACCESS_KEY=%s\n' "$SECRET_ID" "$SECRET" > "$KEYFILE"; printf 'JWT_SECRET=abc\n' > "$T/bridge.env"; }
en() { KEYFILE="$KEYFILE" ENV_FILE="$T/bridge.env" "$HERE/enable-s3-storage.sh" "$@" > "$T/out" 2>&1; }

reset; rm -f "$KEYFILE"; en; [ $? -ne 0 ] && grep -q 'no .*bridge-uploads.env' "$T/out"; check "no key file: refused" $?
reset; touch "$FIX/no-volume"; en; [ $? -ne 0 ] && grep -q 'no volume' "$T/out"; check "no uploads volume: refused" $?
reset; touch "$FIX/unreachable"; en; [ $? -ne 0 ] && grep -q 'cannot reach' "$T/out"; check "bucket unreachable: refused before anything is copied" $?
reset; en --dry-run; c=$?
[ $c -eq 0 ] && grep -q 'Nothing was changed' "$T/out" && ! grep -q 'rclone/rclone copy' "$FIX/log" && [ "$(cat "$T/bridge.env")" = "JWT_SECRET=abc" ]; check "dry run: copies nothing, settings untouched" $?

reset; touch "$FIX/copy-fails"; en; [ $? -ne 0 ]; c1=$?
[ "$(cat "$T/bridge.env")" = "JWT_SECRET=abc" ]; check "a failed copy leaves the settings untouched" $?
reset; touch "$FIX/differs"; en; [ $? -ne 0 ] && grep -q 'found a difference' "$T/out" && ! grep -q 'STORAGE_DRIVER' "$T/bridge.env"; check "a difference found by the check stops BEFORE the settings change" $?

reset; en; c=$?
[ $c -eq 0 ] && grep -q '^STORAGE_DRIVER=s3$' "$T/bridge.env" && grep -q "^S3_ACCESS_KEY_ID=$SECRET_ID$" "$T/bridge.env" && grep -q "^S3_SECRET_ACCESS_KEY=$SECRET$" "$T/bridge.env" && grep -q '^S3_BUCKET=bridge-uploads$' "$T/bridge.env"; check "the real run adds the driver and the S3_* settings (key copied from the key file)" $?
grep -q '^S3_ENDPOINT=http://192.168.50.11:3900,http://192.168.50.12:3900' "$T/bridge.env"; check "…with all the boards as endpoints, white first" $?
! grep -q "$SECRET" "$T/out" && ! grep -q "$SECRET_ID" "$T/out" && ! grep -q "$SECRET" "$FIX/log"; check "the secret never appears in the output or on a docker command line" $?
grep -q 'rclone/rclone copy' "$FIX/log" && grep -q 'rclone/rclone check' "$FIX/log" && ! grep -q 'rclone/rclone sync\|purge\|delete' "$FIX/log"; check "it copies and checks, and never deletes or syncs" $?
[ "$(stat -c %a "$T/bridge.env" 2>/dev/null || echo 600)" = 600 ]; check "the settings file stays mode 600" $?
n="$(grep -c '^STORAGE_DRIVER=' "$T/bridge.env")"; en; [ "$(grep -c '^STORAGE_DRIVER=' "$T/bridge.env")" = "$n" ] && grep -q 'already says' "$T/out"; check "idempotent: a second run does not add the settings twice" $?

echo; echo "$PASS passed, $FAILED failed"; [ "$FAILED" -eq 0 ]
