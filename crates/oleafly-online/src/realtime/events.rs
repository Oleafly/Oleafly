use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

const FORCE_DISCONNECT_DELAY: Duration = Duration::from_secs(10);

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
    pub dup: bool,
    pub external: bool,
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
            doc: cursor.and_then(|cursor| text(cursor, "doc_id")).map(DocId),
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
            doc: text(value, "doc_id").map(DocId),
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
        converting: bool,
    },
}

const CONVERT_DOC_TO_FILE: &str = "convertDocToFile";
const CONVERT_FILE_TO_DOC: &str = "convertFileToDoc";

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
                converting: matches!(
                    arg(1).as_str(),
                    Some(CONVERT_DOC_TO_FILE | CONVERT_FILE_TO_DOC)
                ),
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
        Some(match name {
            "rootDocUpdated" => ProjectEvent::RootDoc(DocId(first()?)),
            "compilerUpdated" => ProjectEvent::Compiler(first()?),
            "imageNameUpdated" => ProjectEvent::Image(first()?),
            "spellCheckLanguageUpdated" => ProjectEvent::SpellLanguage(first()?),
            "mainBibliographyDocUpdated" => ProjectEvent::MainBibliography(DocId(first()?)),
            "projectNameUpdated" => ProjectEvent::Name(first()?),
            "projectRenamedOrDeletedByExternalSource" => ProjectEvent::DeletedOrRenamedExternally,
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum AccessEvent {
    MembersChanged,
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
            "project:membership:changed" => AccessEvent::MembersChanged,
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
                match text(details, "doc_id") {
                    Some(doc) => ServerEvent::UpdateError {
                        doc: DocId(doc),
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
                    .filter(|seconds| seconds.is_finite() && *seconds >= 0.0)
                    .map(Duration::from_secs_f64)
                    .unwrap_or(FORCE_DISCONNECT_DELAY),
            },
            _ => TreeEvent::from_wire(name, args)
                .map(ServerEvent::Tree)
                .or_else(|| ProjectEvent::from_wire(name, args).map(ServerEvent::Project))
                .or_else(|| AccessEvent::from_wire(name, args).map(ServerEvent::Access))
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
                    converting: false,
                }),
            ),
            (
                event("removeEntity", json!(["d", "convertDocToFile"])),
                ServerEvent::Tree(TreeEvent::Removed {
                    id: entity("d"),
                    converting: true,
                }),
            ),
            (
                event("removeEntity", json!(["x", "convertFileToDoc"])),
                ServerEvent::Tree(TreeEvent::Removed {
                    id: entity("x"),
                    converting: true,
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
                ServerEvent::Access(AccessEvent::MembersChanged),
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
