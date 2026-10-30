#!/usr/bin/env bash
#
# Installs the backup-pull container on the WD My Cloud NAS, from your workstation over SSH (the NAS has no git, no build tools of its own
# but Docker). Nothing is installed on the NAS outside Docker and two directories on the data volume.
#
#   install.sh build    copy the build context and build the image there (several minutes on the NAS's ARM CPU)
#   install.sh keygen   make the pull key inside the persistent keys volume and print the line to add on the Pi
#   install.sh once     one pull right now (run it after adding the line): proves the whole chain
#   install.sh start    (re)create the container that pulls every day; it restarts with the NAS
#   install.sh setkey   (once) copy the boards-only API key to the NAS so the container can report to the Dashboard
#   install.sh status   the container, its health, the last lines of its log, and the copies on disk
#
# Settings (environment):
#   NAS_HOST     default 192.168.50.216
#   NAS_KEY      ssh key of the NAS root account, default ~/.ssh/nas_ed25519
#   SOURCE       default pi@192.168.50.12:latest/   (red holds the second copy; white is the primary and is left alone)
#   PULL_AT      default 03:50
#   NAS_DATA     default /mnt/HD/HD_a2   (the data volume; the directories below are private - not an SMB share)
set -euo pipefail

NAS_HOST="${NAS_HOST:-192.168.50.216}"
NAS_KEY="${NAS_KEY:-$HOME/.ssh/nas_ed25519}"
SOURCE="${SOURCE:-pi@192.168.50.12:latest/}"
PULL_AT="${PULL_AT:-03:50}"
NAS_DATA="${NAS_DATA:-/mnt/HD/HD_a2}"
IMAGE=pipe-backup-pull
NAME=pipe-backup-pull
KEYS="$NAS_DATA/Nas_Prog/$NAME/keys"
BACKUPS="$NAS_DATA/Nas_Prog/$NAME/backups"
HERE="$(cd "$(dirname "$0")" && pwd)"

# The WD firmware calls its root account "sshd".
NAS_USER="${NAS_USER:-sshd}"
nas() { ssh -i "$NAS_KEY" -o IdentitiesOnly=yes -o PasswordAuthentication=no -o BatchMode=yes -o ConnectTimeout=15 "$NAS_USER@$NAS_HOST" "$@"; }

run_args() { # the docker run arguments shared by keygen / once / start
  echo "-e SOURCE=$SOURCE -e PULL_AT=$PULL_AT -e TZ=Europe/Moscow -e FROM_IP=$NAS_HOST -v $KEYS:/keys -v $BACKUPS:/srv/backups"
}

# Only the long-running container reports to bridge: it reads the disks' SMART (the two devices + SYS_RAWIO) and the host's RAID state, and
# gets the boards-only key from the env file below (mode 600, made by `install.sh setkey`; without it the container just does not report).
ENVFILE="$NAS_DATA/Nas_Prog/$NAME/env"
REPORT_ARGS="--device /dev/sda --device /dev/sdb --cap-add SYS_RAWIO -v /proc/mdstat:/host/mdstat:ro -e NAS_NAME=${NAS_NAME:-MyCloudEX2Ultra} -e BRIDGE_RESOLVE=${BRIDGE_RESOLVE:-api.bridge.ntlstl.dev:443:192.168.50.10}"

case "${1:-}" in
  build)
    ctx="$(mktemp -d)"; trap 'rm -rf "$ctx"' EXIT
    cp "$HERE/Dockerfile" "$HERE/entrypoint.sh" "$HERE/healthcheck.sh" "$HERE/report.sh" "$HERE/../backup/pull.sh" "$ctx/"
    nas "mkdir -p '$KEYS' '$BACKUPS' /tmp/$NAME-ctx && rm -rf /tmp/$NAME-ctx/*"
    tar -C "$ctx" -cf - . | nas "tar -C /tmp/$NAME-ctx -xf -"
    nas "cd /tmp/$NAME-ctx && docker build -t $IMAGE . 2>&1 | tail -15"
    ;;
  keygen)
    # shellcheck disable=SC2046
    nas "docker run --rm $(run_args) $IMAGE keygen"
    ;;
  once)
    # shellcheck disable=SC2046
    nas "docker run --rm $(run_args) $IMAGE once"
    ;;
  start)
    nas "docker rm -f $NAME >/dev/null 2>&1 || true"
    # shellcheck disable=SC2046
    nas "docker run -d --name $NAME --restart unless-stopped $(run_args) $REPORT_ARGS \$([ -f '$ENVFILE' ] && echo --env-file '$ENVFILE') $IMAGE run"
    ;;
  setkey)
    # Copies the boards-only key from a Pi's agent settings to the NAS without ever printing it: PI_KEY_SOURCE=pi@192.168.50.11 install.sh setkey
    : "${PI_KEY_SOURCE:?PI_KEY_SOURCE is required, e.g. pi@192.168.50.11}"
    ssh "$PI_KEY_SOURCE" "sudo sed -n 's/^BRIDGE_API_KEY=//p' /etc/pipe-boardagent.env" \
      | nas "umask 077; read -r k; [ -n \"\$k\" ] || { echo 'no key came through' >&2; exit 1; }; printf 'BRIDGE_API_KEY=%s\n' \"\$k\" > '$ENVFILE'; echo 'key stored (mode 600)'"
    ;;
  status)
    nas "docker ps -a --filter name=$NAME --format '{{.Names}}  {{.Status}}'; echo; docker logs --tail 8 $NAME 2>&1; echo; ls -l '$BACKUPS' '$BACKUPS/snapshots' 2>&1 | head -20"
    ;;
  *)
    sed -n '3,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
