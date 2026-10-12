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
install -m 600 /path/to/xray-client.json ~/.pipe/xray-client.json   # bridge/deploy/swarm/xray-client-config.example.json
./deploy-worker.sh && ./deploy-worker.sh status
```

The three values become Docker secrets (encrypted in the Swarm raft store); `deploy-worker.sh` writes them to a 0700
temp directory and removes it on exit. The worker should then show up on bridge's Worker page as `pi-worker`.

## Operations

```bash
./deploy.sh status                                  # replicas + task states
docker service logs bridge_backend --tail 100
docker service update --force bridge_backend        # restart
docker service scale bridge_caddy=0                 # take the public entry down
```

- Update: `build-images.sh` (new tag) then `./deploy.sh` — the backend update is stop-first on purpose (one instance).
- Backups: `infra/backup` (PR #223) with `DATABASE_URL=postgres://bridge:<password>@postgres:5432/ntlstl-db` and
  `PG_DUMP="docker run --rm --network bridge_internal postgres:16-alpine pg_dump"` — the `internal` network is
  attachable for exactly this. Until that timer is enabled there is **no backup of this database**.
- Garage S3 (PR #224) is not wired in yet: uploads live in the `bridge_uploads` volume on white (an S3 storage
  driver is the next code change).
- Not covered yet: warm standby on red (restore from the daily dump is the plan), `ntlstl.dev` (the portfolio).
