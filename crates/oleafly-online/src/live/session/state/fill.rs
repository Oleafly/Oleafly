use std::collections::BTreeSet;
use std::time::Duration;

use super::{Notice, Phase, State};
use crate::live::DocId;
use crate::realtime::events::EntityId;
use crate::realtime::tree::NodeKind;

pub(in crate::live::session) struct Filling {
    docs: BTreeSet<DocId>,
    told: Option<(usize, usize)>,
}

impl State {
    pub(in crate::live::session) fn start_fill(&mut self, batch: usize, every: Duration) {
        let docs: BTreeSet<DocId> = self
            .project
            .tree
            .nodes()
            .into_iter()
            .filter(|node| node.kind == NodeKind::Doc)
            .map(|node| DocId(node.id.0))
            .collect();
        if let Some(root) = self
            .project
            .root_doc
            .clone()
            .filter(|root| docs.contains(root))
        {
            self.want(&root);
        }
        self.pace_all(batch, every);
        let told = self.filling.as_ref().and_then(|filling| filling.told);
        self.filling = Some(Filling { docs, told });
    }

    pub(in crate::live::session) fn filled(&self) -> bool {
        self.filled
    }

    fn has_text(&self, doc: &DocId) -> bool {
        self.project.tree.node(&EntityId::from(doc)).is_none()
            || self.slots.get(doc).is_some_and(|slot| {
                matches!(slot.phase, Phase::Joined | Phase::Held | Phase::Stopped)
            })
    }

    pub(in crate::live::session) fn report_fill(&mut self) {
        let Some(filling) = self.filling.as_ref() else {
            return;
        };
        let total = filling.docs.len();
        let done = filling.docs.iter().filter(|doc| self.has_text(doc)).count();
        let now = Some((done, total));
        if filling.told != now {
            self.notices.push(Notice::Filling(done, total));
        }
        if done >= total {
            self.filling = None;
            self.filled = true;
        } else if let Some(filling) = self.filling.as_mut() {
            filling.told = now;
        }
    }
}
