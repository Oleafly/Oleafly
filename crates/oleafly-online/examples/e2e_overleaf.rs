use std::collections::BTreeMap;
use std::io::BufRead as _;
use std::time::Duration;

use oleafly_online::test_support::mock_overleaf::{
    DocFormat, MockOverleaf, MockPeer, MockProject, MockUser, Privilege,
};
use serde_json::{json, Value};
use tokio::sync::mpsc;

const PROTOCOL: &str = "e2e-overleaf ";
const MAIN: &str = "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n";
const NOTES_PATH: &str = "notes.tex";
const NOTES: &str = "Notes kept in the newer format.\n";
const SEEDS: [(&str, &str); 3] = [
    ("notes.md", "# Shared notes\n\nFirst point.\n\nSecond point.\n"),
    (
        "notes/ideas.md",
        "---\ntitle: Ideas\nkind: note\n---\n\nAn idea to try.\n",
    ),
    (
        "refs.bib",
        "@book{knuth84,\n  title = {Literate Programming},\n  author = {Knuth, Donald},\n  year = {1984},\n}\n",
    ),
];
const PEOPLE: [&str; 5] = ["olivia", "alice", "bob", "carol", "dave"];

fn say(message: &Value) {
    println!("{PROTOCOL}{message}");
}

fn read_requests() -> mpsc::UnboundedReceiver<String> {
    let (lines, receiver) = mpsc::unbounded_channel();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if lines.send(line).is_err() {
                break;
            }
        }
    });
    receiver
}

struct Bridge {
    mock: MockOverleaf,
    peers: BTreeMap<String, MockPeer>,
    threads: u64,
    history_ot: Vec<String>,
}

fn text_field<'a>(request: &'a Value, name: &str) -> Result<&'a str, String> {
    request[name]
        .as_str()
        .ok_or_else(|| format!("the command needs a \"{name}\""))
}

fn number(request: &Value, name: &str) -> Result<usize, String> {
    request[name]
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())
        .ok_or_else(|| format!("the command needs a number \"{name}\""))
}

fn privilege(role: &str) -> Result<Option<Privilege>, String> {
    match role {
        "owner" => Ok(Some(Privilege::Owner)),
        "edit" | "editor" | "readAndWrite" => Ok(Some(Privilege::ReadAndWrite)),
        "review" | "reviewer" => Ok(Some(Privilege::Review)),
        "view" | "viewer" | "readOnly" => Ok(Some(Privilege::ReadOnly)),
        "none" => Ok(None),
        other => Err(format!("unknown role {other}")),
    }
}

fn units(text: &str) -> usize {
    text.encode_utf16().count()
}

fn checked(reply: oleafly_online::test_support::mock_overleaf::PeerReply) -> Result<Value, String> {
    if (200..300).contains(&reply.status) {
        Ok(json!({ "status": reply.status, "body": reply.body }))
    } else {
        Err(format!(
            "the server answered {}: {}",
            reply.status, reply.body
        ))
    }
}

struct Options {
    name: String,
    history_ot: bool,
}

fn options() -> Result<Options, String> {
    let mut options = Options {
        name: "E2E Live".into(),
        history_ot: false,
    };
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--history-ot" => options.history_ot = true,
            "--name" => options.name = args.next().ok_or("--name needs a project name")?,
            other => return Err(format!("unknown argument {other}")),
        }
    }
    Ok(options)
}

impl Bridge {
    fn doc(&self, request: &Value) -> Result<String, String> {
        let path = text_field(request, "path")?;
        self.mock
            .entity_id(path)
            .ok_or_else(|| format!("the project has no {path}"))
    }

    fn peer(&mut self, request: &Value) -> &mut MockPeer {
        let name = request["as"].as_str().unwrap_or("bob").to_string();
        let mock = self.mock.clone();
        self.peers
            .entry(name.clone())
            .or_insert_with(|| mock.peer(&name))
    }

    fn joined(&mut self, request: &Value) -> Result<(String, &mut MockPeer), String> {
        let doc = self.doc(request)?;
        let peer = self.peer(request);
        if !peer.is_connected() {
            return Err("the peer lost its connection".into());
        }
        peer.join(&doc);
        Ok((doc, peer))
    }

    fn next_thread(&mut self) -> String {
        self.threads += 1;
        format!("6b04e5f6c0ffee{:010x}", self.threads)
    }

    fn ranges(&self, request: &Value) -> Result<Value, String> {
        let doc = self.doc(request)?;
        if self.history_ot.contains(&doc) {
            return Ok(json!({ "format": "history-ot", "raw": self.mock.raw_doc(&doc) }));
        }
        Ok(json!({ "format": "sharejs-text-ot", "ranges": self.mock.ranges(&doc) }))
    }

    fn comment(&mut self, request: &Value) -> Result<Value, String> {
        let quote = text_field(request, "quote")?.to_string();
        let body = text_field(request, "body")?.to_string();
        let thread = match request["thread"].as_str() {
            Some(thread) => thread.to_string(),
            None => self.next_thread(),
        };
        let (doc, peer) = self.joined(request)?;
        let text = peer.text(&doc);
        let byte = text
            .find(&quote)
            .ok_or_else(|| format!("the text has no {quote:?}"))?;
        let at = units(&text[..byte]);
        let posted = checked(peer.post_message(&thread, &body))?;
        peer.comment(&doc, at, units(&quote), &thread);
        Ok(json!({ "thread": thread, "message": posted["body"] }))
    }

    fn chat(&mut self, request: &Value) -> Result<Value, String> {
        let body = text_field(request, "body")?.to_string();
        let client = request["client_id"].as_str().map(str::to_string);
        let posted = checked(self.peer(request).post_chat(&body, client.as_deref()))?;
        let message = self
            .mock
            .chat_messages()
            .as_array()
            .and_then(|messages| messages.last().cloned())
            .unwrap_or(Value::Null);
        Ok(json!({ "status": posted["status"], "message": message }))
    }

    async fn type_text(&mut self, request: &Value) -> Result<Value, String> {
        let after = text_field(request, "after")?.to_string();
        let text = text_field(request, "text")?.to_string();
        let delay = Duration::from_millis(request["delay_ms"].as_u64().unwrap_or(0));
        let (doc, peer) = self.joined(request)?;
        if !peer.place_caret_after(&doc, &after) {
            return Err(format!("the text has no {after:?}"));
        }
        for character in text.chars() {
            peer.type_at_caret(&doc, &character.to_string());
            if !delay.is_zero() {
                tokio::time::sleep(delay).await;
            }
        }
        Ok(json!({ "text": peer.text(&doc) }))
    }

    fn cursor(&mut self, request: &Value) -> Result<Value, String> {
        let row = number(request, "row")?;
        let column = number(request, "column")?;
        let (doc, peer) = self.joined(request)?;
        peer.emit(
            "clientTracking.updatePosition",
            vec![json!({ "row": row, "column": column, "doc_id": doc })],
        );
        Ok(json!({ "user": peer.user.id }))
    }

    fn delete_entity(&mut self, request: &Value) -> Result<Value, String> {
        let id = self.doc(request)?;
        let kind = if self.mock.file_bytes(text_field(request, "path")?).is_some() {
            "file"
        } else {
            "doc"
        };
        checked(
            self.peer(request)
                .rest("DELETE", &format!("/{kind}/{id}"), None),
        )
    }

    async fn answer(&mut self, request: &Value) -> Result<Value, String> {
        match request["cmd"].as_str() {
            Some("text") => {
                let doc = self.doc(request)?;
                Ok(json!({ "text": self.mock.doc_text(&doc) }))
            }
            Some("crash") => {
                self.mock.crash();
                Ok(json!({}))
            }
            Some("recover") => {
                self.mock.recover();
                Ok(json!({}))
            }
            Some("threads") => Ok(json!({ "threads": self.mock.threads() })),
            Some("ranges") => self.ranges(request),
            Some("peer_comment") => self.comment(request),
            Some("peer_reply") => {
                let thread = text_field(request, "thread")?.to_string();
                let body = text_field(request, "body")?.to_string();
                checked(self.peer(request).post_message(&thread, &body))
            }
            Some("peer_edit_message") => {
                let thread = text_field(request, "thread")?.to_string();
                let message = text_field(request, "message")?.to_string();
                let body = text_field(request, "body")?.to_string();
                checked(self.peer(request).edit_message(&thread, &message, &body))
            }
            Some("peer_delete_message") => {
                let thread = text_field(request, "thread")?.to_string();
                let message = text_field(request, "message")?.to_string();
                let own = request["own"].as_bool().unwrap_or(true);
                checked(self.peer(request).delete_message(&thread, &message, own))
            }
            Some(command @ ("peer_resolve" | "peer_reopen" | "peer_delete_thread")) => {
                let doc = self.doc(request)?;
                let thread = text_field(request, "thread")?.to_string();
                let peer = self.peer(request);
                checked(match command {
                    "peer_resolve" => peer.resolve(&doc, &thread),
                    "peer_reopen" => peer.reopen(&doc, &thread),
                    _ => peer.delete_thread(&doc, &thread),
                })
            }
            Some("peer_track_insert") => {
                let at = number(request, "at")?;
                let text = text_field(request, "text")?.to_string();
                let (doc, peer) = self.joined(request)?;
                peer.track_insert(&doc, at, &text);
                Ok(json!({}))
            }
            Some("peer_track_delete") => {
                let at = number(request, "at")?;
                let length = number(request, "length")?;
                let (doc, peer) = self.joined(request)?;
                peer.track_delete(&doc, at, length);
                Ok(json!({}))
            }
            Some("peer_type") => {
                let at = number(request, "at")?;
                let text = text_field(request, "text")?.to_string();
                let (doc, peer) = self.joined(request)?;
                peer.type_at(&doc, at, &text);
                Ok(json!({}))
            }
            Some("peer_accept") => {
                let doc = self.doc(request)?;
                let ids: Vec<String> = match request["ids"].as_array() {
                    Some(ids) => ids
                        .iter()
                        .filter_map(|id| id.as_str().map(str::to_string))
                        .collect(),
                    None => self.mock.ranges(&doc)["changes"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|change| change["id"].as_str().map(str::to_string))
                        .collect(),
                };
                checked(self.peer(request).accept(&doc, &ids))
            }
            Some("privilege") => {
                let name = text_field(request, "name")?;
                self.mock
                    .set_privilege(name, privilege(text_field(request, "role")?)?);
                Ok(json!({}))
            }
            Some("track_changes") => {
                self.mock.set_track_changes(request["value"].clone());
                Ok(json!({}))
            }
            Some("chat") => Ok(json!({ "messages": self.mock.chat_messages() })),
            Some("peer_chat") => self.chat(request),
            Some("peer_chat_edit") => {
                let message = text_field(request, "message")?.to_string();
                let body = text_field(request, "body")?.to_string();
                checked(self.peer(request).edit_chat(&message, &body))
            }
            Some("peer_chat_delete") => {
                let message = text_field(request, "message")?.to_string();
                checked(self.peer(request).delete_chat(&message))
            }
            Some("type") => self.type_text(request).await,
            Some("peer_cursor") => self.cursor(request),
            Some("exists") => {
                let path = text_field(request, "path")?;
                Ok(json!({ "exists": self.mock.entity_id(path).is_some() }))
            }
            Some("peer_delete") => self.delete_entity(request),
            Some("learned_words") => {
                let name = request["name"].as_str().unwrap_or("alice");
                Ok(json!({ "words": self.mock.learned_words(name) }))
            }
            other => Err(format!("unknown command {other:?}")),
        }
    }
}

#[tokio::main]
async fn main() {
    let options = match options() {
        Ok(options) => options,
        Err(error) => {
            eprintln!("e2e_overleaf: {error}");
            std::process::exit(2);
        }
    };
    let mut project = MockProject::new(&options.name)
        .owner(MockUser::named("olivia"))
        .member(MockUser::named("alice"), Privilege::ReadAndWrite)
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .member(MockUser::named("carol"), Privilege::Review)
        .member(MockUser::named("dave"), Privilege::ReadOnly)
        .doc("main.tex", MAIN)
        .doc(NOTES_PATH, NOTES)
        .root_doc("main.tex");
    for (path, text) in SEEDS {
        project = project.doc(path, text);
    }
    if options.history_ot {
        project = project.format(DocFormat::HistoryOt);
    }
    let mock = MockOverleaf::start(project).await;
    mock.configure(|config| {
        config.sign_in_as = Some("alice".into());
        config.review = true;
    });
    let notes = mock.doc_id(NOTES_PATH);
    mock.set_doc_format(&notes, DocFormat::HistoryOt);
    let paths = ["main.tex", NOTES_PATH]
        .into_iter()
        .chain(SEEDS.iter().map(|(path, _)| *path));
    let mut history_ot = Vec::new();
    let mut docs = serde_json::Map::new();
    for path in paths {
        let id = mock.doc_id(path);
        let later = options.history_ot || path == NOTES_PATH;
        docs.insert(
            path.to_string(),
            json!(if later {
                DocFormat::HistoryOt.wire_name()
            } else {
                DocFormat::ShareJs.wire_name()
            }),
        );
        if later {
            history_ot.push(id);
        }
    }
    let users: serde_json::Map<String, Value> = PEOPLE
        .into_iter()
        .map(|name| (name.to_string(), json!(mock.user(name).id)))
        .collect();
    say(&json!({
        "event": "ready",
        "server": mock.base,
        "project": mock.project_id(),
        "name": options.name,
        "docs": docs,
        "users": users,
    }));
    let mut bridge = Bridge {
        mock,
        peers: BTreeMap::new(),
        threads: 0,
        history_ot,
    };
    let mut requests = read_requests();
    while let Some(line) = requests.recv().await {
        let Ok(request) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if request["cmd"] == "quit" {
            break;
        }
        let id = request["id"].clone();
        match bridge.answer(&request).await {
            Ok(mut reply) => {
                reply["id"] = id;
                reply["ok"] = json!(true);
                say(&reply);
            }
            Err(error) => say(&json!({ "id": id, "ok": false, "error": error })),
        }
    }
}
