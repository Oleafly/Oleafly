use std::path::Path;
use std::time::Duration;

use oleafly_ot::TextOperation;
use serde_json::json;

use super::{
    folder_lock_path, holder, journal_dir, live_in, manifest_of, origin_dir, stands_down,
    unsent_on, DocRecord, Holder, HolderKind, InflightRecord, Journal, JournalError,
    ProjectManifest, StandDown, KEPT, LIVE_DIR, OWNER, SCHEMA,
};
use crate::error::{OnlineError, OnlineErrorKind};
use crate::live::{DocId, PublicId};

const BASE: &str = "http://localhost:8080";
const PROJECT: &str = "64f0c0ffee0123456789abcd";

fn record(text: &str) -> DocRecord {
    let mut op = TextOperation::new();
    op.retain(5);
    op.insert(" there");
    DocRecord {
        schema: SCHEMA,
        format: "sharejs-text-ot".into(),
        base_text: "Hello".into(),
        base_raw: None,
        base_version: 7,
        local_text: text.into(),
        inflight: Some(InflightRecord {
            op,
            raw: None,
            tracked_by: None,
            public_ids: vec![PublicId("P.1".into())],
            base_version: 7,
            ..InflightRecord::default()
        }),
        provisional: false,
        path: None,
        queued: Vec::new(),
    }
}

fn open(data: &Path) -> Result<Journal, JournalError> {
    Journal::open(data, BASE, PROJECT, None)
}

fn open_live(data: &Path, folder: &Path, by: HolderKind) -> Result<Journal, JournalError> {
    Journal::open_live(data, BASE, PROJECT, folder, by)
}

fn paper(root: &Path) -> std::path::PathBuf {
    let folder = root.join("paper");
    std::fs::create_dir_all(&folder).unwrap();
    folder
}

#[test]
fn journal_path_has_no_colon_on_windows() {
    for (base, origin) in [
        ("http://localhost:8080", "http_localhost_8080"),
        ("https://www.overleaf.com", "https_www.overleaf.com"),
        ("http://[::1]:3000", "http____1__3000"),
        (
            "https://latex.example.org:8443/",
            "https_latex.example.org_8443",
        ),
    ] {
        assert_eq!(origin_dir(base).unwrap(), origin);
    }
    let data = tempfile::tempdir().unwrap();
    for base in ["http://localhost:8080", "http://[::1]:3000"] {
        let dir = journal_dir(data.path(), base, PROJECT).unwrap();
        let relative = dir.strip_prefix(data.path()).unwrap();
        assert!(!relative.to_string_lossy().contains(':'), "{relative:?}");
        assert!(relative.starts_with(LIVE_DIR));
    }
    assert!(matches!(
        journal_dir(data.path(), BASE, "../escape"),
        Err(JournalError::Invalid(_))
    ));
    assert!(matches!(
        journal_dir(data.path(), "not a url", PROJECT),
        Err(JournalError::Invalid(_))
    ));
}

#[test]
fn journal_never_lands_in_project_folder() {
    let root = tempfile::tempdir().unwrap();
    let folder = root.path().join("paper");
    std::fs::create_dir_all(&folder).unwrap();
    let inside = open_live(&folder.join(".data"), &folder, HolderKind::App).unwrap_err();
    assert!(matches!(inside, JournalError::Invalid(_)), "{inside:?}");
    assert!(!folder.join(".data").join(LIVE_DIR).exists());

    let data = root.path().join("app-data");
    let journal = open_live(&data, &folder, HolderKind::App).unwrap();
    assert!(!journal.dir().starts_with(&folder));
    assert!(journal.dir().starts_with(&data));
    let locked = folder.join(".oleafly").join("online").join("live.lock");
    assert!(locked.is_file());
    let in_folder: Vec<_> = walk(&folder)
        .into_iter()
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
        })
        .collect();
    assert!(in_folder.is_empty(), "{in_folder:?}");
}

fn walk(dir: &Path) -> Vec<std::path::PathBuf> {
    let mut found = Vec::new();
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            found.extend(walk(&path));
        } else {
            found.push(path);
        }
    }
    found
}

#[test]
fn a_second_process_cannot_go_live_on_the_same_project() {
    let data = tempfile::tempdir().unwrap();
    let first = open(data.path()).unwrap();
    let second = open(data.path()).unwrap_err();
    assert_eq!(second, JournalError::Busy);
    let error = OnlineError::from(second);
    assert_eq!(error.kind, OnlineErrorKind::LiveElsewhere);
    assert_eq!(error.kind.as_str(), "live_elsewhere");
    drop(first);
    open(data.path()).unwrap();
}

#[test]
fn a_lock_freed_soon_after_a_crash_is_taken_instead_of_refused() {
    let data = tempfile::tempdir().unwrap();
    let first = open(data.path()).unwrap();
    let freed = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(500));
        drop(first);
    });
    let started = std::time::Instant::now();
    open(data.path()).unwrap();
    assert!(started.elapsed() >= Duration::from_millis(400));
    freed.join().unwrap();
}

#[test]
fn a_second_data_dir_cannot_go_live_on_the_same_folder() {
    let root = tempfile::tempdir().unwrap();
    let folder = root.path().join("paper");
    std::fs::create_dir_all(&folder).unwrap();
    let release = open_live(&root.path().join("release"), &folder, HolderKind::App).unwrap();
    let dev = root.path().join("dev");
    assert_eq!(
        open_live(&dev, &folder, HolderKind::App).unwrap_err(),
        JournalError::LiveElsewhere(None)
    );
    drop(open(&dev).unwrap());
    drop(release);
    open_live(&dev, &folder, HolderKind::App).unwrap();
}

#[test]
fn records_and_the_manifest_survive_a_reopen_and_settled_docs_are_deleted() {
    let data = tempfile::tempdir().unwrap();
    let doc = DocId("aaaaaaaaaaaaaaaaaaaaaaaa".into());
    let other = DocId("bbbbbbbbbbbbbbbbbbbbbbbb".into());
    {
        let mut journal = open(data.path()).unwrap();
        journal.set_manifest(ProjectManifest {
            user_id: "alice".into(),
            history_version: Some(12),
            ..ProjectManifest::default()
        });
        journal.put(&doc, Some(record("Hello there, world")));
        journal.put(&other, Some(record("Hello there")));
        assert!(journal.is_dirty());
        journal.flush().unwrap();
        assert!(!journal.is_dirty());
        journal.put(&other, Some(record("Hello there")));
        assert!(!journal.is_dirty());
    }
    let mut journal = open(data.path()).unwrap();
    assert_eq!(journal.manifest().history_version, Some(12));
    assert_eq!(journal.manifest().user_id, "alice");
    assert_eq!(journal.docs()[&doc], record("Hello there, world"));
    assert_eq!(journal.docs().len(), 2);
    journal.put(&other, None);
    journal.flush().unwrap();
    assert!(!journal.dir().join(format!("{}.json", other.0)).exists());
    assert!(journal.dir().join(format!("{}.json", doc.0)).exists());
    let bytes = std::fs::read(journal.dir().join(format!("{}.json", doc.0))).unwrap();
    let stored: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(stored["schema"], json!(SCHEMA));
    assert_eq!(stored["base_version"], json!(7));
    assert_eq!(stored["inflight"]["public_ids"], json!(["P.1"]));
}

#[test]
fn unknown_journal_schema_is_kept_not_replayed() {
    let data = tempfile::tempdir().unwrap();
    let dir = journal_dir(data.path(), BASE, PROJECT).unwrap();
    std::fs::create_dir_all(&dir).unwrap();
    let future = json!({ "schema": 99, "local_text": "from a newer Oleafly" });
    let doc = "cccccccccccccccccccccccc";
    std::fs::write(dir.join(format!("{doc}.json")), future.to_string()).unwrap();
    std::fs::write(
        dir.join("project.json"),
        json!({ "schema": 99 }).to_string(),
    )
    .unwrap();
    std::fs::write(dir.join("dddddddddddddddddddddddd.json"), "not json").unwrap();

    let journal = open(data.path()).unwrap();
    assert!(journal.docs().is_empty());
    assert_eq!(journal.manifest(), &ProjectManifest::default());
    assert_eq!(journal.kept().len(), 3);
    let kept = dir.join(KEPT).join(format!("{doc}.json"));
    let copy: serde_json::Value = serde_json::from_slice(&std::fs::read(&kept).unwrap()).unwrap();
    assert_eq!(copy, future);
    assert!(!dir.join(format!("{doc}.json")).exists());
}

#[test]
fn unsent_on_lists_each_project_with_its_unsent_paths_without_taking_locks() {
    let data = tempfile::tempdir().unwrap();
    let mut live = open(data.path()).unwrap();
    live.put(
        &DocId("aaaaaaaaaaaaaaaaaaaaaaaa".into()),
        Some(DocRecord {
            path: Some("main.tex".into()),
            ..record("Hello there")
        }),
    );
    live.put(
        &DocId("bbbbbbbbbbbbbbbbbbbbbbbb".into()),
        Some(record("Hello there, too")),
    );
    live.flush().unwrap();
    let empty = "64f0c0ffee0123456789abce";
    drop(Journal::open(data.path(), BASE, empty, None).unwrap());
    let mut elsewhere =
        Journal::open(data.path(), "https://other.example.org", PROJECT, None).unwrap();
    elsewhere.put(
        &DocId("cccccccccccccccccccccccc".into()),
        Some(record("Other server")),
    );
    elsewhere.flush().unwrap();
    let future = journal_dir(data.path(), BASE, PROJECT)
        .unwrap()
        .join("dddddddddddddddddddddddd.json");
    std::fs::write(future, json!({ "schema": SCHEMA + 1 }).to_string()).unwrap();

    let found = unsent_on(data.path(), BASE, None);
    let paths = vec![
        "bbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
        "main.tex".to_string(),
    ];
    assert_eq!(found, vec![(PROJECT.to_string(), paths)]);
    assert!(unsent_on(data.path(), "not a url", None).is_empty());
    assert!(unsent_on(&data.path().join("missing"), BASE, None).is_empty());
    drop(live);
}

#[test]
fn a_doc_id_that_is_not_plain_never_creates_overwrites_or_removes_a_file() {
    let data = tempfile::tempdir().unwrap();
    let mut journal = open(data.path()).unwrap();
    let dir = journal.dir().to_path_buf();
    let outside = dir.parent().unwrap().to_path_buf();
    std::fs::create_dir_all(dir.join("sub")).unwrap();
    let sentinels = [
        outside.join("escape.json"),
        dir.join("sub").join("inner.json"),
        dir.join("project.json"),
    ];
    for sentinel in &sentinels {
        std::fs::write(sentinel, "sentinel").unwrap();
    }
    let ids = [
        "../escape".to_string(),
        outside.join("escape").to_string_lossy().into_owned(),
        "sub/inner".to_string(),
        "sub\\inner".to_string(),
        String::new(),
        "a".repeat(200),
        "project".to_string(),
        "Project".to_string(),
        "PROJECT".to_string(),
    ];
    let mut before = walk(data.path());
    before.sort();
    for id in &ids {
        journal.put(&DocId(id.clone()), Some(record("Hello there")));
    }
    journal.flush().unwrap();
    for id in &ids {
        journal.put(&DocId(id.clone()), None);
    }
    journal.flush().unwrap();
    for sentinel in &sentinels {
        assert_eq!(
            std::fs::read_to_string(sentinel).unwrap(),
            "sentinel",
            "{sentinel:?}"
        );
    }
    let mut after = walk(data.path());
    after.sort();
    assert_eq!(after, before);
    assert!(journal.docs().is_empty());
}

#[test]
fn a_queued_tree_change_survives_reopening_and_counts_as_unsent() {
    use crate::live::tree_queue::{QueueState, Queued, TreeChange};
    let data = tempfile::tempdir().unwrap();
    let queued = vec![
        Queued {
            change: TreeChange::Upload {
                path: "figures/plot.png".into(),
            },
            state: QueueState::Waiting,
            entity: None,
        },
        Queued {
            change: TreeChange::Delete {
                path: "old.tex".into(),
            },
            state: QueueState::Waiting,
            entity: Some("e1".into()),
        },
    ];
    {
        let mut journal = open(data.path()).unwrap();
        journal.set_tree_queue(queued.clone());
        assert!(journal.is_dirty());
        journal.flush().unwrap();
    }
    let found = unsent_on(data.path(), BASE, None);
    assert_eq!(
        found,
        vec![(
            PROJECT.to_string(),
            vec!["figures/plot.png".to_string(), "old.tex".to_string()]
        )]
    );
    let mut journal = open(data.path()).unwrap();
    assert_eq!(journal.tree_queue(), queued.as_slice());
    assert!(journal.docs().is_empty());
    assert!(journal.kept().is_empty());
    journal.set_tree_queue(Vec::new());
    journal.flush().unwrap();
    drop(journal);
    assert!(unsent_on(data.path(), BASE, None).is_empty());
}

#[test]
fn unsent_on_filters_by_account() {
    let data = tempfile::tempdir().unwrap();
    let mine = "64f0c0ffee0123456789abc1";
    let theirs = "64f0c0ffee0123456789abc2";
    let nobody = "64f0c0ffee0123456789abc3";
    for (project, user) in [(mine, "u-ada"), (theirs, "u-bea"), (nobody, "")] {
        let mut journal = Journal::open(data.path(), BASE, project, None).unwrap();
        journal.set_manifest(ProjectManifest {
            user_id: user.into(),
            ..ProjectManifest::default()
        });
        journal.put(
            &DocId("aaaaaaaaaaaaaaaaaaaaaaaa".into()),
            Some(DocRecord {
                path: Some("main.tex".into()),
                ..record("Hello there")
            }),
        );
        journal.flush().unwrap();
    }
    let projects = |user: Option<&str>| -> Vec<String> {
        unsent_on(data.path(), BASE, user)
            .into_iter()
            .map(|(project, _)| project)
            .collect()
    };
    assert_eq!(projects(Some("u-ada")), vec![mine, nobody]);
    assert_eq!(projects(Some("u-bea")), vec![theirs, nobody]);
    assert_eq!(projects(None), vec![mine, theirs, nobody]);
}

#[test]
fn journal_owner_record_is_written_and_removed() {
    let root = tempfile::tempdir().unwrap();
    let folder = paper(root.path());
    let data = root.path().join("data");
    assert_eq!(holder(&data, BASE, PROJECT), None);
    let journal = open_live(&data, &folder, HolderKind::Cli).unwrap();
    let owner = journal.dir().join(OWNER);
    let found = holder(&data, BASE, PROJECT).unwrap();
    assert_eq!(found.by, HolderKind::Cli);
    assert_eq!(found.pid, std::process::id());
    assert!(found.since_ms > 0);
    let stored: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&owner).unwrap()).unwrap();
    assert_eq!(stored["by"], json!("cli"));
    drop(journal);
    assert!(!owner.exists());
    assert_eq!(holder(&data, BASE, PROJECT), None);
    drop(open(&data).unwrap());
    assert_eq!(holder(&data, BASE, PROJECT), None);
}

#[test]
fn open_live_refuses_at_once_while_the_folder_is_live() {
    let root = tempfile::tempdir().unwrap();
    let folder = paper(root.path());
    let data = root.path().join("data");
    let live = open_live(&data, &folder, HolderKind::App).unwrap();
    let started = std::time::Instant::now();
    let refused = open_live(&data, &folder, HolderKind::Cli).unwrap_err();
    assert!(started.elapsed() < Duration::from_secs(1));
    let app = holder(&data, BASE, PROJECT).unwrap();
    assert_eq!(app.by, HolderKind::App);
    assert_eq!(refused, JournalError::LiveElsewhere(Some(app)));
    assert_eq!(
        refused.to_string(),
        "this project is live in the Oleafly app"
    );
    let error = OnlineError::from(refused);
    assert_eq!(error.kind, OnlineErrorKind::LiveElsewhere);

    let other = root.path().join("other");
    let started = std::time::Instant::now();
    let unknown = open_live(&other, &folder, HolderKind::Cli).unwrap_err();
    assert!(started.elapsed() < Duration::from_secs(1));
    assert_eq!(unknown, JournalError::LiveElsewhere(None));
    assert_eq!(
        unknown.to_string(),
        "this project is live in another Oleafly window or on the command line"
    );
    drop(live);
    drop(open_live(&data, &folder, HolderKind::Cli).unwrap());
}

#[test]
fn open_live_waits_out_a_short_journal_open() {
    let root = tempfile::tempdir().unwrap();
    let folder = paper(root.path());
    let data = root.path().join("data");
    let short = open(&data).unwrap();
    let freed = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        drop(short);
    });
    let started = std::time::Instant::now();
    let live = open_live(&data, &folder, HolderKind::Cli).unwrap();
    assert!(started.elapsed() >= Duration::from_millis(200));
    freed.join().unwrap();
    assert_eq!(holder(&data, BASE, PROJECT).unwrap().by, HolderKind::Cli);

    let elsewhere = root.path().join("elsewhere");
    std::fs::create_dir_all(&elsewhere).unwrap();
    let refused = open_live(&data, &elsewhere, HolderKind::App).unwrap_err();
    assert!(
        matches!(&refused, JournalError::LiveElsewhere(Some(Holder { by: HolderKind::Cli, pid, .. })) if *pid == std::process::id()),
        "{refused:?}"
    );
    assert_eq!(
        refused.to_string(),
        format!(
            "this project is live on the command line (process {})",
            std::process::id()
        )
    );
    assert!(!live_in(&elsewhere));
    drop(live);
}

#[test]
fn a_stale_owner_record_is_replaced_by_the_next_live_open() {
    let root = tempfile::tempdir().unwrap();
    let folder = paper(root.path());
    let data = root.path().join("data");
    let dir = journal_dir(&data, BASE, PROJECT).unwrap();
    std::fs::create_dir_all(&dir).unwrap();
    let stale = Holder {
        by: HolderKind::App,
        pid: u32::MAX,
        since_ms: 1,
    };
    std::fs::write(dir.join(OWNER), serde_json::to_vec(&stale).unwrap()).unwrap();
    assert_eq!(holder(&data, BASE, PROJECT), None);
    let elsewhere = open_live(&root.path().join("other"), &folder, HolderKind::App).unwrap();
    assert_eq!(
        open_live(&data, &folder, HolderKind::Cli).unwrap_err(),
        JournalError::LiveElsewhere(None)
    );
    assert_eq!(
        stands_down(&data, BASE, PROJECT, Some(&folder)),
        Some(StandDown::Live(None))
    );
    drop(elsewhere);
    let journal = open_live(&data, &folder, HolderKind::Cli).unwrap();
    let fresh = holder(&data, BASE, PROJECT).unwrap();
    assert_ne!(fresh, stale);
    assert_eq!(fresh.by, HolderKind::Cli);
    assert!(fresh.since_ms > stale.since_ms);
    drop(journal);
    assert_eq!(holder(&data, BASE, PROJECT), None);
}

#[test]
fn live_in_never_creates_the_lock_file() {
    let root = tempfile::tempdir().unwrap();
    let folder = paper(root.path());
    let data = root.path().join("data");
    let lock = folder_lock_path(&folder);
    assert_eq!(
        lock,
        folder.join(".oleafly").join("online").join("live.lock")
    );
    assert!(!live_in(&folder));
    assert!(!lock.exists());
    assert!(!folder.join(".oleafly").exists());
    let live = open_live(&data, &folder, HolderKind::Cli).unwrap();
    assert!(live_in(&folder));
    assert!(live_in(&folder));
    drop(live);
    assert!(lock.is_file());
    assert!(!live_in(&folder));
    drop(open_live(&data, &folder, HolderKind::App).unwrap());
}

#[cfg(unix)]
#[test]
fn a_released_journal_frees_its_locks_while_a_starting_child_still_holds_copies() {
    let root = tempfile::tempdir().unwrap();
    let folder = paper(root.path());
    let data = root.path().join("data");
    let journal = open_live(&data, &folder, HolderKind::App).unwrap();
    let (lock, folder_lock) = journal.locks.as_ref().unwrap();
    let copies = [
        lock.try_clone().unwrap(),
        folder_lock.as_ref().unwrap().try_clone().unwrap(),
    ];
    drop(journal);
    assert_eq!(holder(&data, BASE, PROJECT), None);
    assert!(!live_in(&folder));
    drop(open_live(&data, &folder, HolderKind::Cli).unwrap());
    drop(copies);
}

#[test]
fn manifest_of_reads_while_another_process_holds_the_lock() {
    let root = tempfile::tempdir().unwrap();
    let folder = paper(root.path());
    let data = root.path().join("data");
    assert_eq!(manifest_of(&data, BASE, PROJECT), None);
    let mut live = open_live(&data, &folder, HolderKind::Cli).unwrap();
    assert_eq!(manifest_of(&data, BASE, PROJECT), None);
    let manifest = ProjectManifest {
        user_id: "u-ada".into(),
        paused: true,
        ..ProjectManifest::default()
    };
    live.set_manifest(manifest.clone());
    live.flush().unwrap();
    let started = std::time::Instant::now();
    assert_eq!(manifest_of(&data, BASE, PROJECT), Some(manifest));
    assert!(started.elapsed() < Duration::from_secs(1));
    std::fs::write(
        live.dir().join("project.json"),
        json!({ "schema": SCHEMA + 1 }).to_string(),
    )
    .unwrap();
    assert_eq!(manifest_of(&data, BASE, PROJECT), None);
    assert_eq!(manifest_of(&data, BASE, "../escape"), None);
    drop(live);
}

#[test]
fn stands_down_while_live_or_unsent() {
    let root = tempfile::tempdir().unwrap();
    let folder = paper(root.path());
    let data = root.path().join("data");
    assert_eq!(stands_down(&data, BASE, PROJECT, Some(&folder)), None);
    assert_eq!(stands_down(&data, BASE, PROJECT, None), None);
    let mut live = open_live(&data, &folder, HolderKind::Cli).unwrap();
    let cli = holder(&data, BASE, PROJECT);
    assert!(cli.is_some());
    assert_eq!(
        stands_down(&data, BASE, PROJECT, Some(&folder)),
        Some(StandDown::Live(cli))
    );
    assert_eq!(stands_down(&data, BASE, PROJECT, None), None);
    live.put(
        &DocId("aaaaaaaaaaaaaaaaaaaaaaaa".into()),
        Some(DocRecord {
            path: Some("main.tex".into()),
            ..record("Hello there")
        }),
    );
    live.flush().unwrap();
    drop(live);
    let unsent = Some(StandDown::Unsent(vec!["main.tex".to_string()]));
    assert_eq!(stands_down(&data, BASE, PROJECT, Some(&folder)), unsent);
    assert_eq!(stands_down(&data, BASE, PROJECT, None), unsent);
    assert_eq!(
        stands_down(&data, BASE, "64f0c0ffee0123456789abce", Some(&folder)),
        None
    );
}
