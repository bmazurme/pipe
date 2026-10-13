# infra/failover — white is gone: red takes over the whole stack

`infra/standby` keeps a hot copy of the database on red. This is the rest: the application, the files, the secrets, the roles.
It is a **runbook with scripts you start by hand** — deliberately not automatic (you asked for a manual confirmation, and a
promoted replica next to a living primary is worse than an outage).

```
infra/failover/prepare-red.sh        while white is UP — gets red ready (once; again after a secret changes)
infra/failover/failover.sh           when white is GONE — from your workstation, with your age key
   └─ failover-red.sh (runs on red)  promote → uploads → roles + fence → deploy → health → Telegram
you: router 80/443 → red             the one step no script can do for you
```

## What is ready on red (`prepare-red.sh`, done 2026-10-13)

| Piece | Where on red | Note |
|---|---|---|
| Secrets | `~/.pipe/bridge.env.age` | white's `bridge.env` **encrypted** with the age key the backups use — JWT secrets and `CREDENTIALS_ENC_KEY` are not at rest in plain text on a second board. Decrypted only by `failover.sh`, with **your private key** |
| Database | stack `bridgesb`, volume `standby_pgdata` | the streaming replica (`infra/standby`) |
| Uploads | `/srv/uploads-mirror/current` | pulled daily from white (`infra/backup/uploads-pull.sh`); also in the Garage bucket `bridge-uploads` |
| Stack | `~/bridge-pi/*` (scripts, `bridge-pi.yml`, `worker-pi.yml`, `Caddyfile`) | the same files white uses |
| Images | local, refreshed daily 05:30 (`pipe-prepull.timer`) | GHCR `:stable` ×3, postgres, caddy, xray — a failover does not wait for downloads |
| Worker + VPN | stay on green | untouched: the worker reaches bridge by its public address, which follows the router |

`prepare-red.sh --check` says whether red's encrypted copy is still current (re-run `prepare-red.sh` after you change a secret);
`AGE_IDENTITY=… prepare-red.sh --verify` proves it decrypts with your key. **Do the `--verify` once now, with your key** — an encrypted
copy you cannot decrypt is no copy.

## The failover

Preconditions you check yourself: white is really down (power, network, dead NVMe) — not just slow; a Swarm quorum remains
(white, red, blue are managers: any two of them); you have your age private key at hand.

```bash
AGE_IDENTITY=~/Documents/pipe-backup-key.txt infra/failover/failover.sh --dry-run    # checks everything, changes nothing
AGE_IDENTITY=~/Documents/pipe-backup-key.txt infra/failover/failover.sh              # asks you to type FAILOVER
```

`failover.sh` **refuses** while white answers ping or ssh (`I_KNOW_WHITE_IS_ALIVE=yes` is the only way past, for a planned switch you have
prepared by switching white's stack off yourself), shows how stale the replica is (the data you can lose, plus what white wrote after its
last message), decrypts the secrets with your key straight onto red (mode 600), and runs `failover-red.sh` there:

1. **promote** the replica to a read-write primary;
2. **restore the uploads** from `/srv/uploads-mirror` into the `bridge_uploads` volume (only into an empty volume);
3. **roles and fence** — red gets `bridge-primary=true` and `failover=active`, the label comes off white. While `failover=active` sits on a
   node, `deploy.sh`, `deploy-worker.sh` and the auto-deploy **refuse to run on any other node**: white, when it comes back, cannot
   redeploy the stack and revive its old, diverged database;
4. **deploy** the stack on red from GHCR with `POSTGRES_HOST=postgres-standby POSTGRES_REPLICAS=0` (the database is the promoted replica;
   the stack's own `postgres` service stays at zero so the old primary can never start);
5. **wait** for the API to report a healthy database, and message you on Telegram.

Then yours — **unless the floating address is installed (`infra/vip`): then the address follows Caddy to red by itself and there is nothing to do** — **router (ASUS) → Virtual Server: forward TCP 80 and 443 to 192.168.50.12.** DNS does not change (the records point at the home
address). Caddy re-issues the certificates once the ports reach red (HTTP-01; a minute or two, then the site is on HTTPS again).

What you lose: writes that had not reached the replica (seconds, usually none), and uploads since the last daily copy (≤ 1 day).
What is **not** carried over: Caddy's certificates (re-issued), the worker's in-flight jobs (they fail and can be started again).

## Going back (or not)

You do not have to go back. The simplest recovery is the symmetric one: **red stays the primary and white becomes its replica.**
1. Bring white up with its stack *off* (the fence guarantees nothing deploys); move its old `bridge_pgdata` aside (it is the diverged copy — keep it until you are sure).
2. On red, allow replication from the overlay and make a slot for white (the role/`pg_hba`/slot steps of `infra/standby/setup-primary.sh`, run against red's database);
   take a base backup into a fresh volume on white and start it as a standby (`infra/standby/setup-standby.sh` with the nodes swapped).
3. Remove `failover=active` only when the new roles are settled (`docker node update --label-rm failover red`), and re-run `prepare-red.sh`'s
   counterpart for white if you want the same readiness the other way round.

A planned switch back to white later is the same failover in the other direction. These steps are not scripted yet — they are rare, and the
first time is worth doing with your eyes on it.

## Rehearsal

Never rehearsed on the real boards with white switched off — the scripts are tested against fakes (`test.sh`, 31 checks: refuses on a living
white, on a missing key, on a wrong confirmation, on unprepared red; order promote → fence → deploy; uploads restored without overwriting;
idempotent re-run). Plan one when white can be off for half an hour: power white off, `failover.sh --dry-run`, then the real run, then check
the site through the router, then follow "Going back". Until then treat the first real run as the rehearsal and keep this file open.

## Tests

`bash` in a Linux container: `docker run --rm -v "$PWD":/r debian:bookworm-slim bash -c 'apt-get update -qq && apt-get install -y -qq rsync && bash /r/infra/failover/test.sh'`
