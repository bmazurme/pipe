# State files

Part of [ECOSYSTEM.md](../ECOSYSTEM.md)'s cross-cutting detail — see that
file for the full index.

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
per-account private key that would decrypt them (see
[auth.md](auth.md) for why that boundary exists). A `StoredFile` row can
also carry optional `channel`/`taskKey`/`direction` addressing fields (see
[parcel.md](parcel.md#multi-parcel-addressing)) — client-populated, not
derived by bridge itself.

`harness` doesn't read the `jobs` table directly (no local file, no DB
access of its own) — bridge's own Worker page remains the only place to
browse it in full. But its optional `--live` flag (reusing sync-cli's own
bridge API key, no separate login) calls `GET /worker/jobs` and `GET
/storage`, and rebuilds the `projectId:iid` key client-side by joining a
job's `sourceFileId`/`resultFileId` back to the `taskKey` on its addressed
`StoredFile` row — the same addressing fields mentioned above. This is
read-only and additive: without `--live` (or without a configured API key,
or bridge unreachable), `pipe-status` falls back to the plain local-files
report unchanged.

**`harness` also writes its own state, outside any product's repo**:
`~/.local/state/pipe/events.jsonl` (append-only, `{ts, key, source, from,
to}` per line) and `last-snapshot.json` (the per-key signature it diffs
each run against, to know what counts as a transition) — a record of what
*this machine's user* has observed happen, not something sync/reports
themselves produce or read (IMPROVEMENTS_HARNESS.md 4.1). Written on every
`pipe-status` run, one-shot or `--watch` alike; `--log <projectId:iid>`
reads it back. See `harness/README.md`'s own "Remembering transitions"
section for what counts as a change (the underlying signal, deliberately
not the rendered label — time-driven staleness wording isn't a real
transition).

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

**worker's own liveness is a heartbeat, not a state file**: one row per
`(userId, workerName)` in `worker_heartbeats`
(`bridge/apps/backend/src/worker/entities/worker-heartbeat.entity.ts`),
upserted on every single claim attempt regardless of whether a job was
found — an idle worker polling an empty queue changes nothing on `jobs`,
so this is the only actual proof-of-life signal. `GET /api/v1/worker/status`
reports up/down from it (stale after 30s); the Worker page's own status
block is built on that.
