# infra/garage — S3 on the Pi boards

[Garage](https://garagehq.deuxfleurs.fr/) (S3-compatible, arm64) across the four Pis — the file mirror and
backup store from docs/ha-dr-plan.md §6.3. Version pinned in `node.sh` (`dxflrs/garage:v2.4.1`).

| | |
|---|---|
| Nodes | white .11, red .12, blue .13, green .14 — one **zone** per board, `replication_factor = 3`, `consistency_mode = consistent` |
| Capacity | 50 GB per board (`CAPACITY`) → **≈ 62 GiB usable** at three copies; widen later with `garage layout assign` + `apply` |
| Endpoints | S3 API `http://<any board>:3900`, region `garage`, path-style. RPC `:3901` (secret-protected, LAN only). Admin API `127.0.0.1:3903` on each board |
| Data | `/srv/garage/{meta,data}` on the NVMe (mode 700); container `garage`, host network, `restart: unless-stopped` |
| Buckets | `bridge-uploads` (mirror of bridge's files), `bridge-backups` (copies of the DB dumps) — each with its own key |
| Tolerates | one board down: reads and writes keep working (quorum 2 of 3). Two boards down: writes stop |

```bash
infra/garage/cluster.sh init      # idempotent: install each node, connect, layout, buckets + keys
infra/garage/cluster.sh status
```

## Secrets

Never leave the boards: `/etc/garage/rpc_secret` (same on all), `/etc/garage/admin_token` (own per board),
and the S3 keys in **`/etc/garage/keys/<bucket>.env` on white (192.168.50.11), mode 600**. Read a key there
when configuring a client:

```bash
ssh -t pi@192.168.50.11 'sudo cat /etc/garage/keys/bridge-uploads.env'   # S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
```

Back up `/etc/garage/rpc_secret` into the password manager — losing it on all boards means rebuilding the cluster.

## Using it

Any S3 client works (`aws s3`, `rclone`, bridge's future S3 storage driver). A client should be given the list of
boards and fall back to the next one on a connection error, or use a DNS name with four A records — a floating
IP (keepalived) is the next step if a single address is needed.

```bash
rclone config create pi s3 provider Other endpoint http://192.168.50.11:3900 region garage \
  access_key_id … secret_access_key …          # then: rclone copy ./dump pi:bridge-backups
```

Mirror from the primary (the Pi pulls, so a compromised primary cannot reach the copies):
`rclone sync primary:bridge-uploads pi:bridge-uploads`, daily.

## Operations

```bash
docker exec garage /garage status                 # nodes, up/down
docker exec garage /garage stats                  # resync queue, errors
docker exec garage /garage bucket info bridge-uploads
docker exec garage /garage repair --all-nodes --yes tables   # after a long outage, if resync lags
```

- Replacing a board: new board → `cluster.sh`-style `node.sh`, `garage node connect`, `layout assign --replace <old id>`, `apply`.
- Watch NVMe wear (`nvme smart-log`) and free space; Garage does not stop at its `CAPACITY`, the layout only balances by it.
- Metadata is snapshotted every 6 h (`metadata_auto_snapshot_interval`) into `meta/snapshots`.
- Verified on 2026-10-12: write via one board, read via another with matching checksum; one board stopped →
  write, read and read of older objects still succeed; the board rejoined and resynced.
