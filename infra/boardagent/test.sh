#!/usr/bin/env bash
#
# Tests for board-agent.sh with a fake curl (no network, nothing outside a temp directory):  bash infra/boardagent/test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'chmod -R u+w "$T" 2>/dev/null; rm -rf "$T"' EXIT
PASS=0; FAILED=0
mkdir -p "$T/bin" "$T/repo" "$T/board" "$T/calls"
export PATH="$T/bin:$PATH"

SHA="$(printf 'c823ea56%032d' 0)"

# One fake curl for everything the agent talks to: the bridge (answers from files, records what it was sent), GitHub's compare API and
# raw.githubusercontent.com (serves $FAKE_REPO/<sha>/<path>, or $FAKE_REPO/main/<path> for check-scripts.sh's comparison).
cat > "$T/bin/curl" <<'SH'
#!/usr/bin/env bash
out=""; url=""; method=GET; data=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -X) method="$2"; shift 2 ;;
    --data) data="$2"; shift 2 ;;
    -H|--max-time) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
case "$url" in
  "$BRIDGE_API_URL"*)
    [ -z "${FAKE_BRIDGE_DOWN:-}" ] || exit 7
    path="${url#"$BRIDGE_API_URL"}"
    case "$path" in
      /api/v1/boards/agent/pending*) cat "$FAKE_PENDING" ;;
      *) n=$(( $(ls "$FAKE_CALLS" | wc -l) + 1 )); printf '%s %s\n%s\n' "$method" "$path" "$data" > "$FAKE_CALLS/$n" ;;
    esac ;;
  "$GITHUB_API"/repos/*/compare/*) printf '{"status": "%s"}' "$FAKE_COMPARE" ;;
  "$RAW_HOST"/*) path="${url#"$RAW_HOST"/*/*/}"; [ -f "$FAKE_REPO/$path" ] || exit 22; cp "$FAKE_REPO/$path" "$out" ;;
  *) path="${url#"$RAW_BASE"/}"; [ -f "$FAKE_REPO/main/$path" ] || exit 22; cp "$FAKE_REPO/main/$path" "$out" ;;
esac
SH
chmod +x "$T/bin/curl"
# the lock is the boards' flock; here nothing else runs
printf '#!/bin/sh\nexit 0\n' > "$T/bin/flock"; chmod +x "$T/bin/flock"

export BRIDGE_API_URL="https://bridge.example" BRIDGE_API_KEY="brk_test" GITHUB_API="https://api.github.example" RAW_HOST="https://raw.example"
export RAW_BASE="https://raw.example/o/r/main" FAKE_REPO="$T/repo" FAKE_PENDING="$T/pending.json" FAKE_CALLS="$T/calls" FAKE_COMPARE=behind
export STATE_DIR="$T/state" BOARD_HOST="ubuntu-red" BRIDGE_PI_DIR="$T/board/bridge-pi" MANIFEST_FILE="$T/manifest.txt"
export CHECK_SCRIPT="$HERE/../scriptcheck/check-scripts.sh" SCRIPTCHECK_MANIFEST="$T/manifest.txt" MAIN_SHA="$SHA" STATE_DIR_CHECK="$T/check-state"
export STATE_DIR="$T/state"

mkdir -p "$T/repo/$SHA/infra/backup" "$T/repo/$SHA/infra/notify" "$T/repo/main/infra/backup" "$T/repo/main/infra/notify" "$T/board/bridge-pi"
printf '#!/usr/bin/env bash\necho pull v2\n' > "$T/repo/$SHA/infra/backup/uploads-pull.sh"
printf '#!/usr/bin/env bash\necho backup v1\n' > "$T/repo/$SHA/infra/backup/backup.sh"
printf '#!/usr/bin/env bash\necho notify v2\n' > "$T/repo/$SHA/infra/notify/notify-telegram"
cp "$T/repo/$SHA/infra/backup/"* "$T/repo/main/infra/backup/"; cp "$T/repo/$SHA/infra/notify/"* "$T/repo/main/infra/notify/"
printf '%s|infra/backup/uploads-pull.sh\n%s|infra/backup/backup.sh\n%s|infra/notify/notify-telegram\n@BRIDGE_PI@/deploy.sh|infra/bridge-pi/deploy.sh\n%s|infra/backup/not-on-this-board.sh\n%s|infra/boardagent/board-agent.sh\n' \
  "$T/board/uploads-pull.sh" "$T/board/backup.sh" "$T/board/notify-telegram" "$T/board/nothing.sh" "$T/board/agent.sh" > "$T/manifest.txt"

board() { # what the board has: uploads-pull old, the others as in the repository
  printf '#!/usr/bin/env bash\necho pull v1\n' > "$T/board/uploads-pull.sh"; chmod 750 "$T/board/uploads-pull.sh"
  cp "$T/repo/$SHA/infra/backup/backup.sh" "$T/board/backup.sh"
  printf '#!/usr/bin/env bash\necho notify v1\n' > "$T/board/notify-telegram"; chmod 755 "$T/board/notify-telegram"
  printf '#!/usr/bin/env bash\necho agent\n' > "$T/board/agent.sh"
}
decision() { # id path…
  local id="$1"; shift
  python3 -c 'import json, sys; print(json.dumps({"update": {"id": int(sys.argv[1]), "sha": sys.argv[2], "repoPaths": sys.argv[3:]}}))' "$id" "${DEC_SHA:-$SHA}" "$@" > "$T/pending.json"
}
agent() { "$HERE/board-agent.sh" "$@" > "$T/stdout" 2> "$T/stderr"; echo $? > "$T/code"; }
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/stdout" "$T/stderr"; fi; }
fresh() { rm -rf "$T/state" "$T/calls"; mkdir -p "$T/calls"; unset DEC_SHA; FAKE_COMPARE=behind; board; }
calls() { ls "$T/calls" | wc -l | tr -d ' '; }
last_result() { f="$(grep -l 'updates/.*/result' "$T"/calls/* | tail -1)"; sed -n 2p "$f"; }
board_has() { grep -q "$2" "$T/board/$1"; }

# ---- manifest: the same list as the one check-scripts.sh carries
python3 - "$HERE/../scriptcheck/check-scripts.sh" "$HERE/manifest.txt" <<'PY'
import re, sys
built_in = re.search(r"cat <<'LIST'\n(.*?)\nLIST", open(sys.argv[1]).read(), re.S).group(1).strip().splitlines()
mine = open(sys.argv[2]).read().strip().splitlines()
sys.exit(0 if built_in == mine else 1)
PY
check "the agent's manifest is the list check-scripts.sh compares" $?

# ---- report
fresh; agent report
[ "$(calls)" = 1 ] && grep -q 'POST /api/v1/boards/agent/report' "$T/calls/1"; check "report: posts to bridge" $?
python3 - "$T/calls/1" "$SHA" <<'PY'
import json, sys
body = json.loads(open(sys.argv[1]).read().split("\n", 1)[1])
scripts = {s["repoPath"]: s["status"] for s in body["scripts"]}
ok = (body["host"] == "ubuntu-red" and body["mainSha"] == sys.argv[2] and body["agentVersion"] == "1"
      and scripts == {"infra/backup/uploads-pull.sh": "outdated", "infra/backup/backup.sh": "current", "infra/notify/notify-telegram": "outdated"})
sys.exit(0 if ok else 1)
PY
check "…with the board's name, the commit and which scripts are outdated" $?

# ---- apply: nothing to do
fresh; echo '{"update": null}' > "$T/pending.json"; agent apply
[ "$(cat "$T/code")" = 0 ] && [ "$(calls)" = 0 ] && board_has uploads-pull.sh 'pull v1'; check "no decision: nothing is done and nothing is sent" $?

fresh; FAKE_BRIDGE_DOWN=1 agent apply; unset FAKE_BRIDGE_DOWN
[ "$(cat "$T/code")" = 0 ] && board_has uploads-pull.sh 'pull v1'; check "bridge unreachable: nothing is done" $?

# ---- apply: the happy path
fresh; decision 11 infra/backup/uploads-pull.sh infra/notify/notify-telegram; agent apply
board_has uploads-pull.sh 'pull v2' && board_has notify-telegram 'notify v2'; check "a decision installs the scripts it names" $?
[ "$(stat -c %a "$T/board/uploads-pull.sh" 2>/dev/null || stat -f %Lp "$T/board/uploads-pull.sh")" = 750 ]; check "…keeping the mode of the installed file" $?
[ -f "$T/state/backup/11/uploads-pull.sh" ] && grep -q 'pull v1' "$T/state/backup/11/uploads-pull.sh"; check "…and keeps the old file" $?
grep -q '"ok": true' <<< "$(last_result)" && grep -q '2 installed' <<< "$(last_result)"; check "…and tells bridge it worked" $?
grep -q 'POST /api/v1/boards/agent/report' "$T"/calls/*; check "…and reports the new state at once" $?

# ---- apply: unchanged / not installed here
fresh; decision 12 infra/backup/backup.sh; agent apply
grep -q '"ok": true' <<< "$(last_result)" && grep -q '1 already current' <<< "$(last_result)"; check "a script that is already current is left alone" $?

fresh; decision 13 infra/backup/not-on-this-board.sh; agent apply
grep -q '"ok": true' <<< "$(last_result)" && [ ! -e "$T/board/nothing.sh" ]; check "a script this board does not have is not created" $?

# ---- apply: what it refuses
fresh; FAKE_COMPARE=ahead; decision 14 infra/backup/uploads-pull.sh; agent apply
board_has uploads-pull.sh 'pull v1' && grep -q '"ok": false' <<< "$(last_result)" && grep -q 'not on main' <<< "$(last_result)"; check "refuses a commit that is not on main" $?

fresh; FAKE_COMPARE=diverged; decision 15 infra/backup/uploads-pull.sh; agent apply
board_has uploads-pull.sh 'pull v1'; check "…also a diverged one" $?

fresh; decision 16 infra/boardagent/board-agent.sh; agent apply
board_has agent.sh 'echo agent' && grep -q 'does not update itself' <<< "$(last_result)"; check "refuses to update the agent itself" $?

fresh; decision 17 infra/backup/uploads-pull.sh infra/evil/other.sh; agent apply
board_has uploads-pull.sh 'pull v1' && grep -q 'not in this board' <<< "$(last_result)"; check "refuses a path outside its own manifest — and then changes nothing at all" $?

fresh; decision 18 'infra/../etc/passwd'; agent apply
grep -q 'refused a path' <<< "$(last_result)"; check "refuses a path that climbs out" $?

fresh; DEC_SHA=nothex decision 19 infra/backup/uploads-pull.sh; agent apply
board_has uploads-pull.sh 'pull v1' && grep -q 'not a sha' <<< "$(last_result)"; check "refuses a commit that is not a sha" $?

fresh; decision 20 infra/backup/uploads-pull.sh infra/notify/notify-telegram
printf '#!/usr/bin/env bash\nif then fi\n' > "$T/repo/$SHA/infra/notify/notify-telegram"; agent apply
board_has uploads-pull.sh 'pull v1' && board_has notify-telegram 'notify v1' && grep -q 'bash -n' <<< "$(last_result)"; check "a script that does not pass bash -n stops the whole decision before anything is replaced" $?
printf '#!/usr/bin/env bash\necho notify v2\n' > "$T/repo/$SHA/infra/notify/notify-telegram"

fresh; decision 21 infra/backup/uploads-pull.sh; rm -f "$T/repo/$SHA/infra/backup/uploads-pull.sh"; agent apply
board_has uploads-pull.sh 'pull v1' && grep -q 'could not fetch' <<< "$(last_result)"; check "a file that cannot be fetched at that commit changes nothing" $?
printf '#!/usr/bin/env bash\necho pull v2\n' > "$T/repo/$SHA/infra/backup/uploads-pull.sh"

# ---- apply: a failure half-way puts the first file back
if [ "$(id -u)" != 0 ]; then
  fresh; mkdir -p "$T/board/ro"; printf '#!/usr/bin/env bash\necho notify v1\n' > "$T/board/ro/notify-telegram"; chmod 755 "$T/board/ro/notify-telegram"
  sed -i.bak "s#$T/board/notify-telegram#$T/board/ro/notify-telegram#" "$T/manifest.txt"
  decision 22 infra/backup/uploads-pull.sh infra/notify/notify-telegram
  chmod 555 "$T/board/ro"; agent apply; chmod 755 "$T/board/ro"
  board_has uploads-pull.sh 'pull v1' && board_has ro/notify-telegram 'notify v1' && grep -q '"ok": false' <<< "$(last_result)"; check "a failure half-way puts the files already replaced back" $?
else
  echo "skip a failure half-way (running as root)"
fi

echo
echo "passed $PASS, failed $FAILED"
[ "$FAILED" -eq 0 ]
