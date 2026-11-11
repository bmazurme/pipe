#!/usr/bin/env bash
#
# Pulls the backups of notes and places from the cloud VM onto THIS machine (the NAS) — the only place they are kept. The NAS opens the connection;
# the VM's side (infra/vmbackup/serve.sh) answers one of a short list of commands with an `age`-ENCRYPTED stream, so what lands here is ciphertext
# only: the NAS holds no key that can read it, and the VM keeps no copy of its own.
#
#   vm-pull.sh snapshot   every database in VM_DBS, the object storage (files) and the configuration → snapshots/<UTC>/, then `latest`
#   vm-pull.sh images     the Docker images the VM runs (big, so weekly) → images/<UTC>.tar.gz.age
#   vm-pull.sh ping       proves the key, the forced command and sudo on the VM (prints ok)
#
# A snapshot is all or nothing: it is built in a hidden directory, every file must be non-empty and start with the age header, and only then is it
# renamed into place. A failed pull leaves the previous snapshots untouched and `last-success` unchanged (the container's health check and the
# Dashboard read it). Whether the ciphertext decrypts is something only the key's owner can prove — see infra/vmbackup/README.md (verify-from-workstation.sh).
#
# Settings: VM_SOURCE (required, e.g. pipebackup@89.169.132.49), VM_KEY (default /root/.ssh/pull_vm), VM_DIR (default /srv/vm-backups),
# VM_KNOWN_HOSTS (the pinned host key of the VM, default /root/.ssh/known_hosts_vm — a different VM is refused, never asked about),
# VM_DBS (default "notes-db places"), VM_KEEP (snapshots kept, default 14), VM_IMAGES_KEEP (default 4), MIN_BYTES (smallest believable stream, default 200),
# VM_SSH (the ssh command, a test hook).
set -euo pipefail

VM_DIR="${VM_DIR:-/srv/vm-backups}"
VM_KEY="${VM_KEY:-/root/.ssh/pull_vm}"
VM_DBS="${VM_DBS:-notes-db places}"
VM_KEEP="${VM_KEEP:-14}"
VM_IMAGES_KEEP="${VM_IMAGES_KEEP:-4}"
MIN_BYTES="${MIN_BYTES:-200}"
: "${VM_SOURCE:?VM_SOURCE is required, e.g. pipebackup@89.169.132.49}"
# The one place the commands for the forced command are spelled: "<verb>[ <argument>]".
ssh_ask() {
  if [ -n "${VM_SSH:-}" ]; then $VM_SSH "$1"; return; fi
  ssh -i "$VM_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o PasswordAuthentication=no -o ConnectTimeout=20 \
    -o UserKnownHostsFile="${VM_KNOWN_HOSTS:-/root/.ssh/known_hosts_vm}" -o StrictHostKeyChecking=yes \
    -o ServerAliveInterval=30 -o ServerAliveCountMax=6 "$VM_SOURCE" "$1"
}

log() { echo "[$(date -u +%FT%TZ)] vm-pull: $*"; }
umask 077
mkdir -p "$VM_DIR/snapshots" "$VM_DIR/images"
exec 8>"$VM_DIR/.lock"
flock -n 8 || { log "another run is active"; exit 1; }

WORK=""
cleanup() { [ -z "$WORK" ] || rm -rf "$WORK"; }
trap cleanup EXIT
fail() { log "FAILED - what was kept before is untouched: $*" >&2; exit 1; }

# Asks for <command>, writes the stream to <file>, and refuses anything that is not a believable age stream.
fetch() { # command file
  ssh_ask "$1" > "$2" 2> "$2.err" || fail "'$1': $(head -c 300 "$2.err")"
  rm -f "$2.err"
  local size; size="$(stat -c %s "$2")"
  [ "$size" -ge "$MIN_BYTES" ] || fail "'$1' gave only $size bytes"
  head -c 21 "$2" | grep -q '^age-encryption.org/v1' || fail "'$1' did not give an age-encrypted stream"
  (cd "$(dirname "$2")" && sha256sum "$(basename "$2")" >> SHA256SUMS)
}

keep_newest() { # directory pattern count
  # shellcheck disable=SC2012
  ls -1d "$1"/$2 2>/dev/null | sort -r | tail -n +$(( $3 + 1 )) | while read -r old; do rm -rf "$old"; log "removed the old $(basename "$old")"; done
}

snapshot() {
  local stamp; stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  WORK="$VM_DIR/snapshots/.incoming-$$"
  rm -rf "$WORK"; mkdir -p "$WORK"
  : > "$WORK/SHA256SUMS"
  local db
  for db in $VM_DBS; do fetch "db $db" "$WORK/$db.dump.age"; done
  fetch files "$WORK/files.tar.age"
  fetch config "$WORK/config.tar.age"
  printf 'CREATED=%s\nDBS="%s"\nFILES=files.tar.age\nCONFIG=config.tar.age\nSOURCE=%s\n' "$stamp" "$VM_DBS" "${VM_SOURCE#*@}" > "$WORK/meta.env"
  [ ! -e "$VM_DIR/snapshots/$stamp" ] || fail "a snapshot named $stamp already exists"
  mv "$WORK" "$VM_DIR/snapshots/$stamp"; WORK=""
  ln -sfn "snapshots/$stamp" "$VM_DIR/latest.new" && mv -T "$VM_DIR/latest.new" "$VM_DIR/latest"
  date +%s > "$VM_DIR/last-success.new" && mv "$VM_DIR/last-success.new" "$VM_DIR/last-success"
  log "snapshot $stamp: $(du -sk "$VM_DIR/snapshots/$stamp" | cut -f1) kB"
  keep_newest "$VM_DIR/snapshots" '[0-9]*' "$VM_KEEP"
}

images() {
  local stamp; stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  WORK="$VM_DIR/images/.incoming-$$"
  rm -rf "$WORK"; mkdir -p "$WORK"
  : > "$WORK/SHA256SUMS"
  fetch images "$WORK/images.tar.gz.age"
  mkdir -p "$VM_DIR/images/$stamp"
  mv "$WORK"/* "$VM_DIR/images/$stamp/"; rm -rf "$WORK"; WORK=""
  date +%s > "$VM_DIR/images-last-success"
  log "images $stamp: $(du -sk "$VM_DIR/images/$stamp" | cut -f1) kB"
  keep_newest "$VM_DIR/images" '[0-9]*' "$VM_IMAGES_KEEP"
}

case "${1:-}" in
  snapshot) snapshot ;;
  images) images ;;
  ping) [ "$(ssh_ask ping)" = ok ] && echo ok || fail "the VM did not answer ping" ;;
  *) echo "usage: $0 snapshot|images|ping" >&2; exit 2 ;;
esac
