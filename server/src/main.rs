use axum::routing::get;
use socketioxide::{
    extract::{Data, SocketRef},
    SocketIo,
};
use tracing::{debug, info};
use tower_http::cors::CorsLayer;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::env;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::{self, Duration};

mod ecs;
use ecs::WorldTemplate;

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

#[derive(Debug, Clone, Deserialize)]
struct SymbolConfig {
    sidc: String,
}

#[derive(Debug, Clone, Serialize)]
struct ShipSnapshot {
    id: String,
    name: String,
    lat_deg: f64,
    lon_deg: f64,
    hae_m: f64,
    heading_deg: f64,
    sidc: String,
}

#[derive(Debug, Clone)]
struct ShipState {
    id: String,
    name: String,
    transform: TransformWorld,
    movement: MovementConfig,
    symbol: SymbolConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionPublic {
    id: String,
    name: String,
}

fn on_session_closed_stub(_public: &SessionPublic) {
    // Stub hook for game logging/recording when the session closes.
    // Intentionally left empty for now.
}

struct GameSession {
    public: SessionPublic,
    stop_tx: Option<tokio::sync::oneshot::Sender<()>>,
    _loop_handle: JoinHandle<()>,
    world: Arc<Mutex<Vec<ShipState>>>,
}

#[derive(Debug, Deserialize)]
struct CreateSessionData {
    name: String,
}

#[derive(Debug, Deserialize)]
struct JoinSessionData {
    id: String,
}

#[derive(Debug, Deserialize)]
struct StopSessionData {
    id: String,
}

#[derive(Debug, Deserialize)]
struct SnapshotRequestData {
    id: String,
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

    let sessions_store: Arc<Mutex<HashMap<String, GameSession>>> =
        Arc::new(Mutex::new(HashMap::new()));
    
    let (layer, io) = SocketIo::new_layer();

    {
        let store = sessions_store.clone();
        let io_for_ns = io.clone();
        let io_for_handlers = io.clone();
        let world_template = world_template.clone();
        io_for_ns.ns("/", move |socket: SocketRef| {
            on_connect(socket, store, io_for_handlers.clone(), world_template.clone())
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
                            ship.transform.hae_m = 0.0;
                        }

                        guard
                            .iter()
                            .map(|s| ShipSnapshot {
                                id: s.id.clone(),
                                name: s.name.clone(),
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
                        .emit("world_snapshot", snapshot)
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
        socket.on("create_session", |socket: SocketRef, Data::<CreateSessionData>(data)| async move {
            let id = uuid::Uuid::new_v4().to_string().chars().take(8).collect::<String>();
            let public = SessionPublic {
                id: id.clone(),
                name: data.name,
            };

            // Spawn a single ship from the example template (frigate) into this session's world.
            let ship_template = world_template
                .entities
                .iter()
                .find(|e| e.id == "frigate")
                .cloned()
                .expect("expected an entity template with id 'frigate'");

            let mut transform: Option<TransformWorld> = None;
            let mut movement: Option<MovementConfig> = None;
            let mut symbol: Option<SymbolConfig> = None;

            for component in ship_template.components.iter() {
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

            let ship = ShipState {
                id: ship_template.id.clone(),
                name: ship_template.name.clone(),
                transform: transform.expect("frigate missing transform component"),
                movement: movement.expect("frigate missing movement component"),
                symbol: symbol.expect("frigate missing symbol component"),
            };

            let world = Arc::new(Mutex::new(vec![ship]));
            {
                let guard = world.lock().await;
                info!(
                    "Session spawned session_name={} session_id={} tick_count={} spawned_count={} ship_ids=[{}]",
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
            let game_session = GameSession {
                public: public.clone(),
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
            socket.emit("session_created", public).ok();
        });
    }

    {
        let store = store.clone();
        socket.on("get_sessions", |socket: SocketRef| async move {
            let store_lock = store.lock().await;
            let sessions: Vec<SessionPublic> = store_lock.values().map(|s| s.public.clone()).collect();
            socket.emit("sessions_list", sessions).ok();
        });
    }

    {
        let store = store.clone();
        socket.on("join_session", |socket: SocketRef, Data::<JoinSessionData>(data)| async move {
            let store_lock = store.lock().await;
            if let Some(session) = store_lock.get(&data.id) {
                socket.join(data.id.clone());
                socket.emit("session_joined", session.public.clone()).ok();
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
                        .map(|s| ShipSnapshot {
                            id: s.id.clone(),
                            name: s.name.clone(),
                            lat_deg: s.transform.lat_deg,
                            lon_deg: s.transform.lon_deg,
                            hae_m: s.transform.hae_m,
                            heading_deg: s.transform.heading_deg,
                            sidc: s.symbol.sidc.clone(),
                        })
                        .collect::<Vec<_>>()
                };
                socket.emit("world_snapshot", snapshot).ok();
            }
        });
    }

    {
        let store = store.clone();
        socket.on(
            "request_world_snapshot",
            |socket: SocketRef, Data::<SnapshotRequestData>(data)| async move {
                let store_lock = store.lock().await;
                if let Some(session) = store_lock.get(&data.id) {
                    let snapshot = {
                        let guard = session.world.lock().await;
                        guard
                            .iter()
                            .map(|s| ShipSnapshot {
                                id: s.id.clone(),
                                name: s.name.clone(),
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
                    socket.emit("world_snapshot", snapshot).ok();
                }
            },
        );
    }

    {
        let store = store.clone();
        socket.on("stop_session", |socket: SocketRef, Data::<StopSessionData>(data)| async move {
            let session_id = data.id.clone();
            let mut store_lock = store.lock().await;
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

                // Notify everyone in the session room that this game has stopped.
                socket
                    .to(session_id.clone())
                    .emit("session_stopped", public.clone())
                    .ok();
                // Also notify the stopper explicitly (they may or may not be in the room).
                socket.emit("session_stopped", public).ok();

                // Disconnect all sockets connected to this session room.
                // This ensures the server is not left with lingering connections
                // once the session loop has been stopped.
                socket
                    .within(session_id)
                    .disconnect()
                    .ok();
            }
        });
    }
}
