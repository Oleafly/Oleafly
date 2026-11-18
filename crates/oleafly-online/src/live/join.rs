use serde_json::Value;

use super::format::{CodecError, DocFormat, FormatState, SHAREJS_TYPE};
use super::{AppliedUpdate, DocId};

const MISSING_OPS: &str = "doc updater could not load requested ops";

#[derive(Clone, Debug, PartialEq)]
pub struct JoinedDoc {
    pub version: u64,
    pub text: String,
    pub format: FormatState,
    pub updates: Vec<AppliedUpdate>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JoinFailure {
    MissingOps,
    Refused(String),
    Codec(CodecError),
}

fn refusal(error: &Value) -> JoinFailure {
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .or_else(|| error.as_str())
        .unwrap_or("joinDoc failed");
    if message == MISSING_OPS {
        JoinFailure::MissingOps
    } else {
        JoinFailure::Refused(message.to_string())
    }
}

pub fn parse_join(doc: &DocId, reply: &[Value]) -> Result<JoinedDoc, JoinFailure> {
    if let Some(error) = reply.first().filter(|error| !error.is_null()) {
        return Err(refusal(error));
    }
    let null = Value::Null;
    let field = |index: usize| reply.get(index).unwrap_or(&null);
    let kind = field(5).as_str().unwrap_or(SHAREJS_TYPE);
    let format = DocFormat::from_join_type(kind).map_err(JoinFailure::Codec)?;
    let (text, format) =
        FormatState::from_join(format, field(1), field(4)).map_err(JoinFailure::Codec)?;
    let updates = field(3)
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|update| AppliedUpdate::from_value(update, Some(doc)))
        .collect();
    Ok(JoinedDoc {
        version: field(2).as_u64().unwrap_or_default(),
        text,
        format,
        updates,
    })
}
