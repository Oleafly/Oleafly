use std::sync::Arc;
use std::time::Duration;

use oleafly_collab::live::LiveProject;
use oleafly_collab::sync::LiveStatus;
use oleafly_collab::{load_binding, remove_binding, CollabError, CollabPaths};
use oleafly_collab_protocol::ids::{DeviceId, ServerId};
use oleafly_collab_protocol::projects::ProjectRole;
use serde::Serialize;

use super::super::state::CollabState;
use super::{guard, local_copy, lock, stop, Active, ACTIVE};

pub const SIGN_OUT_WAIT: Duration = Duration::from_secs(5);
const POLL: Duration = Duration::from_millis(50);

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct UnsentProject {
    pub project_id: String,
    pub name: String,
    pub changes: u64,
}

fn live_on(server: ServerId) -> Option<Arc<Active>> {
    guard(&ACTIVE)
        .as_ref()
        .filter(|active| active.link.server_id == server)
        .cloned()
}

fn changes_in(live: &LiveProject) -> u64 {
    if live.has_unsent() {
        live.pending_changes().max(1)
    } else {
        0
    }
}

fn still_sending(active: &Active) -> bool {
    let reachable = !matches!(
        *guard(&active.last_status),
        LiveStatus::Offline { .. } | LiveStatus::Ended { .. }
    );
    reachable && lock(&active.live).has_unsent()
}

async fn send_waiting(active: &Active, wait: Duration) {
    let deadline = tokio::time::Instant::now() + wait;
    while still_sending(active) && tokio::time::Instant::now() < deadline {
        active.handle.flush();
        tokio::time::sleep(POLL).await;
    }
}

fn bound_to(paths: &CollabPaths, server: ServerId) -> Vec<(String, ProjectRole)> {
    let Ok(entries) = std::fs::read_dir(paths.root()) else {
        return Vec::new();
    };
    let mut bound: Vec<(String, ProjectRole)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .filter(|id| crate::paths::validate_project_id(id).is_ok())
        .filter_map(|id| {
            let binding = load_binding(paths, &id).ok()??;
            (binding.server_id == server).then_some((id, binding.role))
        })
        .collect();
    bound.sort_by(|left, right| left.0.cmp(&right.0));
    bound
}

fn stored_changes(
    paths: &CollabPaths,
    project_id: &str,
    role: ProjectRole,
    device: Option<DeviceId>,
) -> u64 {
    let Ok(dir) = paths.document_dir(project_id) else {
        return 0;
    };
    if !LiveProject::exists(&dir) {
        return 0;
    }
    let Ok(mut live) = LiveProject::load(&dir, role) else {
        return 0;
    };
    if let Some(device) = device {
        live.set_device(device);
    }
    changes_in(&live)
}

fn named(project_id: String, changes: u64) -> Option<UnsentProject> {
    let meta = crate::project::read_meta(&project_id).ok()?;
    let name = if meta.name.trim().is_empty() {
        project_id.clone()
    } else {
        meta.name
    };
    Some(UnsentProject {
        project_id,
        name,
        changes,
    })
}

pub(crate) async fn unsent_changes(
    state: &CollabState,
    server: ServerId,
    wait: Duration,
) -> Result<Vec<UnsentProject>, CollabError> {
    let active = live_on(server);
    if let Some(active) = &active {
        send_waiting(active, wait).await;
    }
    let paths = state.paths()?.clone();
    let device = state
        .keys()
        .await?
        .sessions
        .tokens(server)?
        .map(|tokens| tokens.device_id);
    let live = active.map(|active| {
        let changes = changes_in(&lock(&active.live));
        (active.project_id.clone(), changes)
    });
    tauri::async_runtime::spawn_blocking(move || {
        bound_to(&paths, server)
            .into_iter()
            .filter_map(|(project_id, role)| {
                let changes = match &live {
                    Some((id, changes)) if *id == project_id => *changes,
                    _ => stored_changes(&paths, &project_id, role, device),
                };
                (changes > 0).then(|| named(project_id, changes)).flatten()
            })
            .collect()
    })
    .await
    .map_err(|error| CollabError::Io(error.to_string()))
}

pub(crate) async fn keep_local_copies(
    state: &CollabState,
    projects: &[UnsentProject],
) -> Result<(), CollabError> {
    let paths = state.paths()?.clone();
    for project in projects {
        stop(&project.project_id).await;
    }
    let ids: Vec<String> = projects
        .iter()
        .map(|project| project.project_id.clone())
        .collect();
    tauri::async_runtime::spawn_blocking(move || {
        for id in ids {
            remove_binding(&paths, &id)?;
            super::super::registry::invalidate(&id);
            local_copy::name_local_copy(&id);
        }
        Ok(())
    })
    .await
    .map_err(|error| CollabError::Io(error.to_string()))?
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::MutexGuard;

    use oleafly_collab::doc::NodeKind;
    use oleafly_collab::{materialize, save_binding, MemorySecrets};
    use oleafly_server::config::ProviderConfig;
    use oleafly_server::test_support::{test_config, MockGithub, MockGithubUser, TestServer};

    use super::super::{
        active_for, start, LiveHost, MergedPayload, NewDevicePayload, PresenceLeftPayload,
        PresencePayload, RolePayload, StatusPayload,
    };
    use super::*;
    use crate::collab::commands::{
        sign_in_server, sign_out_within, CollabHost, SignOutOutcome, UnsentChoice,
    };
    use crate::collab::testing::TempLibrary;
    use crate::folder_watch::FolderChange;

    const PROJECT: &str = "r3-paper";

    struct Browser;

    impl CollabHost for Browser {
        fn open_browser(&self, url: &str) -> Result<(), CollabError> {
            let url = url.to_owned();
            tauri::async_runtime::spawn(async move {
                if let Ok(client) = reqwest::Client::builder().no_proxy().build() {
                    let _ = client.get(url).send().await;
                }
            });
            Ok(())
        }

        fn server_changed(&self, _: ServerId) {}

        fn signed_in(&self) {}

        fn device_name(&self) -> String {
            "Test Mac".to_owned()
        }

        fn platform(&self) -> String {
            "macos".to_owned()
        }
    }

    struct Quiet;

    impl LiveHost for Quiet {
        fn status(&self, _: StatusPayload) {}
        fn role(&self, _: RolePayload) {}
        fn merged(&self, _: MergedPayload) {}
        fn presence(&self, _: PresencePayload) {}
        fn presence_left(&self, _: PresenceLeftPayload) {}
        fn folder_changed(&self, _: FolderChange) {}
        fn new_device(&self, _: NewDevicePayload) {}
    }

    struct Lab {
        state: CollabState,
        server: ServerId,
        root: PathBuf,
        _test_server: TestServer,
        _github: MockGithub,
        _dir: tempfile::TempDir,
        _turn: MutexGuard<'static, ()>,
        _library: TempLibrary,
    }

    fn closed_url() -> String {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        format!("http://127.0.0.1:{port}")
    }

    impl Lab {
        fn new(reachable: bool) -> Lab {
            let library = TempLibrary::new();
            let turn = crate::collab::live::write::rig::live_turn();
            let root = library.project(PROJECT, &[("main.tex", "hello\n")]);
            let mut meta = crate::project::read_meta(PROJECT).unwrap();
            meta.name = "R3 Paper".to_owned();
            crate::project::write_meta(PROJECT, &meta).unwrap();
            let dir = tempfile::tempdir().unwrap();
            let state = CollabState::new(
                CollabPaths::new(dir.path().join("collab")),
                Arc::new(MemorySecrets::default()),
            );
            let (github, test_server, server) = tauri::async_runtime::block_on(async {
                let github = MockGithub::start(vec![MockGithubUser {
                    id: 1,
                    login: "alice".to_owned(),
                    name: "Alice".to_owned(),
                    emails: vec![("alice@uni.edu".to_owned(), true)],
                }])
                .await;
                let mut config = test_config();
                config.providers.push(ProviderConfig::Github {
                    id: "github".to_owned(),
                    label: "GitHub".to_owned(),
                    client_id: "oleafly-test".to_owned(),
                    client_secret: "oleafly-test-secret".to_owned(),
                    web_url: github.web_url(),
                    api_url: github.api_url(),
                });
                let test_server = TestServer::start(config).await;
                let signed = sign_in_server(
                    &state,
                    &Browser,
                    &test_server.url(),
                    "github".to_owned(),
                    Some(test_server.setup_code()),
                    Duration::from_secs(20),
                )
                .await
                .unwrap();
                crate::collab::share::share_project(
                    &state,
                    &Browser,
                    None,
                    PROJECT,
                    signed.server_id,
                )
                .await
                .unwrap();
                if !reachable {
                    let paths = state.paths().unwrap();
                    let mut binding = load_binding(paths, PROJECT).unwrap().unwrap();
                    binding.server_url = closed_url();
                    save_binding(paths, PROJECT, &binding).unwrap();
                }
                start(&state, Arc::new(Quiet), PROJECT).await.unwrap();
                (github, test_server, signed.server_id)
            });
            let lab = Lab {
                state,
                server,
                root,
                _test_server: test_server,
                _github: github,
                _dir: dir,
                _turn: turn,
                _library: library,
            };
            lab.until(|status| {
                if reachable {
                    matches!(status, LiveStatus::Online)
                } else {
                    matches!(status, LiveStatus::Offline { .. })
                }
            });
            lab
        }

        fn active(&self) -> Arc<Active> {
            active_for(PROJECT).expect("the project is live")
        }

        fn until(&self, reached: impl Fn(&LiveStatus) -> bool) {
            let deadline = std::time::Instant::now() + Duration::from_secs(20);
            while !reached(&guard(&self.active().last_status)) {
                assert!(
                    std::time::Instant::now() < deadline,
                    "live sync never reached the expected state"
                );
                std::thread::sleep(POLL);
            }
        }

        fn type_text(&self, text: &str) {
            let active = self.active();
            let mut live = lock(&active.live);
            let main = materialize::layout(&live.doc().nodes().unwrap())
                .into_iter()
                .find(|(_, placed)| placed.path == "main.tex" && placed.kind == NodeKind::Text)
                .map(|(id, _)| id)
                .unwrap();
            live.local_text(&main, text).unwrap();
        }

        fn waiting(&self) -> bool {
            lock(&self.active().live).has_unsent()
        }

        fn sign_out(&self, choice: UnsentChoice) -> SignOutOutcome {
            tauri::async_runtime::block_on(sign_out_within(
                &self.state,
                &Browser,
                self.server,
                choice,
                Duration::from_secs(2),
            ))
            .unwrap()
        }

        fn signed_in(&self) -> bool {
            self.state.has_session(self.server).unwrap()
        }
    }

    impl Drop for Lab {
        fn drop(&mut self) {
            tauri::async_runtime::block_on(stop(PROJECT));
        }
    }

    #[test]
    fn signing_out_while_online_sends_waiting_edits_first() {
        let lab = Lab::new(true);
        lab.type_text("hello\nfrom alice\n");
        assert!(lab.waiting());
        let outcome = lab.sign_out(UnsentChoice::Ask);
        assert_eq!(
            outcome,
            SignOutOutcome {
                signed_out: true,
                unsent: Vec::new(),
            }
        );
        assert!(!lab.waiting());
        assert!(!lab.signed_in());
    }

    #[test]
    fn signing_out_offline_with_waiting_edits_asks_and_stays_signed_in() {
        let lab = Lab::new(false);
        lab.type_text("hello\nwritten offline\n");
        let outcome = lab.sign_out(UnsentChoice::Ask);
        assert!(!outcome.signed_out);
        assert_eq!(outcome.unsent.len(), 1);
        assert_eq!(outcome.unsent[0].project_id, PROJECT);
        assert_eq!(outcome.unsent[0].name, "R3 Paper");
        assert!(outcome.unsent[0].changes > 0);
        assert!(lab.signed_in());
        assert!(lab.waiting());
        assert!(load_binding(lab.state.paths().unwrap(), PROJECT)
            .unwrap()
            .is_some());
    }

    #[test]
    fn keeping_a_local_copy_signs_out_and_leaves_the_unsent_text_on_disk() {
        let lab = Lab::new(false);
        lab.type_text("hello\nwritten offline\n");
        let outcome = lab.sign_out(UnsentChoice::KeepLocalCopy);
        assert!(outcome.signed_out);
        assert_eq!(
            outcome
                .unsent
                .iter()
                .map(|project| project.project_id.as_str())
                .collect::<Vec<_>>(),
            vec![PROJECT]
        );
        assert!(!lab.signed_in());
        assert!(active_for(PROJECT).is_none());
        assert!(load_binding(lab.state.paths().unwrap(), PROJECT)
            .unwrap()
            .is_none());
        assert_eq!(
            std::fs::read_to_string(lab.root.join("main.tex")).unwrap(),
            "hello\nwritten offline\n"
        );
        assert_eq!(
            crate::project::read_meta(PROJECT).unwrap().name,
            local_copy::local_copy_name_in(crate::i18n::current(), "R3 Paper")
        );
    }
}
