#!/usr/bin/env bash
# Tests for protect-main.sh: the required checks are job names of ci.yml, the payload is what it says, a stale name is refused. No network (a fake gh).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
pass=0; fail=0
check() { if [ "$2" = 0 ]; then echo "ok   $1"; pass=$((pass + 1)); else echo "FAIL $1"; fail=$((fail + 1)); [ -f "$T/out" ] && sed 's/^/     | /' "$T/out"; fi; }

cat > "$T/bin/gh" <<'SH'
#!/usr/bin/env bash
echo "gh $*" >> "$FAKE_GH_LOG"
[ "$1" = api ] && [ "$2" = -X ] && [ "$3" = PUT ] && cat > "$FAKE_GH_BODY"
exit 0
SH
chmod +x "$T/bin/gh"
export PATH="$T/bin:$PATH" FAKE_GH_LOG="$T/gh.log" FAKE_GH_BODY="$T/body.json"

run() { bash "$HERE/protect-main.sh" "$@" > "$T/out" 2>&1; }

echo "# the real ci.yml"
run show; check "show: every required check is a job name of the real ci.yml" $?
grep -q "all of them are job names" "$T/out"; check "show: says so" $?
[ ! -s "$T/gh.log" ] || ! grep -q -- '-X PUT' "$T/gh.log"; check "show: changes nothing (no PUT)" $?

echo "# apply"
: > "$T/gh.log"; run apply; check "apply: succeeds" $?
grep -q -- '-X PUT repos/bmazurme/pipe/branches/main/protection' "$T/gh.log"; check "apply: PUTs the protection of main" $?
python3 - "$T/body.json" <<'PY'
import json, sys
b = json.load(open(sys.argv[1]))
checks = b["required_status_checks"]
ok = (len(checks["contexts"]) == 8 and checks["strict"] is False and b["enforce_admins"] is False
      and b["required_pull_request_reviews"] is None and b["restrictions"] is None
      and b["allow_force_pushes"] is False and b["allow_deletions"] is False)
sys.exit(0 if ok else 1)
PY
check "apply: eight required checks, not strict, admins not enforced, no review, no force pushes, no deleting" $?

echo "# a stale name is refused"
cat > "$T/ci.yml" <<'YML'
jobs:
  protocol:
    name: protocol (build, tests)
YML
: > "$T/gh.log"; CI_FILE="$T/ci.yml" run apply; code=$?
[ "$code" -ne 0 ]; check "apply: refuses when a required check is not a job of ci.yml" $?
grep -q 'harness (build, tests)' "$T/out"; check "apply: names the ones that are missing" $?
! grep -q -- '-X PUT' "$T/gh.log"; check "apply: nothing was sent" $?
CI_FILE="$T/ci.yml" run show; [ $? -ne 0 ]; check "show: says PROBLEM for the same" $?

echo "# remove, usage"
: > "$T/gh.log"; run remove; check "remove: succeeds" $?
grep -q -- '-X DELETE repos/bmazurme/pipe/branches/main/protection' "$T/gh.log"; check "remove: DELETEs the protection" $?
run nonsense; [ $? -eq 2 ]; check "an unknown word is a usage error" $?

echo; echo "passed $pass, failed $fail"
[ "$fail" = 0 ]
