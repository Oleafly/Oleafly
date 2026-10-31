use std::sync::Arc;
use std::time::Duration;

use oleafly_collab::live::LiveProject;
use oleafly_collab::sync::LiveStatus;
use oleafly_collab::{load_binding, remove_binding, CollabError, CollabPaths};
use oleafly_collab_protocol::ids::{DeviceId, ServerId};
use oleafly_collab_protocol::projects::ProjectRole;
use serde::Serialize;

use super::super::commands::DetachedProject;
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

fn name_of(project_id: &str) -> Option<String> {
    let meta = crate::project::read_meta(project_id).ok()?;
    Some(if meta.name.trim().is_empty() {
        project_id.to_owned()
    } else {
        meta.name
    })
}

fn named(project_id: String, changes: u64) -> Option<UnsentProject> {
    let name = name_of(&project_id)?;
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
            local_copy::keep_stored_origin(&paths, &id);
            remove_binding(&paths, &id)?;
            super::super::registry::invalidate(&id);
            local_copy::name_local_copy(&id);
        }
        Ok(())
    })
    .await
    .map_err(|error| CollabError::Io(error.to_string()))?
}

pub(crate) async fn detach_projects(
    state: &CollabState,
    server: ServerId,
) -> Result<Vec<DetachedProject>, CollabError> {
    let paths = state.paths()?.clone();
    let bound = {
        let paths = paths.clone();
        tauri::async_runtime::spawn_blocking(move || bound_to(&paths, server))
            .await
            .map_err(|error| CollabError::Io(error.to_string()))?
    };
    for (project_id, _) in &bound {
        stop(project_id).await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut detached = Vec::new();
        for (project_id, _) in bound {
            let name = name_of(&project_id);
            local_copy::keep_stored_origin(&paths, &project_id);
            remove_binding(&paths, &project_id)?;
            super::super::registry::invalidate(&project_id);
            local_copy::name_local_copy(&project_id);
            if let Some(name) = name {
                detached.push(DetachedProject { project_id, name });
            }
        }
        Ok(detached)
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
    use oleafly_server::test_support::{
        test_config, FutureFrames, MockGithub, MockGithubUser, TestServer,
    };

    use super::super::{
        active_for, start, LiveHost, MergedPayload, NewDevicePayload, PresenceLeftPayload,
        PresencePayload, RolePayload, StatusPayload,
    };
    use super::*;
    use crate::collab::commands::{
        remove_within, sign_in_server, sign_out_within, CollabCommandError, CollabHost,
        DetachedProject, SignOutOutcome, UnsentChoice,
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

    #[derive(Default)]
    struct Heard {
        statuses: std::sync::Mutex<Vec<LiveStatus>>,
        others: std::sync::atomic::AtomicUsize,
        unwritten: std::sync::Mutex<Vec<crate::collab::live::unwritten::UnwrittenPayload>>,
    }

    impl Heard {
        fn other(&self) {
            self.others
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
    }

    impl LiveHost for Heard {
        fn status(&self, payload: StatusPayload) {
            self.statuses.lock().unwrap().push(payload.status);
        }
        fn role(&self, _: RolePayload) {}
        fn merged(&self, _: MergedPayload) {
            self.other();
        }
        fn presence(&self, _: PresencePayload) {
            self.other();
        }
        fn presence_left(&self, _: PresenceLeftPayload) {
            self.other();
        }
        fn folder_changed(&self, _: FolderChange) {}
        fn new_device(&self, _: NewDevicePayload) {
            self.other();
        }
        fn unwritten(&self, payload: crate::collab::live::unwritten::UnwrittenPayload) {
            self.unwritten.lock().unwrap().push(payload);
        }
    }

    struct Lab {
        state: CollabState,
        server: ServerId,
        root: PathBuf,
        later: Option<FutureFrames>,
        test_server: TestServer,
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
            Lab::open(reachable, false, Arc::new(Quiet))
        }

        fn open(reachable: bool, through_later_server: bool, host: Arc<dyn LiveHost>) -> Lab {
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
            let (github, test_server, server, later) = tauri::async_runtime::block_on(async {
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
                    &|_, _| {},
                    PROJECT,
                    signed.server_id,
                )
                .await
                .unwrap();
                let later = if through_later_server {
                    let upstream = test_server
                        .url()
                        .trim_start_matches("http://")
                        .parse()
                        .unwrap();
                    Some(FutureFrames::start(upstream).await)
                } else {
                    None
                };
                let route = match (&later, reachable) {
                    (Some(later), _) => Some(later.url()),
                    (None, false) => Some(closed_url()),
                    (None, true) => None,
                };
                if let Some(url) = route {
                    let paths = state.paths().unwrap();
                    let mut binding = load_binding(paths, PROJECT).unwrap().unwrap();
                    binding.server_url = url;
                    save_binding(paths, PROJECT, &binding).unwrap();
                }
                start(&state, host, PROJECT).await.unwrap();
                (github, test_server, signed.server_id, later)
            });
            let lab = Lab {
                state,
                server,
                root,
                later,
                test_server,
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

        fn remove(&self, choice: UnsentChoice) -> SignOutOutcome {
            tauri::async_runtime::block_on(remove_within(
                &self.state,
                &Browser,
                self.server,
                choice,
                Duration::from_secs(2),
            ))
            .unwrap()
        }

        fn start_again(&self, host: Arc<dyn LiveHost>) -> Result<(), String> {
            tauri::async_runtime::block_on(async {
                stop(PROJECT).await;
                start(&self.state, host, PROJECT).await
            })
            .map(|_| ())
            .map_err(|error| CollabCommandError::from(error).code.to_owned())
        }

        fn signed_in(&self) -> bool {
            self.state.has_session(self.server).unwrap()
        }

        fn shared_id(&self) -> oleafly_collab_protocol::ids::SharedProjectId {
            load_binding(self.state.paths().unwrap(), PROJECT)
                .unwrap()
                .expect("the project is shared")
                .shared_project_id
        }

        fn join_again(
            &self,
            shared: oleafly_collab_protocol::ids::SharedProjectId,
        ) -> Option<local_copy::LocalCopyOffer> {
            tauri::async_runtime::block_on(async {
                if !self.signed_in() {
                    sign_in_server(
                        &self.state,
                        &Browser,
                        &self.test_server.url(),
                        "github".to_owned(),
                        None,
                        Duration::from_secs(20),
                    )
                    .await
                    .unwrap();
                }
                let joined = crate::collab::share::join_project(
                    &self.state,
                    &Browser,
                    &|_| {},
                    self.server,
                    shared,
                )
                .await
                .unwrap();
                local_copy::offer(self.state.paths().unwrap(), &joined).unwrap()
            })
        }

        fn switch_comments_elsewhere(&self, server_wide: bool, on: bool) {
            tauri::async_runtime::block_on(async {
                let keys = self.state.keys().await.unwrap();
                let access = keys
                    .sessions
                    .tokens(self.server)
                    .unwrap()
                    .unwrap()
                    .access_token;
                let binding = load_binding(self.state.paths().unwrap(), PROJECT)
                    .unwrap()
                    .unwrap();
                let client = oleafly_collab::ServerClient::new(
                    oleafly_collab::ServerUrl::parse(&binding.server_url).unwrap(),
                )
                .unwrap();
                if server_wide {
                    client
                        .admin_patch_settings(
                            &access,
                            &oleafly_collab_protocol::admin::RuntimeSettingsPatch {
                                comments_allowed: Some(on),
                                ..Default::default()
                            },
                        )
                        .await
                        .unwrap();
                } else {
                    client
                        .patch_project(
                            &access,
                            binding.shared_project_id,
                            &oleafly_collab_protocol::projects::ProjectPatch {
                                comments_enabled: Some(on),
                                ..Default::default()
                            },
                        )
                        .await
                        .unwrap();
                }
            });
        }

        fn write_a_comment(&self) -> Result<(), String> {
            crate::collab::comments::write_comment(&self.state, PROJECT, |live, who| {
                crate::collab::comments::create_at(
                    live,
                    who,
                    "main.tex",
                    0,
                    5,
                    None,
                    "a note",
                    &[],
                    1,
                )
            })
            .map(|_| ())
            .map_err(|error| match error {
                CollabError::Api { code, .. } => code,
                other => other.to_string(),
            })
        }
    }

    impl Drop for Lab {
        fn drop(&mut self) {
            tauri::async_runtime::block_on(stop(PROJECT));
        }
    }

    #[test]
    fn comments_switched_elsewhere_reach_this_app_within_seconds_and_decide_whether_it_may_comment()
    {
        let lab = Lab::new(true);
        let paths = lab.state.paths().unwrap().clone();
        for server_wide in [false, true] {
            for on in [false, true] {
                lab.switch_comments_elsewhere(server_wide, on);
                let switched = std::time::Instant::now();
                let wanted = crate::collab::comments::CommentSwitches {
                    server: on || !server_wide,
                    project: on || server_wide,
                };
                while crate::collab::comments::load_switches(&paths, PROJECT) != wanted {
                    assert!(
                        switched.elapsed() < Duration::from_secs(2),
                        "the app still had {:?} two seconds after comments were turned on: {on} (server wide: {server_wide})",
                        crate::collab::comments::load_switches(&paths, PROJECT)
                    );
                    std::thread::sleep(POLL);
                }
                let refusal = if server_wide {
                    "comments_off_server"
                } else {
                    "comments_off_project"
                };
                assert_eq!(
                    lab.write_a_comment(),
                    if on { Ok(()) } else { Err(refusal.to_owned()) }
                );
            }
        }
    }

    #[test]
    fn frames_of_an_unknown_type_leave_the_app_online_and_tell_it_nothing() {
        let heard = Arc::new(Heard::default());
        let lab = Lab::open(true, true, Arc::clone(&heard) as Arc<dyn LiveHost>);
        lab.type_text("hello\nfrom a later server\n");
        lab.active().handle.flush();
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while lab.waiting() {
            assert!(
                std::time::Instant::now() < deadline,
                "the edit was never acknowledged"
            );
            std::thread::sleep(POLL);
        }
        assert!(lab.later.as_ref().unwrap().injected() >= 2);
        let statuses = heard.statuses.lock().unwrap().clone();
        let online = statuses
            .iter()
            .position(|status| *status == LiveStatus::Online)
            .expect("the app came online");
        assert!(
            statuses[online..]
                .iter()
                .all(|status| *status == LiveStatus::Online),
            "{statuses:?}"
        );
        assert_eq!(heard.others.load(std::sync::atomic::Ordering::SeqCst), 0);
        assert!(!lab.active().handle.is_finished());
    }

    #[test]
    fn signing_out_while_online_sends_waiting_edits_first() {
        let lab = Lab::new(true);
        lab.type_text("hello\nfrom alice\n");
        assert!(lab.waiting());
        let active = lab.active();
        let outcome = lab.sign_out(UnsentChoice::Ask);
        assert_eq!(
            outcome,
            SignOutOutcome {
                signed_out: true,
                unsent: Vec::new(),
                detached: Vec::new(),
            }
        );
        assert!(!lock(&active.live).has_unsent());
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
    fn removing_the_server_turns_its_shared_projects_into_local_copies() {
        let lab = Lab::new(true);
        let outcome = lab.remove(UnsentChoice::Ask);
        assert_eq!(
            outcome,
            SignOutOutcome {
                signed_out: true,
                unsent: Vec::new(),
                detached: vec![DetachedProject {
                    project_id: PROJECT.to_owned(),
                    name: "R3 Paper".to_owned(),
                }],
            }
        );
        let paths = lab.state.paths().unwrap();
        assert!(active_for(PROJECT).is_none());
        assert!(load_binding(paths, PROJECT).unwrap().is_none());
        assert!(crate::collab::share::share_info(&lab.state, PROJECT)
            .unwrap()
            .is_none());
        assert!(lab.state.registry().unwrap().get(lab.server).is_none());
        assert!(paths
            .project_dir(PROJECT)
            .unwrap()
            .join("local-copy.json")
            .is_file());
        assert_eq!(
            crate::project::read_meta(PROJECT).unwrap().name,
            local_copy::local_copy_name_in(crate::i18n::current(), "R3 Paper")
        );
        assert_eq!(
            std::fs::read_to_string(lab.root.join("main.tex")).unwrap(),
            "hello\n"
        );
        assert_eq!(
            lab.start_again(Arc::new(Quiet)),
            Err("not_found".to_owned())
        );
    }

    #[test]
    fn removing_the_server_and_keeping_a_local_copy_lists_the_copy_with_the_others() {
        let lab = Lab::new(false);
        lab.type_text("hello\nwritten offline\n");
        let outcome = lab.remove(UnsentChoice::KeepLocalCopy);
        assert!(outcome.signed_out);
        assert_eq!(outcome.unsent.len(), 1);
        assert_eq!(
            outcome.detached,
            vec![DetachedProject {
                project_id: PROJECT.to_owned(),
                name: "R3 Paper".to_owned(),
            }]
        );
        assert!(load_binding(lab.state.paths().unwrap(), PROJECT)
            .unwrap()
            .is_none());
        assert!(lab.state.registry().unwrap().get(lab.server).is_none());
    }

    #[test]
    fn a_project_that_could_not_be_deleted_goes_live_again() {
        let lab = Lab::new(true);
        let (failed, restarted): (Result<(), String>, bool) = tauri::async_runtime::block_on(
            crate::collab::live::resumed_if_failed(&lab.state, Arc::new(Quiet), PROJECT, async {
                stop(PROJECT).await;
                Err("the recycle bin refused".to_owned())
            }),
        );
        assert!(failed.is_err());
        assert!(restarted);
        assert!(active_for(PROJECT).is_some());
        let (deleted, restarted): (Result<(), String>, bool) = tauri::async_runtime::block_on(
            crate::collab::live::resumed_if_failed(&lab.state, Arc::new(Quiet), PROJECT, async {
                stop(PROJECT).await;
                Ok(())
            }),
        );
        assert!(deleted.is_ok());
        assert!(!restarted);
        assert!(active_for(PROJECT).is_none());
    }

    #[test]
    fn a_failed_delete_never_stops_another_project_that_went_live_meanwhile() {
        let lab = Lab::new(true);
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("other");
        std::fs::create_dir_all(&root).unwrap();
        let other =
            crate::collab::live::write::rig::LiveRig::start("other", &root, &[("main.tex", "x")]);
        let (failed, restarted): (Result<(), String>, bool) = tauri::async_runtime::block_on(
            crate::collab::live::resumed_if_failed(&lab.state, Arc::new(Quiet), PROJECT, async {
                stop(PROJECT).await;
                *guard(&super::super::ACTIVE) = Some(other.active());
                Err("the recycle bin refused".to_owned())
            }),
        );
        assert!(failed.is_err());
        assert!(!restarted);
        assert!(active_for("other").is_some());
        assert!(active_for(PROJECT).is_none());
        *guard(&super::super::ACTIVE) = None;
    }

    #[test]
    fn a_new_session_clears_the_window_list_of_files_it_could_not_write() {
        let heard = Arc::new(Heard::default());
        let _lab = Lab::open(true, false, Arc::clone(&heard) as Arc<dyn LiveHost>);
        assert_eq!(
            heard.unwritten.lock().unwrap().first(),
            Some(&crate::collab::live::unwritten::UnwrittenPayload {
                project_id: PROJECT.to_owned(),
                files: Vec::new(),
            })
        );
    }

    #[test]
    fn opening_a_project_after_signing_out_says_signed_out_and_keeps_it_shared() {
        let lab = Lab::new(true);
        assert!(lab.sign_out(UnsentChoice::Ask).signed_out);
        let heard = Arc::new(Heard::default());
        let started = lab.start_again(Arc::clone(&heard) as Arc<dyn LiveHost>);
        assert_eq!(started, Err("signed_out".to_owned()));
        assert_eq!(
            *heard.statuses.lock().unwrap(),
            vec![LiveStatus::Ended {
                reason: oleafly_collab::sync::EndReason::SignedOut
            }]
        );
        assert!(load_binding(lab.state.paths().unwrap(), PROJECT)
            .unwrap()
            .is_some());
        assert!(active_for(PROJECT).is_none());
    }

    #[test]
    fn keeping_a_local_copy_signs_out_and_leaves_the_unsent_text_on_disk() {
        let lab = Lab::new(false);
        let shared = lab.shared_id();
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
        let offer = lab
            .join_again(shared)
            .expect("the copy kept at sign-out is offered");
        assert_eq!(offer.copy_id, PROJECT);
        assert_eq!(offer.files, vec!["main.tex".to_owned()]);
    }

    #[test]
    fn a_shared_project_deleted_with_unsent_changes_offers_them_back_once_restored() {
        let lab = Lab::new(false);
        let shared = lab.shared_id();
        lab.type_text("hello\nwritten offline\n");
        let paths = lab.state.paths().unwrap().clone();
        tauri::async_runtime::block_on(stop(PROJECT));
        let recycled = lab.root.with_file_name("r3-paper-recycled");
        std::fs::rename(&lab.root, &recycled).unwrap();
        tauri::async_runtime::block_on(crate::collab::share::let_go_keeping_origin(
            PROJECT, &paths,
        ));
        assert!(load_binding(&paths, PROJECT).unwrap().is_none());
        assert!(!paths.document_dir(PROJECT).unwrap().exists());
        std::fs::rename(&recycled, &lab.root).unwrap();
        assert_eq!(
            std::fs::read_to_string(lab.root.join("main.tex")).unwrap(),
            "hello\nwritten offline\n"
        );
        let offer = lab
            .join_again(shared)
            .expect("the restored copy is offered");
        assert_eq!(offer.copy_id, PROJECT);
        assert_eq!(offer.files, vec!["main.tex".to_owned()]);
    }
}
