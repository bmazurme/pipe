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

## Failover — what is automated and what is not

`promote.sh` (on red) turns the replica into a read-write primary after you type `PROMOTE`. It is **only** the database half.
A full switch to red also needs, in this order:

1. Be sure white is really down (a promoted replica next to a living primary = two diverging databases).
2. `./promote.sh` on red.
3. Start the application against it on red: the bridge stack's `postgres` service must be the promoted node (`postgres-standby` under another name,
   or point `POSTGRES_HOST` of the backend at it), plus backend/frontend/Caddy on red. **Not prepared yet**: red has none of the arm64 images
   (`infra/bridge-pi/build-images.sh red`), none of the secrets (`~/.pipe/bridge.env`: JWT secrets and `CREDENTIALS_ENC_KEY` — copying them to red widens where
   they live; decide that on purpose), and no Caddy certificates (they are re-issued, but only once DNS/ports point there).
4. Router: forward TCP 80/443 to red (192.168.50.12) instead of white. DNS stays — the records point at the home address, not at a board.
5. Afterwards rebuild a replica (a new base backup, `setup-standby.sh` on the other board) or restore white from the backups, then go back deliberately.

This is the basis for the failover automation planned in docs/ha-dr-plan.md §8 (confirm-first watchdog); it is a runbook, not a button, until step 3 is prepared.

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
