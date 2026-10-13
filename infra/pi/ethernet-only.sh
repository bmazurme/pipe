#!/usr/bin/env bash
#
# Ethernet only: brings eth0 up on DHCP, then removes Wi-Fi from the network configuration
# and turns the radio off, so the board has ONE address (eth0) that the router can pin with
# a DHCP reservation.
#
# TWO PHASES, each checked before the next:
#   1. eth0 up (netplan: DHCP) WHILE Wi-Fi is still on. A board installed over Wi-Fi usually has
#      no eth0 stanza at all — `networkctl` shows eth0 "unmanaged", the interface is DOWN, and
#      "no link" can simply mean it was never brought up. Wait for link and an IPv4 address; if
#      they do not come, restore the old configuration and stop (Wi-Fi untouched).
#   2. only then remove Wi-Fi, apply, and verify the gateway and the internet over eth0.
#
# SAFE BY CONSTRUCTION: /etc/netplan is backed up; a dead-man timer restores it after 4 minutes
# unless the new configuration has proven itself; runs detached (systemd-run), so it finishes
# even if your SSH session dies when the Wi-Fi address disappears — reconnect to the NEW
# eth0 address afterwards (see the router's DHCP reservation).
#
#   scp infra/pi/ethernet-only.sh pi@HOST:/tmp/
#   ssh -t pi@HOST 'sudo systemd-run --unit=pi-ethernet-only --collect /bin/bash /tmp/ethernet-only.sh'
#   ssh -t pi@HOST 'sudo journalctl -u pi-ethernet-only --no-pager'      # result
#
set -euo pipefail

NETPLAN_DIR="${NETPLAN_DIR:-/etc/netplan}"
IFACE="${IFACE:-eth0}"
LOG=/var/log/pi-ethernet-only.log
TIMER_SECONDS=240

# TEST_ONLY=edit makes the script only rewrite the netplan files in NETPLAN_DIR (used by the test).
TEST_ONLY="${TEST_ONLY:-}"

log() { echo "[$(date +%T)] $*"; }

# --- netplan editing (python, PyYAML ships with netplan) -----------------------------------
edit_netplan() { # $1 = phase: "add-eth" | "drop-wifi"
  NETPLAN_DIR="$NETPLAN_DIR" IFACE="$IFACE" PHASE="$1" python3 - <<'PY'
import glob, os, yaml

d, iface, phase = os.environ['NETPLAN_DIR'], os.environ['IFACE'], os.environ['PHASE']
has_eth = False
for path in sorted(glob.glob(os.path.join(d, '*.yaml'))):
    doc = yaml.safe_load(open(path)) or {}
    net = doc.get('network')
    if not isinstance(net, dict):
        continue
    dirty = False
    eth = (net.get('ethernets') or {}).get(iface)
    if eth is not None:
        has_eth = True
        before = dict(eth)
        eth.pop('optional', None)                 # a server waits for its network at boot
        eth.update({'dhcp4': True, 'dhcp6': False, 'accept-ra': False})
        dirty = eth != before
    if phase == 'drop-wifi' and 'wifis' in net:
        del net['wifis']
        dirty = True
        print(f'{path}: wifis removed')
    if dirty:
        with open(path, 'w') as f:
            yaml.safe_dump(doc, f, default_flow_style=False)
        os.chmod(path, 0o600)

if phase == 'add-eth' and not has_eth:
    path = os.path.join(d, '60-eth0.yaml')
    with open(path, 'w') as f:
        yaml.safe_dump({'network': {'version': 2, 'ethernets': {iface: {'dhcp4': True, 'dhcp6': False, 'accept-ra': False}}}},
                       f, default_flow_style=False)
    os.chmod(path, 0o600)
    print(f'{path}: created ({iface} had no stanza — it was unmanaged)')
PY
}

if [ -n "$TEST_ONLY" ]; then
  edit_netplan "$TEST_ONLY"
  exit 0
fi

exec > >(tee -a "$LOG") 2>&1
log "=== ethernet-only on $(hostname)"

TS="$(date +%Y%m%d-%H%M%S)"
BACKUP="/root/netplan-backup-$TS"
GW="$(ip -4 route show default | awk '{print $3; exit}')"
GW="${GW:-192.168.50.1}"
log "gateway: $GW"

cp -a "$NETPLAN_DIR" "$BACKUP"
log "backup: $BACKUP"

# cloud-init would otherwise write its own (Wi-Fi) config back on the next boot
mkdir -p /etc/cloud/cloud.cfg.d
echo 'network: {config: disabled}' > /etc/cloud/cloud.cfg.d/99-disable-network-config.cfg

# dead-man switch for both phases
systemd-run --quiet --unit=pi-eth-rollback --on-active="$TIMER_SECONDS" /bin/sh -c \
  "rm -rf $NETPLAN_DIR && cp -a $BACKUP $NETPLAN_DIR && netplan apply"
log "rollback armed ($TIMER_SECONDS s)"

rollback_now() {
  log "$1"
  systemctl stop pi-eth-rollback.timer 2>/dev/null || true
  rm -rf "$NETPLAN_DIR" && cp -a "$BACKUP" "$NETPLAN_DIR" && netplan apply || true
  log "old configuration restored — Wi-Fi untouched"
  exit 1
}

# --- phase 1: eth0 up on DHCP, Wi-Fi still on ----------------------------------------------
edit_netplan add-eth
netplan generate
netplan apply
ip link set "$IFACE" up 2>/dev/null || true

log "waiting for $IFACE link and an IPv4 address (up to 40 s)"
for _ in $(seq 1 40); do
  carrier="$(cat /sys/class/net/$IFACE/carrier 2>/dev/null || echo 0)"
  if [ "$carrier" = 1 ] && ip -4 -o addr show dev "$IFACE" | grep -q 'inet '; then break; fi
  sleep 1
done
carrier="$(cat /sys/class/net/$IFACE/carrier 2>/dev/null || echo 0)"
[ "$carrier" = 1 ] || rollback_now "ABORT: $IFACE has no link (cable not in a working port?)"
ip -4 -o addr show dev "$IFACE" | grep -q 'inet ' || rollback_now "ABORT: $IFACE has a link but got no DHCP address (check the switch/router)"

speed="$(cat /sys/class/net/$IFACE/speed 2>/dev/null || echo 0)"
log "$IFACE up: $(ip -4 -br addr show $IFACE | awk '{print $3}') at ${speed} Mb/s"
[ "$speed" -ge 100 ] || log "WARNING: link below 100 Mb/s — check the cable and the switch (infra/pi/README.md); continuing"

ping -c2 -W2 -I "$IFACE" "$GW" >/dev/null 2>&1 || rollback_now "ABORT: gateway $GW unreachable over $IFACE"
ping -c2 -W3 -I "$IFACE" 1.1.1.1 >/dev/null 2>&1 || rollback_now "ABORT: internet unreachable over $IFACE"
log "phase 1 ok — $IFACE works"

# --- phase 2: drop Wi-Fi ---------------------------------------------------------------------
edit_netplan drop-wifi
netplan generate

if command -v nmcli >/dev/null 2>&1 && systemctl is-active --quiet NetworkManager; then
  nmcli radio wifi off || true
fi
CONFIG_TXT=/boot/firmware/config.txt
if [ -f "$CONFIG_TXT" ] && ! grep -q '^dtoverlay=disable-wifi' "$CONFIG_TXT"; then
  printf '\n# Ethernet only (infra/pi/ethernet-only.sh)\ndtoverlay=disable-wifi\n' >> "$CONFIG_TXT"
  log "config.txt: dtoverlay=disable-wifi added (full effect after the next reboot)"
fi

netplan apply
sleep 12

ok=1
ip route get "$GW" | grep -q "dev $IFACE" || ok=0
ping -c3 -W2 -I "$IFACE" "$GW" >/dev/null 2>&1 || ok=0
ping -c2 -W3 -I "$IFACE" 1.1.1.1 >/dev/null 2>&1 || ok=0

if [ "$ok" = 1 ]; then
  systemctl stop pi-eth-rollback.timer
  log "OK: Ethernet-only works — rollback cancelled. address: $(ip -4 -br addr show $IFACE | awk '{print $3}')"
else
  log "FAILED: gateway/internet not reachable over $IFACE — the old configuration comes back within $TIMER_SECONDS s"
  exit 1
fi
