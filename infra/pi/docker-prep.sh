#!/usr/bin/env bash
#
# Prepares one Raspberry Pi for a Docker Swarm node. Idempotent; run on every board:
#
#   scp infra/pi/docker-prep.sh pi@HOST:/tmp/ && ssh -t pi@HOST 'sudo bash /tmp/docker-prep.sh'
#
# What it does (nothing is deleted except the old Swarm membership, which is moved aside):
#   1. stops Docker and moves /var/lib/docker/swarm to swarm.old-<ts> — a leftover membership
#      (e.g. the old Wi-Fi address in blue's) keeps dockerd from starting; images, volumes and
#      containers stay untouched
#   2. upgrades the Docker packages to the newest the Ubuntu repo of this release offers
#   3. daemon.json: json-file log rotation (existing keys are kept; no live-restore — it is
#      incompatible with Swarm)
#   4. loads vxlan/br_netfilter/overlay now and on every boot (Swarm overlay networks)
#   5. enables the memory cgroup (Ubuntu on the Pi ships without it, so `--limit-memory` and
#      per-service limits are silently ignored) — needs a reboot, the script says so
#   6. makes dockerd wait for time sync (no RTC on the Pi)
#   7. opens the Swarm ports in ufw when ufw is active
set -euo pipefail

TS="$(date +%Y%m%d-%H%M%S)"
log() { echo "[$(date +%T)] $*"; }

log "=== docker-prep on $(hostname)"

systemctl stop docker.service docker.socket 2>/dev/null || true
if [ -d /var/lib/docker/swarm ]; then
  mv /var/lib/docker/swarm "/var/lib/docker/swarm.old-$TS"
  log "old swarm state moved to /var/lib/docker/swarm.old-$TS"
fi

export DEBIAN_FRONTEND=noninteractive
# a dead third-party repo (red has a retired gitlab-runner one) must not abort the Docker upgrade
apt-get update -qq || log "WARNING: apt-get update reported errors — continuing with the cached lists"
apt-get install -y -qq --only-upgrade \
  docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras
log "docker: $(docker --version)"

mkdir -p /etc/docker
DAEMON_JSON=/etc/docker/daemon.json
[ -f "$DAEMON_JSON" ] && cp -a "$DAEMON_JSON" "$DAEMON_JSON.bak-$TS"
python3 - <<'PY'
import json, os
p = '/etc/docker/daemon.json'
cfg = json.load(open(p)) if os.path.exists(p) and os.path.getsize(p) else {}
cfg.setdefault('log-driver', 'json-file')
cfg.setdefault('log-opts', {'max-size': '10m', 'max-file': '3'})
cfg.pop('live-restore', None)
json.dump(cfg, open(p, 'w'), indent=2)
open(p, 'a').write('\n')
PY

printf 'overlay\nbr_netfilter\nvxlan\n' > /etc/modules-load.d/docker-swarm.conf
for m in overlay br_netfilter vxlan; do modprobe "$m"; done
printf 'net.ipv4.ip_forward=1\nnet.bridge.bridge-nf-call-iptables=1\n' > /etc/sysctl.d/99-docker-swarm.conf
sysctl --system >/dev/null

REBOOT=0
CMDLINE=/boot/firmware/cmdline.txt
if ! grep -qw memory /sys/fs/cgroup/cgroup.controllers && ! grep -q 'cgroup_enable=memory' "$CMDLINE"; then
  cp -a "$CMDLINE" "$CMDLINE.bak-$TS"
  sed -i '1 s/$/ cgroup_enable=memory cgroup_memory=1/' "$CMDLINE"
  REBOOT=1
  log "cmdline.txt: cgroup_enable=memory added"
fi

if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  ufw allow 2377/tcp; ufw allow 7946/tcp; ufw allow 7946/udp; ufw allow 4789/udp
  log "ufw: swarm ports opened"
fi

# the Pi has no RTC: without this dockerd can start with a stale clock and Swarm rejects its
# certificates as "expired or not yet valid" until it is restarted
mkdir -p /etc/systemd/system/docker.service.d
printf '[Unit]\nAfter=time-sync.target\nWants=time-sync.target\n' > /etc/systemd/system/docker.service.d/10-time-sync.conf
systemctl daemon-reload

systemctl enable docker.service >/dev/null 2>&1
systemctl start docker.service
sleep 3
docker info --format 'docker {{.ServerVersion}}, storage {{.Driver}}, swarm={{.Swarm.LocalNodeState}}'
[ "$REBOOT" = 1 ] && log "REBOOT REQUIRED (memory cgroup): sudo reboot"
log "done"
