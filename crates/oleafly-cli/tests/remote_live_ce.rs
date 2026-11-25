#![cfg(unix)]

#[path = "support/exits.rs"]
mod exits;
#[path = "support/hangup.rs"]
mod hangup;
#[path = "support/live_cli.rs"]
mod live_cli;
#[path = "support/running.rs"]
mod running;

use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};

use live_cli::{ready, rest_of, terminate, wait_for};
use oleafly_online::client::Http;
use oleafly_online::live::format::DocFormat;
use oleafly_online::realtime::events::DocId;
use oleafly_online::session;
use oleafly_online::test_support::ce::{
    append, docker_exec, in_container, insert_before, live, opened, quick, scratch, session_of,
    until, Ce, Live, Web, AGENT, CONTAINER, DONE, MAIN, TURN, WAIT,
};
use oleafly_secrets::SecretStore;
use running::Running;
use serde_json::{json, Value};

const REDIS: &str = "oleafly-overleaf-ce-redis-1";
const UPDATER_PID: &str = "/etc/service/document-updater-overleaf/supervise/pid";
const END: &str = "\\end{document}";

struct Folder {
    _dir: tempfile::TempDir,
    data: PathBuf,
    root: PathBuf,
}

impl Folder {
    async fn signed_in(ce: &Ce, web: &Web) -> Folder {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let root = dir.path().join("paper");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::create_dir_all(&root).unwrap();
        let http = Http::new(&ce.site, AGENT).unwrap();
        session::save(
            &SecretStore::at(&data),
            &ce.site,
            &session_of(&http, web).await,
        )
        .unwrap();
        Folder {
            data,
            root: dunce::canonicalize(&root).unwrap(),
            _dir: dir,
        }
    }

    fn live(&self, extra: &[&str]) -> Running {
        live_cli::live(&self.data, &self.root, extra)
    }

    fn read(&self) -> String {
        std::fs::read_to_string(self.root.join(MAIN)).unwrap_or_default()
    }

    fn write(&self, text: &str) {
        std::fs::write(self.root.join(MAIN), text).unwrap();
    }
}

struct Hold {
    running: Running,
}

impl Hold {
    fn document_updater() -> Hold {
        let script = format!(
            "pid=$(cat {UPDATER_PID})\ntrap 'kill -CONT \"$pid\"' EXIT INT TERM HUP\nkill -STOP \"$pid\" || exit 1\necho {DONE}\nread -r -t 30 _ || true\n"
        );
        let mut command = docker_exec(CONTAINER, &script);
        command.stderr(Stdio::inherit());
        let hold = Hold {
            running: Running::start(&mut command),
        };
        let paused = hold.running.lines.recv_timeout(WAIT);
        assert_eq!(
            paused.as_deref(),
            Ok(DONE),
            "document-updater was not paused"
        );
        hold
    }
}

impl Drop for Hold {
    fn drop(&mut self) {
        drop(self.running.process.stdin.take());
        let deadline = Instant::now() + Duration::from_secs(10);
        while matches!(self.running.process.try_wait(), Ok(None)) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        let resume = format!("kill -CONT \"$(cat {UPDATER_PID})\"");
        if let Err(output) = in_container(CONTAINER, &resume, "") {
            eprintln!("document-updater was not resumed: {output}");
        }
    }
}

fn queued(project: &str) -> usize {
    let count = format!("redis-cli LLEN 'PendingProjectUpdates:{{{project}}}'");
    in_container(REDIS, &count, "")
        .unwrap_or_else(|output| panic!("redis did not answer: {output}"))
        .trim()
        .parse()
        .unwrap()
}

fn text(live: &Live, doc: &DocId) -> String {
    live.session.text(doc).unwrap_or_default()
}

fn stopped(rest: &[Value]) -> &Value {
    rest.iter()
        .find(|value| value["event"] == "stopped")
        .unwrap_or_else(|| panic!("no stopped event in {rest:#?}"))
}

async fn converged(ce: &Ce, project: &str, folder: &Folder, coauthor: &Live, doc: &DocId) {
    until("the folder holds the online text", || {
        folder.read() == text(coauthor, doc)
    })
    .await;
    assert_eq!(folder.read(), ce.server_text(project, doc));
}

async fn live_gate(format: DocFormat) {
    let ce = Ce::load();
    let mut alice_web = Web::sign_in(&ce, "alice").await;
    let bob_web = Web::sign_in(&ce, "bob").await;
    let project = scratch(
        &ce,
        &mut alice_web,
        "cli-live",
        format,
        &[("bob", "readAndWrite")],
    )
    .await;
    let folder = Folder::signed_in(&ce, &alice_web).await;
    let bob = live(&ce, &bob_web, &project.id, quick()).await;
    let main = opened(&bob, MAIN).await;

    let mut cli = folder.live(&[&project.id, "--server", &ce.site]);
    let started = ready(&cli);
    assert_eq!(started["filling"], true, "{started}");
    assert_eq!(started["remoteId"], project.id.as_str());
    converged(&ce, &project.id, &folder, &bob, &main).await;

    append(&bob, &main, "\nBob typed this line.\n").await;
    insert_before(&bob, &main, END, "Bob added this before the end.\n").await;
    let bob_id = ce.user_id("bob");
    let edit = wait_for(&cli, "bob's edit", |value| {
        value["event"] == "remote_edit" && value["userId"] == bob_id.as_str()
    });
    assert_eq!(edit["path"], MAIN);
    converged(&ce, &project.id, &folder, &bob, &main).await;

    let edited = folder
        .read()
        .replace(END, &format!("Typed in the folder.\n{END}"));
    folder.write(&edited);
    until("the folder's edit reaches bob", || {
        text(&bob, &main) == edited
    })
    .await;
    assert_eq!(ce.server_text(&project.id, &main), edited);

    let marker = "Sent once across a restart.";
    let held = folder.read().replace(END, &format!("{marker}\n{END}"));
    let hold = Hold::document_updater();
    folder.write(&held);
    until("the edit is queued on the server", || {
        queued(&project.id) > 0
    })
    .await;
    let status = terminate(&mut cli, libc::SIGINT);
    let rest = rest_of(&cli);
    assert_eq!(status.code(), Some(0), "{rest:#?}");
    assert_eq!(stopped(&rest)["unsent"], json!([MAIN]), "{rest:#?}");
    drop(hold);
    until("the held edit reaches bob", || text(&bob, &main) == held).await;
    let away = "Bob typed this while the folder was closed.\n";
    insert_before(&bob, &main, END, away).await;
    let expected = held.replace(END, &format!("{away}{END}"));
    assert_eq!(ce.server_text(&project.id, &main), expected);
    assert_eq!(folder.read(), held);

    let mut cli = folder.live(&[]);
    assert_eq!(ready(&cli)["filling"], false);
    converged(&ce, &project.id, &folder, &bob, &main).await;
    let status = terminate(&mut cli, libc::SIGINT);
    let rest = rest_of(&cli);
    assert_eq!(status.code(), Some(0), "{rest:#?}");
    assert_eq!(stopped(&rest)["unsent"], json!([]), "{rest:#?}");
    let server = ce.server_text(&project.id, &main);
    assert_eq!(server.matches(marker).count(), 1, "{server}");
    assert_eq!(server, expected, "{rest:#?}");
    assert_eq!(folder.read(), expected, "{rest:#?}");
    assert_eq!(text(&bob, &main), expected);
    bob.session.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn ce_remote_live_follows_coauthors_sends_disk_edits_and_resends_once_on_sharejs() {
    let _turn = TURN.lock().await;
    live_gate(DocFormat::ShareJs).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn ce_remote_live_follows_coauthors_sends_disk_edits_and_resends_once_on_history_ot() {
    let _turn = TURN.lock().await;
    live_gate(DocFormat::HistoryOt).await;
}
