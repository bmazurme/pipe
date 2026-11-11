#!/usr/bin/env bash
#
# Installs the VM side of the NAS-only backups on THIS machine (the cloud VM; sudo, idempotent):
#
#   scp -r infra/vmbackup USER@VM:/tmp/ && ssh -t USER@VM 'sudo bash /tmp/vmbackup/install.sh --recipient age1…   [--dry-run]'
#   ssh -t USER@VM 'sudo bash /tmp/vmbackup/install.sh addkey "<the ONE line the NAS printed>"'
#   ssh -t USER@VM 'sudo bash /tmp/vmbackup/install.sh --remove'
#
#   a system user `pipebackup` (no password, key-only)       the NAS logs in as it
#   /usr/local/lib/pipe-vmbackup/serve.sh                    root-owned: the ONLY command that user's key can run
#   /etc/sudoers.d/pipe-vmbackup                             pipebackup may run exactly that script as root (validated with visudo)
#   /etc/pipe-vmbackup.conf                                  AGE_RECIPIENT (the PUBLIC key), DBS, … (edit to taste)
#   the package `age`                                        installed if missing
#
# `addkey` refuses any authorized_keys line that is not restricted and bound to serve.sh, so a mistake cannot hand the NAS (or anyone) a shell.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${ROOT:-}"   # test hook: a directory standing in for /
DRY=0; REMOVE=0; RECIPIENT=""; ADDKEY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --remove) REMOVE=1 ;;
    --recipient) RECIPIENT="${2:?--recipient needs an age public key}"; shift ;;
    addkey) ADDKEY="${2:?addkey needs the authorized_keys line}"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
log() { echo "[$(date +%T)] $*"; }
run() { if [ "$DRY" = 1 ]; then echo "  would: $*"; else "$@"; fi; }
put() { if [ "$DRY" = 1 ]; then echo "  would write $1"; else mkdir -p "$(dirname "$1")"; printf '%s' "$2" > "$1"; fi; }
[ "$DRY" = 1 ] || [ -n "$ROOT" ] || [ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }

USER_NAME=pipebackup
LIB="$ROOT/usr/local/lib/pipe-vmbackup"
CONF="$ROOT/etc/pipe-vmbackup.conf"
SUDOERS="$ROOT/etc/sudoers.d/pipe-vmbackup"
HOME_DIR="$ROOT/home/$USER_NAME"
FORCED='command="sudo --preserve-env=SSH_ORIGINAL_COMMAND /usr/local/lib/pipe-vmbackup/serve.sh"'

if [ "$REMOVE" = 1 ]; then
  run rm -f "$SUDOERS"
  run rm -rf "$LIB"
  [ -z "$ROOT" ] && run userdel -r "$USER_NAME" 2>/dev/null || true
  [ -z "$ROOT" ] || run rm -rf "$HOME_DIR"
  log "removed (the settings file $CONF is left)"
  exit 0
fi

if [ -n "$ADDKEY" ]; then
  case "$ADDKEY" in
    restrict,*"$FORCED"*ssh-ed25519\ *) ;;
    *) echo "refused: the line must start with 'restrict,' and carry exactly $FORCED (use the line the NAS's keygen printed)" >&2; exit 1 ;;
  esac
  case "$ADDKEY" in *$'\n'*) echo "refused: one line only" >&2; exit 1 ;; esac
  run mkdir -p "$HOME_DIR/.ssh"
  if [ "$DRY" = 1 ]; then echo "  would add the key to $HOME_DIR/.ssh/authorized_keys"; exit 0; fi
  touch "$HOME_DIR/.ssh/authorized_keys"
  grep -qxF "$ADDKEY" "$HOME_DIR/.ssh/authorized_keys" || printf '%s\n' "$ADDKEY" >> "$HOME_DIR/.ssh/authorized_keys"
  chmod 700 "$HOME_DIR/.ssh"; chmod 600 "$HOME_DIR/.ssh/authorized_keys"
  [ -n "$ROOT" ] || chown -R "$USER_NAME:$USER_NAME" "$HOME_DIR/.ssh"
  log "key added for $USER_NAME (restricted to serve.sh)"
  exit 0
fi

if [ -z "$ROOT" ]; then
  command -v docker >/dev/null || { echo "docker is missing" >&2; exit 1; }
  command -v age >/dev/null || { [ "$DRY" = 1 ] && echo "  would: apt-get install -y age" || { apt-get update -qq && apt-get install -y -qq age; }; }
  id "$USER_NAME" >/dev/null 2>&1 || run useradd --system --create-home --shell /bin/sh "$USER_NAME"
fi

run mkdir -p "$LIB"
run install -m 755 "$HERE/serve.sh" "$LIB/serve.sh"
[ -n "$ROOT" ] || run chown -R root:root "$LIB"

if [ ! -e "$CONF" ]; then
  [ -n "$RECIPIENT" ] || { echo "first install needs --recipient age1… (the PUBLIC key the backups are encrypted to)" >&2; exit 1; }
  case "$RECIPIENT" in age1*) ;; *) echo "that is not an age public key (it starts with age1)" >&2; exit 1 ;; esac
  put "$CONF" $'# Settings of the VM side of the NAS-only backups (infra/vmbackup). AGE_RECIPIENT is a PUBLIC key: the private one stays with the owner.\nAGE_RECIPIENT='"$RECIPIENT"$'\n# Databases the NAS may ask for (databases of the shared Postgres container):\nDBS="notes-db places"\n#PG_CONTAINER=postgres\n#MINIO_DIR=/var/lib/docker/volumes/coi_minio-data/_data\n# Containers (not Swarm services) whose images are saved too:\n#EXTRA_IMAGES="postgres:13.2-alpine"\n'
  [ "$DRY" = 1 ] || chmod 644 "$CONF"
  log "created $CONF"
else
  log "$CONF exists - left as it is"
fi

put "$SUDOERS" "$USER_NAME ALL=(root) NOPASSWD:SETENV: /usr/local/lib/pipe-vmbackup/serve.sh"$'\n'
if [ "$DRY" != 1 ]; then
  chmod 440 "$SUDOERS"
  if [ -z "$ROOT" ]; then visudo -cf "$SUDOERS" >/dev/null || { rm -f "$SUDOERS"; echo "the sudoers file did not validate - removed" >&2; exit 1; }; fi
fi
log "VM side installed. Next: the NAS prints its key line (infra/nas/install.sh keygen-vm), then: sudo bash install.sh addkey \"<that line>\""
