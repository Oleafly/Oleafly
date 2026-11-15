use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;

use oleafly_online::client::Http;
use oleafly_online::realtime::{connect, Carrier, ProjectPage};
use oleafly_online::session::{Session, SessionHandle};
use oleafly_online::test_support::mock_overleaf::{MockOverleaf, MockProject};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use serde_json::json;
use tokio::net::{TcpListener, TcpStream};

const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/tls-ca");

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(Path::new(FIXTURES).join(name)).unwrap()
}

async fn tls_front(upstream: SocketAddr) -> u16 {
    let config = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        vec![CertificateDer::from(fixture("server.der"))],
        PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(fixture("server.key.der"))),
    )
    .unwrap();
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let acceptor = acceptor.clone();
            tokio::spawn(async move {
                let Ok(mut client) = acceptor.accept(stream).await else {
                    return;
                };
                let Ok(mut server) = TcpStream::connect(upstream).await else {
                    return;
                };
                let _ = tokio::io::copy_bidirectional(&mut client, &mut server).await;
            });
        }
    });
    port
}

fn trust(roots: &Path) {
    std::env::set_var("SSL_CERT_FILE", roots);
    std::env::remove_var("SSL_CERT_DIR");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn private_ca_server_connects_with_native_roots() {
    let mock = MockOverleaf::start(MockProject::new("private").doc("main.tex", "Private")).await;
    let upstream: SocketAddr = mock.base.trim_start_matches("http://").parse().unwrap();
    let port = tls_front(upstream).await;
    let base = format!("https://localhost:{port}");

    trust(&Path::new(FIXTURES).join("other.pem"));
    let stranger =
        url::Url::parse(&format!("wss://localhost:{port}/socket.io/1/websocket/x")).unwrap();
    let Err(refused) = oleafly_net::open_websocket(&stranger, Default::default()).await else {
        panic!("a server signed by an unknown CA is refused");
    };
    assert!(
        refused
            .to_string()
            .to_ascii_lowercase()
            .contains("certificate"),
        "{refused}"
    );

    trust(&Path::new(FIXTURES).join("ca.pem"));
    let http = Http::new(&base, "Oleafly/test").unwrap();
    let alice = mock.user("alice");
    let session = SessionHandle::new(
        &base,
        Session {
            cookie: alice.cookie(),
            user_id: alice.id.clone(),
            email: alice.email.clone(),
            saved_by: None,
        },
        None,
    );
    let page = ProjectPage::load(&http, &session, &mock.project_id(), false)
        .await
        .unwrap();
    for carrier in [Carrier::WebSocket, Carrier::XhrPolling] {
        let (connection, join) = connect(&http, &session, &page, &[carrier]).await.unwrap();
        assert_eq!(connection.carrier(), carrier);
        assert_eq!(join.response["permissionsLevel"], "owner");
        let doc = mock.doc_id("main.tex");
        let reply = connection
            .call("joinDoc", vec![json!(doc), json!({})])
            .await
            .unwrap();
        assert_eq!(reply[1], json!(["Private"]));
        connection.close().await;
    }
}
