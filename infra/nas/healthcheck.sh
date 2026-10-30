#!/usr/bin/env bash
# Healthy while the last successful pull (or the source's own creation time, which pull.sh stores in last-success) is under MAX_AGE_HOURS old.
BACKUP_DIR="${BACKUP_DIR:-/srv/backups}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"
f="$BACKUP_DIR/last-success"

[ -s "$f" ] || { echo "no successful pull yet"; exit 1; }
age=$(( $(date +%s) - $(cat "$f") ))
[ "$age" -le $(( MAX_AGE_HOURS * 3600 )) ] || { echo "last backup is $(( age / 3600 )) h old (limit ${MAX_AGE_HOURS} h)"; exit 1; }
