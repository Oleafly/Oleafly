use std::collections::{BTreeSet, HashMap};
use std::sync::Mutex;

use reqwest::header::ACCEPT;
use serde_json::Value;

use super::connection::{connect, Carrier};
use super::events::{plain, AccessEvent, DocId, ProjectEvent, PublicId};
use super::page::ProjectPage;
use super::tree::{OverleafTree, PathChange};
use crate::client::{self, Http, SMALL_BODY_BYTES};
use crate::error::{OnlineError, OnlineErrorKind};
use crate::locked;
use crate::session::{Session, SessionHandle};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Role {
    Owner,
    Editor,
    Reviewer,
    Viewer,
}

impl Role {
    pub fn from_privilege(level: &str) -> Option<Role> {
        match level {
            "owner" => Some(Role::Owner),
            "readAndWrite" => Some(Role::Editor),
            "review" => Some(Role::Reviewer),
            "readOnly" => Some(Role::Viewer),
            _ => None,
        }
    }

    pub fn collab_name(self) -> &'static str {
        match self {
            Role::Owner => "owner",
            Role::Editor => "editor",
            Role::Reviewer => "reviewer",
            Role::Viewer => "viewer",
        }
    }

    pub fn can_edit(self) -> bool {
        matches!(self, Role::Owner | Role::Editor)
    }

    pub fn can_review(self) -> bool {
        self != Role::Viewer
    }
}

const GUESTS: &str = "__guests__";

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum TrackChanges {
    #[default]
    Off,
    Everyone,
    Some {
        users: BTreeSet<String>,
        guests: bool,
    },
}

impl TrackChanges {
    pub fn from_value(state: &Value) -> TrackChanges {
        match state {
            Value::Bool(true) => TrackChanges::Everyone,
            Value::Object(map) => TrackChanges::Some {
                users: map
                    .iter()
                    .filter(|(user, on)| user.as_str() != GUESTS && on.as_bool() == Some(true))
                    .map(|(user, _)| user.clone())
                    .collect(),
                guests: map.get(GUESTS).and_then(Value::as_bool) == Some(true),
            },
            _ => TrackChanges::Off,
        }
    }

    pub fn applies_to(&self, user_id: &str) -> bool {
        match self {
            TrackChanges::Off => false,
            TrackChanges::Everyone => true,
            TrackChanges::Some { users, .. } => !user_id.is_empty() && users.contains(user_id),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Member {
    pub id: String,
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    pub role: Role,
}

impl Member {
    fn from_value(value: &Value) -> Option<Member> {
        let field = |key: &str| {
            value
                .get(key)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        Some(Member {
            id: value.get("_id")?.as_str()?.to_string(),
            first_name: field("first_name"),
            last_name: field("last_name"),
            email: field("email"),
            role: Role::from_privilege(value.get("privileges")?.as_str()?)?,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Invite {
    pub id: String,
    pub email: String,
    pub role: Role,
}

impl Invite {
    pub fn list_from_value(list: &Value) -> Vec<Invite> {
        list.as_array()
            .into_iter()
            .flatten()
            .filter_map(|invite| {
                Some(Invite {
                    id: invite
                        .get("_id")?
                        .as_str()
                        .map(str::to_string)
                        .and_then(plain)?,
                    email: invite.get("email")?.as_str()?.trim().to_string(),
                    role: Role::from_privilege(invite.get("privileges")?.as_str()?)?,
                })
            })
            .collect()
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Members {
    pub owner: Option<Member>,
    pub collaborators: Vec<Member>,
    pub invites: Vec<Invite>,
}

impl Members {
    fn from_project(project: &Value) -> Members {
        Members {
            owner: project.get("owner").and_then(Member::from_value),
            collaborators: project
                .get("members")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Member::from_value)
                .collect(),
            invites: Invite::list_from_value(project.get("invites").unwrap_or(&Value::Null)),
        }
    }

    pub fn all(&self) -> impl Iterator<Item = &Member> {
        self.owner.iter().chain(&self.collaborators)
    }

    pub fn role_of(&self, user_id: &str) -> Option<Role> {
        self.all()
            .find(|member| member.id == user_id)
            .map(|member| member.role)
    }

    pub async fn fetch_collaborators(
        http: &Http,
        session: &SessionHandle,
        project_id: &str,
    ) -> Result<Vec<Member>, OnlineError> {
        let response = http
            .send_public(
                http.get(&format!("/project/{project_id}/members"), &session.cookie())
                    .header(ACCEPT, "application/json"),
            )
            .await?;
        http.classify(&response)?;
        let unrecognized =
            |detail: String| OnlineError::new(OnlineErrorKind::Unrecognized).detail(detail);
        let body = client::read_capped(response, SMALL_BODY_BYTES)
            .await
            .map_err(|error| unrecognized(error.to_string()))?;
        let body: Value =
            serde_json::from_slice(&body).map_err(|error| unrecognized(error.to_string()))?;
        let listed = body
            .get("members")
            .and_then(Value::as_array)
            .ok_or_else(|| OnlineError::new(OnlineErrorKind::Unrecognized))?;
        Ok(listed.iter().filter_map(Member::from_value).collect())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Unsupported {
    NotAnObject,
    NoPublicId,
    NoProject,
    NoRootFolder,
    UnknownPermissions(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Rejoined {
    Repaired(Vec<PathChange>),
    Everything { from: Option<u64>, to: Option<u64> },
}

#[derive(Clone, Debug)]
pub struct ProjectState {
    pub public_id: PublicId,
    pub protocol_version: Option<u64>,
    pub role: Role,
    pub restricted: bool,
    pub deleted_externally: bool,
    pub name: String,
    pub root_doc: Option<DocId>,
    pub main_bibliography: Option<DocId>,
    pub compiler: Option<String>,
    pub image: Option<String>,
    pub spell_language: Option<String>,
    pub features: Value,
    pub track_changes: TrackChanges,
    pub members: Members,
    pub public_access: Option<String>,
    pub tree: OverleafTree,
}

fn trimmed(project: &Value, key: &str) -> Option<String> {
    project
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn doc_of(project: &Value, key: &str) -> Option<DocId> {
    trimmed(project, key).and_then(plain).map(DocId)
}

impl ProjectSettings {
    fn of(
        compiler: Option<String>,
        root_doc: Option<&DocId>,
        image: Option<&str>,
        tree: &OverleafTree,
    ) -> ProjectSettings {
        ProjectSettings {
            compiler,
            main_doc: root_doc.and_then(|doc| tree.path_of(&doc.into())),
            tex_live: image.and_then(tex_live_year),
        }
    }
}

impl ProjectState {
    pub fn unjoined() -> ProjectState {
        ProjectState {
            public_id: PublicId(String::new()),
            protocol_version: None,
            role: Role::Viewer,
            restricted: false,
            deleted_externally: false,
            name: String::new(),
            root_doc: None,
            main_bibliography: None,
            compiler: None,
            image: None,
            spell_language: None,
            features: Value::Null,
            track_changes: TrackChanges::default(),
            members: Members::default(),
            public_access: None,
            tree: OverleafTree::default(),
        }
    }

    pub fn from_join(join: Value) -> Result<ProjectState, Unsupported> {
        if !join.is_object() {
            return Err(Unsupported::NotAnObject);
        }
        let public_id = join
            .get("publicId")
            .and_then(Value::as_str)
            .map(|id| PublicId(id.to_string()))
            .ok_or(Unsupported::NoPublicId)?;
        let level = join
            .get("permissionsLevel")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let role = Role::from_privilege(level)
            .ok_or_else(|| Unsupported::UnknownPermissions(level.to_string()))?;
        let project = join
            .get("project")
            .filter(|project| project.is_object())
            .ok_or(Unsupported::NoProject)?;
        let tree = project
            .get("rootFolder")
            .and_then(OverleafTree::from_root_folder)
            .ok_or(Unsupported::NoRootFolder)?;
        let owner = project.get("owner").unwrap_or(&Value::Null);
        Ok(ProjectState {
            public_id,
            protocol_version: join.get("protocolVersion").and_then(Value::as_u64),
            role,
            restricted: owner.get("privileges").is_none() && owner.get("email").is_none(),
            deleted_externally: project
                .get("deletedByExternalDataSource")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            name: trimmed(project, "name").unwrap_or_default(),
            root_doc: doc_of(project, "rootDoc_id"),
            main_bibliography: doc_of(project, "mainBibliographyDoc_id"),
            compiler: trimmed(project, "compiler"),
            image: trimmed(project, "imageName"),
            spell_language: trimmed(project, "spellCheckLanguage"),
            features: project.get("features").cloned().unwrap_or(Value::Null),
            track_changes: TrackChanges::from_value(
                project.get("trackChangesState").unwrap_or(&Value::Null),
            ),
            members: Members::from_project(project),
            public_access: trimmed(project, "publicAccesLevel"),
            tree,
        })
    }

    pub fn rejoin(&mut self, join: Value) -> Result<Rejoined, Unsupported> {
        let mut fresh = ProjectState::from_join(join)?;
        let first = self.public_id.0.is_empty();
        if !first && fresh.protocol_version != self.protocol_version {
            let from = self.protocol_version;
            let to = fresh.protocol_version;
            *self = fresh;
            return Ok(Rejoined::Everything { from, to });
        }
        let tree = std::mem::take(&mut fresh.tree);
        let changes = self.tree.repair(tree);
        fresh.tree = std::mem::take(&mut self.tree);
        *self = fresh;
        Ok(Rejoined::Repaired(changes))
    }

    pub fn settings(&self) -> ProjectSettings {
        ProjectSettings::of(
            self.compiler.clone(),
            self.root_doc.as_ref(),
            self.image.as_deref(),
            &self.tree,
        )
    }

    pub fn apply_project(&mut self, event: &ProjectEvent) {
        match event {
            ProjectEvent::RootDoc(doc) => self.root_doc = Some(doc.clone()),
            ProjectEvent::Compiler(compiler) => self.compiler = Some(compiler.clone()),
            ProjectEvent::Image(image) => self.image = Some(image.clone()),
            ProjectEvent::SpellLanguage(language) => self.spell_language = Some(language.clone()),
            ProjectEvent::MainBibliography(doc) => self.main_bibliography = Some(doc.clone()),
            ProjectEvent::Name(name) => self.name.clone_from(name),
            ProjectEvent::DeletedOrRenamedExternally => self.deleted_externally = true,
        }
    }

    pub fn apply_access(&mut self, event: &AccessEvent) -> bool {
        match event {
            AccessEvent::TrackChanges(state) => {
                self.track_changes = TrackChanges::from_value(state);
                false
            }
            AccessEvent::PublicAccessChanged(level) => {
                self.public_access.clone_from(level);
                false
            }
            AccessEvent::MembersChanged { members: true, .. }
            | AccessEvent::AccessLevelChanged { .. } => !self.restricted,
            _ => false,
        }
    }

    pub fn tracks_changes_for(&self, user_id: &str) -> bool {
        self.track_changes.applies_to(user_id)
    }

    pub fn plan_tracks_changes(&self) -> bool {
        self.feature("trackChanges")
    }

    fn feature(&self, name: &str) -> bool {
        self.features.get(name).and_then(Value::as_bool) == Some(true)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Capabilities {
    pub review: Option<bool>,
    pub chat: Option<bool>,
}

enum Probe {
    Answer(bool),
    Again,
    Unsure,
}

async fn probe_once(http: &Http, session: &SessionHandle, path: &str) -> Probe {
    let sent = http
        .get(path, &session.cookie())
        .header(ACCEPT, "application/json")
        .send()
        .await;
    let Ok(response) = sent else {
        return Probe::Again;
    };
    session.absorb_headers(response.headers());
    match response.status() {
        status if status.is_success() => Probe::Answer(true),
        reqwest::StatusCode::NOT_FOUND => Probe::Answer(false),
        status if status.is_server_error() => Probe::Again,
        _ => Probe::Unsure,
    }
}

async fn probe_route(http: &Http, session: &SessionHandle, path: &str) -> Option<bool> {
    let probed = client::retried(
        |probe: &Probe| matches!(probe, Probe::Again),
        || async {
            match probe_once(http, session, path).await {
                Probe::Again => Err(Probe::Again),
                other => Ok(other),
            }
        },
    )
    .await;
    match probed {
        Ok(Probe::Answer(found)) => Some(found),
        _ => None,
    }
}

#[derive(Debug, Default)]
pub struct CapabilityCache {
    by_origin: Mutex<HashMap<String, Capabilities>>,
}

impl CapabilityCache {
    pub fn get(&self, origin: &str) -> Option<Capabilities> {
        locked(&self.by_origin).get(origin).copied()
    }

    pub async fn refresh(
        &self,
        http: &Http,
        session: &SessionHandle,
        project_id: &str,
        features: &Value,
    ) -> Capabilities {
        let known = self.get(&http.origin).unwrap_or_default();
        let review = probe_route(http, session, &format!("/project/{project_id}/threads"))
            .await
            .or(known.review);
        let chat = if features.get("chat").and_then(Value::as_bool) == Some(true) {
            Some(true)
        } else {
            probe_route(
                http,
                session,
                &format!("/project/{project_id}/messages?limit=1"),
            )
            .await
            .or(known.chat)
        };
        let found = Capabilities { review, chat };
        locked(&self.by_origin).insert(http.origin.clone(), found);
        found
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ProjectSettings {
    pub compiler: Option<String>,
    pub main_doc: Option<String>,
    pub tex_live: Option<String>,
}

pub async fn fetch_project(
    http: &Http,
    cookie: &str,
    project_id: &str,
) -> Result<Value, OnlineError> {
    let unreachable = |detail: String| {
        OnlineError::new(OnlineErrorKind::Unreachable)
            .param("server", &http.base)
            .detail(detail)
    };
    let page = ProjectPage::unloaded(project_id)?;
    let session = SessionHandle::new(
        &http.base,
        Session {
            cookie: cookie.to_string(),
            user_id: String::new(),
            email: String::new(),
            saved_by: None,
        },
        None,
    );
    let (connection, join) = connect(http, &session, &page, &[Carrier::XhrPolling])
        .await
        .map_err(|error| unreachable(error.to_string()))?;
    connection.close().await;
    join.response
        .get("project")
        .cloned()
        .ok_or_else(|| unreachable("the project reply was empty".to_string()))
}

pub fn settings_from_project(project: &Value) -> ProjectSettings {
    let tree = project
        .get("rootFolder")
        .and_then(OverleafTree::from_root_folder)
        .unwrap_or_default();
    ProjectSettings::of(
        trimmed(project, "compiler"),
        doc_of(project, "rootDoc_id").as_ref(),
        trimmed(project, "imageName").as_deref(),
        &tree,
    )
}

pub fn tex_live_year(image: &str) -> Option<String> {
    let tag = image.rsplit(':').next()?;
    let year: String = tag.chars().take_while(char::is_ascii_digit).collect();
    (year.len() == 4).then_some(year)
}

pub fn flavor_for_compiler(compiler: &str) -> Option<&'static str> {
    match compiler.trim().to_ascii_lowercase().as_str() {
        "pdflatex" => Some("pdflatex"),
        "xelatex" => Some("xelatex"),
        "lualatex" => Some("lualatex"),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
