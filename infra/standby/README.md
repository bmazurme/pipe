# infra/standby — warm standby of the bridge Postgres (replica on red)

Streaming replication from the primary (`bridge_postgres` on white) to a hot standby on red. It answers a dead white
(disk, board, power) in minutes instead of "restore last night's dump": RPO is seconds, not a day. The daily encrypted
backups stay — a replica copies mistakes too (a dropped table is dropped on both), only a backup brings that back.

| | |
|---|---|
| Primary | white, service `bridge_postgres` (Postgres 16), role `replicator` (REPLICATION only), allowed in `pg_hba.conf` from the overlay `bridge_internal` |
| Replica | red, stack `bridgesb`, service `postgres-standby`, volume `standby_pgdata` (local NVMe), joins `bridge_internal`, nothing published |
| Transport | asynchronous streaming over the Swarm overlay network (unencrypted overlay on the home LAN) |
| Slot | physical slot `standby_red`: the primary keeps the WAL the replica still needs; `max_slot_wal_keep_size = 4GB` caps it, so a dead replica can never fill white's disk (at the price of needing a rebuild after a very long outage) |
| Secret | `REPLICATION_PASSWORD`: generated on white in `~/.pipe/bridge.env`, copied to red's `~/.pipe/standby.env` (mode 600) over an ssh pipe; also inside the replica's `postgresql.auto.conf` |

## Set up (done 2026-10-12)

```bash
# on white
scp -r infra/standby pi@192.168.50.11:~/ && ssh pi@192.168.50.11 'cd ~/standby && ./setup-primary.sh'
# the password moves white → red without being printed
ssh pi@192.168.50.11 'grep "^REPLICATION_PASSWORD=" ~/.pipe/bridge.env' | ssh pi@192.168.50.12 'mkdir -p ~/.pipe && umask 077 && cat > ~/.pipe/standby.env'
# on red: base backup + start
scp -r infra/standby pi@192.168.50.12:~/ && ssh pi@192.168.50.12 'cd ~/standby && ./setup-standby.sh'
ssh -t pi@192.168.50.12 'sudo bash ~/standby/install-check.sh'   # health check every 5 minutes
infra/standby/status.sh                                          # from the workstation: streaming? lag?
```

Verified: row counts equal on both; the worker's heartbeat (a write every ~10 s) arrives on the replica identically;
the replica rejects writes; a promotion rehearsal on a throwaway copy worked (and the real replica was untouched).

## Watching it

- `infra/standby/status.sh` (workstation): replica attached + `streaming`, lag in bytes, slot, seconds since the last replayed transaction; exit 1 if not streaming or lagging > 16 MB.
- `pipe-standby-check.timer` on red (every 5 min): `check.sh` asks the replica's WAL receiver (status `streaming`, last message from the primary < 180 s — keepalives keep it fresh even when idle). Failure → `systemctl --failed`, the journal, and `ALERT_CMD` in `/etc/pipe-standby.env`.

## Failover

`promote.sh` (on red, after you type `PROMOTE`, or `PROMOTE_CONFIRMED=yes` from the script below) is only the database half. The whole switch —
the encrypted secrets, the uploads, the roles and the **fence** that keeps white from reviving its old database, the deploy on red, the router
step — is `infra/failover` (start with its README): `prepare-red.sh` while white is up, `failover.sh` from your workstation when it is gone.

## Rebuilding / removing the replica

```bash
ssh pi@192.168.50.12 'docker stack rm bridgesb; sleep 10; docker volume rm standby_pgdata'     # forgets the replica's data
ssh pi@192.168.50.12 'cd ~/standby && ./setup-standby.sh'                                      # a fresh base backup
# the slot lives on the primary: if you stop for good, drop it or the primary keeps WAL (up to the 4 GB cap):
#   docker exec <bridge_postgres container> psql -U bridge -d ntlstl-db -c "select pg_drop_replication_slot('standby_red')"
```

## Rotating the replication password

`./setup-primary.sh` re-applies the (new) `REPLICATION_PASSWORD` from `~/.pipe/bridge.env` to the role; then update red's `~/.pipe/standby.env`
and the `primary_conninfo` in the replica's volume (simplest: rebuild the replica).
