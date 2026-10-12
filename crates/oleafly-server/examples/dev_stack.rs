use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;

use oleafly_collab_protocol::admin::NewDomainRule;
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::clock::SystemClock;
use oleafly_server::config::ServerConfig;
use oleafly_server::state::AppState;
use oleafly_server::test_support::{github_provider, MockGithub, MockGithubUser};

const SERVER: &str = "127.0.0.1:8787";
const GITHUB: &str = "127.0.0.1:8790";
const SETUP_CODE: &str = "DEV-SETUP-CODE-0001";

fn person(id: u64, login: &str, name: &str) -> MockGithubUser {
    MockGithubUser {
        id,
        login: login.to_owned(),
        name: name.to_owned(),
        emails: vec![(format!("{login}@lab.test"), true)],
    }
}

fn no_secret_files(path: &Path) -> std::io::Result<String> {
    Err(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        path.display().to_string(),
    ))
}

#[tokio::main]
async fn main() {
    let data_dir = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "target/dev-stack".to_owned());
    std::fs::create_dir_all(&data_dir).expect("create the data folder");
    let github = MockGithub::start_rotating_on(
        GITHUB,
        vec![
            person(8, "bob", "Bob Smith"),
            person(9, "alice", "Alice Chen"),
        ],
    )
    .await;
    let vars: BTreeMap<String, String> = [
        ("OLEAFLY_PUBLIC_URL", format!("http://{SERVER}")),
        ("OLEAFLY_BIND", SERVER.to_owned()),
        ("OLEAFLY_DATA_DIR", data_dir.clone()),
        ("OLEAFLY_SETUP_CODE", SETUP_CODE.to_owned()),
        ("OLEAFLY_SERVER_NAME", "Smith Lab".to_owned()),
        ("OLEAFLY_LOG_LEVEL", "info".to_owned()),
    ]
    .into_iter()
    .map(|(key, value)| (key.to_owned(), value))
    .collect();
    let mut config = ServerConfig::from_vars(&vars, &no_secret_files).expect("dev configuration");
    config.providers.push(github_provider("github", &github));
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .with_ansi(false)
        .with_target(false)
        .init();
    let state = AppState::new(config, Arc::new(SystemClock))
        .await
        .expect("the dev server starts");
    let seeded = state
        .db
        .call(|conn| {
            let rule = NewDomainRule {
                domain: "lab.test".to_owned(),
                role: ServerRole::Member,
            };
            Ok(oleafly_server::members::add_domain_rule(conn, &rule, None, 0).is_ok())
        })
        .await
        .expect("seed the domain rule");
    let listener = tokio::net::TcpListener::bind(SERVER)
        .await
        .expect("listen on the dev address");
    println!("Oleafly dev server on http://{SERVER} (data in {data_dir})");
    println!("Setup code for the first sign-in: {SETUP_CODE}");
    println!("Mock GitHub signs in Bob Smith first, then Alice Chen, in turn.");
    if seeded {
        println!("Anyone with an @lab.test email is admitted as a member.");
    }
    let app =
        oleafly_server::build_router(state).into_make_service_with_connect_info::<SocketAddr>();
    axum::serve(listener, app)
        .await
        .expect("the dev server runs");
}
