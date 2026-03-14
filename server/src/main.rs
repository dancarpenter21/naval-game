use axum::routing::get;
use socketioxide::{
    extract::{Data, SocketRef},
    SocketIo,
};
use axum::extract::State;
use tracing::info;
use tower_http::cors::CorsLayer;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Session {
    id: String,
    name: String,
}

#[derive(Debug, Deserialize)]
struct CreateSessionData {
    name: String,
}

#[derive(Debug, Deserialize)]
struct JoinSessionData {
    id: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();
    info!("Starting server...");

    let sessions_store: Arc<Mutex<HashMap<String, Session>>> = Arc::new(Mutex::new(HashMap::new()));
    
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

fn on_connect(socket: SocketRef, store: Arc<Mutex<HashMap<String, Session>>>) {
    info!("A user connected: {}", socket.id);

    {
        let store = store.clone();
        socket.on("create_session", |socket: SocketRef, Data::<CreateSessionData>(data)| async move {
            let id = uuid::Uuid::new_v4().to_string().chars().take(8).collect::<String>();
            let session = Session {
                id: id.clone(),
                name: data.name,
            };
            
            store.lock().await.insert(id.clone(), session.clone());
            info!("Session created: {:?}", session);
            socket.join(id.clone());
            socket.emit("session_created", session).ok();
        });
    }

    {
        let store = store.clone();
        socket.on("get_sessions", |socket: SocketRef| async move {
            let store_lock = store.lock().await;
            let sessions: Vec<Session> = store_lock.values().cloned().collect();
            socket.emit("sessions_list", sessions).ok();
        });
    }

    {
        let store = store.clone();
        socket.on("join_session", |socket: SocketRef, Data::<JoinSessionData>(data)| async move {
            let store_lock = store.lock().await;
            if let Some(session) = store_lock.get(&data.id) {
                socket.join(data.id.clone());
                socket.emit("session_joined", session).ok();
                info!("User {} joined session {}", socket.id, data.id);
            }
        });
    }
}
