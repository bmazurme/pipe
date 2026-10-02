# Build context is the pipe monorepo root, not worker/ — worker depends on
# @pipe/protocol via "file:../packages/protocol" (see package.json), which
# resolves to packages/protocol at the monorepo root. Built with:
#   docker build -f worker/Dockerfile -t pipe-worker .
FROM node:22-alpine AS builder
WORKDIR /app
RUN npm install -g npm@11

# @pipe/protocol has no lockfile of its own (it's a pipe root workspace
# member) — a plain install+build here is fine, since only the resulting
# dist/ needs to exist for worker's own npm ci below to pick it up through
# its file: dependency, exactly as it resolves in the real monorepo.
COPY packages/protocol packages/protocol
RUN npm install --prefix packages/protocol && npm run build --prefix packages/protocol

COPY worker/package.json worker/package-lock.json worker/
WORKDIR /app/worker
RUN npm ci

COPY worker/src src
COPY worker/tsconfig.json .
RUN npm run build

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

COPY --from=builder /app/worker/package.json ./package.json
COPY --from=builder /app/worker/node_modules ./node_modules
COPY --from=builder /app/worker/dist ./dist
# node_modules/@pipe/protocol above is a symlink the builder's npm ci created
# for the file: dependency, relative to the builder's own directory layout —
# it breaks once copied here. Replace it with the real, already-built package.
COPY --from=builder /app/packages/protocol /app/node_modules/@pipe/protocol

RUN mkdir -p /app/.worker-work && chown -R pipe-worker:pipe-worker /app
USER pipe-worker

CMD ["node", "dist/index.js"]
