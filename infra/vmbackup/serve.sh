#!/usr/bin/env bash
#
# The ONLY thing the NAS's key may run on the cloud VM (CLOUD-FIRST-PLAN: «бэкапы notes и places храним только на NAS»). It is the forced command of
# that key (authorized_keys: restrict,from="<home address>",command="sudo --preserve-env=SSH_ORIGINAL_COMMAND /usr/local/lib/pipe-vmbackup/serve.sh"),
# so the NAS asks for one of a short list of things and gets an `age`-ENCRYPTED stream on stdout — nothing is stored on this VM, nothing else
# can be run with that key, and the NAS never sees a plaintext database or key.
#
#   db <name>   pg_dump -Fc of one database (only those listed in DBS)     verified (readable table of contents, has table data)
#   files       the object storage (minio) data of notes/places, as a tar  verified (readable)
#   config      nginx, letsencrypt, ufw, firewall script, Swarm service specs, cron, … as a tar   verified (readable)
#   images      docker save of the images the Swarm services and listed containers use, gzipped   (streamed: nothing staged; ~GBs, weekly)
#   ping        prints "ok": proves the key, the forced command and sudo
#
# Dumps are staged only in /dev/shm (RAM, mode 700, removed on exit), checked there, and only then encrypted to stdout; a failed check prints nothing
# on stdout and exits non-zero, so the NAS never mistakes half a dump for a backup. Messages go to stderr.
#
# Settings: /etc/pipe-vmbackup.conf (AGE_RECIPIENT is the PUBLIC age key — the private one never leaves the owner; see install.sh).
set -uo pipefail

CONF="${VMBACKUP_CONF:-/etc/pipe-vmbackup.conf}"
# shellcheck disable=SC1090
[ -r "$CONF" ] && . "$CONF"
: "${AGE_RECIPIENT:?AGE_RECIPIENT is not set in $CONF}"
DBS="${DBS:-notes-db places}"
PG_CONTAINER="${PG_CONTAINER:-postgres}"
PG_USER="${PG_USER:-postgres}"
MINIO_DIR="${MINIO_DIR:-/var/lib/docker/volumes/coi_minio-data/_data}"
# Paths of the config backup; missing ones are skipped. Deliberately NOT /etc/pipe-*.env (they hold API keys).
CONFIG_PATHS="${CONFIG_PATHS:-/etc/nginx /etc/letsencrypt /etc/ufw /etc/fstab /etc/docker/daemon.json /etc/sysctl.d /etc/ssh/sshd_config /etc/systemd/system/pipe-*.service /etc/systemd/system/pipe-*.timer /usr/local/sbin/pipe-* /usr/local/lib/pipe-vmbackup}"
EXTRA_IMAGES="${EXTRA_IMAGES:-}"
MIN_DB_BYTES="${MIN_DB_BYTES:-10000}"
STAGE_ROOT="${STAGE_ROOT:-/dev/shm}"

say() { echo "pipe-vmbackup: $*" >&2; }
fail() { say "$*"; exit 1; }
deny() { say "refused: $*"; exit 2; }

TMP=""
cleanup() { [ -z "$TMP" ] || rm -rf "$TMP"; }
trap cleanup EXIT
stage() { umask 077; TMP="$(mktemp -d "$STAGE_ROOT/pipe-vmbackup.XXXXXX")" || fail "cannot make a staging directory in $STAGE_ROOT"; }
encrypt() { age -r "$AGE_RECIPIENT"; }

# Exactly "<verb>" or "<verb> <one word>": anything else is refused before anything runs.
command_line="${SSH_ORIGINAL_COMMAND:-}"
[[ "$command_line" =~ ^[a-z]+(\ [A-Za-z0-9_.-]{1,63})?$ ]] || deny "not a command of the list"
verb="${command_line%% *}"
arg=""
[ "$verb" = "$command_line" ] || arg="${command_line#* }"

case "$verb" in
  ping)
    [ -z "$arg" ] || deny "ping takes no argument"
    echo ok
    ;;

  db)
    [ -n "$arg" ] || deny "db needs a database name"
    case " $DBS " in *" $arg "*) ;; *) deny "database '$arg' is not on the list" ;; esac
    stage
    docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -Fc "$arg" > "$TMP/db.dump" 2> "$TMP/err" || fail "pg_dump of $arg failed: $(head -c 300 "$TMP/err")"
    size="$(stat -c %s "$TMP/db.dump")"
    [ "$size" -ge "$MIN_DB_BYTES" ] || fail "the dump of $arg is only $size bytes — refusing to hand it over as a backup"
    docker exec -i "$PG_CONTAINER" pg_restore --list < "$TMP/db.dump" > "$TMP/toc" 2> "$TMP/err" || fail "the dump of $arg is not readable: $(head -c 300 "$TMP/err")"
    grep -q 'TABLE DATA' "$TMP/toc" || fail "the dump of $arg holds no table data"
    encrypt < "$TMP/db.dump" || fail "encryption failed"
    ;;

  files)
    [ -z "$arg" ] || deny "files takes no argument"
    [ -d "$MINIO_DIR" ] || fail "no object storage directory at $MINIO_DIR"
    stage
    tar -C "$MINIO_DIR" -cf "$TMP/files.tar" . 2> "$TMP/err" || fail "tar of the object storage failed: $(head -c 300 "$TMP/err")"
    tar -tf "$TMP/files.tar" > /dev/null 2>&1 || fail "the object storage archive is not readable"
    encrypt < "$TMP/files.tar" || fail "encryption failed"
    ;;

  config)
    [ -z "$arg" ] || deny "config takes no argument"
    stage
    mkdir -p "$TMP/cfg"
    {
      docker service ls --format '{{.Name}}' 2>/dev/null | while read -r s; do docker service inspect "$s" 2>/dev/null; done
    } > "$TMP/cfg/docker-services.json"
    docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}' > "$TMP/cfg/docker-ps.txt" 2>/dev/null
    for c in $(docker ps -a --format '{{.Names}}' 2>/dev/null | grep -vE '\.[0-9]+\.'); do docker inspect "$c" 2>/dev/null; done > "$TMP/cfg/docker-containers.json"
    iptables-save > "$TMP/cfg/iptables.save" 2>/dev/null
    ufw status verbose > "$TMP/cfg/ufw-status.txt" 2>/dev/null
    crontab -l -u root > "$TMP/cfg/crontab-root.txt" 2>/dev/null
    # shellcheck disable=SC2086
    existing=""; for p in $CONFIG_PATHS; do for f in $p; do [ -e "$f" ] && existing="$existing $f"; done; done
    # shellcheck disable=SC2086
    tar -cf "$TMP/config.tar" -C "$TMP" cfg $existing 2> "$TMP/err" || fail "tar of the configuration failed: $(head -c 300 "$TMP/err")"
    tar -tf "$TMP/config.tar" > /dev/null 2>&1 || fail "the configuration archive is not readable"
    encrypt < "$TMP/config.tar" || fail "encryption failed"
    ;;

  images)
    [ -z "$arg" ] || deny "images takes no argument"
    # What the services run (by the image they were started from) plus the containers named in EXTRA_IMAGES; streamed, nothing staged.
    images="$( { docker service ls --format '{{.Image}}' 2>/dev/null; for i in $EXTRA_IMAGES; do echo "$i"; done; } | sed 's/@sha256:.*//' | sort -u | grep -v '^$')"
    [ -n "$images" ] || fail "no images to save"
    # shellcheck disable=SC2086
    docker save $images | gzip -c | encrypt
    status=("${PIPESTATUS[@]}")
    [ "${status[0]}" -eq 0 ] && [ "${status[1]}" -eq 0 ] && [ "${status[2]}" -eq 0 ] || fail "saving the images failed (docker ${status[0]}, gzip ${status[1]}, age ${status[2]})"
    ;;

  *)
    deny "unknown command '$verb'"
    ;;
esac
