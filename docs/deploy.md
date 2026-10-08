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
`EMAILS` (optional allowlist), `CORS_ORIGINS`,
`CREDENTIALS_ENC_KEY` (base64, 32 raw
bytes — AES-256-GCM key encrypting `ClaudeCredential.token`,
`VpnConnection.panelApiToken` and `Secret.value` at rest, see
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
`bridgeApiUrl`, `bridgeApiKey` (a personal bridge API key for the `time` endpoints), `bridgeStorageApiKey` (personal bridge API key, preferred — see
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

### Self-improvement loop

Variables added for the self-improvement loop (see
[SELF_IMPROVEMENT_PLAN.md](../SELF_IMPROVEMENT_PLAN.md)); meanings are
carried over from `bridge/README.md` and `reports/README.md`.

**bridge backend** (`bridge/apps/backend/.env`, production values as GitHub
Actions secrets):
- `TELEGRAM_BOT_TOKEN` — token of the bot that sends the loop's notifications; optional.
- `TELEGRAM_CHAT_ID` — the only chat the bot talks to and accepts commands from; optional.
- `TELEGRAM_WEBHOOK_SECRET` — the `secret_token` passed to `setWebhook` for `POST /api/v1/telegram/webhook` (`/status`, `/help`); empty means the endpoint answers 503.
- `TELEGRAM_PROXY_URL` — proxy (`vpn-client`) the bot's outbound Telegram calls go through, since the server can't reach Telegram directly.
- `TELEGRAM_POLLING` — set to `true` to receive commands by long polling instead of a webhook, since Telegram can't reach the server either.
- `NOTIFY_QUIET_HOURS` — default quiet-hours window (editable on the profile page; the owner's saved values — the lowest user id that has saved any — take precedence over this and `NOTIFY_TIMEZONE`) for automatic notifications, `HH:MM-HH:MM` (may wrap midnight); default `23:00-08:00`, `off` disables. Notifications inside the window are stored (`telegram_outbox` table) and delivered as one digest after it ends; merge offers with buttons are re-sent individually so the buttons still work. Replies to your own commands/button presses are never delayed. Optional; to change it in production add it to `bridge/deploy/swarm/bridge-stack.yml` and the deploy workflow's env.
- `NOTIFY_TIMEZONE` — IANA time zone the window is evaluated in; default `Europe/Moscow`. Optional.
- **Improve module** (`/improve` in bridge): runs the self-improvement loop on bridge itself — takes open GitHub issues labelled `loop`, hands the repository snapshot and the issue to a worker, and turns the result into a branch + pull request (labelled `loop`, `Closes #N`). Needs no extra variables: it uses `GITHUB_REPO`, `GITHUB_BASE_BRANCH` and `LOOP_GITHUB_TOKEN`, whose token must now also have **Issues: read** and **Contents: write** (creating the branch/commits) and **Pull requests: write** (opening the PR). It never merges — that stays with the CI → Telegram → Merge flow — and it drops any change to the loop's protected paths before committing. Schedules (e.g. "every night at 02:00 start the 5 oldest issues") fire once per local day at their time in their time zone, or late if bridge was down then. "Auto-start" (per account) makes every unencrypted Subscription parcel pushed from reports start a worker job at once; reports' own auto-start (Subscription page) does the same, so use one of them. **Analysis** (Improve → Анализ, or a schedule of kind "analysis"): a worker reads the repository and proposes exactly one improvement per direction — general, UI/UX, security, performance, reliability. Proposals are kept on the run for review, or filed as GitHub issues (labels `loop`, `risk:*`, `category:*`) straight away; a title matching an existing issue is skipped as a duplicate. Needs **Issues: write** on `LOOP_GITHUB_TOKEN` in addition to the above. Migration `1791800000000-AddImproveAnalysis` ships with it. Issues can be taken into work in bulk (Задачи → select several, or "start the 5 oldest"), from an analysis ("В работу" files the proposals and starts a run for each), or automatically ("И сразу взять в работу" on a manual analysis or an analysis schedule).
- `LOG_RETENTION_DAYS` — how long the operational log (`app_logs`: job outcomes, loop events, 5xx/slow requests, integration failures — shown on the profile page, exportable as NDJSON) is kept; default `30`. Bodies, query strings and secrets are never stored. Optional.
- `GITHUB_WEBHOOK_SECRET` — secret of the repo's GitHub webhook for `POST /api/v1/github/webhook` (Pull requests + Workflow runs events, HMAC over the raw body); empty means 503.
- `GITHUB_CI_WORKFLOW` — name (`name:`) of the CI workflow the loop reacts to; optional, defaults to `CI`.
- `GITHUB_DEPLOY_WORKFLOW` — name (`name:`) of the deploy workflow the loop reacts to; optional, defaults to `Deploy bridge`.

**reports server** (`reports/packages/server/.env`, not committed; all optional):
- `REPORTS_AUTOPILOT` — `true` enables autopilot for an unattended reports: a heartbeat to bridge every 15 s and an automatic pull (task branch only) every 30 s when a result is ready for a `pushed` task; needs bridge URL and personal API key set in Settings.
- `GITHUB_TOKEN` — GitHub token for tracked repositories with the GitHub provider (open issues labelled `loop`); a fine-grained token with Issues: read & write on that repo is enough. Kept in `.env`, not Settings, so the settings export bundle never carries it.

**GitHub Actions secret naming:** GitHub rejects secret names starting
with `GITHUB_`, so the Actions secret `LOOP_GITHUB_WEBHOOK_SECRET` is what
feeds the backend's `GITHUB_WEBHOOK_SECRET`.
