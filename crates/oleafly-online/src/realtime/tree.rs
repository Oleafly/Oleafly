use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use serde_json::Value;

use super::events::{EntityId, TreeEvent};
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

#[derive(Clone, Debug, Default)]
pub struct OverleafTree {
    root: Option<EntityId>,
    nodes: BTreeMap<EntityId, OverleafNode>,
    pending: Vec<Pending>,
}

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

impl OverleafTree {
    pub fn from_root_folder(root_folder: &Value) -> Option<OverleafTree> {
        let root = root_folder.as_array()?.first()?;
        let mut tree = OverleafTree::default();
        let id = EntityId(text(root, "_id")?);
        tree.root = Some(id.clone());
        tree.read_folder(root, id, None)?;
        Some(tree)
    }

    fn read_folder(
        &mut self,
        folder: &Value,
        id: EntityId,
        parent: Option<EntityId>,
    ) -> Option<()> {
        self.nodes.insert(
            id.clone(),
            OverleafNode {
                id: id.clone(),
                name: text(folder, "name").unwrap_or_default(),
                parent,
                kind: NodeKind::Folder,
                hash: None,
            },
        );
        let entries = |key: &str| {
            folder
                .get(key)
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        };
        for (key, kind) in [("docs", NodeKind::Doc), ("fileRefs", NodeKind::File)] {
            for entry in entries(key) {
                let child = EntityId(text(&entry, "_id")?);
                self.nodes.insert(
                    child.clone(),
                    OverleafNode {
                        id: child,
                        name: text(&entry, "name")?,
                        parent: Some(id.clone()),
                        kind,
                        hash: text(&entry, "hash"),
                    },
                );
            }
        }
        for child in entries("folders") {
            let child_id = EntityId(text(&child, "_id")?);
            self.read_folder(&child, child_id, Some(id.clone()))?;
        }
        Some(())
    }

    pub fn root(&self) -> Option<&EntityId> {
        self.root.as_ref()
    }

    pub fn node(&self, id: &EntityId) -> Option<&OverleafNode> {
        self.nodes.get(id)
    }

    pub fn path_of(&self, id: &EntityId) -> Option<String> {
        let mut parts = Vec::new();
        let mut at = self.nodes.get(id)?;
        let mut steps = 0;
        while Some(&at.id) != self.root.as_ref() {
            parts.push(at.name.as_str());
            at = self.nodes.get(at.parent.as_ref()?)?;
            steps += 1;
            if steps > self.nodes.len() {
                return None;
            }
        }
        parts.reverse();
        Some(parts.join("/"))
    }

    pub fn id_at(&self, path: &str) -> Option<&EntityId> {
        self.nodes.keys().find(|id| {
            Some(&**id) != self.root.as_ref() && self.path_of(id).as_deref() == Some(path)
        })
    }

    pub fn nodes(&self) -> Vec<OverleafNode> {
        let mut nodes: Vec<(String, OverleafNode)> = self
            .nodes
            .values()
            .filter(|node| Some(&node.id) != self.root.as_ref())
            .filter_map(|node| Some((self.path_of(&node.id)?, node.clone())))
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

    fn below(&self, id: &EntityId) -> Vec<EntityId> {
        let mut found = vec![id.clone()];
        let mut index = 0;
        while index < found.len() {
            let parent = found[index].clone();
            found.extend(
                self.nodes
                    .values()
                    .filter(|node| node.parent.as_ref() == Some(&parent))
                    .map(|node| node.id.clone()),
            );
            index += 1;
        }
        found
    }

    fn located(&self, ids: &[EntityId]) -> Vec<(EntityId, String, NodeKind)> {
        let mut located: Vec<(EntityId, String, NodeKind)> = ids
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
                if !self.is_folder(folder) || self.below(id).contains(folder) {
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
        self.nodes.insert(
            id.clone(),
            OverleafNode {
                id: id.clone(),
                name: name.to_string(),
                parent: Some(folder.clone()),
                kind,
                hash,
            },
        );
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
        if let Some(node) = self.nodes.get_mut(id) {
            change(node);
        }
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
        let gone = self.located(&self.below(id));
        for (removed, _, _) in &gone {
            self.nodes.remove(removed);
        }
        let mut gone = gone.into_iter();
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

    pub fn repair(&mut self, fresh: OverleafTree) -> Vec<PathChange> {
        let mut flushed = self.flush();
        let before: BTreeMap<EntityId, (String, NodeKind)> = self.located_all();
        let after: BTreeMap<EntityId, (String, NodeKind)> = fresh.located_all();
        let mut removed: Vec<(EntityId, String, NodeKind)> = before
            .iter()
            .filter(|(id, _)| !after.contains_key(*id))
            .map(|(id, (path, kind))| (id.clone(), path.clone(), *kind))
            .collect();
        let mut added: Vec<(EntityId, String, NodeKind)> = after
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
        flushed.extend(
            removed
                .into_iter()
                .map(|(id, path, kind)| PathChange::Removed { id, path, kind }),
        );
        flushed.append(&mut moved);
        flushed.append(&mut replaced);
        flushed.extend(added.into_iter().map(|(id, path, kind)| PathChange::Added {
            id,
            path,
            kind,
        }));
        *self = fresh;
        flushed
    }

    fn located_all(&self) -> BTreeMap<EntityId, (String, NodeKind)> {
        self.nodes
            .values()
            .filter(|node| Some(&node.id) != self.root.as_ref())
            .filter_map(|node| Some((node.id.clone(), (self.path_of(&node.id)?, node.kind))))
            .collect()
    }
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
