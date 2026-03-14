use axum::routing::get;
use socketioxide::{
    extract::{Data, SocketRef},
    SocketIo,
};
use tracing::info;
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();

    info!("Starting server...");

    let (layer, io) = SocketIo::new_layer();

    io.ns("/", on_connect);

    let app = axum::Router::new()
        .route("/", get(|| async { "Naval Game Server" }))
        .layer(layer)
        .layer(CorsLayer::permissive());

    let port = std::env::var("PORT").unwrap_or_else(|_| "3001".to_string());
    let addr = format!("0.0.0.0:{}", port);
    
    info!("Server listening on port {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    
    axum::serve(listener, app).await?;

    Ok(())
}

fn on_connect(socket: SocketRef) {
    info!("A user connected: {}", socket.id);

    socket.on_disconnect(|socket: SocketRef| async move {
        info!("User disconnected: {}", socket.id);
    });
}
