#!/bin/sh
# Dev entrypoint when /app is bind-mounted: anonymous node_modules volume overlays the image.
set -eu
SUMFILE=node_modules/.docker-install-sum
# Content hash — not mtime — so `git pull` updates to the lockfile always trigger `npm ci`
# (avoids stale volumes missing new deps like @xyflow/react).
sum=$(sha256sum package-lock.json | awk '{print $1}')
old=
if [ -f "$SUMFILE" ]; then old=$(cat "$SUMFILE"); fi
if [ "$sum" != "$old" ] || [ ! -f node_modules/.bin/vite ]; then
  npm ci
  echo "$sum" > "$SUMFILE"
fi
exec npm run dev -- --host
