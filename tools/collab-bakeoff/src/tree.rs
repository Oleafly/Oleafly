use std::collections::{BTreeMap, BTreeSet};

use crate::engine::{EngineError, NodeKind, NodeView, Parent};
use crate::fractional;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Materialized {
    pub files: BTreeMap<String, String>,
    pub dirs: BTreeSet<String>,
    pub trash: BTreeMap<String, String>,
    pub repaired: usize,
}

pub fn fold_name(name: &str) -> String {
    name.to_lowercase()
}

pub fn materialize(
    nodes: &[NodeView],
    text_of: &dyn Fn(&str) -> Result<String, EngineError>,
) -> Result<Materialized, EngineError> {
    let by_id: BTreeMap<String, NodeView> = nodes
        .iter()
        .map(|node| (node.id.clone(), node.clone()))
        .collect();
    let (parents, repaired) = effective_parents(&by_id);
    let names = disk_names(&by_id, &parents);
    let mut result = Materialized {
        repaired,
        ..Materialized::default()
    };
    for (id, node) in &by_id {
        if in_trash(&parents, id) {
            if node.kind == NodeKind::Text {
                result.trash.insert(id.clone(), text_of(id)?);
            }
            continue;
        }
        let Some(path) = path_of(id, &parents, &names) else {
            continue;
        };
        match node.kind {
            NodeKind::Dir => {
                result.dirs.insert(path);
            }
            NodeKind::Text => {
                result.files.insert(path, text_of(id)?);
            }
            NodeKind::Blob => {
                let hash = node.blob_hash.as_deref().unwrap_or_default();
                result.files.insert(path, format!("blob:{hash}"));
            }
        }
    }
    Ok(result)
}

fn effective_parents(by_id: &BTreeMap<String, NodeView>) -> (BTreeMap<String, Parent>, usize) {
    let mut repaired = 0;
    let mut parents = BTreeMap::new();
    for (id, node) in by_id {
        let parent = match &node.parent {
            Parent::Node(parent) if !by_id.contains_key(parent) => {
                repaired += 1;
                Parent::Root
            }
            other => other.clone(),
        };
        parents.insert(id.clone(), parent);
    }
    while let Some(victim) = find_cycle(&parents) {
        parents.insert(victim, Parent::Root);
        repaired += 1;
    }
    (parents, repaired)
}

fn find_cycle(parents: &BTreeMap<String, Parent>) -> Option<String> {
    for start in parents.keys() {
        let mut path: Vec<&str> = Vec::new();
        let mut current = start.as_str();
        loop {
            if let Some(index) = path.iter().position(|seen| *seen == current) {
                return path[index..].iter().min().map(|id| (*id).to_owned());
            }
            path.push(current);
            match parents.get(current) {
                Some(Parent::Node(parent)) => current = parent.as_str(),
                _ => break,
            }
        }
    }
    None
}

fn in_trash(parents: &BTreeMap<String, Parent>, id: &str) -> bool {
    let mut current = id;
    for _ in 0..=parents.len() {
        match parents.get(current) {
            Some(Parent::Trash) => return true,
            Some(Parent::Node(parent)) => current = parent.as_str(),
            _ => return false,
        }
    }
    false
}

fn disk_names(
    by_id: &BTreeMap<String, NodeView>,
    parents: &BTreeMap<String, Parent>,
) -> BTreeMap<String, Option<String>> {
    let mut groups: BTreeMap<(Parent, String), Vec<&NodeView>> = BTreeMap::new();
    for (id, node) in by_id {
        let parent = parents.get(id).cloned().unwrap_or(Parent::Root);
        groups
            .entry((parent, fold_name(&node.name)))
            .or_default()
            .push(node);
    }
    let mut names = BTreeMap::new();
    for members in groups.values_mut() {
        members.sort_by(|left, right| {
            left.position
                .cmp(&right.position)
                .then_with(|| left.id.cmp(&right.id))
        });
        let Some(first) = members.first().copied() else {
            continue;
        };
        for (index, node) in members.iter().enumerate() {
            let name = if index == 0 {
                Some(node.name.clone())
            } else if node.kind == NodeKind::Blob
                && first.kind == NodeKind::Blob
                && node.blob_hash == first.blob_hash
            {
                None
            } else {
                Some(suffixed(&node.name, &node.id))
            };
            names.insert(node.id.clone(), name);
        }
    }
    names
}

fn suffixed(name: &str, id: &str) -> String {
    match name.rfind('.') {
        Some(dot) if dot > 0 => format!("{} ({id}){}", &name[..dot], &name[dot..]),
        _ => format!("{name} ({id})"),
    }
}

fn path_of(
    id: &str,
    parents: &BTreeMap<String, Parent>,
    names: &BTreeMap<String, Option<String>>,
) -> Option<String> {
    let mut segments = Vec::new();
    let mut current = id.to_owned();
    for _ in 0..=parents.len() {
        segments.push(names.get(&current)?.clone()?);
        match parents.get(&current) {
            Some(Parent::Node(parent)) => current = parent.clone(),
            _ => {
                segments.reverse();
                return Some(segments.join("/"));
            }
        }
    }
    None
}

pub fn would_cycle(nodes: &[NodeView], id: &str, new_parent: &str) -> bool {
    let parents: BTreeMap<&str, &Parent> = nodes
        .iter()
        .map(|node| (node.id.as_str(), &node.parent))
        .collect();
    let mut current = new_parent;
    for _ in 0..=nodes.len() {
        if current == id {
            return true;
        }
        match parents.get(current) {
            Some(Parent::Node(parent)) => current = parent.as_str(),
            _ => return false,
        }
    }
    true
}

pub fn next_position(nodes: &[NodeView], parent: &Parent) -> String {
    let last = nodes
        .iter()
        .filter(|node| node.parent == *parent)
        .map(|node| node.position.as_str())
        .max()
        .unwrap_or("");
    fractional::after(last)
}
