pub mod doc;
pub mod format;
#[cfg(test)]
mod harness;
pub mod history_ot;
pub mod join;
pub mod journal;
pub mod presence;
pub mod rest;
pub mod session;
#[cfg(test)]
mod tests;
pub mod tree_queue;

use crate::realtime::events::{AppliedUpdate, DocId, PublicId};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tracking {
    pub user_id: String,
    pub ts: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SendMode {
    Edit,
    Suggest(Tracking),
    Review(Tracking),
    Hold,
}

impl SendMode {
    pub fn tracking(&self) -> Option<&Tracking> {
        match self {
            SendMode::Suggest(tracking) | SendMode::Review(tracking) => Some(tracking),
            SendMode::Edit | SendMode::Hold => None,
        }
    }

    pub fn may_edit(&self) -> bool {
        matches!(self, SendMode::Edit | SendMode::Suggest(_))
    }
}
