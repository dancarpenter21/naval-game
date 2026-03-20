use axum::routing::get;
use socketioxide::{
    extract::{Data, SocketRef},
    SocketIo,
};
use tracing::{debug, info, warn};
use tower_http::cors::CorsLayer;
use serde::{de::Error as _, Deserialize, Deserializer};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::env;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::{self, Duration};

mod dto;
mod ecs;
mod domain;
mod scenario;
mod sidc;
use ecs::{Allegiance, EntityConfig, WorldTemplate};
use scenario::{load_scenarios_from_dir, LoadedScenario, ScenarioEntityRef};
use sidc::{sidc_with_status, status_from_sidc, Sidc, SidcTemplate, Status};
use domain::{PlayerTeam, ScenarioSideEntity, ScenarioSummary, SessionPublic};
use dto::{
    CreateSessionDto, ErrorDto, JoinSessionDto, PlayerTeamDto, ScenarioSummaryDto, ScenariosListDto,
    SessionParticipantDto, ShipSnapshotDto, SnapshotRequestDto, SessionPublicDto,
    SessionsListDto, ScenarioSideEntityDto, StopSessionDto, WorldSnapshotDto,
};

#[derive(Debug, Clone, Deserialize)]
struct TransformWorld {
    lat_deg: f64,
    lon_deg: f64,
    hae_m: f64,
    heading_deg: f64,
}

#[derive(Debug, Clone, Deserialize)]
struct MovementConfig {
    max_speed_knots: f64,
    #[allow(dead_code)]
    acceleration: f64,
}

#[derive(Debug, Clone)]
struct SymbolConfig {
    sidc: String,
}

/// YAML shape: `{ sidc_template: { ... } }` (not an externally tagged enum key like `Template:`).
#[derive(Debug, Deserialize)]
struct SymbolConfigWire {
    sidc_template: SidcTemplate,
}

impl<'de> Deserialize<'de> for SymbolConfig {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = SymbolConfigWire::deserialize(deserializer)?;
        let sidc = wire
            .sidc_template
            .to_sidc_string()
            .map_err(D::Error::custom)?;

        if Sidc::parse(&sidc).is_none() {
            return Err(D::Error::custom(
                "symbol.sidc must be a valid hyphenated SIDC string",
            ));
        }

        Ok(SymbolConfig { sidc })
    }
}

#[derive(Debug, Clone)]
struct ShipState {
    id: String,
    name: String,
    allegiance: Allegiance,
    transform: TransformWorld,
    movement: MovementConfig,
    symbol: SymbolConfig,
}

impl ShipState {
    fn status(&self) -> Option<Status> {
        status_from_sidc(&self.symbol.sidc)
    }

    fn set_status(&mut self, status: Status) -> bool {
        let Some(updated_sidc) = sidc_with_status(&self.symbol.sidc, status) else {
            return false;
        };
        self.symbol.sidc = updated_sidc;
        true
    }
}

fn on_session_closed_stub(_public: &SessionPublic) {
    // Stub hook for game logging/recording when the session closes.
    // Intentionally left empty for now.
}

struct GameSession {
    public: SessionPublic,
    /// Team assignment per connected socket (keyed by `socket.id`).
    player_teams: HashMap<String, PlayerTeam>,
    stop_tx: Option<tokio::sync::oneshot::Sender<()>>,
    _loop_handle: JoinHandle<()>,
    world: Arc<Mutex<Vec<ShipState>>>,
}

#[derive(Clone)]
struct ScenarioCatalog {
    /// Stable list for UI (same order as directory sort).
    summaries: Vec<ScenarioSummary>,
    by_id: HashMap<String, LoadedScenario>,
}

fn scenario_summary(world: &WorldTemplate, loaded: &LoadedScenario) -> ScenarioSummary {
    let resolve = |eid: &str| {
        world
            .entities
            .iter()
            .find(|e| e.id == eid)
            .map(|e| ScenarioSideEntity {
                id: e.id.clone(),
                name: e.name.clone(),
            })
            .unwrap_or_else(|| ScenarioSideEntity {
                id: eid.to_string(),
                name: format!("{eid} (missing template)"),
            })
    };

    ScenarioSummary {
        id: loaded.id.clone(),
        name: loaded.display_name(),
        description: loaded.config.description.clone(),
        win_conditions: loaded.config.win_conditions.clone(),
        red: loaded
            .config
            .red_entities
            .iter()
            .map(|e| resolve(e.template_id()))
            .collect(),
        blue: loaded
            .config
            .blue_entities
            .iter()
            .map(|e| resolve(e.template_id()))
            .collect(),
    }
}

fn load_scenario_catalog(world: &WorldTemplate, dir: &str) -> Result<ScenarioCatalog, std::io::Error> {
    let loaded = load_scenarios_from_dir(Path::new(dir))?;
    let mut summaries = Vec::with_capacity(loaded.len());
    let mut by_id = HashMap::new();
    for s in loaded {
        summaries.push(scenario_summary(world, &s));
        by_id.insert(s.id.clone(), s);
    }
    Ok(ScenarioCatalog { summaries, by_id })
}

fn ship_from_entity_template(entity_template: &EntityConfig, instance_id: String) -> ShipState {
    let mut transform: Option<TransformWorld> = None;
    let mut movement: Option<MovementConfig> = None;
    let mut symbol: Option<SymbolConfig> = None;

    for component in entity_template.components.iter() {
        match component.kind.as_str() {
            "transform" => {
                transform = Some(
                    serde_yaml::from_value(component.data.clone())
                        .expect("failed to parse transform component"),
                );
            }
            "movement" => {
                movement = Some(
                    serde_yaml::from_value(component.data.clone())
                        .expect("failed to parse movement component"),
                );
            }
            "symbol" => {
                symbol = Some(
                    serde_yaml::from_value(component.data.clone())
                        .expect("failed to parse symbol component"),
                );
            }
            _ => {}
        }
    }

    ShipState {
        id: instance_id,
        name: entity_template.name.clone(),
        allegiance: entity_template.allegiance.clone(),
        transform: transform.expect("entity missing transform component"),
        movement: movement.expect("entity missing movement component"),
        symbol: symbol.expect("entity missing symbol component"),
    }
}

fn apply_scenario_transform_overrides(t: &mut TransformWorld, entry: &ScenarioEntityRef) {
    let ScenarioEntityRef::Placement {
        lat_deg,
        lon_deg,
        hae_m,
        heading_deg,
        ..
    } = entry
    else {
        return;
    };
    if let Some(v) = lat_deg {
        t.lat_deg = *v;
    }
    if let Some(v) = lon_deg {
        t.lon_deg = *v;
    }
    if let Some(v) = hae_m {
        t.hae_m = *v;
    }
    if let Some(v) = heading_deg {
        t.heading_deg = *v;
    }
}

fn spawn_initial_ships(world_template: &WorldTemplate, scenario: &LoadedScenario) -> Vec<ShipState> {
    let spawns = &scenario.config.spawns;
    let red = &scenario.config.red_entities;
    let blue = &scenario.config.blue_entities;

    let mut ships = Vec::new();

    if !spawns.is_empty() {
        for spawn in spawns {
            if let Some(entity_template) = world_template
                .entities
                .iter()
                .find(|e| e.id == spawn.entity_id)
            {
                for i in 0..spawn.count {
                    let instance_id = if spawn.count <= 1 {
                        entity_template.id.clone()
                    } else {
                        format!("{}-{}", entity_template.id, i + 1)
                    };
                    ships.push(ship_from_entity_template(entity_template, instance_id));
                }
            } else {
                warn!(
                    "Scenario spawn referenced unknown entity_id={}",
                    spawn.entity_id
                );
            }
        }
    } else if !red.is_empty() || !blue.is_empty() {
        for entry in red.iter().chain(blue.iter()) {
            let tid = entry.template_id();
            let Some(entity_template) = world_template.entities.iter().find(|e| e.id == tid) else {
                warn!("Scenario lists unknown entity_id={}", tid);
                continue;
            };
            let instance_id = entity_template.id.clone();
            let mut ship = ship_from_entity_template(entity_template, instance_id);
            apply_scenario_transform_overrides(&mut ship.transform, entry);
            ships.push(ship);
        }
    } else {
        for entity_template in &world_template.entities {
            ships.push(ship_from_entity_template(
                entity_template,
                entity_template.id.clone(),
            ));
        }
    }

    ships
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Keep log level controlled by docker compose / environment.
    // (EnvFilter isn't available in this build, so we approximate by scanning RUST_LOG.)
    let rust_log = env::var("RUST_LOG").unwrap_or_default().to_lowercase();
    let max_level = if rust_log.contains("trace") {
        tracing::Level::TRACE
    } else if rust_log.contains("debug") {
        tracing::Level::DEBUG
    } else if rust_log.contains("info") {
        tracing::Level::INFO
    } else if rust_log.contains("warn") {
        tracing::Level::WARN
    } else if rust_log.contains("error") {
        tracing::Level::ERROR
    } else {
        tracing::Level::INFO
    };

    tracing_subscriber::fmt().with_max_level(max_level).init();
    info!(
        "Starting server session_name={} session_id={} tick_count={}",
        "n/a",
        "n/a",
        -1
    );

    // Load entity/component templates from YAML/JSON files for the game engine.
    let world_template = Arc::new(WorldTemplate::load_from_dir("config/entities")?);
    info!(
        "Loaded {} entity template(s) session_name={} session_id={} tick_count={}",
        world_template.entities.len(),
        "n/a",
        "n/a",
        -1
    );
    for e in &world_template.entities {
        info!(
            "Template loaded: id='{}' name='{}' components={} session_name={} session_id={} tick_count={}",
            e.id,
            e.name,
            e.components.len(),
            "n/a",
            "n/a",
            -1
        );
    }

    let scenario_catalog = Arc::new(load_scenario_catalog(&world_template, "config/scenarios")?);
    info!(
        "Loaded {} scenario file(s) from config/scenarios",
        scenario_catalog.summaries.len()
    );

    let sessions_store: Arc<Mutex<HashMap<String, GameSession>>> =
        Arc::new(Mutex::new(HashMap::new()));
    
    let (layer, io) = SocketIo::new_layer();

    {
        let store = sessions_store.clone();
        let io_for_ns = io.clone();
        let io_for_handlers = io.clone();
        let world_template = world_template.clone();
        let scenario_catalog = scenario_catalog.clone();
        io_for_ns.ns("/", move |socket: SocketRef| {
            on_connect(
                socket,
                store,
                io_for_handlers.clone(),
                world_template.clone(),
                scenario_catalog.clone(),
            )
        });
    }

    let app = axum::Router::new()
        .route("/", get(|| async { "Naval Game Server" }))
        .layer(layer)
        .layer(CorsLayer::permissive())
        .with_state(sessions_store);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3001".to_string());
    let addr = format!("0.0.0.0:{}", port);
    
    info!(
        "Server listening on port {} session_name={} session_id={} tick_count={}",
        addr,
        "n/a",
        "n/a",
        -1
    );
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    
    axum::serve(listener, app).await?;

    Ok(())
}

fn spawn_game_loop(
    session_id: String,
    session_name: String,
    world: Arc<Mutex<Vec<ShipState>>>,
    io: SocketIo,
) -> (JoinHandle<()>, tokio::sync::oneshot::Sender<()>) {
    let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel::<()>();

    let handle = tokio::spawn(async move {
        let mut ticker = time::interval(Duration::from_millis(250));
        let dt_s = 0.25_f64;
        let mut tick_count: u64 = 0;
        loop {
            tokio::select! {
                _ = &mut stop_rx => {
                    info!(
                        "Game loop stopped session_name={} session_id={} tick_count={}",
                        session_name,
                        session_id,
                        -1
                    );
                    break;
                }
                _ = ticker.tick() => {
                    tick_count += 1;
                    let snapshot = {
                        let mut guard = world.lock().await;
                        for ship in guard.iter_mut() {
                            // Very rough kinematics: move along heading at max speed.
                            // 1 knot = 0.514444 m/s
                            let speed_mps = ship.movement.max_speed_knots * 0.514_444;
                            let dist_m = speed_mps * dt_s;

                            let heading_rad = ship.transform.heading_deg.to_radians();
                            // heading 0° = north, 90° = east
                            let north_m = dist_m * heading_rad.cos();
                            let east_m = dist_m * heading_rad.sin();

                            let meters_per_deg_lat = 111_320.0_f64;
                            let lat_rad = ship.transform.lat_deg.to_radians();
                            let meters_per_deg_lon = meters_per_deg_lat * lat_rad.cos().max(1e-6);

                            ship.transform.lat_deg += north_m / meters_per_deg_lat;
                            ship.transform.lon_deg += east_m / meters_per_deg_lon;
                            // Keep `hae_m` from spawn (e.g. air units); do not force sea level each tick.
                        }

                        guard
                            .iter()
                            .map(|s| ShipSnapshotDto {
                                id: s.id.clone(),
                                name: s.name.clone(),
                                allegiance: s.allegiance.clone(),
                                lat_deg: s.transform.lat_deg,
                                lon_deg: s.transform.lon_deg,
                                hae_m: s.transform.hae_m,
                                heading_deg: s.transform.heading_deg,
                                sidc: s.symbol.sidc.clone(),
                            })
                            .collect::<Vec<_>>()
                    };

                    debug!(
                        "Game tick: session_name={} session_id={} tick_count={} emitting world_snapshot ships={}",
                        session_name,
                        session_id,
                        tick_count,
                        snapshot.len()
                    );
                    io.to(session_id.clone())
                        .emit("world_snapshot", WorldSnapshotDto { ships: snapshot })
                        .ok();

                    if tick_count % 20 == 0 {
                        let count = world.lock().await.len();
                        info!(
                            "Game tick: session_name={} session_id={} tick_count={} ships={}",
                            session_name,
                            session_id,
                            tick_count,
                            count
                        );
                    }
                }
            }
        }
    });

    (handle, stop_tx)
}

fn on_connect(
    socket: SocketRef,
    store: Arc<Mutex<HashMap<String, GameSession>>>,
    io: SocketIo,
    world_template: Arc<WorldTemplate>,
    scenario_catalog: Arc<ScenarioCatalog>,
) {
    info!(
        "A user connected socket_id={} session_name={} session_id={} tick_count={}",
        socket.id,
        "n/a",
        "n/a",
        -1
    );

    {
        let store = store.clone();
        let io = io.clone();
        let world_template = world_template.clone();
        let scenario_catalog = scenario_catalog.clone();
        socket.on("create_session", |socket: SocketRef, Data::<CreateSessionDto>(data)| async move {
            let id = uuid::Uuid::new_v4().to_string().chars().take(8).collect::<String>();

            let scenario = if scenario_catalog.by_id.is_empty() {
                socket
                    .emit(
                        "create_session_rejected",
                        ErrorDto {
                            message: "No scenarios are configured on the server (config/scenarios)."
                                .to_string(),
                        },
                    )
                    .ok();
                return;
            } else {
                match data.scenario_id.as_deref() {
                    Some(sid) => match scenario_catalog.by_id.get(sid) {
                        Some(s) => s,
                        None => {
                            socket
                                .emit(
                                    "create_session_rejected",
                                    ErrorDto {
                                        message: format!("Unknown scenario_id: {sid}"),
                                    },
                                )
                                .ok();
                            return;
                        }
                    },
                    None => match scenario_catalog
                        .summaries
                        .first()
                        .and_then(|sum| scenario_catalog.by_id.get(&sum.id))
                    {
                        Some(s) => s,
                        None => {
                            socket
                                .emit(
                                    "create_session_rejected",
                                    ErrorDto {
                                        message: "Could not resolve scenario.".to_string(),
                                    },
                                )
                                .ok();
                            return;
                        }
                    },
                }
            };

            let session_name = data.name;
            let public = SessionPublic {
                id: id.clone(),
                name: session_name.clone(),
            };
            let participant = SessionParticipantDto {
                id: id.clone(),
                name: session_name,
                player_team: PlayerTeam::White.to_dto(),
            };

            let ships = spawn_initial_ships(&world_template, scenario);
            let world = Arc::new(Mutex::new(ships));
            {
                let guard = world.lock().await;
                info!(
                    "Session spawned scenario_id={} session_name={} session_id={} tick_count={} spawned_count={} ship_ids=[{}]",
                    scenario.id,
                    public.name,
                    public.id,
                    -1,
                    guard.len(),
                    guard.iter().map(|s| s.id.as_str()).collect::<Vec<_>>().join(", ")
                );
            }

            let (loop_handle, stop_tx) = spawn_game_loop(
                public.id.clone(),
                public.name.clone(),
                world.clone(),
                io.clone(),
            );
            let world_for_session = world.clone();
            let mut player_teams = HashMap::new();
            // Session creator starts in the admin/white team.
            player_teams.insert(socket.id.to_string(), PlayerTeam::White);
            let game_session = GameSession {
                public: public.clone(),
                player_teams,
                stop_tx: Some(stop_tx),
                _loop_handle: loop_handle,
                world: world_for_session,
            };
            
            store.lock().await.insert(id.clone(), game_session);
            info!(
                "Session created session_name={} session_id={} tick_count={}",
                public.name,
                public.id,
                -1
            );
            socket.join(id.clone());
            socket.emit("session_created", participant).ok();
        });
    }

    {
        let catalog = scenario_catalog.clone();
        socket.on("get_scenarios", |socket: SocketRef| async move {
            socket
                .emit(
                    "scenarios_list",
                    ScenariosListDto {
                        scenarios: catalog
                            .summaries
                            .iter()
                            .map(|s| s.to_dto())
                            .collect(),
                    },
                )
                .ok();
        });
    }

    {
        let store = store.clone();
        socket.on("get_sessions", |socket: SocketRef| async move {
            let store_lock = store.lock().await;
                let sessions: Vec<SessionPublicDto> = store_lock
                .values()
                    .map(|s| s.public.to_dto())
                .collect();
            socket.emit("sessions_list", SessionsListDto { sessions }).ok();
        });
    }

    {
        let store = store.clone();
        socket.on("join_session", |socket: SocketRef, Data::<JoinSessionDto>(data)| async move {
            let mut store_lock = store.lock().await;
            if let Some(session) = store_lock.get_mut(&data.id) {
                let player_team_dto = data.team;
                let player_team = PlayerTeam::from_dto(player_team_dto);
                session.player_teams.insert(socket.id.to_string(), player_team);
                socket.join(data.id.clone());
                let participant = SessionParticipantDto {
                    id: session.public.id.clone(),
                    name: session.public.name.clone(),
                    player_team: player_team_dto,
                };
                socket.emit("session_joined", participant).ok();
                info!(
                    "User joined session user_socket_id={} session_name={} session_id={} tick_count={}",
                    socket.id,
                    session.public.name,
                    data.id,
                    -1
                );

                // Send an immediate snapshot to the joiner.
                let snapshot = {
                    let guard = session.world.lock().await;
                    guard
                        .iter()
                        .map(|s| ShipSnapshotDto {
                            id: s.id.clone(),
                            name: s.name.clone(),
                            allegiance: s.allegiance.clone(),
                            lat_deg: s.transform.lat_deg,
                            lon_deg: s.transform.lon_deg,
                            hae_m: s.transform.hae_m,
                            heading_deg: s.transform.heading_deg,
                            sidc: s.symbol.sidc.clone(),
                        })
                        .collect::<Vec<_>>()
                };
                socket.emit("world_snapshot", WorldSnapshotDto { ships: snapshot }).ok();
            }
        });
    }

    {
        let store = store.clone();
        socket.on(
            "request_world_snapshot",
            |socket: SocketRef, Data::<SnapshotRequestDto>(data)| async move {
                let store_lock = store.lock().await;
                if let Some(session) = store_lock.get(&data.id) {
                    let snapshot = {
                        let guard = session.world.lock().await;
                        guard
                            .iter()
                            .map(|s| ShipSnapshotDto {
                                id: s.id.clone(),
                                name: s.name.clone(),
                                allegiance: s.allegiance.clone(),
                                lat_deg: s.transform.lat_deg,
                                lon_deg: s.transform.lon_deg,
                                hae_m: s.transform.hae_m,
                                heading_deg: s.transform.heading_deg,
                                sidc: s.symbol.sidc.clone(),
                            })
                            .collect::<Vec<_>>()
                    };
                    info!(
                        "Sending requested world_snapshot session_name={} session_id={} tick_count={} ships={}",
                        session.public.name,
                        data.id,
                        -1,
                        snapshot.len()
                    );
                    socket.emit("world_snapshot", WorldSnapshotDto { ships: snapshot }).ok();
                }
            },
        );
    }

    {
        let store = store.clone();
        socket.on("stop_session", |socket: SocketRef, Data::<StopSessionDto>(data)| async move {
            let session_id = data.id.clone();
            let socket_key = socket.id.to_string();
            let mut store_lock = store.lock().await;
            let caller_team = store_lock
                .get(&session_id)
                .and_then(|s| s.player_teams.get(&socket_key))
                .copied();

            if caller_team != Some(PlayerTeam::White) {
                warn!(
                    "stop_session denied: socket_id={} session_id={} caller_team={:?}",
                    socket.id, session_id, caller_team
                );
                return;
            }

            if let Some(mut session) = store_lock.remove(&session_id) {
                if let Some(stop_tx) = session.stop_tx.take() {
                    let _ = stop_tx.send(());
                }
                let public = session.public.clone();
                info!(
                    "Session stopped session_name={} session_id={} tick_count={}",
                    public.name,
                    session_id,
                    -1
                );

                // Invoke stub hook (left empty for now).
                on_session_closed_stub(&public);

                // Convert domain -> DTO at the socket boundary.
                let public_dto = public.to_dto();

                // Notify everyone in the session room that this game has stopped.
                socket
                    .to(session_id.clone())
                    .emit("session_stopped", public_dto.clone())
                    .ok();
                // Also notify the stopper explicitly (they may or may not be in the room).
                socket.emit("session_stopped", public_dto).ok();

                // Disconnect every socket in the session room (including the host who stopped).
                // Intentional: full teardown; clients reconnect and re-enter flow via the lobby UI.
                socket
                    .within(session_id)
                    .disconnect()
                    .ok();
            }
        });
    }
}
