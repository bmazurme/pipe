# Build context is the repo root (npm workspaces share a single lockfile),
# so this is built with:
#   docker build -f apps/backend/Dockerfile -t bridge-backend .
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN npm ci

COPY apps/backend apps/backend
RUN npm run build -w backend
# Guarantees the path exists below even when npm hoists every backend dep to
# the root node_modules and leaves nothing to nest here.
RUN mkdir -p apps/backend/node_modules

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=builder /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist

EXPOSE 3000
CMD ["node", "apps/backend/dist/main"]
