# pipe

[![CI](https://github.com/bmazurme/pipe/actions/workflows/ci.yml/badge.svg)](https://github.com/bmazurme/pipe/actions/workflows/ci.yml)
[![Deploy bridge](https://github.com/bmazurme/pipe/actions/workflows/deploy-bridge.yml/badge.svg)](https://github.com/bmazurme/pipe/actions/workflows/deploy-bridge.yml)

Monorepo for the sync/reports/bridge ecosystem: three tools that together
move a task from GitLab to a working branch and back.

```
GitLab issue → sync-cli or reports' Subscription module
             → anonymized parcel (zip + manifest)
             → bridge storage
             → agent / human, on the other machine
             → parcel back → bridge storage → pulled and de-anonymized
```

## Structure

| Path | What it is |
|---|---|
| [`sync/`](sync/) | CLI — pushes/pulls project trees or single GitLab issues as "parcels" through bridge |
| [`reports/`](reports/) | Web app; its `Subscription` module is reports' own side of the parcel flow |
| [`bridge/`](bridge/) | Storage relay + auth both other tools sit on top of |
| [`packages/protocol/`](packages/protocol/) | Shared parcel format (dictionary substitution, zip/manifest, encryption, project walk) |
| [`harness/`](harness/) | `pipe-status` — one merged view of sync's and reports' local task state |
| [`worker/`](worker/) | Standalone service (installs on Ubuntu) — runs Claude/GPT/DeepSeek/Qwen against a parcel assigned from bridge's Worker page |

Each has its own README with setup/usage detail. **[ECOSYSTEM.md](ECOSYSTEM.md)**
covers what spans them: ports, secrets, state files, and the roadmap.

## CI/CD

- **`ci.yml`** — build + test all four workspaces on every push/PR.
- **`deploy-bridge.yml`** — builds bridge's images and deploys them to the
  production Docker Swarm stack. Currently `workflow_dispatch`-only (run
  manually from the Actions tab); see the workflow file's header comment
  for the full secrets checklist before running it on a fresh setup.

Both workflows (and the nightly ones) run on `ubuntu-latest` by default. To run
them on your own machine instead — no GitHub-hosted minutes, so no billing
dependency — set up a self-hosted runner with
[`bridge/deploy/runner/setup.sh`](bridge/deploy/runner/setup.sh) (Linux + Docker)
and set the repo variable `RUNNER_LABEL` to its label (`pipe-runner`). Unset the
variable to go back to GitHub-hosted. A self-hosted runner executes PR code on
that machine, so keep the repo private or require approval for fork PRs.
