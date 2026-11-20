#[cfg(test)]
mod tests;

use std::collections::{BTreeMap, BTreeSet};
use std::time::{Duration, Instant};

use serde_json::Value;

use super::events::{plain, EntityId, TreeEvent};
use crate::error::OnlineError;
use crate::sync::check_remote_paths_on;

pub const REPLACE_WINDOW: Duration = Duration::from_secs(1);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum NodeKind {
    Doc,
    File,
    Folder,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OverleafNode {
    pub id: EntityId,
    pub name: String,
    pub parent: Option<EntityId>,
    pub kind: NodeKind,
    pub hash: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PathChange {
    Added {
        id: EntityId,
        path: String,
        kind: NodeKind,
    },
    Moved {
        id: EntityId,
        from: String,
        to: String,
        kind: NodeKind,
    },
    Removed {
        id: EntityId,
        path: String,
        kind: NodeKind,
    },
    Replaced {
        old: EntityId,
        new: EntityId,
        path: String,
        from: NodeKind,
        to: NodeKind,
    },
}

#[derive(Clone, Debug)]
struct Pending {
    at: Instant,
    id: EntityId,
    path: String,
    kind: NodeKind,
    inside: Vec<PathChange>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Local {
    Placed { parent: EntityId, name: String },
    Hidden,
}

type Located = (EntityId, String, NodeKind);

#[derive(Clone, Debug, Default)]
pub struct OverleafTree {
    root: Option<EntityId>,
    nodes: BTreeMap<EntityId, OverleafNode>,
    pending: Vec<Pending>,
    local: BTreeMap<EntityId, Local>,
    children: BTreeMap<EntityId, BTreeSet<EntityId>>,
    placed: BTreeMap<EntityId, BTreeSet<EntityId>>,
    named: BTreeMap<EntityId, BTreeMap<String, BTreeSet<EntityId>>>,
}

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn entity_of(entry: &Value) -> Option<EntityId> {
    text(entry, "_id").and_then(plain).map(EntityId)
}

fn take_out<K: Ord>(map: &mut BTreeMap<K, BTreeSet<EntityId>>, key: &K, id: &EntityId) {
    if let Some(ids) = map.get_mut(key) {
        ids.remove(id);
        if ids.is_empty() {
            map.remove(key);
        }
    }
}

impl OverleafTree {
    pub fn from_root_folder(root_folder: &Value) -> Option<OverleafTree> {
        let root = root_folder.as_array()?.first()?;
        let mut tree = OverleafTree::default();
        let id = entity_of(root)?;
        tree.root = Some(id.clone());
        tree.read_folder(root, id, None);
        Some(tree)
    }

    fn read_folder(&mut self, folder: &Value, id: EntityId, parent: Option<EntityId>) {
        self.insert_node(OverleafNode {
            id: id.clone(),
            name: text(folder, "name").unwrap_or_default(),
            parent,
            kind: NodeKind::Folder,
            hash: None,
        });
        let entries = |key: &str| {
            folder
                .get(key)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        };
        for (key, kind) in [("docs", NodeKind::Doc), ("fileRefs", NodeKind::File)] {
            for entry in entries(key) {
                let (Some(child), Some(name)) = (entity_of(entry), text(entry, "name")) else {
                    continue;
                };
                self.insert_node(OverleafNode {
                    id: child,
                    name,
                    parent: Some(id.clone()),
                    kind,
                    hash: text(entry, "hash"),
                });
            }
        }
        for child in entries("folders") {
            if let Some(child_id) = entity_of(child) {
                self.read_folder(child, child_id, Some(id.clone()));
            }
        }
    }

    fn index(&mut self, id: &EntityId) {
        let Some(node) = self.nodes.get(id) else {
            return;
        };
        let server = node.parent.clone();
        let shown = self.shown(node);
        if let Some(parent) = server {
            self.children.entry(parent).or_default().insert(id.clone());
        }
        if let Some(Local::Placed { parent, .. }) = self.local.get(id) {
            self.placed
                .entry(parent.clone())
                .or_default()
                .insert(id.clone());
        }
        if let Some((Some(parent), name)) = shown {
            self.named
                .entry(parent)
                .or_default()
                .entry(name)
                .or_default()
                .insert(id.clone());
        }
    }

    fn unindex(&mut self, id: &EntityId) {
        let Some(node) = self.nodes.get(id) else {
            return;
        };
        let server = node.parent.clone();
        let shown = self.shown(node);
        if let Some(parent) = server {
            take_out(&mut self.children, &parent, id);
        }
        if let Some(Local::Placed { parent, .. }) = self.local.get(id) {
            let parent = parent.clone();
            take_out(&mut self.placed, &parent, id);
        }
        if let Some((Some(parent), name)) = shown {
            if let Some(names) = self.named.get_mut(&parent) {
                take_out(names, &name, id);
                if names.is_empty() {
                    self.named.remove(&parent);
                }
            }
        }
    }

    fn reindex(&mut self) {
        self.children.clear();
        self.placed.clear();
        self.named.clear();
        let ids: Vec<EntityId> = self.nodes.keys().cloned().collect();
        for id in &ids {
            self.index(id);
        }
    }

    fn insert_node(&mut self, node: OverleafNode) {
        let id = node.id.clone();
        self.unindex(&id);
        self.nodes.insert(id.clone(), node);
        self.index(&id);
    }

    fn change_node(&mut self, id: &EntityId, change: impl FnOnce(&mut OverleafNode)) {
        self.unindex(id);
        if let Some(node) = self.nodes.get_mut(id) {
            change(node);
        }
        self.index(id);
    }

    fn remove_node(&mut self, id: &EntityId) {
        self.unindex(id);
        self.nodes.remove(id);
        self.local.remove(id);
    }

    fn set_local(&mut self, id: &EntityId, local: Option<Local>) {
        self.unindex(id);
        match local {
            Some(local) => {
                self.local.insert(id.clone(), local);
            }
            None => {
                self.local.remove(id);
            }
        }
        self.index(id);
    }

    pub fn root(&self) -> Option<&EntityId> {
        self.root.as_ref()
    }

    fn shown(&self, node: &OverleafNode) -> Option<(Option<EntityId>, String)> {
        match self.local.get(&node.id) {
            Some(Local::Hidden) => None,
            Some(Local::Placed { parent, name }) => Some((Some(parent.clone()), name.clone())),
            None => Some((node.parent.clone(), node.name.clone())),
        }
    }

    pub fn node(&self, id: &EntityId) -> Option<OverleafNode> {
        let node = self.nodes.get(id)?;
        self.path_of(id)?;
        let (parent, name) = self.shown(node)?;
        Some(OverleafNode {
            parent,
            name,
            ..node.clone()
        })
    }

    fn walk(
        &self,
        id: &EntityId,
        shown: impl Fn(&OverleafNode) -> Option<(Option<EntityId>, String)>,
    ) -> Option<String> {
        let mut parts = Vec::new();
        let mut at = self.nodes.get(id)?;
        let mut steps = 0;
        while Some(&at.id) != self.root.as_ref() {
            let (parent, name) = shown(at)?;
            parts.push(name);
            at = self.nodes.get(parent.as_ref()?)?;
            steps += 1;
            if steps > self.nodes.len() {
                return None;
            }
        }
        parts.reverse();
        Some(parts.join("/"))
    }

    pub fn path_of(&self, id: &EntityId) -> Option<String> {
        self.walk(id, |node| self.shown(node))
    }

    pub fn server_path_of(&self, id: &EntityId) -> Option<String> {
        self.walk(id, |node| Some((node.parent.clone(), node.name.clone())))
    }

    pub fn server_node(&self, id: &EntityId) -> Option<&OverleafNode> {
        self.nodes.get(id)
    }

    pub fn is_local(&self, id: &EntityId) -> bool {
        self.local.contains_key(id)
    }

    pub fn place(&mut self, id: &EntityId, parent: &EntityId, name: &str) -> Vec<PathChange> {
        if Some(id) == self.root.as_ref()
            || !self.nodes.contains_key(id)
            || !self.is_folder(parent)
            || self.below(id).contains(parent)
        {
            return Vec::new();
        }
        let moving = self.below(id);
        let before = self.located(&moving);
        let same = self
            .nodes
            .get(id)
            .is_some_and(|node| node.parent.as_ref() == Some(parent) && node.name == name);
        let placed = (!same).then(|| Local::Placed {
            parent: parent.clone(),
            name: name.to_string(),
        });
        self.set_local(id, placed);
        let after = self.located(&moving);
        changes_between(before, after)
    }

    pub fn hide(&mut self, id: &EntityId) -> Vec<PathChange> {
        if Some(id) == self.root.as_ref() || !self.nodes.contains_key(id) {
            return Vec::new();
        }
        let before = self.located(&self.below(id));
        self.set_local(id, Some(Local::Hidden));
        changes_between(before, Vec::new())
    }

    pub fn clear_local(&mut self, id: &EntityId) -> Vec<PathChange> {
        if !self.local.contains_key(id) {
            return Vec::new();
        }
        let before = self.located(&self.below(id));
        self.set_local(id, None);
        let after = self.located(&self.below(id));
        changes_between(before, after)
    }

    pub fn id_at(&self, path: &str) -> Option<&EntityId> {
        let root = self.root.as_ref()?;
        let mut found: Option<&EntityId> = None;
        let mut waiting = vec![(root, 0)];
        while let Some((folder, from)) = waiting.pop() {
            let Some(names) = self.named.get(folder) else {
                continue;
            };
            let rest = &path[from..];
            let named = |name: &str| {
                names
                    .get(name)
                    .into_iter()
                    .flatten()
                    .filter(|id| *id != root)
            };
            if let Some(id) = named(rest).next() {
                found = Some(found.map_or(id, |known| known.min(id)));
            }
            for (at, _) in rest.match_indices('/') {
                waiting.extend(named(&rest[..at]).map(|id| (id, from + at + 1)));
            }
        }
        found
    }

    pub fn nodes(&self) -> Vec<OverleafNode> {
        let mut nodes: Vec<(String, OverleafNode)> = self
            .nodes
            .keys()
            .filter(|id| Some(*id) != self.root.as_ref())
            .filter_map(|id| Some((self.path_of(id)?, self.node(id)?)))
            .collect();
        nodes.sort_by(|left, right| left.0.cmp(&right.0));
        nodes.into_iter().map(|(_, node)| node).collect()
    }

    pub fn paths(&self) -> Vec<String> {
        let mut paths: Vec<String> = self
            .nodes
            .values()
            .filter(|node| node.kind != NodeKind::Folder)
            .filter_map(|node| self.path_of(&node.id))
            .collect();
        paths.sort();
        paths
    }

    pub fn paths_report(&self) -> Result<(), OnlineError> {
        check_remote_paths_on(&self.paths(), true)
    }

    fn children_in(&self, parent: &EntityId, server: bool) -> BTreeSet<EntityId> {
        let mut children: BTreeSet<EntityId> = self
            .children
            .get(parent)
            .into_iter()
            .flatten()
            .filter(|child| server || !matches!(self.local.get(*child), Some(Local::Placed { .. })))
            .cloned()
            .collect();
        if !server {
            children.extend(self.placed.get(parent).into_iter().flatten().cloned());
        }
        children
    }

    fn below_in(&self, id: &EntityId, server: bool) -> Vec<EntityId> {
        let mut found = vec![id.clone()];
        let mut seen = BTreeSet::from([id.clone()]);
        let mut index = 0;
        while index < found.len() {
            for child in self.children_in(&found[index], server) {
                if seen.insert(child.clone()) {
                    found.push(child);
                }
            }
            index += 1;
        }
        found
    }

    fn below(&self, id: &EntityId) -> Vec<EntityId> {
        self.below_in(id, false)
    }

    fn located(&self, ids: &[EntityId]) -> Vec<Located> {
        let mut located: Vec<Located> = ids
            .iter()
            .filter_map(|id| Some((id.clone(), self.path_of(id)?, self.nodes.get(id)?.kind)))
            .collect();
        located.sort_by(|left, right| left.1.cmp(&right.1));
        located
    }

    fn is_folder(&self, id: &EntityId) -> bool {
        self.nodes
            .get(id)
            .is_some_and(|node| node.kind == NodeKind::Folder)
    }

    pub fn next_due(&self) -> Option<Instant> {
        self.pending
            .iter()
            .map(|pending| pending.at + REPLACE_WINDOW)
            .min()
    }

    pub fn due(&mut self, now: Instant) -> Vec<PathChange> {
        let (due, waiting): (Vec<Pending>, Vec<Pending>) = std::mem::take(&mut self.pending)
            .into_iter()
            .partition(|pending| now.duration_since(pending.at) >= REPLACE_WINDOW);
        self.pending = waiting;
        due.into_iter().flat_map(Pending::into_removals).collect()
    }

    pub fn flush(&mut self) -> Vec<PathChange> {
        std::mem::take(&mut self.pending)
            .into_iter()
            .flat_map(Pending::into_removals)
            .collect()
    }

    pub fn apply(&mut self, event: &TreeEvent, now: Instant) -> Vec<PathChange> {
        let mut changes = self.due(now);
        changes.extend(match event {
            TreeEvent::NewDoc { folder, id, name } => {
                self.add(folder, id, name, NodeKind::Doc, None)
            }
            TreeEvent::NewFile {
                folder,
                id,
                name,
                hash,
                ..
            } => self.add(folder, id, name, NodeKind::File, hash.clone()),
            TreeEvent::NewFolder { folder, id, name } => {
                self.add(folder, id, name, NodeKind::Folder, None)
            }
            TreeEvent::Renamed { id, name } => self.relocate(id, |node| node.name.clone_from(name)),
            TreeEvent::Moved { id, folder } => {
                if !self.is_folder(folder) || self.below_in(id, true).contains(folder) {
                    Vec::new()
                } else {
                    self.relocate(id, |node| node.parent = Some(folder.clone()))
                }
            }
            TreeEvent::Removed { id, .. } => {
                self.remove(id, now);
                Vec::new()
            }
        });
        changes
    }

    fn add(
        &mut self,
        folder: &EntityId,
        id: &EntityId,
        name: &str,
        kind: NodeKind,
        hash: Option<String>,
    ) -> Vec<PathChange> {
        if self.nodes.contains_key(id) || !self.is_folder(folder) {
            return Vec::new();
        }
        self.insert_node(OverleafNode {
            id: id.clone(),
            name: name.to_string(),
            parent: Some(folder.clone()),
            kind,
            hash,
        });
        let Some(path) = self.path_of(id) else {
            return Vec::new();
        };
        match self.pending.iter().position(|pending| pending.path == path) {
            Some(at) => {
                let replaced = self.pending.remove(at);
                let mut changes = replaced.inside;
                changes.push(PathChange::Replaced {
                    old: replaced.id,
                    new: id.clone(),
                    path,
                    from: replaced.kind,
                    to: kind,
                });
                changes
            }
            None => vec![PathChange::Added {
                id: id.clone(),
                path,
                kind,
            }],
        }
    }

    fn relocate(
        &mut self,
        id: &EntityId,
        change: impl FnOnce(&mut OverleafNode),
    ) -> Vec<PathChange> {
        if Some(id) == self.root.as_ref() || !self.nodes.contains_key(id) {
            return Vec::new();
        }
        let moving = self.below(id);
        let before = self.located(&moving);
        self.change_node(id, change);
        before
            .into_iter()
            .filter_map(|(moved, from, kind)| {
                let to = self.path_of(&moved)?;
                (to != from).then_some(PathChange::Moved {
                    id: moved,
                    from,
                    to,
                    kind,
                })
            })
            .collect()
    }

    fn remove(&mut self, id: &EntityId, now: Instant) {
        if Some(id) == self.root.as_ref() || !self.nodes.contains_key(id) {
            return;
        }
        let removed = self.below_in(id, true);
        let mut affected = self.below(id);
        let shown: BTreeSet<EntityId> = affected.iter().cloned().collect();
        affected.extend(
            removed
                .iter()
                .filter(|entity| !shown.contains(*entity))
                .cloned(),
        );
        let gone = self.located(&affected);
        for entity in &removed {
            self.remove_node(entity);
        }
        let mut gone = gone
            .into_iter()
            .filter(|(entity, _, _)| self.path_of(entity).is_none());
        let Some((id, path, kind)) = gone.next() else {
            return;
        };
        self.pending.push(Pending {
            at: now,
            id,
            path,
            kind,
            inside: gone
                .map(|(id, path, kind)| PathChange::Removed { id, path, kind })
                .collect(),
        });
    }

    pub fn repair(&mut self, mut fresh: OverleafTree) -> Vec<PathChange> {
        let mut flushed = self.flush();
        let before = self.located_all();
        fresh.local = std::mem::take(&mut self.local);
        fresh.local.retain(|id, local| {
            fresh.nodes.contains_key(id)
                && match local {
                    Local::Placed { parent, .. } => fresh
                        .nodes
                        .get(parent)
                        .is_some_and(|node| node.kind == NodeKind::Folder),
                    Local::Hidden => true,
                }
        });
        fresh.reindex();
        let after = fresh.located_all();
        flushed.extend(changes_between(before, after));
        *self = fresh;
        flushed
    }

    fn located_all(&self) -> Vec<Located> {
        let ids: Vec<EntityId> = self
            .nodes
            .keys()
            .filter(|id| Some(*id) != self.root.as_ref())
            .cloned()
            .collect();
        self.located(&ids)
    }
}

fn changes_between(before: Vec<Located>, after: Vec<Located>) -> Vec<PathChange> {
    let before: BTreeMap<EntityId, (String, NodeKind)> = before
        .into_iter()
        .map(|(id, path, kind)| (id, (path, kind)))
        .collect();
    let after: BTreeMap<EntityId, (String, NodeKind)> = after
        .into_iter()
        .map(|(id, path, kind)| (id, (path, kind)))
        .collect();
    let mut removed: Vec<Located> = before
        .iter()
        .filter(|(id, _)| !after.contains_key(*id))
        .map(|(id, (path, kind))| (id.clone(), path.clone(), *kind))
        .collect();
    let mut added: Vec<Located> = after
        .iter()
        .filter(|(id, _)| !before.contains_key(*id))
        .map(|(id, (path, kind))| (id.clone(), path.clone(), *kind))
        .collect();
    let mut moved: Vec<PathChange> = after
        .iter()
        .filter_map(|(id, (to, kind))| {
            let (from, _) = before.get(id)?;
            (from != to).then(|| PathChange::Moved {
                id: id.clone(),
                from: from.clone(),
                to: to.clone(),
                kind: *kind,
            })
        })
        .collect();
    let mut replaced = Vec::new();
    removed.retain(
        |(old, path, from)| match added.iter().position(|(_, at, _)| at == path) {
            Some(index) => {
                let (new, _, to) = added.remove(index);
                replaced.push(PathChange::Replaced {
                    old: old.clone(),
                    new,
                    path: path.clone(),
                    from: *from,
                    to,
                });
                false
            }
            None => true,
        },
    );
    removed.sort_by(|left, right| left.1.cmp(&right.1));
    added.sort_by(|left, right| left.1.cmp(&right.1));
    moved.sort_by(|left, right| path_key(left).cmp(path_key(right)));
    let mut changes: Vec<PathChange> = removed
        .into_iter()
        .map(|(id, path, kind)| PathChange::Removed { id, path, kind })
        .collect();
    changes.append(&mut moved);
    changes.append(&mut replaced);
    changes.extend(
        added
            .into_iter()
            .map(|(id, path, kind)| PathChange::Added { id, path, kind }),
    );
    changes
}

fn path_key(change: &PathChange) -> &str {
    match change {
        PathChange::Added { path, .. }
        | PathChange::Removed { path, .. }
        | PathChange::Replaced { path, .. } => path,
        PathChange::Moved { to, .. } => to,
    }
}

impl Pending {
    fn into_removals(self) -> Vec<PathChange> {
        let mut changes = vec![PathChange::Removed {
            id: self.id,
            path: self.path,
            kind: self.kind,
        }];
        changes.extend(self.inside);
        changes
    }
}
