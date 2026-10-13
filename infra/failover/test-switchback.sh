#!/usr/bin/env bash
#
# Tests for switchback.sh with a fake ssh — nothing is touched:
#   docker run --rm -v "$PWD/../..":/r debian:bookworm-slim bash /r/infra/failover/test-switchback.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0
FIX="$T/fix"; BIN="$T/bin"; mkdir -p "$FIX" "$BIN" "$T/failover" "$T/standby"
export PATH="$BIN:$PATH" FIX
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/out"; fi; }

# the script under test sits next to a fake status.sh (the real one would ssh by itself)
cp "$HERE/switchback.sh" "$T/failover/switchback.sh"
printf '#!/usr/bin/env bash\nexit 0\n' > "$T/standby/status.sh"; chmod +x "$T/standby/status.sh"

cat > "$BIN/ssh" <<'SH'
#!/usr/bin/env bash
args=("$@"); host=""; cmd=""
for i in "${!args[@]}"; do case "${args[$i]}" in pi@*) host="${args[$i]#pi@}"; cmd="${args[*]:$((i+1))}"; break;; esac; done
stdin=""
case "$cmd" in *psql*|*"bash -s"*) stdin="$(cat)";; *"-xf -"*|*"--skip-old-files"*) cat >/dev/null;; esac
echo "$host: $cmd" >> "$FIX/log"
[ -n "$stdin" ] && { echo "--- $host: $cmd" >> "$FIX/log.stdin"; printf '%s\n' "$stdin" >> "$FIX/log.stdin"; }
case "$cmd" in
  *"mkdir "*pipe-switch.lock*) [ ! -f "$FIX/lock-held" ];;
  *"cat "*pipe-switch.lock/owner*) echo "someone@elsewhere 2026-10-13T16:29:00Z switchback.sh";;
  true) [ ! -f "$FIX/down-$host" ];;
  *psql*)
     case "$stdin" in
       *pg_is_in_recovery*) cat "$FIX/recovery";;
       *"count(*)"*) cat "$FIX/streaming";;
     esac;;
  *"node inspect self"*) cat "$FIX/label";;
  *"--skip-old-files"*) :;;
  *" -cf - "*) echo tar-data;;
  *"docker volume inspect"*) [ -f "$FIX/vol-exists" ];;
  *"test -x"*) [ ! -f "$FIX/not-prepared" ];;
  *curl*) echo '{"status":"ok","database":true}';;
esac
SH
chmod +x "$BIN/ssh"

reset() { rm -f "$FIX"/*; echo f > "$FIX/recovery"; echo active > "$FIX/label"; echo 1 > "$FIX/streaming"; }
sb() { printf '%s\n' "${CONFIRM:-SWITCHBACK}" | "$T/failover/switchback.sh" "$@" > "$T/out" 2>&1; }
refused() { [ $? -ne 0 ] && grep -q "$1" "$T/out"; }

reset; echo t > "$FIX/recovery"; sb --dry-run; refused 'not a primary'; check "red still a replica: refused" $?
reset; echo "" > "$FIX/label"; sb --dry-run; refused 'not marked failover=active'; check "no failover label on red: refused" $?
reset; echo 0 > "$FIX/streaming"; sb --dry-run; refused 'not streaming'; check "white not streaming from red: refused (run failback.sh first)" $?
reset; touch "$FIX/not-prepared"; sb --dry-run; refused 'not prepared\|has no'; check "a board without its scripts: refused" $?
reset; touch "$FIX/vol-exists"; sb --dry-run; refused 'already has the volume'; check "a copy-aside from today exists: refused" $?
reset; touch "$FIX/down-192.168.50.11"; sb --dry-run; refused 'white .* does not answer'; check "white down: refused" $?

reset; sb --dry-run; c=$?
[ "$c" -eq 0 ] && grep -q 'Nothing was changed' "$T/out" && ! grep -q 'scale' "$FIX/log"; check "dry run passes and stops nothing" $?
reset; CONFIRM=nope sb; c=$?
[ "$c" -ne 0 ] && ! grep -q 'scale' "$FIX/log"; check "a wrong confirmation cancels before anything is stopped" $?

reset; sb; c=$?
[ "$c" -eq 0 ] && grep -q 'DONE' "$T/out"; check "the real run finishes" $?
ln() { grep -n "$1" "$FIX/log" | head -1 | cut -d: -f1; }
s="$(ln 'docker service scale')"; t="$(ln ' -cf - ')"; w="$(ln 'bash -s')"; l="$(ln 'label-rm failover')"; d="$(ln 'deploy.sh ghcr stable')"; p="$(ln 'standby/setup-primary.sh$')"
[ -n "$s" ] && [ "$s" -lt "$t" ] && [ "$t" -lt "$w" ] && [ "$w" -lt "$l" ] && [ "$l" -lt "$d" ] && [ "$d" -lt "$p" ]; check "order: stop writing → uploads → database → roles → deploy on white → replication" $?
grep -q 'bridge_backend=0 bridge_frontend=0 bridge_caddy=0' "$FIX/log"; check "…stops the application on red (no writes during the copy)" $?
sed -n '/^--- 192.168.50.11: bash/,/^--- 192.168.50.12: bash/p' "$FIX/log.stdin" | awk '/cp -a \/from/{a=NR} /rm -rf \/d\//{r=NR} /pg_basebackup/{b=NR} END{exit !(a && r && b && a<r && r<b)}'; check "white: the old database is copied aside (and checked) BEFORE its volume is emptied, then the base backup" $?
grep -q 'standby_pgdata_prev_' "$FIX/log.stdin" && grep -q 'setup-standby.sh' "$FIX/log.stdin"; check "red: its database is kept aside, then rebuilt as a replica" $?
grep -q -- '--skip-old-files' "$FIX/log"; check "uploads are added, never overwritten" $?
! grep -E 'docker (volume rm|system prune)' "$FIX/log" "$FIX/log.stdin" | grep -q .; check "nothing is ever deleted with docker volume rm / prune" $?

reset; touch "$FIX/lock-held"; sb; c=$?
[ "$c" -ne 0 ] && grep -q 'another switch is running' "$T/out" && grep -q 'someone@elsewhere' "$T/out" && ! grep -q 'docker service scale' "$FIX/log"; check "a second run while another holds the lock: refused, shows who, stops NOTHING" $?
! grep -q 'rm -rf .*pipe-switch.lock' "$FIX/log"; check "…and it does not release a lock it does not own" $?
reset; sb >/dev/null 2>&1; grep -q 'rm -rf .*pipe-switch.lock' "$FIX/log"; check "a normal run releases the lock at the end" $?
reset; sb --dry-run >/dev/null 2>&1; ! grep -q 'mkdir .*pipe-switch.lock' "$FIX/log"; check "a dry run takes no lock" $?

echo; echo "$PASS passed, $FAILED failed"; [ "$FAILED" -eq 0 ]
