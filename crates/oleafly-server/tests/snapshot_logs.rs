use std::io::{self, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};

use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::projects::ProjectStatus;
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::build_router;
use oleafly_server::clock::ManualClock;
use oleafly_server::config::ServerConfig;
use oleafly_server::projects;
use oleafly_server::state::AppState;
use oleafly_server::test_support::{
    seed_member, test_config, SeededMember, TestApp, TEST_START_MS,
};
use rusqlite::params;

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

async fn boot(config: &ServerConfig) -> TestApp {
    let clock = ManualClock::new(TEST_START_MS);
    let state = AppState::new(config.clone(), clock.clone())
        .await
        .expect("the server starts");
    TestApp {
        router: build_router(state.clone()),
        state,
        clock,
    }
}

async fn legacy_project(
    app: &TestApp,
    data_dir: &Path,
    owner: &SeededMember,
    bytes: Option<&[u8]>,
) -> SharedProjectId {
    let account = owner.account_id;
    let project = app
        .state
        .db
        .call(move |conn| {
            let project = projects::create_pending(conn, account, "Legacy", TEST_START_MS)?;
            projects::set_status(conn, project, ProjectStatus::Active, TEST_START_MS)?;
            Ok(project)
        })
        .await
        .expect("a project");
    let relative = format!("snapshots/{project}/0-legacy.bin");
    if let Some(bytes) = bytes {
        let path = data_dir.join(&relative);
        std::fs::create_dir_all(path.parent().expect("parent")).expect("legacy folder");
        std::fs::write(&path, bytes).expect("legacy file");
    }
    app.state
        .db
        .call(move |conn| {
            conn.execute(
                "INSERT INTO project_snapshots (project_id, seq, file, size, created_at, created_by) VALUES (?1, 0, ?2, 1, ?3, ?4)",
                params![project.to_string(), relative, TEST_START_MS, account.to_string()],
            )?;
            Ok(())
        })
        .await
        .expect("a legacy snapshot row");
    project
}

#[tokio::test]
async fn moving_snapshot_files_says_what_moved_and_what_is_left() {
    let data = tempfile::tempdir().expect("data folder");
    let mut config = test_config();
    config.data_dir = data.path().to_path_buf();
    let first = boot(&config).await;
    let owner = seed_member(&first, ServerRole::Member).await;
    legacy_project(&first, data.path(), &owner, Some(b"legacy zero")).await;
    let lost = legacy_project(&first, data.path(), &owner, None).await;
    drop(first);

    let (capture, guard) = capture_logs();
    boot(&config).await;
    drop(guard);
    let logs = capture.text();
    assert!(
        logs.contains("Moved 1 snapshot into the blob store"),
        "{logs}"
    );
    assert!(
        logs.contains(&format!(
            "Could not move the snapshot of project {lost} at 0"
        )),
        "{logs}"
    );
    assert!(
        logs.contains("1 snapshot still in the snapshots folder"),
        "{logs}"
    );

    let (capture, guard) = capture_logs();
    boot(&config).await;
    drop(guard);
    let logs = capture.text();
    assert!(!logs.contains("Moved"), "{logs}");
    assert!(
        logs.contains("1 snapshot still in the snapshots folder"),
        "{logs}"
    );
}
