# GitLab worker + ready notifications, and reports' pull/commit/push

Part of [ECOSYSTEM.md](../ECOSYSTEM.md)'s cross-cutting detail — see that
file for the full index.

## GitLab worker + ready notifications

Closes the two remaining manual steps around the parcel pipeline: noticing
a new assigned GitLab issue, and noticing when its result is ready to pull.
`agent-runner` already automated the *middle* of the pipeline (polls
bridge, creates a worktree+branch, runs Claude, pushes the result back —
see [commands/agentRunner.ts](../sync/src/commands/agentRunner.ts)); this
adds the front and back:

- **`sync-cli gitlab-worker <name> [--watch <seconds>]`**
  ([commands/gitlabWorker.ts](../sync/src/commands/gitlabWorker.ts)) — polls
  GitLab for open issues assigned to you on the tracked project
  ([gitlabClient.ts](../sync/src/gitlabClient.ts)'s new
  `listAssignedOpenIssues`), and for each one not already sent
  ([gitlabWorkerState.ts](../sync/src/gitlabWorkerState.ts) tracks that,
  `.gitlab-worker-state.json`, gitignored), pushes it as a parcel — the same
  build-anonymize-scan-upload core `push-issue` already used, extracted into
  `buildAndUploadIssueParcel` in
  [commands/pushIssue.ts](../sync/src/commands/pushIssue.ts) so both share it.
  No git branch/worktree operation happens on the sending side: agent-runner
  already creates the real task branch itself from `baseBranch` once the
  parcel arrives, so the sender only needs a synthetic
  `task/<projectId>-<iid>` label for addressing.
- **`sync-cli pull-issue <name> <projectId> <iid> --watch <seconds>`**
  ([commands/pullIssue.ts](../sync/src/commands/pullIssue.ts)) — polls until a
  result parcel appears, then pulls it and fires a notification, instead of
  the human re-running `pull-issue` by hand to check.
- **[notify.ts](../sync/src/notify.ts)**: best-effort OS notification (macOS
  `osascript`, Linux `notify-send`, console fallback everywhere else) used
  by both of the above. Never blocks or fails the actual push/pull.

**Deliberately not touched**: `agent-runner`'s own "result ready"
notification (i.e. notifying *from* the machine that ran the agent, in
addition to the *waiting* side above) — the standalone `sync` repo had
real uncommitted work on `agentRunner.ts`/`gitWorktree.ts`/`agentState.ts`
at the time (its `AgentRunnerState.pending` field already hinted at an
unfinished confirm-before-send flow), so this lived in new files plus one
appended command block in `cli.ts`, rather than adding to files already
mid-edit elsewhere.

## reports' pull commits and pushes the task branch — never the target branch

`handlePullSubscriptionIssue`
([subscription/handler.ts](../reports/packages/server/src/subscription/handler.ts))
used to only write the parcel's files to disk, leaving them uncommitted —
picking them up into an actual branch was entirely manual. It now also
commits and pushes, via two new functions in
[subscription/git.ts](../reports/packages/server/src/subscription/git.ts):

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

## Cross-repo E2E pipeline test

[scripts/e2e-cross-repo-pipeline.mjs](../scripts/e2e-cross-repo-pipeline.mjs)
(`npm run e2e:cross-repo` from the repo root) exercises the real
sync→bridge→worker→pull flow with the actual built artifacts of bridge and
worker as separate processes talking only over HTTP — the same shape they
run in production, not an in-process shortcut. It builds a minimal
sync-shaped parcel via `@pipe/protocol`, uploads it to a live bridge
instance's Storage, creates a Worker job (`model: gpt`), runs one
claim-and-execute cycle (worker's new `runOnce.ts` entry point — a single
deterministic pass, instead of `index.ts`'s poll loop, so the test doesn't
depend on poll-interval timing) against a local fake OpenAI-compatible HTTP
server standing in for a real provider, then downloads and verifies the
result parcel carries the fake model's actual file edit. The throwaway test
user and personal API key are seeded directly through bridge's own
`UsersService`/`ApiKeysService` (a new `e2e:seed-user` script in
`bridge/apps/backend`), not through OAuth — bridge intentionally has no
public "create an arbitrary user" endpoint. Runs nightly in CI
([nightly-cross-repo-e2e.yml](../.github/workflows/nightly-cross-repo-e2e.yml)),
not on every push, for the same reason the Cypress reports suite is nightly
rather than per-push: it boots three real processes and is slower and more
failure-prone than the unit suites already running on every push.
