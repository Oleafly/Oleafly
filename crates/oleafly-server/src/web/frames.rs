use oleafly_collab::comments::CommentThread;
use oleafly_collab::ot::TextOperation;
use oleafly_collab::settings::Settings;
use oleafly_collab_protocol::ids::{AccountId, CommentId, DeviceId};
use oleafly_collab_protocol::outputs::{OutputKind, ProjectOutput};
use oleafly_collab_protocol::projects::ProjectRole;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebFile {
    pub file_id: String,
    pub path: String,
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebText {
    pub file_id: String,
    pub path: String,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebMember {
    pub account_id: AccountId,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub login: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct WebFeatures {
    pub comments: bool,
    pub suggestions: bool,
    pub chat: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebPeer {
    pub device_id: DeviceId,
    pub account_id: AccountId,
    pub name: Option<String>,
    pub file_id: Option<String>,
    pub anchor: Option<u32>,
    pub head: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebOutput {
    pub kind: OutputKind,
    pub size: u64,
    pub compiled_by: AccountId,
    pub compiled_at: i64,
    pub main_file: String,
}

impl From<ProjectOutput> for WebOutput {
    fn from(output: ProjectOutput) -> WebOutput {
        WebOutput {
            kind: output.kind,
            size: output.size,
            compiled_by: output.compiled_by,
            compiled_at: output.compiled_at,
            main_file: output.main_file,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "t", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum Outgoing {
    Hello {
        role: ProjectRole,
        features: WebFeatures,
        files: Vec<WebFile>,
        members: Vec<WebMember>,
        compile: Settings,
    },
    Compile {
        settings: Settings,
    },
    Opened {
        file_id: String,
        rev: u64,
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        resumed: Option<bool>,
    },
    Ack {
        file_id: String,
        rev: u64,
        length: usize,
    },
    Remote {
        file_id: String,
        rev: u64,
        op: TextOperation,
        length: usize,
    },
    Reset {
        file_id: String,
        rev: u64,
        text: String,
    },
    Tree {
        files: Vec<WebFile>,
    },
    Presence {
        peers: Vec<WebPeer>,
    },
    Threads {
        file_id: String,
        rev: Option<u64>,
        threads: Vec<CommentThread>,
    },
    Suggestions {
        file_id: String,
        rev: Option<u64>,
        suggestions: Vec<Value>,
    },
    Chat {
        messages: Vec<Value>,
    },
    Output {
        items: Vec<WebOutput>,
    },
    Access {
        role: ProjectRole,
        #[serde(skip_serializing_if = "Option::is_none")]
        removed: Option<bool>,
    },
    Done {
        req_id: String,
    },
    Error {
        code: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        req_id: Option<String>,
    },
}

impl Outgoing {
    pub fn error(code: &str, message: &str, req_id: Option<String>) -> Outgoing {
        Outgoing::Error {
            code: code.to_string(),
            message: message.to_string(),
            req_id,
        }
    }

    pub fn text(&self) -> Option<String> {
        serde_json::to_string(self).ok()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EditMode {
    Editing,
    Suggesting,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum CommentAction {
    Create {
        file_id: String,
        from: usize,
        to: usize,
        #[serde(default)]
        rev: Option<u64>,
        body: String,
    },
    Reply {
        #[serde(default)]
        file_id: Option<String>,
        thread_id: CommentId,
        body: String,
    },
    Edit {
        #[serde(default)]
        file_id: Option<String>,
        thread_id: CommentId,
        message_id: CommentId,
        body: String,
    },
    Delete {
        #[serde(default)]
        file_id: Option<String>,
        thread_id: CommentId,
        message_id: CommentId,
    },
    DeleteThread {
        #[serde(default)]
        file_id: Option<String>,
        thread_id: CommentId,
    },
    Resolve {
        #[serde(default)]
        file_id: Option<String>,
        thread_id: CommentId,
    },
    Reopen {
        #[serde(default)]
        file_id: Option<String>,
        thread_id: CommentId,
    },
}

impl CommentAction {
    pub fn named_file(&self) -> Option<&str> {
        match self {
            CommentAction::Create { file_id, .. } => Some(file_id),
            CommentAction::Reply { file_id, .. }
            | CommentAction::Edit { file_id, .. }
            | CommentAction::Delete { file_id, .. }
            | CommentAction::DeleteThread { file_id, .. }
            | CommentAction::Resolve { file_id, .. }
            | CommentAction::Reopen { file_id, .. } => file_id.as_deref(),
        }
    }

    pub fn thread(&self) -> Option<CommentId> {
        match self {
            CommentAction::Create { .. } => None,
            CommentAction::Reply { thread_id, .. }
            | CommentAction::Edit { thread_id, .. }
            | CommentAction::Delete { thread_id, .. }
            | CommentAction::DeleteThread { thread_id, .. }
            | CommentAction::Resolve { thread_id, .. }
            | CommentAction::Reopen { thread_id, .. } => Some(*thread_id),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum SuggestionAction {
    Accept { ids: Vec<String> },
    Reject { ids: Vec<String> },
    Withdraw { ids: Vec<String> },
    AcceptFile { file_id: String },
    RejectFile { file_id: String },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ChatAction {
    Send { body: String },
    Delete { id: String },
    Clear,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "t", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum Incoming {
    Open {
        file_id: String,
        #[serde(default)]
        resume: Option<String>,
    },
    Change {
        file_id: String,
        rev: u64,
        op: TextOperation,
        #[serde(default)]
        id: Option<String>,
    },
    Close {
        file_id: String,
    },
    Mode {
        mode: EditMode,
    },
    Presence {
        #[serde(default)]
        file_id: Option<String>,
        #[serde(default)]
        anchor: Option<u32>,
        #[serde(default)]
        head: Option<u32>,
    },
    Comment(CommentAction),
    Suggestion(SuggestionAction),
    Chat(ChatAction),
}

pub struct Parsed {
    pub frame: Option<Incoming>,
    pub req_id: Option<String>,
}

pub fn parse(text: &str) -> Parsed {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return Parsed {
            frame: None,
            req_id: None,
        };
    };
    let req_id = value
        .get("reqId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty() && id.len() <= 128)
        .map(str::to_string);
    Parsed {
        frame: serde_json::from_value(value).ok(),
        req_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_collab::settings::{Setting, SettingValue};
    use serde_json::json;

    fn incoming(value: Value) -> Parsed {
        parse(&value.to_string())
    }

    #[test]
    fn client_frames_read_as_the_contract_writes_them() {
        let change =
            incoming(json!({ "t": "change", "fileId": "f1", "rev": 3, "op": [2, "x", -1, 4] }));
        match change.frame {
            Some(Incoming::Change {
                file_id,
                rev,
                op,
                id,
            }) => {
                assert_eq!(file_id, "f1");
                assert_eq!(rev, 3);
                assert_eq!(op.base_len(), 7);
                assert_eq!(id, None);
            }
            other => panic!("{other:?}"),
        }
        let tagged = incoming(
            json!({ "t": "change", "fileId": "f1", "rev": 3, "op": [7], "id": "tab-1:4" }),
        );
        assert!(matches!(
            tagged.frame,
            Some(Incoming::Change { id: Some(id), .. }) if id == "tab-1:4"
        ));
        let resumed = incoming(json!({ "t": "open", "fileId": "f1", "resume": "tab-1:4" }));
        assert!(matches!(
            resumed.frame,
            Some(Incoming::Open { resume: Some(id), .. }) if id == "tab-1:4"
        ));
        assert!(matches!(
            incoming(json!({ "t": "open", "fileId": "f1" })).frame,
            Some(Incoming::Open { resume: None, .. })
        ));
        let create = incoming(json!({
            "t": "comment", "action": "create", "fileId": "f1", "path": "main.tex",
            "from": 1, "to": 4, "rev": null, "body": "Why?", "members": [], "reqId": "r1"
        }));
        assert_eq!(create.req_id.as_deref(), Some("r1"));
        assert!(matches!(
            create.frame,
            Some(Incoming::Comment(CommentAction::Create {
                from: 1,
                to: 4,
                rev: None,
                ..
            }))
        ));
        let thread = "01920000-0000-7000-8000-0000000000c1";
        let reply = incoming(
            json!({ "t": "comment", "action": "reply", "threadId": thread, "body": "Yes", "members": [] }),
        );
        match reply.frame {
            Some(Incoming::Comment(action)) => {
                assert_eq!(
                    action.thread().map(|id| id.to_string()).as_deref(),
                    Some(thread)
                );
                assert_eq!(action.named_file(), None);
            }
            other => panic!("{other:?}"),
        }
        assert!(matches!(
            incoming(json!({ "t": "comment", "action": "delete_thread", "threadId": thread, "fileId": "f2" })).frame,
            Some(Incoming::Comment(CommentAction::DeleteThread { .. }))
        ));
        assert!(matches!(
            incoming(json!({ "t": "suggestion", "action": "accept_file", "fileId": "f1" })).frame,
            Some(Incoming::Suggestion(SuggestionAction::AcceptFile { .. }))
        ));
        assert!(matches!(
            incoming(json!({ "t": "chat", "action": "clear", "reqId": "c" })).frame,
            Some(Incoming::Chat(ChatAction::Clear))
        ));
        assert!(matches!(
            incoming(json!({ "t": "mode", "mode": "suggesting" })).frame,
            Some(Incoming::Mode {
                mode: EditMode::Suggesting
            })
        ));
        assert!(matches!(
            incoming(json!({ "t": "presence", "fileId": null, "anchor": null, "head": null }))
                .frame,
            Some(Incoming::Presence {
                file_id: None,
                anchor: None,
                head: None
            })
        ));
    }

    #[test]
    fn a_frame_the_server_does_not_know_keeps_its_request_id() {
        let unknown = incoming(json!({ "t": "later", "reqId": "r9" }));
        assert!(unknown.frame.is_none());
        assert_eq!(unknown.req_id.as_deref(), Some("r9"));
        assert!(parse("not json").frame.is_none());
    }

    #[test]
    fn server_frames_carry_the_t_tag_and_camel_case_fields() {
        let ack = serde_json::to_value(Outgoing::Ack {
            file_id: "f1".into(),
            rev: 4,
            length: 12,
        })
        .unwrap();
        assert_eq!(
            ack,
            json!({ "t": "ack", "fileId": "f1", "rev": 4, "length": 12 })
        );
        let access = serde_json::to_value(Outgoing::Access {
            role: ProjectRole::Viewer,
            removed: None,
        })
        .unwrap();
        assert_eq!(access, json!({ "t": "access", "role": "viewer" }));
        let error =
            serde_json::to_value(Outgoing::error("not_ready", "Later.", Some("r".into()))).unwrap();
        assert_eq!(
            error,
            json!({ "t": "error", "code": "not_ready", "message": "Later.", "reqId": "r" })
        );
        let main = "01920000-0000-7000-8000-0000000000f1";
        let settings: Settings = [
            SettingValue::parse(Setting::MainDoc, main).unwrap(),
            SettingValue::parse(Setting::Engine, "latex").unwrap(),
        ]
        .into_iter()
        .collect();
        let compile = serde_json::to_value(Outgoing::Compile { settings }).unwrap();
        assert_eq!(
            compile,
            json!({ "t": "compile", "settings": { "main_doc": main, "engine": "latex" } })
        );
        let text = serde_json::to_value(WebText {
            file_id: "f".into(),
            path: "main.tex".into(),
            text: "Hi".into(),
        })
        .unwrap();
        assert_eq!(
            text,
            json!({ "fileId": "f", "path": "main.tex", "text": "Hi" })
        );
        let opened = serde_json::to_value(Outgoing::Opened {
            file_id: "f".into(),
            rev: 2,
            text: "Hi".into(),
            resumed: None,
        })
        .unwrap();
        assert_eq!(
            opened,
            json!({ "t": "opened", "fileId": "f", "rev": 2, "text": "Hi" })
        );
        let resumed = serde_json::to_value(Outgoing::Opened {
            file_id: "f".into(),
            rev: 0,
            text: "Hi".into(),
            resumed: Some(true),
        })
        .unwrap();
        assert_eq!(resumed["resumed"], json!(true));
        let done = serde_json::to_value(Outgoing::Done { req_id: "r".into() }).unwrap();
        assert_eq!(done, json!({ "t": "done", "reqId": "r" }));
        let file = serde_json::to_value(WebFile {
            file_id: "b".into(),
            path: "fig.png".into(),
            kind: "blob",
            hash: Some("h".into()),
        })
        .unwrap();
        assert_eq!(
            file,
            json!({ "fileId": "b", "path": "fig.png", "kind": "blob", "hash": "h" })
        );
    }
}
