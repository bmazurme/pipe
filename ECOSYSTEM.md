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
`NOTES_YANDEX_REDIRECT`, `NOTES_TARGET_URL`, `COOKIE_DOMAIN` (must be the
exact backend host, not a shared parent domain — the cookie is named
`bridgeRefreshToken` specifically because a shared `COOKIE_DOMAIN` with
sibling apps on the same parent domain caused a name collision before),
`EMAILS` (optional allowlist), `CORS_ORIGINS`, `TIME_EXPORT_API_KEY`/`TIME_EXPORT_USER_ID`
(optional ntlstl.time integration). Deploy-only: `YC_SA_JSON_CREDENTIALS`,
`CR_*` (registry), `SWARM_*` (SSH access), `BACKEND_PUBLISHED_PORT`/`FRONTEND_PUBLISHED_PORT`/`HOST`.

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

## State files

What's on disk, per product, and how tasks are keyed:

| File | Repo | Keyed by | What it tracks |
|---|---|---|---|
| `.sync-state.json` | sync | project name | last content hash pushed/pulled, project mode |
| `.sync-agent-state.json` | sync | `projectId:iid` | agent-runner's pending/last-output state per GitLab issue |
| `packages/server/src/subscription/subscription-state.json` | reports | `projectId:iid` | Subscription module's step/branch/timestamps per GitLab issue |
| — | bridge | — | none; bridge is the storage relay, it holds no task state of its own |

Both task-state files already agree on the `projectId:iid` key (e.g.
`"173:628"`), which is what makes `pipe-status` (in `harness/`) able to
merge them into one view instead of requiring two separate lookups.

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

The refresh-token replay (browser cookie pasted into sync/reports) still
works unchanged for anyone who hasn't switched over.

## Roadmap (not yet implemented)

These two were scoped out of the initial monorepo pass because each is a
standalone feature touching production surface area, and deserves its own
design pass rather than being bolted on here.

### GitLab worker + ready notifications

Already specced in detail in
[sync/docs/roadmap.md](sync/docs/roadmap.md) (items 1, 3, 4): a GitLab
client, a `__sync_tasks__.json` snapshot traveling with the code, and the
full task → branch → agent → review pipeline. Linked here rather than
re-derived. This is also what makes the next item necessary — without it,
the current one-parcel-at-a-time flow is driven by a human and that's
enough.

### Multi-parcel addressing

sync's own "Ограничения текущей версии" section already names this:
"one unread parcel per channel" only holds up because pushes and pulls
today are synchronous and human-paced. A GitLab worker producing several
task parcels in parallel needs bridge's storage addressed by task/branch,
not by project name. Blocked on the GitLab worker above actually existing
first — no reason to redesign addressing for a producer that isn't there
yet.
