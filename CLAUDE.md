# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`pipe` is a monorepo unifying several independently-deployed products around one shared "parcel" format — moving a task from GitLab to a working branch and back:

```
GitLab issue → sync-cli or reports' Subscription module
             → anonymized parcel (zip + manifest)
             → bridge storage
             → agent / human, on the other machine
             → parcel back → bridge storage → pulled and de-anonymized
```

- `sync/` — CLI: pushes/pulls whole project trees or single GitLab issues as parcels through bridge.
- `reports/` — a local-first time-tracking web app; its `Subscription` module is reports' own side of the same parcel flow.
- `bridge/` — the storage relay + auth (Yandex + GitHub OAuth, JWT+refresh, personal API keys) that sync and reports both sit on top of; also owns "Purge" (manual anonymization UI), a VPN-provisioning/status page for routing worker's outbound traffic, a plain Chat page unrelated to the parcel flow, and the Worker page for launching/monitoring jobs below.
- `worker/` — a standalone poll-based process (no listening port) that claims Worker jobs and Chat turns from bridge, runs them against Claude (via the `claude` CLI) or an OpenAI-compatible provider (gpt/deepseek/qwen), and reports results/logs back. Deployed as its own Swarm service, deliberately isolated from bridge's own database/secrets (see `worker/README.md`).
- `packages/protocol/` — the shared parcel format: dictionary substitution, zip/manifest, hybrid RSA+AES encryption, project-tree walking, a heuristic leak-scan; also the helpers sync, harness and reports share (`notify` OS notifications, `gitlabClient`, `state` local task-state files).
- `harness/` — `pipe-status`, merges sync's and reports' local task-state files into one view.

Per-module detail for bridge, worker and chat lives in `docs/components.md` (moved out of this file to keep it short).

Cross-cutting detail that spans more than one product — port assignments, the full secrets/env-var table, state-file formats, manifest versioning, the anonymization-completeness check, unified machine auth — lives in `ECOSYSTEM.md`. Read it before making a change that touches more than one product. Each product also has its own README with product-specific setup/usage detail (`sync/README.md`, `reports/README.md`, `bridge/README.md`).

## Repository layout & install model

`packages/protocol`, `harness`, `sync`, and `worker` are real npm workspaces, declared in the root `package.json` (IMPROVEMENTS_TECH.md 5.1 — `reports/` and `bridge/` were deliberately left out of this, see below). A single `npm install` from the repo root sets up all four; `sync/package.json` and `worker/package.json` depend on `@pipe/protocol` via a plain workspace-resolved range (`"@pipe/protocol": "*"`), not a `file:` path, and neither has its own lockfile or `node_modules` anymore — everything hoists into the root's.

`reports/` and `bridge/` are still deliberately **not** root workspace members — each keeps its own independent `npm install`/lockfile/build lifecycle, and depends on `@pipe/protocol` via a `file:` path:

- `reports/packages/server/package.json` → `"@pipe/protocol": "file:../../../packages/protocol"`
- `bridge/apps/frontend/package.json` → `"@pipe/protocol": "file:../../../packages/protocol"`

Both are themselves npm workspace roots one level down (`reports/packages/{client,server,shared}`, `bridge/apps/{backend,frontend}`), independent of the outer root — folding either into the root workspace is a materially bigger, riskier change than sync/worker was (flattening an existing nested workspace, plus CWD-sensitive Vite/vitest config in both — see this file's own frontend-test-invocation warning below) and was deliberately scoped out of 5.1 rather than attempted in the same pass.

Consequences that still apply everywhere, workspace member or not:
- After changing `packages/protocol`, run `npm run build` there before the change is visible anywhere — its `exports` map points at `dist/`, not the source, regardless of how a consumer depends on it.
- `reports/` and `bridge/` each still need their own `npm install` from their own directory; `sync`/`worker` do not — a root `npm install` covers them.
- worker's own Dockerfile (`worker/Dockerfile`) reflects this: its build stage runs `npm ci` from the repo root (needing every workspace's `package.json` present, even ones it doesn't use, since `npm ci` validates the lockfile against all of them) rather than a self-contained install inside `worker/`.

`packages/protocol`'s `exports` map has one subpath per module, plus the `.` barrel: `./dictionary` (word-boundary substitution), `./manifest` (manifest + `schemaVersion`), `./encryption` (Node hybrid RSA+AES, uses `node:crypto`), `./encryption-browser` (the same format via WebCrypto, browser-safe), `./pack` (zip build/extract), `./walk` (project-tree walking), `./leakScan` (advisory secret heuristic), `./resolveInDir` (safe path resolution inside a directory), `./issueParcel` (single-issue parcel shape), `./markdownImages` (markdown image extraction), `./bridge-api-types` (generated bridge API types — see "OpenAPI spec" below for how to regenerate), `./state` (local task-state files), `./gitlabClient` (GitLab API client), `./atomicWrite` (atomic file writes), `./notify` (best-effort OS notifications), `./proxy` (process-wide `HTTPS_PROXY` bootstrap for global `fetch`, uses `undici` — never import it from browser code; not in the barrel). Always import a specific subpath (e.g. `@pipe/protocol/leakScan`), never the bare `@pipe/protocol` barrel, from browser code (bridge's frontend) — the barrel re-exports `encryption.ts`, which pulls in `node:crypto` and breaks the Vite build. Browser code must use `@pipe/protocol/encryption-browser` for encryption, never `encryption` or the barrel.

Node: `engines.node` is `>=22` in the root, `packages/protocol`, `harness`, `sync`, `worker`, `bridge/package.json` and `reports/package.json`; the inner workspaces under `bridge/apps/*` and `reports/packages/*` declare no `engines`, so bridge and reports rely on the `.nvmrc` and CI pin. CI pins `22.18.0` (also in the root `.nvmrc`).

The repo root also holds `eslint.config.base.mjs` — shared flat-config ESLint rules for every package that didn't already have its own lint setup (sync, worker, packages/protocol, harness, reports' server). Each of those still needs its own local `eslint` devDependency (same non-workspace-member reasoning as above) and a thin per-package `eslint.config.mjs` importing this file by relative path; only `typescript-eslint` itself needs to live at the root, since that's where the shared file's own import resolves from. bridge's backend/frontend and reports' client already had working lint setups and were deliberately left alone.

## Commands

### packages/protocol
```bash
cd packages/protocol
npm run build   # tsc -b — must run before consumers (sync/reports/bridge) see the change
npm test        # tsc -b && node --test 'dist/**/*.test.js'
npm run lint    # flat-config ESLint, shared base in the repo root's eslint.config.base.mjs
```
Tests are `.test.ts` files compiled alongside source and run from `dist/` via Node's built-in test runner — no watch mode, re-run `npm test` after edits. `roundtrip.test.ts` is the in-process cross-repo round-trip test: it verifies sync-shaped and reports-shaped parcels round-trip losslessly, including dictionary-substituted fields. The full end-to-end one, with real processes talking over HTTP, is `scripts/e2e-cross-repo-pipeline.mjs` (see "cross-repo E2E pipeline" below).

#### OpenAPI spec
After changing a bridge controller, DTO (including validation decorators) or an entity returned by an endpoint, regenerate and commit both generated files, in this order:
1. `cd bridge && npm run build -w backend` — `openapi:generate` runs the compiled `dist/generate-openapi.js` (source `bridge/apps/backend/src/generate-openapi.ts`), so `dist/` must be current.
2. `cd bridge && npm run openapi:generate -w backend`, then commit `bridge/apps/backend/openapi.json`. Needs a reachable Postgres and the env vars from the «Backend OpenAPI spec drift check» step in `.github/workflows/ci.yml`.
3. `cd packages/protocol && npm run openapi:generate`, then commit `packages/protocol/src/bridge-api-types.d.ts` (`openapi-typescript` over the committed `openapi.json`, so step 2 must come first).

CI enforces this with two steps in bridge's job (`ci.yml`): «Backend OpenAPI spec drift check» (`npm run openapi:check -w backend`) fails if regenerating changes `openapi.json`; «protocol OpenAPI types drift check» (`npm run openapi:check --workspace=packages/protocol`) fails if regenerating changes `bridge-api-types.d.ts`.

### sync
```bash
cd sync
npm install     # root workspace member — this actually installs for the whole workspace (protocol/harness/sync/worker), same as running it from the repo root
npm run build   # tsc -b
npm test        # tsc -b && node --test --test-concurrency=1 'dist/**/*.test.js'
node --test --test-concurrency=1 dist/commands/pushIssue.test.js   # a single test file, after building
npm run lint    # flat-config ESLint, shared base in the repo root's eslint.config.base.mjs
```

### reports
```bash
cd reports
npm install                              # postinstall builds packages/shared automatically
npm start                                # build shared, then run server (tsx --watch, :4000) + client (Vite, :5174) together
npm test --workspace=packages/server         # Vitest
npm run typecheck --workspace=packages/server # tsc --noEmit
npm run lint --workspace=packages/server      # flat-config ESLint, shared base in the repo root
npm test --workspace=packages/client     # Vitest
npx vitest run -t "<name>" --workspace=packages/client   # a single test by name
npm run lint --workspace=packages/client
npm run e2e --workspace=packages/client  # Cypress, headless — see also .github/workflows/nightly-reports-e2e.yml
```
`packages/shared` resolves through its built `dist/` — keep it built (or running via `npm run dev --workspace=packages/shared`, watch mode) while iterating on shared types. `npm start`/`postinstall` already do this for you.

### bridge
```bash
cd bridge
npm install
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
npm run dev                          # docker compose up -d postgres, then backend (:3000) + frontend (:5173) together
npm run build                        # backend then frontend
npm run lint                         # backend then frontend
npm test -w backend                  # Jest
npm test -w backend -- -t "<name>"   # a single test by name
npm run test:e2e -w backend          # needs a running Postgres + a pre-created `ntlstl-db-test` database (--runInBand: parallel workers race to run migrations against it otherwise); CI runs this against a service container
npm run migration:check -w backend   # typeorm migration:generate --check — fails if entities drifted from committed migrations (informational-only in CI today, see ci.yml's own comment on a pre-existing naming-convention mismatch)
npm test -w frontend                 # Vitest
npm test -w frontend -- <pattern>    # filters by filename, e.g. `npm test -w frontend -- PurgeApplyTab`
```
Both apps also have a `test:coverage` script (Jest's/Vitest's own `--coverage`); every other package's `test:coverage` runs `node --test --experimental-test-coverage`. None of these are wired into CI as a gate yet.

Dev no longer runs on `synchronize: true` — it runs real migrations now too (`migrationsRun: true` unconditionally in `config/type-orm.config.ts`), so an existing local dev database built before this changed needs recreating once (drop it, then `npm run migration:run -w backend`) before `npm run dev` works again.
Run frontend tests via the `npm test -w frontend` script, not `vitest` invoked directly with `--config apps/frontend/vitest.config.ts` from the bridge root — vitest resolves the config's relative paths (`setupFiles`, etc.) against the invocation CWD rather than the config file's own directory, and fails to find `src/test/setup.ts`.

### worker
```bash
cd worker
npm install     # root workspace member — same as sync, this installs for the whole workspace
npm run build   # tsc -b
npm start       # node dist/index.js — polls bridge, needs BRIDGE_API_URL plus either a one-time enrolment code (WORKER_ENROLL_CODE / node dist/enrollCli.js) or, legacy, BRIDGE_API_KEY (see worker/README.md)
npm test        # tsc -b && node --test 'dist/**/*.test.js'
npm run lint    # flat-config ESLint, shared base in the repo root's eslint.config.base.mjs
```

### harness
```bash
cd harness
npm run build
npm start   # node dist/status.js
node dist/mcp.js   # pipe-mcp — an MCP stdio server, not meant to be run directly in a terminal; an MCP client spawns it
npm test    # tsc -b && node --test 'dist/**/*.test.js'
npm run lint    # flat-config ESLint, shared base in the repo root's eslint.config.base.mjs
```

### cross-repo E2E pipeline
```bash
# from the repo root
npm run e2e:cross-repo   # node scripts/e2e-cross-repo-pipeline.mjs
```
Pushes a sync-shaped parcel through a real bridge backend and a real worker job (against a fake model server standing in for an AI provider), then pulls the result back. All three run as separate processes and talk only over HTTP. The script does not set up its own prerequisites, which are the same as for `npm run test:e2e -w backend`:
- a reachable Postgres with a pre-created `ntlstl-db-test` database;
- `packages/protocol`, `bridge/apps/backend` and `worker` already built (`npm run build` in each, or `npm run build -w backend` from `bridge/`). The script only runs their `dist/` output.

Environment: `POSTGRES_HOST`/`POSTGRES_PORT`/`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` default to `localhost`/`5432`/`postgres`/`postgres`/`ntlstl-db-test`, the same database bridge's local `docker compose up -d postgres` gives you. `E2E_BRIDGE_PORT` (default `3099`) is the port the spawned bridge listens on, so it does not collide with a dev bridge on :3000. CI runs this nightly via `.github/workflows/nightly-cross-repo-e2e.yml`, not on every push.

### CI
`.github/workflows/ci.yml` builds/tests protocol → sync/worker/reports/bridge/harness (each needing protocol built first) — read it for the exact command sequence each project's pipeline runs, since it's the source of truth if any command above drifts. bridge's job also runs its e2e suite and an informational migration-drift check against a real Postgres service container. `.github/workflows/deploy-bridge.yml` builds bridge/worker's Docker images and deploys them to the production Docker Swarm stack; currently `workflow_dispatch`-only. `.github/workflows/nightly-reports-e2e.yml` runs reports' Cypress suite against a real client+server pair, on a nightly schedule rather than every push (slower, more failure-prone than the unit suites). `.github/workflows/nightly-cross-repo-e2e.yml` runs `npm run e2e:cross-repo` against a Postgres service container on the same reasoning: nightly at 04:00 UTC (`cron: '0 4 * * *'`), plus manual `workflow_dispatch`.

## Architecture notes

### The parcel format (packages/protocol)
A parcel is a zip plus a manifest (`__sync_manifest__.json` or `__subscription_manifest__.json`) stamped with a `schemaVersion` by `buildArchive`. Readers warn (not error) on a missing `schemaVersion` (pre-versioning parcels) and hard-error on a `schemaVersion` newer than they understand. Dictionary substitution (`dictionary.ts`) does word-boundary-aware find/replace in both directions (`keyToValue` for outgoing/anonymizing, `valueToKey` for incoming/de-anonymizing); an empty dictionary means content passes through unchanged. `leakScan.ts` is a separate, purely advisory heuristic (regex + entropy) that runs *after* dictionary substitution to flag values that still look like real secrets — it never blocks, only warns (`formatLeakFindings`), and deliberately does not run in sync's `agent-runner`, which is dictionary-free by design.

### bridge (NestJS + React)
`bridge/apps/backend/src` is organized by feature module. The ones every other product leans on: `auth` (JWT access + refresh rotation, personal API keys, Yandex/GitHub sign-in methods), `storage` (the parcel relay: a `FileStore`, local volume or S3, with deliberate download-then-delete "single-recipient mailbox" semantics — see `sync/README.md` for why that shape matters), `purge` (the per-account dictionary), `worker` (jobs, named Claude credentials, worker heartbeat), `vpn`, `chat`. The rest — `secrets`, `time`, `improve`, `lab`, `boards`, `questions`, `context`, `users` — is described module by module in [docs/components.md](docs/components.md).

Rules that apply to any change here:
- Two guards: `JwtGuard` (browser session — `purge`, `secrets` and `vpn` provisioning never use the machine guard) and `JwtOrApiKeyGuard` (a JWT or a personal API key — how sync/reports/worker authenticate).
- `ClaudeCredential.token`, `VpnConnection.panelApiToken` and `Secret.value` are encrypted at rest (AES-256-GCM, `src/crypto/encrypted-column.transformer.ts`, key `CREDENTIALS_ENC_KEY`).
- A global `ThrottlerGuard` rate-limits every route; auth/OAuth controllers carry a much stricter override.
- `GET /api/v1/health` is readiness (DB reachable, no pending migrations); `GET /` stays a trivial no-DB liveness check on purpose. The Swarm healthcheck and deploy smoke test target the former.
- Frontend (`apps/frontend/src`): Gravity UI, Redux Toolkit + RTK Query, and `base-query-with-reauth.ts` (mutex-guarded refresh on 401). Only the frontend depends on `@pipe/protocol` (`dictionary`, `leakScan`, `encryption-browser`) — Purge substitution and Storage's leak scan happen client-side, before anything reaches the network.

### worker
A standalone, unprivileged process with no listening port: it only polls bridge (`GET`, then `POST .../claim`, for jobs and chat turns; jobs first). Jobs run the `claude` CLI (`--dangerously-skip-permissions` — arbitrary code execution against task content, hence the isolation) or a minimal tool-calling loop for gpt/deepseek/qwen. Workers are added from the UI (Worker → Worker'ы): a one-time `brn_…` enrolment code is redeemed for the worker's own `brw_…` key, accepted only on `@WorkerKeyAllowed()` routes; its settings are fetched before every poll, and a 401 there means "deleted — erase the key and wait to be enrolled again". Claude tokens and provider API keys live encrypted in bridge and arrive with the claimed job. Every outbound `fetch` carries an `AbortSignal.timeout`; job logs are batched. Limits, VPN, the Fusion 360 capability and per-job time limits are in [docs/components.md](docs/components.md) and `worker/README.md`.

### chat
Independent of the parcel/job pipeline: a plain conversation with Claude/GPT/DeepSeek/Qwen through worker (`bridge/apps/backend/src/chat` persists `Chat`/`ChatMessage`; worker's `chatProviders.ts`/`chatRunners/*` run a turn). No streaming — bridge has no websocket/SSE, so the frontend polls; a Claude turn reports its partial text so it still shows growing. Attachments, saving a chat as a Context, attaching a job's outcome and the `pipe-action` PR-fix card are described in [docs/components.md](docs/components.md).

### sync (CLI)
Commands live one-per-file under `src/commands/`. `agentRunner.ts` is the most involved: it polls bridge for a parcel, creates a git worktree + branch, runs Claude non-interactively (`claudeRunner.ts`, with `--dangerously-skip-permissions` — see that file's header comment for what it assumes about the environment it runs in) against the parcel's contents, and pushes the result back. `gitlabWorker.ts` / `pullIssue.ts` close the loop around that: polling GitLab for newly-assigned issues, and polling bridge for a ready result, each firing a best-effort OS notification (`@pipe/protocol/notify`, shared with harness's own `--notify` — never blocks the actual push/pull) instead of requiring a human to re-check by hand.

### reports
A three-package npm workspace (`client`/`server`/`shared`), no database — all server-side state (`settings.json`, `props.json`, `project-dict.json`, `subscription-state.json`) is flat JSON written under `packages/server/src/**`, gitignored. Client and server exchange data as newline-delimited JSON (`StreamEvent`, typed in `packages/shared`). The `Subscription` module (`packages/server/src/subscription/`) is reports' side of the same push/pull-issue flow sync implements independently — it shares the parcel format via `@pipe/protocol` but keeps its own state file and its own archive-extraction code path.

### harness
`harness/src/status.ts` (`pipe-status`) reads sync's and reports' local state files directly off disk and merges them by their shared `projectId:iid` key into one status view — no network calls by default. An optional `--live` flag adds real bridge (`bridgeLive.ts`) and GitLab (`gitlabLive.ts`) checks on top; `--pull`/`--retry`/`--publish` (`actions.ts`) can act on a task instead of only reporting on it, always behind confirmation; `--next`/`rankTasks` (`next.ts`) scores every task into one of 4 priority buckets; `--brief` (`brief.ts`) digests incoming/ready/stale/recently-moved/worker into one summary, always checking bridge+GitLab internally regardless of `--live`. Run with zero flags in a real terminal and it launches an interactive list instead (`tui.ts`, `@clack/prompts`) — any flag at all, or stdout not a TTY (scripts/CI), keeps the plain-text report unchanged. `harness/src/mcp.ts` (`pipe-mcp`) wraps the same functions as MCP tools for Claude Code instead of a human running `pipe-status` in a terminal — see `harness/README.md`'s own "pipe-mcp" section for why that needed `actions.ts` to return `{code, output}` instead of printing directly (an MCP stdio server's stdout is the JSON-RPC channel itself, not just cosmetic terminal output). `--log-time` (`timeTracking.ts`) logs actual time spent on a task to GitLab (`add_spent_time`, the same endpoint GitLab's own `/spend` quick action uses) based on reports' own `subscription-state.json` `pushedAt`/`pulledAt` fields — deliberately not `events.jsonl`, which never logs a key's first-ever observation and so can't reconstruct a task's first push→pull cycle.
