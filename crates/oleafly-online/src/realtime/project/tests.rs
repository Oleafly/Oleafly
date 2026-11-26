use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::*;
use crate::realtime::codec;
use crate::realtime::connection::Connection;
use crate::realtime::events::{EntityId, ServerEvent, TreeEvent};
use crate::realtime::tree::{NodeKind, OverleafTree, PathChange, REPLACE_WINDOW};
use crate::realtime::{connect, Carrier, ProjectPage};
use crate::test_support::mock_overleaf::{
    Fault, MockConfig, MockOverleaf, MockProject, MockUser, Privilege, MOCK_CSRF,
};
use crate::test_support::overleaf_rt::{probe, probe_frames, probe_http, recordings, Trace};

const AGENT: &str = "Oleafly/test";
const WAIT: Duration = Duration::from_secs(10);

fn project() -> MockProject {
    MockProject::new("model")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .member(MockUser::named("carol"), Privilege::Review)
        .member(MockUser::named("dave"), Privilege::ReadOnly)
        .token_viewer(MockUser::named("tess"))
        .doc("main.tex", "\\documentclass{article}")
        .doc("sections/intro.tex", "Intro")
        .doc("refs.bib", "@misc{a}")
        .file("figure.png", b"\x89PNG\r\n\x1a\nfake")
        .root_doc("main.tex")
}

struct Rig {
    mock: MockOverleaf,
    http: Http,
}

impl Rig {
    async fn start(project: MockProject) -> Rig {
        let mock = MockOverleaf::start(project).await;
        let http = Http::new(&mock.base, AGENT).unwrap();
        Rig { mock, http }
    }

    fn session(&self, name: &str) -> SessionHandle {
        let user = self.mock.user(name);
        SessionHandle::new(
            &self.mock.base,
            Session {
                cookie: user.cookie(),
                user_id: user.id.clone(),
                email: user.email.clone(),
                saved_by: None,
            },
            None,
        )
    }

    async fn join(&self, name: &str) -> (Connection, ProjectState) {
        let session = self.session(name);
        let page = ProjectPage::load(&self.http, &session, &self.mock.project_id(), false)
            .await
            .unwrap();
        let (connection, join) = connect(&self.http, &session, &page, &[Carrier::WebSocket])
            .await
            .unwrap();
        (connection, ProjectState::from_join(join.response).unwrap())
    }

    async fn rejoin(&self, name: &str) -> (Connection, Value) {
        let session = self.session(name);
        let page = ProjectPage::unloaded(&self.mock.project_id()).unwrap();
        let (connection, join) = connect(&self.http, &session, &page, &[Carrier::WebSocket])
            .await
            .unwrap();
        (connection, join.response)
    }

    async fn post(&self, path: &str, body: Value) -> u16 {
        self.http
            .post(
                &format!("/project/{}{path}", self.mock.project_id()),
                &self.mock.user("alice").cookie(),
            )
            .header("X-Csrf-Token", MOCK_CSRF)
            .json(&body)
            .send()
            .await
            .unwrap()
            .status()
            .as_u16()
    }

    async fn delete(&self, path: &str) -> u16 {
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .delete(
                self.http
                    .url(&format!("/project/{}{path}", self.mock.project_id())),
            )
            .header("Cookie", self.mock.user("alice").cookie())
            .header("X-Csrf-Token", MOCK_CSRF)
            .send()
            .await
            .unwrap()
            .status()
            .as_u16()
    }

    async fn upload(&self, name: &str, bytes: &[u8]) -> Value {
        let mut body =
            b"--XyZ\r\nContent-Disposition: form-data; name=\"qqfile\"; filename=\"".to_vec();
        body.extend_from_slice(name.as_bytes());
        body.extend_from_slice(b"\"\r\nContent-Type: application/octet-stream\r\n\r\n");
        body.extend_from_slice(bytes);
        body.extend_from_slice(b"\r\n--XyZ--\r\n");
        self.http
            .post(
                &format!(
                    "/project/{}/upload?folder_id={}",
                    self.mock.project_id(),
                    self.mock.root_folder_id()
                ),
                &self.mock.user("alice").cookie(),
            )
            .header("X-Csrf-Token", MOCK_CSRF)
            .header("Content-Type", "multipart/form-data; boundary=XyZ")
            .body(body)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap()
    }
}

async fn tree_events(connection: &mut Connection, count: usize) -> Vec<TreeEvent> {
    let mut found = Vec::new();
    while found.len() < count {
        match tokio::time::timeout(WAIT, connection.next_event()).await {
            Ok(Some(ServerEvent::Tree(event))) => found.push(event),
            Ok(Some(_)) => {}
            other => panic!("expected {count} tree events, got {found:?} then {other:?}"),
        }
    }
    found
}

async fn next_matching(
    connection: &mut Connection,
    wanted: impl Fn(&ServerEvent) -> bool,
) -> ServerEvent {
    loop {
        match tokio::time::timeout(WAIT, connection.next_event()).await {
            Ok(Some(event)) if wanted(&event) => return event,
            Ok(Some(_)) => {}
            other => panic!("the event never came: {other:?}"),
        }
    }
}

fn recorded_events(name: &str) -> Vec<ServerEvent> {
    probe_frames(name, "websocket")
        .iter()
        .filter(|frame| !frame.outgoing)
        .filter_map(|frame| codec::decode(&frame.raw).ok()?.into_event())
        .filter(|(event, _)| event != "joinProjectResponse")
        .map(|(event, args)| ServerEvent::from_wire(&event, &args))
        .collect()
}

fn recorded_join(name: &str) -> Value {
    probe_frames(name, "websocket")
        .iter()
        .filter(|frame| !frame.outgoing)
        .find_map(
            |frame| match codec::decode(&frame.raw).ok()?.into_event()? {
                (event, mut args) if event == "joinProjectResponse" => Some(args.remove(0)),
                _ => None,
            },
        )
        .unwrap()
}

fn entity(id: &str) -> EntityId {
    EntityId(id.to_string())
}

fn joins_in(trace: &Trace) -> Vec<Value> {
    trace
        .packets()
        .filter(|(outgoing, _)| !outgoing)
        .filter_map(|(_, packet)| packet.into_event())
        .filter(|(name, _)| name == "joinProjectResponse")
        .filter_map(|(_, mut args)| (!args.is_empty()).then(|| args.remove(0)))
        .collect()
}

fn recorded_role(participant: &str) -> Role {
    match participant {
        "alice" => Role::Owner,
        "bob" => Role::Editor,
        "carol" => Role::Reviewer,
        "dave" => Role::Viewer,
        other => panic!("unexpected participant {other}"),
    }
}

fn check_recorded_join(scenario: &str, trace: &Trace, join: Value) {
    let state = ProjectState::from_join(join.clone()).unwrap();
    let paths = state.tree.paths();
    let missing: Vec<&str> = [
        "main.tex",
        "sections/intro.tex",
        "sections/method.tex",
        "refs.bib",
        "figure.png",
    ]
    .into_iter()
    .filter(|wanted| !paths.iter().any(|path| path == wanted))
    .collect();
    assert!(
        missing.is_empty(),
        "{scenario}: {missing:?} not in {paths:?}"
    );
    assert_eq!(state.settings().main_doc.as_deref(), Some("main.tex"));
    assert_eq!(state.protocol_version, Some(2));
    assert!(!state.restricted);
    assert!(!state.deleted_externally);
    let figure = state.tree.id_at("figure.png").unwrap().clone();
    let node = state.tree.node(&figure).unwrap();
    assert_eq!(node.kind, NodeKind::File);
    assert_eq!(node.hash.as_ref().map(String::len), Some(40));
    let sections = state.tree.id_at("sections").unwrap().clone();
    assert_eq!(state.tree.node(&sections).unwrap().kind, NodeKind::Folder);
    let expected = recorded_role(&trace.name);
    assert_eq!(state.role, expected, "{scenario} {}", trace.name);
    assert_eq!(state.members.role_of(&trace.user_id), Some(expected));
    assert_eq!(state.public_id.0, join["publicId"].as_str().unwrap());
    assert!(state.tree.paths_report().is_ok());
    assert_eq!(state.tree.nodes().len(), state.tree.paths().len() + 1);
    assert_eq!(
        super::settings_from_project(&join["project"]),
        state.settings()
    );
}

#[test]
fn join_project_response_builds_tree() {
    let mut joins = 0;
    for recording in recordings().into_iter().filter(|recording| {
        matches!(
            recording.project.as_str(),
            "sharejs-project" | "history-ot-project"
        )
    }) {
        for trace in &recording.traces {
            for join in joins_in(trace) {
                joins += 1;
                check_recorded_join(&recording.name, trace, join);
            }
        }
    }
    assert!(joins > 20, "{joins} joins");
}

#[test]
fn rename_and_move_events_update_paths() {
    let recording = recordings()
        .into_iter()
        .find(|recording| recording.name == "rename-while-open")
        .unwrap();
    let trace = &recording.traces[0];
    let mut state = ProjectState::from_join(joins_in(trace).remove(0)).unwrap();
    let renames: Vec<TreeEvent> = trace
        .packets()
        .filter_map(|(outgoing, packet)| (!outgoing).then_some(packet))
        .filter_map(|packet| packet.into_event())
        .filter_map(|(name, args)| match ServerEvent::from_wire(&name, &args) {
            ServerEvent::Tree(event) => Some(event),
            _ => None,
        })
        .collect();
    assert!(!renames.is_empty());
    let now = Instant::now();
    let TreeEvent::Renamed { id, name } = &renames[0] else {
        panic!("{renames:?}");
    };
    let before = state.tree.path_of(id).unwrap();
    assert_eq!(
        state.tree.apply(&renames[0], now),
        vec![PathChange::Moved {
            id: id.clone(),
            from: before,
            to: name.clone(),
            kind: NodeKind::Doc,
        }]
    );

    let intro = state.tree.id_at("sections/intro.tex").unwrap().clone();
    let method = state.tree.id_at("sections/method.tex").unwrap().clone();
    let sections = state.tree.id_at("sections").unwrap().clone();
    let root = state.tree.root().unwrap().clone();
    let changes = state.tree.apply(
        &TreeEvent::Renamed {
            id: sections.clone(),
            name: "chapters".into(),
        },
        now,
    );
    assert_eq!(
        changes,
        vec![
            PathChange::Moved {
                id: sections.clone(),
                from: "sections".into(),
                to: "chapters".into(),
                kind: NodeKind::Folder
            },
            PathChange::Moved {
                id: intro.clone(),
                from: "sections/intro.tex".into(),
                to: "chapters/intro.tex".into(),
                kind: NodeKind::Doc
            },
            PathChange::Moved {
                id: method.clone(),
                from: "sections/method.tex".into(),
                to: "chapters/method.tex".into(),
                kind: NodeKind::Doc
            },
        ]
    );
    let main = state.tree.id_at("main.tex").unwrap().clone();
    assert_eq!(
        state.tree.apply(
            &TreeEvent::Moved {
                id: main.clone(),
                folder: sections.clone()
            },
            now
        ),
        vec![PathChange::Moved {
            id: main.clone(),
            from: "main.tex".into(),
            to: "chapters/main.tex".into(),
            kind: NodeKind::Doc
        }]
    );
    assert_eq!(
        state.settings().main_doc.as_deref(),
        Some("chapters/main.tex")
    );
    assert!(state
        .tree
        .apply(
            &TreeEvent::Moved {
                id: sections.clone(),
                folder: sections.clone()
            },
            now
        )
        .is_empty());
    assert!(state
        .tree
        .apply(
            &TreeEvent::Moved {
                id: main.clone(),
                folder: entity("missing")
            },
            now
        )
        .is_empty());
    assert!(state
        .tree
        .apply(
            &TreeEvent::Renamed {
                id: root,
                name: "x".into()
            },
            now
        )
        .is_empty());
    assert!(state
        .tree
        .apply(
            &TreeEvent::Renamed {
                id: entity("missing"),
                name: "x".into()
            },
            now
        )
        .is_empty());
}

#[tokio::test]
async fn rename_and_move_from_the_server_reach_the_tree() {
    let rig = Rig::start(project()).await;
    let (mut connection, mut state) = rig.join("alice").await;
    let main = rig.mock.doc_id("main.tex");
    let sections = rig.mock.entity_id("sections").unwrap();
    assert_eq!(
        rig.post(
            &format!("/doc/{main}/rename"),
            json!({ "name": "paper.tex" })
        )
        .await,
        204
    );
    assert_eq!(
        rig.post(
            &format!("/doc/{main}/move"),
            json!({ "folder_id": sections })
        )
        .await,
        204
    );
    let now = Instant::now();
    let changes: Vec<PathChange> = tree_events(&mut connection, 2)
        .await
        .iter()
        .flat_map(|event| state.tree.apply(event, now))
        .collect();
    assert_eq!(
        changes,
        vec![
            PathChange::Moved {
                id: entity(&main),
                from: "main.tex".into(),
                to: "paper.tex".into(),
                kind: NodeKind::Doc
            },
            PathChange::Moved {
                id: entity(&main),
                from: "paper.tex".into(),
                to: "sections/paper.tex".into(),
                kind: NodeKind::Doc
            },
        ]
    );
    connection.close().await;
}

#[tokio::test]
async fn remove_entity_with_convert_flag_changes_kind() {
    let rig = Rig::start(project().doc("notes.tex", "notes")).await;
    let (mut connection, mut state) = rig.join("alice").await;
    let notes = rig.mock.doc_id("notes.tex");
    let uploaded = rig.upload("notes.tex", b"\x00binary now").await;
    assert_eq!(uploaded["entity_type"], "file");
    let events = tree_events(&mut connection, 2).await;
    assert_eq!(
        events[0],
        TreeEvent::Removed {
            id: entity(&notes),
            restoring: false
        }
    );
    let now = Instant::now();
    let changes: Vec<PathChange> = events
        .iter()
        .flat_map(|event| state.tree.apply(event, now))
        .collect();
    let new = entity(uploaded["entity_id"].as_str().unwrap());
    assert_eq!(
        changes,
        vec![PathChange::Replaced {
            old: entity(&notes),
            new: new.clone(),
            path: "notes.tex".into(),
            from: NodeKind::Doc,
            to: NodeKind::File,
        }]
    );
    assert_eq!(state.tree.node(&new).unwrap().kind, NodeKind::File);

    let back = rig.upload("notes.tex", b"text again").await;
    assert_eq!(back["entity_type"], "doc");
    let events = tree_events(&mut connection, 2).await;
    assert_eq!(
        events[0],
        TreeEvent::Removed {
            id: new.clone(),
            restoring: false
        }
    );
    let changes: Vec<PathChange> = events
        .iter()
        .flat_map(|event| state.tree.apply(event, now))
        .collect();
    assert_eq!(
        changes,
        vec![PathChange::Replaced {
            old: new,
            new: entity(back["entity_id"].as_str().unwrap()),
            path: "notes.tex".into(),
            from: NodeKind::File,
            to: NodeKind::Doc,
        }]
    );
    connection.close().await;

    let mut ce = ProjectState::from_join(recorded_join("upload-replace-and-convert")).unwrap();
    let now = Instant::now();
    let mut kinds = Vec::new();
    for event in recorded_events("upload-replace-and-convert") {
        if let ServerEvent::Tree(event) = event {
            kinds.extend(ce.tree.apply(&event, now).into_iter().map(described));
        }
    }
    kinds.extend(ce.tree.flush().into_iter().map(described));
    assert_eq!(
        kinds,
        vec![
            "added Doc",
            "replaced Doc with File",
            "replaced File with Doc",
            "added File",
            "replaced File with File",
            "removed Doc",
            "removed File",
        ]
    );
}

fn described(change: PathChange) -> String {
    match change {
        PathChange::Added { kind, .. } => format!("added {kind:?}"),
        PathChange::Replaced { from, to, .. } => format!("replaced {from:?} with {to:?}"),
        PathChange::Moved { kind, .. } => format!("moved {kind:?}"),
        PathChange::Removed { kind, .. } => format!("removed {kind:?}"),
    }
}

#[tokio::test]
async fn remove_then_new_on_same_path_is_a_replace() {
    let rig = Rig::start(project()).await;
    let (mut connection, mut state) = rig.join("alice").await;
    let old = rig.mock.entity_id("figure.png").unwrap();
    let uploaded = rig.upload("figure.png", b"\x89PNG\r\n\x1a\nnewer").await;
    let events = tree_events(&mut connection, 2).await;
    assert_eq!(
        events[0],
        TreeEvent::Removed {
            id: entity(&old),
            restoring: false
        }
    );
    let now = Instant::now();
    let changes: Vec<PathChange> = events
        .iter()
        .flat_map(|event| state.tree.apply(event, now))
        .collect();
    let new = entity(uploaded["entity_id"].as_str().unwrap());
    assert_eq!(
        changes,
        vec![PathChange::Replaced {
            old: entity(&old),
            new: new.clone(),
            path: "figure.png".into(),
            from: NodeKind::File,
            to: NodeKind::File,
        }]
    );
    assert_eq!(state.tree.next_due(), None);
    connection.close().await;

    let refs = state.tree.id_at("refs.bib").unwrap().clone();
    let root = state.tree.root().unwrap().clone();
    let start = Instant::now();
    assert!(state
        .tree
        .apply(
            &TreeEvent::Removed {
                id: refs.clone(),
                restoring: false
            },
            start
        )
        .is_empty());
    assert_eq!(state.tree.next_due(), Some(start + REPLACE_WINDOW));
    assert!(state
        .tree
        .due(start + Duration::from_millis(500))
        .is_empty());
    let late = state.tree.apply(
        &TreeEvent::NewDoc {
            folder: root.clone(),
            id: entity("fresh-refs"),
            name: "refs.bib".into(),
        },
        start + Duration::from_millis(1500),
    );
    assert_eq!(
        late,
        vec![
            PathChange::Removed {
                id: refs,
                path: "refs.bib".into(),
                kind: NodeKind::Doc
            },
            PathChange::Added {
                id: entity("fresh-refs"),
                path: "refs.bib".into(),
                kind: NodeKind::Doc
            },
        ]
    );
    let sections = state.tree.id_at("sections").unwrap().clone();
    let intro = state.tree.id_at("sections/intro.tex").unwrap().clone();
    assert!(state
        .tree
        .apply(
            &TreeEvent::Removed {
                id: sections.clone(),
                restoring: false
            },
            start
        )
        .is_empty());
    assert_eq!(state.tree.id_at("sections/intro.tex"), None);
    assert_eq!(
        state.tree.flush(),
        vec![
            PathChange::Removed {
                id: sections,
                path: "sections".into(),
                kind: NodeKind::Folder
            },
            PathChange::Removed {
                id: intro,
                path: "sections/intro.tex".into(),
                kind: NodeKind::Doc
            },
        ]
    );
    assert!(state
        .tree
        .apply(
            &TreeEvent::NewDoc {
                folder: root,
                id: entity("fresh-refs"),
                name: "again.tex".into()
            },
            start
        )
        .is_empty());
}

#[test]
fn windows_invalid_names_checked_on_every_os() {
    let tree = |names: &[&str]| {
        OverleafTree::from_root_folder(&json!([{
            "_id": "root",
            "name": "rootFolder",
            "docs": names.iter().enumerate().map(|(at, name)| json!({ "_id": format!("d{at}"), "name": name })).collect::<Vec<_>>(),
            "fileRefs": [],
            "folders": [{ "_id": "f", "name": "figures", "docs": [], "fileRefs": [{ "_id": "x", "name": "plot.png", "hash": "h" }], "folders": [] }],
        }]))
        .unwrap()
    };
    assert!(tree(&["main.tex", "notes.md"]).paths_report().is_ok());
    for invalid in ["con.tex", "a:b.tex", "what?.tex", "trailing. ", "NUL"] {
        let error = tree(&["main.tex", invalid]).paths_report().unwrap_err();
        assert_eq!(error.kind, OnlineErrorKind::SyncInvalidNames, "{invalid}");
    }
    let clash = tree(&["Main.tex", "main.tex"]).paths_report().unwrap_err();
    assert_eq!(clash.kind, OnlineErrorKind::SyncCaseClash);
    assert_eq!(
        tree(&["main.tex"]).paths(),
        vec!["figures/plot.png".to_string(), "main.tex".to_string()]
    );
}

#[tokio::test]
async fn protocol_version_change_between_connects_rejoins_everything() {
    let rig = Rig::start(project()).await;
    let (connection, mut state) = rig.join("alice").await;
    assert_eq!(state.protocol_version, Some(2));
    connection.close().await;
    let (connection, same) = rig.rejoin("alice").await;
    assert_eq!(state.rejoin(same).unwrap(), Rejoined::Repaired(Vec::new()));
    connection.close().await;
    rig.mock.configure(|config| config.protocol_version = 3);
    let (connection, changed) = rig.rejoin("alice").await;
    let public = changed["publicId"].as_str().unwrap().to_string();
    assert_eq!(
        state.rejoin(changed).unwrap(),
        Rejoined::Everything {
            from: Some(2),
            to: Some(3)
        }
    );
    assert_eq!(state.protocol_version, Some(3));
    assert_eq!(state.public_id.0, public);
    connection.close().await;
    rig.mock.configure(|config| config.protocol_version = 99);
    let (connection, unknown) = rig.rejoin("alice").await;
    assert!(matches!(
        state.rejoin(unknown),
        Ok(Rejoined::Everything { to: Some(99), .. })
    ));
    connection.close().await;
}

#[tokio::test]
async fn root_folder_diff_repairs_missed_tree_events() {
    let rig = Rig::start(project()).await;
    let (connection, mut state) = rig.join("alice").await;
    connection.close().await;
    let main = rig.mock.doc_id("main.tex");
    let refs = rig.mock.doc_id("refs.bib");
    let intro = rig.mock.doc_id("sections/intro.tex");
    let sections = rig.mock.entity_id("sections").unwrap();
    let figure = rig.mock.entity_id("figure.png").unwrap();
    assert_eq!(
        rig.post(
            &format!("/doc/{main}/rename"),
            json!({ "name": "paper.tex" })
        )
        .await,
        204
    );
    assert_eq!(
        rig.post(
            &format!("/folder/{sections}/rename"),
            json!({ "name": "chapters" })
        )
        .await,
        204
    );
    assert_eq!(rig.delete(&format!("/doc/{refs}")).await, 204);
    let added = rig.upload("new.tex", b"fresh").await;
    let replaced = rig.upload("figure.png", b"\x89PNG\r\n\x1a\nreplaced").await;
    let (connection, fresh) = rig.rejoin("alice").await;
    let changes = match state.rejoin(fresh.clone()).unwrap() {
        Rejoined::Repaired(changes) => changes,
        other => panic!("{other:?}"),
    };
    assert_eq!(
        changes,
        vec![
            PathChange::Removed {
                id: entity(&refs),
                path: "refs.bib".into(),
                kind: NodeKind::Doc
            },
            PathChange::Moved {
                id: entity(&sections),
                from: "sections".into(),
                to: "chapters".into(),
                kind: NodeKind::Folder
            },
            PathChange::Moved {
                id: entity(&intro),
                from: "sections/intro.tex".into(),
                to: "chapters/intro.tex".into(),
                kind: NodeKind::Doc
            },
            PathChange::Moved {
                id: entity(&main),
                from: "main.tex".into(),
                to: "paper.tex".into(),
                kind: NodeKind::Doc
            },
            PathChange::Replaced {
                old: entity(&figure),
                new: entity(replaced["entity_id"].as_str().unwrap()),
                path: "figure.png".into(),
                from: NodeKind::File,
                to: NodeKind::File,
            },
            PathChange::Added {
                id: entity(added["entity_id"].as_str().unwrap()),
                path: "new.tex".into(),
                kind: NodeKind::Doc,
            },
        ]
    );
    let rebuilt = ProjectState::from_join(fresh).unwrap();
    assert_eq!(state.tree.nodes(), rebuilt.tree.nodes());
    assert_eq!(state.settings().main_doc.as_deref(), Some("paper.tex"));
    connection.close().await;
}

#[tokio::test]
async fn members_and_privileges_from_join() {
    let rig = Rig::start(project()).await;
    let (mut connection, mut state) = rig.join("alice").await;
    let id = |name: &str| rig.mock.user(name).id;
    assert_eq!(state.role, Role::Owner);
    assert_eq!(
        state
            .members
            .owner
            .as_ref()
            .map(|owner| owner.email.as_str()),
        Some("alice@example.test")
    );
    assert_eq!(state.members.role_of(&id("alice")), Some(Role::Owner));
    assert_eq!(state.members.role_of(&id("bob")), Some(Role::Editor));
    assert_eq!(state.members.role_of(&id("carol")), Some(Role::Reviewer));
    assert_eq!(state.members.role_of(&id("dave")), Some(Role::Viewer));
    assert_eq!(state.members.role_of(&id("tess")), None);
    assert_eq!(
        state
            .members
            .all()
            .map(|member| member.role.collab_name())
            .collect::<Vec<_>>(),
        vec!["owner", "editor", "reviewer", "viewer"]
    );
    rig.mock
        .set_privilege("dave", Some(Privilege::ReadAndWrite));
    let ServerEvent::Access(changed) = next_matching(&mut connection, |event| {
        matches!(event, ServerEvent::Access(_))
    })
    .await
    else {
        panic!("an access event");
    };
    assert_eq!(
        changed,
        AccessEvent::AccessLevelChanged {
            user_id: Some(id("dave"))
        }
    );
    assert!(state.apply_access(&changed));
    let session = rig.session("alice");
    let project_id = rig.mock.project_id();
    state.members.collaborators = Members::fetch_collaborators(&rig.http, &session, &project_id)
        .await
        .unwrap();
    assert_eq!(state.members.role_of(&id("dave")), Some(Role::Editor));
    rig.mock.set_privilege("bob", None);
    assert_eq!(
        next_matching(&mut connection, |event| matches!(
            event,
            ServerEvent::Access(_)
        ))
        .await,
        ServerEvent::Access(AccessEvent::UserRemoved(Some(id("bob"))))
    );
    next_matching(&mut connection, |event| {
        event
            == &ServerEvent::Access(AccessEvent::MembersChanged {
                members: true,
                invites: false,
            })
    })
    .await;
    assert!(state.apply_access(&AccessEvent::MembersChanged {
        members: true,
        invites: false,
    }));
    assert!(!state.apply_access(&AccessEvent::MembersChanged {
        members: false,
        invites: true,
    }));
    assert!(!state.apply_access(&AccessEvent::UserRemoved(Some(id("bob")))));
    state.members.collaborators = Members::fetch_collaborators(&rig.http, &session, &project_id)
        .await
        .unwrap();
    assert_eq!(state.members.role_of(&id("bob")), None);
    assert_eq!(state.members.role_of(&id("alice")), Some(Role::Owner));
    connection.close().await;

    let (viewer, mut restricted) = rig.join("tess").await;
    assert_eq!(restricted.role, Role::Viewer);
    assert!(restricted.restricted);
    assert!(restricted.members.owner.is_none());
    assert!(restricted.members.collaborators.is_empty());
    let members_route = format!("/project/{}/members", rig.mock.project_id());
    let tess = rig.session("tess");
    assert!(!restricted.apply_access(&AccessEvent::MembersChanged {
        members: true,
        invites: false,
    }));
    let refused = rig
        .http
        .get(&members_route, &tess.cookie())
        .send()
        .await
        .unwrap();
    assert_eq!(refused.status().as_u16(), 403);
    viewer.close().await;

    let ce_restricted = ProjectState::from_join(recorded_join("restricted-link-join")).unwrap();
    assert!(ce_restricted.restricted);
    assert_eq!(ce_restricted.role, Role::Viewer);
    assert!(ce_restricted.members.owner.is_none());
    assert!(ce_restricted.members.collaborators.is_empty());
    let ce_members = probe_http("restricted-link-join", "/members");
    assert_eq!(ce_members["status"], 403);
    assert_eq!(ce_members["body"], json!({ "message": "restricted" }));
    let dave = probe("collaborator-access-change")["steps"][0]["request"]["route"]
        .as_str()
        .unwrap()
        .rsplit('/')
        .next()
        .unwrap()
        .to_string();
    let ce_changes: Vec<ServerEvent> = recorded_events("collaborator-access-change")
        .into_iter()
        .filter(|event| matches!(event, ServerEvent::Access(_)))
        .collect();
    let changed = ServerEvent::Access(AccessEvent::AccessLevelChanged {
        user_id: Some(dave),
    });
    assert_eq!(ce_changes, vec![changed.clone(), changed]);

    let recorded = probe_http("rest-reads", "/members");
    let listed = recorded["body"]["members"].as_array().unwrap();
    let recording = recordings()
        .into_iter()
        .find(|recording| recording.project == "sharejs-project")
        .unwrap();
    let from_join = ProjectState::from_join(joins_in(&recording.traces[0]).remove(0)).unwrap();
    assert_eq!(from_join.members.collaborators.len(), listed.len());
    for member in listed {
        let email = member["email"].as_str().unwrap();
        let joined = from_join
            .members
            .collaborators
            .iter()
            .find(|known| known.email == email)
            .unwrap_or_else(|| panic!("{email} is a collaborator in the join"));
        assert_eq!(
            Some(joined.role),
            Role::from_privilege(member["privileges"].as_str().unwrap())
        );
    }
}

#[tokio::test]
async fn settings_events_become_typed_project_events() {
    let rig = Rig::start(project()).await;
    let (mut connection, mut state) = rig.join("alice").await;
    let intro = rig.mock.doc_id("sections/intro.tex");
    let refs = rig.mock.doc_id("refs.bib");
    let status = rig
        .post(
            "/settings",
            json!({
                "compiler": "xelatex",
                "imageName": "quay.io/sharelatex/texlive-full:2025.1",
                "name": "Thesis",
                "spellCheckLanguage": "de",
                "rootDocId": intro,
                "mainBibliographyDocId": refs,
            }),
        )
        .await;
    assert_eq!(status, 204);
    let recorded: Vec<ProjectEvent> = recorded_events("settings-events")
        .into_iter()
        .filter_map(|event| match event {
            ServerEvent::Project(event) => Some(event),
            _ => None,
        })
        .collect();
    assert_eq!(
        recorded[..6],
        [
            ProjectEvent::Compiler("xelatex".into()),
            ProjectEvent::Name("sharejs-project (settings probe)".into()),
            ProjectEvent::SpellLanguage("de".into()),
            ProjectEvent::RootDoc(DocId("6af963edc9037022065bb54f".into())),
            ProjectEvent::MainBibliography(DocId("6af963edc9037022065bb55e".into())),
            ProjectEvent::Image("texlive-full:2025.1".into()),
        ]
    );
    let mut events = Vec::new();
    while events.len() < 6 {
        if let ServerEvent::Project(event) = next_matching(&mut connection, |event| {
            matches!(event, ServerEvent::Project(_))
        })
        .await
        {
            events.push(event);
        }
    }
    assert_eq!(
        events,
        vec![
            ProjectEvent::Compiler("xelatex".into()),
            ProjectEvent::Image("quay.io/sharelatex/texlive-full:2025.1".into()),
            ProjectEvent::Name("Thesis".into()),
            ProjectEvent::SpellLanguage("de".into()),
            ProjectEvent::RootDoc(DocId(intro.clone())),
            ProjectEvent::MainBibliography(DocId(refs.clone())),
        ]
    );
    for event in &events {
        state.apply_project(event);
    }
    assert_eq!(
        state.settings(),
        ProjectSettings {
            compiler: Some("xelatex".into()),
            main_doc: Some("sections/intro.tex".into()),
            tex_live: Some("2025".into()),
        }
    );
    assert_eq!(state.name, "Thesis");
    assert_eq!(state.spell_language.as_deref(), Some("de"));
    assert_eq!(state.main_bibliography, Some(DocId(refs)));
    assert_eq!(
        state.compiler.as_deref().and_then(flavor_for_compiler),
        Some("xelatex")
    );
    connection.close().await;
    let (connection, fresh) = rig.rejoin("alice").await;
    let rejoined = ProjectState::from_join(fresh).unwrap();
    assert_eq!(rejoined.settings(), state.settings());
    connection.close().await;
    state.apply_project(&ProjectEvent::DeletedOrRenamedExternally);
    assert!(state.deleted_externally);
    let reader = rig.session("dave");
    let refused = rig
        .http
        .post(
            &format!("/project/{}/settings", rig.mock.project_id()),
            &reader.cookie(),
        )
        .header("X-Csrf-Token", MOCK_CSRF)
        .json(&json!({ "compiler": "lualatex" }))
        .send()
        .await
        .unwrap();
    assert_eq!(refused.status().as_u16(), 403);
}

#[tokio::test]
async fn a_compiler_echo_reads_the_way_the_server_stores_it() {
    let rig = Rig::start(project()).await;
    let (mut connection, mut state) = rig.join("alice").await;
    let project_event = |event: &ServerEvent| matches!(event, ServerEvent::Project(_));
    assert_eq!(
        rig.post("/settings", json!({ "compiler": "LuaLaTeX" }))
            .await,
        204
    );
    let echo = next_matching(&mut connection, project_event).await;
    assert_eq!(
        echo,
        ServerEvent::Project(ProjectEvent::Compiler("lualatex".into()))
    );
    let ServerEvent::Project(echo) = echo else {
        unreachable!()
    };
    state.apply_project(&echo);
    assert_eq!(rig.post("/settings", json!({ "compiler": "" })).await, 204);
    assert_eq!(
        rig.post("/settings", json!({ "spellCheckLanguage": "fr" }))
            .await,
        204
    );
    assert_eq!(
        next_matching(&mut connection, project_event).await,
        ServerEvent::Project(ProjectEvent::SpellLanguage("fr".into())),
        "an empty compiler echo changes nothing"
    );
    connection.close().await;
    let (connection, fresh) = rig.rejoin("alice").await;
    let rejoined = ProjectState::from_join(fresh).unwrap();
    assert_eq!(rejoined.compiler, state.compiler);
    assert_eq!(state.compiler.as_deref(), Some("lualatex"));
    connection.close().await;
}

#[tokio::test]
async fn track_changes_state_for_me_and_for_everyone_and_guests_never_applies() {
    let everyone = TrackChanges::from_value(&json!(true));
    assert!(everyone.applies_to("u1") && everyone.applies_to("u2"));
    let some = TrackChanges::from_value(&json!({ "u1": true, "u2": false, "__guests__": true }));
    assert!(some.applies_to("u1"));
    assert!(!some.applies_to("u2"));
    assert!(!some.applies_to("u3"));
    assert!(!some.applies_to("__guests__"));
    assert!(!some.applies_to(""));
    assert_eq!(
        some,
        TrackChanges::Some {
            users: ["u1".to_string()].into(),
            guests: true
        }
    );
    let guests_only = TrackChanges::from_value(&json!({ "__guests__": true }));
    assert!(!guests_only.applies_to("u1"));
    for off in [json!(false), Value::Null, json!({}), json!("yes")] {
        assert!(!TrackChanges::from_value(&off).applies_to("u1"), "{off}");
    }
    let carol = recordings()
        .into_iter()
        .find(|recording| recording.name == "history-ot-tracked-delete")
        .unwrap();
    for trace in &carol.traces {
        let state = ProjectState::from_join(joins_in(trace).remove(0)).unwrap();
        let carol_id = carol
            .traces
            .iter()
            .find(|trace| trace.name == "carol")
            .unwrap()
            .user_id
            .clone();
        assert!(state.tracks_changes_for(&carol_id), "{}", trace.name);
        assert!(!state.tracks_changes_for(&trace.user_id) || trace.user_id == carol_id);
    }

    let rig = Rig::start(project().track_changes(json!({}))).await;
    let (mut connection, mut state) = rig.join("bob").await;
    let bob = rig.mock.user("bob").id;
    assert!(!state.tracks_changes_for(&bob));
    rig.mock.set_track_changes(json!({ bob.clone(): true }));
    let ServerEvent::Access(event) = next_matching(&mut connection, |event| {
        matches!(event, ServerEvent::Access(_))
    })
    .await
    else {
        panic!("an access event");
    };
    state.apply_access(&event);
    assert!(state.tracks_changes_for(&bob));
    assert!(!state.tracks_changes_for(&rig.mock.user("alice").id));
    connection.close().await;
    let missing = json!({
        "publicId": "P.1",
        "permissionsLevel": "owner",
        "project": { "rootFolder": [{ "_id": "r", "name": "rootFolder" }], "owner": { "_id": "o", "privileges": "owner", "email": "o@x" } },
    });
    assert_eq!(
        ProjectState::from_join(missing).unwrap().track_changes,
        TrackChanges::Off
    );
}

#[tokio::test]
async fn the_plan_and_the_review_module_show_in_the_join() {
    let recording = recordings()
        .into_iter()
        .find(|recording| recording.name == "history-ot-tracked-delete")
        .unwrap();
    let ce = ProjectState::from_join(joins_in(&recording.traces[0]).remove(0)).unwrap();
    assert!(ce.plan_tracks_changes());
    let rig = Rig::start(project()).await;
    rig.mock.configure(|config| config.review = true);
    let (connection, pro) = rig.join("alice").await;
    assert!(pro.plan_tracks_changes());
    connection.close().await;
    let page = ProjectPage::load(
        &rig.http,
        &rig.session("alice"),
        &rig.mock.project_id(),
        false,
    )
    .await
    .unwrap();
    assert!(page.has_track_changes_feature());
    rig.mock.configure(|config| config.review = false);
    page.reload(&rig.http, &rig.session("alice"), false)
        .await
        .unwrap();
    assert!(!page.has_track_changes_feature());
    assert!(!ProjectState::unjoined().plan_tracks_changes());
}

#[tokio::test]
async fn capabilities_probe_ce_and_pro() {
    let recorded = |route: &str| probe_http("rest-reads", route)["status"].as_u64().unwrap();
    assert_eq!(recorded("/threads"), 404);
    assert_eq!(recorded("/messages"), 200);
    let community = MockConfig::default();
    assert_eq!((community.review, community.chat), (false, true));

    let rig = Rig::start(project()).await;
    let session = rig.session("alice");
    let project_id = rig.mock.project_id();
    let cache = CapabilityCache::default();
    assert_eq!(cache.get(&rig.http.origin), None);
    let ce = cache
        .refresh(&rig.http, &session, &project_id, &json!({}))
        .await;
    assert_eq!(
        ce,
        Capabilities {
            review: Some(false),
            chat: Some(true)
        }
    );
    assert_eq!(cache.get(&rig.http.origin), Some(ce));

    rig.mock.configure(|config| {
        config.review = true;
        config.chat = false;
    });
    let pro = cache
        .refresh(&rig.http, &session, &project_id, &json!({ "chat": true }))
        .await;
    assert_eq!(
        pro,
        Capabilities {
            review: Some(true),
            chat: Some(true)
        }
    );
    let no_chat = cache
        .refresh(&rig.http, &session, &project_id, &json!({}))
        .await;
    assert_eq!(
        no_chat,
        Capabilities {
            review: Some(true),
            chat: Some(false)
        }
    );

    let threads = format!("/project/{project_id}/threads");
    let messages = format!("/project/{project_id}/messages");
    let busy = || Fault::Reply(503, "Service Unavailable".into());
    rig.mock.plan_fault(Some("GET"), &threads, busy());
    let recovered = cache
        .refresh(&rig.http, &session, &project_id, &json!({}))
        .await;
    assert_eq!(recovered, no_chat);
    assert_eq!(rig.mock.requests(&threads).len(), 5);

    for _ in 0..3 {
        rig.mock.plan_fault(Some("GET"), &threads, busy());
        rig.mock.plan_fault(Some("GET"), &messages, busy());
    }
    rig.mock.configure(|config| config.review = false);
    let unsure = cache
        .refresh(&rig.http, &session, &project_id, &json!({}))
        .await;
    assert_eq!(unsure, no_chat);
    assert_eq!(rig.mock.requests(&threads).len(), 8);

    rig.mock
        .plan_fault(Some("GET"), &threads, Fault::Reply(401, "no".into()));
    let signed_out = cache
        .refresh(&rig.http, &session, &project_id, &json!({}))
        .await;
    assert_eq!(signed_out.review, Some(true));
    assert_eq!(rig.mock.requests(&threads).len(), 9);

    let fresh = CapabilityCache::default();
    for _ in 0..3 {
        rig.mock.plan_fault(Some("GET"), &threads, busy());
        rig.mock.plan_fault(Some("GET"), &messages, busy());
    }
    let first = fresh
        .refresh(&rig.http, &session, &project_id, &json!({}))
        .await;
    assert_eq!(
        first,
        Capabilities {
            review: None,
            chat: None
        }
    );
    assert_eq!(fresh.get(&rig.http.origin), Some(first));
}

#[test]
fn joins_the_model_cannot_read_are_unsupported() {
    let root = json!([{ "_id": "r", "name": "rootFolder" }]);
    let cases = [
        (json!([]), Unsupported::NotAnObject),
        (
            json!({ "permissionsLevel": "owner", "project": { "rootFolder": root } }),
            Unsupported::NoPublicId,
        ),
        (
            json!({ "publicId": "P", "permissionsLevel": "admin", "project": { "rootFolder": root } }),
            Unsupported::UnknownPermissions("admin".into()),
        ),
        (
            json!({ "publicId": "P", "permissionsLevel": "owner" }),
            Unsupported::NoProject,
        ),
        (
            json!({ "publicId": "P", "permissionsLevel": "owner", "project": { "rootFolder": [] } }),
            Unsupported::NoRootFolder,
        ),
    ];
    for (join, expected) in cases {
        assert_eq!(ProjectState::from_join(join).unwrap_err(), expected);
    }
}

#[tokio::test]
async fn an_oversized_or_endless_member_list_is_refused() {
    for declared in [Some(u64::MAX / 2), None] {
        let base = crate::test_support::streaming_server(declared, None, Duration::ZERO).await;
        let http = Http::new(&base, AGENT).unwrap();
        let session = SessionHandle::new(
            &base,
            Session {
                cookie: "overleaf.sid=s".into(),
                user_id: "u1".into(),
                email: String::new(),
                saved_by: None,
            },
            None,
        );
        let error = Members::fetch_collaborators(&http, &session, "p1")
            .await
            .unwrap_err();
        assert_eq!(error.kind, OnlineErrorKind::Unrecognized, "{declared:?}");
        assert!(
            error
                .detail
                .as_deref()
                .unwrap_or_default()
                .contains("larger than"),
            "{error:?}"
        );
    }
}

#[test]
fn the_import_settings_and_the_live_state_read_the_main_document_the_same_way() {
    let join = json!({
        "publicId": "P.1",
        "permissionsLevel": "owner",
        "project": {
            "compiler": "lualatex",
            "imageName": "texlive-full:2025.1",
            "rootDoc_id": "d9",
            "rootFolder": [{
                "_id": "root",
                "name": "rootFolder",
                "docs": [{ "_id": "d1", "name": "notes.tex" }, { "_id": "../d9", "name": "evil.tex" }],
                "folders": [{ "_id": "f1", "name": "thesis", "docs": [{ "_id": "d9", "name": "main.tex" }] }],
            }],
        },
    });
    let state = ProjectState::from_join(join.clone()).unwrap();
    assert_eq!(state.settings(), settings_from_project(&join["project"]));
    assert_eq!(
        state.settings().main_doc.as_deref(),
        Some("thesis/main.tex")
    );
    let mut hostile = join["project"].clone();
    hostile["rootDoc_id"] = json!("../d9");
    assert_eq!(settings_from_project(&hostile).main_doc, None);
}
