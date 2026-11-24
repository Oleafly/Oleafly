use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use oleafly_core::app_log::{AppLog, APP_LOG_FILE};
use oleafly_core::front_matter::NOTE_FILE;
use oleafly_online::client::Http;
use oleafly_online::live::journal::{Journal, ProjectManifest};
use oleafly_online::live::session::{LiveEnd, LivePort, LiveState, SessionConfig};
use oleafly_online::projects::OverleafLink;
use oleafly_online::realtime::Carrier;
use oleafly_online::session::{Session, SessionHandle};
use oleafly_online::test_support::mock_overleaf::{MockOverleaf, MockProject, MockUser, Privilege};
use tokio::runtime::Handle;

use super::notices::{OverleafNotice, OverleafNoticePayload};
use super::{
    binaries, folder_key, mirror_dir, opening, write_import_bases, Mirror, MirrorHooks, MirrorPort,
    OverleafLive, Parts,
};
use crate::disk::DiskState;
use crate::live::disk_pass::{pause_at, writer_paused, RECORD_LATE};
use crate::live::host::DiskHost;
use crate::live::payloads::{RemoteEditPayload, RolePayload, WrittenPayload};
use crate::live::session::{guard, LiveDisk};
use crate::test_support::{eventually, tuning};

const MAIN: &str = "main.tex";
const INTRO: &str = "intro.tex";

#[derive(Default)]
struct Heard {
    roles: Mutex<Vec<RolePayload>>,
    notices: Mutex<Vec<OverleafNoticePayload>>,
    edits: Mutex<Vec<RemoteEditPayload>>,
    notes: Mutex<Vec<(String, String)>>,
    holding: AtomicBool,
    held: AtomicBool,
}

impl DiskHost for Heard {
    fn role(&self, payload: RolePayload) {
        guard(&self.roles).push(payload);
    }

    fn overleaf_notice(&self, payload: OverleafNoticePayload) {
        guard(&self.notices).push(payload);
    }

    fn remote_edit(&self, payload: RemoteEditPayload) {
        guard(&self.edits).push(payload);
    }

    fn note_written(&self, project_id: &str, text: &str) {
        guard(&self.notes).push((project_id.to_owned(), text.to_owned()));
    }

    fn written(&self, _payload: WrittenPayload) {
        if !self.holding.load(Ordering::SeqCst) {
            return;
        }
        self.held.store(true, Ordering::SeqCst);
        let started = Instant::now();
        while self.holding.load(Ordering::SeqCst) && started.elapsed() < Duration::from_secs(10) {
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

#[derive(Default)]
struct Counting {
    roles: AtomicUsize,
    roles_seen_at_attach: AtomicUsize,
}

impl MirrorHooks for Counting {
    fn role_known(&self) {
        self.roles.fetch_add(1, Ordering::SeqCst);
    }
}

struct Rig {
    mock: MockOverleaf,
    live: Arc<OverleafLive>,
    host: Arc<Heard>,
    root: PathBuf,
    mirror_dir: PathBuf,
    _dir: tempfile::TempDir,
}

fn project() -> MockProject {
    MockProject::new("live")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .doc(MAIN, "Hello\n")
        .doc(INTRO, "Intro\n")
}

fn write_files(root: &Path, files: &[(&str, &str)]) {
    std::fs::create_dir_all(root).unwrap();
    for (path, text) in files {
        std::fs::write(root.join(path), text).unwrap();
    }
}

async fn start<H: MirrorHooks>(
    files: &[(&str, &str)],
    fill: bool,
    attach: impl FnOnce(&Arc<Mirror>, &Arc<Heard>) -> Arc<H> + Send,
) -> (Rig, Arc<H>) {
    start_in(project(), files, fill, attach).await
}

async fn start_in<H: MirrorHooks>(
    project: MockProject,
    files: &[(&str, &str)],
    fill: bool,
    attach: impl FnOnce(&Arc<Mirror>, &Arc<Heard>) -> Arc<H> + Send,
) -> (Rig, Arc<H>) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("project");
    let data = dir.path().join("data");
    let mirror_dir = dir.path().join("mirror");
    write_files(&root, files);
    let bases = files
        .iter()
        .map(|(path, text)| ((*path).to_owned(), (*text).to_owned()))
        .collect();
    write_import_bases(&mirror_dir, &bases).unwrap();
    let mock = MockOverleaf::start(project).await;
    if fill {
        opening::mark(&mirror_dir).unwrap();
    }
    let user = mock.user("alice");
    let session = SessionHandle::new(
        &mock.base,
        Session {
            cookie: user.cookie(),
            user_id: user.id.clone(),
            email: user.email.clone(),
            saved_by: None,
        },
        None,
    );
    let mut journal = Journal::open(&data, &mock.base, &mock.project_id(), None).unwrap();
    journal.set_manifest(ProjectManifest {
        user_id: user.id.clone(),
        history_version: (!fill).then_some(0),
        ..ProjectManifest::default()
    });
    journal.flush().unwrap();
    let host = Arc::new(Heard::default());
    let parts = Parts {
        project_id: "live-rig".to_owned(),
        root: root.clone(),
        mirror_dir: mirror_dir.clone(),
        host: Arc::clone(&host) as Arc<dyn DiskHost>,
        link: OverleafLink {
            server: mock.base.clone(),
            project_id: mock.project_id(),
            user_id: None,
        },
        config: SessionConfig {
            http: Http::new(&mock.base, "Oleafly/test").unwrap(),
            session,
            project_id: mock.project_id(),
            carriers: vec![Carrier::WebSocket, Carrier::XhrPolling],
            tuning: tuning(),
            seeds: Vec::new(),
            fill,
        },
        journal,
        git: None,
        runtime: Handle::current(),
        log: AppLog::at(&data),
    };
    let heard = Arc::clone(&host);
    let (live, hooks) = OverleafLive::start_with(parts, move |mirror| attach(mirror, &heard))
        .await
        .unwrap();
    let rig = Rig {
        mock,
        live,
        host,
        root,
        mirror_dir,
        _dir: dir,
    };
    (rig, hooks)
}

impl Rig {
    fn read(&self, path: &str) -> String {
        std::fs::read_to_string(self.root.join(path)).unwrap_or_default()
    }

    fn bob_types(&self, path: &str, text: &str) {
        let doc = self.mock.doc_id(path);
        let mut bob = self.mock.peer("bob");
        bob.join(&doc);
        bob.type_at(&doc, 0, text);
    }
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap()
}

#[test]
fn a_mirror_with_unit_hooks_writes_remote_texts_and_sends_disk_edits() {
    runtime().block_on(async {
        let files = [(MAIN, "Hello\n"), (INTRO, "Intro\n")];
        let (rig, _hooks) = start(&files, false, |_, _| Arc::new(())).await;
        rig.bob_types(INTRO, "An ");
        eventually("the coauthor's edit reaches disk", || {
            rig.read(INTRO) == "An Intro\n"
        })
        .await;
        std::fs::write(rig.root.join(MAIN), "Hello there\n").unwrap();
        rig.live
            .import_paths(Some(vec![MAIN.to_owned()]))
            .await
            .unwrap();
        let main = rig.mock.doc_id(MAIN);
        eventually("the disk edit reaches the server", || {
            rig.mock.doc_text(&main) == "Hello there\n"
        })
        .await;
        rig.live.finish().await;
    });
}

#[test]
fn hooks_attached_before_start_hear_the_first_role() {
    runtime().block_on(async {
        let files = [(MAIN, "Hello\n"), (INTRO, "Intro\n")];
        let (rig, hooks) = start(&files, false, |_, host| {
            let hooks = Counting::default();
            hooks
                .roles_seen_at_attach
                .store(guard(&host.roles).len(), Ordering::SeqCst);
            Arc::new(hooks)
        })
        .await;
        assert_eq!(hooks.roles_seen_at_attach.load(Ordering::SeqCst), 0);
        eventually("the role reaches the hooks", || {
            !guard(&rig.host.roles).is_empty() && hooks.roles.load(Ordering::SeqCst) > 0
        })
        .await;
        rig.live.finish().await;
    });
}

#[test]
fn a_mirror_whose_hooks_are_gone_keeps_mirroring() {
    runtime().block_on(async {
        let files = [(MAIN, "Hello\n"), (INTRO, "Intro\n")];
        let (rig, hooks) = start(&files, false, |_, _| Arc::new(Counting::default())).await;
        drop(hooks);
        assert!(rig.live.mirror.hooks().is_none());
        rig.bob_types(INTRO, "Still ");
        eventually("the coauthor's edit reaches disk", || {
            rig.read(INTRO) == "Still Intro\n"
        })
        .await;
        rig.live.finish().await;
    });
}

#[test]
fn remote_edits_reach_the_host_with_their_author() {
    runtime().block_on(async {
        let files = [(MAIN, "Hello\n"), (INTRO, "Intro\n")];
        let (rig, _hooks) = start(&files, false, |_, _| Arc::new(())).await;
        rig.bob_types(INTRO, "By Bob ");
        let bob = rig.mock.user("bob").id;
        eventually("the edit is told with its author", || {
            guard(&rig.host.edits).iter().any(|edit| {
                edit.project_id == "live-rig"
                    && edit.path == INTRO
                    && edit.user_id.as_deref() == Some(bob.as_str())
            })
        })
        .await;
        rig.live.finish().await;
    });
}

#[test]
fn the_opening_marker_clears_once_the_live_exists_without_a_slot() {
    runtime().block_on(async {
        let (rig, _hooks) = start(&[], true, |_, _| Arc::new(())).await;
        assert!(opening::marked(&rig.mirror_dir));
        eventually("the files arrive", || {
            rig.read(MAIN) == "Hello\n" && rig.read(INTRO) == "Intro\n"
        })
        .await;
        eventually("the open finishes", || {
            guard(&rig.host.notices)
                .iter()
                .any(|told| told.notice == OverleafNotice::Filled)
        })
        .await;
        assert!(!opening::marked(&rig.mirror_dir));
        rig.live.finish().await;
    });
}

#[test]
fn a_note_a_coauthor_writes_reaches_the_host_under_the_project_id() {
    runtime().block_on(async {
        let note = "---\nkind: note\n---\nPlain\n";
        let files = [(MAIN, "Hello\n"), (INTRO, "Intro\n"), (NOTE_FILE, note)];
        let (rig, _hooks) = start_in(project().doc(NOTE_FILE, note), &files, false, |_, _| {
            Arc::new(())
        })
        .await;
        rig.bob_types(NOTE_FILE, "Bob ");
        let wanted = format!("Bob {note}");
        eventually("the note write reaches the host", || {
            guard(&rig.host.notes)
                .iter()
                .any(|(project_id, text)| project_id == "live-rig" && *text == wanted)
        })
        .await;
        assert_ne!(rig.root.file_name().unwrap(), "live-rig");
        rig.live.finish().await;
    });
}

#[test]
fn quit_finishes_within_its_limit_while_saving_hangs() {
    runtime().block_on(async {
        let files = [(MAIN, "Hello\n"), (INTRO, "Intro\n")];
        let (rig, _hooks) = start(&files, false, |_, _| Arc::new(())).await;
        let disk = &rig.live.mirror.disk;
        eventually("the mirror knows the file", || {
            guard(&disk.disk).hashes.contains_key(MAIN)
        })
        .await;
        guard(&disk.upkeep.unannounced).insert(MAIN.to_owned());
        rig.host.holding.store(true, Ordering::SeqCst);
        let limit = Duration::from_secs(2);
        let started = Instant::now();
        rig.live.quit(limit).await;
        let took = started.elapsed();
        eventually("saving starts", || rig.host.held.load(Ordering::SeqCst)).await;
        rig.host.holding.store(false, Ordering::SeqCst);
        assert!(
            took < limit + Duration::from_millis(500),
            "quit took {took:?}"
        );
    });
}

fn logged(dir: &Path) -> String {
    std::fs::read_to_string(dir.join(APP_LOG_FILE)).unwrap_or_default()
}

#[test]
fn a_failed_session_is_logged_off_the_callback() {
    runtime().block_on(async {
        let dir = tempfile::tempdir().unwrap();
        let (writer, _signals) = tokio::sync::mpsc::unbounded_channel();
        let disk = LiveDisk::assembled(
            "failing",
            dir.path().join("project"),
            dir.path().join("materializer-index.json"),
            DiskState::default(),
            Default::default(),
            Arc::new(Heard::default()),
            writer,
        );
        let mirror = Arc::new(Mirror::new(
            disk,
            binaries::BlobMap::default(),
            BTreeSet::new(),
        ));
        let port = MirrorPort::new(Arc::clone(&mirror));
        let (release, released) = std::sync::mpsc::channel::<()>();
        mirror.post(move || {
            let _ = released.recv_timeout(Duration::from_secs(10));
        });
        port.state(LiveState::Ended(LiveEnd::Failed(
            "the server went away".to_owned(),
        )));
        port.journal_failed(Some("the disk is full".to_owned()));
        let early = logged(dir.path());
        assert!(
            !early.contains("the server went away"),
            "the failed session was logged inside the callback"
        );
        assert!(
            !early.contains("the disk is full"),
            "the journal failure was logged inside the callback"
        );
        drop(release);
        eventually("both failures are logged", || {
            let log = logged(dir.path());
            log.contains("the session ended with an error: the server went away")
                && log
                    .contains("could not save unsent changes of project failing: the disk is full")
        })
        .await;
        mirror.chores.close(Duration::from_secs(5)).await;
    });
}

#[test]
fn a_folder_key_names_the_folder_however_its_path_is_spelled() {
    let dir = tempfile::tempdir().unwrap();
    let paper = dir.path().join("paper");
    let other = dir.path().join("other");
    std::fs::create_dir_all(paper.join("figures")).unwrap();
    std::fs::create_dir_all(&other).unwrap();
    let key = folder_key(&paper).unwrap();
    assert!(key.starts_with("folder-") && key.len() == "folder-".len() + 16);
    assert_eq!(folder_key(&paper.join("figures").join("..")).unwrap(), key);
    assert_ne!(folder_key(&other).unwrap(), key);
    assert!(folder_key(&dir.path().join("missing")).is_err());
}

#[test]
fn the_mirrored_text_is_the_file_while_the_writer_has_not_recorded_it() {
    runtime().block_on(async {
        let files = [(MAIN, "Hello\n"), (INTRO, "Intro\n")];
        let (rig, _hooks) = start(&files, false, |_, _| Arc::new(())).await;
        pause_at(&RECORD_LATE, &rig.root, Some(Duration::from_secs(10)));
        rig.bob_types(INTRO, "Bob ");
        eventually("the edit is in the file", || {
            rig.read(INTRO) == "Bob Intro\n"
        })
        .await;
        eventually("the writer has not recorded it yet", || {
            writer_paused(&rig.root)
        })
        .await;
        let mirrored = rig.live.mirror.mirrored_text(INTRO);
        pause_at(&RECORD_LATE, &rig.root, None);
        assert_eq!(mirrored.as_deref(), Some("Bob Intro\n"));
        eventually("the writer records it", || {
            guard(&rig.live.mirror.disk.bases)
                .latest_settled(INTRO)
                .map(String::as_str)
                == Some("Bob Intro\n")
        })
        .await;
        rig.live.finish().await;
    });
}

#[test]
fn a_mirror_folder_is_refused_for_ids_that_would_leave_it() {
    let data = Path::new("data");
    let link = |remote: &str| OverleafLink {
        server: "https://www.overleaf.com".to_owned(),
        project_id: remote.to_owned(),
        user_id: None,
    };
    let remote = "6af963ebc9037022065bb53f";
    assert_eq!(
        mirror_dir(data, &link(remote), "local").unwrap(),
        data.join("overleaf-mirror")
            .join("https_www.overleaf.com")
            .join(remote)
            .join("local")
    );
    for refused in ["../../projects", "..", "a/b", ""] {
        assert!(
            mirror_dir(data, &link(refused), "local").is_err(),
            "{refused}"
        );
    }
    for refused in ["..", ".", "a/b", ""] {
        assert!(
            mirror_dir(data, &link(remote), refused).is_err(),
            "{refused}"
        );
    }
}
