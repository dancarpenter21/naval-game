#!/usr/bin/env sh
# Run server (cargo test) and client (lint + build) via Docker Compose.
# Policy: run this script for checks — Rust/Node/npm are not installed on the host; toolchains live in the images only.
set -eu
cd "$(dirname "$0")/.."
docker compose --profile tests run --rm server-test
docker compose --profile tests run --rm client-test
echo "OK: server tests + client lint/build"
