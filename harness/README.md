# harness

`pipe-status` — one merged view of sync's and reports' local task state,
read directly off disk. No network calls, no auth, no bridge dependency by
default — it only reads the state files those two tools already write.
An optional `--live` flag (below) adds a real bridge check on top of that,
and `--pull`/`--retry`/`--publish` (below) let it act on a task instead of
only reporting on it.

See [`docs/state.md`](../docs/state.md) for what each file tracks and why
they share a `projectId:iid` key.

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

Run it with **no options, in a real terminal**, and it launches an
interactive list instead (IMPROVEMENTS_HARNESS.md 2.4) — see "Interactive
mode" below. Any flag at all, or stdout not being a TTY (piped, redirected,
CI), keeps the plain-text report above completely unchanged — that
distinction is checked once, up front, not threaded through every flag
below.

### Options

```
--json                     print the merged report as JSON instead of text
--filter <projectId[:iid]> scope the report to one project or one issue
--live                     check bridge for the worker's heartbeat, each
                            task's storage result, and its worker job
                            status (sync-cli's bridge API key), and GitLab
                            for each task's issue/MR/pipeline state plus
                            newly assigned issues not yet pushed (sync-cli's
                            GitLab token) — each independently falls back to
                            the offline report if its own credential is
                            absent or it's unreachable
--log <projectId:iid>      print the recorded transition timeline for one
                            task and exit (see "Remembering transitions"
                            below) — every run, watched or one-shot,
                            records them regardless of this flag
--notify                   fire an OS notification for each new transition
                            this run finds, on top of the usual report (see
                            "Notifications" below)
--next                     print the single most important task right now
                            and what to do about it, then exit (see "What's
                            next" below)
--brief                    print a digest (incoming, ready, stale, moved
                            recently, worker), then exit (see "Morning
                            brief" below)
--recent-hours <hours>     with --brief, how far back "moved recently"
                            looks (default: 24)
--pull/--retry/--publish <projectId:iid>
                            run a next action against one task, then exit
                            (see "Running actions" below)
--yes                      skip the confirmation prompt before an action
--dry-run                  print what an action would do instead of doing it
--project <name>           override project-name resolution for --pull/--retry
--reports-url <url>        override reports' base URL for --publish
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
By default this is inferred from local files only — no bridge query — so
"ready to pull" means "the last thing recorded locally suggests that," not
a live check of what bridge still has.

### `--live`

With `--live`, `pipe-status` additionally reads sync's own
`.sync-credentials.json` (its `apiKey`) and `sync.config.json` (its
`bridge.apiUrl`) — the same account sync-cli and worker already use, not a
separate login — and calls `GET /worker/status`, `GET /storage`, and
`GET /worker/jobs`. That upgrades "likely ready to pull" into a fact
("confirmed in bridge storage" or "no result yet"), and attaches the
matching worker job's own status (`worker job #42 (gpt): running`) to any
task bridge has addressing metadata for. A missing API key or an
unreachable bridge doesn't fail the command — it falls back to the same
offline report as without the flag, with one extra line explaining why
live data isn't shown.

```
== bridge (live) ==
  worker: up
    worker-1: up, last seen 2026-10-04T09:58:12.000Z
```

or, per task:

```
  402:6: agent-runner pushed a result — confirmed in bridge storage, ready to pull
    bridge (live): worker job #42 (gpt): succeeded
```

Independently, `--live` also reads sync's own `.sync-credentials.json`
(`gitlabToken`) and `sync.config.json` (`gitlab.apiUrl`) and calls GitLab
directly for two things (IMPROVEMENTS_HARNESS.md 1.2/1.3): for any task with
a resolvable branch (reports' own `subscription.branch`, or
`task/<projectId>-<iid>` for one `gitlab-worker` pushed without reports
involved), the issue's current open/closed state plus the newest merge
request for that branch and its pipeline status; and, separately, any
GitLab issue assigned to this account that isn't tracked by *any* local
state file yet — one gitlab-worker hasn't picked up, or simply missed. A
missing GitLab token doesn't affect the bridge check or vice versa — either,
both, or neither can be configured on a given machine.

```
== incoming (assigned, not yet pushed) ==
  402:9: Fix the login redirect loop

  402:6: published — but pipeline failed (MR !42)
    gitlab (live): issue opened, MR !42 (opened), pipeline failed
```

### Remembering transitions (`--log`)

Every run — one-shot or `--watch`, with or without `--live` — compares
each task's local state against what it saw last time (persisted to
`~/.local/state/pipe/last-snapshot.json`, outside the repo checkout since
it's a record of what *this machine* has observed, not something
sync/reports themselves write) and appends one line per genuine change to
`~/.local/state/pipe/events.jsonl`:

```json
{"ts":"2026-10-05T14:34:12.663Z","key":"123:m-abc","source":"reports (subscription)","from":"subscription:pushed","to":"subscription:pulled"}
```

What counts as "changed" is the underlying signal (reports' own `step`, or
which of gitlab-worker/agent-runner have a record at all) — deliberately
*not* the rendered label text, which can change purely from the passage of
time (the `[stale]` wording) without anything real having happened. The
very first time a task is ever observed, nothing is logged for it (there's
nothing to diff against yet) — so running this against an
already-populated checkout for the first time doesn't dump every existing
task into the log as a fake "just happened" burst. Task removals aren't
logged either; this is a record of forward progress, not a full audit
trail.

`--log <projectId:iid>` prints that task's recorded timeline and exits:

```
Timeline for 123:m-abc:
  2026-10-05T14:34:12.663Z  reports (subscription)  subscription:pushed → subscription:pulled
```

(IMPROVEMENTS_HARNESS.md 4.1 — its own example is `pipe log <key>`, a
subcommand on a renamed `pipe` binary with verbs; item 6.5, the binary
rename, doesn't exist yet, so this is a flag on the current `pipe-status`
instead.)

### Notifications (`--notify`)

`--watch` on its own only re-prints the full report — nothing tells you
*what* changed, or fires anything if you aren't actively reading the
terminal. `--notify` fires one OS notification (macOS `osascript`, Linux
`notify-send`, a plain stdout line as the fallback on anything else) per
new transition that a run's `recordTransitions` call finds — the same
mechanism `--log`/`events.jsonl` already use (IMPROVEMENTS_HARNESS.md 4.1),
just reported live instead of only readable later:

```
🔔 123:m-abc: reports: pushed → reports: pulled
```

(shown here as the fallback text form — the real notification is a native
OS banner). `--notify` works with or without `--watch`: combine it with
`--watch <seconds>` for a long-running terminal session, or run `pipe-status
--notify` as a one-shot from a scheduler for a true background daemon with
no terminal involved at all — see `harness/launchd/` (macOS) and
`harness/systemd/` (Linux, user units) for ready-to-copy examples of the
latter. Firing `notify()` itself never throws or blocks the rest of the
run — a failed OS dispatch just falls back to the stdout line above.

Only genuine local-state transitions fire a notification (the same ones
`--log` records) — a task crossing the `--stale-after` threshold, or the
worker going offline under `--live`, do not; those are live/derived facts
the underlying diff doesn't track (see `events.ts`'s own comment on why its
signature is deliberately not `deriveStatus()`'s label).

A task whose derived status has had no further movement for longer than
`--stale-after`'s threshold (default 24h) gets a trailing `[stale]` marker
— e.g. `pushed 2026-09-26T10:00:00.000Z — no pull since [stale]`.

A `manual` reports entry (a parcel created by hand, with no GitLab issue
behind it — see `reports/howto.md`) also gets `[вручную] "<title>"` appended
to its `reports (subscription):` line, since there's no GitLab issue to
cross-reference for it.

### What's next (`--next`)

The full report lists every task; `--next` picks the single most important
one and exits (IMPROVEMENTS_HARNESS.md 2.2) — no new data source, just a
scoring pass over what the rest of `pipe-status` already collects:

1. **stale** — anything `deriveStatus` already flagged as stuck past
   `--stale-after`, or a published task whose pipeline actually failed.
2. **ready** — a *confirmed* ready result: reports' own `pulled` step
   (publishing is the only thing left, no `--live` needed to know that), or
   a `gitlab-worker`+`agent-runner` task `--live` has confirmed has a
   result sitting in bridge storage. The unconfirmed "likely ready to pull"
   guess stays out of this bucket on purpose — it's either confirmed or it
   goes stale, not promoted on a guess.
3. **incoming** — a GitLab issue assigned to you that no local state file
   has picked up at all yet (1.3's own section) — only visible under
   `--live`.
4. **other** — anything else with a next action at all (a task `deriveStatus`
   gave no `nextAction` to — a done `published` task, or no local state —
   is never a candidate; there's nothing to recommend doing about it).

```
$ pipe-status --next
123:m-muswwu2i [other]: pushed — waiting to be pulled
  next: pull the result once it is ready → sync-cli pull-issue <name> 123 m-muswwu2i
```

or, with nothing outstanding: `Nothing urgent — all clear.` `--json` prints
the same `{key, bucket, label, nextAction}` shape (or `null`) instead.
Combine with `--live` to let buckets 2/3 see confirmed-ready results and
newly assigned issues — without it, only local state is considered, same
as the rest of the report.

**Not done here**, despite the original item's own text mentioning it:
weighting by GitLab due date or priority labels — `gitlabLive.ts`'s GitLab
calls (1.2/1.3) don't fetch either field today, and adding them means
extending `@pipe/protocol/gitlabClient`'s `GitlabIssue` shape and its API
calls, a separate follow-up.

Exit code: `1` only when the pick is `stale` (the one bucket actually
alarm-worthy on its own); `0` for `ready`/`incoming`/`other` and for
"nothing urgent" — those are normal backlog, not a cron/CI-worthy signal.

### Morning brief (`--brief`)

Five sections in one digest (IMPROVEMENTS_HARNESS.md 3.2), built entirely
from pieces that already exist — no new data source:

- **Incoming** / **Ready to review** / **Stale** — `--next`'s own 3
  highest-priority buckets (2.2's `rankTasks`), shown in full rather than
  just the single winner.
- **Moved in the last N hours** (`--recent-hours`, default 24) — every
  task's transitions from `events.jsonl` (4.1), not just one key's (unlike
  `--log`), rendered with the same `from → to` text `--notify` already uses.
- **Worker** — up/down, from the same bridge check `--live` makes.

Unlike the plain report, `--brief` always checks bridge + GitLab
internally, with or without `--live` — a scheduled brief with nothing live
checked would mostly be an empty shell. "VPN" from the original item's own
text isn't here, same reason `1.5`'s own environment section already
leaves it out — see that section above.

```
$ pipe-status --brief
== brief ==

Incoming (assigned, not yet pushed):
  none

Ready to review:
  none

Stale:
  none

Moved in the last 24h:
  123:m-muswwu2i: reports: pushed → reports: pulled

Worker:
  up
```

Pair with `--notify` for a scheduled run (`launchd`/`systemd --user`, same
examples as "Notifications" above) to get one short OS notification
("2 incoming, 1 ready, 0 stale, 3 moved recently, worker up") instead of
text nobody's reading in a terminal — the full digest above still prints
to stdout either way. Delivering that notification over Telegram/web-push
instead of (or alongside) an OS notification is a separate item (3.3, not
started), not something `--brief` does itself.

Exit code: `1` when anything is stale, `0` otherwise — same convention as
the rest of the report.

### Running actions (`--pull`/`--retry`/`--publish`)

Section 2.1's `next:` line prints a command; `--pull`/`--retry`/`--publish`
run it, instead of you copy-pasting it into another terminal
(IMPROVEMENTS_HARNESS.md 2.3). Each is a thin wrapper, not a new business
layer — neither sync-cli's commands nor reports' publish route are
re-validated beyond what they already enforce themselves:

- `--pull <projectId:iid>` — runs `sync-cli pull-issue <name> <projectId> <iid>`.
- `--retry <projectId:iid>` — runs `sync-cli push-issue <name> <projectId> <iid>`
  (a fresh parcel for agent-runner to pick up again — `push-issue` has no
  dedup/hash-skip guard, so re-running it for the same task is already safe
  and idempotent; no separate "retry" endpoint needed).
- `--publish <projectId:iid>` — calls reports' own
  `POST /api/subscription/issues/:projectId/:iid/publish` directly (no CLI
  entry point exists for this one — HTTP is the only way in, and that route
  needs no auth at all).

`--pull`/`--retry` need the project's **local alias** (sync.config.json's
own `name`), which no task-state file carries — resolved here from
`sync.config.json`'s `gitlabProjectId` when exactly one tracked project
declares it, or by falling back to the single tracked project when there's
only one and it declares none at all (the same "no gitlabProjectId = claims
anything" rule `gitlab-worker` itself uses). Anything more ambiguous than
that refuses to guess — pass `--project <name>` instead of risking a wrong
one.

Every one of these three **requires confirmation** before doing anything:
interactively, a `[y/N]` prompt; non-interactively (no TTY on stdin,
e.g. a script or CI), it refuses outright rather than hanging — pass
`--yes` there. `--dry-run` shows exactly what would run/be called, without
running or calling it, and still surfaces a project-name resolution failure
(that's part of "what would happen" too):

```
$ pipe-status --pull 402:6 --dry-run
Would run "sync-cli pull-issue bff 402 6".

$ pipe-status --retry 173:628 --yes
# (confirmation skipped; sync-cli's own push-issue output follows, inherited directly)
```

None of these three ever touches a GitLab merge request — the project's own
"auto-merge, never" rule holds by construction, not because of a check here.

### Logging time spent (`--log-time`)

IMPROVEMENTS_HARNESS.md 4.2 — `--log-time <projectId:iid>` proposes and logs
actual time spent on a task to GitLab's own time tracking (the same
`add_spent_time` endpoint GitLab's `/spend` quick action uses), based on the
last completed push→pull cycle for that task:

```
$ pipe-status --log-time 402:6 --dry-run
Would log 2h30m spent on 402:6 to GitLab (pushed 2026-10-05T10:00:00.000Z, pulled 2026-10-05T12:30:00.000Z).
```

This reads `pushedAt`/`pulledAt` directly from reports' own
`subscription-state.json` — not a reconstruction from `events.jsonl`'s diff
log, which was tried first and turned out wrong: `events.ts` deliberately
never logs a key's very first observation (nothing to diff against yet), so
a task's *first* push→pull cycle has its pull logged but never its matching
push. reports' own state file carries both timestamps unconditionally, so
it's the only reliable source. Scoped to subscription-based tasks (reports)
only — a gitlab-worker-only flow pulls via sync-cli's `pull-issue`, which
writes no local record of a pull at all, so there's nothing to propose for
it either way.

If `pulledAt` predates `pushedAt` (a second push happened since the last
recorded pull — reports' state only overwrites the field its current step
touches, so an old `pulledAt` from an earlier finished cycle otherwise
lingers on the entry), this correctly reports nothing to propose rather than
logging a stale or negative duration:

```
$ pipe-status --log-time 123:45
No completed push→pull cycle on record for 123:45 (reports' own subscription-state.json) — nothing to propose.
```

Duration is rounded to the nearest minute and formatted in GitLab's own
syntax (`"2h30m"`, `"45m"`, never `"0m"` — GitLab rejects a zero duration).
Same confirmation rules as `--pull`/`--retry`/`--publish`: interactive
`[y/N]` prompt unless `--yes`, outright refusal (never hanging) when
non-interactive without `--yes`, and `--dry-run` short-circuits before
either. Logging itself needs sync-cli's GitLab token (`sync-cli
login-gitlab <token>`, see `sync/README.md`) — this doesn't need its own
separate credential.

Verified against this repo's real `subscription-state.json` (both the
"nothing to propose" and non-interactive-refusal paths) and, for the
success path, a synthetic fixture (the real local data at verification time
had no cycle with `pulledAt` after `pushedAt` to exercise it against).

### Exit code

`0` normally; `1` if any of the four state files failed to parse, or if any
task's derived status came back stale (both are also shown inline either
way — the exit code just makes `pipe-status` usable as a cron/CI check, not
only something you have to read).

## Interactive mode

```bash
node dist/status.js   # no options, in a real terminal
```

A navigable list (IMPROVEMENTS_HARNESS.md 2.4) instead of a wall of text —
built on [`@clack/prompts`](https://www.npmjs.com/package/@clack/prompts)
(the doc's own suggestion, over `ink`), since its `select()` is already
exactly "list + arrows + Enter" with no custom rendering to write. Every
task gets ranked the same way `--next` ranks its single pick (2.2's 4
buckets: stale → confirmed-ready → incoming → everything else with a next
action) — here as the *whole* list, not just the winner. Unlike the plain
report, this always checks `--live` internally (bridge + GitLab) — a bare
interactive invocation already means "give me the full picture," and the
one thing worth a moment's extra wait here is not missing a confirmed-ready
result or a newly assigned issue.

Pick a task, and:

- If it has a runnable next action (`pull`/`retry`/`publish` — the exact
  same `runAction` from 2.3, same confirmation requirement, just asked
  through a nicer prompt instead of `readline`), you're asked to confirm
  and it runs.
- If it has a next action that isn't runnable on your behalf (e.g.
  "investigate the failing pipeline for MR !42"), that's just shown as
  text — no confirm, nothing to run.
- If it's listed purely for being stale with nothing else to say (e.g.
  "pushed to bridge — still waiting on agent-runner" — nothing local to do,
  it's waiting on another machine), same: shown as text.

After each pick, the list re-fetches and re-ranks from scratch before
showing again — running an action changes state, so the next screen
should reflect that, not a stale snapshot from before it. `Esc`/Ctrl+C or
picking "Exit" leaves cleanly at any point.

Manually verified the real rendering and the list→confirm transition
against this machine's actual task state (a real `@clack/prompts` prompt,
not a mock); the full keystroke-by-keystroke interaction loop (arrow
navigation, declining/confirming, looping back) could not be driven
end-to-end in this environment — there's no real TTY available to script
against, and `@clack/prompts`' raw-mode key reading doesn't simulate
cleanly over a plain piped stdin. Try it directly in a real terminal to
confirm the rest.

## pipe-mcp

An MCP server (IMPROVEMENTS_HARNESS.md 5.1) wrapping everything above as
tools for Claude Code (or any other MCP client — bridge's own Chat, once it
grows tool use) instead of a human having to run `pipe-status` in a
terminal and paste the output in: `status`, `next`, `task_log`, `pull`,
`retry`, `publish` — same underlying functions, same behavior, just called
over MCP instead of argv.

```bash
npm run build   # from harness/, or via the repo root workspace
node dist/mcp.js   # runs as a stdio server — not meant to be run directly
                     # in a terminal; an MCP client spawns it
```

Register it with Claude Code:

```bash
claude mcp add pipe-mcp -- node /absolute/path/to/pipe/harness/dist/mcp.js
```

### Tools

- **`status`**/**`next`** — same `filter`/`live`/`staleHours` inputs as the
  CLI's own flags, same output text `pipe-status`/`pipe-status --next`
  would print.
- **`task_log`** — `{ key }`, same output as `pipe-status --log <key>`.
- **`pull`**/**`retry`**/**`publish`** — the same three actions as
  `--pull`/`--retry`/`--publish` (see "Running actions" above for what each
  one actually does and why no new bridge/reports endpoint was needed for
  any of them). `{ key, yes, dryRun?, project?, reportsUrl? }` — `yes` is
  **required**, not defaulted: the calling model has to explicitly decide,
  which also means a host's own tool-call approval UI shows it to the
  human before anything runs. Passing `yes: false` (or omitting it) always
  refuses, exactly like running `pipe-status --pull` outside a terminal
  without `--yes` — there's no interactive prompt inside an MCP server
  (nothing to prompt against: stdin is the JSON-RPC channel itself), so
  this explicit-argument-plus-host-approval pairing *is* the confirmation
  layer here, not a second copy of the CLI's `readline` prompt.

### Why this needed more than just registering the existing functions as tools

`actions.ts`'s `runAction` used to print directly (`console.log`) and, for
`--pull`/`--retry`, spawn `sync-cli` with `stdio: 'inherit'` — both fine for
a real terminal, both would silently corrupt an MCP stdio server's own
stdout, which *is* the JSON-RPC channel back to the client (not just cosmetic
output). Fixed by having `runAction` return `{ code, output }` instead of
printing, and giving the MCP server its own `ActionDeps.runSyncCli` that
captures a spawned sync-cli's stdout+stderr into that `output` instead of
inheriting the parent's file descriptors. `pipe-status`'s own CLI behavior
didn't change — `cli.ts`'s `main()` just prints `result.output` itself now,
and the inherited-stdio path still used there returns an empty `output`
(nothing was captured, the terminal already saw it live).

Manually verified end-to-end over the real protocol (a real
`@modelcontextprotocol/sdk` `Client` + `StdioClientTransport` spawning
`node dist/mcp.js`, not just unit tests of the handlers) — tool listing,
`status`/`next`/`task_log`, and all three write actions' refuse/dry-run/
success paths, confirming nothing on stdout was corrupted by a spawned
child's output.

## Tests

```bash
npm test   # tsc -b && node --test 'dist/**/*.test.js'
```

All of `status.ts`'s logic (`compareIssueKeys`, `parseArgs`,
`collectReportData`, `filterReportData`, `deriveStatus`, `annotateTasks`,
`exitCodeFor`, `formatReportText`, `recordTransitions`, `readTaskEvents`,
`describeSignature`, `formatTransitionNotification`) is exported and
exercised directly against fixture files in a temp directory — none of the
tests touch this machine's real sync/reports state, or its real
`~/.local/state/pipe/`. `notifyTransitions`'s own OS dispatch is not
exercised for the same reason `@pipe/protocol/notify`'s own test suite
doesn't exercise `notify()` directly — only `formatTransitionNotification`,
the pure part, is. `runAction` (`--pull`/`--retry`/`--publish`) takes its
subprocess/HTTP/confirm-prompt collaborators as injectable dependencies
(`ActionDeps`) specifically so its tests never spawn a real `sync-cli`
process, never call a real reports server, and never block on real stdin —
only `resolveProjectName`'s resolution logic and the confirmation/dry-run
control flow are exercised against fakes. `pickNextTask`/`rankTasks` (`--next`/the interactive list) are
tested as pure functions over plain `TaskEntry`/`IncomingIssue` fixtures —
bucket ordering, the confirmed-vs-guessed distinction for a `gitlab-worker`
task, tie-breaking within a bucket, and (`rankTasks` specifically) a task
that's both stale and confirmed-ready landing under `stale` once, not
twice. The interactive list's own `buildTaskChoices` (the one pure part of
`tui.ts` — see "Interactive mode" above for what wasn't mechanically
testable) is covered directly; everything else in that file is thin glue
around real `@clack/prompts` prompts. `pipe-mcp`'s own tests
(`mcp.test.ts`) connect a real `@modelcontextprotocol/sdk` `Client` to
`createPipeMcpServer()` over `InMemoryTransport.createLinkedPair()` — a
real protocol round-trip (tool listing, schema validation, the actual
JSON-RPC shape a client sees), just without a subprocess — with injectable
`paths`/`eventsPaths`/`actionDeps` pointing at fixtures instead of this
machine's real state/`sync-cli`/reports. `readRecentEvents` (`--brief`'s
"moved recently" section) is tested the same fixture-directory way
`readTaskEvents` already is. `formatBrief`/`summarizeBrief` are tested as
pure functions over a constructed `BriefSections` — `buildBrief` itself is
deliberately not: it always requests live data internally (see its own
comment), and this machine's real `sync-cli` credentials would turn that
into a genuine call against production bridge/GitLab during `npm test`;
verified manually against this machine's real state instead (see
"Morning brief" above).
