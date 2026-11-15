pub mod doc;
pub mod format;
#[cfg(test)]
mod harness;
pub mod history_ot;
pub mod join;
pub mod journal;
pub mod presence;
pub mod session;
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
