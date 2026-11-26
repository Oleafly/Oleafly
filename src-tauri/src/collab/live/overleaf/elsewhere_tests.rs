use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use oleafly_collab::CollabError;
use oleafly_online::live::journal::{
    self, Holder, HolderKind, Journal, JournalError, ProjectManifest,
};
use oleafly_online::test_support::mock_overleaf::{MockOverleaf, MockProject};
use serde_json::json;

use super::commands::{live_elsewhere, live_now, live_project, resume, start, unlink};
use super::rig::{eventually, run, Quiet};
use super::tests::{collab_paths, imported_project, linked_to, signed_in_as};
use super::{forget_overleaf_project, git_sync_waits};
use crate::app_error::AppError;
use crate::collab::commands::CollabCommandError;
use crate::collab::live::host::LiveHost;
use crate::collab::live::lifecycle::stop;
use crate::collab::testing::TempLibrary;
use crate::overleaf::OverleafLink;

const AT_ONCE: Duration = Duration::from_secs(3);

fn data() -> PathBuf {
    crate::paths::oleafly_root().unwrap()
}

fn root_of(project_id: &str) -> PathBuf {
    crate::paths::project_dir(project_id).unwrap()
}

fn link_of(project_id: &str) -> OverleafLink {
    crate::overleaf::overleaf_link_of(project_id)
        .unwrap()
        .unwrap()
}

fn live_as(data: &Path, project_id: &str, by: HolderKind) -> Journal {
    let link = link_of(project_id);
    Journal::open_live(
        data,
        &link.server,
        &link.project_id,
        &root_of(project_id),
        by,
    )
    .unwrap()
}

fn paused_before(project_id: &str) {
    let link = link_of(project_id);
    let mut journal = Journal::open(&data(), &link.server, &link.project_id, None).unwrap();
    journal.set_manifest(ProjectManifest {
        paused: true,
        ..ProjectManifest::default()
    });
    journal.flush().unwrap();
}

fn wire(error: CollabError) -> serde_json::Value {
    serde_json::to_value(CollabCommandError::from(error)).unwrap()
}

fn names_the_command_line(error: CollabError) {
    let wire = wire(error);
    assert_eq!(wire["code"], "live_elsewhere", "{wire}");
    assert_eq!(
        wire["params"],
        json!({ "by": "cli", "pid": std::process::id().to_string() }),
        "{wire}"
    );
}

fn names_no_one(error: CollabError) {
    let wire = wire(error);
    assert_eq!(wire["code"], "live_elsewhere", "{wire}");
    assert!(wire.get("params").is_none(), "{wire}");
}

fn answered_at_once(asked: Instant) {
    assert!(
        asked.elapsed() < AT_ONCE,
        "the refusal took {:?}",
        asked.elapsed()
    );
}

#[test]
fn a_live_elsewhere_refusal_carries_its_holder_on_the_wire() {
    let cli = Holder {
        by: HolderKind::Cli,
        pid: 4242,
        since_ms: 1,
    };
    assert_eq!(
        wire(live_elsewhere(Some(cli.clone()))),
        json!({
            "code": "live_elsewhere",
            "message": JournalError::LiveElsewhere(Some(cli)).to_string(),
            "params": { "by": "cli", "pid": "4242" },
        })
    );
    let app = Holder {
        by: HolderKind::App,
        pid: 7,
        since_ms: 1,
    };
    assert_eq!(
        wire(live_elsewhere(Some(app.clone()))),
        json!({
            "code": "live_elsewhere",
            "message": JournalError::LiveElsewhere(Some(app)).to_string(),
            "params": { "by": "app", "pid": "7" },
        })
    );
    assert_eq!(
        wire(live_elsewhere(None)),
        json!({
            "code": "live_elsewhere",
            "message": JournalError::LiveElsewhere(None).to_string(),
        })
    );
}

#[test]
fn other_errors_keep_their_envelope_on_the_wire() {
    let missing = AppError::new("project.linked_missing")
        .param("folder", "/gone")
        .to_string();
    assert_eq!(
        wire(CollabError::Io(missing.clone())),
        json!({ "code": "internal", "message": missing })
    );
}

#[test]
fn overleaf_live_project_answers_at_once_while_another_process_is_live() {
    let library = TempLibrary::new();
    let project = imported_project();
    paused_before(&project);
    let cli = live_as(&data(), &project, HolderKind::Cli);
    let asked = Instant::now();
    let shown = live_project(&project).unwrap().unwrap();
    answered_at_once(asked);
    assert!(
        shown.paused,
        "the paused flag is read while the command line holds the journal"
    );
    drop(cli);
    drop(library);
}

#[test]
fn start_while_the_cli_is_live_is_live_elsewhere_at_once() {
    let library = TempLibrary::new();
    run(async {
        let mock = MockOverleaf::start(MockProject::new("live").doc("main.tex", "Hello\n")).await;
        let project = linked_to(&mock.base, &mock.project_id());
        signed_in_as(&mock.base, &mock.user("alice"));
        let cli = live_as(&data(), &project, HolderKind::Cli);
        let host = Arc::new(Quiet::default());

        let asked = Instant::now();
        let refused = start(
            Arc::clone(&host) as Arc<dyn LiveHost>,
            &collab_paths(),
            &project,
        )
        .await
        .unwrap_err();
        answered_at_once(asked);
        names_the_command_line(refused);
        assert!(mock.connections().is_empty());
        assert!(mock.requests("/").is_empty());
        assert!(live_now(&project).is_none());

        drop(cli);
        start(
            Arc::clone(&host) as Arc<dyn LiveHost>,
            &collab_paths(),
            &project,
        )
        .await
        .unwrap();
        let link = link_of(&project);
        assert_eq!(
            journal::holder(&data(), &link.server, &link.project_id).map(|holder| holder.by),
            Some(HolderKind::App)
        );
        stop(&project).await;
        eventually("the app lets go of the project", || {
            journal::holder(&data(), &link.server, &link.project_id).is_none()
                && !journal::live_in(&root_of(&project))
        })
        .await;
    });
    drop(library);
}

#[test]
fn a_process_with_another_data_folder_is_refused_at_once_without_a_name() {
    let library = TempLibrary::new();
    let elsewhere = tempfile::tempdir().unwrap();
    run(async {
        let mock = MockOverleaf::start(MockProject::new("live").doc("main.tex", "Hello\n")).await;
        let project = linked_to(&mock.base, &mock.project_id());
        signed_in_as(&mock.base, &mock.user("alice"));
        let other = live_as(elsewhere.path(), &project, HolderKind::Cli);
        let host = Arc::new(Quiet::default());

        let asked = Instant::now();
        let refused = start(
            Arc::clone(&host) as Arc<dyn LiveHost>,
            &collab_paths(),
            &project,
        )
        .await
        .unwrap_err();
        answered_at_once(asked);
        names_no_one(refused);
        assert!(mock.connections().is_empty());
        assert!(mock.requests("/").is_empty());
        assert!(live_now(&project).is_none());

        paused_before(&project);
        let asked = Instant::now();
        let refused = resume(&project).await.unwrap_err();
        answered_at_once(asked);
        names_no_one(refused);
        assert!(live_project(&project).unwrap().unwrap().paused);

        drop(other);
        resume(&project).await.unwrap();
        assert!(!live_project(&project).unwrap().unwrap().paused);
    });
    drop(library);
}

#[test]
fn set_paused_refuses_at_once_while_another_process_is_live() {
    let library = TempLibrary::new();
    let project = imported_project();
    paused_before(&project);
    let cli = live_as(&data(), &project, HolderKind::Cli);
    run(async {
        let asked = Instant::now();
        let refused = resume(&project).await.unwrap_err();
        answered_at_once(asked);
        names_the_command_line(refused);
    });
    assert!(live_project(&project).unwrap().unwrap().paused);
    drop(cli);
    run(async { resume(&project).await.unwrap() });
    assert!(!live_project(&project).unwrap().unwrap().paused);
    drop(library);
}

#[test]
fn resuming_waits_for_this_apps_own_journal_to_let_go() {
    let library = TempLibrary::new();
    let project = imported_project();
    paused_before(&project);
    let ours = live_as(&data(), &project, HolderKind::App);
    let dropped = Arc::new(AtomicBool::new(false));
    let letting_go = {
        let dropped = Arc::clone(&dropped);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            drop(ours);
            dropped.store(true, Ordering::SeqCst);
        })
    };
    run(async { resume(&project).await.unwrap() });
    assert!(dropped.load(Ordering::SeqCst));
    letting_go.join().unwrap();
    assert!(!live_project(&project).unwrap().unwrap().paused);
    drop(library);
}

#[test]
fn unlink_refuses_while_another_process_is_live() {
    let library = TempLibrary::new();
    let project = imported_project();
    let link = link_of(&project);
    let root = root_of(&project);
    let journal_dir = journal::journal_dir(&data(), &link.server, &link.project_id).unwrap();
    let cli = live_as(&data(), &project, HolderKind::Cli);
    run(async {
        let asked = Instant::now();
        let refused = unlink(&project).await.unwrap_err();
        answered_at_once(asked);
        names_the_command_line(refused);
    });
    assert!(crate::overleaf::overleaf_link_of(&project)
        .unwrap()
        .is_some());
    let kept = forget_overleaf_project(&link, &project, Some(&root)).unwrap_err();
    assert!(kept.contains(&std::process::id().to_string()), "{kept}");
    assert!(journal_dir.is_dir());
    assert!(journal::live_in(&root));

    drop(cli);
    run(async { unlink(&project).await.unwrap() });
    assert!(crate::overleaf::overleaf_link_of(&project)
        .unwrap()
        .is_none());
    assert!(!journal_dir.exists());
    drop(library);
}

#[test]
fn git_sync_waits_while_another_process_is_live() {
    let library = TempLibrary::new();
    let project = imported_project();
    assert!(!git_sync_waits(&project).unwrap());
    let cli = live_as(&data(), &project, HolderKind::Cli);
    assert!(git_sync_waits(&project).unwrap());
    drop(cli);
    assert!(!git_sync_waits(&project).unwrap());
    drop(library);
}
