use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

use crate::doc::{FileNode, NodeKind, NodeParent};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Placed {
    pub path: String,
    pub kind: NodeKind,
    pub blob: Option<String>,
}

pub type Layout = BTreeMap<String, Placed>;

const RESERVED_TOP: [&str; 3] = [".oleafly", ".git", ".DS_Store"];
const WINDOWS_RESERVED: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

pub fn short_alias(name: &str) -> bool {
    let Some(at) = name.rfind('~') else {
        return false;
    };
    let rest = &name[at + 1..];
    let digits = rest.chars().take_while(char::is_ascii_digit).count();
    digits > 0 && (rest.len() == digits || rest[digits..].starts_with('.'))
}

pub fn safe_name(name: &str, id: &str) -> String {
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let lowered = name.to_lowercase();
    let unsafe_name = name.is_empty()
        || lowered == ".git"
        || lowered == ".oleafly"
        || short_alias(name)
        || name == "."
        || name == ".."
        || name.len() > 255
        || name.ends_with('.')
        || name.ends_with(' ')
        || name.chars().any(|c| {
            c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
        || WINDOWS_RESERVED.contains(&stem.as_str());
    if unsafe_name {
        let short: String = id
            .chars()
            .rev()
            .take(8)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        format!("unnamed-{short}")
    } else {
        name.to_owned()
    }
}

// Two names are one file wherever a member's file system says so: macOS
// and Windows ignore case, and macOS also treats a name typed as one
// character (NFC) and the same name spelled with a combining accent (NFD),
// which Finder and zip files from a Mac use, as the same name.
fn fold(name: &str) -> String {
    name.nfc().flat_map(char::to_lowercase).collect()
}

fn suffixed(name: &str, id: &str) -> String {
    let short: String = id
        .chars()
        .rev()
        .take(6)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    match name.rfind('.') {
        Some(dot) if dot > 0 => format!("{} ({short}){}", &name[..dot], &name[dot..]),
        _ => format!("{name} ({short})"),
    }
}

fn in_trash(parents: &BTreeMap<&str, &NodeParent>, folders: &BTreeSet<&str>, id: &str) -> bool {
    let mut current = id;
    for _ in 0..=parents.len() {
        match parents.get(current) {
            Some(NodeParent::Trash) => return true,
            Some(NodeParent::Node(parent)) if folders.contains(parent.as_str()) => {
                current = parent.as_str();
            }
            _ => return false,
        }
    }
    true
}

type Groups<'a> = BTreeMap<(NodeParent, String), Vec<&'a FileNode>>;

// Only a folder holds other nodes. A node whose parent is a file, which
// only a modified client can make, sits at the top like an orphan, so it
// never needs a folder where a file is.
fn folders(nodes: &[FileNode]) -> BTreeSet<&str> {
    nodes
        .iter()
        .filter(|node| node.kind == NodeKind::Dir)
        .map(|node| node.id.as_str())
        .collect()
}

fn groups(nodes: &[FileNode]) -> Groups<'_> {
    let folders = folders(nodes);
    let parents: BTreeMap<&str, &NodeParent> = nodes
        .iter()
        .map(|node| (node.id.as_str(), &node.parent))
        .collect();
    let mut groups = Groups::new();
    for node in nodes {
        if in_trash(&parents, &folders, &node.id) {
            continue;
        }
        let parent = match &node.parent {
            NodeParent::Node(parent) if !folders.contains(parent.as_str()) => NodeParent::Root,
            other => other.clone(),
        };
        let name = safe_name(&node.name, &node.id);
        groups.entry((parent, fold(&name))).or_default().push(node);
    }
    for members in groups.values_mut() {
        members.sort_by(|left, right| {
            left.position
                .cmp(&right.position)
                .then_with(|| left.id.cmp(&right.id))
        });
    }
    groups
}

const CREDIT_LIMIT: usize = 40;

fn credit(author: &str) -> String {
    let cleaned: String = author
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                ' '
            } else {
                c
            }
        })
        .collect();
    cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(CREDIT_LIMIT)
        .collect::<String>()
        .trim_end()
        .to_owned()
}

const CREDIT_TRIES: usize = 99;

pub fn named_for(name: &str, author: &str, number: usize) -> String {
    let who = if number > 1 {
        format!("{author} {number}")
    } else {
        author.to_owned()
    };
    match name.rfind('.') {
        Some(dot) if dot > 0 => format!("{} (from {who}){}", &name[..dot], &name[dot..]),
        _ => format!("{name} (from {who})"),
    }
}

pub fn credited_name(
    name: &str,
    author: &str,
    id: &str,
    mut free: impl FnMut(&str) -> bool,
) -> Option<String> {
    let author = credit(author);
    if author.is_empty() {
        return None;
    }
    (1..=CREDIT_TRIES)
        .map(|number| named_for(name, &author, number))
        .find(|named| safe_name(named, id) == *named && free(named))
}

fn credited<'a>(node: &'a FileNode, first: &FileNode) -> Option<&'a str> {
    let differs = match node.kind {
        NodeKind::Blob => node.blob != first.blob,
        NodeKind::Text => true,
        NodeKind::Dir => false,
    };
    differs.then_some(())?;
    node.author_name.as_deref()
}

struct Naming<'a> {
    names: BTreeMap<&'a str, String>,
    clashes: Vec<Clash>,
}

fn naming<'a>(groups: &Groups<'a>) -> Naming<'a> {
    let mut taken: BTreeSet<(NodeParent, String)> = groups.keys().cloned().collect();
    let mut names: BTreeMap<&str, String> = BTreeMap::new();
    let mut clashes = Vec::new();
    for ((parent, folded), members) in groups {
        let reserved = *parent == NodeParent::Root
            && RESERVED_TOP
                .iter()
                .any(|reserved| fold(reserved) == *folded);
        let Some(first) = members.first() else {
            continue;
        };
        for (index, node) in members.iter().enumerate() {
            let name = safe_name(&node.name, &node.id);
            if index == 0 && !reserved {
                names.insert(node.id.as_str(), name);
                continue;
            }
            let named = credited(node, first)
                .filter(|_| index > 0)
                .and_then(|author| {
                    credited_name(&name, author, &node.id, |named| {
                        taken.insert((parent.clone(), fold(named)))
                    })
                })
                .unwrap_or_else(|| suffixed(&name, &node.id));
            if !reserved {
                clashes.push(Clash {
                    id: node.id.clone(),
                    name,
                    other: first.id.clone(),
                });
            }
            names.insert(node.id.as_str(), named);
        }
    }
    Naming { names, clashes }
}

pub fn layout(nodes: &[FileNode]) -> Layout {
    let by_id: BTreeMap<&str, &FileNode> =
        nodes.iter().map(|node| (node.id.as_str(), node)).collect();
    let names = naming(&groups(nodes)).names;
    let mut placed = Layout::new();
    for node in nodes {
        let Some(path) = path_of(&node.id, &by_id, &names) else {
            continue;
        };
        placed.insert(
            node.id.clone(),
            Placed {
                path,
                kind: node.kind,
                blob: node.blob.clone(),
            },
        );
    }
    let taken: BTreeSet<String> = placed.values().map(|entry| fold(&entry.path)).collect();
    debug_assert_eq!(taken.len(), placed.len());
    placed
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Clash {
    pub id: String,
    pub name: String,
    pub other: String,
}

pub fn clashes(nodes: &[FileNode]) -> Vec<Clash> {
    naming(&groups(nodes)).clashes
}

pub fn duplicate_blobs(nodes: &[FileNode]) -> Vec<String> {
    let mut duplicates = Vec::new();
    for members in groups(nodes).values() {
        let mut seen: BTreeSet<&str> = BTreeSet::new();
        for node in members {
            let Some(blob) = node.blob.as_deref().filter(|_| node.kind == NodeKind::Blob) else {
                continue;
            };
            if !seen.insert(blob) {
                duplicates.push(node.id.clone());
            }
        }
    }
    duplicates
}

fn path_of(
    id: &str,
    by_id: &BTreeMap<&str, &FileNode>,
    names: &BTreeMap<&str, String>,
) -> Option<String> {
    let mut segments = Vec::new();
    let mut current = id;
    for _ in 0..=by_id.len() {
        segments.push(names.get(current)?.clone());
        match by_id.get(current).map(|node| &node.parent) {
            Some(NodeParent::Node(parent))
                if by_id
                    .get(parent.as_str())
                    .is_some_and(|holder| holder.kind == NodeKind::Dir) =>
            {
                current = parent.as_str();
            }
            Some(NodeParent::Trash) => return None,
            _ => {
                segments.reverse();
                return Some(segments.join("/"));
            }
        }
    }
    None
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DiskPlan {
    pub removed: Vec<String>,
    pub moved: Vec<(String, String)>,
    pub written: Vec<String>,
    pub dirs: Vec<String>,
}

pub fn plan(previous: &Layout, next: &Layout) -> DiskPlan {
    let mut disk = DiskPlan::default();
    for (id, before) in previous {
        match next.get(id) {
            None => disk.removed.push(before.path.clone()),
            Some(after) if after.path != before.path => {
                disk.moved.push((before.path.clone(), after.path.clone()));
            }
            Some(_) => {}
        }
    }
    for (id, after) in next {
        let fresh = previous
            .get(id)
            .is_none_or(|before| before.blob != after.blob);
        match after.kind {
            NodeKind::Dir => {
                if previous.get(id).is_none() {
                    disk.dirs.push(after.path.clone());
                }
            }
            _ if fresh => disk.written.push(id.clone()),
            _ => {}
        }
    }
    disk.removed
        .sort_by_key(|path| std::cmp::Reverse(path.matches('/').count()));
    disk.moved
        .sort_by_key(|(from, _)| from.matches('/').count());
    disk.dirs.sort_by_key(|path| path.matches('/').count());
    disk
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str, parent: NodeParent, name: &str, kind: NodeKind) -> FileNode {
        FileNode {
            id: id.to_owned(),
            parent,
            name: name.to_owned(),
            kind,
            blob: None,
            position: id.to_owned(),
            author_name: None,
        }
    }

    fn figure(id: &str, parent: NodeParent, name: &str, blob: &str, author: &str) -> FileNode {
        FileNode {
            blob: Some(blob.to_owned()),
            author_name: Some(author.to_owned()),
            ..node(id, parent, name, NodeKind::Blob)
        }
    }

    #[test]
    fn a_later_different_figure_with_the_same_name_is_named_for_its_creator() {
        let figs = NodeParent::Node("d1".into());
        let nodes = vec![
            node("d1", NodeParent::Root, "figs", NodeKind::Dir),
            figure("a1", figs.clone(), "plot.png", "h1", "Alice Chen"),
            figure("b2", figs.clone(), "Plot.png", "h2", "Bob Smith"),
            figure("c3", figs.clone(), "plot.png", "h3", "Bob Smith"),
            figure("d4", figs, "plot.png", "h1", "Carol Diaz"),
            figure("f6", NodeParent::Root, "notes", "h6", "Erin"),
            figure("g7", NodeParent::Root, "notes", "h7", "Dan: Lee"),
            figure("h8", NodeParent::Root, "notes", "h8", "   "),
            figure("i9", NodeParent::Root, "notes", "h9", "Carol/Diaz\u{7}"),
            node("j0", NodeParent::Root, "notes", NodeKind::Text),
        ];
        let placed = layout(&nodes);
        assert_eq!(placed["a1"].path, "figs/plot.png");
        assert_eq!(placed["b2"].path, "figs/Plot (from Bob Smith).png");
        assert_eq!(placed["c3"].path, "figs/plot (from Bob Smith 2).png");
        assert_eq!(placed["d4"].path, "figs/plot (d4).png");
        assert_eq!(placed["f6"].path, "notes");
        assert_eq!(placed["g7"].path, "notes (from Dan Lee)");
        assert_eq!(placed["h8"].path, "notes (h8)");
        assert_eq!(placed["i9"].path, "notes (from Carol Diaz)");
        assert_eq!(placed["j0"].path, "notes (j0)");
    }

    fn written(id: &str, parent: NodeParent, name: &str, author: Option<&str>) -> FileNode {
        FileNode {
            author_name: author.map(str::to_owned),
            ..node(id, parent, name, NodeKind::Text)
        }
    }

    #[test]
    fn a_same_name_file_is_named_for_the_person_who_added_it() {
        let chapters = NodeParent::Node("d1".into());
        let nodes = vec![
            node("d1", NodeParent::Root, "chapters", NodeKind::Dir),
            written("a1", chapters.clone(), "plan.tex", Some("Alice Chen")),
            written("b2", chapters.clone(), "plan.tex", Some("Bob Smith")),
            written("c3", chapters.clone(), "Plan.tex", Some("Bob Smith")),
            written("d4", chapters.clone(), "plan.tex", None),
            written("e5", chapters.clone(), "plan.tex", Some("  Dr. <Who>?  ")),
            written("f6", chapters.clone(), "plan.tex", Some("CON")),
            written("g7", chapters.clone(), "notes", Some("Alice Chen")),
            written("h8", chapters.clone(), "notes", Some("Erin Quinn")),
            written("i9", chapters, "plan.tex", Some(&"N".repeat(300))),
        ];
        let placed = layout(&nodes);
        assert_eq!(placed["a1"].path, "chapters/plan.tex");
        assert_eq!(placed["b2"].path, "chapters/plan (from Bob Smith).tex");
        assert_eq!(placed["c3"].path, "chapters/Plan (from Bob Smith 2).tex");
        assert_eq!(placed["d4"].path, "chapters/plan (d4).tex");
        assert_eq!(placed["e5"].path, "chapters/plan (from Dr. Who).tex");
        assert_eq!(placed["f6"].path, "chapters/plan (from CON).tex");
        assert_eq!(placed["g7"].path, "chapters/notes");
        assert_eq!(placed["h8"].path, "chapters/notes (from Erin Quinn)");
        assert_eq!(
            placed["i9"].path,
            format!("chapters/plan (from {}).tex", "N".repeat(40))
        );
        let clashed: Vec<String> = clashes(&nodes).into_iter().map(|clash| clash.id).collect();
        assert_eq!(clashed, ["h8", "b2", "c3", "d4", "e5", "f6", "i9"]);
    }

    #[test]
    fn a_credited_name_never_takes_a_name_another_file_already_has() {
        let nodes = vec![
            figure("a1", NodeParent::Root, "plot.png", "h1", "Alice"),
            figure("b2", NodeParent::Root, "plot.png", "h2", "Bob"),
            figure("c3", NodeParent::Root, "plot (from Bob).png", "h3", "Carol"),
        ];
        let placed = layout(&nodes);
        assert_eq!(placed["a1"].path, "plot.png");
        assert_eq!(placed["b2"].path, "plot (from Bob 2).png");
        assert_eq!(placed["c3"].path, "plot (from Bob).png");
    }

    #[test]
    fn clashes_name_the_original_name_and_the_file_that_kept_it() {
        let nodes = vec![
            node("a1", NodeParent::Root, "Main.tex", NodeKind::Text),
            node("b2", NodeParent::Root, "main.tex", NodeKind::Text),
            figure("c3", NodeParent::Root, "plot.png", "h1", "Alice"),
            figure("d4", NodeParent::Root, "plot.png", "h2", "Bob"),
            node("x9", NodeParent::Root, ".oleafly", NodeKind::Dir),
            node("t1", NodeParent::Trash, "main.tex", NodeKind::Text),
        ];
        assert_eq!(
            clashes(&nodes),
            vec![
                Clash {
                    id: "b2".to_owned(),
                    name: "main.tex".to_owned(),
                    other: "a1".to_owned(),
                },
                Clash {
                    id: "d4".to_owned(),
                    name: "plot.png".to_owned(),
                    other: "c3".to_owned(),
                },
            ]
        );
    }

    #[test]
    fn only_identical_figures_with_the_same_name_in_one_folder_are_duplicates() {
        let figs = NodeParent::Node("d1".into());
        let nodes = vec![
            node("d1", NodeParent::Root, "figs", NodeKind::Dir),
            figure("a1", figs.clone(), "plot.png", "same", "Alice"),
            figure("b2", figs.clone(), "PLOT.png", "same", "Bob"),
            figure("c3", figs.clone(), "plot.png", "other", "Bob"),
            figure("d4", figs.clone(), "copy.png", "same", "Bob"),
            figure("e5", NodeParent::Root, "plot.png", "same", "Bob"),
            figure("f6", NodeParent::Trash, "plot.png", "same", "Bob"),
            node("t1", figs.clone(), "plot.png", NodeKind::Text),
        ];
        assert_eq!(duplicate_blobs(&nodes), vec!["b2".to_owned()]);
    }

    #[test]
    fn nested_files_get_paths_and_the_trash_is_left_out() {
        let nodes = vec![
            node("d1", NodeParent::Root, "chapters", NodeKind::Dir),
            node(
                "t1",
                NodeParent::Node("d1".into()),
                "intro.tex",
                NodeKind::Text,
            ),
            node("t2", NodeParent::Root, "main.tex", NodeKind::Text),
            node("t3", NodeParent::Trash, "old.tex", NodeKind::Text),
        ];
        let placed = layout(&nodes);
        assert_eq!(placed["d1"].path, "chapters");
        assert_eq!(placed["t1"].path, "chapters/intro.tex");
        assert_eq!(placed["t2"].path, "main.tex");
        assert!(!placed.contains_key("t3"));
    }

    #[test]
    fn a_node_whose_parent_is_a_file_is_laid_out_at_the_top() {
        let nodes = vec![
            node("t1", NodeParent::Root, "main.tex", NodeKind::Text),
            node(
                "t2",
                NodeParent::Node("t1".into()),
                "child.tex",
                NodeKind::Text,
            ),
            node("d1", NodeParent::Root, "figs", NodeKind::Dir),
            node(
                "t3",
                NodeParent::Node("d1".into()),
                "plot.tex",
                NodeKind::Text,
            ),
            node(
                "t4",
                NodeParent::Node("t1".into()),
                "main.tex",
                NodeKind::Text,
            ),
            node("t5", NodeParent::Trash, "old.tex", NodeKind::Text),
            node(
                "t6",
                NodeParent::Node("t5".into()),
                "under-old.tex",
                NodeKind::Text,
            ),
        ];
        let placed = layout(&nodes);
        assert_eq!(placed["t1"].path, "main.tex");
        assert_eq!(placed["t2"].path, "child.tex");
        assert_eq!(placed["t3"].path, "figs/plot.tex");
        assert_eq!(placed["t4"].path, "main (t4).tex");
        assert_eq!(placed["t6"].path, "under-old.tex");
        assert!(!placed.contains_key("t5"));
        assert!(placed
            .values()
            .all(|placed| !placed.path.starts_with("main.tex/")));
    }

    #[test]
    fn names_that_clash_by_case_get_a_suffix() {
        let nodes = vec![
            node("a1", NodeParent::Root, "Main.tex", NodeKind::Text),
            node("b2", NodeParent::Root, "main.tex", NodeKind::Text),
        ];
        let placed = layout(&nodes);
        assert_eq!(placed["a1"].path, "Main.tex");
        assert_eq!(placed["b2"].path, "main (b2).tex");
    }

    #[test]
    fn names_that_differ_only_in_unicode_form_get_a_suffix() {
        let nodes = vec![
            node(
                "a1",
                NodeParent::Root,
                "Gr\u{f6}\u{df}e.png",
                NodeKind::Text,
            ),
            node(
                "b2",
                NodeParent::Root,
                "Gro\u{308}\u{df}e.png",
                NodeKind::Text,
            ),
            node("c3", NodeParent::Root, "CAF\u{c9}", NodeKind::Dir),
            node("d4", NodeParent::Root, "cafe\u{301}", NodeKind::Dir),
        ];
        let placed = layout(&nodes);
        assert_eq!(placed["a1"].path, "Gr\u{f6}\u{df}e.png");
        assert_eq!(placed["b2"].path, "Gro\u{308}\u{df}e (b2).png");
        assert_eq!(placed["c3"].path, "CAF\u{c9}");
        assert_eq!(placed["d4"].path, "cafe\u{301} (d4)");
        let clashed: Vec<String> = clashes(&nodes).into_iter().map(|clash| clash.id).collect();
        assert_eq!(clashed, ["d4", "b2"]);
    }

    #[test]
    fn unsafe_and_reserved_names_never_reach_the_disk() {
        for bad in [
            "..",
            "a/b",
            "c:\\x",
            "",
            "CON.txt",
            "name.",
            ".GIT",
            ".Oleafly",
            "GIT~1",
            "draft~2.tex",
        ] {
            assert!(
                safe_name(bad, "0123456789").starts_with("unnamed-"),
                "{bad}"
            );
        }
        let nodes = vec![
            node("x1", NodeParent::Root, ".oleafly", NodeKind::Dir),
            node(
                "x2",
                NodeParent::Node("missing".into()),
                "orphan.tex",
                NodeKind::Text,
            ),
        ];
        let placed = layout(&nodes);
        assert_eq!(placed["x1"].path, "unnamed-x1");
        assert_eq!(placed["x2"].path, "orphan.tex");
    }

    #[test]
    fn a_plan_moves_removes_and_writes_what_changed() {
        let before = layout(&[
            node("d1", NodeParent::Root, "figs", NodeKind::Dir),
            node("t1", NodeParent::Root, "main.tex", NodeKind::Text),
            node("t2", NodeParent::Root, "old.tex", NodeKind::Text),
        ]);
        let after = layout(&[
            node("d1", NodeParent::Root, "figures", NodeKind::Dir),
            node("t1", NodeParent::Root, "thesis.tex", NodeKind::Text),
            node(
                "t3",
                NodeParent::Node("d1".into()),
                "new.tex",
                NodeKind::Text,
            ),
        ]);
        let disk = plan(&before, &after);
        assert_eq!(disk.removed, vec!["old.tex".to_owned()]);
        assert!(disk
            .moved
            .contains(&("figs".to_owned(), "figures".to_owned())));
        assert!(disk
            .moved
            .contains(&("main.tex".to_owned(), "thesis.tex".to_owned())));
        assert_eq!(disk.written, vec!["t3".to_owned()]);
    }
}
