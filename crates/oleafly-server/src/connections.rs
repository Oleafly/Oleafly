use std::future::Future;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{ConnectInfo, Request};
use axum::middleware::Next;
use axum::response::Response;
use axum::serve::Listener;
use axum::Router;
use hyper_util::rt::{TokioExecutor, TokioIo, TokioTimer};
use hyper_util::server::conn::auto::Builder;
use hyper_util::service::TowerToHyperService;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;

// A new connection must send the headers of its first request within
// `first_request`, so a client can't hold one open by trickling them in
// before anything has checked who it is. After each response a connection
// may wait, and then send its next request's headers, for `keep_alive` in
// all before it is closed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ConnectionTimeouts {
    pub first_request: Duration,
    pub keep_alive: Duration,
}

impl Default for ConnectionTimeouts {
    fn default() -> ConnectionTimeouts {
        ConnectionTimeouts {
            first_request: Duration::from_secs(15),
            keep_alive: Duration::from_secs(75),
        }
    }
}

struct Connection {
    remote: SocketAddr,
    asked: Arc<AtomicBool>,
}

tokio::task_local! {
    static CONNECTION: Connection;
}

// Gives each request the address it came from, and notes that its
// connection got a request through. Requests are handled on their
// connection's task, which holds both.
pub(crate) async fn connect_info(mut request: Request, next: Next) -> Response {
    let remote = CONNECTION.try_with(|connection| {
        connection.asked.store(true, Ordering::SeqCst);
        connection.remote
    });
    if let Ok(remote) = remote {
        request.extensions_mut().insert(ConnectInfo(remote));
    }
    next.run(request).await
}

// Serves the app until `shutdown` finishes, then lets each connection
// finish what it is doing and waits for them.
pub(crate) async fn serve<F>(
    mut listener: TcpListener,
    app: Router,
    timeouts: ConnectionTimeouts,
    shutdown: F,
) where
    F: Future<Output = ()> + Send + 'static,
{
    let (stop, stopping) = watch::channel(false);
    let (open, opened) = watch::channel(());
    let mut shutdown = std::pin::pin!(shutdown);
    loop {
        let (stream, remote) = tokio::select! {
            accepted = Listener::accept(&mut listener) => accepted,
            () = &mut shutdown => break,
        };
        let app = app.clone();
        let stopping = stopping.clone();
        let opened = opened.clone();
        tokio::spawn(async move {
            let asked = Arc::new(AtomicBool::new(false));
            let connection = Connection {
                remote,
                asked: Arc::clone(&asked),
            };
            CONNECTION
                .scope(
                    connection,
                    serve_connection(stream, app, timeouts, asked, stopping),
                )
                .await;
            drop(opened);
        });
    }
    drop(listener);
    stop.send_replace(true);
    drop(opened);
    open.closed().await;
}

async fn serve_connection(
    stream: TcpStream,
    app: Router,
    timeouts: ConnectionTimeouts,
    asked: Arc<AtomicBool>,
    mut stopping: watch::Receiver<bool>,
) {
    let mut builder = Builder::new(TokioExecutor::new());
    builder
        .http1()
        .timer(TokioTimer::new())
        .header_read_timeout(timeouts.keep_alive);
    let served =
        builder.serve_connection_with_upgrades(TokioIo::new(stream), TowerToHyperService::new(app));
    let mut served = std::pin::pin!(served);
    let first = tokio::time::sleep(timeouts.first_request);
    let mut first = std::pin::pin!(first);
    let mut waiting = true;
    let mut stopped = false;
    loop {
        tokio::select! {
            result = served.as_mut() => {
                if let Err(error) = result {
                    tracing::trace!("A connection ended: {error}");
                }
                return;
            }
            () = &mut first, if waiting => {
                if !asked.load(Ordering::SeqCst) {
                    return;
                }
                waiting = false;
            }
            _ = stopping.wait_for(|stop| *stop), if !stopped => {
                stopped = true;
                served.as_mut().graceful_shutdown();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::routing::get;
    use tower::ServiceExt;

    use super::*;

    #[tokio::test]
    async fn a_request_carries_the_address_of_its_connection() {
        let app =
            Router::new()
                .route(
                    "/",
                    get(|ConnectInfo(remote): ConnectInfo<SocketAddr>| async move {
                        remote.to_string()
                    }),
                )
                .layer(axum::middleware::from_fn(connect_info));
        let remote: SocketAddr = "192.0.2.7:4242".parse().unwrap();
        let asked = Arc::new(AtomicBool::new(false));
        let connection = Connection {
            remote,
            asked: Arc::clone(&asked),
        };
        let request = axum::http::Request::builder()
            .uri("/")
            .body(Body::empty())
            .unwrap();
        let response = CONNECTION
            .scope(connection, app.oneshot(request))
            .await
            .unwrap();
        assert_eq!(response.status(), axum::http::StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), 1024)
            .await
            .unwrap();
        assert_eq!(body, "192.0.2.7:4242");
        assert!(asked.load(Ordering::SeqCst));
    }
}
