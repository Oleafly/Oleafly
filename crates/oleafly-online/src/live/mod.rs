pub mod doc;
pub mod format;
#[cfg(test)]
mod harness;
pub mod history_ot;
#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct PublicId(pub String);

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct DocId(pub String);

#[derive(Clone, Debug, PartialEq)]
pub struct AppliedUpdate {
    pub doc: DocId,
    pub v: u64,
    pub op: Option<Value>,
    pub source: Option<PublicId>,
    pub user_id: Option<String>,
    pub tc: Option<String>,
    pub dup: bool,
}

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

impl AppliedUpdate {
    pub fn from_value(update: &Value, doc: Option<&DocId>) -> Option<AppliedUpdate> {
        let doc = text(update, "doc").map(DocId).or_else(|| doc.cloned())?;
        let meta = update.get("meta").unwrap_or(&Value::Null);
        Some(AppliedUpdate {
            doc,
            v: update.get("v")?.as_u64()?,
            op: update.get("op").filter(|op| !op.is_null()).cloned(),
            source: text(meta, "source").map(PublicId),
            user_id: text(meta, "user_id"),
            tc: text(meta, "tc"),
            dup: update.get("dup").and_then(Value::as_bool).unwrap_or(false),
        })
    }
}

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
