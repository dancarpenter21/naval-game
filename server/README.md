### How to use the Docker-based ECS test runner

- **What this does**  
  - Adds a `server-tests` service in `docker-compose.yaml` that builds from `server/Dockerfile` and mounts the same Rust workspace volumes.  
  - Runs `cargo watch -x "test ecs"` inside the container so tests re-run automatically whenever you change server code.

- **Running continuous ECS tests (no host installs)**  
  From the repo root, run:

  ```bash
  docker compose run --rm server-tests
  ```

  This starts a one-off container that:
  - Uses the Rust toolchain and `cargo-watch` installed inside the `server` image.  
  - Watches your mounted `./server` code and re-runs `cargo test` with the `ecs` filter on changes.

- **Tweaking the test filter**  
  - The filter `test ecs` currently tells cargo to run tests whose names contain `ecs`.  
  - If your ECS tests use a different naming pattern, edit the `command` in `docker-compose.yaml` accordingly, for example:

  ```yaml
  command: >
    cargo watch -x "test world_template"
  ```