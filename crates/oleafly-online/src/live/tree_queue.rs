use serde::{Deserialize, Serialize};

pub const MAX_DOC_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_UPLOAD_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum TreeChange {
    NewDoc { path: String },
    NewFolder { path: String },
    Upload { path: String },
    Move { from: String, to: String },
    Delete { path: String },
}

impl TreeChange {
    pub fn path(&self) -> &str {
        match self {
            TreeChange::NewDoc { path }
            | TreeChange::NewFolder { path }
            | TreeChange::Upload { path }
            | TreeChange::Delete { path } => path,
            TreeChange::Move { to, .. } => to,
        }
    }

    pub fn touches(&self, path: &str) -> bool {
        match self {
            TreeChange::Move { from, to } => from == path || to == path,
            other => other.path() == path,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "detail", rename_all = "snake_case")]
pub enum TreeFailure {
    Refused(String),
    TooLarge,
    NotAllowed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum QueueState {
    Waiting,
    Failed { failure: TreeFailure },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Queued {
    pub change: TreeChange,
    pub state: QueueState,
    #[serde(default)]
    pub entity: Option<String>,
}

impl Queued {
    pub fn is_waiting(&self) -> bool {
        self.state == QueueState::Waiting
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum TreeRefusal {
    #[error("the project is no longer live")]
    Ended,
    #[error("you can't change files in this project")]
    NotAllowed,
    #[error("this file never goes online")]
    NeverOnline,
    #[error("nothing on the server matches that path")]
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalFile {
    pub bytes: Vec<u8>,
    pub tag: String,
}

pub fn stays_a_file(text: &str) -> bool {
    text.len() > MAX_DOC_BYTES || text.contains('\0')
}
