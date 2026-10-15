use std::collections::BTreeMap;

use collab_bakeoff::engine::{EngineError, NodeKind, NodeView, Parent};
use collab_bakeoff::tree::{materialize, next_position, would_cycle, Materialized};

fn node(id: &str, parent: Parent, name: &str, kind: NodeKind) -> NodeView {
    NodeView {
        id: id.to_owned(),
        parent,
        name: name.to_owned(),
        kind,
        blob_hash: None,
        position: "i".to_owned(),
    }
}

fn blob(id: &str, parent: Parent, name: &str, hash: &str) -> NodeView {
    NodeView {
        blob_hash: Some(hash.to_owned()),
        ..node(id, parent, name, NodeKind::Blob)
    }
}

fn under(id: &str) -> Parent {
    Parent::Node(id.to_owned())
}

fn view(nodes: &[NodeView]) -> Materialized {
    let texts: BTreeMap<String, String> = nodes
        .iter()
        .filter(|node| node.kind == NodeKind::Text)
        .map(|node| (node.id.clone(), format!("text of {}", node.id)))
        .collect();
    materialize(nodes, &|id: &str| {
        texts
            .get(id)
            .cloned()
            .ok_or_else(|| EngineError::NotText(id.to_owned()))
    })
    .expect("materialize")
}

fn paths(result: &Materialized) -> Vec<(&str, &str)> {
    result
        .files
        .iter()
        .map(|(path, text)| (path.as_str(), text.as_str()))
        .collect()
}

#[test]
fn builds_paths_from_parents() {
    let result = view(&[
        node("d1", Parent::Root, "sections", NodeKind::Dir),
        node("f1", Parent::Root, "main.tex", NodeKind::Text),
        node("f2", under("d1"), "intro.tex", NodeKind::Text),
        blob("b1", Parent::Root, "fig.png", "h1"),
    ]);
    assert_eq!(
        paths(&result),
        vec![
            ("fig.png", "blob:h1"),
            ("main.tex", "text of f1"),
            ("sections/intro.tex", "text of f2")
        ]
    );
    assert_eq!(
        result.dirs.iter().map(String::as_str).collect::<Vec<_>>(),
        vec!["sections"]
    );
    assert_eq!(result.repaired, 0);
}

#[test]
fn trashed_nodes_leave_the_tree_and_keep_their_text() {
    let result = view(&[
        node("d1", Parent::Trash, "sections", NodeKind::Dir),
        node("f2", under("d1"), "intro.tex", NodeKind::Text),
        node("f3", Parent::Trash, "old.tex", NodeKind::Text),
    ]);
    assert!(result.files.is_empty());
    assert!(result.dirs.is_empty());
    assert_eq!(
        result.trash.keys().map(String::as_str).collect::<Vec<_>>(),
        vec!["f2", "f3"]
    );
}

#[test]
fn same_name_and_case_only_siblings_both_survive() {
    let result = view(&[
        node("a", Parent::Root, "notes.tex", NodeKind::Text),
        node("b", Parent::Root, "Notes.tex", NodeKind::Text),
    ]);
    assert_eq!(
        result.files.keys().map(String::as_str).collect::<Vec<_>>(),
        vec!["Notes (b).tex", "notes.tex"]
    );
}

#[test]
fn identical_figures_deduplicate_and_different_ones_both_stay() {
    let result = view(&[
        blob("a", Parent::Root, "fig.png", "h1"),
        blob("b", Parent::Root, "fig.png", "h1"),
        blob("c", Parent::Root, "fig.png", "h2"),
    ]);
    assert_eq!(
        paths(&result),
        vec![("fig (c).png", "blob:h2"), ("fig.png", "blob:h1")]
    );
}

#[test]
fn move_cycles_break_at_the_smallest_id() {
    let result = view(&[
        node("d-a", under("d-b"), "a", NodeKind::Dir),
        node("d-b", under("d-a"), "b", NodeKind::Dir),
        node("f-x", under("d-a"), "x.tex", NodeKind::Text),
    ]);
    assert_eq!(result.repaired, 1);
    assert_eq!(
        result.dirs.iter().map(String::as_str).collect::<Vec<_>>(),
        vec!["a", "a/b"]
    );
    assert!(result.files.contains_key("a/x.tex"));
}

#[test]
fn missing_parents_attach_to_the_root() {
    let result = view(&[node("f1", under("ghost"), "orphan.tex", NodeKind::Text)]);
    assert_eq!(result.repaired, 1);
    assert!(result.files.contains_key("orphan.tex"));
}

#[test]
fn detects_moves_into_a_descendant() {
    let nodes = [
        node("d1", Parent::Root, "a", NodeKind::Dir),
        node("d2", under("d1"), "b", NodeKind::Dir),
    ];
    assert!(would_cycle(&nodes, "d1", "d2"));
    assert!(would_cycle(&nodes, "d1", "d1"));
    assert!(!would_cycle(&nodes, "d2", "d1"));
}

#[test]
fn next_position_sorts_after_existing_siblings() {
    let nodes = [
        node("a", Parent::Root, "x", NodeKind::Text),
        NodeView {
            position: "r".to_owned(),
            ..node("b", Parent::Root, "y", NodeKind::Text)
        },
    ];
    let next = next_position(&nodes, &Parent::Root);
    assert!(next.as_str() > "r", "{next}");
    assert_eq!(next_position(&nodes, &Parent::Trash), "i");
}
