# infra/bridge-pi — bridge on the Pi Swarm

Temporary primary site while Selectel is on hold (docs/ha-dr-plan.md). Core only: **Postgres, backend,
frontend, Caddy (TLS)**, all pinned to white (`bridge-primary=true` node label, local volumes, one backend —
it owns the schedulers and the Telegram long poll). worker and vpn-client are added after the first sign-in.

| Piece | Where |
|---|---|
| Images | built for arm64 on your Mac and loaded straight into white (`build-images.sh`), tag = commit id, no registry |
| Secrets | `~/.pipe/bridge.env` on white, mode 600 (`secrets.sh`) — never in chat or git. Back it up to the password manager: `CREDENTIALS_ENC_KEY` decrypts the vault/tokens stored in the database |
| Data | volumes `bridge_pgdata`, `bridge_bridge_uploads`, `bridge_caddy_data` (certificates) on white's NVMe |
| Entry | Caddy publishes 80/443 in host mode (real client addresses) and terminates TLS for `bridge.ntlstl.dev` / `api.bridge.ntlstl.dev` |
| LAN checks | `http://192.168.50.11:3300/api/v1/health` (backend), `:3305` (frontend) — the router forwards only 80/443 |

## Steps

```bash
# 1. images (on the Mac, clean git tree, Docker on arm64)
infra/bridge-pi/build-images.sh

# 2. on white
scp -r infra/bridge-pi pi@192.168.50.11:~/ && ssh -t pi@192.168.50.11
cd ~/bridge-pi
./secrets.sh init                 # DB password, JWT secrets, encryption key — generated here
./secrets.sh set EMAILS           # sign-in allowlist, comma-separated Yandex addresses — REQUIRED: without it anyone could register
./secrets.sh set YANDEX_ID        # the existing app at oauth.yandex.ru (callback https://api.bridge.ntlstl.dev/api/v1/oauth/yandex/redirect)
./secrets.sh set YANDEX_SECRET
./deploy.sh && ./deploy.sh status
```

## Going public (only when you decide to)

1. Router (ASUS): Virtual Server — TCP 80 → 192.168.50.11:80 and TCP 443 → 192.168.50.11:443 (delete the stale
   rule 80 → 192.168.50.91:32772 first; keep UPnP off).
2. reg.ru: A records for `bridge.ntlstl.dev` and `api.bridge.ntlstl.dev` → the home address (TTL 600). Check that
   the address is **static** — if the provider changes it, the records go stale (an update script via REG.API can
   follow). `ntlstl.dev` itself (the portfolio) stays as is until it is moved too.
3. `docker service scale bridge_caddy=1` on white. Caddy asks Let's Encrypt for the certificates (HTTP-01 on port
   80); `docker service logs bridge_caddy` shows progress. Keep it scaled to 0 until DNS points here, or the
   failed attempts count against Let's Encrypt's rate limit.
4. Sign in with Yandex → profile → «Способы входа» (GitHub appears once its secrets are set, see PR #221).

## worker + VPN client (stack `bridgew`)

Runs on green, separate from the core stack. The AI providers answer 403 from Russia (checked from the board), so the
worker's provider traffic goes out through an Xray client (HTTP proxy on its own network); the worker reaches bridge
over its public address like any other client.

```bash
infra/bridge-pi/build-worker-image.sh          # on the Mac: arm64 image → green, tag → white
# on white (ssh -t pi@192.168.50.11, cd ~/bridge-pi; scp the updated scripts first):
./secrets.sh set WORKER_BRIDGE_API_KEY         # bridge → Profile → Access → API keys (brk_…, shown once)
./secrets.sh set CLAUDE_CODE_OAUTH_TOKEN       # `claude setup-token` where you are logged in to Claude
./vless-to-xray.sh                              # paste your vless://… Reality link (hidden) → ~/.pipe/xray-client.json
./deploy-worker.sh && ./deploy-worker.sh status
```

The link comes from your VPN panel, from the VPN page in bridge (copy the connection link — note a fresh database has no
saved connections yet) or from a VPN app on your phone. It contains the server address, your client UUID and the Reality keys,
so treat it as a secret. (Hand-writing the file works too: `bridge/deploy/swarm/xray-client-config.example.json`.)

### A second worker on another board

A worker added in the UI (recommended — no bridge API key or Claude token touch any board at all). Run this from
**white** — `deploy-worker.sh` reads `~/.pipe/bridge.env` locally (`API_HOST`, …), and that file only exists there;
the placement constraint, not the host you run the command from, decides the new worker actually lands on the
other board:

```bash
ssh -t pi@192.168.50.11   # white — not the new board
cd ~/bridge-pi

OUT=~/.pipe/xray-client-bridgew2.json ./vless-to-xray.sh     # a fresh vless://… link — don't reuse the first worker's

WORKER_STACK=bridgew2 WORKER_NODE_HOSTNAME=ubuntu-red \
  ./deploy-worker.sh --managed ghcr stable
```

- `WORKER_STACK` (anything but `bridgew`) and `WORKER_NODE_HOSTNAME` (the new board's Swarm hostname — `docker node
  ls` lists them) scope everything to this one worker: its own `worker-mode`/`xray-client` files on disk, its own
  placement constraint, its own `worker_state` volume and Swarm services (`bridgew2_worker`, `bridgew2_vpn-client`,
  …) — the first worker, `~/.pipe/bridge.env`, and the core stack are untouched.
- Then: https://bridge.ntlstl.dev/worker?tab=workers → **Добавить** → copy the one-time code → from your
  **workstation** (not any board — `enroll-worker.sh` SSHes into the board itself, it never runs on one), naming
  both the stack and the new board's address (it defaults to green otherwise):
  `WORKER_STACK=bridgew2 infra/bridge-pi/enroll-worker.sh <code> 192.168.50.13` (white/red/blue/green are
  `.11`/`.12`/`.13`/`.14` — infra/pi/README.md has the full table). Watch it come up: `WORKER_STACK=bridgew2
  ./deploy-worker.sh status`.
- **Not kept up to date by `pipe-autodeploy`** — it only knows about the one `bridgew` stack today. A second one
  needs the `./deploy-worker.sh` command above run again by hand for each new release (`./deploy-worker.sh status`
  on the new board shows what it's currently running).
- A fresh vless:// link, not the first worker's: two Xray clients sharing one Reality client UUID is extra load on
  that one VPN connection for no reason — add a second connection on the VPN page (or your panel) instead.

If the worker's replies hang, check the tunnel first: `FINGERPRINT=firefox ./vless-to-xray.sh <link-or-json>` then
`./deploy-worker.sh`. Here the default `chrome` fingerprint was throttled by the network (≈80 % of connections stalled
in series; direct connects to the VPN server were fine) and `firefox` passed 48 of 48. `vpn-client` also uses
`endpoint_mode: dnsrr` — the Swarm virtual IP added no value for a single task.

**Worker added in the UI (no secrets in the stack).** `./deploy-worker.sh --managed [ghcr [tag]]` deploys `worker-managed-pi.yml` instead:
no bridge API key and no Claude token among the secrets — the worker keeps its own key in the `worker_state` volume, and its settings,
Claude tokens and provider API keys come from bridge (Worker page → Worker'ы / Ключи). Add the worker on that page, then, from your workstation,
`infra/bridge-pi/enroll-worker.sh <code>` hands it the one-time code (over stdin — nothing on a command line). Moving the existing worker:
add it on the page, `./deploy-worker.sh --managed ghcr stable`, `enroll-worker.sh <code>`, check it shows as idle, delete the old `pi-worker` row.

The three values become Docker secrets (encrypted in the Swarm raft store); `deploy-worker.sh` writes them to a 0700
temp directory and removes it on exit. The worker should then show up on bridge's Worker page as `pi-worker`.

## Telegram notifications

Telegram is blocked from here (direct connects time out), so the backend sends through the VPN client of the worker stack:
a shared overlay network `telegram-proxy-net` (created by the deploy scripts) holds only the backend and `vpn-client`, so the
worker stays isolated. Updates arrive by long polling — only one consumer per bot may poll.

```bash
# 1. create a bot in Telegram with @BotFather → its token; write to the bot once, then find your chat id (below)
./secrets.sh set TELEGRAM_BOT_TOKEN
./secrets.sh set TELEGRAM_CHAT_ID       # the ONLY chat the bot talks to and accepts commands from
./deploy.sh
```

Chat id: after you have written "hi" to the bot, open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser with
your VPN on — `"chat":{"id":123456789,…}`. (The page shows the token in the URL: do it on your own machine only.)

## GitHub: Improve and the repo webhook

Improve (issue → worker → PR, CI repairs) and the repo webhook need a token and a shared secret; unset, Improve answers
«GitHub не настроен» and every webhook delivery gets 503 (the top failure in the request log).

```bash
./secrets.sh set LOOP_GITHUB_TOKEN        # fine-grained, this repo only — permissions: bridge/README.md (LOOP_GITHUB_TOKEN row)
openssl rand -hex 32                       # copy the output …
./secrets.sh set GITHUB_WEBHOOK_SECRET    # … and paste it here
```

Then GitHub → the repo → Settings → Webhooks → Add webhook:

- Payload URL: `https://api.bridge.ntlstl.dev/api/v1/github/webhook`
- Content type: `application/json`
- Secret: the same value as `GITHUB_WEBHOOK_SECRET`
- Events: *Let me select individual events* → **Pull requests** and **Workflow runs**

Run `./deploy.sh`, then open the webhook's «Recent deliveries» (redeliver an old one if none is new): it should show **200**.
**503** = `GITHUB_WEBHOOK_SECRET` is not set in the backend (`./secrets.sh check`, then `./deploy.sh`); **401** = the secret on GitHub
differs from the stored one. `GITHUB_BASE_BRANCH` (default `main`) is optional.

## Dashboard page

bridge's Dashboard shows the Swarm cluster's node status and the last backup's age. The node tile needs nothing set —
it talks to the `docker-proxy` service (`bridge-pi.yml`, read-only `NODES=1` access to the Docker API, no secrets involved).
The backup tile reads `bridge-backups/LATEST` straight from Garage S3 and needs that bucket's own key:

```bash
sudo cat /etc/garage/keys/bridge-backups.env        # S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
./secrets.sh set BACKUP_S3_ENDPOINT                 # same S3_ENDPOINT value as above
./secrets.sh set BACKUP_S3_ACCESS_KEY_ID
./secrets.sh set BACKUP_S3_SECRET_ACCESS_KEY
./deploy.sh
```

(`BACKUP_S3_REGION`/`BACKUP_S3_BUCKET` default to `garage`/`bridge-backups` already — only set them with `./secrets.sh set`
if this board's key uses different ones.) Left unset, that tile just shows "not configured", same as a missing
`GITHUB_WEBHOOK_SECRET` above — not a deploy failure.

## Images from GHCR (no more loading from the Mac)

`.github/workflows/publish-images.yml` (manual: Actions → Publish images → Run workflow) builds the backend, frontend and worker
for amd64 **and** arm64 on native runners and publishes `ghcr.io/bmazurme/pipe-bridge-backend`, `pipe-bridge-frontend`, `pipe-worker`
tagged with the commit sha and `latest`. First publication makes the packages **private**; once, per package: GitHub → your profile →
Packages → the package → *Package settings* → *Danger Zone* → *Change visibility* → Public (the images hold no secrets: every value arrives
at runtime; `VITE_API_URL` in the frontend is a public address). Then the boards pull anonymously:

```bash
./deploy.sh ghcr [commit-sha|latest]          # backend + frontend (default tag: latest)
./deploy-worker.sh ghcr [commit-sha|latest]   # worker
```

A sha tag is reproducible (and what to roll back to); `latest` follows the newest publication. The local-image path
(`build-images.sh`, `./deploy.sh` without arguments) keeps working as the fallback when GitHub is unreachable.

## Operations

```bash
./deploy.sh status                                  # replicas + task states
docker service logs bridge_backend --tail 100
docker service update --force bridge_backend        # restart
docker service scale bridge_caddy=0                 # take the public entry down
```

- Update: `build-images.sh` (new tag) then `./deploy.sh` — the backend and frontend updates are start-first: the new task boots next to the old one and the old one stops only after the new one is healthy (a failing release is rolled back with the old one still serving), and Caddy holds requests for up to a minute (`lb_try_duration`) instead of answering 502 during the switch. Migrations therefore must stay additive: for those seconds the old backend runs on the migrated schema. Caddy itself is the one piece that still restarts (host-mode ports 80/443 cannot overlap) — only when the Caddyfile changes, for a couple of seconds.
- Backups: `infra/backup` (PR #223) with `DATABASE_URL=postgres://bridge:<password>@postgres:5432/ntlstl-db` and
  `PG_DUMP="docker run --rm --network bridge_internal postgres:16-alpine pg_dump"` — the `internal` network is
  attachable for exactly this. Until that timer is enabled there is **no backup of this database**.
- Garage S3 (PR #224) is not wired in yet: uploads live in the `bridge_uploads` volume on white (an S3 storage
  driver is the next code change).
- Not covered yet: warm standby on red (restore from the daily dump is the plan), `ntlstl.dev` (the portfolio).
