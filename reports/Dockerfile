# Build context is the pipe monorepo root, not reports/ — packages/server
# depends on @pipe/protocol via "file:../../../packages/protocol" (see
# packages/server/package.json), which resolves to packages/protocol at the
# monorepo root and is outside a context scoped to reports/ alone. Built
# with:
#   docker build -f reports/Dockerfile -t reports .
FROM node:22-alpine AS builder
WORKDIR /app
# node:22-alpine bundles npm 10.9.8, which has a bug resolving nested
# optionalDependencies (e.g. vitest's own esbuild copy) that makes npm ci
# wrongly reject platform packages with EBADPLATFORM. npm 11+ fixes it.
RUN npm install -g npm@11

# @pipe/protocol has no lockfile of its own (it's a pipe root workspace
# member) — a plain install+build here is fine, since only the resulting
# dist/ needs to exist for reports' own npm ci below to pick it up through
# its file: dependency, exactly as it resolves in the real monorepo.
COPY packages/protocol packages/protocol
RUN npm install --prefix packages/protocol && npm run build --prefix packages/protocol

COPY reports/package.json reports/package-lock.json reports/
COPY reports/packages/client/package.json reports/packages/client/package.json
COPY reports/packages/server/package.json reports/packages/server/package.json
COPY reports/packages/shared reports/packages/shared
WORKDIR /app/reports
RUN npm ci

COPY reports/packages/server packages/server
COPY reports/packages/client packages/client
RUN npm run build --workspace=packages/client

FROM node:22-alpine
WORKDIR /app/reports
ENV NODE_ENV=production
# The container's own network namespace is the real isolation boundary here
# — binding to 127.0.0.1 *inside* the container would make the process
# unreachable even through Docker's own port publishing. docker-compose.yml
# is what actually restricts host-level exposure, by publishing only to
# 127.0.0.1 on the host.
ENV HOST=0.0.0.0

# @pipe/protocol is a file: dependency — npm installs it as a symlink into
# node_modules pointing at ../../packages/protocol (relative to reports/,
# i.e. /app/packages/protocol). The symlink itself is copied below with
# node_modules, but the real files it points at have to exist at that same
# absolute path in this stage too, or requiring it fails at runtime.
COPY --from=builder /app/packages/protocol/package.json /app/packages/protocol/package.json
COPY --from=builder /app/packages/protocol/dist /app/packages/protocol/dist
COPY --from=builder /app/packages/protocol/node_modules /app/packages/protocol/node_modules

COPY --from=builder /app/reports/package.json ./package.json
COPY --from=builder /app/reports/node_modules ./node_modules
COPY --from=builder /app/reports/packages/server ./packages/server
COPY --from=builder /app/reports/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/reports/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/reports/packages/client/dist ./packages/client/dist

EXPOSE 4000
CMD ["npx", "tsx", "packages/server/src/index.ts"]
