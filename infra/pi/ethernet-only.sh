#!/usr/bin/env bash
#
# Ethernet only: removes Wi-Fi from the network configuration and turns the radio off,
# so the board has ONE address (eth0) that the router can pin with a DHCP reservation.
#
# SAFE BY CONSTRUCTION:
#  - refuses to start unless eth0 has a link AND an IPv4 address (so you cannot cut off
#    a board that is reachable only over Wi-Fi);
#  - backs up /etc/netplan, and arms a dead-man timer that restores it after 3 minutes
#    unless the new configuration proves itself (gateway + internet reachable via eth0);
#  - runs detached (systemd-run), so it finishes even if your SSH session dies when the
#    Wi-Fi address disappears — reconnect to the NEW eth0 address afterwards.
#
# Copy it over and start it:
#
#   scp infra/pi/ethernet-only.sh pi@HOST:/tmp/
#   ssh -t pi@HOST 'sudo systemd-run --unit=pi-ethernet-only --collect /bin/bash /tmp/ethernet-only.sh'
#   ssh -t pi@HOST 'sudo journalctl -u pi-ethernet-only --no-pager'      # result
#
set -euo pipefail

LOG=/var/log/pi-ethernet-only.log
exec > >(tee -a "$LOG") 2>&1
echo "=== $(date -Is) ethernet-only on $(hostname)"

IFACE=eth0
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP="/root/netplan-backup-$TS"

carrier="$(cat /sys/class/net/$IFACE/carrier 2>/dev/null || echo 0)"
[ "$carrier" = 1 ] || { echo "ABORT: $IFACE has no link — plug the cable into a switch port first"; exit 1; }

speed="$(cat /sys/class/net/$IFACE/speed 2>/dev/null || echo 0)"
echo "$IFACE link: ${speed} Mb/s"
[ "$speed" -ge 100 ] || echo "WARNING: link is below 100 Mb/s — check the cable and the switch (see infra/pi/README.md); continuing"

ip -4 -o addr show dev "$IFACE" | grep -q 'inet ' || {
  echo "ABORT: $IFACE has a link but no IPv4 address (DHCP). Check the switch/router, then run again"
  exit 1
}

GW="$(ip -4 route show default | awk '{print $3; exit}')"
GW="${GW:-192.168.50.1}"
echo "gateway: $GW"

# --- 1. back up, and edit the netplan files: no wifis, eth0 on DHCP --------------------
cp -a /etc/netplan "$BACKUP"
echo "backup: $BACKUP"

# cloud-init would otherwise write its Wi-Fi config back on the next boot
mkdir -p /etc/cloud/cloud.cfg.d
echo 'network: {config: disabled}' > /etc/cloud/cloud.cfg.d/99-disable-network-config.cfg

python3 - <<'PY'
import glob, yaml
changed_eth = False
for path in sorted(glob.glob('/etc/netplan/*.yaml')):
    with open(path) as f:
        doc = yaml.safe_load(f) or {}
    net = doc.get('network')
    if not isinstance(net, dict):
        continue
    if 'wifis' in net:
        del net['wifis']
        print(f'{path}: wifis removed')
    eth = (net.get('ethernets') or {}).get('eth0')
    if eth is not None:
        eth.pop('optional', None)          # wait for the cable at boot — a server needs its network
        eth['dhcp4'] = True
        eth['dhcp6'] = False
        eth['accept-ra'] = False
        changed_eth = True
    with open(path, 'w') as f:
        yaml.safe_dump(doc, f, default_flow_style=False)
    import os; os.chmod(path, 0o600)
if not changed_eth:
    # No eth0 stanza anywhere: add one in its own file
    with open('/etc/netplan/60-eth0.yaml', 'w') as f:
        yaml.safe_dump({'network': {'version': 2, 'ethernets': {'eth0': {'dhcp4': True, 'dhcp6': False, 'accept-ra': False}}}}, f, default_flow_style=False)
    import os; os.chmod('/etc/netplan/60-eth0.yaml', 0o600)
    print('/etc/netplan/60-eth0.yaml created')
PY

netplan generate

# --- 2. Wi-Fi radio off for good (takes effect fully after the next reboot) ----------------
if command -v nmcli >/dev/null 2>&1 && systemctl is-active --quiet NetworkManager; then
  nmcli radio wifi off || true
fi
CONFIG_TXT=/boot/firmware/config.txt
if [ -f "$CONFIG_TXT" ] && ! grep -q '^dtoverlay=disable-wifi' "$CONFIG_TXT"; then
  printf '\n# Ethernet only (infra/pi/ethernet-only.sh)\ndtoverlay=disable-wifi\n' >> "$CONFIG_TXT"
  echo "config.txt: dtoverlay=disable-wifi added"
fi

# --- 3. apply with a dead-man switch ------------------------------------------------------
systemd-run --quiet --unit=pi-eth-rollback --on-active=180 /bin/sh -c \
  "rm -rf /etc/netplan && cp -a $BACKUP /etc/netplan && netplan apply"
echo "rollback armed (180 s)"

netplan apply
sleep 12

ok=1
ip route get "$GW" | grep -q "dev $IFACE" || ok=0
ping -c3 -W2 -I "$IFACE" "$GW" >/dev/null 2>&1 || ok=0
ping -c2 -W3 -I "$IFACE" 1.1.1.1 >/dev/null 2>&1 || ok=0

if [ "$ok" = 1 ]; then
  systemctl stop pi-eth-rollback.timer
  echo "OK: Ethernet-only works — rollback cancelled. address: $(ip -4 -br addr show $IFACE | awk '{print $3}')"
else
  echo "FAILED: gateway/internet not reachable over $IFACE — the old configuration comes back in <3 min"
  exit 1
fi
