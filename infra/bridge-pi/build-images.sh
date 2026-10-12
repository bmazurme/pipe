#!/usr/bin/env bash
#
# Builds the arm64 images from this checkout and loads them straight into the primary node (no registry):
#
#   infra/bridge-pi/build-images.sh [host]       # host defaults to white, 192.168.50.11
#
# Run it on an arm64 machine (Apple silicon builds natively; elsewhere use PR #222's GHCR workflow instead).
# The tag is the commit id; the working tree must be clean so the tag really identifies what was built.
set -euo pipefail

HOST="${1:-192.168.50.11}"
API_URL="${VITE_API_URL:-https://api.bridge.ntlstl.dev}"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "tracked files have uncommitted changes — commit first (the tag is the commit id)" >&2; exit 1; }
TAG="$(git rev-parse --short=10 HEAD)"

echo "== backend $TAG"
docker build --platform linux/arm64 -f bridge/apps/backend/Dockerfile -t "localhost/pipe/bridge-backend:$TAG" bridge
echo "== frontend $TAG (API $API_URL)"
docker build --platform linux/arm64 -f bridge/apps/frontend/Dockerfile --build-arg VITE_API_URL="$API_URL" \
  -t "localhost/pipe/bridge-frontend:$TAG" .

echo "== loading into $HOST"
docker save "localhost/pipe/bridge-backend:$TAG" "localhost/pipe/bridge-frontend:$TAG" | ssh "pi@$HOST" 'docker load'
ssh "pi@$HOST" "mkdir -p ~/.pipe && echo $TAG > ~/.pipe/image-tag"
echo "done: tag $TAG"
