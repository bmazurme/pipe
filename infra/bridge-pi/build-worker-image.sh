#!/usr/bin/env bash
#
# Builds the arm64 worker image from this checkout and loads it into green (where the worker runs):
#
#   infra/bridge-pi/build-worker-image.sh [host]      # default green, 192.168.50.14
#
# Same rules as build-images.sh: arm64 machine, clean working tree, tag = commit id. The tag is also written
# to ~/.pipe/worker-image-tag on white (where deploy-worker.sh runs).
set -euo pipefail

HOST="${1:-192.168.50.14}"
MANAGER="${MANAGER:-192.168.50.11}"
cd "$(git rev-parse --show-toplevel)"
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "tracked files have uncommitted changes — commit first (the tag is the commit id)" >&2; exit 1; }
TAG="$(git rev-parse --short=10 HEAD)"

docker build --platform linux/arm64 -f worker/Dockerfile -t "localhost/pipe/bridge-worker:$TAG" .
docker save "localhost/pipe/bridge-worker:$TAG" | ssh "pi@$HOST" 'docker load'
ssh "pi@$MANAGER" "mkdir -p ~/.pipe && echo $TAG > ~/.pipe/worker-image-tag"
echo "done: worker tag $TAG on $HOST"
