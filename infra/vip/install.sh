#!/usr/bin/env bash
#
# Installs keepalived on THIS board so the bridge stack has one floating address (default 192.168.50.10).
# The router forwards 80/443 to that address once; whichever board runs Caddy answers on it — a failover then needs no
# router change. Run on every board that can run Caddy (white and red), as the pi user:
#
#   sudo infra/vip/install.sh --peer 192.168.50.12 [--vip 192.168.50.10] [--dry-run]     # on white
#   sudo infra/vip/install.sh --peer 192.168.50.11 [--vip 192.168.50.10] [--dry-run]     # on red
#
# Idempotent. It refuses a VIP that already answers (someone else owns it). It does NOT touch the router, the stack or
# the data — it only installs keepalived and its config.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
VIP=192.168.50.10; PEERS=(); VRID=51; PREFIX=24; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --vip) VIP="$2"; shift 2;;
    --peer) PEERS+=("$2"); shift 2;;
    --vrid) VRID="$2"; shift 2;;
    --prefix) PREFIX="$2"; shift 2;;
    --dry-run) DRY=1; shift;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done
[ ${#PEERS[@]} -gt 0 ] || { echo "--peer <the other board's address> is required" >&2; exit 2; }
[ "$DRY" = 1 ] || [ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }

IFACE="${IFACE:-$(ip -o -4 route get "${PEERS[0]}" | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -1)}"
SELF="${SELF:-$(ip -o -4 route get "${PEERS[0]}" | sed -n 's/.* src \([^ ]*\).*/\1/p' | head -1)}"
[ -n "$IFACE" ] && [ -n "$SELF" ] || { echo "cannot find this board's interface/address towards ${PEERS[0]}" >&2; exit 1; }
[ "$SELF" != "$VIP" ] || { echo "the VIP equals this board's own address" >&2; exit 1; }

# A VIP that already answers is somebody's — unless it is us already holding it.
if ! ip -o -4 addr show dev "$IFACE" | grep -q " $VIP/"; then
  if ping -c 2 -W 1 "$VIP" >/dev/null 2>&1; then
    echo "REFUSED: $VIP already answers on the network — pick an address nobody uses (outside the router's DHCP pool)." >&2
    exit 1
  fi
fi

conf="$(sed -e "s#@IFACE@#$IFACE#g" -e "s#@VRID@#$VRID#g" -e "s#@SELF@#$SELF#g" -e "s#@VIP@#$VIP#g" -e "s#@PREFIX@#$PREFIX#g" \
  -e "s#@PEERS@#$(printf '%s\\n        ' "${PEERS[@]}" | sed 's/\\n        $//')#" "$HERE/keepalived.conf.tmpl")"

if [ "$DRY" = 1 ]; then
  echo "interface $IFACE, this board $SELF, peers ${PEERS[*]}, VIP $VIP/$PREFIX"
  echo "--- /etc/keepalived/keepalived.conf would be:"; echo "$conf"; exit 0
fi

command -v keepalived >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq keepalived; }
install -m 755 -o root -g root "$HERE/vip-check-caddy" /usr/local/bin/vip-check-caddy
install -m 755 -o root -g root "$HERE/vip-notify" /usr/local/bin/vip-notify
mkdir -p /etc/keepalived
printf '%s\n' "$conf" > /etc/keepalived/keepalived.conf.new
keepalived -t -f /etc/keepalived/keepalived.conf.new >/dev/null 2>&1 || { echo "keepalived rejected the generated config" >&2; rm -f /etc/keepalived/keepalived.conf.new; exit 1; }
mv /etc/keepalived/keepalived.conf.new /etc/keepalived/keepalived.conf
systemctl enable keepalived >/dev/null 2>&1
systemctl restart keepalived
echo "keepalived running on $SELF ($IFACE); VIP $VIP goes to the board that runs Caddy. Check: ip -4 addr show dev $IFACE | grep $VIP"
