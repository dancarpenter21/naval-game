#!/bin/sh
# Dev entrypoint when /app is bind-mounted: anonymous node_modules volume starts empty.
set -eu
STAMP=node_modules/.docker-install-stamp
if [ ! -f "$STAMP" ] || [ package-lock.json -nt "$STAMP" ]; then
  npm ci
  touch "$STAMP"
fi
exec npm run dev -- --host
