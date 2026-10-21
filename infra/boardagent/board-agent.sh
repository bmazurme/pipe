#!/usr/bin/env bash
#
# The board's side of "update the scripts from the owner's button" — run on every board, as root, by two systemd timers:
#
#   board-agent.sh report   hourly: tell bridge which of this board's scripts are older than `main` (check-scripts.sh --json). Bridge
#                           announces an outdated board once on Telegram, with a button, and shows it on the page «Платы».
#   board-agent.sh apply    every minute: ask bridge whether the owner pressed that button for THIS board and, if so, install what it
#                           names. One request; nothing is done without a waiting decision.
#
# What a decision can and cannot do (the agent decides this, not bridge — a bridge that is wrong or hijacked must not be able to put
# code on a board):
#   - only scripts listed in the agent's own manifest (manifest.txt, copied by hand with the agent), to the place THAT list gives;
#   - only scripts that are already installed here (it does not put new files on a board);
#   - only from a commit that is on `main` (GitHub's compare says "behind" or "identical"), fetched from GitHub at that commit;
#   - never the agent itself (infra/boardagent/): an error in it would leave the board with no way to be fixed from here;
#   - every shell script passes `bash -n` before it replaces anything; the old file is kept, and everything is put back if any file
#     of the decision fails to install or to verify.
# The result goes back to bridge (a message on Telegram and the page).
#
# Settings (/etc/pipe-boardagent.env, mode 600): BRIDGE_API_URL (https://api.bridge.ntlstl.dev), BRIDGE_API_KEY (the OWNER's personal
# API key, brk_…), OWNER, REPO, BRANCH, STATE_DIR, BRIDGE_PI_DIR, MANIFEST_FILE, CHECK_SCRIPT, BOARD_HOST. Tests: GITHUB_API.
set -uo pipefail

OWNER="${OWNER:-bmazurme}"
REPO="${REPO:-pipe}"
BRANCH="${BRANCH:-main}"
GITHUB_API="${GITHUB_API:-https://api.github.com}"
RAW_HOST="${RAW_HOST:-https://raw.githubusercontent.com}"
STATE_DIR="${STATE_DIR:-/var/lib/pipe-boardagent}"
BRIDGE_PI_DIR="${BRIDGE_PI_DIR:-/home/pi/bridge-pi}"
MANIFEST_FILE="${MANIFEST_FILE:-/usr/local/lib/pipe-boardagent/manifest.txt}"
CHECK_SCRIPT="${CHECK_SCRIPT:-/usr/local/lib/pipe-scriptcheck/check-scripts.sh}"
HOST="${BOARD_HOST:-$(hostname)}"
AGENT_VERSION=1

log() { echo "[$(date -u +%FT%TZ)] $*"; }
need() { [ -n "${!1:-}" ] || { log "$1 is not set (/etc/pipe-boardagent.env) — nothing done"; exit 0; }; }

bridge() { # method path [json-body] → body on stdout; fails on a non-2xx
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -fsS --max-time 30 -X "$method" -H "Authorization: Bearer $BRIDGE_API_KEY" -H 'Content-Type: application/json' --data "$body" "$BRIDGE_API_URL$path"
  else
    curl -fsS --max-time 30 -X "$method" -H "Authorization: Bearer $BRIDGE_API_KEY" "$BRIDGE_API_URL$path"
  fi
}

do_report() {
  local report
  report="$(BOARD_HOST="$HOST" "$CHECK_SCRIPT" --json)" || { log "check-scripts.sh --json failed — nothing reported"; return 1; }
  report="$(printf '%s' "$report" | HOST_NAME="$HOST" AGENT_VERSION="$AGENT_VERSION" python3 -c '
import json, os, sys
data = json.load(sys.stdin)
data["host"] = os.environ["HOST_NAME"]
data["agentVersion"] = os.environ["AGENT_VERSION"]
print(json.dumps(data))
')" || return 1
  if bridge POST /api/v1/boards/agent/report "$report" >/dev/null; then log "reported to bridge"; else log "bridge did not take the report"; return 1; fi
}

# A path in the manifest → where it lives on this board, or nothing.
installed_path_of() {
  local repo_path="$1" installed rp
  while IFS='|' read -r installed rp; do
    [ "$rp" = "$repo_path" ] || continue
    printf '%s' "${installed//@BRIDGE_PI@/$BRIDGE_PI_DIR}"
    return 0
  done < "$MANIFEST_FILE"
  return 1
}

finish() { # ok(true|false) message
  local body
  body="$(OK="$1" MSG="$2" python3 -c 'import json, os; print(json.dumps({"ok": os.environ["OK"] == "true", "message": os.environ["MSG"][:3900]}))')"
  bridge POST "/api/v1/boards/agent/updates/$UPDATE_ID/result" "$body" >/dev/null || log "bridge did not take the result"
}

restore() { # put every backed-up file back
  local pair
  for pair in "${DONE[@]:-}"; do
    [ -n "$pair" ] || continue
    cp -p "$BACKUP/$(basename "${pair%%|*}")" "${pair%%|*}" 2>/dev/null || true
  done
}

do_apply() {
  local pending
  pending="$(bridge GET "/api/v1/boards/agent/pending?host=$HOST")" || { log "bridge unreachable — nothing done"; return 0; }
  # id, sha, then one repo path per line; nothing at all when there is no decision
  local parsed
  parsed="$(printf '%s' "$pending" | python3 -c '
import json, sys
update = json.load(sys.stdin).get("update")
if update:
    print(update["id"]); print(update["sha"])
    for path in update["repoPaths"]: print(path)
' 2>/dev/null)" || { log "unreadable answer of bridge — nothing done"; return 0; }
  [ -n "$parsed" ] || return 0

  UPDATE_ID="$(printf '%s\n' "$parsed" | sed -n 1p)"
  local sha paths
  sha="$(printf '%s\n' "$parsed" | sed -n 2p)"
  paths="$(printf '%s\n' "$parsed" | sed -n '3,$p')"
  log "decision $UPDATE_ID: $(printf '%s\n' "$paths" | grep -c .) script(s) at ${sha:0:7}"

  printf '%s' "$UPDATE_ID" | grep -qE '^[0-9]+$' || { log "bad decision id — nothing done"; return 0; }
  if ! printf '%s' "$sha" | grep -qE '^[0-9a-f]{40}$'; then finish false "commit is not a sha"; return 0; fi

  # The commit must be on main: GitHub says the branch is ahead of it ("behind") or at it ("identical").
  local state
  state="$(curl -fsS --max-time 30 "$GITHUB_API/repos/$OWNER/$REPO/compare/$BRANCH...$sha" 2>/dev/null | python3 -c 'import json, sys; print(json.load(sys.stdin).get("status", ""))' 2>/dev/null || true)"
  case "$state" in
    behind|identical) ;;
    "") finish false "could not check on GitHub that ${sha:0:7} is on $BRANCH — try again"; return 0 ;;
    *) finish false "commit ${sha:0:7} is not on $BRANCH ($state) — refused"; return 0 ;;
  esac

  # Every path is checked before anything is touched.
  local rp dest
  local plan=()
  while IFS= read -r rp; do
    [ -n "$rp" ] || continue
    if ! printf '%s' "$rp" | grep -qE '^infra/[A-Za-z0-9_./-]+$' || printf '%s' "$rp" | grep -q '\.\.'; then finish false "refused a path: $rp"; return 0; fi
    case "$rp" in infra/boardagent/*) finish false "refused: the agent does not update itself ($rp)"; return 0 ;; esac
    dest="$(installed_path_of "$rp")" || { finish false "refused: $rp is not in this board's manifest"; return 0; }
    [ -f "$dest" ] || { log "$rp is not installed here — skipped"; continue; }
    plan+=("$rp|$dest")
  done <<< "$paths"
  [ "${#plan[@]}" -gt 0 ] || { finish true "nothing of it is installed on this board"; return 0; }

  # Fetch and check everything first.
  local work item new_files=() rc
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' RETURN
  for item in "${plan[@]}"; do
    rp="${item%%|*}"
    if ! curl -fsSL --max-time 60 "$RAW_HOST/$OWNER/$REPO/$sha/$rp" -o "$work/$(basename "$rp")" 2>/dev/null || [ ! -s "$work/$(basename "$rp")" ]; then
      finish false "could not fetch $rp at ${sha:0:7}"; return 0
    fi
    if head -1 "$work/$(basename "$rp")" | grep -qE '^#!.*(ba|z)?sh'; then
      bash -n "$work/$(basename "$rp")" 2> "$work/syntax" || { finish false "$rp does not pass bash -n: $(head -c 300 "$work/syntax")"; return 0; }
    fi
  done

  # Install, keeping the old files; any failure puts them all back.
  BACKUP="$STATE_DIR/backup/$UPDATE_ID"
  mkdir -p "$BACKUP" || { finish false "cannot write $STATE_DIR"; return 0; }
  DONE=()
  local changed=() unchanged=0 mode tmp base
  for item in "${plan[@]}"; do
    rp="${item%%|*}"; dest="${item#*|}"; base="$(basename "$rp")"
    if cmp -s "$work/$base" "$dest"; then unchanged=$((unchanged + 1)); continue; fi
    cp -p "$dest" "$BACKUP/$(basename "$dest")" || { restore; finish false "could not back up $dest"; return 0; }
    DONE+=("$dest|$rp")
    mode="$(stat -c %a "$dest" 2>/dev/null || stat -f %Lp "$dest" 2>/dev/null || echo 755)"
    tmp="$dest.new.$$"
    if ! cp "$work/$base" "$tmp" || ! chmod "$mode" "$tmp" || ! mv -f "$tmp" "$dest"; then rm -f "$tmp"; restore; finish false "could not install $dest — the old files are back"; return 0; fi
    if ! cmp -s "$work/$base" "$dest"; then restore; finish false "$dest differs from the fetched file after installing — the old files are back"; return 0; fi
    changed+=("$base")
  done

  finish true "${#changed[@]} installed (${changed[*]:-none}), $unchanged already current; commit ${sha:0:7}"
  log "applied decision $UPDATE_ID: ${#changed[@]} installed, $unchanged current"
  # Tell bridge the new state at once, so the board shows as current without waiting for the hourly report.
  do_report || true
  return 0
}

case "${1:-}" in
  report|apply) ;;
  *) echo "usage: board-agent.sh report|apply" >&2; exit 2 ;;
esac

need BRIDGE_API_URL
need BRIDGE_API_KEY
mkdir -p "$STATE_DIR" 2>/dev/null || { log "cannot write $STATE_DIR — nothing done"; exit 0; }
exec 9>"$STATE_DIR/lock"
flock -n 9 || { log "another run is in progress"; exit 0; }

if [ "$1" = report ]; then do_report || true; else do_apply; fi
exit 0
