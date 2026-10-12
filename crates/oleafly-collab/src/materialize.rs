use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

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

pub fn safe_name(name: &str, id: &str) -> String {
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let unsafe_name = name.is_empty()
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

fn fold(name: &str) -> String {
    name.to_lowercase()
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

fn in_trash(parents: &BTreeMap<&str, &NodeParent>, id: &str) -> bool {
    let mut current = id;
    for _ in 0..=parents.len() {
        match parents.get(current) {
            Some(NodeParent::Trash) => return true,
            Some(NodeParent::Node(parent)) => current = parent.as_str(),
            _ => return false,
        }
    }
    true
}

pub fn layout(nodes: &[FileNode]) -> Layout {
    let by_id: BTreeMap<&str, &FileNode> =
        nodes.iter().map(|node| (node.id.as_str(), node)).collect();
    let parents: BTreeMap<&str, &NodeParent> = nodes
        .iter()
        .map(|node| (node.id.as_str(), &node.parent))
        .collect();
    let mut groups: BTreeMap<(NodeParent, String), Vec<&FileNode>> = BTreeMap::new();
    for node in nodes {
        if in_trash(&parents, &node.id) {
            continue;
        }
        let parent = match &node.parent {
            NodeParent::Node(parent) if !by_id.contains_key(parent.as_str()) => NodeParent::Root,
            other => other.clone(),
        };
        let name = safe_name(&node.name, &node.id);
        groups.entry((parent, fold(&name))).or_default().push(node);
    }
    let mut names: BTreeMap<&str, String> = BTreeMap::new();
    for ((parent, folded), members) in groups.iter_mut() {
        members.sort_by(|left, right| {
            left.position
                .cmp(&right.position)
                .then_with(|| left.id.cmp(&right.id))
        });
        let reserved = *parent == NodeParent::Root
            && RESERVED_TOP
                .iter()
                .any(|reserved| fold(reserved) == *folded);
        for (index, node) in members.iter().enumerate() {
            let name = safe_name(&node.name, &node.id);
            let name = if index == 0 && !reserved {
                name
            } else {
                suffixed(&name, &node.id)
            };
            names.insert(node.id.as_str(), name);
        }
    }
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
            Some(NodeParent::Node(parent)) if by_id.contains_key(parent.as_str()) => {
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
        }
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
    fn unsafe_and_reserved_names_never_reach_the_disk() {
        for bad in ["..", "a/b", "c:\\x", "", "CON.txt", "name."] {
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
        assert_eq!(placed["x1"].path, ".oleafly (x1)");
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
