# infra/monitor — resources of every board, and a watch over the primary

Two small things that were missing (the alerts that existed covered backups, the replica and deploys, not resources or the death of white):

| What | Where | How often | What it says |
|---|---|---|---|
| `resource-check.sh` | **every board** (`pipe-resource-check.timer`) | 5 min | load, memory, disk, heat/throttling/under-voltage, Swarm membership — only when a problem **stays** (2 runs ≈ 10 min), every 6 h while it lasts, and "fixed" when it ends |
| `primary-watch.sh` | **blue only** (`pipe-primary-watch.timer`, `install.sh --watch-primary`) | 1 min | the board that holds the stack (label `bridge-primary`) stopped answering: after 3 bad minutes — what it saw, how old the replica is, and the **exact command** to switch over |

The watch does **not** switch by itself: `failover.sh` needs your age key and the typed word FAILOVER (`docs/ha-dr-plan.md` §8). It judges nothing when *it* is the one cut off (no gateway, no other board answers), so a network blip of the watcher is not an alarm about white. After a failover (primary = red) it does not suggest failing over again.

## Thresholds (`resource-check.sh`, overridable by environment)

From the capacity analysis (idle boards: 1–3 % CPU, 7–9 % RAM, 9–28 % disk, 47–52 °C): load15 per core > 0.6; MemAvailable < 25 %; root disk ≥ 80 %; SoC ≥ 75 °C or throttling/under-voltage *right now* (the sticky "happened since boot" bits are ignored); Swarm state ≠ active.

## Install

Needs `/usr/local/bin/notify-telegram` (`infra/notify`). white and red have it; **blue and green do not** — from your workstation, once:

```bash
infra/notify/copy-to-board.sh 192.168.50.13 192.168.50.14   # copies the bot settings board→board, never printed; sends a test message
```

Then on each board: `scp -r infra/monitor pi@HOST:/tmp/ && ssh -t pi@HOST 'sudo bash /tmp/monitor/install.sh'` — and on **blue only** add `--watch-primary`. Idempotent; `--dry-run` shows what it would do. Not on white (it cannot see its own death) and not on red (it is the replica).

## Tests

`docker run --rm -v "$PWD":/r debian:bookworm-slim bash /r/infra/monitor/test.sh` (31 checks: the alert state machine, every threshold, the watch's decisions, the installer).
