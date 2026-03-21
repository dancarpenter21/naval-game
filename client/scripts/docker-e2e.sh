#!/bin/sh
# Wait for nginx → Vite with the same Host header nginx sends (see vite.config.js allowedHosts).
set -e
echo "Waiting for nginx (Host: client) ..."
i=0
while [ "$i" -lt 90 ]; do
  if node -e "
const http = require('http');
http
  .get(
    { hostname: 'nginx', port: 80, path: '/', headers: { Host: 'client' } },
    (res) => process.exit(res.statusCode === 200 ? 0 : 1)
  )
  .on('error', () => process.exit(1));
" 2>/dev/null; then
    echo "App is up."
    exec cypress run --project /app "$@"
  fi
  i=$((i + 1))
  echo "attempt $i..."
  sleep 2
done
echo "Timeout waiting for nginx / Vite"
exit 1
