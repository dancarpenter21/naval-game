### How to run server tests (Docker only)

**Do not run `cargo` on the host** unless you maintain a local toolchain; the repo assumes **Rust inside Docker**.

- **One shot — full `cargo test`** (from repo root):

  ```bash
  docker compose --profile tests run --rm server-test
  ```

- **Watch mode — re-run all tests when `./server` changes**:

  ```bash
  docker compose --profile tests up server-tests
  ```

  (`server-tests` runs `cargo watch -x "test"`; edit `docker-compose.yaml` if you want a narrower filter.)

- **Server + client** in one go: **`./scripts/docker-tests.sh`** (see root `README.md`).

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
- Entity kinematics integrate in **substeps** of at most `MAX_SIM_SUBSTEP_S` simulated seconds so high time scales do not skip distance in one leap.
- **Horizontal geometry** uses **WGS84 geodesics** (GeographicLib) in `src/earth.rs`; client mirror in `client/src/geo/wgs84Geodesic.js`. See repo **`docs/EARTH_AND_TERRAIN.md`** for DTED / terrain hooks.
- `WorldSnapshotDto` includes `entities`, `sim_elapsed_s`, `sim_time_utc` (exercise clock), `wall_dt_s`, and `time_scale` for UI sync.
- Speed uses SI **knots → m/s** as 1852/3600 (international nautical mile definition).