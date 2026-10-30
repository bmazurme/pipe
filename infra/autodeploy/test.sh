#!/usr/bin/env bash
#
# Tests for autodeploy.sh with fake curl / docker / deploy scripts (no network, no Swarm). Linux only (flock):
#   docker run --rm -v "$PWD/../..":/r debian:bookworm-slim bash -c 'apt-get update -qq && apt-get install -y -qq python3 && bash /r/infra/autodeploy/test.sh'
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0
FIX="$T/fix"; BIN="$T/bin"; BRIDGE="$T/bridge-pi"; STATE="$T/state"
mkdir -p "$FIX/files" "$BIN" "$BRIDGE" "$STATE"
export PATH="$BIN:$PATH" FIX BRIDGE_DIR="$BRIDGE" STATE_DIR="$STATE" MAX_WAIT_SECONDS=1 API_URL=http://api.test NOTIFY_CMD="$T/notify"

printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/sleep"
cat > "$T/notify" <<'SH'
#!/usr/bin/env bash
echo "$1" >> "$FIX/notified"
SH

# ---- fake curl
cat > "$BIN/curl" <<'SH'
#!/usr/bin/env bash
[ -z "${FIX_DOWN:-}" ] || exit 6
out=""; head_only=0; url=""; data=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2;;
    -K) cat > "$FIX/last_stdin"; shift 2;;
    -X) shift 2;;
    --data) data="$2"; shift 2;;
    -I|-fsSI) head_only=1; shift;;
    -H|--max-time) shift 2;;
    -*) case "$1" in *I*) head_only=1;; esac; shift;;
    *) url="$1"; shift;;
  esac
done
case "$url" in
  https://ghcr.io/token*) echo '{"token":"t"}';;
  https://ghcr.io/v2/*/manifests/stable)
    img="$(echo "$url" | sed -E 's#.*/v2/[^/]+/([^/]+)/manifests.*#\1#')"
    [ -f "$FIX/digest-$img" ] || exit 22
    printf 'HTTP/2 200\r\ndocker-content-digest: %s\r\n\r\n' "$(cat "$FIX/digest-$img")";;
  https://api.github.com/*) printf '{"workflow_runs":[{"head_sha":"%s"}]}' "$(cat "$FIX/sha")";;
  https://raw.githubusercontent.com/*)
    name="${url##*/}"; [ -f "$FIX/files/$name" ] || exit 22
    if [ -n "$out" ]; then cp "$FIX/files/$name" "$out"; else cat "$FIX/files/$name"; fi;;
  http://api.test/api/v1/loop/deploys)
    [ -z "${FIX_REPORT_DOWN:-}" ] || exit 22
    echo "$data" >> "$FIX/reports"; echo '{}';;
  http://api.test/api/v1/health)
    [ ! -f "$FIX/health_fail" ] || exit 22
    echo '{"status":"ok","database":true,"pendingMigrations":false}';;
  *) echo "unexpected curl $url" >&2; exit 22;;
esac
SH

# ---- fake docker
cat > "$BIN/docker" <<'SH'
#!/usr/bin/env bash
case "$1 $2" in
  "stack services") [ "$3" = bridge ] && printf 'bridge_backend\nbridge_frontend\nbridge_caddy\n' || printf 'bridgew_worker\nbridgew_vpn-client\n';;
  "service inspect")
    name="$3"
    case "$*" in
      *Version.Index*) cat "$FIX/index-$name";;
      *ContainerSpec.Image*) cat "$FIX/image-$name";;
    esac;;
  "node ls") [ -f "$FIX/failover" ] && printf 'n1\nn2\n';;
  "node inspect") cat "$FIX/failover" 2>/dev/null;;
  "service ls") cat "$FIX/replicas";;
  "service rollback") echo "$3" >> "$FIX/rollbacks";;
  *) echo "unexpected docker $*" >&2; exit 1;;
esac
SH
chmod +x "$BIN/curl" "$BIN/docker" "$BIN/sleep" "$T/notify"

# ---- fake deploy scripts: what a stack deploy does to the (fake) Swarm, chosen by FIX_DEPLOY_MODE
cat > "$BRIDGE/deploy.sh" <<'SH'
#!/usr/bin/env bash
echo "deploy.sh $*" >> "$FIX/calls"
[ "${FIX_DEPLOY_MODE:-ok}" != fail ] || exit 1
for pair in "bridge_backend 1" "bridge_frontend 2"; do set -- $pair
  echo $(( $(cat "$FIX/index-$1") + 1 )) > "$FIX/index-$1"
  [ "${FIX_DEPLOY_MODE:-ok}" = swarm-rollback ] || echo "repo:stable@$(cat "$FIX/digest-$(echo $1 | sed 's/bridge_/pipe-bridge-/')")" > "$FIX/image-$1"
done
[ "${FIX_DEPLOY_MODE:-ok}" != bad ] || printf 'bridge_backend 0/1\nbridge_frontend 1/1\nbridge_caddy 1/1\nbridgew_worker 1/1\nbridgew_vpn-client 1/1\n' > "$FIX/replicas"
SH
cat > "$BRIDGE/deploy-worker.sh" <<'SH'
#!/usr/bin/env bash
echo "deploy-worker.sh $*" >> "$FIX/calls"
echo $(( $(cat "$FIX/index-bridgew_worker") + 1 )) > "$FIX/index-bridgew_worker"
[ "${FIX_DEPLOY_MODE:-ok}" = swarm-rollback ] || echo "repo:stable@$(cat "$FIX/digest-pipe-worker")" > "$FIX/image-bridgew_worker"
SH
chmod +x "$BRIDGE/deploy.sh" "$BRIDGE/deploy-worker.sh"

set_published() { # sha d1 d2 d3
  echo "$1" > "$FIX/sha"
  echo "sha256:$2" > "$FIX/digest-pipe-bridge-backend"
  echo "sha256:$3" > "$FIX/digest-pipe-bridge-frontend"
  echo "sha256:$4" > "$FIX/digest-pipe-worker"
}
fresh_swarm() {
  rm -f "$FIX/calls" "$FIX/rollbacks" "$FIX/notified" "$FIX/health_fail"
  for n in bridge_backend bridge_frontend bridge_caddy bridgew_worker bridgew_vpn-client; do echo 5 > "$FIX/index-$n"; echo "repo:stable@sha256:old-$n" > "$FIX/image-$n"; done
  printf 'bridge_backend 1/1\nbridge_frontend 1/1\nbridge_caddy 1/1\nbridgew_worker 1/1\nbridgew_vpn-client 1/1\n' > "$FIX/replicas"
}
yml() { printf 'version: "3.8"\nservices:\n  x: %s\n' "$1"; }
files() { yml "$1" > "$FIX/files/bridge-pi.yml"; yml "$1" > "$FIX/files/worker-pi.yml"; yml "$1" > "$FIX/files/worker-managed-pi.yml"; echo "caddy $1" > "$FIX/files/Caddyfile"; }
run() { "$HERE/autodeploy.sh" "$@" > "$T/out" 2>&1; }
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/out"; fi; }
calls() { cat "$FIX/calls" 2>/dev/null | tr '\n' ';'; }

# the release id the script computes: "<sha> <d1> <d2> <d3>" hashed (the script's digest list has a leading space — keep it byte-for-byte identical)
rid() { printf '%s %s' "$(cat "$FIX/sha")" " $(cat "$FIX/digest-pipe-bridge-backend") $(cat "$FIX/digest-pipe-bridge-frontend") $(cat "$FIX/digest-pipe-worker")" | sha256sum | cut -c1-16; }

echo "# up to date"
fresh_swarm; set_published aaaaaaaa1111 b1 f1 w1; files v1
echo "$(rid) aaaaaaaa $(date -u +%FT%TZ)" > "$STATE/deployed.txt"
run; check "up to date: exit 0" $?
[ -z "$(calls)" ] && [ ! -s "$T/out" ]; check "up to date: nothing deployed, nothing said" $?

echo "# new release, healthy"
fresh_swarm; set_published bbbbbbbb2222 b2 f2 w2; files v2; echo old > "$BRIDGE/bridge-pi.yml"
run; check "new release: exit 0" $?
[ "$(calls)" = "deploy.sh ghcr stable;deploy-worker.sh ghcr stable;" ]; check "new release: both deploy scripts, from GHCR, tag stable" $?
grep -q 'x: v2' "$BRIDGE/bridge-pi.yml" && grep -q 'x: v2' "$BRIDGE/worker-pi.yml" && grep -q 'x: v2' "$BRIDGE/worker-managed-pi.yml" && grep -q 'caddy v2' "$BRIDGE/Caddyfile"; check "new release: the stack files of that commit were put in place" $?
cut -d' ' -f1,2 "$STATE/deployed.txt" | grep -q "^$(rid) bbbbbbbb$"; check "new release: recorded as deployed" $?
grep -q '✅ Pi: развёрнута версия bbbbbbbb' "$FIX/notified"; check "new release: the owner is told" $?
[ ! -s "$FIX/rollbacks" ]; check "new release: nothing rolled back" $?

echo "# unhealthy: roll back what this deploy touched"
fresh_swarm; set_published cccccccc3333 b3 f3 w3; files v3; echo "previous" > "$BRIDGE/bridge-pi.yml"; echo "previous" > "$BRIDGE/worker-pi.yml"; echo "previous" > "$BRIDGE/Caddyfile"
rm -f "$STATE/failed.txt"; FIX_DEPLOY_MODE=bad run; code=$?
[ "$code" -eq 1 ]; check "unhealthy: exit 1 (the unit shows as failed)" $?
sort "$FIX/rollbacks" | tr '\n' ' ' | grep -q '^bridge_backend bridge_frontend bridgew_worker $'; check "unhealthy: exactly the services the deploy touched are rolled back" $?
[ "$(cat "$BRIDGE/bridge-pi.yml")" = previous ] && [ "$(cat "$BRIDGE/Caddyfile")" = previous ]; check "unhealthy: the previous stack files are back" $?
cut -d' ' -f1 "$STATE/failed.txt" | grep -q "^$(rid)$"; check "unhealthy: the release is remembered as failed" $?
cut -d' ' -f1 "$STATE/deployed.txt" | grep -qv "^$(rid)$"; check "unhealthy: the deployed record is not moved" $?
grep -q '🔴 Pi: версия cccccccc не поднялась' "$FIX/notified"; check "unhealthy: the owner is told" $?

echo "# the same failed release is not retried"
fresh_swarm; run; check "failed release: exit 0" $?
[ -z "$(calls)" ]; check "failed release: no deploy attempt" $?

echo "# a newer release is tried again and clears the failure"
fresh_swarm; set_published dddddddd4444 b4 f4 w4; files v4
run; check "newer release: deploys" $?
[ ! -f "$STATE/failed.txt" ]; check "newer release: failure record cleared" $?

echo "# swarm rolled back by itself"
fresh_swarm; set_published eeeeeeee5555 b5 f5 w5; files v5
FIX_DEPLOY_MODE=swarm-rollback run; code=$?
[ "$code" -eq 1 ]; check "swarm rollback: exit 1" $?
[ ! -s "$FIX/rollbacks" ]; check "swarm rollback: we do NOT roll back again (that would go forward to the bad version)" $?
cut -d' ' -f1 "$STATE/failed.txt" | grep -q "^$(rid)$"; check "swarm rollback: remembered as failed" $?
grep -q 'сам откатил' "$FIX/notified"; check "swarm rollback: the owner is told Swarm did it" $?

echo "# a deploy script that fails"
fresh_swarm; set_published ffffffff6666 b6 f6 w6; files v6
FIX_DEPLOY_MODE=fail run; code=$?
[ "$code" -eq 1 ]; check "deploy script failure: exit 1" $?
[ ! -s "$FIX/rollbacks" ]; check "deploy script failure: nothing to roll back when nothing changed" $?
cut -d' ' -f1 "$STATE/failed.txt" | grep -q "^$(rid)$"; check "deploy script failure: remembered as failed" $?

echo "# things that must not deploy"
fresh_swarm; rm -f "$STATE/failed.txt"; set_published 11111111aaaa b7 f7 w7; files v7
FIX_DOWN=1 run; code=$?
[ "$code" -eq 0 ] && [ -z "$(calls)" ]; check "registry unreachable: quiet exit 0, nothing deployed" $?

rm -f "$FIX/digest-pipe-worker"; run; code=$?
[ "$code" -eq 0 ] && [ -z "$(calls)" ]; check "no stable tag for an image yet: nothing deployed" $?

set_published 22222222bbbb b8 f8 w8; echo 'broken: true' > "$FIX/files/bridge-pi.yml"
run; code=$?
[ "$code" -eq 0 ] && [ -z "$(calls)" ]; check "a stack file without services: is refused, nothing deployed" $?
grep -q 'bad-stack-files' "$STATE/failed.txt"; check "…and remembered, so it is not fetched again every five minutes" $?

echo "# status"
run status; check "status runs" $?
grep -q 'deployed:' "$T/out" && grep -q 'published: 22222222bbbb' "$T/out"; check "status shows the deployed and the published release" $?

echo "# a failover to another board is active"
fresh_swarm; rm -f "$STATE/failed.txt"; set_published 33333333cccc b9 f9 w9; files v9
printf 'ubuntu-white \nubuntu-red active\n' > "$FIX/failover"
run; code=$?
[ "$code" -eq 0 ] && [ -z "$(calls)" ]; check "failover active elsewhere: nothing is deployed (the old primary must not come back)" $?
grep -q 'failover to ubuntu-red is active' "$T/out"; check "failover active elsewhere: it says why" $?
rm -f "$FIX/failover"
run; check "no failover label: deploys again" $?
[ -n "$(calls)" ]; check "no failover label: the deploy scripts ran" $?

echo "# reporting to bridge"
export BRIDGE_API_KEY=brk_test
reports_ok() { # <line number> <result> <sha prefix> <previous>  → the nth report has those fields
  sed -n "$1p" "$FIX/reports" | RESULT="$2" SHA="$3" PREVIOUS="$4" python3 -c '
import json, os, sys
body = json.load(sys.stdin)
ok = body["result"] == os.environ["RESULT"] and body["sha"].startswith(os.environ["SHA"]) and body.get("previousSha", "") == os.environ["PREVIOUS"]
sys.exit(0 if ok else 1)'
}
fresh_swarm; rm -f "$FIX/reports" "$FIX/last_stdin" "$STATE/failed.txt" "$STATE/deploy-report.pending"; set_published 44444444dddd b10 f10 w10; files v10
previous="$(cut -d' ' -f2 "$STATE/deployed.txt")"
run; check "reported release: deploys" $?
reports_ok 1 deployed 44444444dddd "$previous"; check "a release that went out is reported, with the release it replaced" $?
grep -q 'Authorization: Bearer brk_test' "$FIX/last_stdin"; check "the key goes to curl on stdin" $?

fresh_swarm; set_published 55555555eeee b11 f11 w11; files v11; previous="$(cut -d' ' -f2 "$STATE/deployed.txt")"
FIX_DEPLOY_MODE=bad run; code=$?
[ "$code" -eq 1 ]; check "unhealthy release: exit 1 as before" $?
reports_ok 2 rolled_back 55555555eeee "$previous"; check "a release rolled back for health is reported as rolled back" $?

fresh_swarm; set_published 66666666ffff b12 f12 w12; files v12
FIX_DEPLOY_MODE=swarm-rollback run
reports_ok 3 rolled_back 66666666ffff "$previous"; check "a release Swarm rolled back by itself is reported as rolled back" $?

fresh_swarm; set_published 77777777aaaa b13 f13 w13; echo 'broken: true' > "$FIX/files/bridge-pi.yml"; rm -f "$STATE/failed.txt"
run
reports_ok 4 failed 77777777aaaa "$previous"; check "a release that was refused (bad stack files) is reported as failed" $?

echo "# bridge is down when a release is rolled back"
fresh_swarm; rm -f "$FIX/reports"; set_published 88888888bbbb b14 f14 w14; files v14
FIX_REPORT_DOWN=1 FIX_DEPLOY_MODE=bad run; code=$?
[ "$code" -eq 1 ] && [ ! -e "$FIX/reports" ]; check "bridge down: the deploy outcome is unchanged and nothing was delivered" $?
[ "$(wc -l < "$STATE/deploy-report.pending")" -eq 1 ]; check "bridge down: the report is kept for later" $?
run; code=$?
[ -s "$FIX/reports" ] && [ ! -e "$STATE/deploy-report.pending" ]; check "the next pass delivers the kept report and clears the file" $?
reports_ok 1 rolled_back 88888888bbbb "$previous"; check "…and it is the rolled-back release" $?

echo "# no key: nothing is reported"
unset BRIDGE_API_KEY
fresh_swarm; rm -f "$FIX/reports" "$STATE/failed.txt"; set_published 99999999cccc b15 f15 w15; files v15
run; check "no key: deploys as before" $?
[ ! -e "$FIX/reports" ] && [ ! -e "$STATE/deploy-report.pending" ]; check "no key: nothing sent, nothing kept" $?

echo; echo "passed $PASS, failed $FAILED"
[ "$FAILED" -eq 0 ]
