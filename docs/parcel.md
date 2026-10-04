# The parcel format: versioning, leak-scan, images, addressing

Part of [ECOSYSTEM.md](../ECOSYSTEM.md)'s cross-cutting detail — see that
file for the full index.

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
([commands/push.ts](../sync/src/commands/push.ts),
[commands/pushIssue.ts](../sync/src/commands/pushIssue.ts)) and reports'
`handlePushSubscriptionIssue`
([subscription/handler.ts](../reports/packages/server/src/subscription/handler.ts)),
printing a warning (via `formatLeakFindings`) for anything that still looks
real. It is advisory only by default, not a hard gate — it doesn't block the
push or throw — because the heuristic has real false-positive and
false-negative rates (see `packages/protocol/src/leakScan.ts` for the exact
allowlists/thresholds and their reasoning). An opt-in strict mode exists on
top of that advisory default: sync's `--strict` flag
(`push`/`push-issue`/`gitlab-worker`) and reports' `leakScanStrict` setting
both abort the push instead of just warning when the scan finds something
(see IMPROVEMENTS_TECH.md 1.5). Neither leak-scan mode runs in
`agent-runner`, which is deliberately dictionary-free by design (see
sync's README) — there's no "did the dictionary miss something" question to
ask when no dictionary is in play. Images are a separate gap: the scan is
text-pattern based and never looks at `__issue_assets__/` content at all —
both push paths warn "N images were not leak-scanned" so that gap is at
least visible, rather than silently assumed covered.

## Issue images, and reviewing before dispatch

Two additions to the same issue-parcel flow:

- **Images embedded in an issue description travel in the parcel now.**
  `@pipe/protocol`'s `buildArchive`/`extractArchive`
  ([pack.ts](../packages/protocol/src/pack.ts)) accept an additive `assets`
  list — binary content zipped under a reserved `__issue_assets__/` prefix,
  base64 in/out, never round-tripped through the lossy UTF-8 string path
  `PackedFile.content` uses (bumped `PROTOCOL_SCHEMA_VERSION` to `2`, since a
  v1 reader has no code path for that prefix). Both push paths — reports'
  `handlePushSubscriptionIssue`
  ([subscription/handler.ts](../reports/packages/server/src/subscription/handler.ts))
  and sync's `buildAndUploadIssueParcel`
  ([commands/pushIssue.ts](../sync/src/commands/pushIssue.ts)) — call their own
  `getIssueImages()` (mirrored in each product's `gitlab-client.ts`,
  same duplication pattern as the rest of this flow) to pull `![]()` image
  refs out of the description
  ([markdownImages.ts](../packages/protocol/src/markdownImages.ts), pure
  parsing shared by both) and download whichever are relative or same-origin
  as the configured GitLab instance — a link to some other host is left
  alone. On the receiving end, sync's `extractIssue`
  ([issuePack.ts](../sync/src/issuePack.ts)) writes them to `issue-images/` in
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
  with `--watch` ([reviewPrompt.ts](../sync/src/reviewPrompt.ts)).

## Multi-parcel addressing

Storage is a "mailbox for one recipient" — clients have always matched a
task to its parcel by filename pattern (`${projectId}-${iid}.subscription.zip`),
client-side, with bridge having no concept of addressing at all. With
`gitlab-worker` producing several task parcels in a row (no longer
human-paced), this was a real, not theoretical, gap.

**Done** ([IMPROVEMENTS_TECH.md 2.3](improvements/IMPROVEMENTS_TECH.md)):
`StoredFile` carries optional `channel`/`taskKey`/`direction` columns
(migration `1790800000000-AddStoredFileAddressing`), and `GET /api/v1/storage`
accepts matching `?channel=&taskKey=&direction=` query filters — all
additive, nothing required, a plain upload/list with no addressing metadata
behaves exactly as before. Both the writing and the reading side now use it:

- **Writing**: sync's `pushIssueCommand`/`gitlab-worker` upload with
  `direction: 'outbound'`, `agentRunner.ts` uploads its result with
  `direction: 'result'` ([bridgeClient.ts](../sync/src/bridgeClient.ts)'s
  `upload()`); reports' `handlePushSubscriptionIssue` does the same
  (`direction: 'outbound'`,
  [bridge-client.ts](../reports/packages/server/src/subscription/bridge-client.ts)'s
  `uploadParcel()`). All four set `channel: 'issue'` and
  `taskKey: "${projectId}:${iid}"`.
- **Reading**: sync's `pull-issue` and reports' `handlePullSubscriptionIssue`
  both now call `listFiles()`/`listParcels()` with
  `{channel: 'issue', taskKey: "${projectId}:${iid}", direction: 'result'}`
  instead of matching `originalName` against a precomputed filename — which
  couldn't otherwise tell a task's *result* apart from its own outbound
  parcel (both are uploaded under the exact same filename pattern,
  `issueParcelName()`/`parcelName()`), if the outbound one were ever still
  sitting in storage when the result arrives. `gitlab-worker` has no pull
  logic of its own — `pull-issue` closing its loop was already covered by
  the fix above. Encrypted-vs-plain detection moved from an exact filename
  comparison to `originalName.endsWith('.enc')`, since there's now exactly
  one relevant candidate (the filter already excludes everything else) to
  check.

**Deliberately not touched**: `agentRunner.ts`'s own *incoming*-candidate
matching (`findCandidates`, matching by filename regex to recover
`projectId`/`iid`/`encrypted` from the name) still doesn't filter by
`direction: 'outbound'` server-side. It already has a separate, narrower
safety net for the adjacent risk (reprocessing its own prior result) — a
content-hash check against `agentState.ts`'s `lastOwnOutputHash` — and
widening it to use addressing too was out of this item's stated scope
(`pull-issue`/`gitlab-worker`/reports' Subscription specifically).
