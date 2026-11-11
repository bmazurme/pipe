# infra/cloudagent — the cloud VM on the Dashboard

The cloud VM (89.169.132.49) is the first layer in [CLOUD-FIRST-PLAN.md](../../CLOUD-FIRST-PLAN.md). This agent runs **on the VM**, once a minute, and
tells bridge how the VM and the services on it are doing: the Dashboard's «Облако (VM)» tile, and a line in the header's «Что требует внимания».

```
VM: collect.py (Docker, /proc, ss, curl, files) ─▶ report.sh ─▶ POST /api/v1/boards/agent/cloud ─▶ Dashboard «Облако (VM)»
                                                    (boards-only key of the owner, the same kind infra/boardagent, nas, ups use)
```

It is **read-only**: it asks Docker (`service ls`, `ps`, `stats`, `service ps`), `ss`, `curl`, `openssl` and a few files, and changes nothing.
No report for 5 minutes is a **problem** in the tile (the VM is off, cut off, or the agent died) — at the first layer silence must be loud.

## What it reports, and what bridge says about it

| Section | Source | Verdict (`bridge/apps/backend/src/boards/cloud.ts`) |
|---|---|---|
| uptime | `/proc/uptime` | remark when the VM is younger than 10 minutes («перезагружалась N мин назад» — as on 2026-11-10) |
| memory, swap | `/proc/meminfo` | problem: available < 250 MB or < 15 %; remark: < 25 %, no swap at all, swap > 50 % used |
| disk `/` | `statvfs` | remark ≥ 80 %, problem ≥ 90 % |
| load | `/proc/loadavg` (5 min) | remark ≥ 1.5 per core, problem ≥ 3 |
| services | `docker service ls` (all Swarm services) + `CONTAINERS` | problem when a **critical** one runs fewer replicas than wanted or its health check fails; remark for a non-critical one; remark at ≥ 3 failed tasks in 24 h. A service scaled to 0 is ignored. Docker not answering = a critical service «docker» that is down |
| probes | `PROBES` (curl, 10 s) | a critical address not answering 2xx/3xx is a problem |
| exposed ports | `ss -ltn` for `EXPOSED_CHECK` (default 5432) | **problem** when such a port listens on every interface |
| standby | `REPL_CONTAINER`: `pg_stat_replication` | problem when no standby streams; remark from 60 s of lag, problem from 10 min (the RPO target is 15) |
| backups | `BACKUP_FILES`: the age of each file | remark > 26 h, problem > 50 h |
| certificates | `CERT_FILES` | remark < 14 days, problem < 5 |
| leader, version | `LEADER_FILE` («site epoch»), `VERSION_FILE` | shown only (the leader mechanism and the drift check come later in the plan) |

Memory per service is `docker stats` summed over a service's tasks. A service «critical» is one whose name matches `CRITICAL_REGEX`
(default `^(bridge_|bridge-pg)`); plain containers named in `CONTAINERS` are critical unless written `name:opt`.

`EXPOSED_CHECK` looks at what listens on the host. Swarm's published ports (`*:3300->3000`) are done by Docker's own rules and may not show in
`ss`; those are checked from outside (the plan's Stage 1: `nmap` from another machine).

## Install (on the VM, once)

```bash
scp -r infra/cloudagent USER@VM:/tmp/ && ssh -t USER@VM 'sudo bash /tmp/cloudagent/install.sh'
ssh -t USER@VM 'sudoedit /etc/pipe-cloudagent.env'    # BRIDGE_API_KEY = a boards-only key of the OWNER (bridge: Профиль → API-ключи → «только для плат»)
ssh -t USER@VM 'sudo systemctl start pipe-cloudagent.service && sudo journalctl -u pipe-cloudagent.service -n 5 --no-pager'
```

Without the key `report.sh` sends nothing and says so. `BRIDGE_API_URL` is the **public** address on purpose: after a failover the VM must report
to whoever leads, not to its own old database. `install.sh --dry-run` shows what it would do; `--remove` takes the agent away and leaves
`/etc/pipe-cloudagent.env` (and the key in it) for you to delete.

Not part of `infra/boardagent`'s update manifest: the VM is not a board. Update it by copying the folder again and running `install.sh` (idempotent).

## Tests

`bash infra/cloudagent/test.sh` — fake `docker`, `curl`, `ss`, `openssl` and a fake `/proc`; nothing outside a temp directory is touched (CI runs it).
