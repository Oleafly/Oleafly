use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use oleafly_collab_protocol::ids::{AccountId, DeviceId};
use oleafly_collab_protocol::roles::ServerRole;
use rusqlite::params;

use crate::build_router;
use crate::clock::{Clock, ManualClock};
use crate::config::ServerConfig;
use crate::db::Db;
use crate::members;
use crate::state::AppState;
use crate::tokens;

pub const TEST_PUBLIC_URL: &str = "https://collab.test";
pub const TEST_SETUP_CODE: &str = "TEST-SETUP-CODE-0001";
pub const TEST_START_MS: i64 = 1_760_000_000_000;

pub struct TestApp {
    pub state: AppState,
    pub router: axum::Router,
    pub clock: Arc<ManualClock>,
}

pub struct SeededMember {
    pub account_id: AccountId,
    pub device_id: DeviceId,
    pub access_token: String,
}

pub fn test_config() -> ServerConfig {
    let vars: BTreeMap<String, String> = [
        ("OLEAFLY_PUBLIC_URL", TEST_PUBLIC_URL.to_string()),
        ("OLEAFLY_SETUP_CODE", TEST_SETUP_CODE.to_string()),
        (
            "OLEAFLY_DATA_DIR",
            std::env::temp_dir()
                .join("oleafly-server-test-data")
                .display()
                .to_string(),
        ),
    ]
    .into_iter()
    .map(|(key, value)| (key.to_string(), value))
    .collect();
    ServerConfig::from_vars(&vars, &no_secret_files).expect("the test configuration is valid")
}

pub async fn test_app() -> TestApp {
    test_app_with(test_config()).await
}

pub async fn test_app_with(config: ServerConfig) -> TestApp {
    let clock = ManualClock::new(TEST_START_MS);
    let shared: Arc<dyn Clock> = clock.clone();
    let database = Db::open_in_memory().expect("the in-memory database opens");
    let state = AppState::with_db(config, shared, database)
        .await
        .expect("the app state builds");
    let router = build_router(state.clone());
    TestApp {
        state,
        router,
        clock,
    }
}

pub async fn seed_member(app: &TestApp, role: ServerRole) -> SeededMember {
    let now = app.clock.now_ms();
    app.state
        .db
        .call(move |conn| {
            let account_id = AccountId::new_v7();
            let device_id = DeviceId::new_v7();
            let label = members::role_to_str(role);
            conn.execute(
                "INSERT INTO accounts (id, display_name, avatar_url, server_role, status, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, 'active', ?4, ?4)",
                params![account_id.to_string(), format!("Seeded {label}"), label, now],
            )?;
            conn.execute(
                "INSERT INTO devices (id, account_id, public_key, name, platform, created_at, last_seen_at) VALUES (?1, ?2, ?3, 'Seeded device', 'test', ?4, ?4)",
                params![device_id.to_string(), account_id.to_string(), tokens::random_token(), now],
            )?;
            let (access_token, _) = tokens::issue_access_token(conn, account_id, device_id, now)?;
            Ok(SeededMember {
                account_id,
                device_id,
                access_token,
            })
        })
        .await
        .expect("seeding a member works")
}

fn no_secret_files(path: &Path) -> std::io::Result<String> {
    Err(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        path.display().to_string(),
    ))
}
mod crowd;

pub use crowd::{
    find_shared_project, grant_project_role, init_dev_logging, project_log, seed_person,
    serve_until, PersonSeed, ProjectLog,
};
mod mock_github;

pub use mock_github::{authorization_code, github_provider, MockGithub, MockGithubUser};
mod mock_oidc;

pub use mock_oidc::{oidc_provider, MockOidc, MockOidcUser, TestSigner};
mod server;

pub use server::{
    allowlist, api_error_code, app_callback, challenge_nonce, follow_to_app, no_redirect_client,
    redeem, refresh_session, security_event_kinds, sign_in, SignInAttempt, TestDevice, TestServer,
    TEST_REDIRECT_URI,
};
