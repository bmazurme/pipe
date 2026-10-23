#!/usr/bin/env bash
#
# Puts the previous agent back when a freshly self-updated one crashed on its first run. Run by systemd (pipe-boardagent-rollback.service,
# the OnFailure of the apply service) — and by hand if an update went wrong: `sudo /usr/local/lib/pipe-boardagent/rollback.sh`.
#
# It is deliberately tiny and does not change with the agent: it is installed by hand (install.sh) together with the agent and is NOT in the
# list of scripts an update can replace, so a broken agent cannot break the thing that restores it.
#
# What it needs: STATE_DIR/agent-update.pending (the marker the update leaves until the new agent has run once successfully) and
# STATE_DIR/agent-prev/{board-agent.sh,manifest.txt} (what was installed before). Without the marker it does nothing.
set -uo pipefail

STATE_DIR="${STATE_DIR:-/var/lib/pipe-boardagent}"
LIB="${LIB:-/usr/local/lib/pipe-boardagent}"

[ -f "$STATE_DIR/agent-update.pending" ] || exit 0

if [ ! -s "$STATE_DIR/agent-prev/board-agent.sh" ] || [ ! -s "$STATE_DIR/agent-prev/manifest.txt" ]; then
  echo "agent update is pending but the old agent was not kept — nothing to put back" >&2
  exit 1
fi

for file in board-agent.sh manifest.txt; do
  cp -p "$STATE_DIR/agent-prev/$file" "$LIB/$file.rollback" && mv -f "$LIB/$file.rollback" "$LIB/$file" || { echo "could not restore $file" >&2; exit 1; }
done
rm -f "$STATE_DIR/agent-update.pending"

message="🔙 Агент плат $(hostname): новая версия не заработала, вернул предыдущую (infra/boardagent/rollback.sh)"
echo "$message"
if [ -n "${ALERT_CMD:-}" ]; then $ALERT_CMD "$message" || true; fi
exit 0
