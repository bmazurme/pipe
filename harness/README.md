# harness

`pipe-status` — one merged view of sync's and reports' local task state,
read directly off disk. No network calls, no auth, no bridge dependency —
it only reads the state files those two tools already write.

See [`ECOSYSTEM.md`](../ECOSYSTEM.md)'s "State files" section for what each
file tracks and why they share a `projectId:iid` key.

## What it reads

| File | Written by | What it tracks |
|---|---|---|
| `sync/.sync-state.json` | sync's project push/pull | last content hash per tracked project |
| `sync/.sync-agent-state.json` | sync's `agent-runner` | a dedup hash per issue (not a progress record) |
| `sync/.gitlab-worker-state.json` | sync's `gitlab-worker` | which issues it already turned into a pushed parcel, and when |
| `reports/packages/server/src/subscription/subscription-state.json` | reports' Subscription module | step/branch/timestamps per issue |

A missing file is treated as empty, not an error. A malformed one is
reported inline (and makes the process exit non-zero) without stopping the
rest of the report from rendering.

## Usage

```bash
npm run build   # from harness/, or via the repo root workspace
npm start        # runs pipe-status once, human-readable text

# equivalently, once built:
node dist/status.js [options]
```

### Options

```
--json                     print the merged report as JSON instead of text
--filter <projectId[:iid]> scope the report to one project or one issue
--watch <seconds>          re-run and re-print on an interval (Ctrl+C to stop)
--sync-state <path>        override .sync-state.json's path
--sync-agent-state <path>  override .sync-agent-state.json's path
--gitlab-worker-state <path>
                            override .gitlab-worker-state.json's path
--reports-state <path>     override reports' subscription-state.json's path
--stale-after <hours>      mark a task stale after this many hours with no
                            further movement (default: 24)
-h, --help                 print this help and exit
```

The four `--*-state` overrides exist mainly for pointing `pipe-status` at a
non-standard checkout layout or a fixture directory (this is also how the
test suite exercises it) — the default paths already resolve correctly for
this repo's own layout.

### Sample output

```
== sync: project push/pull state (.sync-state.json) ==
  bff: lastHash 20eee6da6436…

== task status (sync + reports subscription, by "projectId:iid") ==
  402:6: pushed — waiting to be pulled
    gitlab-worker: pushed 2026-09-28T10:00:00.000Z as 402-6.subscription.zip.enc
    sync (agent-runner): last own output 1c9191a82fc7…
    reports (subscription): step pushed, branch b-mazur-30.09.2026-6, pushed 2026-09-28T10:00:05.000Z

== bridge ==
  no local task state (storage relay only — see bridge/README.md)
```

The label after each key (`pushed — waiting to be pulled` above) is a
**derived status** — `deriveStatus()` synthesizes it from whichever signals
are present for that key, rather than just listing each side's raw fields:
reports' own `step` is used when it's there (the fullest single-file record
of an issue's lifecycle); gitlab-worker's `pushedAt` + agent-runner's dedup
hash are the fallback when reports has no local state for that key at all.
All of this is inferred from local files only — no bridge query — so
"ready to pull" means "the last thing recorded locally suggests that,"
not a live check of what bridge still has.

A task whose derived status has had no further movement for longer than
`--stale-after`'s threshold (default 24h) gets a trailing `[stale]` marker
— e.g. `pushed 2026-09-26T10:00:00.000Z — no pull since [stale]`.

A `manual` reports entry (a parcel created by hand, with no GitLab issue
behind it — see `reports/howto.md`) also gets `[вручную] "<title>"` appended
to its `reports (subscription):` line, since there's no GitLab issue to
cross-reference for it.

### Exit code

`0` normally; `1` if any of the four state files failed to parse, or if any
task's derived status came back stale (both are also shown inline either
way — the exit code just makes `pipe-status` usable as a cron/CI check, not
only something you have to read).

## Tests

```bash
npm test   # tsc -b && node --test 'dist/**/*.test.js'
```

All of `status.ts`'s logic (`compareIssueKeys`, `parseArgs`,
`collectReportData`, `filterReportData`, `deriveStatus`, `annotateTasks`,
`exitCodeFor`, `formatReportText`) is exported and exercised directly
against fixture files in a temp directory — none of the tests touch this
machine's real sync/reports state.
