# pipe: the sync/reports/bridge ecosystem

`pipe` is the monorepo home for three tools that together move a task from
GitLab to a working branch and back:

```
GitLab issue → sync-cli or reports' Subscription module
             → anonymized parcel (zip + manifest)
             → bridge storage
             → agent / human, on the other machine
             → parcel back → bridge storage → pulled and de-anonymized
```

- **[sync/](sync/)** — CLI, pushes/pulls whole project trees or single
  GitLab issues as "parcels" through bridge.
- **[reports/](reports/)** — web app; its `Subscription` module is reports'
  own side of the same issue-parcel flow sync's `push-issue`/`pull-issue`
  implement.
- **[bridge/](bridge/)** — the storage relay + auth both other tools sit on
  top of.
- **[packages/protocol/](packages/protocol/)** — the parcel format
  (dictionary substitution, zip/manifest, hybrid encryption, project walk)
  shared by sync and reports (and, for dictionary substitution, bridge's own
  Purge page). See its README/source for the API.
- **[harness/](harness/)** — `pipe-status`, prints one merged view of
  sync's and reports' local task state (see "State files" below).
- **[worker/](worker/)** — standalone service (installs on an Ubuntu
  server): polls bridge for work along two independent channels — Worker
  jobs (a parcel + an assigned model; runs Claude/GPT/DeepSeek/Qwen against
  it and reports status/logs/result back, the bridge-hosted counterpart to
  `sync-cli agent-runner`) and bridge's **Chat** section (a plain
  conversation with the same five models, no parcel, no file editing — see
  "Chat" below). One process/systemd unit serves both.

Each product's own README has the full detail; this file only covers what
spans all three.

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
(optional ntlstl.time integration). `/api/v1/vpn/*` (browser-session only —
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
(worker's own runtime secrets, injected as plain Swarm service env — same
pattern as backend's), `VPN_CLIENT_CONFIG` (worker's Xray client config.json,
rebuildable from the panel via the VPN page rather than hand-maintained).

**reports** (`SettingsType`, stored in the gitignored
`reports/packages/server/src/settings/settings.json`, edited from the
client's Settings page): `gitlabUrl`, `privateToken` (GitLab PAT),
`bridgeApiUrl`, `bridgeApiKey` (the unrelated `TIME_EXPORT_API_KEY` shared
secret), `bridgeStorageApiKey` (personal bridge API key, preferred — see
"Unified machine auth" below), `bridgeRefreshToken` (fallback: pasted from a
bridge browser session cookie).

**sync** (`sync/.sync-credentials.json`, `sync-cli login`/`login-gitlab`/`login-api-key`,
gitignored): `refreshToken` (bridge, fallback), `apiKey` (bridge, preferred
— see "Unified machine auth" below), `gitlabToken` (issue mode only).
Per-project encryption key pairs live under `sync/keys/` (also gitignored).

**worker** (env vars only, no config file — see `worker/README.md`):
`BRIDGE_API_URL`, `BRIDGE_API_KEY` (a personal bridge API key — the only
auth method worker supports, see "Unified machine auth" below; there's no
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
only, never bridge's own API).

## State files

What's on disk, per product, and how tasks are keyed:

| File | Repo | Keyed by | What it tracks |
|---|---|---|---|
| `.sync-state.json` | sync | project name | last content hash pushed/pulled, project mode |
| `.sync-agent-state.json` | sync | `projectId:iid` | agent-runner's last-own-output dedup hash per GitLab issue (so it doesn't mistake its own push-back for a fresh incoming parcel) — not a progress record |
| `.gitlab-worker-state.json` | sync | `projectId:iid` | which issues gitlab-worker has already turned into a pushed parcel, and when |
| `packages/server/src/subscription/subscription-state.json` | reports | `projectId:iid` | Subscription module's step/branch/timestamps per GitLab issue |
| — | bridge | — | none; bridge is the storage relay, it holds no task state of its own |

All three task-state files already agree on the `projectId:iid` key (e.g.
`"173:628"`), which is what makes `pipe-status` (in `harness/`) able to
merge them into one view instead of requiring separate lookups.

**worker's job state lives in bridge's own Postgres**, not a local file —
the `jobs` table (`bridge/apps/backend/src/worker/entities/job.entity.ts`,
migration `1790100000000-AddWorkerJobs`), one row per job: which
`StoredFile` it reads from and writes to, the assigned model, its
`queued → claimed → running → succeeded/failed` status, accumulated logs,
and timestamps. Unlike everything else in this table, it isn't keyed by
`projectId:iid` at all — a job is keyed to a specific bridge `StoredFile`
id, since worker (unlike sync/reports) has no GitLab integration of its
own and only ever acts on whatever's already sitting in storage. `harness`
doesn't read it (it's DB-backed, not a local JSON file, and specific to
one bridge account rather than one machine's checkout) — bridge's own
Worker page is the only place this state is visible today. Encrypted
(`.enc`) parcels are never eligible: worker has no access to the
per-account private key that would decrypt them (see "Unified machine
auth" below for why that boundary exists).

**Chat's state is the same shape of idea, a separate pair of tables**:
`chats` (`bridge/apps/backend/src/chat/entities/chat.entity.ts` — one row
per conversation: model, optional title) and `chat_messages`
(`chat-message.entity.ts` — one row per turn: role, content,
`pending -> running -> complete`/`failed` status, cascade-deleted with
their chat). Migration `1790200000000-AddChats`. Not keyed by
`projectId:iid` either, for the same reason as `jobs` — no GitLab issue is
involved. `ChatService.claim` uses the identical `FOR UPDATE SKIP LOCKED`
pattern as `WorkerService.claim` to hand out at most one pending turn per
poll.

## Manifest schema versioning

Every parcel manifest (`__sync_manifest__.json`, `__subscription_manifest__.json`)
now carries a `schemaVersion`, stamped by `@pipe/protocol`'s `buildArchive`.
A parcel with no `schemaVersion` (anything built before this existed) is
read with a warning, not an error. A parcel stamped with a `schemaVersion`
newer than the reading build understands throws a clear error naming both
versions, instead of silently misreading a format it doesn't recognize.

## Anonymization completeness check

A single dictionary substitution pass is fine while the other end of every
parcel is "your own second machine." It stops being enough once a parcel
might go to an external LLM provider. `@pipe/protocol`'s `scanForLeaks` runs
a heuristic scan (email addresses, real-looking hostnames, IPv4 addresses,
high-entropy token-shaped strings) over content *after* dictionary
substitution, in both `sync push`/`push-issue`
([commands/push.ts](sync/src/commands/push.ts),
[commands/pushIssue.ts](sync/src/commands/pushIssue.ts)) and reports'
`handlePushSubscriptionIssue`
([subscription/handler.ts](reports/packages/server/src/subscription/handler.ts)),
printing a warning (`console.warn`, via `formatLeakFindings`) for anything
that still looks real. It is advisory only, not a gate — it doesn't block
the push or throw — because the heuristic has real false-positive and
false-negative rates (see `packages/protocol/src/leakScan.ts` for the exact
allowlists/thresholds and their reasoning). It does not run in
`agent-runner`, which is deliberately dictionary-free by design (see
sync's README) — there's no "did the dictionary miss something" question to
ask when no dictionary is in play.

## Unified machine auth

bridge now supports personal, revocable API keys alongside its existing
browser OAuth flow — additive, nothing about existing sessions changed.
Mint one from bridge's Profile page ("API-ключи" card,
[ApiKeysSection.tsx](bridge/apps/frontend/src/pages/profile/ApiKeysSection.tsx));
it's shown once at creation and only its SHA-256 hash is stored
([api-keys.service.ts](bridge/apps/backend/src/auth/api-keys.service.ts),
migration
[AddApiKeys](bridge/apps/backend/src/migrations/1789587965450-AddApiKeys.ts)).
`StorageController` accepts either the key (`X-Api-Key` header, or
`Authorization: Bearer brk_...`) or a normal OAuth access token
([JwtOrApiKeyGuard](bridge/apps/backend/src/auth/guards/jwt-or-api-key.guard.ts)) —
so a machine caller no longer has to impersonate a human's browser session.

- **sync**: `sync-cli login-api-key <key>` ([commands/loginApiKey.ts](sync/src/commands/loginApiKey.ts))
  stores it alongside (not instead of) the existing refresh-token login;
  [bridgeClient.ts](sync/src/bridgeClient.ts) prefers it when present, with
  no refresh dance needed at all.
- **reports**: new Settings field "Bridge storage API key"
  (`bridgeStorageApiKey`, distinct from the pre-existing `bridgeApiKey`,
  which is the unrelated `TIME_EXPORT_API_KEY` shared secret) — preferred by
  [subscription/bridge-client.ts](reports/packages/server/src/subscription/bridge-client.ts)
  over replaying `bridgeRefreshToken` when set.
- **worker**: `BRIDGE_API_KEY` env var, consumed by
  [worker/src/bridgeClient.ts](worker/src/bridgeClient.ts) — the *only*
  auth method it supports (no refresh-token fallback at all, unlike
  sync/reports, since worker is a headless server process with no browser
  session to ever have replayed in the first place).
  [WorkerController](bridge/apps/backend/src/worker/worker.controller.ts)
  reuses the same `JwtOrApiKeyGuard` as `StorageController` for every
  route, human and machine alike — as does
  [ChatController](bridge/apps/backend/src/chat/chat.controller.ts): the
  same `BRIDGE_API_KEY` worker already has authenticates its chat-turn
  polling too, nothing separate to configure for that second channel.

The refresh-token replay (browser cookie pasted into sync/reports) still
works unchanged for anyone who hasn't switched over.

## GitLab worker + ready notifications

Closes the two remaining manual steps around the parcel pipeline: noticing
a new assigned GitLab issue, and noticing when its result is ready to pull.
`agent-runner` already automated the *middle* of the pipeline (polls
bridge, creates a worktree+branch, runs Claude, pushes the result back —
see [commands/agentRunner.ts](sync/src/commands/agentRunner.ts)); this adds
the front and back:

- **`sync-cli gitlab-worker <name> [--watch <seconds>]`**
  ([commands/gitlabWorker.ts](sync/src/commands/gitlabWorker.ts)) — polls
  GitLab for open issues assigned to you on the tracked project
  ([gitlabClient.ts](sync/src/gitlabClient.ts)'s new
  `listAssignedOpenIssues`), and for each one not already sent
  ([gitlabWorkerState.ts](sync/src/gitlabWorkerState.ts) tracks that,
  `.gitlab-worker-state.json`, gitignored), pushes it as a parcel — the same
  build-anonymize-scan-upload core `push-issue` already used, extracted into
  `buildAndUploadIssueParcel` in
  [commands/pushIssue.ts](sync/src/commands/pushIssue.ts) so both share it.
  No git branch/worktree operation happens on the sending side: agent-runner
  already creates the real task branch itself from `baseBranch` once the
  parcel arrives, so the sender only needs a synthetic
  `task/<projectId>-<iid>` label for addressing.
- **`sync-cli pull-issue <name> <projectId> <iid> --watch <seconds>`**
  ([commands/pullIssue.ts](sync/src/commands/pullIssue.ts)) — polls until a
  result parcel appears, then pulls it and fires a notification, instead of
  the human re-running `pull-issue` by hand to check.
- **[notify.ts](sync/src/notify.ts)**: best-effort OS notification (macOS
  `osascript`, Linux `notify-send`, console fallback everywhere else) used
  by both of the above. Never blocks or fails the actual push/pull.

**Deliberately not touched this pass**: `agent-runner`'s own "result ready"
notification (i.e. notifying *from* the machine that ran the agent, in
addition to the *waiting* side above) — the standalone `sync` repo has
real uncommitted work on `agentRunner.ts`/`gitWorktree.ts`/`agentState.ts`
(its `AgentRunnerState.pending` field already hints at an unfinished
confirm-before-send flow), so everything here lives in new files plus one
appended command block in `cli.ts`, rather than adding to files already
mid-edit elsewhere.

## Issue images, and reviewing before dispatch

Two additions to the same issue-parcel flow:

- **Images embedded in an issue description travel in the parcel now.**
  `@pipe/protocol`'s `buildArchive`/`extractArchive`
  ([pack.ts](packages/protocol/src/pack.ts)) accept an additive `assets`
  list — binary content zipped under a reserved `__issue_assets__/` prefix,
  base64 in/out, never round-tripped through the lossy UTF-8 string path
  `PackedFile.content` uses (bumped `PROTOCOL_SCHEMA_VERSION` to `2`, since a
  v1 reader has no code path for that prefix). Both push paths — reports'
  `handlePushSubscriptionIssue`
  ([subscription/handler.ts](reports/packages/server/src/subscription/handler.ts))
  and sync's `buildAndUploadIssueParcel`
  ([commands/pushIssue.ts](sync/src/commands/pushIssue.ts)) — call their own
  `getIssueImages()` (mirrored in each product's `gitlab-client.ts`,
  same duplication pattern as the rest of this flow) to pull `![]()` image
  refs out of the description
  ([markdownImages.ts](packages/protocol/src/markdownImages.ts), pure
  parsing shared by both) and download whichever are relative or same-origin
  as the configured GitLab instance — a link to some other host is left
  alone. On the receiving end, sync's `extractIssue`
  ([issuePack.ts](sync/src/issuePack.ts)) writes them to `issue-images/` in
  the worktree and lists them in `ISSUE.md`; reports' pull handler does the
  same under the tracked project. Not leak-scanned (that's text-pattern
  based) and capped at 20 MB total per issue.
- **`sync-cli agent-runner <name> --review`** pauses before each parcel is
  dispatched to Claude: prints the issue and any pulled images, offers to
  open the description in `$EDITOR`/`$VISUAL` (rewriting `ISSUE.md` if
  changed, so the "before" commit matches what was actually sent), asks
  which model to run it with (passed straight through as `claude --model`),
  and confirms before proceeding — declining leaves the parcel unclaimed for
  the next run. Needs a human at the keyboard, so it's rejected together
  with `--watch` ([reviewPrompt.ts](sync/src/reviewPrompt.ts)).

## reports' pull commits and pushes the task branch — never the target branch

`handlePullSubscriptionIssue`
([subscription/handler.ts](reports/packages/server/src/subscription/handler.ts))
used to only write the parcel's files to disk, leaving them uncommitted —
picking them up into an actual branch was entirely manual. It now also
commits and pushes, via two new functions in
[subscription/git.ts](reports/packages/server/src/subscription/git.ts):

- `commitPulledFiles` stages **only** the exact paths the pull just wrote
  (never `git add -A`) — unlike sync's `agent-runner`, this runs against the
  developer's own regular checkout, not a freshly-created isolated worktree,
  so a blanket add could sweep up unrelated work already sitting there
  uncommitted. `--allow-empty` covers a parcel that carries only an image
  asset and no file changes.
- `pushBranch` pushes that one task branch (the one `init` created,
  read back from the issue's tracked state) to `origin` — deliberately
  nothing else. Getting the result into the target/base branch stays a
  manual step (review it, open a merge request yourself); nothing in this
  pipeline auto-merges anywhere.
- `checkoutTaskBranch` runs before any of that: the repo can drift off the
  task branch between `init` and `pull` (switched away for other work, a
  previous run left it on a different task's branch, ...), and a commit
  always lands on whatever HEAD currently is — without an explicit checkout
  first, pull's commit could land on the target/base branch itself, one a
  later ordinary `git push` from there would carry along. Refuses (same as
  `createBranch`) if the tree is dirty, since switching branches would carry
  those changes along onto the task branch.

Pull now requires `init` to have run first (throws if the issue's tracked
state has no `branch` yet) — previously pull would silently write files
regardless of whether a branch existed for them to land on.

## Roadmap (not yet implemented)

### Multi-parcel addressing

sync's own "Ограничения текущей версии" section already names this:
"one unread parcel per channel" only holds up because pushes and pulls
were, until now, synchronous and human-paced. `gitlab-worker` producing
several task parcels in a row (each still delivered one at a time, but no
longer human-paced) makes this a real, not theoretical, gap: bridge's
storage needs addressing by task/branch, not just by matching filename
patterns client-side the way `agent-runner`/`gitlab-worker` do today.
