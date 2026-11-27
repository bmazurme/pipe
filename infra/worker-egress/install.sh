#!/usr/bin/env bash
#
# Installs the worker egress filter on a board (run as root, from this directory):
#
#   scp -r infra/worker-egress pi@192.168.50.12:~/ && ssh -t pi@192.168.50.12 'sudo bash ~/worker-egress/install.sh'
#
# A oneshot service that applies the rules (at boot, after Docker) and a timer that applies them again every 5 minutes — idempotent, so
# a firewall reload or a Docker restart that flushed them is healed within minutes. Then `worker-egress.sh verify` runs a throwaway
# container to prove it. Take it out again: `sudo systemctl disable --now pipe-worker-egress.timer && sudo /usr/local/lib/pipe-worker-egress/worker-egress.sh remove`.
# Exceptions (private addresses a worker may still reach) go into /etc/pipe-worker-egress.env as EGRESS_ALLOW="192.168.50.5/32 …".
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
LIB=/usr/local/lib/pipe-worker-egress

command -v iptables >/dev/null || { echo "iptables is required" >&2; exit 1; }
install -d -m 755 "$LIB"
install -m 755 "$SRC/worker-egress.sh" "$LIB/worker-egress.sh"
[ -f /etc/pipe-worker-egress.env ] || {
  printf '# Private CIDRs a worker container may still reach, space-separated. Empty = none.\n# EGRESS_ALLOW=""\n' > /etc/pipe-worker-egress.env
  chmod 644 /etc/pipe-worker-egress.env
}

cat > /etc/systemd/system/pipe-worker-egress.service <<UNIT
[Unit]
Description=Keep worker containers away from the home network (S1: no private addresses, only the internet)
Wants=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
Environment=EGRESS_WAIT=60
EnvironmentFile=-/etc/pipe-worker-egress.env
ExecStart=$LIB/worker-egress.sh apply

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/pipe-worker-egress.timer <<'UNIT'
[Unit]
Description=Re-apply the worker egress filter every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable pipe-worker-egress.service >/dev/null
systemctl enable --now pipe-worker-egress.timer
systemctl start pipe-worker-egress.service
echo "installed. Prove it: sudo $LIB/worker-egress.sh verify"
