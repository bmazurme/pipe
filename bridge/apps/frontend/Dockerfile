# Build context is the pipe monorepo root, not bridge/ — apps/frontend
# depends on @pipe/protocol via "file:../../../packages/protocol"
# (see apps/frontend/package.json), which resolves to packages/protocol at
# the monorepo root and is outside a context scoped to bridge/ alone. Built
# with:
#   docker build -f bridge/apps/frontend/Dockerfile -t bridge-frontend .
FROM node:22-alpine AS builder
WORKDIR /app
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
# node:22-alpine bundles npm 10.9.8, which has a bug resolving nested
# optionalDependencies (e.g. vitest's own esbuild copy) that makes npm ci
# wrongly reject platform packages with EBADPLATFORM. npm 11+ fixes it.
RUN npm install -g npm@11

# @pipe/protocol has no lockfile of its own (it's a pipe root workspace
# member) — a plain install+build here is fine, since only the resulting
# dist/ needs to exist for bridge's own npm ci below to pick it up through
# its file: dependency, exactly as it resolves in the real monorepo.
COPY packages/protocol packages/protocol
RUN npm install --prefix packages/protocol && npm run build --prefix packages/protocol

COPY bridge/package.json bridge/package-lock.json bridge/
COPY bridge/apps/backend/package.json bridge/apps/backend/package.json
COPY bridge/apps/frontend/package.json bridge/apps/frontend/package.json
WORKDIR /app/bridge
RUN npm ci

COPY bridge/apps/frontend apps/frontend
RUN npm run build -w frontend

FROM nginx:alpine
COPY --from=builder /app/bridge/apps/frontend/dist /usr/share/nginx/html
COPY bridge/apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
