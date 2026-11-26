#[path = "support/exits.rs"]
mod exits;
#[cfg(unix)]
#[path = "support/hangup.rs"]
mod hangup;
#[path = "support/live_cli.rs"]
mod live_cli;
#[path = "support/running.rs"]
mod running;

use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{Duration, Instant};

use live_cli::{ready, rest_of, wait_for, WAIT};
#[cfg(unix)]
use live_cli::{send, terminate};
use oleafly_online::live::journal::{Holder, HolderKind, Journal, JournalError};
use oleafly_online::projects::OverleafLink;
use oleafly_online::service::SERVICE_ID;
use oleafly_online::session::{self, Session};
use oleafly_online::test_support::mock_overleaf::{MockOverleaf, MockProject, MockUser, Privilege};
use oleafly_secrets::SecretStore;
use running::Running;
use serde_json::{json, Value};

const MAIN: &str = "main.tex";
const INTRO: &str = "intro.tex";
const FIGURE: &str = "figure.png";
const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3];

fn project() -> MockProject {
    MockProject::new("Thesis")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .doc(MAIN, "Hello\n")
        .doc(INTRO, "Intro\n")
}

struct World {
    mock: MockOverleaf,
    _dir: tempfile::TempDir,
    data: PathBuf,
    root: PathBuf,
}

impl World {
    async fn start(project: MockProject, folder: &str) -> World {
        let mock = MockOverleaf::start(project).await;
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let root = dir.path().join(folder);
        std::fs::create_dir_all(&data).unwrap();
        std::fs::create_dir_all(&root).unwrap();
        let root = dunce::canonicalize(&root).unwrap();
        let world = World {
            mock,
            _dir: dir,
            data,
            root,
        };
        world.save(&world.mock.user("alice"));
        world
    }

    async fn imported(project: MockProject, files: &[(&str, &str)]) -> World {
        let world = World::unbased(project, files).await;
        oleafly_live::overleaf::record_import_bases(&world.mirror_dir(), &world.root).unwrap();
        world
    }

    async fn unbased(project: MockProject, files: &[(&str, &str)]) -> World {
        let world = World::start(project, "paper").await;
        world.import_into(&world.root, files);
        world
    }

    fn mirror_dir(&self) -> PathBuf {
        let link = OverleafLink {
            server: self.mock.base.clone(),
            project_id: self.mock.project_id(),
            user_id: None,
        };
        let key = oleafly_live::overleaf::folder_key(&self.root).unwrap();
        oleafly_live::overleaf::mirror_dir(&self.data, &link, &key).unwrap()
    }

    fn import_into(&self, root: &Path, files: &[(&str, &str)]) {
        for (path, text) in files {
            let target = root.join(path);
            std::fs::create_dir_all(target.parent().unwrap()).unwrap();
            std::fs::write(target, text).unwrap();
        }
        let alice = self.mock.user("alice");
        let record = json!({
            "name": "Thesis",
            "mainDoc": MAIN,
            "importedFrom": {
                "service": SERVICE_ID,
                "server": self.mock.base,
                "projectId": self.mock.project_id(),
                "userId": alice.id,
                "email": alice.email,
            },
        });
        std::fs::write(root.join("project.json"), record.to_string()).unwrap();
    }

    fn save(&self, user: &MockUser) {
        session::save(
            &SecretStore::at(&self.data),
            &self.mock.base,
            &Session {
                cookie: user.cookie(),
                user_id: user.id.clone(),
                email: user.email.clone(),
                saved_by: Some("cli".into()),
            },
        )
        .unwrap();
    }

    fn command_in(&self, folder: &Path, args: &[&str]) -> Command {
        live_cli::command(&self.data, folder, args)
    }

    fn command(&self, args: &[&str]) -> Command {
        self.command_in(&self.root, args)
    }

    fn live(&self, extra: &[&str]) -> Running {
        live_cli::live(&self.data, &self.root, extra)
    }

    fn read(&self, path: &str) -> String {
        std::fs::read_to_string(self.root.join(path)).unwrap_or_default()
    }

    fn app_journal(&self) -> Result<Journal, JournalError> {
        Journal::open_live(
            &self.data,
            &self.mock.base,
            &self.mock.project_id(),
            &self.root,
            HolderKind::App,
        )
    }

    fn alice_connection(&self) -> Option<String> {
        let alice = self.mock.user("alice").id;
        self.mock
            .connections()
            .into_iter()
            .find(|connection| connection.user_id.as_deref() == Some(alice.as_str()))
            .map(|connection| connection.public_id)
    }

    fn sign_out_alice(&self) -> MockUser {
        let renewed = self.mock.expire_session("alice");
        let connection = self.alice_connection().expect("alice is connected");
        self.mock.drop_client(&connection);
        renewed
    }
}

fn event(live: &Running, name: &str) -> Value {
    wait_for(live, name, |value| value["event"] == name)
}

fn state(live: &Running, name: &str) -> Value {
    wait_for(live, name, |value| {
        value["event"] == "state" && value["state"] == name
    })
}

fn eventually(what: &str, mut check: impl FnMut() -> bool) {
    let deadline = Instant::now() + WAIT;
    while !check() {
        assert!(Instant::now() < deadline, "{what} within {WAIT:?}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn result_of(output: &Output) -> Value {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let last = stdout
        .lines()
        .last()
        .unwrap_or_else(|| panic!("no output: {stdout}"));
    serde_json::from_str(last).unwrap_or_else(|_| panic!("not a JSON line: {last}"))
}

async fn output_of(command: Command) -> Output {
    tokio::process::Command::from(command)
        .output()
        .await
        .unwrap()
}

async fn refused_at_once(world: &World, args: &[&str]) -> Value {
    let started = Instant::now();
    let output = output_of(world.command(args)).await;
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "{args:?} took {:?}",
        started.elapsed()
    );
    let result = result_of(&output);
    assert_eq!(output.status.code(), Some(8), "{args:?}: {result}");
    assert_eq!(result["error"]["code"], "remote.live_elsewhere", "{result}");
    result
}

fn alice_updates(world: &World) -> usize {
    let alice = world.mock.user("alice").id;
    let mine: Vec<String> = world
        .mock
        .connections()
        .into_iter()
        .filter(|connection| connection.user_id.as_deref() == Some(alice.as_str()))
        .map(|connection| connection.public_id)
        .collect();
    world
        .mock
        .received("applyOtUpdate")
        .iter()
        .filter(|received| mine.contains(&received.public_id))
        .count()
}

#[cfg(unix)]
fn stopping_with_an_edit_unacked(world: &World, live: &Running, signal: i32) {
    world.mock.hold_updates();
    std::fs::write(world.root.join(MAIN), "Hello again\n").unwrap();
    eventually("the edit is sent and held", || alice_updates(world) >= 1);
    send(live, signal);
    std::thread::sleep(Duration::from_millis(1));
    send(live, signal);
    std::thread::sleep(Duration::from_millis(300));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_and_app_live_exclude_each_other() {
    let world = World::imported(project(), &[(MAIN, "Hello\n"), (INTRO, "Intro\n")]).await;
    let app = world.app_journal().unwrap();
    let result = refused_at_once(&world, &["remote", "live"]).await;
    assert_eq!(result["error"]["details"]["holder"]["by"], "app");
    assert!(
        result["error"]["message"]
            .as_str()
            .unwrap()
            .contains("Oleafly app"),
        "{result}"
    );
    assert!(world.mock.connections().is_empty());
    drop(app);
    let mut live = world.live(&[]);
    ready(&live);
    match world.app_journal() {
        Err(JournalError::LiveElsewhere(Some(Holder {
            by: HolderKind::Cli,
            pid,
            ..
        }))) => assert_eq!(pid, live.process.id()),
        other => panic!("the app opened the journal while the CLI was live: {other:?}"),
    }
    live.process.kill().unwrap();
    live.process.wait().unwrap();
    eventually("the app can go live once the CLI was killed", || {
        world.app_journal().is_ok()
    });
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_prints_a_coauthors_edit_with_their_name() {
    let world = World::imported(project(), &[(MAIN, "Hello\n"), (INTRO, "Intro\n")]).await;
    let live = world.live(&[]);
    let started = ready(&live);
    assert_eq!(started["remoteId"], world.mock.project_id().as_str());
    let doc = world.mock.doc_id(MAIN);
    let mut bob = world.mock.peer("bob");
    bob.join(&doc);
    bob.type_at(&doc, 5, " world");
    let edit = event(&live, "remote_edit");
    assert_eq!(edit["path"], MAIN);
    assert_eq!(edit["by"], "Bob Tester");
    assert_eq!(edit["userId"], world.mock.user("bob").id.as_str());
    eventually("Bob's edit reaches the folder", || {
        world.read(MAIN) == "Hello world\n"
    });
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_sends_a_disk_edit_as_an_op_and_keeps_crlf() {
    let world = World::imported(project(), &[(MAIN, "Hello\r\n"), (INTRO, "Intro\n")]).await;
    let live = world.live(&[]);
    ready(&live);
    let doc = world.mock.doc_id(MAIN);
    std::fs::write(world.root.join(MAIN), "Hello there\r\n").unwrap();
    eventually("the edit reaches the server", || {
        world.mock.doc_text(&doc) == "Hello there\n"
    });
    assert!(alice_updates(&world) >= 1);
    assert_eq!(world.read(MAIN), "Hello there\r\n");
    let mut bob = world.mock.peer("bob");
    bob.join(&doc);
    bob.type_at(&doc, 11, "!");
    eventually("Bob's edit keeps the folder's line endings", || {
        world.read(MAIN) == "Hello there!\r\n"
    });
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_writes_remote_files_and_binaries() {
    let project = project().file(FIGURE, PNG);
    let world = World::imported(project, &[(MAIN, "Hello\n")]).await;
    let live = world.live(&[]);
    ready(&live);
    eventually("the online files reach the folder", || {
        world.read(INTRO) == "Intro\n"
            && std::fs::read(world.root.join(FIGURE)).is_ok_and(|bytes| bytes == PNG)
    });
    assert_eq!(world.read(MAIN), "Hello\n");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_sends_a_renamed_folder_as_one_move() {
    const A: &str = "sections/a.tex";
    const B: &str = "sections/b.tex";
    let project = project().doc(A, "A\n").doc(B, "B\n");
    let files = [
        (MAIN, "Hello\n"),
        (INTRO, "Intro\n"),
        (A, "A\n"),
        (B, "B\n"),
    ];
    let world = World::imported(project, &files).await;
    let mut live = world.live(&[]);
    ready(&live);
    let main = world.mock.doc_id(MAIN);
    let mut bob = world.mock.peer("bob");
    bob.join(&main);
    bob.type_at(&main, 5, " world");
    eventually("Bob's edit is written into the folder", || {
        world.read(MAIN) == "Hello world\n"
    });
    let (a, b, folder) = (
        world.mock.doc_id(A),
        world.mock.doc_id(B),
        world.mock.doc_id("sections"),
    );
    std::fs::rename(world.root.join("sections"), world.root.join("chapters")).unwrap();
    let online = || {
        ["sections", "chapters", "chapters/a.tex", "chapters/b.tex"]
            .map(|path| world.mock.entity_id(path))
    };
    let wanted = [None, Some(folder.clone()), Some(a.clone()), Some(b.clone())];
    let deadline = Instant::now() + WAIT;
    while online() != wanted && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    #[cfg(unix)]
    assert_eq!(terminate(&mut live, libc::SIGTERM).code(), Some(0));
    #[cfg(not(unix))]
    {
        live.process.kill().unwrap();
        live.process.wait().unwrap();
    }
    let changes: Vec<String> = world
        .mock
        .requests(&format!("/project/{}/", world.mock.project_id()))
        .into_iter()
        .filter(|request| request.method != "GET")
        .map(|request| format!("{} {}", request.method, request.path))
        .collect();
    let rest = rest_of(&live);
    assert_eq!(online(), wanted, "{changes:#?} {rest:#?}");
    assert!(
        matches!(changes.as_slice(), [only] if only.contains(&folder)),
        "{changes:#?}"
    );
    assert!(
        !rest.iter().any(|value| value["event"] == "delete_asked"),
        "{rest:#?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_keeps_your_text_as_a_copy_when_it_needs_review() {
    let world = World::unbased(project(), &[(MAIN, "Hello mine\n"), (INTRO, "Intro\n")]).await;
    let live = world.live(&[]);
    let review = wait_for(&live, "a review notice", |value| {
        value["event"] == "notice" && value["kind"] == "needs_review"
    });
    assert_eq!(review["path"], MAIN);
    let kept = event(&live, "kept");
    let copy = kept["files"][0]["copy"]
        .as_str()
        .unwrap_or_else(|| panic!("no copy named: {kept}"))
        .to_owned();
    eventually("the online text wins in the file", || {
        world.read(MAIN) == "Hello\n"
    });
    assert_eq!(world.read(&copy), "Hello mine\n");
    assert_eq!(world.mock.doc_text(&world.mock.doc_id(MAIN)), "Hello\n");
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_stops_cleanly_on_sigint_sigterm_sighup() {
    let world = World::imported(project(), &[(MAIN, "Hello\n"), (INTRO, "Intro\n")]).await;
    for signal in [libc::SIGINT, libc::SIGTERM, libc::SIGHUP] {
        let mut live = world.live(&[]);
        ready(&live);
        let status = terminate(&mut live, signal);
        let rest = rest_of(&live);
        assert_eq!(status.code(), Some(0), "signal {signal}: {rest:?}");
        assert!(
            rest.iter().any(|value| value["event"] == "stopped"),
            "signal {signal}: {rest:?}"
        );
        let result = rest.last().unwrap();
        assert_eq!(
            (result["type"].clone(), result["ok"].clone()),
            (json!("result"), json!(true)),
            "signal {signal}"
        );
        drop(world.app_journal().unwrap());
    }
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_stops_cleanly_when_the_terminal_hangs_up_more_than_once() {
    let world = World::imported(project(), &[(MAIN, "Hello\n"), (INTRO, "Intro\n")]).await;
    let mut live = world.live(&[]);
    ready(&live);
    stopping_with_an_edit_unacked(&world, &live, libc::SIGHUP);
    let status = terminate(&mut live, libc::SIGHUP);
    world.mock.release_updates();
    let rest = rest_of(&live);
    assert_eq!(status.code(), Some(0), "{rest:?}");
    assert!(
        rest.iter().any(|value| value["event"] == "stopped"),
        "{rest:?}"
    );
    let result = rest.last().unwrap();
    assert_eq!(
        (result["type"].clone(), result["ok"].clone()),
        (json!("result"), json!(true)),
        "{rest:?}"
    );
    drop(world.app_journal().unwrap());
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_quits_at_once_on_a_second_interrupt() {
    let world = World::imported(project(), &[(MAIN, "Hello\n"), (INTRO, "Intro\n")]).await;
    let mut live = world.live(&[]);
    ready(&live);
    stopping_with_an_edit_unacked(&world, &live, libc::SIGINT);
    send(&live, libc::SIGINT);
    let status = exits::exit_within(&mut live.process, Duration::from_millis(500));
    world.mock.release_updates();
    assert_eq!(status.code(), Some(130));
    eventually("the app can go live once the CLI quit", || {
        world.app_journal().is_ok()
    });
}

#[cfg(windows)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_stops_cleanly_on_ctrl_break() {
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::Console::{
        AllocConsole, GenerateConsoleCtrlEvent, CTRL_BREAK_EVENT,
    };
    use windows_sys::Win32::System::Threading::CREATE_NEW_PROCESS_GROUP;

    let world = World::imported(project(), &[(MAIN, "Hello\n"), (INTRO, "Intro\n")]).await;
    // SAFETY: AllocConsole takes no arguments, and it fails harmlessly when this process already has a console.
    unsafe { AllocConsole() };
    let mut command = world.command(&["remote", "live"]);
    command.creation_flags(CREATE_NEW_PROCESS_GROUP);
    let mut live = Running::start(&mut command);
    ready(&live);
    // SAFETY: sends Ctrl+Break to the process group of the child this test started.
    let sent = unsafe { GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, live.process.id()) };
    assert_ne!(
        sent,
        0,
        "Ctrl+Break was not sent: {}",
        std::io::Error::last_os_error()
    );
    let status = exits::exit_within(&mut live.process, live_cli::STOP_WAIT);
    let rest = rest_of(&live);
    assert_eq!(status.code(), Some(0), "{rest:?}");
    assert!(rest.iter().any(|value| value["event"] == "stopped"));
    drop(world.app_journal().unwrap());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_refuses_a_server_shared_project() {
    let world = World::start(project(), "paper").await;
    let library = world.data.join("projects").join("p-shared");
    std::fs::create_dir_all(&library).unwrap();
    world.import_into(&library, &[(MAIN, "Hello\n")]);
    oleafly_collab::save_binding(
        &oleafly_collab::CollabPaths::new(world.data.join("collab")),
        "p-shared",
        &oleafly_collab::ShareBinding {
            server_url: "https://collab.oleafly.edu".into(),
            server_id: oleafly_collab_protocol::ids::ServerId::new_v7(),
            shared_project_id: oleafly_collab_protocol::ids::SharedProjectId::new_v7(),
            role: oleafly_collab_protocol::roles::ProjectRole::Owner,
            created_at: 1,
        },
    )
    .unwrap();
    let output = output_of(world.command_in(&library, &["remote", "live"])).await;
    let result = result_of(&output);
    assert_eq!(output.status.code(), Some(8), "{result}");
    assert_eq!(result["error"]["code"], "remote.server_shared");
    assert!(world.mock.connections().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_refuses_while_a_git_sync_runs() {
    let world = World::imported(project(), &[(MAIN, "Hello\n"), (INTRO, "Intro\n")]).await;
    let syncing =
        oleafly_online::sync::claim(&oleafly_online::sync::SyncPaths::for_folder(&world.root))
            .unwrap();
    let output = output_of(world.command(&["remote", "live"])).await;
    let result = result_of(&output);
    assert_eq!(output.status.code(), Some(8), "{result}");
    assert_eq!(result["error"]["code"], "remote.busy");
    assert!(world.mock.connections().is_empty());
    drop(syncing);
    drop(world.app_journal().unwrap());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_signed_out_at_start_exits_6() {
    let world = World::imported(project(), &[(MAIN, "Hello\n"), (INTRO, "Intro\n")]).await;
    let alice = world.mock.user("alice");
    session::forget_account(&SecretStore::at(&world.data), &world.mock.base, &alice.id).unwrap();
    let output = output_of(world.command(&["remote", "live"])).await;
    let result = result_of(&output);
    assert_eq!(output.status.code(), Some(6), "{result}");
    assert_eq!(result["error"]["code"], "online.signed_out");
    assert!(world.mock.connections().is_empty());
    drop(world.app_journal().unwrap());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_resumes_when_a_sign_in_appears() {
    let world = World::imported(project(), &[(MAIN, "Hello\n"), (INTRO, "Intro\n")]).await;
    let live = world.live(&[]);
    ready(&live);
    let renewed = world.sign_out_alice();
    state(&live, "signed_out");
    world.save(&renewed);
    state(&live, "online");
    let doc = world.mock.doc_id(MAIN);
    std::fs::write(world.root.join(MAIN), "Hello again\n").unwrap();
    eventually("an edit after the new sign-in reaches the server", || {
        world.mock.doc_text(&doc) == "Hello again\n"
    });
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_journal_resumes_once() {
    let world = World::imported(project(), &[(MAIN, "Hello\n"), (INTRO, "Intro\n")]).await;
    let doc = world.mock.doc_id(MAIN);
    let mut live = world.live(&[]);
    ready(&live);
    world.mock.hold_updates();
    std::fs::write(world.root.join(MAIN), "Hello again\n").unwrap();
    eventually("the edit is sent and held", || alice_updates(&world) >= 1);
    tokio::time::sleep(Duration::from_millis(750)).await;
    live.process.kill().unwrap();
    live.process.wait().unwrap();
    world.mock.release_updates();
    assert_eq!(world.mock.doc_text(&doc), "Hello again\n");
    let live = world.live(&[]);
    ready(&live);
    #[cfg(unix)]
    {
        let mut live = live;
        assert_eq!(terminate(&mut live, libc::SIGTERM).code(), Some(0));
        let stopped = rest_of(&live)
            .into_iter()
            .find(|value| value["event"] == "stopped")
            .expect("a stopped event");
        assert_eq!(stopped["unsent"], json!([]), "{stopped}");
    }
    #[cfg(not(unix))]
    {
        tokio::time::sleep(Duration::from_secs(2)).await;
        drop(live);
    }
    assert_eq!(world.mock.doc_text(&doc), "Hello again\n");
    assert_eq!(world.read(MAIN), "Hello again\n");
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_restart_keeps_a_coauthors_edit_beside_an_offline_one() {
    let world = World::imported(project(), &[(MAIN, "Hello\n"), (INTRO, "Intro\n")]).await;
    let doc = world.mock.doc_id(MAIN);
    let mut live = world.live(&[]);
    ready(&live);
    assert_eq!(terminate(&mut live, libc::SIGTERM).code(), Some(0));
    std::fs::write(world.root.join(MAIN), "Hello\nmine\n").unwrap();
    let mut bob = world.mock.peer("bob");
    bob.join(&doc);
    bob.type_at(&doc, 0, "Theirs\n");
    eventually("Bob's edit is on the server", || {
        world.mock.doc_text(&doc) == "Theirs\nHello\n"
    });
    let mut live = world.live(&[]);
    ready(&live);
    tokio::time::sleep(Duration::from_secs(4)).await;
    let server = world.mock.doc_text(&doc);
    let folder = world.read(MAIN);
    assert_eq!(terminate(&mut live, libc::SIGTERM).code(), Some(0));
    assert!(
        server.contains("Theirs"),
        "the coauthor's edit was replaced: {server:?}"
    );
    assert!(
        folder.contains("mine")
            || std::fs::read_dir(&world.root).unwrap().any(|entry| {
                let name = entry.unwrap().file_name().to_string_lossy().into_owned();
                name.starts_with("main (")
                    && std::fs::read_to_string(world.root.join(&name))
                        .unwrap()
                        .contains("mine")
            }),
        "the offline edit was lost: folder {folder:?}, server {server:?}"
    );
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_restart_sends_an_offline_edit_nobody_else_touched() {
    let world = World::imported(project(), &[(MAIN, "Hello\n"), (INTRO, "Intro\n")]).await;
    let doc = world.mock.doc_id(INTRO);
    let mut live = world.live(&[]);
    ready(&live);
    assert_eq!(terminate(&mut live, libc::SIGTERM).code(), Some(0));
    std::fs::write(world.root.join(INTRO), "Intro\noffline\n").unwrap();
    let mut live = world.live(&[]);
    ready(&live);
    let mut sent = false;
    for _ in 0..60 {
        tokio::time::sleep(Duration::from_millis(250)).await;
        sent = world.mock.doc_text(&doc) == "Intro\noffline\n";
        if sent {
            break;
        }
    }
    let rest = rest_of_now(&live);
    assert_eq!(terminate(&mut live, libc::SIGTERM).code(), Some(0));
    assert!(
        sent,
        "the offline edit never reached the server; events {rest:#?}"
    );
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_restart_asks_about_an_offline_delete_and_never_says_it_cannot_edit() {
    let world = World::imported(project(), &[(MAIN, "Hello\n"), (INTRO, "Intro\n")]).await;
    let mut live = world.live(&[]);
    ready(&live);
    assert_eq!(terminate(&mut live, libc::SIGTERM).code(), Some(0));
    std::fs::write(world.root.join(MAIN), "Hello again\n").unwrap();
    std::fs::remove_file(world.root.join(INTRO)).unwrap();
    let mut live = world.live(&[]);
    let mut seen = Vec::new();
    let asked = wait_for(&live, "the delete to be asked about", |value| {
        seen.push(value.clone());
        value["event"] == "delete_asked"
    });
    assert_eq!(asked["paths"], json!([INTRO]));
    eventually("the offline edit reaches the server", || {
        world.mock.doc_text(&world.mock.doc_id(MAIN)) == "Hello again\n"
    });
    assert_eq!(terminate(&mut live, libc::SIGTERM).code(), Some(0));
    seen.extend(rest_of(&live));
    assert!(
        !seen.iter().any(|value| value["kind"] == "not_allowed"),
        "{seen:#?}"
    );
}

const TOO_LARGE: &str = "update is too large";

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_tries_a_refused_file_once_more() {
    let world = World::imported(project(), &[(MAIN, "Hello\n"), (INTRO, "Intro\n")]).await;
    let doc = world.mock.doc_id(MAIN);
    let live = world.live(&[]);
    ready(&live);
    world.mock.fail_updates(&doc, TOO_LARGE, 1);
    std::fs::write(world.root.join(MAIN), "Hello again\n").unwrap();
    let fault = wait_for(&live, "a fault", |value| value["kind"] == "fault");
    assert_eq!(fault["path"], MAIN);
    eventually("the second try reaches the server", || {
        world.mock.doc_text(&doc) == "Hello again\n"
    });
    assert_eq!(world.read(MAIN), "Hello again\n");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_keeps_your_text_as_a_copy_when_the_server_refuses_it_twice() {
    let world = World::imported(project(), &[(MAIN, "Hello\n"), (INTRO, "Intro\n")]).await;
    let doc = world.mock.doc_id(MAIN);
    let live = world.live(&[]);
    ready(&live);
    world.mock.fail_updates(&doc, TOO_LARGE, usize::MAX);
    std::fs::write(world.root.join(MAIN), "Hello again\n").unwrap();
    let kept = event(&live, "kept");
    let copy = kept["files"][0]["copy"]
        .as_str()
        .unwrap_or_else(|| panic!("no copy named: {kept}"))
        .to_owned();
    eventually("the online text is back in the file", || {
        world.read(MAIN) == "Hello\n"
    });
    assert_eq!(world.read(&copy), "Hello again\n");
    assert_eq!(world.mock.doc_text(&doc), "Hello\n");
    world.mock.fail_updates(&doc, TOO_LARGE, 0);
    std::fs::write(world.root.join(MAIN), "Hello, shorter\n").unwrap();
    eventually("a later edit is sent", || {
        world.mock.doc_text(&doc) == "Hello, shorter\n"
    });
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_stops_when_its_folder_is_moved() {
    let world = World::imported(project(), &[(MAIN, "Hello\n"), (INTRO, "Intro\n")]).await;
    let mut live = world.live(&[]);
    ready(&live);
    std::fs::rename(&world.root, world.root.with_file_name("moved")).unwrap();
    std::fs::create_dir(&world.root).unwrap();
    let status = exits::exit_within(&mut live.process, WAIT);
    let rest = rest_of(&live);
    let result = rest.last().unwrap();
    assert_eq!(status.code(), Some(3), "{rest:#?}");
    assert_eq!(result["error"]["code"], "remote.folder_gone", "{result}");
    assert!(
        !rest.iter().any(|value| value["event"] == "delete_asked"),
        "{rest:#?}"
    );
    assert!(world.mock.entity_id(MAIN).is_some());
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_keeps_trying_a_server_it_cannot_reach_and_names_what_it_never_sent() {
    let world = World::imported(project(), &[(MAIN, "Hello\n"), (INTRO, "Intro\n")]).await;
    let mut live = world.live(&[]);
    ready(&live);
    assert_eq!(terminate(&mut live, libc::SIGTERM).code(), Some(0));
    std::fs::write(world.root.join(MAIN), "Hello again\n").unwrap();
    std::fs::write(world.root.join("notes.tex"), "Notes\n").unwrap();
    world.mock.crash();
    let mut live = world.live(&[]);
    state(&live, "offline");
    assert_eq!(terminate(&mut live, libc::SIGTERM).code(), Some(0));
    let rest = rest_of(&live);
    let stopped = rest
        .iter()
        .find(|value| value["event"] == "stopped")
        .unwrap_or_else(|| panic!("no stopped event: {rest:#?}"));
    assert_eq!(stopped["unsent"], json!([MAIN, "notes.tex"]), "{stopped}");
}

#[cfg(unix)]
fn rest_of_now(live: &Running) -> Vec<Value> {
    std::iter::from_fn(|| live.lines.try_recv().ok())
        .filter_map(|line| serde_json::from_str(&line).ok())
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_into_an_empty_folder_materialises_the_project() {
    let project = project().file(FIGURE, PNG);
    let world = World::start(project, "empty").await;
    let id = world.mock.project_id();
    let live = world.live(&[&id, "--server", &world.mock.base]);
    let started = event(&live, "live_started");
    assert_eq!(started["filling"], true);
    wait_for(&live, "the filled notice", |value| {
        value["event"] == "notice" && value["kind"] == "filled"
    });
    assert_eq!(world.read(MAIN), "Hello\n");
    assert_eq!(world.read(INTRO), "Intro\n");
    assert_eq!(std::fs::read(world.root.join(FIGURE)).unwrap(), PNG);
    let record: Value = serde_json::from_str(&world.read("project.json")).unwrap();
    assert_eq!(record["importedFrom"]["projectId"], id.as_str());
    assert_eq!(record["importedFrom"]["server"], world.mock.base.as_str());
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_live_exit_never_waits_on_a_stuck_blocking_task() {
    let world = World::imported(project(), &[(MAIN, "Hello\n"), (INTRO, "Intro\n")]).await;
    let mut live = world.live(&[]);
    ready(&live);
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(world.data.join(".secret-store.lock"))
        .unwrap();
    oleafly_core::locking::lock_file(&lock, true, Duration::from_secs(5)).unwrap();
    world.sign_out_alice();
    state(&live, "signed_out");
    tokio::time::sleep(Duration::from_secs(7)).await;
    let started = Instant::now();
    let status = terminate(&mut live, libc::SIGTERM);
    assert_eq!(status.code(), Some(0));
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "the exit waited {:?} for the stuck store read",
        started.elapsed()
    );
    drop(lock);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn remote_sync_link_unlink_stand_down_while_live() {
    let world = World::imported(project(), &[(MAIN, "Hello\n"), (INTRO, "Intro\n")]).await;
    let live = world.live(&[]);
    ready(&live);
    for args in [
        &["remote", "sync"][..],
        &["remote", "link"][..],
        &["remote", "unlink"][..],
    ] {
        let result = refused_at_once(&world, args).await;
        let holder = &result["error"]["details"]["holder"];
        assert_eq!(holder["by"], "cli", "{args:?}: {result}");
        assert_eq!(holder["pid"], live.process.id(), "{args:?}");
    }
    assert!(world.root.join(".oleafly/online/live.lock").is_file());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn remote_import_records_import_bases() {
    let world = World::start(project(), "out").await;
    let id = world.mock.project_id();
    let output = output_of(world.command(&[
        "remote",
        "import",
        &id,
        "--server",
        &world.mock.base,
        "--into",
        &world.root.display().to_string(),
    ]))
    .await;
    let result = result_of(&output);
    assert_eq!(output.status.code(), Some(0), "{result}");
    let folder = PathBuf::from(result["imported"][0]["folder"].as_str().unwrap());
    let link = OverleafLink {
        server: world.mock.base.clone(),
        project_id: id,
        user_id: None,
    };
    let mirror = oleafly_live::overleaf::mirror_dir(
        &world.data,
        &link,
        &oleafly_live::overleaf::folder_key(&folder).unwrap(),
    )
    .unwrap();
    let bases: Value = serde_json::from_slice(
        &std::fs::read(mirror.join(oleafly_live::overleaf::IMPORT_BASES)).unwrap(),
    )
    .unwrap();
    assert_eq!(bases[MAIN], "Hello\n");
    assert_eq!(bases[INTRO], "Intro\n");
}
