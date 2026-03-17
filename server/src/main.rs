use axum::routing::get;
use socketioxide::{
    extract::{Data, SocketRef},
    SocketIo,
};
use tracing::info;
use tower_http::cors::CorsLayer;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::{self, Duration};

mod ecs;
use ecs::WorldTemplate;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionPublic {
    id: String,
    name: String,
}

struct GameSession {
    public: SessionPublic,
    stop_tx: Option<tokio::sync::oneshot::Sender<()>>,
    _loop_handle: JoinHandle<()>,
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

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();
    info!("Starting server...");

    // Load entity/component templates from YAML/JSON files for the game engine.
    let world_template = WorldTemplate::load_from_dir("config/entities")?;
    info!("Loaded {} entity template(s)", world_template.entities.len());

    let sessions_store: Arc<Mutex<HashMap<String, GameSession>>> =
        Arc::new(Mutex::new(HashMap::new()));
    
    let (layer, io) = SocketIo::new_layer();

    {
        let store = sessions_store.clone();
        io.ns("/", move |socket: SocketRef| on_connect(socket, store));
    }

    let app = axum::Router::new()
        .route("/", get(|| async { "Naval Game Server" }))
        .layer(layer)
        .layer(CorsLayer::permissive())
        .with_state(sessions_store);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3001".to_string());
    let addr = format!("0.0.0.0:{}", port);
    
    info!("Server listening on port {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    
    axum::serve(listener, app).await?;

    Ok(())
}

fn spawn_game_loop(session_id: String, session_name: String) -> (JoinHandle<()>, tokio::sync::oneshot::Sender<()>) {
    let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel::<()>();

    let handle = tokio::spawn(async move {
        let mut ticker = time::interval(Duration::from_millis(250));
        loop {
            tokio::select! {
                _ = &mut stop_rx => {
                    info!("Game loop stopped for session {}", session_id);
                    break;
                }
                _ = ticker.tick() => {
                    // Placeholder tick: game state + event emission will live here.
                    info!("Game tick: session={} name={}", session_id, session_name);
                }
            }
        }
    });

    (handle, stop_tx)
}

fn on_connect(socket: SocketRef, store: Arc<Mutex<HashMap<String, GameSession>>>) {
    info!("A user connected: {}", socket.id);

    {
        let store = store.clone();
        socket.on("create_session", |socket: SocketRef, Data::<CreateSessionData>(data)| async move {
            let id = uuid::Uuid::new_v4().to_string().chars().take(8).collect::<String>();
            let public = SessionPublic {
                id: id.clone(),
                name: data.name,
            };

            let (loop_handle, stop_tx) = spawn_game_loop(public.id.clone(), public.name.clone());
            let game_session = GameSession {
                public: public.clone(),
                stop_tx: Some(stop_tx),
                _loop_handle: loop_handle,
            };
            
            store.lock().await.insert(id.clone(), game_session);
            info!("Session created: {:?}", public);
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
                info!("User {} joined session {}", socket.id, data.id);
            }
        });
    }

    {
        let store = store.clone();
        socket.on("stop_session", |socket: SocketRef, Data::<StopSessionData>(data)| async move {
            let mut store_lock = store.lock().await;
            if let Some(mut session) = store_lock.remove(&data.id) {
                if let Some(stop_tx) = session.stop_tx.take() {
                    let _ = stop_tx.send(());
                }
                info!("Session stopped: {}", data.id);
                // Notify everyone in the session room that this game has stopped.
                let public = session.public;
                socket.to(data.id.clone()).emit("session_stopped", public.clone()).ok();
                // Also notify the stopper explicitly (they may or may not be in the room).
                socket.emit("session_stopped", public).ok();
            }
        });
    }
}
