#!/usr/bin/env bash
#
# Gets red ready to take over — run from YOUR workstation WHILE WHITE IS UP (it reads white's secrets):
#
#   infra/failover/prepare-red.sh               prepare / refresh red
#   infra/failover/prepare-red.sh --check       is red's copy of the secrets still current?
#   AGE_IDENTITY=~/Documents/pipe-backup-key.txt infra/failover/prepare-red.sh --verify    prove the encrypted copy decrypts
#
# What red gets:
#   - white's ~/.pipe/bridge.env, **encrypted** with the age key the backups already use (AGE_RECIPIENT in white's
#     /etc/pipe-backup.env) → ~/.pipe/bridge.env.age. The JWT secrets and CREDENTIALS_ENC_KEY are NOT at rest in plain
#     text on a second board; the failover decrypts them with your private key (failover.sh). As a side effect it is a
#     second, encrypted backup of that file.
#   - the stack scripts and files (~/bridge-pi) and the failover script (~/failover), the standby's promote.sh
#   - a daily timer that pulls the images the stack needs (GHCR :stable, postgres, caddy, xray), so a failover does not
#     wait for downloads when the internet or GitHub is the problem
# Re-run it after you change a secret (set a new token, rotate a key): `--check` tells you when.
set -euo pipefail

PRIMARY="${PRIMARY:-192.168.50.11}"
STANDBY="${STANDBY:-192.168.50.12}"
SSH_USER="${SSH_USER:-pi}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MODE="${1:-prepare}"

ssh_() { local host="$1"; shift; ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_USER@$host" "$@"; }
# macOS tar adds extended attributes the Linux tar on the board warns about; leave them out where the tar knows how
tar_() { if tar --no-xattrs --version >/dev/null 2>&1; then tar --no-xattrs "$@"; else tar "$@"; fi; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
white_hash() { ssh_ "$PRIMARY" 'sha256sum ~/.pipe/bridge.env | cut -d" " -f1'; }

case "$MODE" in
  --check)
    recorded="$(ssh_ "$STANDBY" 'cat ~/.pipe/bridge.env.sha256 2>/dev/null' || true)"
    [ -n "$recorded" ] || { echo "red has no encrypted copy yet — run prepare-red.sh"; exit 1; }
    [ "$recorded" = "$(white_hash)" ] && { echo "current: red's encrypted secrets match white's"; exit 0; }
    echo "STALE: white's bridge.env changed since red's copy was made — run prepare-red.sh"; exit 1;;
  --verify)
    [ -n "${AGE_IDENTITY:-}" ] && [ -r "$AGE_IDENTITY" ] || die "AGE_IDENTITY (your private age key) is required for --verify"
    command -v age >/dev/null || die "age is not installed (brew install age)"
    got="$(ssh_ "$STANDBY" 'cat ~/.pipe/bridge.env.age' | age -d -i "$AGE_IDENTITY" | sha256sum | cut -d' ' -f1)" || die "decryption failed — wrong key, or a damaged file"
    [ "$got" = "$(ssh_ "$STANDBY" 'cat ~/.pipe/bridge.env.sha256')" ] || die "it decrypts, but to something other than white's current file (stale?)"
    echo "verified: red's encrypted secrets decrypt with your key and match the recorded hash"; exit 0;;
  prepare) ;;
  *) die "usage: $0 [--check|--verify]";;
esac

command -v age >/dev/null || die "age is not installed here (brew install age)"
recipient="$(ssh_ "$PRIMARY" 'sudo grep "^AGE_RECIPIENT=" /etc/pipe-backup.env | cut -d= -f2')"
[ -n "$recipient" ] || die "white's /etc/pipe-backup.env has no AGE_RECIPIENT — set up the encrypted backups first (infra/backup)"

echo "== secrets: encrypted copy on red (white's bridge.env → age → red; nothing is printed)"
ssh_ "$PRIMARY" 'cat ~/.pipe/bridge.env' | age -r "$recipient" | ssh_ "$STANDBY" 'mkdir -p ~/.pipe && chmod 700 ~/.pipe && umask 077 && cat > ~/.pipe/bridge.env.age'
white_hash | ssh_ "$STANDBY" 'umask 077; cat > ~/.pipe/bridge.env.sha256'
ssh_ "$STANDBY" 'test -s ~/.pipe/bridge.env.age' || die "the encrypted copy did not arrive"

echo "== stack scripts and files, failover and promote scripts"
tar_ -C "$ROOT/infra/bridge-pi" -c deploy.sh deploy-worker.sh secrets.sh bridge-pi.yml worker-pi.yml Caddyfile \
  | ssh_ "$STANDBY" 'mkdir -p ~/bridge-pi && tar -x -C ~/bridge-pi && chmod +x ~/bridge-pi/*.sh'
tar_ -C "$ROOT/infra" -c failover/failover-red.sh standby/promote.sh \
  | ssh_ "$STANDBY" 'mkdir -p ~/failover ~/standby && tar -x -C /tmp && install -m 755 /tmp/failover/failover-red.sh ~/failover/failover-red.sh && install -m 755 /tmp/standby/promote.sh ~/standby/promote.sh && rm -rf /tmp/failover /tmp/standby'

echo "== daily image pre-pull on red"
ssh_ "$STANDBY" 'sudo bash -s' <<'REMOTE'
set -e
cat > /usr/local/lib/pipe-prepull.sh <<'SH'
#!/usr/bin/env bash
# the images a failover to this board needs, kept local
set -u
for image in ghcr.io/bmazurme/pipe-bridge-backend:stable ghcr.io/bmazurme/pipe-bridge-frontend:stable ghcr.io/bmazurme/pipe-worker:stable \
             postgres:16-alpine caddy:2-alpine ghcr.io/xtls/xray-core:latest; do
  docker pull -q "$image" >/dev/null 2>&1 && echo "pulled $image" || echo "could not pull $image" >&2
done
SH
chmod 755 /usr/local/lib/pipe-prepull.sh
cat > /etc/systemd/system/pipe-prepull.service <<'UNIT'
[Unit]
Description=Pull the images a failover to this board needs
Wants=network-online.target docker.service
After=network-online.target docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/lib/pipe-prepull.sh
Nice=15
UNIT
cat > /etc/systemd/system/pipe-prepull.timer <<'UNIT'
[Unit]
Description=Daily image pre-pull for a failover

[Timer]
OnCalendar=*-*-* 05:30:00 Europe/Moscow
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now pipe-prepull.timer >/dev/null 2>&1
systemctl start pipe-prepull.service
REMOTE
ssh_ "$STANDBY" 'docker image ls --format "{{.Repository}}:{{.Tag}}" | grep -E "pipe-(bridge|worker)|^postgres:16-alpine|^caddy:2-alpine|xray-core" | sort | sed "s/^/   on red: /"'

echo
echo "red is prepared. Next, with YOUR key:  AGE_IDENTITY=… $0 --verify"
echo "A dry run of the switch itself (changes nothing):  AGE_IDENTITY=… infra/failover/failover.sh --dry-run   (only when white is down)"
