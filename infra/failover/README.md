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
That is scripted now:

```bash
# white is up again, its stack OFF (docker stack rm bridge — the fence already stops anything from redeploying it)
infra/failover/failback.sh --dry-run    # checks only
infra/failover/failback.sh              # asks you to type FAILBACK
```

It refuses unless red is the primary (out of recovery, `failover=active`), white answers and runs no bridge services, and white has no
`standby_pgdata` volume yet. It allows replication and creates the slot `standby_white` on red, takes a base backup of red's database into a **new**
volume on white, starts it as stack `bridgesw` and waits until white is streaming. White's old database volume (`bridge_pgdata`, the diverged
copy) is never touched — remove it yourself when you are sure. `failover=active` stays on red.

Not covered by the script (do them by hand, once white is a replica): the jobs that assume white is the primary — the backup/Garage/uploads timers
on white and red, and the auto-deploy — and `prepare-red.sh`'s counterpart if you want white ready to take over again. A planned switch back to
white later is the same failover in the other direction (`failover.sh` with the boards swapped, `I_KNOW_WHITE_IS_ALIVE=yes` after stopping red's stack).

## Rehearsal checklist (needs a window of about an hour; white switched off)

Before (white up, evening or weekend, nobody mid-task):
1. `AGE_IDENTITY=… infra/failover/prepare-red.sh --check` — red's encrypted secrets are current; `infra/standby/status.sh` — the replica streams, lag ≈ 0.
2. A fresh backup is there (`infra/backup`, Telegram "backup ok"); note the time.
3. Write down the last upload and the last Worker job (to compare afterwards); finish or stop running jobs.
4. Router admin open in a tab (Virtual Server rules for 80/443 → 192.168.50.11).

The switch:
5. Power white off (or pull its network) — `failover.sh` refuses while it answers.
6. `AGE_IDENTITY=… infra/failover/failover.sh --dry-run`, then the real run; type FAILOVER.
7. Router: forward 80/443 to 192.168.50.12. Wait for Caddy's certificates (1–2 minutes).
8. Check: `curl https://api.bridge.ntlstl.dev/api/v1/health`, sign in, open the last parcel and upload a new file, send a chat message (worker on green answers), Telegram says "Переключение выполнено".
9. Compare with step 3: nothing missing except what the README says you may lose.

The way back:
10. Power white on; **do not** start its stack (`docker stack ls` on white shows nothing named bridge — the fence refuses a deploy).
11. `infra/failover/failback.sh --dry-run`, then the real run; type FAILBACK; confirm white streams.
12. Router stays on red (red is the primary now). Re-check the site once more and re-run `prepare-red.sh` if secrets changed.

Stop and look if: `failover.sh` refuses (read why, do not force); the API is not healthy in 5 minutes (`docker service ps bridge_backend` on red);
Caddy cannot get certificates (are 80/443 really forwarded?).

## Rehearsal status

Never run on the real boards with white switched off — the scripts are tested against fakes (`test.sh` for the failover, `test-failback.sh` for the
way back: refuses on a replica that is not promoted, a missing fence label, a white that still runs services or already has a replica volume; never
touches white's own stack or old volume; the password never reaches a command line). The checklist above is the rehearsal.

## Tests

`test-failback.sh` runs the same way (`bash /r/infra/failover/test-failback.sh`, no rsync needed). `bash` in a Linux container for `test.sh`: `docker run --rm -v "$PWD":/r debian:bookworm-slim bash -c 'apt-get update -qq && apt-get install -y -qq rsync && bash /r/infra/failover/test.sh'`
