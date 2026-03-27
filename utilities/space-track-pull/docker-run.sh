#!/usr/bin/env sh
# Run space-track-pull.sh in Docker (Alpine + bash + curl + python3).
#
# Usage (from repo root):
#   ./utilities/space-track-pull/docker-run.sh build
#   ./utilities/space-track-pull/docker-run.sh login
#   ./utilities/space-track-pull/docker-run.sh satcat-gps > satellites.json
#   ./utilities/space-track-pull/docker-run.sh pipeline-gps ./out.json
#
# Credentials: export SPACE_TRACK_IDENTITY / SPACE_TRACK_PASSWORD, or use repo-root .env
# mounted at /work/.env. Cookie file: .space-track-cookies.txt in the repo root.
#
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
IMAGE="${SPACE_TRACK_IMAGE:-naval-game-space-track:latest}"

run_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker not found in PATH." >&2
    exit 1
  fi
  exec docker run --rm -i \
    -v "$ROOT:/work" \
    -w /work \
    -e SPACE_TRACK_IDENTITY="${SPACE_TRACK_IDENTITY:-}" \
    -e SPACE_TRACK_PASSWORD="${SPACE_TRACK_PASSWORD:-}" \
    -e SPACE_TRACK_COOKIE_JAR="${SPACE_TRACK_COOKIE_JAR:-/work/.space-track-cookies.txt}" \
    -e SPACE_TRACK_BASE="${SPACE_TRACK_BASE:-}" \
    -e SPACE_TRACK_COMM_PREFIX="${SPACE_TRACK_COMM_PREFIX:-}" \
    -e SPACE_TRACK_GP_CHUNK="${SPACE_TRACK_GP_CHUNK:-}" \
    "$IMAGE" "$@"
}

case "${1:-}" in
  build)
    docker build -f "$ROOT/utilities/space-track-pull/Dockerfile" -t "$IMAGE" "$ROOT/utilities/space-track-pull"
    ;;
  help | -h | --help)
    echo "Usage: $0 build | [space-track-pull args…]" >&2
    echo "Examples:" >&2
    echo "  $0 build" >&2
    echo "  $0 login" >&2
    echo "  $0 satcat-gps > satellites.json" >&2
    echo "  $0 merge sat.json gp.json > merged.json" >&2
    ;;
  *)
    run_docker "$@"
    ;;
esac
