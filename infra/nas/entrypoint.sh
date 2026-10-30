#!/usr/bin/env bash
#
# Runs inside the NAS container.
#
#   entrypoint.sh run      the daemon: pull once a day at PULL_AT (retrying after a failure), forever
#   entrypoint.sh once     one pull now, then exit with its status (used to prove the setup)
#   entrypoint.sh keygen   make the pull key (kept in /keys, so it survives the container) and print the ONE line to add to the Pi's
#                          authorized_keys; also pins the Pi's host key
#
# Settings (environment):
#   SOURCE      required; the rsync source on the Pi, e.g. pi@192.168.50.12:latest/ (a path relative to its /srv/backups: the key there is
#               restricted to `rrsync -ro /srv/backups`)
#   PULL_AT     HH:MM local time of the daily pull, default 03:50 (red pulls from white at 03:30, so the source is fresh)
#   TZ          the zone PULL_AT is in, default Europe/Moscow
#   RETRY_MIN   minutes between attempts after a failed pull, default 30; gives up for the day after MAX_TRIES (default 6)
#   KEEP        snapshots kept, default 14 (the NAS has the room; the Pis keep one)
#   BRIDGE_API_KEY  optional; with it the container also tells bridge how the NAS is doing every REPORT_MIN minutes (report.sh, the Dashboard tile)
#   REPORT_MIN  minutes between those reports, default 10
#   FROM_IP     the address the Pi will see this container come from (the NAS), for the `from=` of the printed line
set -uo pipefail

BACKUP_DIR="${BACKUP_DIR:-/srv/backups}"
KEYS_DIR="${KEYS_DIR:-/keys}"
PULL_AT="${PULL_AT:-03:50}"
RETRY_MIN="${RETRY_MIN:-30}"
MAX_TRIES="${MAX_TRIES:-6}"
export TZ="${TZ:-Europe/Moscow}" KEEP="${KEEP:-14}" BACKUP_DIR SSH_KEY="${SSH_KEY:-/root/.ssh/pull_backups}"

log() { echo "[$(date +%FT%T%z)] $*"; }

# The ssh files live in the persistent /keys volume, where the key and the pinned host key outlive the container.
prepare_ssh() {
  mkdir -p "$KEYS_DIR/ssh"
  chmod 700 "$KEYS_DIR/ssh"
  rm -rf /root/.ssh
  ln -s "$KEYS_DIR/ssh" /root/.ssh
}

# Seconds until the next HH:MM in $TZ (today if it has not passed, otherwise tomorrow).
seconds_until() {
  local now target
  now="$(date +%s)"
  target="$(date -d "today $1" +%s)"
  [ "$target" -gt "$now" ] || target="$(date -d "tomorrow $1" +%s)"
  echo $((target - now))
}

source_host() { local h="${SOURCE#*@}"; echo "${h%%:*}"; }

keygen() {
  : "${SOURCE:?SOURCE is required}"
  prepare_ssh
  [ -f "$SSH_KEY" ] || ssh-keygen -q -t ed25519 -N '' -C "pipe-nas-pull" -f "$SSH_KEY"
  # Pin the Pi's host key now, over the LAN, so later runs can refuse a different machine (BatchMode never asks).
  ssh-keyscan -T 10 "$(source_host)" 2>/dev/null > "$KEYS_DIR/ssh/known_hosts.new" || true
  if [ -s "$KEYS_DIR/ssh/known_hosts.new" ]; then mv "$KEYS_DIR/ssh/known_hosts.new" "$KEYS_DIR/ssh/known_hosts"; else rm -f "$KEYS_DIR/ssh/known_hosts.new"; echo "warning: could not read the host key of $(source_host)" >&2; fi
  echo
  echo "Add this ONE line to $(echo "$SOURCE" | cut -d: -f1):~/.ssh/authorized_keys (read-only access to /srv/backups, no shell, only from ${FROM_IP:-this NAS}):"
  echo
  echo "restrict,${FROM_IP:+from=\"$FROM_IP\",}command=\"sudo --preserve-env=SSH_ORIGINAL_COMMAND rrsync -ro /srv/backups\" $(cat "$SSH_KEY.pub")"
  echo
}

pull_once() { /usr/local/bin/pull.sh; }

run() {
  : "${SOURCE:?SOURCE is required}"
  prepare_ssh
  [ -f "$SSH_KEY" ] || { log "no key yet - run: entrypoint.sh keygen"; sleep 60; exit 1; }
  log "daily pull of $SOURCE at $PULL_AT $TZ, keeping $KEEP snapshots"

  if [ -n "${BRIDGE_API_KEY:-}" ]; then
    log "reporting to bridge every ${REPORT_MIN:-10} min"
    ( while true; do /usr/local/bin/report.sh || true; sleep $(( ${REPORT_MIN:-10} * 60 )); done ) &
  fi

  while true; do
    wait=$(seconds_until "$PULL_AT")
    log "next pull in ${wait}s"
    sleep "$wait"

    tries=0
    until pull_once; do
      tries=$((tries + 1))
      [ "$tries" -lt "$MAX_TRIES" ] || { log "giving up for today after $tries failed tries"; break; }
      log "pull failed (try $tries of $MAX_TRIES) - again in ${RETRY_MIN} min"
      sleep $((RETRY_MIN * 60))
    done
    # Never spin: at least a minute past the slot before computing the next one.
    sleep 61
  done
}

case "${1:-run}" in
  run) run ;;
  once) prepare_ssh; pull_once ;;
  keygen) keygen ;;
  seconds_until) seconds_until "${2:?HH:MM}" ;;   # for the tests
  *) echo "usage: $0 run|once|keygen" >&2; exit 2 ;;
esac
