pub mod doc;
pub mod format;
#[cfg(test)]
mod harness;
pub mod history_ot;
#[cfg(test)]
mod tests;

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
    Hold,
}
