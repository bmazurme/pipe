# Build context is the pipe monorepo root, not worker/ — worker is a real
# npm workspace member (IMPROVEMENTS_TECH.md 5.1), resolving @pipe/protocol
# through the root's single package-lock.json rather than a "file:"
# dependency. Built with:
#   docker build -f worker/Dockerfile -t pipe-worker .
FROM node:22-alpine AS builder
WORKDIR /app
RUN npm install -g npm@11

# npm ci validates the lockfile against every workspace listed in the root
# package.json, so every workspace member's own package.json has to be
# present even though this image only ever runs worker's code — sync's and
# harness's actual source isn't needed here, just their manifests (their
# production dependencies do end up hoisted into node_modules alongside
# worker's own either way — true npm workspaces don't install per-workspace
# without extra tooling; an acceptable size/build-time cost for now).
COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY harness/package.json harness/package.json
COPY sync/package.json sync/package.json
COPY worker/package.json worker/package.json
RUN npm ci

COPY packages/protocol/src packages/protocol/src
COPY packages/protocol/tsconfig.json packages/protocol/tsconfig.json
RUN npm run build --workspace=packages/protocol

COPY worker/src worker/src
COPY worker/tsconfig.json worker/tsconfig.json
RUN npm run build --workspace=worker

# devDependencies (typescript, eslint, @types/*) were only needed to reach
# dist/ above — stripped before the runtime image copies node_modules out.
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app

# Per claudeRunner.ts's own warning: --dangerously-skip-permissions runs
# unattended, so this must never run as a shared/admin account — a dedicated
# unprivileged container user is the containerized equivalent of the
# dedicated `pipe-worker` OS user the bare-metal install (see
# systemd/pipe-worker.service) uses for the same reason.
#
# The ids are PINNED to what the image has always had (adduser -S hands them out in this order from 100/101): a named volume made by an older image
# keeps its files owned by these numbers, and a worker under another uid could not read its own key.
#
# A second user for the claude CLI (WORKER_RUN_AS=pipe-runner): job code is arbitrary code execution, so it must not run as the user that owns the
# worker's key and VPN config in .worker-state. Both users share the group pipe-jobs, which owns the work directory.
#
# How the worker switches to it (S1): NOT sudo. sudo is a setuid binary, which `no-new-privileges` forbids and `--cap-drop ALL` starves, so a hardened
# container could not use it. The entrypoint (docker-entrypoint.sh) starts the worker as pipe-worker with only CAP_SETUID/CAP_SETGID, and the worker
# starts job code through `setpriv`, which drops every capability first (worker/src/runAs.ts, WORKER_RUN_AS_VIA=setpriv).
RUN addgroup -S -g 101 pipe-worker && adduser -S -u 100 -G pipe-worker pipe-worker \
 && addgroup -S -g 102 pipe-jobs && adduser -S -u 101 -h /home/pipe-runner -G pipe-jobs pipe-runner \
 && mkdir -p /home/pipe-runner && chown pipe-runner:pipe-jobs /home/pipe-runner && chmod 0700 /home/pipe-runner \
 && addgroup pipe-worker pipe-jobs && addgroup pipe-runner pipe-jobs \
 && apk add --no-cache setpriv \
 && id -u pipe-worker | grep -qx 100 && id -u pipe-runner | grep -qx 101 && getent group pipe-jobs | grep -q ':102:'

# A3: the check the worker runs on a result before it leaves (scripts/verify-changed.mjs of the job's own repository). It executes the code the model
# just wrote, so it too runs as pipe-runner, through this one root-owned wrapper. `--probe` lets the worker tell «the image has no wrapper» from «a
# check failed».
RUN printf '%s\n' '#!/bin/sh' 'set -eu' '[ "${1:-}" = "--probe" ] && exit 0' 'cd "$1"' 'exec /usr/local/bin/node scripts/verify-changed.mjs' > /usr/local/bin/pipe-verify \
 && chmod 0755 /usr/local/bin/pipe-verify && chown root:root /usr/local/bin/pipe-verify

# The claude CLI — same package Worker jobs and chat sonnet/opus turns spawn
# on a bare-metal install. Needs a real npm registry install, not file-copied
# from the builder stage (it's a separate published package, not part of
# this repo).
RUN npm install -g @anthropic-ai/claude-code

# Claude Code's Bash tool needs bash (busybox sh is not enough), and the Improve jobs it runs need git and
# ripgrep (its search tool). Without them every command fails with "No suitable shell found": the model then
# cannot run the linter or the tests, and the pull requests it opens reach CI unformatted and with broken
# tests. The check after the install fails the build instead of shipping such an image again.
RUN apk add --no-cache bash git ripgrep \
 && bash --version >/dev/null && git --version >/dev/null && rg --version >/dev/null

# The worker's own VPN (Worker page → settings → VPN): a vless:// Reality link becomes a local Xray tunnel run by the worker
# itself, so no separate vpn-client container is needed next to it. One static binary from the official image (pinned;
# multi-arch), nothing else from it.
COPY --from=ghcr.io/xtls/xray-core:26.3.27 /usr/local/bin/xray /usr/local/bin/xray

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/worker/package.json ./package.json
COPY --from=builder /app/worker/dist ./dist
# node_modules/@pipe/protocol is a symlink pointing at ../packages/protocol
# relative to the monorepo root the builder stage had — it breaks once only
# node_modules/ is copied into this stage. Replace it with the real,
# already-built package (same fix this Dockerfile already needed under the
# old file: dependency).
COPY --from=builder /app/packages/protocol /app/node_modules/@pipe/protocol

# .worker-state holds the key a worker added in the UI receives at enrolment — mount a volume there so a restart or a new
# image keeps it (the named volume inherits this directory's ownership).
RUN mkdir -p /app/.worker-work /app/.worker-state \
 && chown -R pipe-worker:pipe-worker /app \
 && chown pipe-worker:pipe-jobs /app/.worker-work \
 && chmod 0700 /app/.worker-state \
 && chmod 2770 /app/.worker-work
ENV WORKER_STATE_DIR=/app/.worker-state
# Job code (claude --dangerously-skip-permissions: arbitrary code driven by task text) runs as pipe-runner, which cannot read the worker's key or VPN
# config in .worker-state. On by default; the worker refuses to start if the user switch above does not work, so a broken image fails loudly. To run
# jobs as the worker's own user anyway (not advised), start the container with -e WORKER_RUN_AS= (empty).
ENV WORKER_RUN_AS=pipe-runner
ENV WORKER_RUN_AS_VIA=setpriv
ENV WORKER_RUN_AS_GROUP=pipe-jobs

# Root only until the entrypoint has dropped to pipe-worker (see docker-entrypoint.sh); an image run with --user skips that step.
COPY worker/docker-entrypoint.sh /usr/local/bin/pipe-entrypoint
RUN chmod 0755 /usr/local/bin/pipe-entrypoint && chown root:root /usr/local/bin/pipe-entrypoint
USER root
ENTRYPOINT ["/usr/local/bin/pipe-entrypoint"]
CMD ["node", "dist/index.js"]
