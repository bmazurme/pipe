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
export PATH="$BIN:$PATH" FIX BRIDGE_DIR="$BRIDGE" STATE_DIR="$STATE" MAX_WAIT_SECONDS=1 SOAK_MINUTES=30 API_URL=http://api.test NOTIFY_CMD="$T/notify"

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
  https://api.github.com/repos/*/actions/*) printf '{"workflow_runs":[{"head_sha":"%s"}]}' "$(cat "$FIX/sha")";;
  https://api.github.com/repos/*/compare/*) [ -f "$FIX/compare.json" ] && cat "$FIX/compare.json" || exit 22;;
  https://api.github.com/repos/*/commits/*) [ -f "$FIX/commit.json" ] && cat "$FIX/commit.json" || exit 22;;
  https://api.github.com/repos/*/issues/*) n="${url##*/}"; [ -f "$FIX/issue-$n.json" ] && cat "$FIX/issue-$n.json" || exit 22;;
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

echo "# the soak: a risky change made by the bot waits; everything else goes at once"
# a release made of the given squash commits: "<pr> <minutes ago>" pairs; labels per PR in issue-<n>.json
commits_of() { # "n:minutes_ago" ...
  python3 - "$@" > "$FIX/compare.json" <<PY
import json, sys, time
commits = []
for arg in sys.argv[1:]:
    n, ago = arg.split(":")
    t = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - int(ago) * 60))
    commits.append({"sha": "c" + n, "commit": {"message": "Some change (#%s)\n\nbody" % n, "committer": {"date": t}}})
print(json.dumps({"commits": commits}))
PY
}
labels() { # n label...
  n="$1"; shift
  python3 -c 'import json,sys; print(json.dumps({"labels":[{"name":l} for l in sys.argv[1:]]}))' "$@" > "$FIX/issue-$n.json"
}
soak_reset() { fresh_swarm; rm -f "$STATE/failed.txt" "$STATE/soak.txt" "$FIX/compare.json" "$FIX/commit.json" "$FIX"/issue-*.json; echo "oldoldid oldold1 $(date -u +%FT%TZ)" > "$STATE/deployed.txt"; }

soak_reset; set_published 1010101010aa s1 sf1 sw1; files s1
commits_of 501:5; labels 501 loop risk:high
run; check "risk:high bot PR merged 5 min ago: exit 0" $?
[ -z "$(calls)" ]; check "risk:high bot PR merged 5 min ago: NOT deployed yet" $?
grep -q '⏳ Pi: версия 10101010 ждёт выдержки ещё ~25 мин' "$FIX/notified" && grep -q '#501(risk:high)' "$FIX/notified"; check "...the owner is told how long and which pull request" $?
rm -f "$FIX/notified"; run
[ -z "$(calls)" ] && [ ! -e "$FIX/notified" ]; check "...the next pass still waits, and does not say it again" $?
awk '{print ($2>0 && $3==1) ? "ok" : "bad"}' "$STATE/soak.txt" | grep -q ok; check "...the decision is kept (not asked from GitHub every five minutes)" $?
run status; grep -q 'soak:      release .* waits' "$T/out"; check "...status says it is waiting" $?
rm -f "$FIX/compare.json"; run
[ -z "$(calls)" ]; check "...a kept decision does not need GitHub again" $?

# time passes: the soak is over
python3 - "$STATE/soak.txt" <<'PY'
import sys
p = sys.argv[1]; f = open(p).read().split()
f[1] = "1"  # long ago
open(p, "w").write(" ".join(f) + "\n")
PY
run
[ "$(calls)" = "deploy.sh ghcr stable;deploy-worker.sh ghcr stable;" ]; check "...after the soak the release goes live" $?

soak_reset; set_published 2020202020bb s2 sf2 sw2; files s2
commits_of 502:5; labels 502 loop risk:medium
run; [ -z "$(calls)" ]; check "risk:medium bot PR: waits too" $?

soak_reset; set_published 3030303030cc s3 sf3 sw3; files s3
commits_of 503:5; labels 503 loop risk:low
run; [ -n "$(calls)" ]; check "risk:low bot PR (docs, tests, styling): deployed at once" $?

soak_reset; set_published 4040404040dd s4 sf4 sw4; files s4
commits_of 504:5; labels 504 risk:high
run; [ -n "$(calls)" ]; check "a risky change a PERSON merged (no bot label): deployed at once" $?

soak_reset; set_published 5050505050ee s5 sf5 sw5; files s5
commits_of 505:90; labels 505 loop risk:high
run; [ -n "$(calls)" ]; check "a risky bot PR merged 90 minutes ago: soak is over, deployed" $?

soak_reset; set_published 6060606060ff s6 sf6 sw6; files s6
commits_of 506:5 507:100; labels 506 loop risk:low; labels 507 loop risk:high
run; [ -n "$(calls)" ]; check "a release of several PRs: only the risky one counts, by ITS merge time (old one: no wait)" $?

soak_reset; set_published 7070707070aa s7 sf7 sw7; files s7
commits_of 508:100 509:10; labels 508 loop risk:high; labels 509 loop risk:medium
run; [ -z "$(calls)" ]; check "a release of several risky PRs waits for the NEWEST one" $?
grep -q '#508(risk:high) #509(risk:medium)' "$FIX/notified"; check "...and names all of them" $?

soak_reset; set_published 8080808080bb s8 sf8 sw8; files s8
rm -f "$STATE/deployed.txt"
python3 - > "$FIX/commit.json" <<'PY'
import json, time
t = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 300))
print(json.dumps({"sha": "x", "commit": {"message": "First one (#510)", "committer": {"date": t}}}))
PY
labels 510 loop risk:high
run; [ -z "$(calls)" ]; check "the first release ever (nothing deployed before): looks at that one commit" $?

soak_reset; set_published 9090909090cc s9 sf9 sw9; files s9
commits_of 511:5; labels 511 loop risk:high
SOAK_MINUTES=0 run; [ -n "$(calls)" ]; check "SOAK_MINUTES=0 turns the soak off" $?

soak_reset; set_published a0a0a0a0a0dd sa sfa swa; files sa
commits_of 512:5; labels 512 loop risk:high
run now; [ -n "$(calls)" ]; check "autodeploy.sh now: goes at once" $?
SOAK_MINUTES=lots run; check "a SOAK_MINUTES that is not a number falls back to 30, and says so" $?

soak_reset; set_published b0b0b0b0b0ee sb sfb swb; files sb
# no compare.json / issue files: GitHub does not answer
run; [ -n "$(calls)" ]; check "GitHub not answering never holds a release back (the soak is a margin, not a gate)" $?

soak_reset; set_published c0c0c0c0c0ff sc sfc swc; files sc
commits_of 513:5; rm -f "$FIX/issue-513.json"
run; [ -n "$(calls)" ]; check "a pull request whose labels cannot be read does not hold the release back" $?

soak_reset; set_published d0d0d0d0d0aa sd sfd swd; files sd
python3 -c 'import json,time; print(json.dumps({"commits":[{"sha":"x","commit":{"message":"Direct push, no PR","committer":{"date":time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}}}]}))' > "$FIX/compare.json"
run; [ -n "$(calls)" ]; check "a commit without a pull request number does not wait" $?

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
