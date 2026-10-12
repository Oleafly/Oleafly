use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use oleafly_collab::ServerUrl;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use tokio::task::JoinHandle;

pub struct Relay {
    pub url: ServerUrl,
    online: Arc<AtomicBool>,
    cut: Arc<watch::Sender<u64>>,
    task: JoinHandle<()>,
}

impl Relay {
    pub async fn start(upstream: SocketAddr) -> Relay {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind the relay");
        let port = listener.local_addr().expect("relay address").port();
        let online = Arc::new(AtomicBool::new(true));
        let (cut, _) = watch::channel(0u64);
        let cut = Arc::new(cut);
        let (accepting, cuts) = (Arc::clone(&online), Arc::clone(&cut));
        let task = tokio::spawn(async move {
            while let Ok((mut client, _)) = listener.accept().await {
                if !accepting.load(Ordering::SeqCst) {
                    drop(client);
                    continue;
                }
                let mut cut = cuts.subscribe();
                tokio::spawn(async move {
                    let Ok(mut server) = TcpStream::connect(upstream).await else {
                        return;
                    };
                    let _ = client.set_nodelay(true);
                    let _ = server.set_nodelay(true);
                    tokio::select! {
                        _ = tokio::io::copy_bidirectional(&mut client, &mut server) => {}
                        _ = cut.changed() => {}
                    }
                });
            }
        });
        Relay {
            url: ServerUrl::parse(&format!("http://127.0.0.1:{port}")).expect("relay url"),
            online,
            cut,
            task,
        }
    }

    pub fn go_offline(&self) {
        self.online.store(false, Ordering::SeqCst);
        self.cut.send_modify(|count| *count += 1);
    }

    pub fn go_online(&self) {
        self.online.store(true, Ordering::SeqCst);
    }
}

impl Drop for Relay {
    fn drop(&mut self) {
        self.task.abort();
    }
}
