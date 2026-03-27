# Space-Track pull: bash, curl, python3 (no host install required).
#
# Build (from repo root):
#   docker build -f utilities/space-track-pull/Dockerfile -t naval-game-space-track utilities/space-track-pull
# Or:
#   ./utilities/space-track-pull/docker-run.sh build

FROM alpine:3.20

RUN apk add --no-cache bash curl python3 ca-certificates

COPY space-track-pull.sh /usr/local/bin/space-track-pull.sh
RUN chmod +x /usr/local/bin/space-track-pull.sh

WORKDIR /work
ENTRYPOINT ["/usr/local/bin/space-track-pull.sh"]
CMD ["help"]
