#!/usr/bin/env bash
#
# Puts a static landing page into the `landing_site` volume that Caddy serves for LANDING_HOST (Caddyfile) — the same thing
# bridge's «Промо → Лендинг» page does from a zip; this is the way from a terminal.
# Run it from the workstation that has the page; it needs ssh to white and nothing else — the page is not in git or in an image.
#
#   infra/bridge-pi/deploy-landing.sh /path/to/landing.html            # → index.html, plus every local file it references
#   WHITE=pi@192.168.50.11 infra/bridge-pi/deploy-landing.sh page.html
#
# Only files the page references with src="…" / href="…" / poster="…" (relative paths, no `..`) are copied, so a folder with drafts and
# source material next to the page never goes public by accident.
set -euo pipefail

PAGE="${1:?usage: deploy-landing.sh /path/to/landing.html}"
WHITE="${WHITE:-pi@192.168.50.11}"
VOLUME="${LANDING_VOLUME:-bridge_landing_site}"
IMAGE="${LANDING_TOOL_IMAGE:-caddy:2-alpine}"   # already on the board: has sh and tar, nothing to pull

[ -f "$PAGE" ] || { echo "no such file: $PAGE" >&2; exit 1; }
SRC="$(cd "$(dirname "$PAGE")" && pwd)"
NAME="$(basename "$PAGE")"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp "$PAGE" "$STAGE/index.html"

# relative local references only: not http(s)://, //, data:, mailto:, #anchors, absolute paths or anything with ..
# the page's inline CSS may load fonts and images with url(…) as well
refs="$( { grep -oE '(src|href|poster)="[^"]+"' "$PAGE" | sed -E 's/^(src|href|poster)="//; s/"$//'
           grep -oE 'url\([^)]+\)' "$PAGE" | sed -E "s/^url\\(//; s/\\)\$//; s/^[\"']//; s/[\"']\$//"
         } | sed -E 's/[?#].*$//' \
  | grep -vE '^(https?:|//|data:|mailto:|tel:|/|#|$)' | grep -vE '(^|/)\.\.(/|$)' | sort -u || true)"
missing=0
while IFS= read -r ref; do
  [ -n "$ref" ] || continue
  if [ -f "$SRC/$ref" ]; then
    mkdir -p "$STAGE/$(dirname "$ref")"
    cp "$SRC/$ref" "$STAGE/$ref"
  else
    echo "referenced but missing next to $NAME: $ref" >&2
    missing=1
  fi
done <<< "$refs"
[ "$missing" = 0 ] || { echo "not publishing: fix the missing files first" >&2; exit 1; }

echo "publishing $(find "$STAGE" -type f | wc -l | tr -d ' ') files ($(du -sh "$STAGE" | cut -f1)) to $WHITE:$VOLUME"
( cd "$STAGE" && find . -type f | sort | sed 's/^\.\//  /' )

# The volume holds releases/<name>/ (one directory per version) and `current`, a symlink to the live one, which is what Caddy serves and
# what the promo module in bridge manages too (Промо → Лендинг). A script release is written next to the others and the symlink is
# moved onto it with one rename: a visitor never sees a half-written site, and the previous release stays for a way back.
# (COPYFILE_DISABLE: macOS tar would otherwise add ._* AppleDouble files)
REMOTE='set -e
cd /site
name="script-$(date -u +%Y%m%d%H%M%S)"
mkdir -p releases ".new-$name"
tar -x -C ".new-$name"
mv ".new-$name" "releases/$name"
ln -s "releases/$name" .current-new
mv -T .current-new current
# the old flat layout (index.html straight in the volume) is no longer served: remove it
find /site -mindepth 1 -maxdepth 1 ! -name releases ! -name current ! -name ".*" -exec rm -rf {} +
# keep the last five script releases
ls -1d releases/script-* | sort -r | tail -n +6 | xargs -r rm -rf
echo "live: $(readlink current)"'
COPYFILE_DISABLE=1 tar -C "$STAGE" -cf - . | ssh -o BatchMode=yes "$WHITE" \
  "docker volume create $VOLUME >/dev/null && docker run --rm -i -v $VOLUME:/site $IMAGE sh -c '$REMOTE'"
echo "done. Served by Caddy once the stack with LANDING_HOST is deployed and DNS points at the board."
