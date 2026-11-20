use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

use oleafly_ot::TextOperation;

use super::{Notice, Phase, State};
use crate::live::doc::OverleafDoc;
use crate::live::rest::Uploaded;
use crate::live::session::DocStopReason;
use crate::live::tree_queue::{QueueState, Queued, TreeChange, TreeFailure, TreeRefusal};
use crate::live::DocId;
use crate::realtime::events::{EntityId, TreeEvent};
use crate::realtime::tree::{NodeKind, PathChange};

#[derive(Default)]
pub(super) struct TreeWork {
    queue: Vec<Queued>,
    dirty: bool,
    to_fill: BTreeSet<String>,
    kept: BTreeMap<EntityId, String>,
    reported: Option<Vec<Queued>>,
}

impl TreeWork {
    pub(super) fn is_dirty(&self) -> bool {
        self.dirty
    }

    pub(super) fn take_dirty(&mut self) -> Option<Vec<Queued>> {
        std::mem::take(&mut self.dirty).then(|| self.queue.clone())
    }

    pub(super) fn mark_dirty(&mut self) {
        self.dirty = true;
    }

    pub(super) fn has_waiting(&self) -> bool {
        self.queue.iter().any(Queued::is_waiting)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::live::session) struct Job {
    pub(in crate::live::session) change: TreeChange,
    pub(in crate::live::session) entity: Option<EntityId>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::live::session) enum Finished {
    Done,
    Dropped,
    Failed(TreeFailure),
}

pub(in crate::live::session) fn parent_of(path: &str) -> Option<&str> {
    path.rsplit_once('/').map(|(parent, _)| parent)
}

pub(in crate::live::session) fn name_of(path: &str) -> &str {
    path.rsplit_once('/').map_or(path, |(_, name)| name)
}

fn inside(path: &str, folder: &str) -> bool {
    path == folder || path.starts_with(&format!("{folder}/"))
}

fn creates(change: &TreeChange) -> bool {
    matches!(
        change,
        TreeChange::NewDoc { .. } | TreeChange::NewFolder { .. } | TreeChange::Upload { .. }
    )
}

impl State {
    pub(super) fn take_tree_queue(&mut self, queue: &[Queued]) {
        self.tree_work.queue = queue.to_vec();
        self.relay_tree();
    }

    pub(super) fn relay_tree(&mut self) {
        let laid: Vec<(EntityId, TreeChange)> = self
            .tree_work
            .queue
            .iter()
            .filter_map(|queued| {
                let entity = EntityId(queued.entity.clone()?);
                Some((entity, queued.change.clone()))
            })
            .collect();
        for (entity, change) in laid {
            match change {
                TreeChange::Move { to, .. } => self.lay_move(&entity, &to),
                TreeChange::Delete { .. } => {
                    let changes = self.project.tree.hide(&entity);
                    self.local_tree_changed(changes);
                }
                _ => {}
            }
        }
        self.sync_kept_away();
    }

    fn lay_move(&mut self, entity: &EntityId, to: &str) {
        let Some(parent) = self.folder_at(parent_of(to)) else {
            return;
        };
        let changes = self.project.tree.place(entity, &parent, name_of(to));
        self.local_tree_changed(changes);
    }

    fn local_tree_changed(&mut self, changes: Vec<PathChange>) {
        self.tree_followed(&changes);
        if !changes.is_empty() {
            self.notices.push(Notice::Tree(changes));
        }
    }

    pub(super) fn tree_followed(&mut self, changes: &[PathChange]) {
        for change in changes {
            let added = match change {
                PathChange::Added {
                    id,
                    path,
                    kind: NodeKind::Doc,
                }
                | PathChange::Replaced {
                    new: id,
                    path,
                    to: NodeKind::Doc,
                    ..
                } => Some((DocId(id.0.clone()), path.clone())),
                _ => None,
            };
            if let Some((doc, path)) = added {
                if self.tree_work.to_fill.remove(&path) {
                    self.fill(&doc, &path);
                }
            }
        }
        self.sync_kept_away();
    }

    fn fill(&mut self, doc: &DocId, path: &str) {
        let Some(text) = self.port.disk_text(path).filter(|text| !text.is_empty()) else {
            return;
        };
        let slot = self.slots.entry(doc.clone()).or_default();
        if slot.doc.is_some() || slot.phase != Phase::Unjoined {
            return;
        }
        slot.doc = Some(OverleafDoc::provisional(doc.clone(), String::new()));
        let mut op = TextOperation::new();
        op.insert(&text);
        let _ = self.take_local(doc, op, Some(String::new()));
    }

    fn sync_kept_away(&mut self) {
        let tree = &self.project.tree;
        let mut kept: BTreeMap<EntityId, String> = self
            .tree_work
            .kept
            .keys()
            .filter_map(|id| Some((id.clone(), tree.server_path_of(id)?)))
            .collect();
        let mut hidden: Vec<EntityId> = kept
            .keys()
            .filter(|id| !tree.is_local(id))
            .cloned()
            .collect();
        let mut waiting = Vec::new();
        for path in &self.manifest.kept_away {
            if self.tree_work.kept.values().any(|known| known == path) {
                continue;
            }
            match tree.id_at(path) {
                Some(id) => {
                    kept.insert(id.clone(), path.clone());
                    hidden.push(id.clone());
                }
                None => waiting.push(path.clone()),
            }
        }
        let mut paths: Vec<String> = kept.values().cloned().chain(waiting).collect();
        paths.sort();
        paths.dedup();
        self.tree_work.kept = kept;
        if paths != self.manifest.kept_away {
            self.manifest.kept_away = paths;
            self.manifest_dirty = true;
        }
        for id in hidden {
            self.quiet_stop(&id);
            let changes = self.project.tree.hide(&id);
            if !changes.is_empty() {
                self.notices.push(Notice::Tree(changes));
            }
        }
    }

    fn quiet_stop(&mut self, entity: &EntityId) {
        let Some(top) = self.project.tree.server_path_of(entity) else {
            return;
        };
        let docs: Vec<DocId> = self
            .slots
            .keys()
            .filter(|doc| {
                self.project
                    .tree
                    .server_path_of(&EntityId::from(*doc))
                    .is_some_and(|path| inside(&path, &top))
            })
            .cloned()
            .collect();
        for doc in docs {
            let Some(slot) = self.slots.get_mut(&doc) else {
                continue;
            };
            slot.doc = None;
            slot.resume = None;
            slot.held = None;
            slot.buffer.clear();
            slot.phase = Phase::Stopped;
            slot.dirty = true;
            self.notices
                .push(Notice::Stopped(doc.clone(), DocStopReason::Removed));
        }
    }

    pub(super) fn forget_tree_queue(&mut self) {
        if !self.tree_work.queue.is_empty() {
            self.tree_work.queue.clear();
            self.report_queue();
        }
    }

    fn report_queue(&mut self) {
        self.tree_work.dirty = true;
        if self.tree_work.reported.as_ref() != Some(&self.tree_work.queue) {
            self.tree_work.reported = Some(self.tree_work.queue.clone());
            self.notices
                .push(Notice::Queue(self.tree_work.queue.clone()));
        }
    }

    pub(in crate::live::session) fn folder_at(&self, path: Option<&str>) -> Option<EntityId> {
        let tree = &self.project.tree;
        match path.filter(|path| !path.is_empty()) {
            None => tree.root().cloned(),
            Some(path) => tree
                .id_at(path)
                .filter(|id| {
                    tree.node(id)
                        .is_some_and(|node| node.kind == NodeKind::Folder)
                })
                .cloned(),
        }
    }

    pub(in crate::live::session) fn entity_at(&self, path: &str) -> Option<(EntityId, NodeKind)> {
        let id = self.project.tree.id_at(path)?.clone();
        let kind = self.project.tree.node(&id)?.kind;
        Some((id, kind))
    }

    pub(in crate::live::session) fn server_place(
        &self,
        entity: &EntityId,
    ) -> Option<(NodeKind, Option<EntityId>, String)> {
        let node = self.project.tree.server_node(entity)?;
        Some((node.kind, node.parent.clone(), node.name.clone()))
    }

    pub(in crate::live::session) fn change_tree(
        &mut self,
        change: TreeChange,
    ) -> Result<(), TreeRefusal> {
        if self.ended.is_some() {
            return Err(TreeRefusal::Ended);
        }
        if !self.project.role.can_edit() {
            return Err(TreeRefusal::NotAllowed);
        }
        let refused = match &change {
            TreeChange::Move { from, to } => {
                self.port.never_online(from) || self.port.never_online(to)
            }
            other => self.port.never_online(other.path()),
        };
        if refused {
            return Err(TreeRefusal::NeverOnline);
        }
        match change {
            TreeChange::Move { from, to } => self.queue_move(from, to)?,
            TreeChange::Delete { path } => self.queue_delete(path)?,
            created => self.queue_create(created),
        }
        self.report_queue();
        Ok(())
    }

    fn queue_create(&mut self, change: TreeChange) {
        let path = change.path().to_string();
        self.tree_work
            .queue
            .retain(|queued| !(creates(&queued.change) && queued.change.path() == path));
        self.tree_work.queue.push(Queued {
            change,
            state: QueueState::Waiting,
            entity: None,
        });
    }

    fn queue_move(&mut self, from: String, to: String) -> Result<(), TreeRefusal> {
        let unsent = self.tree_work.queue.iter_mut().find(|queued| {
            creates(&queued.change) && queued.is_waiting() && queued.change.path() == from
        });
        if let Some(queued) = unsent {
            queued.change = match &queued.change {
                TreeChange::NewDoc { .. } => TreeChange::NewDoc { path: to },
                TreeChange::NewFolder { .. } => TreeChange::NewFolder { path: to },
                _ => TreeChange::Upload { path: to },
            };
            return Ok(());
        }
        let (entity, _) = self.entity_at(&from).ok_or(TreeRefusal::Unknown)?;
        let earlier = self.tree_work.queue.iter().position(|queued| {
            queued.is_waiting()
                && queued.entity.as_deref() == Some(entity.0.as_str())
                && matches!(queued.change, TreeChange::Move { .. })
        });
        let from = match earlier {
            Some(at) => match self.tree_work.queue.remove(at).change {
                TreeChange::Move { from, .. } => from,
                _ => from,
            },
            None => from,
        };
        self.lay_move(&entity, &to);
        self.tree_work.queue.push(Queued {
            change: TreeChange::Move { from, to },
            state: QueueState::Waiting,
            entity: Some(entity.0),
        });
        Ok(())
    }

    fn queue_delete(&mut self, path: String) -> Result<(), TreeRefusal> {
        let before = self.tree_work.queue.len();
        self.tree_work.queue.retain(|queued| {
            !(creates(&queued.change) && queued.is_waiting() && inside(queued.change.path(), &path))
        });
        let dropped = before != self.tree_work.queue.len();
        let Some((entity, _)) = self.entity_at(&path) else {
            return if dropped {
                Ok(())
            } else {
                Err(TreeRefusal::Unknown)
            };
        };
        self.tree_work.queue.retain(|queued| {
            !(queued.is_waiting()
                && matches!(&queued.change, TreeChange::Move { to, .. } if inside(to, &path)))
        });
        let changes = self.project.tree.hide(&entity);
        self.local_tree_changed(changes);
        self.tree_work.queue.push(Queued {
            change: TreeChange::Delete { path },
            state: QueueState::Waiting,
            entity: Some(entity.0),
        });
        Ok(())
    }

    pub(in crate::live::session) fn keep_away(&mut self, path: &str) -> Result<(), TreeRefusal> {
        let (entity, _) = self.entity_at(path).ok_or(TreeRefusal::Unknown)?;
        let server = self
            .project
            .tree
            .server_path_of(&entity)
            .unwrap_or_else(|| path.to_string());
        self.quiet_stop(&entity);
        self.tree_work.kept.insert(entity.clone(), server);
        let changes = self.project.tree.hide(&entity);
        self.local_tree_changed(changes);
        Ok(())
    }

    #[cfg(any(test, feature = "test-support"))]
    pub(in crate::live::session) fn kept_away(&self) -> Vec<String> {
        self.manifest.kept_away.clone()
    }

    pub(in crate::live::session) fn tree_queue(&self) -> Vec<Queued> {
        self.tree_work.queue.clone()
    }

    pub(in crate::live::session) fn retry_tree(&mut self, path: Option<&str>) {
        for queued in &mut self.tree_work.queue {
            if !queued.is_waiting() && path.is_none_or(|path| queued.change.touches(path)) {
                queued.state = QueueState::Waiting;
            }
        }
        self.report_queue();
    }

    pub(in crate::live::session) fn dismiss_tree(&mut self, path: &str) {
        let (dismissed, kept): (Vec<Queued>, Vec<Queued>) =
            std::mem::take(&mut self.tree_work.queue)
                .into_iter()
                .partition(|queued| !queued.is_waiting() && queued.change.touches(path));
        self.tree_work.queue = kept;
        for queued in dismissed {
            if let Some(entity) = queued.entity {
                let changes = self.project.tree.clear_local(&EntityId(entity));
                self.local_tree_changed(changes);
            }
        }
        self.report_queue();
    }

    pub(in crate::live::session) fn next_tree_job(&self) -> Option<Job> {
        if self.ended.is_some() || !self.online {
            return None;
        }
        let queued = self
            .tree_work
            .queue
            .iter()
            .find(|queued| queued.is_waiting())?;
        Some(Job {
            change: queued.change.clone(),
            entity: queued.entity.clone().map(EntityId),
        })
    }

    pub(in crate::live::session) fn finish_tree_job(&mut self, job: &Job, finished: Finished) {
        let at = self.tree_work.queue.iter().position(|queued| {
            queued.is_waiting()
                && queued.change == job.change
                && queued.entity.as_deref() == job.entity.as_ref().map(|entity| entity.0.as_str())
        });
        let Some(at) = at else {
            return;
        };
        if let (TreeChange::NewDoc { path }, Finished::Failed(_) | Finished::Dropped) =
            (&job.change, &finished)
        {
            self.tree_work.to_fill.remove(path);
        }
        let dropped = finished == Finished::Dropped;
        match finished {
            Finished::Done | Finished::Dropped => {
                let queued = self.tree_work.queue.remove(at);
                if dropped {
                    if let Some(entity) = queued.entity {
                        let changes = self.project.tree.clear_local(&EntityId(entity));
                        self.local_tree_changed(changes);
                    }
                }
            }
            Finished::Failed(failure) => {
                self.tree_work.queue[at].state = QueueState::Failed { failure };
            }
        }
        self.report_queue();
    }

    pub(in crate::live::session) fn tree_event(&mut self, event: &TreeEvent) {
        let changes = self.project.tree.apply(event, Instant::now());
        let arrived: Vec<DocId> = changes
            .iter()
            .filter_map(|change| match change {
                PathChange::Added {
                    id,
                    path,
                    kind: NodeKind::Doc,
                }
                | PathChange::Replaced {
                    new: id,
                    path,
                    to: NodeKind::Doc,
                    ..
                } if !self.tree_work.to_fill.contains(path) => Some(DocId(id.0.clone())),
                _ => None,
            })
            .collect();
        self.tree_changed(changes);
        for doc in arrived {
            self.want(&doc);
        }
    }

    pub(in crate::live::session) fn landed(&mut self, event: &TreeEvent) {
        let changes = self.project.tree.apply(event, Instant::now());
        self.tree_changed(changes);
    }

    pub(in crate::live::session) fn expect_fill(&mut self, path: &str) {
        self.tree_work.to_fill.insert(path.to_string());
    }

    pub(in crate::live::session) fn settled_under(&self, entity: &EntityId) -> bool {
        let Some(top) = self.project.tree.server_path_of(entity) else {
            return true;
        };
        self.slots.iter().all(|(doc, slot)| {
            !slot.unconfirmed()
                || !self
                    .project
                    .tree
                    .server_path_of(&EntityId::from(doc))
                    .is_some_and(|path| inside(&path, &top))
        })
    }

    pub(in crate::live::session) fn deleted(&mut self, entity: &EntityId) {
        self.quiet_stop(entity);
        self.landed(&TreeEvent::Removed {
            id: entity.clone(),
            converting: false,
        });
    }

    pub(in crate::live::session) fn moved(
        &mut self,
        entity: &EntityId,
        parent: &EntityId,
        name: &str,
    ) {
        self.landed(&TreeEvent::Moved {
            id: entity.clone(),
            folder: parent.clone(),
        });
        self.landed(&TreeEvent::Renamed {
            id: entity.clone(),
            name: name.to_string(),
        });
        let changes = self.project.tree.clear_local(entity);
        self.local_tree_changed(changes);
    }

    pub(in crate::live::session) fn uploaded(
        &mut self,
        path: &str,
        folder: &EntityId,
        uploaded: Uploaded,
        tag: &str,
    ) {
        if let Some((old, _)) = self.entity_at(path).filter(|(old, _)| *old != uploaded.id) {
            self.landed(&TreeEvent::Removed {
                id: old,
                converting: false,
            });
        }
        let name = name_of(path).to_string();
        let event = match uploaded.kind {
            NodeKind::Doc => TreeEvent::NewDoc {
                folder: folder.clone(),
                id: uploaded.id,
                name,
            },
            _ => TreeEvent::NewFile {
                folder: folder.clone(),
                id: uploaded.id,
                name,
                hash: uploaded.hash.clone(),
                converted: false,
            },
        };
        self.landed(&event);
        self.notices.push(Notice::Uploaded {
            path: path.to_string(),
            tag: tag.to_string(),
            hash: uploaded.hash,
        });
    }
}
