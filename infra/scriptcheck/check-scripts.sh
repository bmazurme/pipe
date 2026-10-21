#!/usr/bin/env bash
#
# Says when the scripts installed on THIS board are older than the ones in the repository. The boards get their scripts by hand
# (scp + install.sh), so a fix that is merged but never copied over just sits in the repository — the uploads copy on red ran an
# old uploads-pull.sh for days and refused a perfectly normal run. This compares every known installed script with its file on
# `main` (raw.githubusercontent.com, the same place the auto-deploy reads the stack files from) and tells you ONCE what is out of date.
#
#   check-scripts.sh             the check (a timer runs it hourly): messages ALERT_CMD when the set of outdated scripts changes,
#                                again every REPEAT_HOURS while it stays that way, and once when everything is current again
#   check-scripts.sh --status    a table: every script this board has, current or outdated (no message)
#   check-scripts.sh --json      the same as JSON for the board agent (infra/boardagent): the commit of `main` it compared with, and per
#                                script its repository path, status and full hashes. Compared against THAT commit, not a moving `main`.
#
# Only scripts that exist on the board are looked at (white has the auto-deploy, red the uploads copy…). Never fails the caller: an
# unreachable GitHub is logged and nothing else happens.
#
# Settings (/etc/pipe-scriptcheck.env): ALERT_CMD (e.g. /usr/local/bin/notify-telegram), OWNER, REPO, BRANCH, REPEAT_HOURS (24),
# STATE_DIR (/var/lib/pipe-scriptcheck), BRIDGE_PI_DIR (/home/pi/bridge-pi — where white keeps the deploy scripts). Tests: MAIN_SHA (skips the lookup of main's commit), SCRIPTCHECK_MANIFEST (a file of `installed|repo path` lines), RAW_BASE, SCRIPTCHECK_NOW.
set -uo pipefail

OWNER="${OWNER:-bmazurme}"
REPO="${REPO:-pipe}"
BRANCH="${BRANCH:-main}"
RAW_BASE="${RAW_BASE:-https://raw.githubusercontent.com/$OWNER/$REPO/$BRANCH}"
STATE_DIR="${STATE_DIR:-/var/lib/pipe-scriptcheck}"
BRIDGE_PI_DIR="${BRIDGE_PI_DIR:-/home/pi/bridge-pi}"
REPEAT_HOURS="${REPEAT_HOURS:-24}"
HOST="${SCRIPTCHECK_HOST:-$(hostname)}"
now="${SCRIPTCHECK_NOW:-$(date +%s)}"

log() { echo "[$(date -u +%FT%TZ)] $*"; }
alert() { log "$1"; if [ -n "${ALERT_CMD:-}" ]; then $ALERT_CMD "$1" || true; fi; }

# installed path | the same file in the repository — what each installer puts where (infra/*/install*.sh)
manifest() {
  if [ -n "${SCRIPTCHECK_MANIFEST:-}" ]; then cat "$SCRIPTCHECK_MANIFEST"; return; fi
  cat <<'LIST'
/usr/local/lib/pipe-autodeploy/autodeploy.sh|infra/autodeploy/autodeploy.sh
/usr/local/lib/pipe-backup/backup.sh|infra/backup/backup.sh
/usr/local/lib/pipe-backup/restore-check.sh|infra/backup/restore-check.sh
/usr/local/lib/pipe-backup/pull.sh|infra/backup/pull.sh
/usr/local/lib/pipe-backup/mirror-s3.sh|infra/backup/mirror-s3.sh
/usr/local/lib/pipe-backup/uploads-pull.sh|infra/backup/uploads-pull.sh
/usr/local/lib/pipe-backup/standby-check.sh|infra/standby/check.sh
/usr/local/bin/notify-telegram|infra/notify/notify-telegram
/usr/local/bin/vip-check-caddy|infra/vip/vip-check-caddy
/usr/local/bin/vip-notify|infra/vip/vip-notify
/usr/local/lib/pipe-monitor/monitor-lib.sh|infra/monitor/monitor-lib.sh
/usr/local/lib/pipe-monitor/resource-check.sh|infra/monitor/resource-check.sh
/usr/local/lib/pipe-monitor/primary-watch.sh|infra/monitor/primary-watch.sh
/usr/local/sbin/pipe-swarm-heal|infra/pi/swarm-heal.sh
/usr/local/lib/pipe-scriptcheck/check-scripts.sh|infra/scriptcheck/check-scripts.sh
/usr/local/lib/pipe-boardagent/board-agent.sh|infra/boardagent/board-agent.sh
/usr/local/lib/pipe-boardagent/manifest.txt|infra/boardagent/manifest.txt
@BRIDGE_PI@/deploy.sh|infra/bridge-pi/deploy.sh
@BRIDGE_PI@/deploy-worker.sh|infra/bridge-pi/deploy-worker.sh
@BRIDGE_PI@/enroll-worker.sh|infra/bridge-pi/enroll-worker.sh
@BRIDGE_PI@/secrets.sh|infra/bridge-pi/secrets.sh
@BRIDGE_PI@/vless-to-xray.sh|infra/bridge-pi/vless-to-xray.sh
@BRIDGE_PI@/build-images.sh|infra/bridge-pi/build-images.sh
@BRIDGE_PI@/build-worker-image.sh|infra/bridge-pi/build-worker-image.sh
LIST
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# For the agent's report: pin everything to one commit of the branch, so the report says exactly which commit it was compared with
# (and an update installs exactly that one).
main_sha=""
if [ "${1:-}" = "--json" ]; then
  main_sha="${MAIN_SHA:-$(curl -fsS --max-time 20 -H 'Accept: application/vnd.github.sha' "https://api.github.com/repos/$OWNER/$REPO/commits/$BRANCH" 2>/dev/null || true)}"
  if ! printf '%s' "$main_sha" | grep -qE '^[0-9a-f]{40}$'; then log "cannot tell the commit of $BRANCH — nothing done" >&2; exit 1; fi
  [ -n "${MAIN_SHA:-}" ] || RAW_BASE="https://raw.githubusercontent.com/$OWNER/$REPO/$main_sha"
fi

rows=(); stale=(); jrows=(); checked=0; unreachable=0
while IFS='|' read -r installed repo_path; do
  installed_raw="$installed"
  installed="${installed//@BRIDGE_PI@/$BRIDGE_PI_DIR}"
  [ -n "$installed" ] && [ -f "$installed" ] || continue   # this board does not have that script
  if ! curl -fsSL --max-time 30 "$RAW_BASE/$repo_path" -o "$work/current" 2>/dev/null || [ ! -s "$work/current" ]; then
    unreachable=$((unreachable + 1)); continue
  fi
  checked=$((checked + 1))
  full_mine="$(sha256sum "$installed" | cut -d' ' -f1)"; full_theirs="$(sha256sum "$work/current" | cut -d' ' -f1)"
  mine="${full_mine:0:8}"; theirs="${full_theirs:0:8}"
  if [ "$full_mine" = "$full_theirs" ]; then jrows+=("$installed_raw|$repo_path|current|$full_mine|$full_theirs"); else jrows+=("$installed_raw|$repo_path|outdated|$full_mine|$full_theirs"); fi
  if [ "$mine" = "$theirs" ]; then
    rows+=("ok     $(basename "$installed")  $mine")
  else
    rows+=("STALE  $(basename "$installed")  installed $mine, repository $theirs  ($repo_path)")
    stale+=("$repo_path:$theirs|$(basename "$installed") (установлен $mine, в репозитории $theirs)")
  fi
done < <(manifest)

if [ "${1:-}" = "--json" ]; then
  [ "$checked" -gt 0 ] || { log "nothing compared (${unreachable} unreachable, or no known script here)" >&2; exit 1; }
  printf '%s\n' "${jrows[@]}" | python3 -c '
import json, sys
scripts = []
for line in sys.stdin.read().splitlines():
    installed, repo_path, status, mine, theirs = line.split("|")
    scripts.append({"installed": installed, "repoPath": repo_path, "status": status, "installedHash": mine, "mainHash": theirs})
print(json.dumps({"mainSha": sys.argv[1], "scripts": scripts}))
' "$main_sha"
  exit 0
fi

if [ "${1:-}" = "--status" ]; then
  printf '%s\n' "${rows[@]}"
  [ "$unreachable" -eq 0 ] || echo "(не удалось получить из репозитория: $unreachable)"
  exit 0
fi

if [ "$checked" -eq 0 ]; then
  log "nothing compared (${unreachable} unreachable, or no known script here) — nothing done"
  exit 0
fi

mkdir -p "$STATE_DIR" 2>/dev/null || { log "cannot write $STATE_DIR — nothing done"; exit 0; }
last="$STATE_DIR/last-alert"

if [ "${#stale[@]}" -eq 0 ]; then
  log "all $checked scripts here are current"
  if [ -f "$last" ]; then
    rm -f "$last"
    alert "✅ Скрипты на $HOST снова актуальны (проверено: $checked)"
  fi
  exit 0
fi

# What is out of date, as one fingerprint: a new out-of-date script (or a newer version of the same one) is news again.
signature="$(printf '%s\n' "${stale[@]}" | cut -d'|' -f1 | sort | sha256sum | cut -c1-16)"
read -r last_at last_sig 2>/dev/null < "$last" || { last_at=0; last_sig=""; }

if [ "$signature" = "$last_sig" ] && [ $(( now - last_at )) -lt $(( REPEAT_HOURS * 3600 )) ]; then
  log "${#stale[@]} outdated script(s), already announced"
  exit 0
fi

lines="$(printf '%s\n' "${stale[@]}" | cut -d'|' -f2- | sed 's/^/• /')"
dirs="$(printf '%s\n' "${stale[@]}" | sed -E 's#^(infra/[^/]+)/.*#\1#' | sort -u | paste -sd' ' -)"
how="Обновить: скопировать infra/ на плату и запустить установщик нужного каталога ($dirs) — см. README каталога, например
scp -r infra/backup pi@$HOST:/tmp/ && ssh -t pi@$HOST 'sudo bash /tmp/backup/install-uploads.sh'"
# The deploy scripts of white are plain files next to the stack files, not installed by anything: they are copied.
if printf '%s\n' "${stale[@]}" | grep -q '^infra/bridge-pi/'; then
  how="$how
Скрипты деплоя (infra/bridge-pi) просто копируются: scp infra/bridge-pi/*.sh pi@$HOST:~/bridge-pi/ — иначе автодеплой может упасть на новых stack-файлах."
fi
alert "⚠️ Скрипты на $HOST устарели относительно $BRANCH (${#stale[@]}):
$lines

$how"
echo "$now $signature" > "$last"
exit 0
