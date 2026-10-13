#!/usr/bin/env bash
#
# Tests for failback.sh with a fake ssh/scp — nothing is touched:
#   docker run --rm -v "$PWD/../..":/r debian:bookworm-slim bash /r/infra/failover/test-failback.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0
FIX="$T/fix"; BIN="$T/bin"; mkdir -p "$FIX" "$BIN"
export PATH="$BIN:$PATH" FIX
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/out"; fi; }

cat > "$BIN/scp" <<'SH'
#!/usr/bin/env bash
echo "scp $*" >> "$FIX/log"
SH
cat > "$BIN/ssh" <<'SH'
#!/usr/bin/env bash
args=("$@"); host=""; cmd=""
for i in "${!args[@]}"; do case "${args[$i]}" in pi@*) host="${args[$i]#pi@}"; cmd="${args[*]:$((i+1))}"; break;; esac; done
stdin=""; case "$cmd" in *psql*|*"bash -s"*) stdin="$(cat)";; esac
echo "$host: $cmd" >> "$FIX/log"
[ -n "$stdin" ] && printf '%s\n' "$stdin" | sed 's/PASSWORD .*/PASSWORD <hidden>/' >> "$FIX/log.stdin"
case "$cmd" in
  true) [ ! -f "$FIX/down-$host" ];;
  *"pg_stat_replication WHERE state"*|*psql*)
     case "$stdin" in
       *"pg_is_in_recovery"*) cat "$FIX/recovery";;
       *"count(*)"*) echo 1;;
       *) :;;
     esac;;
  *"node inspect self"*) cat "$FIX/label";;
  *"grep -E"*) cat "$FIX/white-running";;
  *"volume inspect standby_pgdata"*) [ -f "$FIX/volume-full" ];;
  *"grep -q"*) [ ! -f "$FIX/no-pw" ];;
  *REPLICATION_PASSWORD=*) echo secretpw;;
  *"network inspect"*) echo 10.0.1.0/24;;
  *) :;;
esac
SH
chmod +x "$BIN/scp" "$BIN/ssh"

reset() { rm -f "$FIX"/*; echo f > "$FIX/recovery"; echo active > "$FIX/label"; : > "$FIX/white-running"; }
fb() { printf '%s\n' "${CONFIRM:-FAILBACK}" | "$HERE/failback.sh" "$@" > "$T/out" 2>&1; }

reset; echo t > "$FIX/recovery"; fb --dry-run; c=$?
[ "$c" -ne 0 ] && grep -q 'still a replica' "$T/out"; check "red not yet promoted: refused" $?

reset; echo "" > "$FIX/label"; fb --dry-run; c=$?
[ "$c" -ne 0 ] && grep -q 'not marked failover=active' "$T/out"; check "no failover label on red: refused" $?

reset; echo "bridge_backend.1.abc" > "$FIX/white-running"; fb --dry-run; c=$?
[ "$c" -ne 0 ] && grep -q 'runs bridge services' "$T/out"; check "white still runs bridge services: refused" $?

reset; touch "$FIX/volume-full"; fb --dry-run; c=$?
[ "$c" -ne 0 ] && grep -q 'non-empty volume' "$T/out"; check "white already has a replica volume: refused" $?

reset; touch "$FIX/down-192.168.50.11"; fb --dry-run; c=$?
[ "$c" -ne 0 ] && grep -q 'white .* does not answer' "$T/out"; check "white down: refused" $?

reset; fb --dry-run; c=$?
[ "$c" -eq 0 ] && grep -q 'Nothing was changed' "$T/out" && ! grep -q 'pg_basebackup\|stack deploy' "$FIX/log"; check "dry run passes and changes nothing" $?

reset; CONFIRM=nope fb; c=$?
[ "$c" -ne 0 ] && ! grep -q 'pg_basebackup' "$FIX/log"; check "a wrong confirmation cancels" $?

reset; fb; c=$?
[ "$c" -eq 0 ] && grep -q 'white is streaming' "$T/out"; check "the real run finishes" $?
grep -q 'standby_white' "$FIX/log.stdin"; check "…creates the slot on red" $?
! grep -q 'secretpw' "$FIX/log"; check "…the password never appears on a command line" $?
grep -q 'bridgesw' "$FIX/log.stdin" && grep -q 'scp' "$FIX/log"; check "…ships and deploys the replica stack on white" $?
! grep -q 'bridge-pi\|bridge_pgdata' "$FIX/log" "$FIX/log.stdin"; check "…never deploys white's own stack or touches its old volume" $?

echo; echo "$PASS passed, $FAILED failed"; [ "$FAILED" -eq 0 ]
