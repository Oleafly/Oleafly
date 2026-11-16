use std::path::Path;

use oleafly_ot::TextOperation;
use serde_json::json;

use super::{
    journal_dir, origin_dir, unsent_on, DocRecord, InflightRecord, Journal, JournalError,
    ProjectManifest, KEPT, LIVE_DIR, SCHEMA,
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
        }),
        provisional: false,
        path: None,
    }
}

fn open(data: &Path, folder: Option<&Path>) -> Result<Journal, JournalError> {
    Journal::open(data, BASE, PROJECT, folder)
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
    let inside = open(&folder.join(".data"), Some(&folder)).unwrap_err();
    assert!(matches!(inside, JournalError::Invalid(_)), "{inside:?}");
    assert!(!folder.join(".data").join(LIVE_DIR).exists());

    let data = root.path().join("app-data");
    let journal = open(&data, Some(&folder)).unwrap();
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
    let first = open(data.path(), None).unwrap();
    let second = open(data.path(), None).unwrap_err();
    assert_eq!(second, JournalError::Busy);
    let error = OnlineError::from(second);
    assert_eq!(error.kind, OnlineErrorKind::LiveElsewhere);
    assert_eq!(error.kind.as_str(), "live_elsewhere");
    drop(first);
    open(data.path(), None).unwrap();
}

#[test]
fn a_second_data_dir_cannot_go_live_on_the_same_folder() {
    let root = tempfile::tempdir().unwrap();
    let folder = root.path().join("paper");
    std::fs::create_dir_all(&folder).unwrap();
    let release = open(&root.path().join("release"), Some(&folder)).unwrap();
    let dev = root.path().join("dev");
    assert_eq!(open(&dev, Some(&folder)).unwrap_err(), JournalError::Busy);
    drop(open(&dev, None).unwrap());
    drop(release);
    open(&dev, Some(&folder)).unwrap();
}

#[test]
fn records_and_the_manifest_survive_a_reopen_and_settled_docs_are_deleted() {
    let data = tempfile::tempdir().unwrap();
    let doc = DocId("aaaaaaaaaaaaaaaaaaaaaaaa".into());
    let other = DocId("bbbbbbbbbbbbbbbbbbbbbbbb".into());
    {
        let mut journal = open(data.path(), None).unwrap();
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
    let mut journal = open(data.path(), None).unwrap();
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

    let journal = open(data.path(), None).unwrap();
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
    let mut live = open(data.path(), None).unwrap();
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

    let found = unsent_on(data.path(), BASE);
    let paths = vec![
        "bbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
        "main.tex".to_string(),
    ];
    assert_eq!(found, vec![(PROJECT.to_string(), paths)]);
    assert!(unsent_on(data.path(), "not a url").is_empty());
    assert!(unsent_on(&data.path().join("missing"), BASE).is_empty());
    drop(live);
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
        let mut journal = Journal::open(data.path(), BASE, PROJECT, None).unwrap();
        journal.set_tree_queue(queued.clone());
        assert!(journal.is_dirty());
        journal.flush().unwrap();
    }
    let found = unsent_on(data.path(), BASE);
    assert_eq!(
        found,
        vec![(
            PROJECT.to_string(),
            vec!["figures/plot.png".to_string(), "old.tex".to_string()]
        )]
    );
    let mut journal = Journal::open(data.path(), BASE, PROJECT, None).unwrap();
    assert_eq!(journal.tree_queue(), queued.as_slice());
    assert!(journal.docs().is_empty());
    assert!(journal.kept().is_empty());
    journal.set_tree_queue(Vec::new());
    journal.flush().unwrap();
    drop(journal);
    assert!(unsent_on(data.path(), BASE).is_empty());
}
