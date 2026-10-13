#!/usr/bin/env bash
#
# Tests for failover.sh (workstation) and failover-red.sh (board) with fake ssh / age / ping / docker — nothing is touched:
#   docker run --rm -v "$PWD/../..":/r debian:bookworm-slim bash -c 'apt-get update -qq && apt-get install -y -qq rsync && bash /r/infra/failover/test.sh'
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0
FIX="$T/fix"; BIN="$T/bin"; mkdir -p "$FIX" "$BIN"
export PATH="$BIN:$PATH" FIX
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/out"; fi; }

# ====================== failover.sh (workstation) ======================
cat > "$BIN/ping" <<'SH'
#!/usr/bin/env bash
[ -f "$FIX/alive-ping" ]
SH
cat > "$BIN/age" <<'SH'
#!/usr/bin/env bash
sed 's/CIPHER/JWT_SECRET=abc/'
SH
cat > "$BIN/ssh" <<'SH'
#!/usr/bin/env bash
# the host is the last argument starting with pi@, the remote command is everything after it
args=("$@"); host=""; cmd=""
for i in "${!args[@]}"; do case "${args[$i]}" in pi@*) host="${args[$i]#pi@}"; cmd="${args[*]:$((i+1))}"; break;; esac; done
echo "$host: $cmd" >> "$FIX/ssh.log"
case "$cmd" in
  true) [ -f "$FIX/alive-$host" ];;
  *psql*) cat "$FIX/state";;
  "test -s"*) [ ! -f "$FIX/not-prepared" ];;
  "cat ~/.pipe/bridge.env.age") echo CIPHER;;
  "umask 077; cat > ~/.pipe/bridge.env") cat > "$FIX/env_written";;
  "grep -q"*) [ ! -f "$FIX/empty_env" ];;
  *failover-red.sh*) echo "RAN failover-red (env written first: $([ -s "$FIX/env_written" ] && echo yes || echo no))" >> "$FIX/ran";;
  *) echo "unexpected ssh: $cmd" >&2; exit 1;;
esac
SH
chmod +x "$BIN/ping" "$BIN/age" "$BIN/ssh"
echo key > "$T/key.txt"; export AGE_IDENTITY="$T/key.txt"

reset() { rm -f "$FIX"/alive-* "$FIX"/env_written "$FIX"/ran "$FIX"/ssh.log "$FIX"/not-prepared "$FIX"/empty_env; echo 't|42' > "$FIX/state"; touch "$FIX/alive-192.168.50.12"; }
fo() { printf '%s\n' "${CONFIRM:-FAILOVER}" | "$HERE/failover.sh" "$@" > "$T/out" 2>&1; }

echo "# failover.sh — must refuse"
reset; touch "$FIX/alive-192.168.50.11"; fo; code=$?
[ "$code" -ne 0 ] && grep -q 'does not answer' "$T/out" || grep -q 'answers over ssh' "$T/out"; check "white answers over ssh: refused" $?
[ ! -f "$FIX/env_written" ] && [ ! -f "$FIX/ran" ]; check "…and nothing was decrypted, copied or run" $?

reset; touch "$FIX/alive-ping"; fo; code=$?
[ "$code" -ne 0 ] && grep -q 'answers ping' "$T/out"; check "white answers ping (ssh dead, e.g. a hung docker): refused" $?
[ ! -f "$FIX/ran" ]; check "…and nothing ran" $?

reset; AGE_IDENTITY="" fo; code=$?
[ "$code" -ne 0 ] && grep -q 'AGE_IDENTITY' "$T/out" && [ ! -f "$FIX/ssh.log" ]; check "no age key: refused before it touches anything" $?

reset; rm -f "$FIX/alive-192.168.50.12"; fo; code=$?
[ "$code" -ne 0 ] && grep -q 'red .* does not answer' "$T/out"; check "red unreachable: refused" $?

reset; touch "$FIX/not-prepared"; fo; code=$?
[ "$code" -ne 0 ] && grep -q 'not prepared' "$T/out" && [ ! -f "$FIX/ran" ]; check "red not prepared (no encrypted secrets): refused" $?

reset; CONFIRM=yes fo; code=$?
[ "$code" -ne 0 ] && grep -q cancelled "$T/out" && [ ! -f "$FIX/env_written" ] && [ ! -f "$FIX/ran" ]; check "anything but the typed word FAILOVER: cancelled, nothing done" $?

reset; touch "$FIX/empty_env"; fo; code=$?
[ "$code" -ne 0 ] && grep -q 'look empty' "$T/out" && [ ! -f "$FIX/ran" ]; check "decrypted secrets that look empty (wrong key): stops before the board runs anything" $?

echo "# failover.sh — goes through"
reset; fo --dry-run; code=$?
[ "$code" -eq 0 ] && grep -q 'dry run' "$T/out" && [ ! -f "$FIX/env_written" ] && [ ! -f "$FIX/ran" ]; check "--dry-run: checks everything, changes nothing" $?
grep -q 'last replayed transaction is 42s old' "$T/out"; check "--dry-run: shows how stale the replica is" $?

reset; fo; code=$?
[ "$code" -eq 0 ]; check "all conditions met: exit 0" $?
grep -q '^JWT_SECRET=abc' "$FIX/env_written"; check "the secrets were decrypted here and sent to red" $?
grep -q 'RAN failover-red (env written first: yes)' "$FIX/ran"; check "the board's failover runs AFTER the secrets arrived" $?
grep -q 'forward TCP 80 and 443 to 192.168.50.12' "$T/out"; check "it ends by telling you the router step, with red's address" $?

reset; echo 'f|0' > "$FIX/state"; fo; code=$?
[ "$code" -eq 0 ] && grep -q 'already a primary' "$T/out"; check "a replica already promoted by an earlier run: carries on" $?

reset; touch "$FIX/alive-192.168.50.11"; I_KNOW_WHITE_IS_ALIVE=yes fo; code=$?
[ "$code" -eq 0 ]; check "I_KNOW_WHITE_IS_ALIVE=yes is the only way past a living white" $?

# ====================== failover-red.sh (the board) ======================
echo "# failover-red.sh"
BR="$T/board"; mkdir -p "$BR/bridge-pi" "$BR/standby" "$BR/home/.pipe" "$BR/mirror" "$BR/vol"
LOG="$BR/log"
printf '#!/usr/bin/env bash\necho "promote PROMOTE_CONFIRMED=${PROMOTE_CONFIRMED:-}" >> "$LOG"\n' > "$BR/standby/promote.sh"
mkdeploy() { printf '#!/usr/bin/env bash\necho "deploy args=$* POSTGRES_HOST=${POSTGRES_HOST:-} POSTGRES_REPLICAS=${POSTGRES_REPLICAS:-}" >> "$LOG"\n' > "$BR/bridge-pi/deploy.sh"; chmod +x "$BR/bridge-pi/deploy.sh"; }
mkdeploy
chmod +x "$BR/standby/promote.sh"
echo "JWT_SECRET=abc" > "$BR/home/.pipe/bridge.env"
printf '#!/usr/bin/env bash\necho ubuntu-red\n' > "$BIN/hostname"
printf '#!/usr/bin/env bash\nexec "$@"\n' > "$BIN/sudo"
printf '#!/usr/bin/env bash\n[ -f "$FIX/health_down" ] && exit 22\necho "{\\"status\\":\\"ok\\",\\"database\\":true}"\n' > "$BIN/curl"
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/sleep"
cat > "$BIN/docker" <<'SH'
#!/usr/bin/env bash
case "$1" in
  ps) [ -f "$FIX/no_standby" ] || echo standby-id;;
  exec) cat "$FIX/recovery";;
  volume)
    case "$2" in
      inspect) [ -f "$FIX/no_volume" ] && exit 1; [ "${3:-}" = "bridge_bridge_uploads" ] && [ "${4:-}" = "-f" ] && echo "$VOLDIR" || true;;
      create) rm -f "$FIX/no_volume"; echo "volume create $3" >> "$LOG";;
    esac;;
  node)
    case "$2" in
      ls) printf 'n-white\nn-red\n';;
      inspect)
        case "$*" in
          *Description.Hostname*) [ "$3" = n-white ] && echo ubuntu-white || echo ubuntu-red;;
          *'index .Spec.Labels'*) [ "$3" = n-white ] && echo true || true;;
        esac;;
      update) echo "node update $*" >> "$LOG";;
    esac;;
esac
SH
chmod +x "$BIN"/*
export LOG VOLDIR="$BR/vol"
red() { HOME="$BR/home" BRIDGE_DIR="$BR/bridge-pi" STANDBY_DIR="$BR/standby" UPLOADS_MIRROR="$BR/mirror" MAX_WAIT_SECONDS=0 "$HERE/failover-red.sh" > "$T/out" 2>&1; }
rreset() { rm -f "$LOG" "$FIX"/no_standby "$FIX"/no_volume "$FIX"/health_down; echo t > "$FIX/recovery"; rm -rf "$BR/vol" "$BR/mirror"; mkdir -p "$BR/vol" "$BR/mirror"; echo "pic" > "$BR/mirror/a.zip"; mkdir -p "$BR/mirror/chat"; echo "att" > "$BR/mirror/chat/b.png"; echo "JWT_SECRET=abc" > "$BR/home/.pipe/bridge.env"; mkdeploy; }

rreset; red; code=$?
[ "$code" -eq 0 ]; check "the board's failover goes through" $?
grep -q 'promote PROMOTE_CONFIRMED=yes' "$LOG"; check "promotes the replica, non-interactively (the workstation already asked)" $?
[ "$(cat "$BR/vol/a.zip")" = pic ] && [ "$(cat "$BR/vol/chat/b.png")" = att ]; check "restores the uploads, subfolders included, into the volume" $?
grep -q 'node update --label-rm bridge-primary n-white' "$LOG"; check "takes the bridge-primary label off white" $?
grep -q 'node update --label-add bridge-primary=true --label-add failover=active ubuntu-red' "$LOG"; check "marks red bridge-primary AND failover=active (the fence)" $?
grep -q 'deploy args=ghcr stable POSTGRES_HOST=postgres-standby POSTGRES_REPLICAS=0' "$LOG"; check "deploys the stack from GHCR against the promoted replica, with no postgres service" $?
order="$(grep -nE 'promote|label-rm|label-add|deploy' "$LOG" | cut -d: -f1 | tr '\n' ' ')"; echo "$order" | grep -q '^[0-9]* [0-9]* [0-9]* [0-9]* $'
p="$(grep -n promote "$LOG" | cut -d: -f1)"; l="$(grep -n 'label-add' "$LOG" | cut -d: -f1)"; d="$(grep -n 'deploy args' "$LOG" | cut -d: -f1)"
[ "$p" -lt "$l" ] && [ "$l" -lt "$d" ]; check "order: promote → roles/fence → deploy (the fence is up before anything starts)" $?

rreset; echo f > "$FIX/recovery"; red
! grep -q '^promote' "$LOG" && grep -q 'already a primary' "$T/out" && grep -q 'deploy args' "$LOG"; check "an already promoted replica: not promoted again, the rest continues" $?

rreset; echo "keep me" > "$BR/vol/existing.zip"; red
[ ! -f "$BR/vol/a.zip" ] && [ "$(cat "$BR/vol/existing.zip")" = "keep me" ] && grep -q 'left alone' "$T/out"; check "a volume that already has files is not overwritten" $?

rreset; rm -rf "$BR/mirror"; red; code=$?
[ "$code" -eq 0 ] && grep -q 'WARNING: no uploads copy' "$T/out"; check "no uploads copy: warns loudly and goes on (the database matters more)" $?

rreset; rm -f "$BR/home/.pipe/bridge.env"; red; code=$?
[ "$code" -ne 0 ] && [ ! -f "$LOG" ]; check "no decrypted secrets: refuses before changing anything" $?

rreset; touch "$FIX/no_standby"; red; code=$?
[ "$code" -ne 0 ] && ! grep -q 'node update' "$LOG" 2>/dev/null; check "no replica container: refuses before changing anything" $?

rreset; rm -f "$BR/bridge-pi/deploy.sh"; red; code=$?
[ "$code" -ne 0 ]; check "no stack scripts on red: refuses (prepare-red.sh was not run)" $?

rreset; touch "$FIX/health_down"; red; code=$?
[ "$code" -ne 0 ] && grep -q 'did not become healthy' "$T/out"; check "an API that never reports a healthy database: exit 1 with the reason" $?

echo; echo "passed $PASS, failed $FAILED"
[ "$FAILED" -eq 0 ]
