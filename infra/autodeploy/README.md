# infra/autodeploy — the Pis follow the newest stable release

Merge to `main` → the boards run the new version by themselves, **pull model**: nothing is pushed to the Pi, no
self-hosted runner in a public repository, no inbound access. white looks at GHCR every 5 minutes.

```
merge to main
  └─ .github/workflows/publish-images.yml (automatic when app / worker / protocol / lockfile / infra/bridge-pi change)
       builds backend, frontend, worker for amd64+arm64, publishes <sha> + latest,
       and only when ALL THREE are out moves the tag `stable`
            └─ white, pipe-autodeploy.timer (every 5 min): autodeploy.sh
                 new `stable` (3 image digests + commit) ≠ deployed?
                   fetch the stack files of that commit → ./deploy.sh ghcr stable → ./deploy-worker.sh ghcr stable
                   wait for every service at its replica count + API `database: true`
                   ✓ record + message      ✗ roll back the touched services, restore the old stack files, remember the failure
```

## What is deployed, what is not

- **Deployed automatically:** the backend, frontend and worker images (the three together — `stable` only moves once all three
  exist, so a new backend never meets an old frontend) and the declarative stack files of the same commit
  (`infra/bridge-pi/bridge-pi.yml`, `worker-pi.yml`, `worker-managed-pi.yml`, `Caddyfile`). Which worker kind is redeployed is
  the one `deploy-worker.sh` last ran as (`--managed` / `--legacy`, remembered in `~/.pipe/worker-mode`) — a board running a UI-added
  worker keeps it across releases. Update `deploy-worker.sh` on the board (`scp`) before relying on that.
- **Not updated automatically, on purpose:** the shell scripts in `~/bridge-pi` (`deploy.sh`, `deploy-worker.sh`,
  `secrets.sh`) and this script. They run as the board's user; a merge to main may change what the stack runs, but
  should not silently change what runs on the host. Changing them is a manual `scp` (rare).
- **Never touched:** `~/.pipe/*.env` (the secrets), volumes, Postgres, Garage, the replica on red, `postgres`/`caddy` images
  other than through the stack file.

## Safety

- a release that fails the health check is rolled back (`docker service rollback` for exactly the services this deploy changed) and is **not retried
  every five minutes**: it is remembered as failed until a newer release appears;
- if **Swarm itself** already rolled the backend back (`failure_action: rollback` in the stack), the script notices the running images are
  not the release's, records the failure, and does *not* roll back again — that would go forward to the bad version;
- registry/GitHub unreachable, a missing `stable` tag, an empty or wrong stack file → nothing happens (quietly or with a message);
- database migrations run forward with the new backend and are **not** rolled back: keep them additive.

## Install / use

```bash
scp -r infra/autodeploy pi@192.168.50.11:~/ && ssh -t pi@192.168.50.11 'sudo bash ~/autodeploy/install.sh'
ssh pi@192.168.50.11 '/usr/local/lib/pipe-autodeploy/autodeploy.sh status'     # deployed / failed / published release + the services
ssh pi@192.168.50.11 'sudo journalctl -u pipe-autodeploy -n 30 --no-pager'     # what it did
ssh -t pi@192.168.50.11 'sudo systemctl disable --now pipe-autodeploy.timer'   # stop following main; stacks stay as they are
```

A failed deploy leaves the unit `failed` (`systemctl --failed`). Messages (deployed / rolled back) go to Telegram through `NOTIFY_CMD`
(`/etc/pipe-autodeploy.env`; `infra/notify` sets it up).

Pausing for a manual deployment: disable the timer, deploy by hand (`./deploy.sh ghcr <sha>`), enable it again — the script then sees
the deployed digests differ from `stable` only if `stable` really moved.

## Tests

`test.sh` — 31 checks against fake `curl`/`docker`/deploy scripts: up to date, new release, unhealthy → rollback of exactly the touched
services and the stack files, a failed release not retried, a newer one tried, Swarm's own rollback, a failing deploy script, registry down,
missing tag, broken stack file, `status`:

```bash
docker run --rm -v "$PWD":/r debian:bookworm-slim bash -c 'apt-get update -qq && apt-get install -y -qq python3 && bash /r/infra/autodeploy/test.sh'
```
