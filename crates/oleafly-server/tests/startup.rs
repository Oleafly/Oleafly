use std::io::{self, Write};
use std::sync::{Arc, Mutex};

use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::clock::ManualClock;
use oleafly_server::db::{self, Db};
use oleafly_server::members;
use oleafly_server::state::{generate_setup_code, setup_code_hash, AppState};
use oleafly_server::test_support::{test_app, test_app_with, test_config, TEST_SETUP_CODE};

#[derive(Clone, Default)]
struct Capture(Arc<Mutex<Vec<u8>>>);

impl Write for Capture {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0
            .lock()
            .expect("capture lock")
            .extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Capture {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.0.lock().expect("capture lock")).into_owned()
    }
}

fn capture_logs() -> (Capture, tracing::subscriber::DefaultGuard) {
    let capture = Capture::default();
    let writer = capture.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_writer(move || writer.clone())
        .with_ansi(false)
        .finish();
    (capture, tracing::subscriber::set_default(subscriber))
}

async fn stored_setup_hash(state: &AppState) -> Option<String> {
    state
        .db
        .call(|conn| db::meta_get(conn, db::SETUP_CODE_HASH_KEY))
        .await
        .unwrap()
}

#[tokio::test]
async fn a_preset_setup_code_is_stored_as_a_hash_and_never_logged() {
    let (capture, _guard) = capture_logs();
    let app = test_app().await;
    assert_eq!(
        stored_setup_hash(&app.state).await,
        Some(setup_code_hash(TEST_SETUP_CODE))
    );
    let logs = capture.text();
    assert_eq!(logs.matches("Setup code: ").count(), 1);
    assert!(logs.contains("Setup code: set by OLEAFLY_SETUP_CODE. "));
    assert!(!logs.contains(TEST_SETUP_CODE));
}

#[tokio::test]
async fn startup_without_an_admin_logs_one_generated_setup_code() {
    let (capture, _guard) = capture_logs();
    let mut config = test_config();
    config.setup_code = None;
    let app = test_app_with(config).await;
    let logs = capture.text();
    assert_eq!(logs.matches("Setup code: ").count(), 1);
    let code = logs
        .split("Setup code: ")
        .nth(1)
        .and_then(|rest| rest.split('.').next())
        .expect("the log line carries the code");
    assert_eq!(code.len(), 19);
    assert!(logs.contains(&format!(
        "Setup code: {code}. This server has no admin yet. Enter the code in Oleafly when you add the server. It works once."
    )));
    assert_eq!(
        stored_setup_hash(&app.state).await,
        Some(setup_code_hash(code))
    );
    let values = app
        .state
        .db
        .call(|conn| {
            let mut statement = conn.prepare("SELECT value FROM server_meta")?;
            let values = statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(values)
        })
        .await
        .unwrap();
    assert!(values.iter().all(|value| !value.contains(code)));
}

#[tokio::test]
async fn startup_with_an_admin_clears_the_setup_code_and_logs_nothing() {
    let (capture, _guard) = capture_logs();
    let database = Db::open_in_memory().unwrap();
    database
        .call(|conn| {
            members::create_account(conn, "Ada", None, ServerRole::Admin, 1)?;
            db::meta_set(conn, db::SETUP_CODE_HASH_KEY, "stale")?;
            Ok(())
        })
        .await
        .unwrap();
    let state = AppState::with_db(test_config(), ManualClock::new(1), database)
        .await
        .unwrap();
    assert_eq!(stored_setup_hash(&state).await, None);
    assert!(!capture.text().contains("Setup code: "));
}

#[test]
fn generated_setup_codes_are_readable() {
    let code = generate_setup_code();
    assert_eq!(code.len(), 19);
    let groups: Vec<&str> = code.split('-').collect();
    assert_eq!(groups.len(), 4);
    assert!(groups.iter().all(|group| group.len() == 4
        && group
            .chars()
            .all(|character| "0123456789ABCDEFGHJKMNPQRSTVWXYZ".contains(character))));
    assert_ne!(generate_setup_code(), code);
    assert_eq!(
        setup_code_hash("test-setup code-0001"),
        "OeWgrscx-X2Ei0Xi4OtKDXNUjWMgapHEv86jLZxzdf0"
    );
}

#[tokio::test]
async fn the_server_id_is_stable_for_a_database() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("oleafly-server.sqlite3");
    let first = AppState::with_db(test_config(), ManualClock::new(1), Db::open(&path).unwrap())
        .await
        .unwrap()
        .server_id;
    let second = AppState::with_db(test_config(), ManualClock::new(2), Db::open(&path).unwrap())
        .await
        .unwrap()
        .server_id;
    assert_eq!(first, second);
    assert_ne!(test_app().await.state.server_id, first);
}
