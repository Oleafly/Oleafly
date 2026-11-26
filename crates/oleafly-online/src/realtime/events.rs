use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::tree::LinkedSource;

const FORCE_DISCONNECT_DELAY: Duration = Duration::from_secs(10);
pub(crate) const LONGEST_SERVER_WAIT: Duration = Duration::from_secs(300);
const LONGEST_ID: usize = 128;

pub fn plain_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= LONGEST_ID && id.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

pub(crate) fn plain(id: String) -> Option<String> {
    plain_id(&id).then_some(id)
}

fn server_wait(seconds: f64) -> Option<Duration> {
    (seconds >= 0.0).then(|| {
        Duration::try_from_secs_f64(seconds)
            .map_or(LONGEST_SERVER_WAIT, |wait| wait.min(LONGEST_SERVER_WAIT))
    })
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct PublicId(pub String);

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct DocId(pub String);

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct EntityId(pub String);

impl std::fmt::Display for PublicId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::fmt::Display for DocId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::fmt::Display for EntityId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<&DocId> for EntityId {
    fn from(doc: &DocId) -> EntityId {
        EntityId(doc.0.clone())
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct AppliedUpdate {
    pub doc: DocId,
    pub v: u64,
    pub op: Option<Value>,
    pub source: Option<PublicId>,
    pub user_id: Option<String>,
    pub tc: Option<String>,
    pub ts: Option<i64>,
    pub dup: bool,
    pub external: bool,
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let month_index = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn digits(text: &str, range: std::ops::Range<usize>) -> Option<i64> {
    let part = text.get(range)?;
    part.bytes()
        .all(|byte| byte.is_ascii_digit())
        .then(|| part.parse().ok())
        .flatten()
}

pub fn iso_ms(text: &str) -> Option<i64> {
    let text = text.trim();
    let bytes = text.as_bytes();
    if bytes.len() < 20
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !matches!(bytes[10], b'T' | b't' | b' ')
        || bytes[13] != b':'
        || bytes[16] != b':'
        || !matches!(bytes.last(), Some(b'Z' | b'z'))
    {
        return None;
    }
    let (year, month, day) = (
        digits(text, 0..4)?,
        digits(text, 5..7)?,
        digits(text, 8..10)?,
    );
    let (hour, minute, second) = (
        digits(text, 11..13)?,
        digits(text, 14..16)?,
        digits(text, 17..19)?,
    );
    let fraction = &text[19..text.len() - 1];
    let millis = match fraction.strip_prefix('.') {
        None if fraction.is_empty() => 0,
        Some(decimals) if !decimals.is_empty() && decimals.bytes().all(|b| b.is_ascii_digit()) => {
            format!("{decimals:0<3}")[..3].parse::<i64>().ok()?
        }
        _ => return None,
    };
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    let seconds = days_from_civil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second;
    seconds.checked_mul(1_000)?.checked_add(millis)
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    (year_of_era + era * 400 + i64::from(month <= 2), month, day)
}

pub fn iso_time(ms: i64) -> String {
    let seconds = ms.div_euclid(1_000);
    let (year, month, day) = civil_from_days(seconds.div_euclid(86_400));
    let in_day = seconds.rem_euclid(86_400);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        in_day / 3_600,
        in_day / 60 % 60,
        in_day % 60,
        ms.rem_euclid(1_000)
    )
}

pub fn stamp_ms(value: &Value) -> Option<i64> {
    match value {
        Value::Number(number) => number.as_i64().or_else(|| {
            number
                .as_f64()
                .filter(|ms| ms.is_finite())
                .map(|ms| ms as i64)
        }),
        Value::String(text) => iso_ms(text),
        _ => None,
    }
}

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn id_text(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::to_string)
        .or_else(|| text(value, "_id"))
        .or_else(|| text(value, "id"))
        .and_then(plain)
}

fn doc_text(value: &Value, key: &str) -> Option<DocId> {
    text(value, key).and_then(plain).map(DocId)
}

impl AppliedUpdate {
    pub fn from_value(update: &Value, doc: Option<&DocId>) -> Option<AppliedUpdate> {
        let doc = match text(update, "doc") {
            Some(named) => DocId(plain(named)?),
            None => doc.cloned()?,
        };
        let meta = update.get("meta").unwrap_or(&Value::Null);
        Some(AppliedUpdate {
            doc,
            v: update.get("v")?.as_u64()?,
            op: update.get("op").filter(|op| !op.is_null()).cloned(),
            source: text(meta, "source").map(PublicId),
            user_id: text(meta, "user_id"),
            tc: text(meta, "tc"),
            ts: meta.get("ts").and_then(stamp_ms),
            dup: update.get("dup").and_then(Value::as_bool).unwrap_or(false),
            external: meta.get("type").and_then(Value::as_str) == Some("external"),
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PeerPosition {
    pub id: PublicId,
    pub user_id: Option<String>,
    pub name: Option<String>,
    pub email: Option<String>,
    pub doc: Option<DocId>,
    pub row: Option<u64>,
    pub column: Option<u64>,
}

impl PeerPosition {
    pub fn connected_users(reply: &[Value]) -> Vec<PeerPosition> {
        reply
            .get(1)
            .and_then(Value::as_array)
            .map(|users| users.iter().filter_map(PeerPosition::from_user).collect())
            .unwrap_or_default()
    }

    fn from_user(user: &Value) -> Option<PeerPosition> {
        let name = [text(user, "first_name"), text(user, "last_name")]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" ");
        let cursor = user.get("cursorData");
        Some(PeerPosition {
            id: PublicId(text(user, "client_id")?),
            user_id: text(user, "user_id"),
            name: Some(name.trim().to_string()).filter(|name| !name.is_empty()),
            email: text(user, "email"),
            doc: cursor.and_then(|cursor| doc_text(cursor, "doc_id")),
            row: cursor
                .and_then(|cursor| cursor.get("row"))
                .and_then(Value::as_u64),
            column: cursor
                .and_then(|cursor| cursor.get("column"))
                .and_then(Value::as_u64),
        })
    }

    fn from_value(value: &Value) -> Option<PeerPosition> {
        Some(PeerPosition {
            id: PublicId(text(value, "id")?),
            user_id: text(value, "user_id"),
            name: text(value, "name"),
            email: text(value, "email"),
            doc: doc_text(value, "doc_id"),
            row: value.get("row").and_then(Value::as_u64),
            column: value.get("column").and_then(Value::as_u64),
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TreeEvent {
    NewDoc {
        folder: EntityId,
        id: EntityId,
        name: String,
    },
    NewFile {
        folder: EntityId,
        id: EntityId,
        name: String,
        hash: Option<String>,
        converted: bool,
        linked: Option<Box<LinkedSource>>,
    },
    NewFolder {
        folder: EntityId,
        id: EntityId,
        name: String,
    },
    Renamed {
        id: EntityId,
        name: String,
    },
    Moved {
        id: EntityId,
        folder: EntityId,
    },
    Removed {
        id: EntityId,
        restoring: bool,
    },
}

const CONVERT_DOC_TO_FILE: &str = "convertDocToFile";
const RESTORE_KINDS: [&str; 2] = ["file-restore", "project-restore"];

impl TreeEvent {
    fn from_wire(name: &str, args: &[Value]) -> Option<TreeEvent> {
        let arg = |at: usize| args.get(at).unwrap_or(&Value::Null);
        let entity = |at: usize| id_text(arg(at)).map(EntityId);
        let named = |at: usize| text(arg(at), "name");
        Some(match name {
            "reciveNewDoc" => TreeEvent::NewDoc {
                folder: entity(0)?,
                id: entity(1)?,
                name: named(1)?,
            },
            "reciveNewFile" => TreeEvent::NewFile {
                folder: entity(0)?,
                id: entity(1)?,
                name: named(1)?,
                hash: text(arg(1), "hash"),
                converted: arg(2).as_str() == Some(CONVERT_DOC_TO_FILE),
                linked: LinkedSource::from_value(arg(3))
                    .or_else(|| {
                        arg(1)
                            .get("linkedFileData")
                            .and_then(LinkedSource::from_value)
                    })
                    .map(Box::new),
            },
            "reciveNewFolder" => TreeEvent::NewFolder {
                folder: entity(0)?,
                id: entity(1)?,
                name: named(1)?,
            },
            "reciveEntityRename" => TreeEvent::Renamed {
                id: entity(0)?,
                name: arg(1).as_str()?.to_string(),
            },
            "reciveEntityMove" => TreeEvent::Moved {
                id: entity(0)?,
                folder: entity(1)?,
            },
            "removeEntity" => TreeEvent::Removed {
                id: entity(0)?,
                restoring: arg(1)
                    .get("kind")
                    .and_then(Value::as_str)
                    .is_some_and(|kind| RESTORE_KINDS.contains(&kind)),
            },
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProjectEvent {
    RootDoc(DocId),
    Compiler(String),
    Image(String),
    SpellLanguage(String),
    MainBibliography(DocId),
    Name(String),
    DeletedOrRenamedExternally,
}

impl ProjectEvent {
    fn from_wire(name: &str, args: &[Value]) -> Option<ProjectEvent> {
        let first = || args.first().and_then(Value::as_str).map(str::to_string);
        let doc = || first().and_then(plain).map(DocId);
        Some(match name {
            "rootDocUpdated" => ProjectEvent::RootDoc(doc()?),
            "compilerUpdated" => ProjectEvent::Compiler(
                first()
                    .map(|compiler| compiler.trim().to_ascii_lowercase())
                    .filter(|compiler| !compiler.is_empty())?,
            ),
            "imageNameUpdated" => ProjectEvent::Image(first()?),
            "spellCheckLanguageUpdated" => ProjectEvent::SpellLanguage(first()?),
            "mainBibliographyDocUpdated" => ProjectEvent::MainBibliography(doc()?),
            "projectNameUpdated" => ProjectEvent::Name(first()?),
            "projectRenamedOrDeletedByExternalSource" => ProjectEvent::DeletedOrRenamedExternally,
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum AccessEvent {
    MembersChanged { members: bool, invites: bool },
    AccessLevelChanged { user_id: Option<String> },
    PublicAccessChanged(Option<String>),
    Revoked,
    UserRemoved(Option<String>),
    TrackChanges(Value),
}

impl AccessEvent {
    fn from_wire(name: &str, args: &[Value]) -> Option<AccessEvent> {
        let first = args.first().unwrap_or(&Value::Null);
        Some(match name {
            "project:membership:changed" => {
                let flag = |key: &str| first.get(key).and_then(Value::as_bool) == Some(true);
                let known = ["members", "invites", "accessRequests"]
                    .iter()
                    .any(|key| first.get(*key).is_some());
                AccessEvent::MembersChanged {
                    members: flag("members") || !known,
                    invites: flag("invites"),
                }
            }
            "project:collaboratorAccessLevel:changed" => AccessEvent::AccessLevelChanged {
                user_id: text(first, "userId"),
            },
            "project:publicAccessLevel:changed" => {
                AccessEvent::PublicAccessChanged(text(first, "newAccessLevel"))
            }
            "project:access:revoked" => AccessEvent::Revoked,
            "userRemovedFromProject" => {
                AccessEvent::UserRemoved(first.as_str().map(str::to_string))
            }
            "toggle-track-changes" => AccessEvent::TrackChanges(first.clone()),
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReviewUser {
    pub id: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub email: Option<String>,
}

impl ReviewUser {
    pub fn from_value(value: &Value) -> Option<ReviewUser> {
        let named = |key: &str| text(value, key).filter(|name| !name.trim().is_empty());
        Some(ReviewUser {
            id: id_text(value)?,
            first_name: named("first_name"),
            last_name: named("last_name"),
            email: named("email"),
        })
    }

    fn bare(id: String) -> ReviewUser {
        ReviewUser {
            id,
            first_name: None,
            last_name: None,
            email: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ThreadMessage {
    pub id: String,
    pub user_id: Option<String>,
    pub content: String,
    pub timestamp: Option<i64>,
    pub edited_at: Option<i64>,
    pub user: Option<ReviewUser>,
}

impl ThreadMessage {
    pub fn from_value(value: &Value) -> Option<ThreadMessage> {
        let user = value.get("user").and_then(ReviewUser::from_value);
        Some(ThreadMessage {
            id: id_text(value)?,
            user_id: match value.get("user_id") {
                None | Some(Value::Null) => user.as_ref().map(|user| user.id.clone()),
                Some(id) => Some(plain(id.as_str()?.to_string())?),
            },
            content: text(value, "content")?,
            timestamp: value.get("timestamp").and_then(stamp_ms),
            edited_at: value.get("edited_at").and_then(stamp_ms),
            user,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Resolution {
    pub by: Option<ReviewUser>,
    pub at: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Thread {
    pub id: String,
    pub messages: Vec<ThreadMessage>,
    pub resolved: Option<Resolution>,
}

impl Thread {
    fn from_entry(id: &str, value: &Value) -> Option<Thread> {
        let resolved = (value.get("resolved").and_then(Value::as_bool) == Some(true)).then(|| {
            let by = value
                .get("resolved_by_user")
                .and_then(ReviewUser::from_value)
                .or_else(|| {
                    text(value, "resolved_by_user_id")
                        .and_then(plain)
                        .map(ReviewUser::bare)
                });
            Resolution {
                by,
                at: value.get("resolved_at").and_then(stamp_ms),
            }
        });
        let mut messages: Vec<ThreadMessage> = value
            .get("messages")?
            .as_array()?
            .iter()
            .filter_map(ThreadMessage::from_value)
            .collect();
        messages.sort_by_key(|message| message.timestamp);
        Some(Thread {
            id: plain(id.to_string())?,
            messages,
            resolved,
        })
    }

    pub fn list_from_value(value: &Value) -> Option<Vec<Thread>> {
        Some(
            value
                .as_object()?
                .iter()
                .filter_map(|(id, entry)| Thread::from_entry(id, entry))
                .collect(),
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReviewEvent {
    NewComment {
        thread: String,
        message: Box<ThreadMessage>,
    },
    Threads(Vec<Thread>),
    MessageEdited {
        thread: String,
        message: String,
        content: String,
    },
    MessageDeleted {
        thread: String,
        message: String,
    },
    Resolved {
        thread: String,
        by: Option<Box<ReviewUser>>,
    },
    Reopened {
        thread: String,
    },
    ThreadDeleted {
        thread: String,
    },
    Accepted {
        doc: DocId,
        changes: Vec<String>,
    },
}

impl ReviewEvent {
    fn from_wire(name: &str, args: &[Value]) -> Option<ReviewEvent> {
        let arg = |at: usize| args.get(at).unwrap_or(&Value::Null);
        let id = |at: usize| arg(at).as_str().map(str::to_string).and_then(plain);
        Some(match name {
            "new-comment" => ReviewEvent::NewComment {
                thread: id(0)?,
                message: Box::new(ThreadMessage::from_value(arg(1))?),
            },
            "new-comment-threads" => ReviewEvent::Threads(Thread::list_from_value(arg(0))?),
            "edit-message" => ReviewEvent::MessageEdited {
                thread: id(0)?,
                message: id(1)?,
                content: arg(2).as_str()?.to_string(),
            },
            "delete-message" => ReviewEvent::MessageDeleted {
                thread: id(0)?,
                message: id(1)?,
            },
            "resolve-thread" => ReviewEvent::Resolved {
                thread: id(0)?,
                by: ReviewUser::from_value(arg(1)).map(Box::new),
            },
            "reopen-thread" => ReviewEvent::Reopened { thread: id(0)? },
            "delete-thread" => ReviewEvent::ThreadDeleted { thread: id(0)? },
            "accept-changes" => ReviewEvent::Accepted {
                doc: DocId(id(0)?),
                changes: arg(1)
                    .as_array()?
                    .iter()
                    .map(|change| change.as_str().map(str::to_string).and_then(plain))
                    .collect::<Option<Vec<String>>>()?,
            },
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChatEvent {
    New {
        message: Box<ThreadMessage>,
        client_id: Option<String>,
    },
    Edited {
        message: String,
        user_id: Option<String>,
        content: String,
    },
    Deleted {
        message: String,
        user_id: Option<String>,
    },
}

impl ChatEvent {
    fn from_wire(name: &str, args: &[Value]) -> Option<ChatEvent> {
        let first = args.first().filter(|first| first.is_object())?;
        let id = |key: &str| text(first, key).and_then(plain);
        Some(match name {
            "new-chat-message" => ChatEvent::New {
                message: Box::new(ThreadMessage::from_value(first)?),
                client_id: text(first, "clientId").filter(|id| !id.is_empty()),
            },
            "edit-global-message" => ChatEvent::Edited {
                message: id("messageId")?,
                user_id: id("userId"),
                content: text(first, "content")?,
            },
            "delete-global-message" => ChatEvent::Deleted {
                message: id("messageId")?,
                user_id: id("userId"),
            },
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Rejection {
    Retry,
    RateLimited,
    SignedOut,
    NotAuthorized,
    ProjectGone,
    Other(String),
}

#[derive(Clone, Debug, PartialEq)]
pub enum ServerEvent {
    Applied(AppliedUpdate),
    UpdateError { doc: DocId, message: String },
    PeerMoved(PeerPosition),
    PeerLeft(PublicId),
    PeersRefresh,
    Tree(TreeEvent),
    Project(ProjectEvent),
    Access(AccessEvent),
    Review(ReviewEvent),
    Chat(ChatEvent),
    ReconnectGracefully,
    ForceDisconnect { message: String, delay: Duration },
    Rejected(Rejection),
    Unknown { name: String },
}

impl ServerEvent {
    pub fn from_wire(name: &str, args: &[Value]) -> ServerEvent {
        let unknown = || ServerEvent::Unknown {
            name: name.to_string(),
        };
        let first = args.first().unwrap_or(&Value::Null);
        match name {
            "otUpdateApplied" => AppliedUpdate::from_value(first, None)
                .map(ServerEvent::Applied)
                .unwrap_or_else(unknown),
            "otUpdateError" => {
                let details = args.get(1).unwrap_or(&Value::Null);
                match doc_text(details, "doc_id") {
                    Some(doc) => ServerEvent::UpdateError {
                        doc,
                        message: first
                            .as_str()
                            .map(str::to_string)
                            .or_else(|| text(first, "message"))
                            .unwrap_or_default(),
                    },
                    None => unknown(),
                }
            }
            "clientTracking.clientUpdated" => PeerPosition::from_value(first)
                .map(ServerEvent::PeerMoved)
                .unwrap_or_else(unknown),
            "clientTracking.clientDisconnected" => first
                .as_str()
                .map(|id| ServerEvent::PeerLeft(PublicId(id.to_string())))
                .unwrap_or_else(unknown),
            "clientTracking.refresh" => ServerEvent::PeersRefresh,
            "reconnectGracefully" => ServerEvent::ReconnectGracefully,
            "forceDisconnect" => ServerEvent::ForceDisconnect {
                message: first.as_str().unwrap_or_default().to_string(),
                delay: args
                    .get(1)
                    .and_then(Value::as_f64)
                    .and_then(server_wait)
                    .unwrap_or(FORCE_DISCONNECT_DELAY),
            },
            _ => TreeEvent::from_wire(name, args)
                .map(ServerEvent::Tree)
                .or_else(|| ProjectEvent::from_wire(name, args).map(ServerEvent::Project))
                .or_else(|| AccessEvent::from_wire(name, args).map(ServerEvent::Access))
                .or_else(|| ReviewEvent::from_wire(name, args).map(ServerEvent::Review))
                .or_else(|| ChatEvent::from_wire(name, args).map(ServerEvent::Chat))
                .unwrap_or_else(unknown),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn event(name: &str, args: Value) -> ServerEvent {
        ServerEvent::from_wire(name, args.as_array().unwrap())
    }

    #[test]
    fn applied_updates_keep_their_source_and_suggestion_seed() {
        assert_eq!(
            event(
                "otUpdateApplied",
                json!([{ "doc": "d1", "op": [{ "p": 0, "i": "x" }], "v": 4, "meta": { "source": "P.1", "user_id": "u", "ts": 1, "tc": "abc" } }])
            ),
            ServerEvent::Applied(AppliedUpdate {
                doc: DocId("d1".into()),
                v: 4,
                op: Some(json!([{ "p": 0, "i": "x" }])),
                source: Some(PublicId("P.1".into())),
                user_id: Some("u".into()),
                tc: Some("abc".into()),
                ts: Some(1),
                dup: false,
                external: false,
            })
        );
        assert_eq!(
            event("otUpdateApplied", json!([{ "v": 5, "doc": "d1" }])),
            ServerEvent::Applied(AppliedUpdate {
                doc: DocId("d1".into()),
                v: 5,
                op: None,
                source: None,
                user_id: None,
                tc: None,
                ts: None,
                dup: false,
                external: false,
            })
        );
        assert_eq!(
            AppliedUpdate::from_value(
                &json!({ "op": [], "v": 2, "dup": true }),
                Some(&DocId("d2".into()))
            )
            .map(|update| (update.doc, update.dup)),
            Some((DocId("d2".into()), true))
        );
        assert_eq!(
            event("otUpdateApplied", json!([{ "doc": "d1" }])),
            ServerEvent::Unknown {
                name: "otUpdateApplied".into()
            }
        );
    }

    #[test]
    fn errors_presence_and_lifecycle_events_are_typed() {
        assert_eq!(
            event(
                "otUpdateError",
                json!(["doc not found", { "project_id": "p", "doc_id": "d", "message": "otUpdateError" }])
            ),
            ServerEvent::UpdateError {
                doc: DocId("d".into()),
                message: "doc not found".into()
            }
        );
        assert_eq!(
            event(
                "clientTracking.clientUpdated",
                json!([{ "id": "P.2", "user_id": "u2", "name": "Bob", "email": "b@x", "row": 3, "column": 4, "doc_id": "d" }])
            ),
            ServerEvent::PeerMoved(PeerPosition {
                id: PublicId("P.2".into()),
                user_id: Some("u2".into()),
                name: Some("Bob".into()),
                email: Some("b@x".into()),
                doc: Some(DocId("d".into())),
                row: Some(3),
                column: Some(4),
            })
        );
        assert_eq!(
            event("clientTracking.clientDisconnected", json!(["P.2"])),
            ServerEvent::PeerLeft(PublicId("P.2".into()))
        );
        assert_eq!(
            event("clientTracking.refresh", json!([])),
            ServerEvent::PeersRefresh
        );
        assert_eq!(
            event("reconnectGracefully", json!([])),
            ServerEvent::ReconnectGracefully
        );
        assert_eq!(
            event("forceDisconnect", json!(["Maintenance", 2])),
            ServerEvent::ForceDisconnect {
                message: "Maintenance".into(),
                delay: Duration::from_secs(2)
            }
        );
        assert_eq!(
            event("forceDisconnect", json!(["Bye"])),
            ServerEvent::ForceDisconnect {
                message: "Bye".into(),
                delay: FORCE_DISCONNECT_DELAY
            }
        );
    }

    #[test]
    fn a_forced_disconnect_waits_no_longer_than_the_cap() {
        for (seconds, expected) in [
            (json!(1e20), LONGEST_SERVER_WAIT),
            (json!(1e12), LONGEST_SERVER_WAIT),
            (json!(u64::MAX), LONGEST_SERVER_WAIT),
            (json!(f64::MAX), LONGEST_SERVER_WAIT),
            (json!(0), Duration::ZERO),
            (json!(-5), FORCE_DISCONNECT_DELAY),
            (json!("soon"), FORCE_DISCONNECT_DELAY),
        ] {
            assert_eq!(
                event("forceDisconnect", json!(["Maintenance", seconds])),
                ServerEvent::ForceDisconnect {
                    message: "Maintenance".into(),
                    delay: expected
                },
                "{seconds}"
            );
        }
    }

    #[test]
    fn ids_that_are_not_plain_never_become_entities_or_documents() {
        let long = "a".repeat(129);
        for hostile in [
            "../journal",
            "..",
            "/etc/passwd",
            "C:\\Users\\x",
            "a/b",
            "a\\b",
            "a.b",
            "",
            long.as_str(),
        ] {
            assert!(!plain_id(hostile), "{hostile}");
            let unknown = |name: &str| ServerEvent::Unknown { name: name.into() };
            for (name, args) in [
                (
                    "reciveNewDoc",
                    json!(["f", { "_id": hostile, "name": "a.tex" }]),
                ),
                (
                    "reciveNewDoc",
                    json!([hostile, { "_id": "d", "name": "a.tex" }]),
                ),
                (
                    "reciveNewFile",
                    json!(["f", { "_id": hostile, "name": "a.png" }]),
                ),
                (
                    "reciveNewFolder",
                    json!(["f", { "id": hostile, "name": "figs" }]),
                ),
                ("reciveEntityRename", json!([hostile, "b.tex"])),
                ("reciveEntityMove", json!(["d", hostile])),
                ("removeEntity", json!([hostile, "editor"])),
                ("rootDocUpdated", json!([hostile])),
                ("mainBibliographyDocUpdated", json!([hostile])),
                ("otUpdateApplied", json!([{ "doc": hostile, "v": 1 }])),
                ("otUpdateError", json!(["x", { "doc_id": hostile }])),
                (
                    "new-comment",
                    json!([hostile, { "id": "m1", "content": "hi", "user_id": "u1" }]),
                ),
                (
                    "new-comment",
                    json!(["t1", { "id": hostile, "content": "hi", "user_id": "u1" }]),
                ),
                (
                    "new-comment",
                    json!(["t1", { "id": "m1", "content": "hi", "user_id": hostile }]),
                ),
                ("edit-message", json!([hostile, "m1", "new"])),
                ("edit-message", json!(["t1", hostile, "new"])),
                ("delete-message", json!([hostile, "m1"])),
                ("delete-message", json!(["t1", hostile])),
                ("resolve-thread", json!([hostile, { "id": "u1" }])),
                ("reopen-thread", json!([hostile])),
                ("delete-thread", json!([hostile])),
                ("accept-changes", json!([hostile, ["c1"]])),
                ("accept-changes", json!(["d1", ["c1", hostile]])),
            ] {
                assert_eq!(event(name, args), unknown(name), "{name} {hostile}");
            }
            let moved = event(
                "clientTracking.clientUpdated",
                json!([{ "id": "P.2", "doc_id": hostile, "row": 1 }]),
            );
            assert!(
                matches!(&moved, ServerEvent::PeerMoved(peer) if peer.doc.is_none()),
                "{moved:?}"
            );
            let threads = event(
                "new-comment-threads",
                json!([{
                    hostile: { "messages": [{ "id": "m1", "content": "a" }] },
                    "t1": { "messages": [{ "id": hostile, "content": "b" }, { "id": "m2", "content": "c" }] },
                }]),
            );
            let ServerEvent::Review(ReviewEvent::Threads(threads)) = threads else {
                panic!("{threads:?}");
            };
            assert_eq!(threads.len(), 1, "{hostile}");
            assert_eq!(threads[0].id, "t1");
            let kept: Vec<&str> = threads[0].messages.iter().map(|m| m.id.as_str()).collect();
            assert_eq!(kept, vec!["m2"]);
            let resolved = event("resolve-thread", json!(["t1", { "id": hostile }]));
            assert_eq!(
                resolved,
                ServerEvent::Review(ReviewEvent::Resolved {
                    thread: "t1".into(),
                    by: None
                })
            );
        }
        assert!(plain_id(&"a".repeat(128)));
        assert!(plain_id("6af9683d2fdfc01466e1ed43"));
    }

    #[test]
    fn review_events_are_typed() {
        let alice = ReviewUser {
            id: "u1".into(),
            first_name: Some("Alice".into()),
            last_name: None,
            email: Some("a@x".into()),
        };
        let message = ThreadMessage {
            id: "m1".into(),
            user_id: Some("u1".into()),
            content: "Look @[u2]".into(),
            timestamp: Some(1_763_200_000_123),
            edited_at: None,
            user: Some(alice.clone()),
        };
        let cases = [
            (
                event(
                    "new-comment",
                    json!(["t1", { "id": "m1", "content": "Look @[u2]", "timestamp": 1_763_200_000_123_i64, "user_id": "u1", "user": { "id": "u1", "first_name": "Alice", "last_name": "", "email": "a@x" } }]),
                ),
                ServerEvent::Review(ReviewEvent::NewComment {
                    thread: "t1".into(),
                    message: Box::new(message.clone()),
                }),
            ),
            (
                event(
                    "new-comment-threads",
                    json!([{
                        "t1": {
                            "messages": [
                                { "id": "m2", "content": "later", "timestamp": 1_763_200_000_200_i64, "user_id": "u2", "edited_at": 1_763_200_000_300_i64 },
                                { "id": "m1", "content": "Look @[u2]", "timestamp": "2025-11-15T09:46:40.123Z", "user_id": "u1", "user": { "_id": "u1", "first_name": "Alice", "email": "a@x" } },
                            ],
                            "resolved": true,
                            "resolved_at": "2025-11-15T09:46:41.000Z",
                            "resolved_by_user_id": "u2",
                        },
                        "t2": { "messages": [], "resolved": true, "resolved_by_user": { "id": "u1", "first_name": "Alice", "email": "a@x" } },
                    }]),
                ),
                ServerEvent::Review(ReviewEvent::Threads(vec![
                    Thread {
                        id: "t1".into(),
                        messages: vec![
                            message.clone(),
                            ThreadMessage {
                                id: "m2".into(),
                                user_id: Some("u2".into()),
                                content: "later".into(),
                                timestamp: Some(1_763_200_000_200),
                                edited_at: Some(1_763_200_000_300),
                                user: None,
                            },
                        ],
                        resolved: Some(Resolution {
                            by: Some(ReviewUser::bare("u2".into())),
                            at: Some(1_763_200_001_000),
                        }),
                    },
                    Thread {
                        id: "t2".into(),
                        messages: Vec::new(),
                        resolved: Some(Resolution {
                            by: Some(alice.clone()),
                            at: None,
                        }),
                    },
                ])),
            ),
            (
                event("edit-message", json!(["t1", "m1", "Edited"])),
                ServerEvent::Review(ReviewEvent::MessageEdited {
                    thread: "t1".into(),
                    message: "m1".into(),
                    content: "Edited".into(),
                }),
            ),
            (
                event("delete-message", json!(["t1", "m1"])),
                ServerEvent::Review(ReviewEvent::MessageDeleted {
                    thread: "t1".into(),
                    message: "m1".into(),
                }),
            ),
            (
                event(
                    "resolve-thread",
                    json!(["t1", { "id": "u1", "first_name": "Alice", "email": "a@x" }]),
                ),
                ServerEvent::Review(ReviewEvent::Resolved {
                    thread: "t1".into(),
                    by: Some(Box::new(alice)),
                }),
            ),
            (
                event("reopen-thread", json!(["t1"])),
                ServerEvent::Review(ReviewEvent::Reopened {
                    thread: "t1".into(),
                }),
            ),
            (
                event("delete-thread", json!(["t1"])),
                ServerEvent::Review(ReviewEvent::ThreadDeleted {
                    thread: "t1".into(),
                }),
            ),
            (
                event("accept-changes", json!(["d1", ["c1", "c2"]])),
                ServerEvent::Review(ReviewEvent::Accepted {
                    doc: DocId("d1".into()),
                    changes: vec!["c1".into(), "c2".into()],
                }),
            ),
        ];
        for (got, want) in cases {
            assert_eq!(got, want);
        }
        for (name, args) in [
            ("new-comment", json!(["t1"])),
            ("new-comment", json!(["t1", { "id": "m1" }])),
            ("new-comment-threads", json!([[]])),
            ("edit-message", json!(["t1", "m1"])),
            ("accept-changes", json!(["d1", "c1"])),
            ("reject-changes", json!(["d1", ["c1"]])),
        ] {
            assert_eq!(
                event(name, args),
                ServerEvent::Unknown { name: name.into() },
                "{name}"
            );
        }
    }

    #[test]
    fn chat_events_are_typed_from_their_one_object_argument() {
        let posted = json!([{
            "id": "6b04fdd5296ea5fec7324e27",
            "content": "Hello $x^2$",
            "timestamp": 1_795_489_237_807_i64,
            "user_id": "6afab5bb1222cc50aa4c16ec",
            "room_id": "6afab5be1222cc50aa4c170b",
            "user": { "id": "6afab5bb1222cc50aa4c16ec", "first_name": "Alice", "last_name": "Owner", "email": "alice@example.test" },
            "clientId": "3f1c6f0e-1d8e-4d2a-9b71-0f1b7f0c2a11",
        }]);
        let ServerEvent::Chat(ChatEvent::New { message, client_id }) =
            event("new-chat-message", posted)
        else {
            panic!("a chat message");
        };
        assert_eq!(message.id, "6b04fdd5296ea5fec7324e27");
        assert_eq!(message.content, "Hello $x^2$");
        assert_eq!(message.timestamp, Some(1_795_489_237_807));
        assert_eq!(
            message.user.and_then(|user| user.first_name).as_deref(),
            Some("Alice")
        );
        assert_eq!(
            client_id.as_deref(),
            Some("3f1c6f0e-1d8e-4d2a-9b71-0f1b7f0c2a11")
        );
        assert_eq!(
            event(
                "new-chat-message",
                json!([{ "id": "m1", "content": "no client", "timestamp": 1, "user_id": "u1", "clientId": "" }])
            ),
            ServerEvent::Chat(ChatEvent::New {
                message: Box::new(ThreadMessage {
                    id: "m1".into(),
                    user_id: Some("u1".into()),
                    content: "no client".into(),
                    timestamp: Some(1),
                    edited_at: None,
                    user: None,
                }),
                client_id: None,
            })
        );
        assert_eq!(
            event(
                "edit-global-message",
                json!([{ "messageId": "m1", "userId": "u1", "content": "Edited" }])
            ),
            ServerEvent::Chat(ChatEvent::Edited {
                message: "m1".into(),
                user_id: Some("u1".into()),
                content: "Edited".into(),
            })
        );
        assert_eq!(
            event(
                "delete-global-message",
                json!([{ "messageId": "m1", "userId": "u1" }])
            ),
            ServerEvent::Chat(ChatEvent::Deleted {
                message: "m1".into(),
                user_id: Some("u1".into()),
            })
        );
        for (name, args) in [
            ("edit-global-message", json!(["m1", "Edited"])),
            ("delete-global-message", json!(["m1"])),
            ("delete-global-message", json!([{ "messageId": "../m1" }])),
            ("edit-global-message", json!([{ "messageId": "m1" }])),
            ("new-chat-message", json!([{ "id": "m1", "user_id": "u1" }])),
        ] {
            assert_eq!(
                event(name, args),
                ServerEvent::Unknown { name: name.into() },
                "{name}"
            );
        }
    }

    #[test]
    fn stamps_read_milliseconds_and_iso_times() {
        for (value, expected) in [
            (json!(1_763_200_000_123_i64), Some(1_763_200_000_123)),
            (json!(1.5e12), Some(1_500_000_000_000)),
            (json!("1970-01-01T00:00:00.000Z"), Some(0)),
            (json!("2000-02-29T00:00:00Z"), Some(951_782_400_000)),
            (json!("2025-11-15T09:46:40.1234Z"), Some(1_763_200_000_123)),
            (json!("2099-12-31T23:59:59.999Z"), Some(4_102_444_799_999)),
            (json!("2025-11-15T09:46:40.123+01:00"), None),
            (json!("2025-13-15T09:46:40.123Z"), None),
            (json!("2025-11-15T09:46:40.Z"), None),
            (json!("yesterday"), None),
            (json!(true), None),
        ] {
            assert_eq!(stamp_ms(&value), expected, "{value}");
        }
        for ms in [0, 951_782_400_000, 1_763_200_000_123, 4_102_444_799_999] {
            assert_eq!(iso_ms(&iso_time(ms)), Some(ms), "{ms}");
        }
        assert_eq!(iso_time(1_763_200_000_123), "2025-11-15T09:46:40.123Z");
    }

    #[test]
    fn a_new_file_keeps_its_link_only_from_an_object_with_a_plain_provider() {
        let linked = |args: Value| match event("reciveNewFile", args) {
            ServerEvent::Tree(TreeEvent::NewFile { linked, .. }) => linked.map(|link| *link),
            other => panic!("{other:?}"),
        };
        let file = json!({ "_id": "x", "name": "refs.bib", "hash": "h" });
        let data = json!({
            "provider": "project_file",
            "source_project_id": "64b7f0c2a1e3d4b5c6a7e8f9",
            "source_entity_path": "/sample.bib",
            "importedAt": "2026-11-23T00:00:00.000Z",
        });
        let expected = Some(LinkedSource {
            provider: "project_file".into(),
            url: None,
            source_project: Some("64b7f0c2a1e3d4b5c6a7e8f9".into()),
            source_path: Some("/sample.bib".into()),
        });
        assert_eq!(linked(json!(["f", file, "upload", data, "u"])), expected);
        let mut carried = file.clone();
        carried["linkedFileData"] = data.clone();
        assert_eq!(linked(json!(["f", carried, "upload", null, "u"])), expected);
        let output = json!({ "provider": "project_output_file", "source_project_id": "p", "source_output_file_path": "output.pdf", "build_id": "b" });
        assert_eq!(
            linked(json!(["f", file, "upload", output, "u"])).and_then(|link| link.source_path),
            Some("output.pdf".into())
        );
        let url = json!({ "provider": "url", "url": "https://example.test/data.csv" });
        assert_eq!(
            linked(json!(["f", file, "upload", url, "u"])).and_then(|link| link.url),
            Some("https://example.test/data.csv".into())
        );
        for hostile in [
            Value::Null,
            json!({}),
            json!("project_file"),
            json!(["project_file"]),
            json!({ "provider": 7 }),
            json!({ "provider": "" }),
            json!({ "provider": "project file" }),
            json!({ "provider": "x".repeat(65) }),
            json!({ "provider": "proj\u{0}ect" }),
        ] {
            assert_eq!(
                linked(json!(["f", file, "upload", hostile, "u"])),
                None,
                "{hostile}"
            );
        }
        let odd = json!({ "provider": "url", "url": "a\nb", "source_entity_path": "x".repeat(3000), "source_project_id": ["p"] });
        assert_eq!(
            linked(json!(["f", file, "upload", odd, "u"])),
            Some(LinkedSource {
                provider: "url".into(),
                url: None,
                source_project: None,
                source_path: None,
            })
        );
    }

    #[test]
    fn tree_project_and_access_events_are_typed() {
        let entity = |id: &str| EntityId(id.into());
        let cases = [
            (
                event(
                    "reciveNewDoc",
                    json!(["f", { "_id": "d", "name": "a.tex" }, "editor", "u"]),
                ),
                ServerEvent::Tree(TreeEvent::NewDoc {
                    folder: entity("f"),
                    id: entity("d"),
                    name: "a.tex".into(),
                }),
            ),
            (
                event(
                    "reciveNewFile",
                    json!(["f", { "_id": "x", "name": "a.png", "hash": "h" }, "upload", null, "u"]),
                ),
                ServerEvent::Tree(TreeEvent::NewFile {
                    folder: entity("f"),
                    id: entity("x"),
                    name: "a.png".into(),
                    hash: Some("h".into()),
                    converted: false,
                    linked: None,
                }),
            ),
            (
                event(
                    "reciveNewFile",
                    json!(["f", { "_id": "x", "name": "a.tex" }, "convertDocToFile", null, "u"]),
                ),
                ServerEvent::Tree(TreeEvent::NewFile {
                    folder: entity("f"),
                    id: entity("x"),
                    name: "a.tex".into(),
                    hash: None,
                    converted: true,
                    linked: None,
                }),
            ),
            (
                event(
                    "reciveNewFolder",
                    json!(["f", { "_id": "g", "name": "figs", "docs": [], "fileRefs": [], "folders": [] }, "u"]),
                ),
                ServerEvent::Tree(TreeEvent::NewFolder {
                    folder: entity("f"),
                    id: entity("g"),
                    name: "figs".into(),
                }),
            ),
            (
                event("reciveEntityRename", json!(["d", "b.tex"])),
                ServerEvent::Tree(TreeEvent::Renamed {
                    id: entity("d"),
                    name: "b.tex".into(),
                }),
            ),
            (
                event("reciveEntityMove", json!(["d", "g"])),
                ServerEvent::Tree(TreeEvent::Moved {
                    id: entity("d"),
                    folder: entity("g"),
                }),
            ),
            (
                event("removeEntity", json!(["d", "editor"])),
                ServerEvent::Tree(TreeEvent::Removed {
                    id: entity("d"),
                    restoring: false,
                }),
            ),
            (
                event("removeEntity", json!(["d", "convertDocToFile"])),
                ServerEvent::Tree(TreeEvent::Removed {
                    id: entity("d"),
                    restoring: false,
                }),
            ),
            (
                event(
                    "removeEntity",
                    json!(["x", { "kind": "file-restore", "path": "main.tex", "version": 4 }]),
                ),
                ServerEvent::Tree(TreeEvent::Removed {
                    id: entity("x"),
                    restoring: true,
                }),
            ),
            (
                event(
                    "removeEntity",
                    json!(["x", { "kind": "project-restore", "version": 4 }]),
                ),
                ServerEvent::Tree(TreeEvent::Removed {
                    id: entity("x"),
                    restoring: true,
                }),
            ),
            (
                event("removeEntity", json!(["x", { "kind": "upload" }])),
                ServerEvent::Tree(TreeEvent::Removed {
                    id: entity("x"),
                    restoring: false,
                }),
            ),
            (
                event("rootDocUpdated", json!(["d"])),
                ServerEvent::Project(ProjectEvent::RootDoc(DocId("d".into()))),
            ),
            (
                event("compilerUpdated", json!(["xelatex"])),
                ServerEvent::Project(ProjectEvent::Compiler("xelatex".into())),
            ),
            (
                event("imageNameUpdated", json!(["texlive-full:2025.1"])),
                ServerEvent::Project(ProjectEvent::Image("texlive-full:2025.1".into())),
            ),
            (
                event("spellCheckLanguageUpdated", json!(["de"])),
                ServerEvent::Project(ProjectEvent::SpellLanguage("de".into())),
            ),
            (
                event("mainBibliographyDocUpdated", json!(["b"])),
                ServerEvent::Project(ProjectEvent::MainBibliography(DocId("b".into()))),
            ),
            (
                event("projectNameUpdated", json!(["Thesis"])),
                ServerEvent::Project(ProjectEvent::Name("Thesis".into())),
            ),
            (
                event("projectRenamedOrDeletedByExternalSource", json!([])),
                ServerEvent::Project(ProjectEvent::DeletedOrRenamedExternally),
            ),
            (
                event("project:membership:changed", json!([{ "members": true }])),
                ServerEvent::Access(AccessEvent::MembersChanged {
                    members: true,
                    invites: false,
                }),
            ),
            (
                event("project:membership:changed", json!([{ "invites": true }])),
                ServerEvent::Access(AccessEvent::MembersChanged {
                    members: false,
                    invites: true,
                }),
            ),
            (
                event(
                    "project:membership:changed",
                    json!([{ "accessRequests": true }]),
                ),
                ServerEvent::Access(AccessEvent::MembersChanged {
                    members: false,
                    invites: false,
                }),
            ),
            (
                event("project:membership:changed", json!([])),
                ServerEvent::Access(AccessEvent::MembersChanged {
                    members: true,
                    invites: false,
                }),
            ),
            (
                event(
                    "project:collaboratorAccessLevel:changed",
                    json!([{ "userId": "u" }]),
                ),
                ServerEvent::Access(AccessEvent::AccessLevelChanged {
                    user_id: Some("u".into()),
                }),
            ),
            (
                event(
                    "project:publicAccessLevel:changed",
                    json!([{ "newAccessLevel": "private" }]),
                ),
                ServerEvent::Access(AccessEvent::PublicAccessChanged(Some("private".into()))),
            ),
            (
                event("project:access:revoked", json!([])),
                ServerEvent::Access(AccessEvent::Revoked),
            ),
            (
                event("userRemovedFromProject", json!(["u"])),
                ServerEvent::Access(AccessEvent::UserRemoved(Some("u".into()))),
            ),
            (
                event("toggle-track-changes", json!([{ "u": true }])),
                ServerEvent::Access(AccessEvent::TrackChanges(json!({ "u": true }))),
            ),
        ];
        for (got, want) in cases {
            assert_eq!(got, want);
        }
        for name in [
            "new-chat-message",
            "edit-global-message",
            "delete-global-message",
            "referenceFormatUpdated",
            "broadcastDocMeta",
            "a-brand-new-event",
        ] {
            assert_eq!(
                event(name, json!([{}])),
                ServerEvent::Unknown { name: name.into() }
            );
        }
        assert_eq!(
            event("reciveEntityRename", json!([])),
            ServerEvent::Unknown {
                name: "reciveEntityRename".into()
            }
        );
    }
}
