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
  sync's and reports' local task state (see [docs/state.md](docs/state.md)).
- **[worker/](worker/)** — standalone service (installs on an Ubuntu
  server): polls bridge for work along two independent channels — Worker
  jobs (a parcel + an assigned model; runs Claude/GPT/DeepSeek/Qwen against
  it and reports status/logs/result back, the bridge-hosted counterpart to
  `sync-cli agent-runner`) and bridge's Chat section (a plain conversation
  with the same five models, no parcel, no file editing). One process/
  systemd unit serves both.

Each product's own README has the full detail; this file only covers what
spans all three — split by topic into `docs/`, since the single-file
version of this had grown past the point of being easy to navigate:

- **[docs/auth.md](docs/auth.md)** — unified machine auth (personal API
  keys alongside bridge's OAuth flow) and rate limiting.
- **[docs/parcel.md](docs/parcel.md)** — manifest schema versioning, the
  anonymization/leak-scan completeness check, issue images, reviewing
  before dispatch, and multi-parcel addressing.
- **[docs/state.md](docs/state.md)** — every state file each product keeps,
  how tasks are keyed, and how `harness` merges them.
- **[docs/deploy.md](docs/deploy.md)** — ports & local dev, and the full
  secrets/env-var table for every product.
- **[docs/workflows.md](docs/workflows.md)** — the GitLab worker + ready
  notifications, and reports' pull-commits-and-pushes-the-task-branch flow.
- **[docs/roadmap.md](docs/roadmap.md)** — what's deliberately not built
  yet, and why.
