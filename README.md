# Naval Game

A web-based Naval Battle game focused on a collaborative real-time red vs blue experience. Red is the enemy played by the AI, Blue are the players.

The game is a real-time strategy game where players must work together to overcome extremely complex scenarios and meet mission objectives. Blue controls a fleet of ships and aircraft, and must defeat the flagship of the Red fleet. Red controls a fleet of ships, aircraft, and land-based defenses, and must defend their flagship from the Blue fleet.

Players must work together to coordinate their attacks to overcome red fleet defenses and destroy the red flagship.

## Cloning the repository

**[Git LFS](https://git-lfs.com/)** is required so large binary assets (for example the NASA Blue Marble imagery under `client/public/`) are fetched as real files, not Git LFS pointer stubs. Install Git LFS, run **`git lfs install`** once on your machine (or rely on your Git client’s LFS integration), then clone as usual. If you already cloned without LFS, install it and run **`git lfs pull`** in the repository.

Most of the game takes place on the 2D map. There is also a page for unit descriptions and capabilities (pulled from Jane's Fighting Ships) and a page for mission schedules so players can coordinate their actions.

## Architecture

This game is built on a client-server architecture. The game state is maintained on the server and the client is updated in real-time. The server is a Rust application; **horizontal geometry** uses **WGS84 geodesics** (GeographicLib, `server/src/earth.rs`) with a matching client module (`client/src/geo/wgs84Geodesic.js`). **Terrain / DTED** is not loaded yet—see **`docs/EARTH_AND_TERRAIN.md`** for hooks and rendering options (Cesium, MapLibre terrain, etc.). The client is a React app (Leaflet map today). The game uses an entity component system: units are airframes, vessels, etc., and each entity has components for properties, capabilities, and behaviors.

### Debug: map clicks vs markers

The client logs **`[naval:map-clicks]`** for roster taps, marker `click` handlers, movement-planning pointer events, and Leaflet map-level `click` / `mousedown` / `contextmenu` (see `MapPointerDebugLayer.jsx`, `MovementPlanningLayer.jsx`, `MapView.jsx`).

- **Vite dev** (`npm run dev` / Docker client): logging is **on** by default.
- **Production build**: run `localStorage.setItem('naval_debug_map_clicks', '1')` in the browser console, then reload. Clear with `removeItem('naval_debug_map_clicks')`.

Filter the console on `naval:map-clicks`. If you see `leaflet:map:click` / `leaflet:map:mousedown` with an SVG target (e.g. `tag: 'text'`) but never `marker:click:handler`, the hit was on inner SVG inside the icon, not the marker root — **`App.css` routes pointer events through `.leaflet-marker-icon * { pointer-events: none }`** so the marker receives the click. If a vector layer sits above markers, you’ll see map events without marker logs for a different reason.

## Running tests (Docker only)

**Rust, Node, and npm are not installed on the host** (WSL or otherwise). **All** server unit tests and client lint/build checks **must** run through Docker Compose; toolchains exist only inside the images.

**Prerequisite:** [Docker Desktop](https://docs.docker.com/desktop/) (or Docker Engine) running, with WSL integration enabled if you use WSL.

- **All server + client checks** (recommended):

  ```bash
  ./scripts/docker-tests.sh
  ```

- **Server only** — full `cargo test`, then exit:

  ```bash
  docker compose --profile tests run --rm server-test
  ```

- **Client only** — `npm ci`, `npm run lint`, `npm run build` (inside the client image):

  ```bash
  docker compose --profile tests run --rm client-test
  ```

- **Watch mode (server tests)** — re-run when `./server` sources change:

  ```bash
  docker compose --profile tests up server-tests
  ```

CI runs **`./scripts/docker-tests.sh`** via **`.github/workflows/tests.yml`** so the same Docker-only path is enforced on every push/PR.

## E2E UI tests (Cypress, Docker only)

Cypress is **not** installed on the host. The **`cypress/included`** image runs tests against the same stack as dev (`nginx` → Vite + Rust server).

Cypress loads **`http://nginx`**, while Vite’s default HMR WebSocket targets **`localhost:8080`**, which fails in headless E2E. Use the **`docker-compose.e2e.yml`** override so **`VITE_DISABLE_HMR=true`** on the client (no HMR during the run).

- **Run Cypress** (merge both compose files):

  ```bash
  docker compose -f docker-compose.yaml -f docker-compose.e2e.yml --profile e2e run --rm cypress
  ```

- If you already had the stack up **without** the E2E override, recreate the client so Vite picks up the env:

  ```bash
  docker compose -f docker-compose.yaml -f docker-compose.e2e.yml up -d --force-recreate client nginx
  docker compose -f docker-compose.yaml -f docker-compose.e2e.yml --profile e2e run --rm cypress
  ```

Specs live in **`client/cypress/e2e/`**. Config: **`client/cypress.config.js`**. **`CYPRESS_baseUrl`** is set to **`http://nginx`** inside Compose.

**Chat commands:** **`client/cypress/e2e/chat-commands.cy.js`** exercises leading `/all`, `/team`, team-color aliases, and white-cell coordination paths. The parser lives in **`client/src/chatParse.js`** (imported by the chat UI); **`cypress.config.js`** registers a **`cy.task`** so the same function runs in Node for table-style assertions without a second browser.

GitHub Actions: **`.github/workflows/e2e.yml`** uses the same two `-f` files (no host install).

## Player name (chat & session roster)

Enter a **username** on the session screen before creating or joining a game. The app stores a manual name in the cookie **`naval_player_username`** (SameSite=Lax). If the [Web Smart Card API](https://wicg.github.io/web-smart-card/) is available and a PIV-compatible card is present, the **common name (CN)** from the on-card X.509 certificate is filled in automatically and **overrides** the cookie for that visit. For automated tests / dev without a reader, set **`VITE_TEST_SMARTCARD_NAME`**. Legacy fallbacks: build-time **`VITE_PLAYER_NAME`**, then **`localStorage.naval_player_display_name`** (older builds).

## Deployment

The game is deployed as Docker compose.yaml with containers for the server, the client dev server (Vite), and nginx as a reverse proxy. The **SIDC builder** is a static page shipped with the client at **`/sidc-picker/index.html`** (no separate sidc-picker container).

The **client** bind-mounts `./client` over `/app` and keeps **`node_modules`** on an anonymous volume (so the host does not need Node). On start, **`client/scripts/docker-dev.sh`** runs **`npm ci`** when that volume is empty or when **`package-lock.json`** is newer than a stamp file—otherwise Vite would fail to resolve imports (e.g. **`geographiclib-geodesic`**). After changing dependencies, restart the client container; if things are stuck, **`docker compose up --build --force-recreate client`**.

### SIDC help

From the in-app hamburger menu, **SIDC help** opens a reference page in a new browser tab (`/help/sidc.html`): overview of SIDC, legal values for template enums, an embedded interactive picker, and license attribution.

## Third-party — SIDC reference & preview

Our SIDC field layout is informed by [kjellmf/sidc-picker](https://github.com/kjellmf/sidc-picker) (MIT). The map and in-app SIDC builder use [milsymbol](https://github.com/spatialillusions/milsymbol) (MIT) in **APP-6** drawing mode (`standard: 'APP6'`), aligned with **APP-6D** / `milstd` `app6d` picker data. The library loads from **`client/public/vendor/milsymbol/milsymbol.js`** first (offline-friendly), with jsDelivr as fallback. After upgrading the `milsymbol` npm dependency, run **`npm run vendor:milsymbol`** in `client/`. See **`/help/sidc.html`** for links and attribution.