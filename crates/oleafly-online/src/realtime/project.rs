use std::collections::{BTreeSet, HashMap};
use std::sync::Mutex;

use reqwest::header::ACCEPT;
use serde_json::Value;

use super::connection::{connect, Carrier};
use super::events::{AccessEvent, DocId, ProjectEvent, PublicId};
use super::page::ProjectPage;
use super::tree::{OverleafTree, PathChange};
use crate::client::Http;
use crate::error::{OnlineError, OnlineErrorKind};
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

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Members {
    pub owner: Option<Member>,
    pub collaborators: Vec<Member>,
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

    pub async fn refresh(
        &mut self,
        http: &Http,
        session: &SessionHandle,
        project_id: &str,
    ) -> Result<(), OnlineError> {
        let response = http
            .send_public(
                http.get(&format!("/project/{project_id}/members"), &session.cookie())
                    .header(ACCEPT, "application/json"),
            )
            .await?;
        http.classify(&response)?;
        let body: Value = response
            .json()
            .await
            .map_err(|error| OnlineError::new(OnlineErrorKind::Unrecognized).detail(error))?;
        let listed = body
            .get("members")
            .and_then(Value::as_array)
            .ok_or_else(|| OnlineError::new(OnlineErrorKind::Unrecognized))?;
        self.collaborators = listed.iter().filter_map(Member::from_value).collect();
        Ok(())
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
            root_doc: trimmed(project, "rootDoc_id").map(DocId),
            main_bibliography: trimmed(project, "mainBibliographyDoc_id").map(DocId),
            compiler: trimmed(project, "compiler"),
            image: trimmed(project, "imageName"),
            spell_language: trimmed(project, "spellCheckLanguage"),
            features: project.get("features").cloned().unwrap_or(Value::Null),
            track_changes: TrackChanges::from_value(
                project.get("trackChangesState").unwrap_or(&Value::Null),
            ),
            members: Members::from_project(project),
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
        ProjectSettings {
            compiler: self.compiler.clone(),
            main_doc: self
                .root_doc
                .as_ref()
                .and_then(|doc| self.tree.path_of(&doc.into())),
            tex_live: self.image.as_deref().and_then(tex_live_year),
        }
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
            AccessEvent::MembersChanged | AccessEvent::AccessLevelChanged { .. } => {
                !self.restricted
            }
            _ => false,
        }
    }

    pub fn tracks_changes_for(&self, user_id: &str) -> bool {
        self.track_changes.applies_to(user_id)
    }

    pub async fn refresh_members(
        &mut self,
        http: &Http,
        session: &SessionHandle,
        project_id: &str,
    ) -> Result<bool, OnlineError> {
        if self.restricted {
            return Ok(false);
        }
        self.members.refresh(http, session, project_id).await?;
        Ok(true)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Capabilities {
    pub review: bool,
    pub chat: bool,
}

async fn probe_route(http: &Http, session: &SessionHandle, path: &str) -> Option<bool> {
    let response = http
        .get(path, &session.cookie())
        .header(ACCEPT, "application/json")
        .send()
        .await
        .ok()?;
    let status = response.status();
    if status.is_success() {
        Some(true)
    } else if status == reqwest::StatusCode::NOT_FOUND {
        Some(false)
    } else {
        None
    }
}

#[derive(Debug, Default)]
pub struct CapabilityCache {
    by_origin: Mutex<HashMap<String, Capabilities>>,
}

impl CapabilityCache {
    pub fn get(&self, origin: &str) -> Option<Capabilities> {
        self.by_origin
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(origin)
            .copied()
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
            .unwrap_or(known.review);
        let chat = if features.get("chat").and_then(Value::as_bool) == Some(true) {
            true
        } else {
            probe_route(
                http,
                session,
                &format!("/project/{project_id}/messages?limit=1"),
            )
            .await
            .unwrap_or(known.chat)
        };
        let found = Capabilities { review, chat };
        self.by_origin
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(http.origin.clone(), found);
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
    let text = |key: &str| {
        project
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    let main_doc = text("rootDoc_id").and_then(|root| {
        project
            .get("rootFolder")
            .and_then(Value::as_array)
            .and_then(|folders| folders.first())
            .and_then(|folder| find_doc_path(folder, &root, ""))
    });
    ProjectSettings {
        compiler: text("compiler"),
        main_doc,
        tex_live: text("imageName").and_then(|image| tex_live_year(&image)),
    }
}

pub fn find_doc_path(folder: &Value, doc_id: &str, prefix: &str) -> Option<String> {
    let id_of = |entry: &Value| {
        entry
            .get("_id")
            .or_else(|| entry.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let name_of = |entry: &Value| {
        entry
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    for doc in folder
        .get("docs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if id_of(doc).as_deref() == Some(doc_id) {
            return name_of(doc).map(|name| format!("{prefix}{name}"));
        }
    }
    for child in folder
        .get("folders")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(name) = name_of(child) else {
            continue;
        };
        if let Some(found) = find_doc_path(child, doc_id, &format!("{prefix}{name}/")) {
            return Some(found);
        }
    }
    None
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
