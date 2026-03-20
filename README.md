# Naval Game

A web-based Naval Battle game focused on a collaborative real-time red vs blue experience. Red is the enemy played by the AI, Blue are the players.

The game is a real-time strategy game where players must work together to overcome extremely complex scenarios and meet mission objectives. Blue controls a fleet of ships and aircraft, and must defeat the flagship of the Red fleet. Red controls a fleet of ships, aircraft, and land-based defenses, and must defend their flagship from the Blue fleet.

Players must work together to coordinate their attacks to overcome red fleet defenses and destroy the red flagship.

Most of the game takes place on the 2D map. There is also a page for unit descriptions and capabilities (pulled from Jane's Fighting Ships) and a page for mission schedules so players can coordinate their actions.

## Architecture

This game is built on a client-server architecture. The game state is maintained on the server and the client is updated in real-time. The server is a Rust application built from a map with Turf.js for geometry calculations. The client is a web application built from a React.js application with a Node.js backend. The game itself is an entity component system where units are airframes, boats, etc, and entity has components that define its properties, capabilities, and behaviors.

## Running tests (Rust server)

Run the server unit tests **via Docker Compose** (same toolchain and cargo cache as dev):

- **One shot** — full `cargo test`, then exit:

  ```bash
  docker compose --profile tests run --rm server-test
  ```

- **Watch mode** — re-run tests when `./server` sources change:

  ```bash
  docker compose --profile tests up server-tests
  ```

## Deployment

The game is deployed as Docker compose.yaml with containers for the server, the client dev server (Vite), and nginx as a reverse proxy. The **SIDC builder** is a static page shipped with the client at **`/sidc-picker/index.html`** (no separate sidc-picker container).

### SIDC help

From the in-app hamburger menu, **SIDC help** opens a reference page in a new browser tab (`/help/sidc.html`): overview of SIDC, legal values for template enums, an embedded interactive picker, and license attribution.

## Third-party — SIDC reference & preview

Our SIDC field layout is informed by [kjellmf/sidc-picker](https://github.com/kjellmf/sidc-picker) (MIT). The map and in-app SIDC builder use [milsymbol](https://github.com/spatialillusions/milsymbol) (MIT) in **APP-6** drawing mode (`standard: 'APP6'`), aligned with **APP-6D** / `milstd` `app6d` picker data. The library loads from **`client/public/vendor/milsymbol/milsymbol.js`** first (offline-friendly), with jsDelivr as fallback. After upgrading the `milsymbol` npm dependency, run **`npm run vendor:milsymbol`** in `client/`. See **`/help/sidc.html`** for links and attribution.