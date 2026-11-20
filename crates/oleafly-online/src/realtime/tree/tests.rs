use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::{NodeKind, OverleafTree, PathChange};
use crate::realtime::events::{EntityId, TreeEvent};

fn entity(id: &str) -> EntityId {
    EntityId(id.to_string())
}

fn tree() -> OverleafTree {
    OverleafTree::from_root_folder(&json!([{
        "_id": "root",
        "name": "rootFolder",
        "docs": [{ "_id": "main", "name": "main.tex" }, { "_id": "notes", "name": "notes.tex" }],
        "fileRefs": [],
        "folders": [{
            "_id": "sections",
            "name": "sections",
            "docs": [{ "_id": "intro", "name": "intro.tex" }],
            "fileRefs": [{ "_id": "plot", "name": "plot.png", "hash": "h" }],
            "folders": [],
        }],
    }]))
    .unwrap()
}

#[test]
fn a_placed_node_shows_at_its_new_path_and_ignores_the_echo() {
    let mut tree = tree();
    let changes = tree.place(&entity("notes"), &entity("sections"), "later.tex");
    assert_eq!(
        changes,
        vec![PathChange::Moved {
            id: entity("notes"),
            from: "notes.tex".into(),
            to: "sections/later.tex".into(),
            kind: NodeKind::Doc,
        }]
    );
    assert_eq!(tree.id_at("sections/later.tex"), Some(&entity("notes")));
    assert_eq!(tree.id_at("notes.tex"), None);
    assert_eq!(
        tree.server_path_of(&entity("notes")).as_deref(),
        Some("notes.tex")
    );
    let node = tree.node(&entity("notes")).unwrap();
    assert_eq!(node.parent, Some(entity("sections")));
    assert_eq!(node.name, "later.tex");
    let now = Instant::now();
    let echo = [
        TreeEvent::Moved {
            id: entity("notes"),
            folder: entity("sections"),
        },
        TreeEvent::Renamed {
            id: entity("notes"),
            name: "later.tex".into(),
        },
    ];
    for event in &echo {
        assert!(tree.apply(event, now).is_empty(), "{event:?}");
    }
    assert!(tree.clear_local(&entity("notes")).is_empty());
    assert!(!tree.is_local(&entity("notes")));
}

#[test]
fn a_placed_folder_carries_its_children() {
    let mut tree = tree();
    let changes = tree.place(&entity("sections"), &entity("root"), "chapters");
    let moved: Vec<(&str, &str)> = changes
        .iter()
        .map(|change| match change {
            PathChange::Moved { from, to, .. } => (from.as_str(), to.as_str()),
            other => panic!("{other:?}"),
        })
        .collect();
    assert_eq!(
        moved,
        vec![
            ("sections", "chapters"),
            ("sections/intro.tex", "chapters/intro.tex"),
            ("sections/plot.png", "chapters/plot.png"),
        ]
    );
    assert!(tree
        .place(&entity("sections"), &entity("sections"), "x")
        .is_empty());
}

#[test]
fn a_hidden_node_and_its_children_leave_the_view_until_cleared() {
    let mut tree = tree();
    let removed: Vec<String> = tree
        .hide(&entity("sections"))
        .into_iter()
        .map(|change| match change {
            PathChange::Removed { path, .. } => path,
            other => panic!("{other:?}"),
        })
        .collect();
    assert_eq!(
        removed,
        vec!["sections", "sections/intro.tex", "sections/plot.png"]
    );
    assert_eq!(tree.paths(), vec!["main.tex", "notes.tex"]);
    assert!(tree.node(&entity("intro")).is_none());
    let now = Instant::now();
    let inside = TreeEvent::NewDoc {
        folder: entity("sections"),
        id: entity("extra"),
        name: "extra.tex".into(),
    };
    assert!(tree.apply(&inside, now).is_empty());
    let back = tree.clear_local(&entity("sections"));
    assert_eq!(back.len(), 4, "{back:?}");
    assert!(back
        .iter()
        .all(|change| matches!(change, PathChange::Added { .. })));
    assert!(tree.flush().is_empty());
}

#[test]
fn a_server_delete_of_a_hidden_node_changes_nothing_visible() {
    let mut tree = tree();
    tree.hide(&entity("notes"));
    let now = Instant::now();
    let removed = TreeEvent::Removed {
        id: entity("notes"),
        converting: false,
    };
    assert!(tree.apply(&removed, now).is_empty());
    assert!(tree.flush().is_empty());
    assert!(tree.server_node(&entity("notes")).is_none());
    assert!(!tree.is_local(&entity("notes")));
}

#[test]
fn a_coauthor_rename_of_a_placed_node_stays_hidden_behind_ours() {
    let mut tree = tree();
    tree.place(&entity("notes"), &entity("root"), "mine.tex");
    let now = Instant::now();
    let theirs = TreeEvent::Renamed {
        id: entity("notes"),
        name: "theirs.tex".into(),
    };
    assert!(tree.apply(&theirs, now).is_empty());
    assert_eq!(tree.id_at("mine.tex"), Some(&entity("notes")));
    assert_eq!(
        tree.clear_local(&entity("notes")),
        vec![PathChange::Moved {
            id: entity("notes"),
            from: "mine.tex".into(),
            to: "theirs.tex".into(),
            kind: NodeKind::Doc,
        }]
    );
}

#[test]
fn a_repair_keeps_the_overlay() {
    let mut tree = self::tree();
    tree.place(&entity("notes"), &entity("root"), "mine.tex");
    tree.hide(&entity("main"));
    let changes = tree.repair(self::tree());
    assert!(changes.is_empty(), "{changes:?}");
    assert_eq!(tree.id_at("mine.tex"), Some(&entity("notes")));
    assert_eq!(tree.id_at("main.tex"), None);
    let mut fresh = self::tree();
    fresh.apply(
        &TreeEvent::Removed {
            id: entity("sections"),
            converting: false,
        },
        Instant::now(),
    );
    tree.place(&entity("main"), &entity("sections"), "main.tex");
    let changes = tree.repair(fresh);
    assert!(changes
        .iter()
        .any(|change| matches!(change, PathChange::Removed { path, .. } if path == "sections")));
    assert_eq!(tree.id_at("mine.tex"), Some(&entity("notes")));
    assert!(!tree.is_local(&entity("main")));
}

#[test]
fn entries_with_hostile_or_missing_ids_are_skipped_and_the_rest_loads() {
    let long = "a".repeat(129);
    let tree = OverleafTree::from_root_folder(&json!([{
        "_id": "root",
        "name": "rootFolder",
        "docs": [
            { "_id": "main", "name": "main.tex" },
            { "_id": "../journal", "name": "up.tex" },
            { "_id": "/etc/passwd", "name": "absolute.tex" },
            { "_id": "a/b", "name": "slash.tex" },
            { "_id": "a\\b", "name": "backslash.tex" },
            { "_id": "", "name": "empty.tex" },
            { "_id": long, "name": "long.tex" },
            { "name": "no-id.tex" },
            { "_id": "nameless" },
        ],
        "fileRefs": [
            { "_id": "C:\\Users\\x", "name": "drive.png" },
            { "_id": "plot", "name": "plot.png" },
        ],
        "folders": [
            { "_id": "../up", "name": "up", "docs": [{ "_id": "inside", "name": "inside.tex" }] },
            { "_id": "sections", "name": "sections", "docs": [{ "_id": "intro", "name": "intro.tex" }] },
        ],
    }]))
    .unwrap();
    assert_eq!(
        tree.paths(),
        vec!["main.tex", "plot.png", "sections/intro.tex"]
    );
    for skipped in [
        "../journal",
        "/etc/passwd",
        "a/b",
        "a\\b",
        "",
        long.as_str(),
        "nameless",
        "C:\\Users\\x",
        "../up",
        "inside",
    ] {
        assert!(tree.server_node(&entity(skipped)).is_none(), "{skipped}");
    }
    assert!(
        OverleafTree::from_root_folder(&json!([{ "_id": "../root", "name": "rootFolder" }]))
            .is_none()
    );
}

#[test]
fn lookups_in_a_large_tree_go_through_the_index() {
    let parts: Vec<Value> = (0..100)
        .map(|part| {
            json!({
                "_id": format!("f{part}"),
                "name": format!("part{part}"),
                "docs": (0..100)
                    .map(|doc| json!({ "_id": format!("d{part}x{doc}"), "name": format!("{doc}.tex") }))
                    .collect::<Vec<_>>(),
                "fileRefs": [],
                "folders": [],
            })
        })
        .collect();
    let mut tree = OverleafTree::from_root_folder(&json!([{
        "_id": "root",
        "name": "rootFolder",
        "docs": [],
        "fileRefs": [],
        "folders": [{ "_id": "all", "name": "all", "docs": [], "fileRefs": [], "folders": parts }],
    }]))
    .unwrap();
    let started = Instant::now();
    assert_eq!(
        tree.place(&entity("all"), &entity("root"), "moved").len(),
        10_101
    );
    for part in 0..100 {
        for doc in 0..100 {
            let id = entity(&format!("d{part}x{doc}"));
            assert_eq!(
                tree.id_at(&format!("moved/part{part}/{doc}.tex")),
                Some(&id)
            );
            assert_eq!(tree.id_at(&format!("all/part{part}/{doc}.tex")), None);
        }
    }
    assert_eq!(tree.hide(&entity("all")).len(), 10_101);
    assert_eq!(tree.id_at("moved/part0/0.tex"), None);
    assert_eq!(tree.clear_local(&entity("all")).len(), 10_101);
    assert_eq!(tree.id_at("all/part99/99.tex"), Some(&entity("d99x99")));
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "{:?}",
        started.elapsed()
    );
}
