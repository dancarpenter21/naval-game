use axum::routing::get;
use socketioxide::{
    extract::{Data, SocketRef},
    socket::DisconnectReason,
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
mod sim_timing;
use ecs::{Allegiance, EntityConfig, WorldTemplate};
use scenario::{load_scenarios_from_dir, LoadedScenario, ScenarioEntityRef};
use sidc::{sidc_with_status, status_from_sidc, Sidc, SidcTemplate, Status};
use domain::{participant_to_dto, PlayerTeam, ScenarioSideEntity, ScenarioSummary, SessionPublic};
use dto::{
    ChatMessageDto, ChatScopeDto, ChatSendDto, CreateSessionDto, ErrorDto, JoinSessionDto,
    LeaveSessionDto, PlayersListDto, PlayersListRequestDto, RoomPlayerDto, ScenariosListDto,
    SessionPublicDto, SessionsListDto, SetTimeScaleDto, ShipSnapshotDto, SnapshotRequestDto,
    StopSessionDto,
};
use sim_timing::{
    SimTimingState, SimWallClockConfig, KNOTS_TO_MPS, MAX_SIM_SUBSTEP_S,
    METERS_PER_DEGREE_LAT_MEAN,
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

#[allow(dead_code)] // Reserved for future status / SIDC updates on entities
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

fn ship_snapshots_from_world(guard: &[ShipState]) -> Vec<ShipSnapshotDto> {
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
        .collect()
}

/// Integrate simple kinematics for `dt_sim_s` (simulated seconds, not wall time).
fn integrate_ships(world: &mut [ShipState], dt_sim_s: f64) {
    if dt_sim_s <= 0.0 {
        return;
    }
    for ship in world.iter_mut() {
        let speed_mps = ship.movement.max_speed_knots * KNOTS_TO_MPS;
        let dist_m = speed_mps * dt_sim_s;

        let heading_rad = ship.transform.heading_deg.to_radians();
        // Heading 0° = north, 90° = east
        let north_m = dist_m * heading_rad.cos();
        let east_m = dist_m * heading_rad.sin();

        let lat_rad = ship.transform.lat_deg.to_radians();
        let meters_per_deg_lon = METERS_PER_DEGREE_LAT_MEAN * lat_rad.cos().max(1e-6);

        ship.transform.lat_deg += north_m / METERS_PER_DEGREE_LAT_MEAN;
        ship.transform.lon_deg += east_m / meters_per_deg_lon;
    }
}

struct GameSession {
    public: SessionPublic,
    /// Team assignment per connected socket (keyed by `socket.id`).
    player_teams: HashMap<String, PlayerTeam>,
    /// Display name per socket (chat / player list).
    player_names: HashMap<String, String>,
    stop_tx: Option<tokio::sync::oneshot::Sender<()>>,
    _loop_handle: JoinHandle<()>,
    world: Arc<Mutex<Vec<ShipState>>>,
    /// Authoritative simulation clock + time scale (white cell adjusts scale via socket).
    timing: Arc<Mutex<SimTimingState>>,
}

fn sanitize_display_name(raw: &str) -> String {
    let t = raw.trim();
    if t.is_empty() {
        return "Player".to_string();
    }
    t.chars().take(48).collect()
}

fn players_list_for_session(session: &GameSession) -> PlayersListDto {
    let mut players: Vec<RoomPlayerDto> = session
        .player_teams
        .iter()
        .map(|(socket_id, team)| RoomPlayerDto {
            socket_id: socket_id.clone(),
            display_name: session
                .player_names
                .get(socket_id)
                .cloned()
                .unwrap_or_else(|| "Player".to_string()),
            player_team: team.to_dto(),
        })
        .collect();
    players.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    PlayersListDto { players }
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

    let sim_wall_clock = Arc::new(SimWallClockConfig::from_env());
    info!(
        "Simulation wall clock {}={} Hz (wall_dt_s={:.6})",
        sim_timing::ENV_SIM_TICK_HZ,
        sim_wall_clock.hz,
        sim_wall_clock.dt_s
    );

    let (layer, io) = SocketIo::new_layer();

    {
        let store = sessions_store.clone();
        let io_for_ns = io.clone();
        let io_for_handlers = io.clone();
        let world_template = world_template.clone();
        let scenario_catalog = scenario_catalog.clone();
        let sim_wall_for_socket = sim_wall_clock.clone();
        io_for_ns.ns("/", move |socket: SocketRef| {
            on_connect(
                socket,
                store,
                io_for_handlers.clone(),
                world_template.clone(),
                scenario_catalog.clone(),
                sim_wall_for_socket.clone(),
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
    timing: Arc<Mutex<SimTimingState>>,
    io: SocketIo,
    wall_tick: Duration,
) -> (JoinHandle<()>, tokio::sync::oneshot::Sender<()>) {
    let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel::<()>();

    let handle = tokio::spawn(async move {
        let mut ticker = time::interval(wall_tick);
        ticker.set_missed_tick_behavior(time::MissedTickBehavior::Delay);
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

                    let (wall_dt_s, scale) = {
                        let t = timing.lock().await;
                        (t.wall_dt_s, SimTimingState::clamp_time_scale(t.time_scale))
                    };
                    let sim_advance_s = wall_dt_s * scale;

                    let ships_dto = {
                        let mut guard = world.lock().await;
                        let mut remaining = sim_advance_s;
                        while remaining > 1e-9 {
                            let step = remaining.min(MAX_SIM_SUBSTEP_S);
                            integrate_ships(&mut guard, step);
                            remaining -= step;
                        }
                        ship_snapshots_from_world(&guard)
                    };

                    let dto = {
                        let mut t = timing.lock().await;
                        t.sim_elapsed_s += sim_advance_s;
                        t.to_world_snapshot(ships_dto)
                    };

                    let sim_elapsed_log = dto.sim_elapsed_s;
                    let time_scale_log = dto.time_scale;
                    let ship_count_log = dto.ships.len();

                    debug!(
                        "Game tick: session_name={} session_id={} tick_count={} emitting world_snapshot ships={} sim_elapsed_s={:.2} time_scale={:.2}",
                        session_name,
                        session_id,
                        tick_count,
                        ship_count_log,
                        sim_elapsed_log,
                        time_scale_log
                    );
                    io.to(session_id.clone())
                        .emit("world_snapshot", dto)
                        .ok();

                    if tick_count % 64 == 0 {
                        let count = world.lock().await.len();
                        info!(
                            "Game tick: session_name={} session_id={} tick_count={} ships={} sim_elapsed_s={:.1} time_scale={:.1}",
                            session_name,
                            session_id,
                            tick_count,
                            count,
                            sim_elapsed_log,
                            time_scale_log
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
    sim_wall: Arc<SimWallClockConfig>,
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
        let sim_wall_create = sim_wall.clone();
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
            let display_name = sanitize_display_name(&data.display_name);
            let public = SessionPublic {
                id: id.clone(),
                name: session_name.clone(),
            };
            let participant = participant_to_dto(
                &public,
                PlayerTeam::White,
                display_name.clone(),
            );

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

            let wall_dt_s = sim_wall_create.dt_s;
            let wall_tick = Duration::from_secs_f64(wall_dt_s);
            let timing = Arc::new(Mutex::new(SimTimingState::new_now(wall_dt_s)));
            let (loop_handle, stop_tx) = spawn_game_loop(
                public.id.clone(),
                public.name.clone(),
                world.clone(),
                timing.clone(),
                io.clone(),
                wall_tick,
            );
            let world_for_session = world.clone();
            let mut player_teams = HashMap::new();
            // Session creator starts in the admin/white team.
            let sock_key = socket.id.to_string();
            player_teams.insert(sock_key.clone(), PlayerTeam::White);
            let mut player_names = HashMap::new();
            player_names.insert(sock_key, display_name);
            let game_session = GameSession {
                public: public.clone(),
                player_teams,
                player_names,
                stop_tx: Some(stop_tx),
                _loop_handle: loop_handle,
                world: world_for_session,
                timing,
            };

            store.lock().await.insert(id.clone(), game_session);
            let players_dto = {
                let lock = store.lock().await;
                players_list_for_session(lock.get(&id).expect("session inserted"))
            };
            io.to(id.clone()).emit("players_list", players_dto).ok();
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
        let io = io.clone();
        socket.on("join_session", |socket: SocketRef, Data::<JoinSessionDto>(data)| async move {
            let session_id = data.id.clone();
            let mut store_lock = store.lock().await;
            if let Some(session) = store_lock.get_mut(&data.id) {
                let player_team = PlayerTeam::from_dto(data.team);
                let display_name = sanitize_display_name(&data.display_name);
                let sock_key = socket.id.to_string();
                session
                    .player_teams
                    .insert(sock_key.clone(), player_team);
                session.player_names.insert(sock_key, display_name.clone());
                socket.join(session_id.clone());
                let participant =
                    participant_to_dto(&session.public, player_team, display_name.clone());
                let session_name_for_log = session.public.name.clone();
                let players_dto = players_list_for_session(session);
                drop(store_lock);
                io.to(session_id.clone())
                    .emit("players_list", players_dto)
                    .ok();
                socket.emit("session_joined", participant).ok();
                info!(
                    "User joined session user_socket_id={} session_name={} session_id={} tick_count={}",
                    socket.id,
                    session_name_for_log,
                    data.id,
                    -1
                );

                // Send an immediate snapshot to the joiner.
                let store_lock = store.lock().await;
                if let Some(session) = store_lock.get(&data.id) {
                    let ships = {
                        let guard = session.world.lock().await;
                        ship_snapshots_from_world(&guard)
                    };
                    let dto = {
                        let t = session.timing.lock().await;
                        t.to_world_snapshot(ships)
                    };
                    socket.emit("world_snapshot", dto).ok();
                }
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
                    let ships = {
                        let guard = session.world.lock().await;
                        ship_snapshots_from_world(&guard)
                    };
                    let dto = {
                        let t = session.timing.lock().await;
                        t.to_world_snapshot(ships)
                    };
                    info!(
                        "Sending requested world_snapshot session_name={} session_id={} tick_count={} ships={}",
                        session.public.name,
                        data.id,
                        -1,
                        dto.ships.len()
                    );
                    socket.emit("world_snapshot", dto).ok();
                }
            },
        );
    }

    {
        let store = store.clone();
        socket.on(
            "set_time_scale",
            |socket: SocketRef, Data::<SetTimeScaleDto>(data)| async move {
                let socket_key = socket.id.to_string();
                let session_id = data.session_id.clone();
                let store_lock = store.lock().await;
                let Some(session) = store_lock.get(&session_id) else {
                    return;
                };
                let caller_team = session.player_teams.get(&socket_key).copied();
                if caller_team != Some(PlayerTeam::White) {
                    warn!(
                        "set_time_scale denied: socket_id={} session_id={} caller_team={:?}",
                        socket.id, session_id, caller_team
                    );
                    return;
                }
                let clamped = SimTimingState::clamp_time_scale(data.time_scale);
                {
                    let mut t = session.timing.lock().await;
                    t.time_scale = clamped;
                }
                info!(
                    "set_time_scale session_id={} time_scale={:.2} (clamped)",
                    session_id, clamped
                );
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

    {
        let store = store.clone();
        let io = io.clone();
        socket.on("leave_session", |socket: SocketRef, Data::<LeaveSessionDto>(data)| async move {
            let session_id = data.id.clone();
            let sock_key = socket.id.to_string();
            let mut store_lock = store.lock().await;
            let Some(session) = store_lock.get_mut(&session_id) else {
                return;
            };
            if !session.player_teams.contains_key(&sock_key) {
                return;
            }
            session.player_teams.remove(&sock_key);
            session.player_names.remove(&sock_key);
            let has_white = session.player_teams.values().any(|t| *t == PlayerTeam::White);

            if has_white {
                let list = players_list_for_session(session);
                socket.leave(session_id.clone()).ok();
                drop(store_lock);
                io.to(session_id).emit("players_list", list).ok();
                socket.emit("left_session", ()).ok();
            } else {
                // Last white left — end game for everyone
                drop(store_lock);
                let mut sl = store.lock().await;
                if let Some(mut session) = sl.remove(&session_id) {
                    if let Some(stop_tx) = session.stop_tx.take() {
                        let _ = stop_tx.send(());
                    }
                    let public_dto = session.public.to_dto();
                    on_session_closed_stub(&session.public);
                    drop(sl);
                    io.to(session_id.clone())
                        .emit("session_stopped", public_dto)
                        .ok();
                    io.within(session_id).disconnect().ok();
                }
            }
        });
    }

    {
        let store = store.clone();
        socket.on(
            "request_players_list",
            |socket: SocketRef, Data::<PlayersListRequestDto>(data)| async move {
                let sock_key = socket.id.to_string();
                let store_lock = store.lock().await;
                if let Some(session) = store_lock.get(&data.id) {
                    if session.player_teams.contains_key(&sock_key) {
                        let pl = players_list_for_session(session);
                        socket.emit("players_list", pl).ok();
                    }
                }
            },
        );
    }

    {
        let store = store.clone();
        let io = io.clone();
        socket.on("session_chat", |socket: SocketRef, Data::<ChatSendDto>(data)| async move {
            let sock_key = socket.id.to_string();
            let session_id = data.session_id.clone();
            let text: String = data.text.trim().to_string();
            if text.is_empty() || text.chars().count() > 2000 {
                return;
            }
            let scope = data.scope;
            let store_lock = store.lock().await;
            let Some(session) = store_lock.get(&session_id) else {
                return;
            };
            if !session.player_teams.contains_key(&sock_key) {
                return;
            }
            let from = session
                .player_names
                .get(&sock_key)
                .cloned()
                .unwrap_or_else(|| "Player".to_string());
            let sender_team = match session.player_teams.get(&sock_key) {
                Some(t) => *t,
                None => return,
            };
            let team_peer_ids: Vec<String> = session
                .player_teams
                .iter()
                .filter(|(_, t)| **t == sender_team)
                .map(|(id, _)| id.clone())
                .collect();
            drop(store_lock);

            let msg = ChatMessageDto { from, text, scope };
            match scope {
                ChatScopeDto::All => {
                    io.to(session_id).emit("chat_message", msg).ok();
                }
                ChatScopeDto::Team => {
                    for peer_id in team_peer_ids {
                        io.to(peer_id).emit("chat_message", msg.clone()).ok();
                    }
                }
            }
        });
    }

    {
        let store = store.clone();
        let io = io.clone();
        socket.on_disconnect(|s: SocketRef, _reason: DisconnectReason| async move {
            let sid = s.id.to_string();
            let mut store_lock = store.lock().await;

            enum PostDisconnect {
                BroadcastList(String, PlayersListDto),
                EndGame(String),
            }
            let mut post: Option<PostDisconnect> = None;

            for (session_id, session) in store_lock.iter_mut() {
                if session.player_teams.contains_key(&sid) {
                    session.player_teams.remove(&sid);
                    session.player_names.remove(&sid);
                    let has_white = session.player_teams.values().any(|t| *t == PlayerTeam::White);
                    post = Some(if has_white {
                        PostDisconnect::BroadcastList(
                            session_id.clone(),
                            players_list_for_session(session),
                        )
                    } else {
                        PostDisconnect::EndGame(session_id.clone())
                    });
                    break;
                }
            }
            drop(store_lock);

            match post {
                Some(PostDisconnect::BroadcastList(session_id, list)) => {
                    io.to(session_id).emit("players_list", list).ok();
                }
                Some(PostDisconnect::EndGame(session_id)) => {
                    let mut sl = store.lock().await;
                    if let Some(mut session) = sl.remove(&session_id) {
                        if let Some(stop_tx) = session.stop_tx.take() {
                            let _ = stop_tx.send(());
                        }
                        let public_dto = session.public.to_dto();
                        on_session_closed_stub(&session.public);
                        drop(sl);
                        io.to(session_id.clone())
                            .emit("session_stopped", public_dto)
                            .ok();
                        io.within(session_id).disconnect().ok();
                    }
                }
                None => {}
            }
        });
    }
}
