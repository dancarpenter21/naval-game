use axum::routing::get;
use socketioxide::{
    extract::{Data, SocketRef},
    socket::DisconnectReason,
    SocketIo,
};
use tracing::{debug, info, warn};
use tower_http::cors::CorsLayer;
use serde::{de::Error as _, Deserialize, Deserializer};
use chrono::{DateTime, Utc};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use std::env;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::{self, Duration};

mod dto;
mod earth;
mod ecs;
mod domain;
mod movement;
mod scenario;
#[allow(dead_code)]
mod terrain;
mod land_mask;
mod sidc;
mod sim_timing;
mod space;
use ecs::{Allegiance, EntityConfig, WorldTemplate};
use scenario::{load_scenarios_from_dir, LoadedScenario, ScenarioEntityRef};
use sidc::{sidc_with_status, status_from_sidc, Sidc, SidcTemplate, Status};
use domain::{participant_to_dto, PlayerTeam, ScenarioSideEntity, ScenarioSummary, SessionPublic};
use dto::{
    ChatMessageDto, ChatScopeDto, ChatSendDto, CreateSessionDto, ErrorDto, IssueMovementOrderDto,
    JoinSessionDto, LeaveSessionDto, MovementOrderDto, PlayersListDto, PlayersListRequestDto,
    RoomPlayerDto, ScenariosListDto, SessionPublicDto, SessionsListDto, SetTimeScaleDto,
    EntitySnapshotDto, LatLonDegDto, SpaceCoverageEventDto, SnapshotRequestDto, StopSessionDto,
    ScenarioSummaryDto,
};
use sim_timing::{SimTimingState, SimWallClockConfig, KNOTS_TO_MPS, MAX_SIM_SUBSTEP_S};

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
    /// When true, land-sea checks are skipped (air, missile, etc.).
    #[serde(default)]
    skip_land_mask: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct SpaceOrbitYaml {
    line1: String,
    line2: String,
    fov_half_angle_deg: f64,
    #[serde(default)]
    hide_map_marker: bool,
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
struct EntityState {
    id: String,
    name: String,
    allegiance: Allegiance,
    transform: TransformWorld,
    /// None = no movement component; unit does not integrate and cannot be ordered.
    movement: Option<MovementConfig>,
    movement_mode: movement::MovementMode,
    /// Total geodesic path length (m) when a movement order was applied; drives `station_progress`.
    movement_path_total_m: Option<f64>,
    symbol: SymbolConfig,
    /// TLE / SGP4 propagation (no surface movement integration).
    space: Option<space::SpaceOrbitRuntime>,
    /// Last space overlay sent to clients (updated on space ticks).
    space_overlay: Option<crate::dto::SpaceSnapshotDto>,
    hide_map_marker: bool,
}

#[allow(dead_code)] // Reserved for future status / SIDC updates on entities
impl EntityState {
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ObjectiveState {
    Pending,
    Completed,
    Failed,
}

#[derive(Debug, Clone)]
pub struct ObjectiveTracker {
    pub id: String,
    pub config: scenario::ObjectiveConfig,
    pub state: ObjectiveState,
}

impl ObjectiveTracker {
    pub fn new(config: scenario::ObjectiveConfig) -> Self {
        Self {
            id: config.id.clone(),
            config,
            state: ObjectiveState::Pending,
        }
    }
}

pub fn evaluate_team_objectives(
    trackers: &mut [ObjectiveTracker],
    world: &[EntityState],
    sim_elapsed_s: f64,
) -> bool {
    let mut all_required_completed = true;
    let mut any_required_failed = false;

    for t in trackers.iter_mut() {
        if t.state != ObjectiveState::Pending {
            if t.config.required {
                if t.state == ObjectiveState::Failed {
                    any_required_failed = true;
                }
                if t.state != ObjectiveState::Completed {
                    all_required_completed = false;
                }
            }
            continue;
        }

        match &t.config.condition {
            scenario::ObjectiveCondition::SurviveTime { duration_s } => {
                if sim_elapsed_s >= *duration_s {
                    t.state = ObjectiveState::Completed;
                }
            }
            scenario::ObjectiveCondition::DestroyEntity { target_id, time_limit_s } => {
                let mut found = false;
                for e in world.iter() {
                    if e.id == *target_id {
                        found = true;
                        if matches!(e.status(), Some(sidc::Status::PresentDestroyed)) {
                            t.state = ObjectiveState::Completed;
                        } else if let Some(limit) = time_limit_s {
                            if sim_elapsed_s > *limit {
                                t.state = ObjectiveState::Failed;
                            }
                        }
                        break;
                    }
                }
                if !found {
                    t.state = ObjectiveState::Completed;
                }
            }
            scenario::ObjectiveCondition::ReachArea { target_id, lat_deg, lon_deg, radius_m } => {
                for e in world.iter() {
                    if e.id == *target_id {
                        let d = earth::geodesic_distance_m(e.transform.lat_deg, e.transform.lon_deg, *lat_deg, *lon_deg);
                        if d <= *radius_m {
                            t.state = ObjectiveState::Completed;
                        }
                        break;
                    }
                }
            }
        }

        if t.config.required {
            if t.state == ObjectiveState::Failed {
                any_required_failed = true;
            }
            if t.state != ObjectiveState::Completed {
                all_required_completed = false;
            }
        }
    }

    !trackers.is_empty() && all_required_completed && !any_required_failed
}

fn on_session_closed_stub(_public: &SessionPublic) {
    // Stub hook for game logging/recording when the session closes.
    // Intentionally left empty for now.
}

fn space_tick_interval_from_env() -> u64 {
    let raw = env::var(space::ENV_SPACE_TICK_INTERVAL).ok();
    let mut v = space::DEFAULT_SPACE_TICK_INTERVAL;
    if let Some(ref s) = raw {
        if let Ok(n) = s.trim().parse::<u64>() {
            v = n.max(1);
        }
    }
    v
}

fn collect_satellite_rows(world: &[EntityState]) -> Vec<(String, f64, f64, f64)> {
    world
        .iter()
        .filter_map(|e| {
            let sp = e.space.as_ref()?;
            let fr = space::footprint_radius_m(e.transform.hae_m, sp.config.fov_half_angle_deg);
            Some((e.id.clone(), e.transform.lat_deg, e.transform.lon_deg, fr))
        })
        .collect()
}

fn collect_ground_rows(world: &[EntityState]) -> Vec<(String, f64, f64)> {
    world
        .iter()
        .filter(|e| e.space.is_none())
        .map(|e| (e.id.clone(), e.transform.lat_deg, e.transform.lon_deg))
        .collect()
}

fn propagate_space_entities(world: &mut [EntityState], t: DateTime<Utc>) {
    for e in world.iter_mut() {
        let Some(ref sp) = e.space else {
            continue;
        };
        if let Ok((lat, lon, hae, snap)) = space::propagate_and_snapshot(sp, t) {
            e.transform.lat_deg = lat;
            e.transform.lon_deg = lon;
            e.transform.hae_m = hae;
            e.space_overlay = Some(snap);
        }
    }
}

fn entity_snapshots_from_world(guard: &[EntityState]) -> Vec<EntitySnapshotDto> {
    guard
        .iter()
        .map(|s| {
            let (station_eta_sim_s, station_progress) =
                if let Some(ref mov) = s.movement {
                    let mps = mov.max_speed_knots * KNOTS_TO_MPS;
                    movement::station_eta_and_progress(
                        s.transform.lat_deg,
                        s.transform.lon_deg,
                        &s.movement_mode,
                        s.movement_path_total_m,
                        mps,
                    )
                } else {
                    (None, None)
                };
            let display_path_deg = if s.movement.is_some() {
                movement::display_path_polyline_deg(
                    s.transform.lat_deg,
                    s.transform.lon_deg,
                    &s.movement_mode,
                )
                .map(|pts| {
                    pts.into_iter()
                        .map(|(lat_deg, lon_deg)| LatLonDegDto { lat_deg, lon_deg })
                        .collect()
                })
            } else {
                None
            };
            EntitySnapshotDto {
                id: s.id.clone(),
                name: s.name.clone(),
                allegiance: s.allegiance.clone(),
                lat_deg: s.transform.lat_deg,
                lon_deg: s.transform.lon_deg,
                hae_m: s.transform.hae_m,
                heading_deg: s.transform.heading_deg,
                sidc: s.symbol.sidc.clone(),
                movable: s.movement.is_some(),
                hide_map_marker: s.hide_map_marker,
                station_eta_sim_s,
                station_progress,
                display_path_deg,
                space: s.space_overlay.clone(),
            }
        })
        .collect()
}

/// Integrate simple kinematics for `dt_sim_s` (simulated seconds, not wall time).
fn integrate_entities(world: &mut [EntityState], dt_sim_s: f64) {
    for entity in world.iter_mut() {
        if entity.space.is_some() {
            continue;
        }
        let Some(ref mov) = entity.movement else {
            continue;
        };
        movement::integrate_entity(
            &mut entity.transform.lat_deg,
            &mut entity.transform.lon_deg,
            &mut entity.transform.heading_deg,
            mov.max_speed_knots,
            &mut entity.movement_mode,
            dt_sim_s,
        );
    }
}

fn player_may_command_unit(team: PlayerTeam, allegiance: &Allegiance) -> bool {
    match team {
        PlayerTeam::White => true,
        PlayerTeam::Red => matches!(allegiance, Allegiance::Hostile),
        PlayerTeam::Blue => matches!(allegiance, Allegiance::Friendly),
    }
}

/// Deliver chat to a peer. `io.to(socket_id)` does not reliably deliver to the sender's own socket in
/// socketioxide, so when `peer_id` is the current connection we emit on [`SocketRef`] directly.
fn emit_chat_to_peer(
    io: &SocketIo,
    socket: &SocketRef,
    peer_id: &str,
    sock_key: &str,
    msg: ChatMessageDto,
) {
    if peer_id == sock_key {
        socket.emit("chat_message", msg).ok();
    } else {
        io.to(peer_id.to_string()).emit("chat_message", msg).ok();
    }
}

const MAX_MOVEMENT_WAYPOINTS: usize = 48;

fn validate_waypoint_path(waypoints: &[(f64, f64)]) -> Result<(), String> {
    if waypoints.len() > MAX_MOVEMENT_WAYPOINTS {
        return Err(format!(
            "At most {MAX_MOVEMENT_WAYPOINTS} waypoints are allowed."
        ));
    }
    for (la, lo) in waypoints {
        if !la.is_finite() || !lo.is_finite() {
            return Err("Waypoint coordinates must be finite numbers.".to_string());
        }
        if *la < -90.0 || *la > 90.0 {
            return Err("Waypoint latitude must be between -90 and 90 degrees.".to_string());
        }
        if *lo < -180.0 || *lo > 180.0 {
            return Err("Waypoint longitude must be between -180 and 180 degrees.".to_string());
        }
    }
    Ok(())
}

fn station_phase_from_order(order: &MovementOrderDto) -> Result<movement::StationPhase, String> {
    match order {
        MovementOrderDto::Orbit {
            center_lat_deg,
            center_lon_deg,
            radius_m,
            clockwise,
        } => {
            let r = *radius_m;
            if !(movement::MIN_ORBIT_RADIUS_M..=movement::MAX_ORBIT_RADIUS_M).contains(&r) {
                return Err(format!(
                    "Orbit radius must be between {:.0} m and {:.0} m.",
                    movement::MIN_ORBIT_RADIUS_M,
                    movement::MAX_ORBIT_RADIUS_M
                ));
            }
            Ok(movement::StationPhase::Orbit {
                center_lat_deg: *center_lat_deg,
                center_lon_deg: *center_lon_deg,
                radius_m: r,
                clockwise: *clockwise,
            })
        }
        MovementOrderDto::Racetrack {
            point_a_lat_deg,
            point_a_lon_deg,
            point_b_lat_deg,
            point_b_lon_deg,
            orbit_distance_m,
            racetrack_clockwise,
        } => {
            let r = *orbit_distance_m;
            if !(movement::MIN_ORBIT_RADIUS_M..=movement::MAX_ORBIT_RADIUS_M).contains(&r) {
                return Err(format!(
                    "Racetrack turn radius must be between {:.0} m and {:.0} m.",
                    movement::MIN_ORBIT_RADIUS_M,
                    movement::MAX_ORBIT_RADIUS_M
                ));
            }
            let loop_path_deg = earth::racetrack_geometry::build_stadium_racetrack(
                *point_a_lat_deg,
                *point_a_lon_deg,
                *point_b_lat_deg,
                *point_b_lon_deg,
                r,
                *racetrack_clockwise,
            );
            Ok(movement::StationPhase::Racetrack {
                end_a_lat: *point_a_lat_deg,
                end_a_lon: *point_a_lon_deg,
                end_b_lat: *point_b_lat_deg,
                end_b_lon: *point_b_lon_deg,
                turn_radius_m: r,
                clockwise: *racetrack_clockwise,
                loop_path_deg,
            })
        }
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
    world: Arc<Mutex<Vec<EntityState>>>,
    /// Authoritative simulation clock + time scale (white cell adjusts scale via socket).
    timing: Arc<Mutex<SimTimingState>>,
    /// Natural Earth land polygons (or all-sea if disabled).
    land_mask: land_mask::LandSeaMask,
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
        win_conditions: loaded.formatted_win_conditions(),
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

fn entity_state_from_template(
    entity_template: &EntityConfig,
    instance_id: String,
    initial_transform: TransformWorld,
) -> EntityState {
    let mut movement: Option<MovementConfig> = None;
    let mut symbol: Option<SymbolConfig> = None;
    let mut space: Option<space::SpaceOrbitRuntime> = None;
    let mut hide_map_marker = false;

    for component in entity_template.components.iter() {
        match component.kind.as_str() {
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
            "space_orbit" => {
                let cfg: SpaceOrbitYaml =
                    serde_yaml::from_value(component.data.clone()).expect("space_orbit component");
                hide_map_marker = cfg.hide_map_marker;
                let orbit = space::SpaceOrbitConfig {
                    line1: cfg.line1,
                    line2: cfg.line2,
                    fov_half_angle_deg: cfg.fov_half_angle_deg,
                    hide_map_marker,
                };
                space = Some(
                    space::SpaceOrbitRuntime::from_config(orbit).expect("invalid TLE / space_orbit"),
                );
            }
            _ => {}
        }
    }

    EntityState {
        id: instance_id,
        name: entity_template.name.clone(),
        allegiance: entity_template.allegiance.clone(),
        transform: initial_transform,
        movement,
        movement_mode: movement::MovementMode::Cruise,
        movement_path_total_m: None,
        symbol: symbol.expect("entity missing symbol component"),
        space,
        space_overlay: None,
        hide_map_marker,
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

fn spawn_initial_entities(world_template: &WorldTemplate, scenario: &LoadedScenario) -> Vec<EntityState> {
    let spawns = &scenario.config.spawns;
    let red = &scenario.config.red_entities;
    let blue = &scenario.config.blue_entities;

    let mut entities = Vec::new();

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
                    let transform = TransformWorld { lat_deg: 0.0, lon_deg: 0.0, hae_m: 0.0, heading_deg: 0.0 };
                    entities.push(entity_state_from_template(entity_template, instance_id, transform));
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
            let mut transform = TransformWorld { lat_deg: 0.0, lon_deg: 0.0, hae_m: 0.0, heading_deg: 0.0 };
            apply_scenario_transform_overrides(&mut transform, entry);
            let entity = entity_state_from_template(entity_template, instance_id, transform);
            entities.push(entity);
        }
    } else {
        for entity_template in &world_template.entities {
            let transform = TransformWorld { lat_deg: 0.0, lon_deg: 0.0, hae_m: 0.0, heading_deg: 0.0 };
            entities.push(entity_state_from_template(
                entity_template,
                entity_template.id.clone(),
                transform
            ));
        }
    }

    entities
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

    let land_mask = land_mask::LandSeaMask::load_default();

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
        let land_mask_socket = land_mask.clone();
        io_for_ns.ns("/", move |socket: SocketRef| {
            on_connect(
                socket,
                store,
                io_for_handlers.clone(),
                world_template.clone(),
                scenario_catalog.clone(),
                sim_wall_for_socket.clone(),
                land_mask_socket.clone(),
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
    world: Arc<Mutex<Vec<EntityState>>>,
    timing: Arc<Mutex<SimTimingState>>,
    io: SocketIo,
    wall_tick: Duration,
    space_tick_interval: u64,
    mut objectives_blue: Vec<ObjectiveTracker>,
    mut objectives_red: Vec<ObjectiveTracker>,
    scenario_summary_dto: ScenarioSummaryDto,
) -> (JoinHandle<()>, tokio::sync::oneshot::Sender<()>) {
    let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel::<()>();

    let handle = tokio::spawn(async move {
        let mut ticker = time::interval(wall_tick);
        ticker.set_missed_tick_behavior(time::MissedTickBehavior::Delay);
        let mut tick_count: u64 = 0;
        let mut coverage_prev: HashSet<(String, String)> = HashSet::new();
        let mut game_over_emitted = false;
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

                    let (wall_dt_s, scale, session_start_utc, sim_elapsed_before) = {
                        let t = timing.lock().await;
                        (
                            t.wall_dt_s,
                            SimTimingState::clamp_time_scale(t.time_scale),
                            t.session_start_utc,
                            t.sim_elapsed_s,
                        )
                    };
                    let sim_advance_s = wall_dt_s * scale;
                    let sim_end_elapsed_s = sim_elapsed_before + sim_advance_s;
                    let end_time = session_start_utc
                        + chrono::Duration::nanoseconds((sim_end_elapsed_s * 1e9).round() as i64);

                    let mut space_events: Vec<SpaceCoverageEventDto> = Vec::new();

                    let entities_dto = {
                        let mut guard = world.lock().await;
                        let mut remaining = sim_advance_s;
                        while remaining > 1e-9 {
                            let step = remaining.min(MAX_SIM_SUBSTEP_S);
                            integrate_entities(&mut guard, step);
                            remaining -= step;
                        }

                        if tick_count == 1 {
                            propagate_space_entities(&mut guard, end_time);
                            let sats = collect_satellite_rows(&guard);
                            let ground = collect_ground_rows(&guard);
                            coverage_prev = space::current_coverage_pairs(&sats, &ground);
                        } else if tick_count > 1
                            && space_tick_interval > 0
                            && tick_count % space_tick_interval == 0
                        {
                            propagate_space_entities(&mut guard, end_time);
                            let sats = collect_satellite_rows(&guard);
                            let ground = collect_ground_rows(&guard);
                            let sim_str =
                                end_time.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                            space_events = space::diff_coverage_events(
                                &sats,
                                &ground,
                                &mut coverage_prev,
                                sim_str,
                            );
                        }

                        entity_snapshots_from_world(&guard)
                    };
                    
                    if !game_over_emitted {
                        let mut guard = world.lock().await;
                        let blue_wins = evaluate_team_objectives(&mut objectives_blue, &guard, sim_end_elapsed_s);
                        let red_wins = evaluate_team_objectives(&mut objectives_red, &guard, sim_end_elapsed_s);
                        if blue_wins || red_wins {
                            game_over_emitted = true;
                            // Optionally attach who won, but the struct alone signals end of game
                            io.to(session_id.clone())
                                .emit("game_over", scenario_summary_dto.clone())
                                .ok();
                        }
                    }

                    let dto = {
                        let mut t = timing.lock().await;
                        t.sim_elapsed_s += sim_advance_s;
                        t.to_world_snapshot(entities_dto, space_events)
                    };

                    let sim_elapsed_log = dto.sim_elapsed_s;
                    let time_scale_log = dto.time_scale;
                    let entity_count_log = dto.entities.len();

                    debug!(
                        "Game tick: session_name={} session_id={} tick_count={} emitting world_snapshot entities={} sim_elapsed_s={:.2} time_scale={:.2}",
                        session_name,
                        session_id,
                        tick_count,
                        entity_count_log,
                        sim_elapsed_log,
                        time_scale_log
                    );
                    io.to(session_id.clone())
                        .emit("world_snapshot", dto)
                        .ok();

                    if tick_count % 64 == 0 {
                        let count = world.lock().await.len();
                        info!(
                            "Game tick: session_name={} session_id={} tick_count={} entities={} sim_elapsed_s={:.1} time_scale={:.1}",
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
    land_mask: land_mask::LandSeaMask,
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
        let land_mask_create = land_mask.clone();
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

            let entities = spawn_initial_entities(&world_template, scenario);
            let world = Arc::new(Mutex::new(entities));
            {
                let guard = world.lock().await;
                info!(
                    "Session spawned scenario_id={} session_name={} session_id={} tick_count={} spawned_count={} entity_ids=[{}]",
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
            let space_tick_interval = space_tick_interval_from_env();
            
            let mut obs_b = Vec::new();
            let mut obs_r = Vec::new();
            if let Some(ref objs) = scenario.config.objectives {
                obs_b = objs.blue.iter().map(|c: &scenario::ObjectiveConfig| ObjectiveTracker::new(c.clone())).collect();
                obs_r = objs.red.iter().map(|c: &scenario::ObjectiveConfig| ObjectiveTracker::new(c.clone())).collect();
            }
            let summary_dto = scenario_summary(&world_template, scenario).to_dto();

            let (loop_handle, stop_tx) = spawn_game_loop(
                public.id.clone(),
                public.name.clone(),
                world.clone(),
                timing.clone(),
                io.clone(),
                wall_tick,
                space_tick_interval,
                obs_b,
                obs_r,
                summary_dto,
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
                land_mask: land_mask_create.clone(),
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
                    let snapshots = {
                        let guard = session.world.lock().await;
                        entity_snapshots_from_world(&guard)
                    };
                    let dto = {
                        let t = session.timing.lock().await;
                        t.to_world_snapshot(snapshots, vec![])
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
                    let snapshots = {
                        let guard = session.world.lock().await;
                        entity_snapshots_from_world(&guard)
                    };
                    let dto = {
                        let t = session.timing.lock().await;
                        t.to_world_snapshot(snapshots, vec![])
                    };
                    info!(
                        "Sending requested world_snapshot session_name={} session_id={} tick_count={} entities={}",
                        session.public.name,
                        data.id,
                        -1,
                        dto.entities.len()
                    );
                    socket.emit("world_snapshot", dto).ok();
                }
            },
        );
    }

    {
        let store = store.clone();
        socket.on(
            "issue_movement_order",
            |socket: SocketRef, Data::<IssueMovementOrderDto>(data)| async move {
                let socket_key = socket.id.to_string();
                let session_id = data.session_id.clone();
                let entity_id = data.entity_id.clone();

                let store_lock = store.lock().await;
                let Some(session) = store_lock.get(&session_id) else {
                    socket
                        .emit(
                            "movement_order_rejected",
                            ErrorDto {
                                message: "Session not found.".to_string(),
                            },
                        )
                        .ok();
                    return;
                };

                let Some(team) = session.player_teams.get(&socket_key).copied() else {
                    socket
                        .emit(
                            "movement_order_rejected",
                            ErrorDto {
                                message: "Join the session before issuing orders.".to_string(),
                            },
                        )
                        .ok();
                    return;
                };

                let waypoints: Vec<(f64, f64)> = data
                    .waypoints
                    .iter()
                    .map(|w| (w.lat_deg, w.lon_deg))
                    .collect();

                if let Err(msg) = validate_waypoint_path(&waypoints) {
                    socket
                        .emit("movement_order_rejected", ErrorDto { message: msg })
                        .ok();
                    return;
                }

                let station = match station_phase_from_order(&data.order) {
                    Ok(s) => s,
                    Err(msg) => {
                        socket
                            .emit("movement_order_rejected", ErrorDto { message: msg })
                            .ok();
                        return;
                    }
                };

                let mut guard = session.world.lock().await;
                let Some(entity) = guard.iter_mut().find(|s| s.id == entity_id) else {
                    socket
                        .emit(
                            "movement_order_rejected",
                            ErrorDto {
                                message: "Unknown unit id.".to_string(),
                            },
                        )
                        .ok();
                    return;
                };

                if entity.movement.is_none() {
                    socket
                        .emit(
                            "movement_order_rejected",
                            ErrorDto {
                                message: "That unit cannot receive movement orders.".to_string(),
                            },
                        )
                        .ok();
                    return;
                }

                if !player_may_command_unit(team, &entity.allegiance) {
                    socket
                        .emit(
                            "movement_order_rejected",
                            ErrorDto {
                                message: "You cannot command that unit.".to_string(),
                            },
                        )
                        .ok();
                    return;
                }

                let enforce_land = entity
                    .movement
                    .as_ref()
                    .is_some_and(|m| !m.skip_land_mask);
                if let Some(msg) = land_mask::movement_order_violates_land(
                    &session.land_mask,
                    enforce_land,
                    entity.transform.lat_deg,
                    entity.transform.lon_deg,
                    &waypoints,
                    &station,
                ) {
                    socket
                        .emit("movement_order_rejected", ErrorDto { message: msg })
                        .ok();
                    return;
                }

                let slat = entity.transform.lat_deg;
                let slon = entity.transform.lon_deg;
                let total_m = movement::plan_total_path_m(slat, slon, &waypoints, &station);
                entity.movement_path_total_m = Some(total_m);
                entity.movement_mode = movement::mode_from_waypoints_and_station(
                    waypoints,
                    station,
                    slat,
                    slon,
                );
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
            let white_red_peer_ids: Vec<String> = session
                .player_teams
                .iter()
                .filter(|(_, t)| **t == PlayerTeam::White || **t == PlayerTeam::Red)
                .map(|(id, _)| id.clone())
                .collect();
            let white_blue_peer_ids: Vec<String> = session
                .player_teams
                .iter()
                .filter(|(_, t)| **t == PlayerTeam::White || **t == PlayerTeam::Blue)
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
                        emit_chat_to_peer(&io, &socket, &peer_id, &sock_key, msg.clone());
                    }
                }
                ChatScopeDto::WhiteRed => {
                    if sender_team != PlayerTeam::White {
                        return;
                    }
                    for peer_id in white_red_peer_ids {
                        emit_chat_to_peer(&io, &socket, &peer_id, &sock_key, msg.clone());
                    }
                }
                ChatScopeDto::WhiteBlue => {
                    if sender_team != PlayerTeam::White {
                        return;
                    }
                    for peer_id in white_blue_peer_ids {
                        emit_chat_to_peer(&io, &socket, &peer_id, &sock_key, msg.clone());
                    }
                }
                ChatScopeDto::TeamWhite => {
                    match sender_team {
                        PlayerTeam::Red => {
                            for peer_id in white_red_peer_ids {
                                emit_chat_to_peer(&io, &socket, &peer_id, &sock_key, msg.clone());
                            }
                        }
                        PlayerTeam::Blue => {
                            for peer_id in white_blue_peer_ids {
                                emit_chat_to_peer(&io, &socket, &peer_id, &sock_key, msg.clone());
                            }
                        }
                        PlayerTeam::White => return,
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
