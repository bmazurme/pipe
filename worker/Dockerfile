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
RUN addgroup -S pipe-worker && adduser -S pipe-worker -G pipe-worker

# The claude CLI — same package Worker jobs and chat sonnet/opus turns spawn
# on a bare-metal install. Needs a real npm registry install, not file-copied
# from the builder stage (it's a separate published package, not part of
# this repo).
RUN npm install -g @anthropic-ai/claude-code

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/worker/package.json ./package.json
COPY --from=builder /app/worker/dist ./dist
# node_modules/@pipe/protocol is a symlink pointing at ../packages/protocol
# relative to the monorepo root the builder stage had — it breaks once only
# node_modules/ is copied into this stage. Replace it with the real,
# already-built package (same fix this Dockerfile already needed under the
# old file: dependency).
COPY --from=builder /app/packages/protocol /app/node_modules/@pipe/protocol

RUN mkdir -p /app/.worker-work && chown -R pipe-worker:pipe-worker /app
USER pipe-worker

CMD ["node", "dist/index.js"]
