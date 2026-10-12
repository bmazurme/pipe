#!/usr/bin/env bash
#
# Installs one Garage S3 node (run as root on the Pi; cluster.sh does this for every board):
#   - /etc/garage/{rpc_secret,admin_token}   must already exist (cluster.sh creates and distributes them)
#   - /etc/garage.toml                        from the settings below
#   - container `garage` (host network, restart unless-stopped), data under /srv/garage
# Idempotent: re-running recreates the container with the current settings; data is kept.
set -euo pipefail

IMAGE="${GARAGE_IMAGE:-dxflrs/garage:v2.4.1}"
DATA_DIR="${DATA_DIR:-/srv/garage}"
IFACE="${IFACE:-eth0}"
REPLICATION="${REPLICATION:-3}"
NODE_IP="${NODE_IP:-$(ip -4 -o addr show dev "$IFACE" | awk '{print $4}' | cut -d/ -f1 | head -1)}"
[ -n "$NODE_IP" ] || { echo "no IPv4 address on $IFACE" >&2; exit 1; }
for f in /etc/garage/rpc_secret /etc/garage/admin_token; do
  [ -s "$f" ] || { echo "missing $f" >&2; exit 1; }
done

install -d -m 700 "$DATA_DIR/meta" "$DATA_DIR/data"

cat > /etc/garage.toml <<CONF
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "lmdb"
metadata_auto_snapshot_interval = "6h"

replication_factor = $REPLICATION
consistency_mode = "consistent"

# Nodes talk to each other here (protected by rpc_secret); only the LAN can reach it.
rpc_bind_addr = "0.0.0.0:3901"
rpc_public_addr = "$NODE_IP:3901"
rpc_secret_file = "/etc/garage/rpc_secret"

[s3_api]
s3_region = "garage"
api_bind_addr = "0.0.0.0:3900"

# Administration stays on the board itself.
[admin]
api_bind_addr = "127.0.0.1:3903"
admin_token_file = "/etc/garage/admin_token"
CONF
chmod 600 /etc/garage.toml

docker pull -q "$IMAGE" >/dev/null
docker rm -f garage >/dev/null 2>&1 || true
docker run -d --name garage --restart unless-stopped --network host \
  -v /etc/garage.toml:/etc/garage.toml:ro \
  -v /etc/garage:/etc/garage:ro \
  -v "$DATA_DIR/meta":/var/lib/garage/meta \
  -v "$DATA_DIR/data":/var/lib/garage/data \
  "$IMAGE" >/dev/null

for _ in $(seq 1 30); do
  docker exec garage /garage status >/dev/null 2>&1 && break
  sleep 1
done
echo "garage up on $NODE_IP:3901 (S3 :3900), node id: $(docker exec garage /garage node id -q 2>/dev/null | cut -c1-16)…"
