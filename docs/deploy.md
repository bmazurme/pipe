# Ports, local dev, secrets & env vars

Part of [ECOSYSTEM.md](../ECOSYSTEM.md)'s cross-cutting detail — see that
file for the full index.

## Ports & local dev

| Service | Port | Notes |
|---|---|---|
| bridge backend | `3002` | dev default (`PORT` in `bridge/apps/backend/.env`) |
| bridge frontend | `5173` | Vite dev server |
| bridge Postgres | `5432` | via `docker compose up -d postgres` |
| reports server | `4000` | dev default (`PORT` in `reports/packages/server/.env`) |
| reports client | `5174` | Vite dev server — deliberately not `5173`, since bridge's frontend already claims that default; running both locally at once was already a real collision this avoids |
| sync | — | CLI only, no ports |
| worker | — | outbound poller only, no listening port |

**bridge production** (Docker Swarm), published ports `3300`/`3305`:
chosen because `3000`/`3005` (places), `3400`/`3405` (tools), `3450`/`3455`
(notes), `3600`/`3605` (rain), and `8080` (pgadmin) were already taken on the
target node at setup time (carried over from `bridge/README.md` so the
reasoning isn't lost — check `docker ps`/`docker stack ls` on any new node
before reusing these).

## Secrets & env vars

**bridge** (`bridge/apps/backend/.env`, production values as GitHub Actions
secrets — see `bridge/README.md` for the full table): `POSTGRES_HOST/PORT/USER/PASSWORD/DB`,
`JWT_SECRET`, `REFRESH_JWT_SECRET`, `YANDEX_ID`/`YANDEX_SECRET` (OAuth),
`BRIDGE_YANDEX_REDIRECT`, `BRIDGE_TARGET_URL`, `COOKIE_DOMAIN` (must be the
exact backend host, not a shared parent domain — the cookie is named
`bridgeRefreshToken` specifically because a shared `COOKIE_DOMAIN` with
sibling apps on the same parent domain caused a name collision before),
`EMAILS` (optional allowlist), `CORS_ORIGINS`, `TIME_EXPORT_API_KEY`/`TIME_EXPORT_USER_ID`
(optional ntlstl.time integration), `CREDENTIALS_ENC_KEY` (base64, 32 raw
bytes — AES-256-GCM key encrypting `ClaudeCredential.token` and
`VpnConnection.panelApiToken` at rest, see
`src/crypto/encrypted-column.transformer.ts`; required, no dev fallback,
same as `JWT_SECRET`). `/api/v1/vpn/*` (browser-session only —
the only part of bridge's backend that calls out to third-party APIs):
`BRIDGE_GITHUB_TOKEN` (a PAT scoped to this repo only — Actions secrets:
write, Actions: write — lets the VPN page push worker provider keys and
trigger a redeploy; named `BRIDGE_GITHUB_TOKEN` because `GITHUB_TOKEN` is a
reserved name Actions auto-populates with a different, more limited token).
The VPN panel(s) themselves are **not** env vars — each is a row in the
`vpn_connections` table (`name`/`panelUrl`/`panelApiToken`/`serverAddress`,
see `VpnConnectionsService`), added from the VPN page's "Доступные VPN"
form (`POST /api/v1/vpn/connections`); exactly one is ever `isActive`, and
that's the one `GET /api/v1/vpn/status`, `POST /api/v1/vpn/sync` (rebuilds
worker's `VPN_CLIENT_CONFIG`), and the Worker page's VPN dropdown
(`POST /api/v1/vpn/connections/:id/activate`) all act on — each row also
has its own on-demand status check and `vless://` connection link
(`GET /api/v1/vpn/connections/:id/status` / `.../connection-link`), not
just the active one. A Claude usage-limits widget was tried here
(`GET /api/v1/vpn/claude-usage`, backed by a self-refreshing credential from
Anthropic's undocumented `console.anthropic.com/v1/oauth/token`) and
removed — that endpoint returns a deliberate `403 forbidden: "Request not
allowed"` for refresh attempts from a server/datacenter context, not just a
bad token, so it can't be made to work from bridge's backend.
`POST /api/v1/vpn/provision` (the page's "Новый VPN-сервер" form) pushes
`VPN_PROVISION_HOST`/`VPN_PROVISION_SSH_USER`/`VPN_PROVISION_SSH_PASSWORD`
(transient — overwritten on every run) and dispatches
`.github/workflows/provision-vpn-server.yml`, which SSHes in and installs
AdGuard Home + 3x-ui (`bridge/deploy/provision-vpn-server.sh`), creating the
initial Reality inbound — it no longer pushes the resulting panel URL/token
as secrets (bridge doesn't read those anymore); add the provisioned panel
by hand via "Доступные VPN" once the workflow's own log prints it.
Deploy-only: `YC_SA_JSON_CREDENTIALS`, `CR_*` (registry, including
`CR_WORKER_IMAGE`), `SWARM_*` (SSH access), `BACKEND_PUBLISHED_PORT`/`FRONTEND_PUBLISHED_PORT`/`HOST`,
`WORKER_BRIDGE_API_URL`/`WORKER_BRIDGE_API_KEY`/`WORKER_CLAUDE_CODE_OAUTH_TOKEN`/`WORKER_OPENAI_API_KEY`/`WORKER_DEEPSEEK_API_KEY`/`WORKER_QWEN_API_KEY`
(worker's own runtime secrets — as of IMPROVEMENTS_TECH.md 1.6, delivered as
Docker/Swarm secrets rather than plain service env; see
`worker/src/secrets.ts` and `bridge/deploy/swarm/bridge-stack.yml`'s own
`secrets:` block), `VPN_CLIENT_CONFIG` (worker's Xray client config.json,
rebuildable from the panel via the VPN page rather than hand-maintained).

**reports** (`SettingsType`, stored in the gitignored
`reports/packages/server/src/settings/settings.json`, edited from the
client's Settings page): `gitlabUrl`, `privateToken` (GitLab PAT),
`bridgeApiUrl`, `bridgeApiKey` (the unrelated `TIME_EXPORT_API_KEY` shared
secret), `bridgeStorageApiKey` (personal bridge API key, preferred — see
[auth.md](auth.md)), `bridgeRefreshToken` (fallback: pasted from a
bridge browser session cookie).

**sync** (`sync/.sync-credentials.json`, `sync-cli login`/`login-gitlab`/`login-api-key`,
gitignored): `refreshToken` (bridge, fallback), `apiKey` (bridge, preferred
— see [auth.md](auth.md)), `gitlabToken` (issue mode only).
Per-project encryption key pairs live under `sync/keys/` (also gitignored).

**worker** (env vars only, no config file — see `worker/README.md`):
`BRIDGE_API_URL`, `BRIDGE_API_KEY` (a personal bridge API key — the only
auth method worker supports, see [auth.md](auth.md); there's no
refresh-token fallback here, unlike sync/reports), plus one API key per AI
provider it's meant to run (`OPENAI_API_KEY`, `DEEPSEEK_API_KEY`,
`QWEN_API_KEY`) — sonnet/opus need no key here at all, for **either** jobs
or chat: both run through the same separately-installed, separately-logged-in
`claude` CLI (`CLAUDE_CODE_OAUTH_TOKEN`, a Claude.ai subscription, not a
billed API key) — this inherited env var is only the fallback now: a Worker
job can instead pick one of several named Claude credentials stored in
bridge's own DB (`POST /api/v1/worker/claude-credentials`, managed from the
Worker page), in which case bridge resolves and hands worker the actual
token value on claim (`RemoteJob.claudeToken`), overriding the inherited one
for just that job's `claude` invocation — see `worker/src/modelRunners/claudeRunner.ts`.
Optional `WORKER_PROXY_URL` (an HTTP — not SOCKS5, neither
the `claude` CLI nor undici's `ProxyAgent` support that — proxy for reaching
AI providers from behind a geo-restricted host; scoped to provider calls
only, never bridge's own API). Any of worker's five secrets above can
alternatively be supplied as `<NAME>_FILE=/path/to/file` instead of a plain
value (`worker/src/secrets.ts`) — what Docker/Swarm secrets use under the
hood, but a plain mechanism usable outside Swarm too.
