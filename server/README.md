### How to use the Docker-based ECS test runner

- **What this does**  
  - Adds a `server-tests` service in `docker-compose.yaml` that builds from `server/Dockerfile` and mounts the same Rust workspace volumes.  
  - Runs `cargo watch -x "test ecs"` inside the container so tests re-run automatically whenever you change server code.

- **Running continuous ECS tests (no host installs)**  
  From the repo root, run:

  ```bash
  docker compose --profile tests run --rm --init server-tests
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

### How to run the server

- **Using Docker Compose**  
  The project is designed to run via Docker Compose with separate containers for the server and client. From the repo root:

  ```bash
  docker compose up
  ```

  This will:
  - Build and start the Rust server container.
  - Build and start the client container.

  You can then access the game via the HTTP endpoint exposed by the `nginx` service (see the root `README.md` and `docker-compose.yaml` for details).

### Simulation timing (server authority)

- **Wall-clock tick rate** is set with **`SIM_TICK_HZ`** (simulation ticks per second). Default is **16** Hz (`2^4`, `wall_dt_s = 1/16` s). Valid range is **1–64** Hz (`2^0`–`2^6`); invalid or missing values fall back to the default. (This is not tied to Shannon/Nyquist sampling—it’s a practical CPU/network cap on how often the server steps the sim and emits snapshots.)
- Each tick advances **simulation time** by `wall_dt_s × time_scale`. **White cell** players set `time_scale` between **⅛×** (`2^-3`) and **64×** (`2^6`) via the `set_time_scale` socket event.
- Ship kinematics integrate in **substeps** of at most `MAX_SIM_SUBSTEP_S` simulated seconds so high time scales do not skip distance in one leap.
- `WorldSnapshotDto` includes `sim_elapsed_s`, `sim_time_utc` (exercise clock), `wall_dt_s`, and `time_scale` for UI sync.
- Speed uses SI **knots → m/s** as 1852/3600 (international nautical mile definition).