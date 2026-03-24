FROM rust:latest

WORKDIR /app

# Application crates (e.g. sgp4, geo) are declared in Cargo.toml / Cargo.lock; `cargo build|test`
# in this image fetches them — no host Rust install required.

# Install cargo-watch for live re-loading during development
RUN cargo install cargo-watch

# We'll copy the source code in docker-compose as a volume,
# but we need to at least copy what's currently here for the initial build context.
COPY . .

EXPOSE 3001

CMD ["cargo", "watch", "-x", "run"]
