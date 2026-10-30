#!/usr/bin/env bash
#
# The board's side of "update the scripts from the owner's button" — run on every board, as root, by two systemd timers:
#
#   board-agent.sh report   hourly: tell bridge which of this board's scripts are older than `main` (check-scripts.sh --json). Bridge
#                           announces an outdated board once on Telegram, with a button, and shows it on the page «Платы».
#   board-agent.sh selftest checks this agent (syntax, manifest, bridge reachable and answering, check-scripts --json) — what a new version has
#                           to pass before it replaces the running one
#   board-agent.sh apply    every minute: ask bridge whether the owner pressed that button for THIS board and, if so, install what it
#                           names. One request; nothing is done without a waiting decision.
#
# What a decision can and cannot do (the agent decides this, not bridge — a bridge that is wrong or hijacked must not be able to put
# code on a board):
#   - only scripts listed in the agent's own manifest (manifest.txt, copied by hand with the agent), to the place THAT list gives;
#   - only scripts that are already installed here (it does not put new files on a board);
#   - only from a commit that is on `main` (GitHub's compare says "behind" or "identical"), fetched from GitHub at that commit;
#   - the agent itself (board-agent.sh, manifest.txt — nothing else of infra/boardagent/) only through the self-update below: a broken
#     agent would leave the board with no way to be fixed from here, so the new version must first pass its own `selftest` (run from a
#     staging copy), the old one is kept in STATE_DIR/agent-prev, and if the new one then crashes on its first run the rollback unit
#     (rollback.sh, installed by hand with the agent) puts the old one back;
#   - every shell script passes `bash -n` before it replaces anything; the old file is kept, and everything is put back if any file
#     of the decision fails to install or to verify.
# The result goes back to bridge (a message on Telegram and the page).
#
# Settings (/etc/pipe-boardagent.env, mode 600): BRIDGE_API_URL (https://api.bridge.ntlstl.dev), BRIDGE_API_KEY (a boards-only API key of
# the OWNER, brk_…), OWNER, REPO, BRANCH, STATE_DIR, BRIDGE_PI_DIR, MANIFEST_FILE, CHECK_SCRIPT, BOARD_HOST. Tests: GITHUB_API.
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
  # The key goes to curl as a config on stdin (printf is a builtin), never in argv, where any local user could read it via ps.
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    printf 'header = "Authorization: Bearer %s"\n' "$BRIDGE_API_KEY" | curl -K - -fsS --max-time 30 -X "$method" -H 'Content-Type: application/json' --data "$body" "$BRIDGE_API_URL$path"
  else
    printf 'header = "Authorization: Bearer %s"\n' "$BRIDGE_API_KEY" | curl -K - -fsS --max-time 30 -X "$method" "$BRIDGE_API_URL$path"
  fi
}

# What the board can say about itself besides its scripts: the root disk (the first thing that quietly kills a Pi), and the SSH door —
# whether passwords still work and how many keys are authorized — so a board nobody can log in to, or one that anyone with a password
# can, shows on the page before it matters. Every field is optional: a probe that fails is left out, never guessed.
collect_health() {
  local used free inodes passwd keys active=true f
  read -r used free < <(df -Pm / 2>/dev/null | awk 'NR == 2 { gsub(/%/, "", $5); print $5, $4 }')
  inodes="$(df -Pi / 2>/dev/null | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
  passwd="$(sshd -T 2>/dev/null | awk '$1 == "passwordauthentication" { print $2; exit }')"
  keys=0
  for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
    [ -r "$f" ] && keys=$((keys + $(grep -cEv '^[[:space:]]*(#|$)' "$f" 2>/dev/null || true)))
  done
  systemctl is-active --quiet ssh 2>/dev/null || systemctl is-active --quiet sshd 2>/dev/null || active=false
  DISK_USED="${used:-}" DISK_FREE_MB="${free:-}" INODES_USED="${inodes:-}" SSH_PASSWORD="${passwd:-}" SSH_KEYS="$keys" SSHD_ACTIVE="$active" python3 -c '
import json, os
def num(name):
    v = os.environ.get(name, "")
    return int(v) if v.isdigit() else None
health = {
    "diskUsedPct": num("DISK_USED"),
    "diskFreeMb": num("DISK_FREE_MB"),
    "inodesUsedPct": num("INODES_USED"),
    "sshPasswordAuth": {"yes": True, "no": False}.get(os.environ.get("SSH_PASSWORD", "")),
    "sshAuthorizedKeys": num("SSH_KEYS"),
    "sshdActive": os.environ.get("SSHD_ACTIVE") == "true",
}
print(json.dumps({k: v for k, v in health.items() if v is not None}))
'
}

do_report() {
  local report health
  report="$(BOARD_HOST="$HOST" "$CHECK_SCRIPT" --json)" || { log "check-scripts.sh --json failed — nothing reported"; return 1; }
  health="$(collect_health 2>/dev/null)" || health=""
  [ -n "$health" ] || health='{}'
  report="$(printf '%s' "$report" | HOST_NAME="$HOST" AGENT_VERSION="$AGENT_VERSION" HEALTH="$health" python3 -c '
import json, os, sys
data = json.load(sys.stdin)
data["host"] = os.environ["HOST_NAME"]
data["agentVersion"] = os.environ["AGENT_VERSION"]
try:
    data["health"] = json.loads(os.environ.get("HEALTH") or "{}")
except ValueError:
    pass
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

# What a new version of the agent has to pass before it replaces the running one. Keep it working in every future version: the version
# that is running calls it on the NEXT one.
do_selftest() {
  bash -n "$0" || { echo "selftest: syntax error in $0" >&2; return 1; }
  [ -s "$MANIFEST_FILE" ] || { echo "selftest: no manifest $MANIFEST_FILE" >&2; return 1; }
  awk -F'|' 'NF == 2 && $2 ~ /^infra\// { good++; next } NF { bad = 1 } END { exit (bad || good < 5) }' "$MANIFEST_FILE" \
    || { echo "selftest: the manifest is malformed (every line is 'installed path|infra/…', at least five lines)" >&2; return 1; }
  bridge GET "/api/v1/boards/agent/pending?host=$HOST" | python3 -c 'import json, sys; json.load(sys.stdin)["update"]' 2>/dev/null \
    || { echo "selftest: bridge does not answer the way the agent expects" >&2; return 1; }
  "$CHECK_SCRIPT" --json | python3 -c 'import json, sys; assert json.load(sys.stdin)["scripts"]' 2>/dev/null \
    || { echo "selftest: check-scripts.sh --json gives no usable report" >&2; return 1; }
  echo "selftest ok"
}

# The first run of a freshly installed agent that gets an answer from bridge proves it works: the marker the update left is dropped.
verify_self_update() {
  [ -f "$STATE_DIR/agent-update.pending" ] || return 0
  rm -f "$STATE_DIR/agent-update.pending"
  log "agent update verified"
}

# Replaces the agent (and its manifest) with the versions of this decision, safely. Only after `selftest` of the NEW pair passed.
update_self() { # work-dir, then the repo paths of the agent files that changed
  local work="$1"; shift
  local stage="$work/self" f dest base
  mkdir -p "$stage" "$STATE_DIR/agent-prev" || { finish false "cannot prepare the agent update"; return 1; }
  local agent_dest manifest_dest
  agent_dest="$(installed_path_of infra/boardagent/board-agent.sh)" || { finish false "the agent is not in the manifest"; return 1; }
  manifest_dest="$(installed_path_of infra/boardagent/manifest.txt)" || { finish false "the agent manifest is not in the manifest"; return 1; }
  # The staging pair: the new file where the decision has one, the installed one otherwise.
  cp "$agent_dest" "$stage/board-agent.sh" && cp "$manifest_dest" "$stage/manifest.txt" || { finish false "cannot copy the installed agent for the check"; return 1; }
  for f in "$@"; do cp "$work/$(basename "$f")" "$stage/$(basename "$f")"; done
  chmod 755 "$stage/board-agent.sh"

  local out
  out="$(MANIFEST_FILE="$stage/manifest.txt" bash "$stage/board-agent.sh" selftest 2>&1)" \
    || { finish false "the new agent did not pass its own check — nothing replaced: $(printf '%s' "$out" | tail -c 400)"; return 1; }

  rm -rf "$STATE_DIR/agent-prev"; mkdir -p "$STATE_DIR/agent-prev"
  cp -p "$agent_dest" "$STATE_DIR/agent-prev/board-agent.sh" && cp -p "$manifest_dest" "$STATE_DIR/agent-prev/manifest.txt" \
    || { finish false "could not keep the old agent — nothing replaced"; return 1; }
  echo "$UPDATE_ID $(date +%s)" > "$STATE_DIR/agent-update.pending"

  for f in "$@"; do
    base="$(basename "$f")"
    case "$base" in board-agent.sh) dest="$agent_dest" ;; *) dest="$manifest_dest" ;; esac
    if ! cp "$stage/$base" "$dest.new.$$" || ! chmod "$(stat -c %a "$dest" 2>/dev/null || stat -f %Lp "$dest" 2>/dev/null || echo 755)" "$dest.new.$$" || ! mv -f "$dest.new.$$" "$dest"; then
      rm -f "$dest.new.$$"
      cp -p "$STATE_DIR/agent-prev/board-agent.sh" "$agent_dest"; cp -p "$STATE_DIR/agent-prev/manifest.txt" "$manifest_dest"
      rm -f "$STATE_DIR/agent-update.pending"
      finish false "could not install the new agent — the old one is back"
      return 1
    fi
  done
  return 0
}

do_apply() {
  local pending
  pending="$(bridge GET "/api/v1/boards/agent/pending?host=$HOST")" || { log "bridge unreachable — nothing done"; return 0; }
  verify_self_update
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
    case "$rp" in
      infra/boardagent/board-agent.sh|infra/boardagent/manifest.txt) ;;
      infra/boardagent/*) finish false "refused: only the agent and its manifest can be updated from here ($rp)"; return 0 ;;
    esac
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
  local changed=() unchanged=0 mode tmp base self_changed=()
  for item in "${plan[@]}"; do
    rp="${item%%|*}"; dest="${item#*|}"; base="$(basename "$rp")"
    if cmp -s "$work/$base" "$dest"; then unchanged=$((unchanged + 1)); continue; fi
    # The agent's own files go last, through update_self (self-check, kept copy, rollback).
    case "$rp" in infra/boardagent/*) self_changed+=("$rp"); continue ;; esac
    cp -p "$dest" "$BACKUP/$(basename "$dest")" || { restore; finish false "could not back up $dest"; return 0; }
    DONE+=("$dest|$rp")
    mode="$(stat -c %a "$dest" 2>/dev/null || stat -f %Lp "$dest" 2>/dev/null || echo 755)"
    tmp="$dest.new.$$"
    if ! cp "$work/$base" "$tmp" || ! chmod "$mode" "$tmp" || ! mv -f "$tmp" "$dest"; then rm -f "$tmp"; restore; finish false "could not install $dest — the old files are back"; return 0; fi
    if ! cmp -s "$work/$base" "$dest"; then restore; finish false "$dest differs from the fetched file after installing — the old files are back"; return 0; fi
    changed+=("$base")
  done

  local note=""
  if [ "${#self_changed[@]}" -gt 0 ]; then
    if ! update_self "$work" "${self_changed[@]}"; then
      # update_self reported its own failure; the other files of the decision stay installed (they were fine).
      return 0
    fi
    note="; the agent itself updated (${self_changed[*]##*/}), kept as agent-prev until its first run succeeds"
  fi

  finish true "${#changed[@]} installed (${changed[*]:-none}), $unchanged already current; commit ${sha:0:7}$note"
  log "applied decision $UPDATE_ID: ${#changed[@]} installed, $unchanged current$note"
  # Tell bridge the new state at once, so the board shows as current without waiting for the hourly report.
  do_report || true
  return 0
}

case "${1:-}" in
  report|apply|selftest) ;;
  *) echo "usage: board-agent.sh report|apply|selftest" >&2; exit 2 ;;
esac

need BRIDGE_API_URL
need BRIDGE_API_KEY
if [ "$1" = selftest ]; then do_selftest; exit $?; fi
mkdir -p "$STATE_DIR" 2>/dev/null || { log "cannot write $STATE_DIR — nothing done"; exit 0; }
# One lock per kind of run: the minute check must never make the hourly report skip itself (and a report never delays a decision).
exec 9>"$STATE_DIR/lock-$1"
flock -n 9 || { log "another $1 run is in progress"; exit 0; }

if [ "$1" = report ]; then do_report || true; else do_apply; fi
exit 0
