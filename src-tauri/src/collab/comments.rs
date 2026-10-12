use std::path::PathBuf;
use std::sync::PoisonError;

use oleafly_collab::comments::{
    mentions_in, CommentChanges, CommentMember, CommentMessage, CommentThread,
};
use oleafly_collab::doc::{NodeKind, ProjectDoc};
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize::{self, Layout};
use oleafly_collab::sync::SharedLive;
use oleafly_collab::{load_binding, write_atomic, CollabError, CollabPaths};
use oleafly_collab_protocol::ids::{AccountId, CommentId};
use oleafly_collab_protocol::projects::{
    project_role_allows, ProjectAction, ProjectPatch, ProjectRole, ProjectSummary,
};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use super::commands::{authed, now_ms, AppHost, CollabCommandError, CollabHost};
use super::live::LiveHost;
use super::state::CollabState;

pub const COMMENTS_CHANGED_EVENT: &str = "collab-comments-changed";
pub const COMMENTS_STATUS_EVENT: &str = "collab-comments-status";
const SWITCHES_FILE: &str = "comments.json";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MentionedPayload {
    pub file_id: String,
    pub path: Option<String>,
    pub thread_id: CommentId,
    pub message_id: CommentId,
    pub author: AccountId,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentsChangedPayload {
    pub project_id: String,
    pub file_ids: Vec<String>,
    pub paths: Vec<String>,
    pub mentioned: Vec<MentionedPayload>,
    pub local: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentThreadList {
    pub rev: Option<u64>,
    pub threads: Vec<CommentThread>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommentSwitches {
    pub server: bool,
    pub project: bool,
}

impl Default for CommentSwitches {
    fn default() -> Self {
        CommentSwitches {
            server: true,
            project: true,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentsStatus {
    pub server_allowed: bool,
    pub project_enabled: bool,
    pub can_comment: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentsStatusPayload {
    pub project_id: String,
    pub status: CommentsStatus,
}

pub(crate) struct Commenter {
    pub account: AccountId,
    pub role: ProjectRole,
    pub switches: CommentSwitches,
}

fn refused(status: u16, code: &str, message: &str) -> CollabError {
    CollabError::Api {
        status,
        code: code.to_owned(),
        message: message.to_owned(),
    }
}

fn not_shared() -> CollabError {
    refused(404, "not_found", "this project is not shared")
}

fn not_live() -> CollabError {
    refused(404, "not_live", "this project is not live")
}

fn refusal_code(code: &str) -> Option<&'static str> {
    Some(match code {
        "not_live" => "comment_not_live",
        "not_yours" => "comment_not_yours",
        "comments_off_server" => "comment_off_server",
        "comments_off_project" => "comment_off_project",
        "viewer" => "comment_viewer",
        "someone_replied" => "comment_someone_replied",
        "message_deleted" => "comment_message_deleted",
        "selection_changed" => "comment_selection_changed",
        "too_large" => "comment_too_long",
        "empty" => "comment_empty",
        _ => return None,
    })
}

fn io(error: impl std::fmt::Display) -> CollabError {
    CollabError::Io(error.to_string())
}

impl Commenter {
    fn may_write(&self) -> Result<(), CollabError> {
        if !self.switches.server {
            return Err(refused(
                403,
                "comments_off_server",
                "comments are turned off on this server",
            ));
        }
        if !self.switches.project {
            return Err(refused(
                403,
                "comments_off_project",
                "comments are turned off for this project",
            ));
        }
        if !project_role_allows(self.role, ProjectAction::Edit) {
            return Err(refused(
                403,
                "viewer",
                "viewers can read comments but not write them",
            ));
        }
        Ok(())
    }
}

fn switches_file(paths: &CollabPaths, project_id: &str) -> Result<PathBuf, CollabError> {
    Ok(paths.project_dir(project_id)?.join(SWITCHES_FILE))
}

pub(crate) fn load_switches(paths: &CollabPaths, project_id: &str) -> CommentSwitches {
    switches_file(paths, project_id)
        .ok()
        .and_then(|file| std::fs::read(file).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save_switches(
    paths: &CollabPaths,
    project_id: &str,
    switches: CommentSwitches,
) -> Result<(), CollabError> {
    let file = switches_file(paths, project_id)?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(io)?;
    }
    let bytes = serde_json::to_vec(&switches).map_err(io)?;
    write_atomic(&file, &bytes)
}

fn status_of(switches: CommentSwitches, role: ProjectRole) -> CommentsStatus {
    CommentsStatus {
        server_allowed: switches.server,
        project_enabled: switches.project,
        can_comment: switches.server
            && switches.project
            && project_role_allows(role, ProjectAction::Edit),
    }
}

pub(crate) fn settle_status(
    paths: &CollabPaths,
    project_id: &str,
    fetched: Result<(bool, bool), CollabError>,
    role: ProjectRole,
) -> CommentsStatus {
    let mut switches = load_switches(paths, project_id);
    if let Ok((server, project)) = fetched {
        switches = CommentSwitches { server, project };
        let _ = save_switches(paths, project_id, switches);
    }
    status_of(switches, role)
}

fn layout_of(doc: &ProjectDoc) -> Layout {
    doc.nodes()
        .map(|nodes| materialize::layout(&nodes))
        .unwrap_or_default()
}

fn file_at(doc: &ProjectDoc, path: &str) -> Result<String, CollabError> {
    layout_of(doc)
        .into_iter()
        .find(|(_, placed)| placed.path == path && placed.kind == NodeKind::Text)
        .map(|(id, _)| id)
        .ok_or_else(|| refused(404, "not_found", "this file is not in the shared project"))
}

fn path_in(layout: &Layout, file_id: &str) -> Option<String> {
    layout.get(file_id).map(|placed| placed.path.clone())
}

pub(crate) fn threads_at(doc: &ProjectDoc, path: &str) -> Result<Vec<CommentThread>, CollabError> {
    doc.comment_threads(&file_at(doc, path)?)
}

pub(crate) fn thread_list_at(
    live: &LiveProject,
    path: &str,
) -> Result<CommentThreadList, CollabError> {
    let file = file_at(live.doc(), path)?;
    Ok(CommentThreadList {
        rev: live.editor_rev(&file),
        threads: live.doc().comment_threads(&file)?,
    })
}

pub(crate) fn command_error(error: CollabError) -> CollabCommandError {
    if let CollabError::Api { code, message, .. } = &error {
        if let Some(mapped) = refusal_code(code) {
            return CollabCommandError {
                code: mapped,
                message: message.clone(),
            };
        }
    }
    CollabCommandError::from(error)
}

fn local_change(project_id: &str, file_id: &str, path: Option<String>) -> CommentsChangedPayload {
    CommentsChangedPayload {
        project_id: project_id.to_owned(),
        file_ids: vec![file_id.to_owned()],
        paths: path.into_iter().collect(),
        mentioned: Vec::new(),
        local: true,
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn create_at(
    live: &mut LiveProject,
    who: &Commenter,
    path: &str,
    from: usize,
    to: usize,
    rev: Option<u64>,
    body: &str,
    members: &[CommentMember],
    now: i64,
) -> Result<CommentThread, CollabError> {
    who.may_write()?;
    let file = file_at(live.doc(), path)?;
    if rev.is_some() && rev != live.editor_rev(&file) {
        return Err(refused(
            409,
            "selection_changed",
            "the text changed while the comment was written",
        ));
    }
    live.comment_doc().create_comment_thread(
        &file,
        from,
        to,
        who.account,
        now,
        body,
        &mentions_in(body, members),
    )
}

pub(crate) fn reply_in(
    live: &mut LiveProject,
    who: &Commenter,
    file_id: &str,
    thread: CommentId,
    body: &str,
    members: &[CommentMember],
    now: i64,
) -> Result<CommentMessage, CollabError> {
    who.may_write()?;
    live.comment_doc().reply_to_comment(
        file_id,
        thread,
        who.account,
        now,
        body,
        &mentions_in(body, members),
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn edit_in(
    live: &mut LiveProject,
    who: &Commenter,
    file_id: &str,
    thread: CommentId,
    message: CommentId,
    body: &str,
    members: &[CommentMember],
    now: i64,
) -> Result<CommentMessage, CollabError> {
    who.may_write()?;
    live.comment_doc().edit_comment(
        file_id,
        thread,
        message,
        who.account,
        now,
        body,
        &mentions_in(body, members),
    )
}

pub(crate) fn delete_in(
    live: &mut LiveProject,
    who: &Commenter,
    file_id: &str,
    thread: CommentId,
    message: CommentId,
) -> Result<(), CollabError> {
    who.may_write()?;
    live.comment_doc()
        .delete_comment(file_id, thread, message, who.account)
}

fn thread_after(
    live: &LiveProject,
    file_id: &str,
    thread: CommentId,
) -> Result<CommentThread, CollabError> {
    live.doc()
        .comment_thread(file_id, thread)?
        .ok_or_else(|| refused(404, "not_found", "this comment thread is gone"))
}

pub(crate) fn resolve_in(
    live: &mut LiveProject,
    who: &Commenter,
    file_id: &str,
    thread: CommentId,
    now: i64,
) -> Result<CommentThread, CollabError> {
    who.may_write()?;
    live.comment_doc()
        .resolve_comment_thread(file_id, thread, who.account, now)?;
    thread_after(live, file_id, thread)
}

pub(crate) fn reopen_in(
    live: &mut LiveProject,
    who: &Commenter,
    file_id: &str,
    thread: CommentId,
) -> Result<CommentThread, CollabError> {
    who.may_write()?;
    live.comment_doc().reopen_comment_thread(file_id, thread)?;
    thread_after(live, file_id, thread)
}

pub(crate) fn delete_thread_in(
    live: &mut LiveProject,
    who: &Commenter,
    file_id: &str,
    thread: CommentId,
) -> Result<(), CollabError> {
    who.may_write()?;
    live.comment_doc()
        .delete_comment_thread(file_id, thread, who.account)
}

fn payload_for(
    project_id: &str,
    me: AccountId,
    changes: CommentChanges,
    layout: &Layout,
) -> CommentsChangedPayload {
    CommentsChangedPayload {
        project_id: project_id.to_owned(),
        file_ids: changes.files.iter().cloned().collect(),
        paths: changes
            .files
            .iter()
            .filter_map(|file| path_in(layout, file))
            .collect(),
        mentioned: changes
            .mentions
            .into_iter()
            .filter(|mention| mention.author != me && mention.mentions.contains(&me))
            .map(|mention| MentionedPayload {
                path: path_in(layout, &mention.file_id),
                file_id: mention.file_id,
                thread_id: mention.thread_id,
                message_id: mention.message_id,
                author: mention.author,
            })
            .collect(),
        local: false,
    }
}

pub(crate) fn announce(project_id: &str, live: &SharedLive, me: AccountId, host: &dyn LiveHost) {
    let (changes, layout) = {
        let mut live = live.lock().unwrap_or_else(PoisonError::into_inner);
        let changes = live.take_comment_changes();
        if changes.is_empty() {
            return;
        }
        (changes, layout_of(live.doc()))
    };
    host.comments_changed(payload_for(project_id, me, changes, &layout));
}

pub async fn list_threads(
    state: &CollabState,
    project_id: &str,
    path: &str,
) -> Result<CommentThreadList, CollabError> {
    if let Some(listed) = super::live::read_live(project_id, |live| thread_list_at(live, path)) {
        return listed;
    }
    let paths = state.paths()?;
    load_binding(paths, project_id)?.ok_or_else(not_shared)?;
    let dir = paths.document_dir(project_id)?;
    let path = path.to_owned();
    tokio::task::spawn_blocking(move || {
        let saved = LiveProject::load(&dir, ProjectRole::Viewer)?;
        Ok(CommentThreadList {
            rev: None,
            threads: threads_at(saved.doc(), &path)?,
        })
    })
    .await
    .map_err(io)?
}

pub async fn comments_status(
    state: &CollabState,
    host: &dyn CollabHost,
    project_id: &str,
) -> Result<CommentsStatus, CollabError> {
    let paths = state.paths()?;
    let binding = load_binding(paths, project_id)?.ok_or_else(not_shared)?;
    let shared = binding.shared_project_id;
    let fetched = authed(state, host, binding.server_id, |client, access| {
        Box::pin(async move {
            let manifest = client.capabilities().await?;
            let summary = client.project(access, shared).await?;
            Ok((manifest.features.comments, summary.comments_enabled))
        })
    })
    .await;
    let role = super::live::read_live(project_id, LiveProject::role).unwrap_or(binding.role);
    Ok(settle_status(paths, project_id, fetched, role))
}

pub async fn set_comments_enabled(
    state: &CollabState,
    host: &dyn CollabHost,
    project_id: &str,
    enabled: bool,
) -> Result<(ProjectSummary, CommentsStatus), CollabError> {
    let paths = state.paths()?;
    let binding = load_binding(paths, project_id)?.ok_or_else(not_shared)?;
    let shared = binding.shared_project_id;
    let summary = authed(state, host, binding.server_id, |client, access| {
        Box::pin(async move {
            let patch = ProjectPatch {
                comments_enabled: Some(enabled),
                ..ProjectPatch::default()
            };
            client.patch_project(access, shared, &patch).await
        })
    })
    .await?;
    let mut switches = load_switches(paths, project_id);
    switches.project = summary.comments_enabled;
    save_switches(paths, project_id, switches)?;
    let status = status_of(switches, summary.role);
    Ok((summary, status))
}

fn write_comment<T>(
    state: &CollabState,
    project_id: &str,
    work: impl FnOnce(&mut LiveProject, &Commenter) -> Result<T, CollabError>,
) -> Result<T, CollabError> {
    let switches = load_switches(state.paths()?, project_id);
    if super::live::read_live(project_id, |_| ()).is_none() {
        return Err(not_live());
    }
    super::live::comment_live(project_id, |live, account| {
        let who = Commenter {
            account,
            role: live.role(),
            switches,
        };
        work(live, &who)
    })
}

fn tell_local(app: &tauri::AppHandle, project_id: &str, file_id: &str) {
    let path = super::live::read_live(project_id, |live| path_in(&layout_of(live.doc()), file_id))
        .flatten();
    let _ = app.emit(
        COMMENTS_CHANGED_EVENT,
        local_change(project_id, file_id, path),
    );
}

#[tauri::command]
pub async fn collab_comments_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
) -> Result<CommentsStatus, CollabCommandError> {
    let host = AppHost::new(app);
    comments_status(state.inner(), &host, &project_id)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_comments_set_enabled(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
    enabled: bool,
) -> Result<ProjectSummary, CollabCommandError> {
    let host = AppHost::new(app.clone());
    let (summary, status) = set_comments_enabled(state.inner(), &host, &project_id, enabled)
        .await
        .map_err(CollabCommandError::from)?;
    let _ = app.emit(
        COMMENTS_STATUS_EVENT,
        CommentsStatusPayload { project_id, status },
    );
    Ok(summary)
}

#[tauri::command]
pub async fn collab_comment_thread_list(
    state: tauri::State<'_, CollabState>,
    project_id: String,
    path: String,
) -> Result<CommentThreadList, CollabCommandError> {
    list_threads(state.inner(), &project_id, &path)
        .await
        .map_err(CollabCommandError::from)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn collab_comment_create(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
    path: String,
    from: usize,
    to: usize,
    rev: Option<u64>,
    body: String,
    members: Vec<CommentMember>,
) -> Result<CommentThread, CollabCommandError> {
    let thread = write_comment(state.inner(), &project_id, |live, who| {
        create_at(live, who, &path, from, to, rev, &body, &members, now_ms())
    })
    .map_err(command_error)?;
    tell_local(&app, &project_id, &thread.file_id);
    Ok(thread)
}

#[tauri::command]
pub async fn collab_comment_reply(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
    file_id: String,
    thread_id: CommentId,
    body: String,
    members: Vec<CommentMember>,
) -> Result<CommentMessage, CollabCommandError> {
    let message = write_comment(state.inner(), &project_id, |live, who| {
        reply_in(live, who, &file_id, thread_id, &body, &members, now_ms())
    })
    .map_err(command_error)?;
    tell_local(&app, &project_id, &file_id);
    Ok(message)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn collab_comment_edit(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
    file_id: String,
    thread_id: CommentId,
    message_id: CommentId,
    body: String,
    members: Vec<CommentMember>,
) -> Result<CommentMessage, CollabCommandError> {
    let message = write_comment(state.inner(), &project_id, |live, who| {
        edit_in(
            live,
            who,
            &file_id,
            thread_id,
            message_id,
            &body,
            &members,
            now_ms(),
        )
    })
    .map_err(command_error)?;
    tell_local(&app, &project_id, &file_id);
    Ok(message)
}

#[tauri::command]
pub async fn collab_comment_delete(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
    file_id: String,
    thread_id: CommentId,
    message_id: CommentId,
) -> Result<(), CollabCommandError> {
    write_comment(state.inner(), &project_id, |live, who| {
        delete_in(live, who, &file_id, thread_id, message_id)
    })
    .map_err(command_error)?;
    tell_local(&app, &project_id, &file_id);
    Ok(())
}

#[tauri::command]
pub async fn collab_comment_resolve(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
    file_id: String,
    thread_id: CommentId,
) -> Result<CommentThread, CollabCommandError> {
    let thread = write_comment(state.inner(), &project_id, |live, who| {
        resolve_in(live, who, &file_id, thread_id, now_ms())
    })
    .map_err(command_error)?;
    tell_local(&app, &project_id, &file_id);
    Ok(thread)
}

#[tauri::command]
pub async fn collab_comment_reopen(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
    file_id: String,
    thread_id: CommentId,
) -> Result<CommentThread, CollabCommandError> {
    let thread = write_comment(state.inner(), &project_id, |live, who| {
        reopen_in(live, who, &file_id, thread_id)
    })
    .map_err(command_error)?;
    tell_local(&app, &project_id, &file_id);
    Ok(thread)
}

#[tauri::command]
pub async fn collab_comment_thread_delete(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
    file_id: String,
    thread_id: CommentId,
) -> Result<(), CollabCommandError> {
    write_comment(state.inner(), &project_id, |live, who| {
        delete_thread_in(live, who, &file_id, thread_id)
    })
    .map_err(command_error)?;
    tell_local(&app, &project_id, &file_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use oleafly_collab::doc::NodeKind;

    use super::*;
    use crate::collab::live::{
        MergedPayload, NewDevicePayload, PresenceLeftPayload, PresencePayload, RolePayload,
        StatusPayload,
    };
    use crate::folder_watch::FolderChange;

    const TEXT: &str = "The quick brown fox jumps over the lazy dog.\n";

    #[derive(Default)]
    struct HeardComments(Mutex<Vec<CommentsChangedPayload>>);

    impl HeardComments {
        fn taken(&self) -> Vec<CommentsChangedPayload> {
            std::mem::take(&mut *self.0.lock().unwrap())
        }
    }

    impl LiveHost for HeardComments {
        fn status(&self, _: StatusPayload) {}
        fn role(&self, _: RolePayload) {}
        fn merged(&self, _: MergedPayload) {}
        fn presence(&self, _: PresencePayload) {}
        fn presence_left(&self, _: PresenceLeftPayload) {}
        fn folder_changed(&self, _: FolderChange) {}
        fn new_device(&self, _: NewDevicePayload) {}
        fn comments_changed(&self, payload: CommentsChangedPayload) {
            self.0.lock().unwrap().push(payload);
        }
    }

    struct Side {
        live: SharedLive,
        who: Commenter,
    }

    fn sides() -> (Side, Side, String) {
        let mut doc = ProjectDoc::create().unwrap();
        let chapters = doc
            .add_node(None, "chapters", NodeKind::Dir, None, "")
            .unwrap();
        let intro = doc
            .add_node(Some(&chapters), "intro.tex", NodeKind::Text, None, TEXT)
            .unwrap();
        let snapshot = doc.snapshot().unwrap();
        let alice = Side {
            live: Arc::new(Mutex::new(LiveProject::new(doc, 0, ProjectRole::Owner))),
            who: Commenter {
                account: AccountId::new_v7(),
                role: ProjectRole::Owner,
                switches: CommentSwitches::default(),
            },
        };
        let bob = Side {
            live: Arc::new(Mutex::new(LiveProject::new(
                ProjectDoc::load(&snapshot).unwrap(),
                0,
                ProjectRole::Editor,
            ))),
            who: Commenter {
                account: AccountId::new_v7(),
                role: ProjectRole::Editor,
                switches: CommentSwitches::default(),
            },
        };
        (alice, bob, intro)
    }

    fn member(account: AccountId, name: &str) -> CommentMember {
        CommentMember {
            account_id: account,
            display_name: name.to_owned(),
            login: None,
        }
    }

    fn deliver(from: &Side, to: &Side, seq: u64) {
        let outgoing = from.live.lock().unwrap().next_outgoing().unwrap().unwrap();
        assert!(to
            .live
            .lock()
            .unwrap()
            .import_update(seq, &outgoing.payload)
            .unwrap());
        from.live.lock().unwrap().acknowledged(outgoing.batch, seq);
    }

    fn code(error: CollabError) -> String {
        match error {
            CollabError::Api { code, .. } => code,
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn comments_round_trip_through_the_commands_and_the_other_side_hears_of_them() {
        let (alice, bob, intro) = sides();
        let members = vec![
            member(alice.who.account, "Alice Chen"),
            member(bob.who.account, "Bob Smith"),
        ];
        let (from, to) = (10, 19);
        let thread = {
            let mut live = alice.live.lock().unwrap();
            create_at(
                &mut live,
                &alice.who,
                "chapters/intro.tex",
                from,
                to,
                None,
                "@Bob Smith is this colour right?",
                &members,
                100,
            )
            .unwrap()
        };
        assert_eq!(thread.file_id, intro);
        assert_eq!(thread.anchor.quote, "brown fox");
        assert_eq!(thread.messages[0].mentions, vec![bob.who.account]);
        let heard = HeardComments::default();
        announce("paper", &alice.live, alice.who.account, &heard);
        assert!(heard.taken().is_empty());
        deliver(&alice, &bob, 1);
        announce("paper", &bob.live, bob.who.account, &heard);
        assert_eq!(
            heard.taken(),
            vec![CommentsChangedPayload {
                project_id: "paper".to_owned(),
                file_ids: vec![intro.clone()],
                paths: vec!["chapters/intro.tex".to_owned()],
                mentioned: vec![MentionedPayload {
                    file_id: intro.clone(),
                    path: Some("chapters/intro.tex".to_owned()),
                    thread_id: thread.id,
                    message_id: thread.messages[0].id,
                    author: alice.who.account,
                }],
                local: false,
            }]
        );
        announce("paper", &bob.live, bob.who.account, &heard);
        assert!(heard.taken().is_empty());
        let reply = {
            let mut live = bob.live.lock().unwrap();
            let reply =
                reply_in(&mut live, &bob.who, &intro, thread.id, "Yes", &members, 200).unwrap();
            let edited = edit_in(
                &mut live,
                &bob.who,
                &intro,
                thread.id,
                reply.id,
                "Yes, brown",
                &members,
                210,
            )
            .unwrap();
            assert_eq!(edited.edited_at, Some(210));
            resolve_in(&mut live, &bob.who, &intro, thread.id, 220).unwrap();
            reply
        };
        deliver(&bob, &alice, 2);
        announce("paper", &alice.live, alice.who.account, &heard);
        let told = heard.taken();
        assert_eq!(told.len(), 1);
        assert!(told[0].mentioned.is_empty());
        let listed = threads_at(alice.live.lock().unwrap().doc(), "chapters/intro.tex").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].messages[1].body, "Yes, brown");
        assert_eq!(
            listed[0].resolved.map(|resolved| resolved.by),
            Some(bob.who.account)
        );
        {
            let mut live = alice.live.lock().unwrap();
            let reopened = reopen_in(&mut live, &alice.who, &intro, thread.id).unwrap();
            assert_eq!(reopened.resolved, None);
            assert_eq!(
                code(delete_in(&mut live, &alice.who, &intro, thread.id, reply.id).unwrap_err()),
                "not_yours"
            );
            assert_eq!(
                code(delete_thread_in(&mut live, &alice.who, &intro, thread.id).unwrap_err()),
                "someone_replied"
            );
        }
        {
            let mut live = bob.live.lock().unwrap();
            delete_in(&mut live, &bob.who, &intro, thread.id, reply.id).unwrap();
        }
        deliver(&bob, &alice, 3);
        let mut live = alice.live.lock().unwrap();
        delete_thread_in(&mut live, &alice.who, &intro, thread.id).unwrap();
        assert!(threads_at(live.doc(), "chapters/intro.tex")
            .unwrap()
            .is_empty());
        assert!(live.take_disk_work().is_empty());
    }

    #[test]
    fn viewers_and_switched_off_projects_cannot_comment_but_can_read() {
        let (alice, _bob, _intro) = sides();
        let mut live = alice.live.lock().unwrap();
        create_at(
            &mut live,
            &alice.who,
            "chapters/intro.tex",
            4,
            9,
            None,
            "Quick?",
            &[],
            1,
        )
        .unwrap();
        let mut refusals = Vec::new();
        for who in [
            Commenter {
                account: AccountId::new_v7(),
                role: ProjectRole::Viewer,
                switches: CommentSwitches::default(),
            },
            Commenter {
                account: alice.who.account,
                role: ProjectRole::Owner,
                switches: CommentSwitches {
                    server: true,
                    project: false,
                },
            },
            Commenter {
                account: alice.who.account,
                role: ProjectRole::Owner,
                switches: CommentSwitches {
                    server: false,
                    project: true,
                },
            },
        ] {
            let refused = create_at(
                &mut live,
                &who,
                "chapters/intro.tex",
                10,
                15,
                None,
                "Nope",
                &[],
                2,
            )
            .unwrap_err();
            refusals.push(command_error(refused).code);
        }
        assert_eq!(
            refusals,
            vec![
                "comment_viewer",
                "comment_off_project",
                "comment_off_server"
            ]
        );
        assert_eq!(
            threads_at(live.doc(), "chapters/intro.tex").unwrap().len(),
            1
        );
        assert_eq!(
            code(threads_at(live.doc(), "chapters").unwrap_err()),
            "not_found"
        );
        assert_eq!(
            code(
                create_at(
                    &mut live,
                    &alice.who,
                    "missing.tex",
                    0,
                    1,
                    None,
                    "Hi",
                    &[],
                    3
                )
                .unwrap_err()
            ),
            "not_found"
        );
    }

    #[test]
    fn the_switches_are_remembered_for_when_the_server_cannot_be_reached() {
        let dir = tempfile::tempdir().unwrap();
        let paths = CollabPaths::new(dir.path().join("collab"));
        assert_eq!(load_switches(&paths, "paper"), CommentSwitches::default());
        let fresh = settle_status(&paths, "paper", Ok((true, false)), ProjectRole::Editor);
        assert_eq!(
            fresh,
            CommentsStatus {
                server_allowed: true,
                project_enabled: false,
                can_comment: false,
            }
        );
        let offline = settle_status(
            &paths,
            "paper",
            Err(CollabError::Network("offline".to_owned())),
            ProjectRole::Editor,
        );
        assert_eq!(offline, fresh);
        assert_eq!(
            load_switches(&paths, "paper"),
            CommentSwitches {
                server: true,
                project: false,
            }
        );
        let back = settle_status(&paths, "paper", Ok((true, true)), ProjectRole::Editor);
        assert!(back.can_comment);
        let viewer = settle_status(&paths, "paper", Ok((true, true)), ProjectRole::Viewer);
        assert!(!viewer.can_comment);
        assert!(viewer.server_allowed && viewer.project_enabled);
        assert_eq!(load_switches(&paths, "other"), CommentSwitches::default());
        assert_eq!(
            load_switches(&paths, "../escape"),
            CommentSwitches::default()
        );
    }

    #[test]
    fn a_project_that_is_not_live_lists_threads_from_its_saved_document() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let paths = CollabPaths::new(dir.path().join("collab"));
            let state = crate::collab::state::CollabState::new(
                paths.clone(),
                Arc::new(oleafly_collab::secret_port::MemorySecrets::default()),
            );
            let (alice, _bob, _intro) = sides();
            let mut live = Arc::try_unwrap(alice.live)
                .ok()
                .unwrap()
                .into_inner()
                .unwrap();
            create_at(
                &mut live,
                &alice.who,
                "chapters/intro.tex",
                4,
                9,
                None,
                "Saved",
                &[],
                1,
            )
            .unwrap();
            live.save(&paths.document_dir("saved-comments").unwrap())
                .unwrap();
            oleafly_collab::save_binding(
                &paths,
                "saved-comments",
                &oleafly_collab::ShareBinding {
                    server_url: "https://collab.test".to_owned(),
                    server_id: oleafly_collab_protocol::ids::ServerId::new_v7(),
                    shared_project_id: oleafly_collab_protocol::ids::SharedProjectId::new_v7(),
                    role: ProjectRole::Editor,
                    created_at: 0,
                },
            )
            .unwrap();
            let listed = list_threads(&state, "saved-comments", "chapters/intro.tex")
                .await
                .unwrap();
            assert_eq!(listed.rev, None);
            assert_eq!(listed.threads.len(), 1);
            assert_eq!(listed.threads[0].messages[0].body, "Saved");
            assert!(list_threads(&state, "never-shared", "chapters/intro.tex")
                .await
                .is_err());
        });
    }

    fn quiet_sink() -> oleafly_collab::live::DocSink {
        Arc::new(|_| {})
    }

    fn typed_at_start(live: &mut LiveProject, file: &str, rev: u64) {
        let length = live.doc().text(file).unwrap().encode_utf16().count();
        let mut operation = oleafly_collab::ot::TextOperation::new();
        operation.insert("So ").retain(length);
        live.editor_change(file, rev, operation).unwrap();
    }

    #[test]
    fn a_thread_list_carries_the_open_editors_revision() {
        let (alice, _bob, intro) = sides();
        let mut live = alice.live.lock().unwrap();
        create_at(
            &mut live,
            &alice.who,
            "chapters/intro.tex",
            4,
            9,
            None,
            "Quick?",
            &[],
            1,
        )
        .unwrap();
        let closed = thread_list_at(&live, "chapters/intro.tex").unwrap();
        assert_eq!(closed.rev, None);
        assert_eq!(closed.threads.len(), 1);
        let (opened, _) = live.open_file(&intro, quiet_sink()).unwrap();
        assert_eq!(
            thread_list_at(&live, "chapters/intro.tex").unwrap().rev,
            Some(opened)
        );
        typed_at_start(&mut live, &intro, opened);
        let after = thread_list_at(&live, "chapters/intro.tex").unwrap();
        assert_eq!(after.rev, Some(opened + 1));
        assert_eq!(
            after.threads[0].anchor.range.map(|range| range.from),
            Some(7)
        );
        let json = serde_json::to_value(&after).unwrap();
        assert_eq!(json["rev"], serde_json::json!(opened + 1));
        assert_eq!(json["threads"][0]["verified"], serde_json::json!(true));
        assert_eq!(
            json["threads"][0]["messages"][0]["verified"],
            serde_json::json!(true)
        );
    }

    #[test]
    fn a_new_thread_from_an_editor_that_was_behind_is_refused() {
        let (alice, _bob, intro) = sides();
        let mut live = alice.live.lock().unwrap();
        let (opened, _) = live.open_file(&intro, quiet_sink()).unwrap();
        typed_at_start(&mut live, &intro, opened);
        let stale = create_at(
            &mut live,
            &alice.who,
            "chapters/intro.tex",
            4,
            9,
            Some(opened),
            "Quick?",
            &[],
            1,
        )
        .unwrap_err();
        assert_eq!(command_error(stale).code, "comment_selection_changed");
        let current = create_at(
            &mut live,
            &alice.who,
            "chapters/intro.tex",
            7,
            12,
            Some(opened + 1),
            "Quick?",
            &[],
            2,
        )
        .unwrap();
        assert_eq!(current.anchor.quote, "quick");
        live.close_file(&intro);
        let gone = create_at(
            &mut live,
            &alice.who,
            "chapters/intro.tex",
            7,
            12,
            Some(opened + 1),
            "Again",
            &[],
            3,
        )
        .unwrap_err();
        assert_eq!(command_error(gone).code, "comment_selection_changed");
    }

    #[test]
    fn a_change_made_here_is_local_and_one_from_others_is_not() {
        let (alice, bob, intro) = sides();
        let here = local_change("paper", &intro, Some("chapters/intro.tex".to_owned()));
        assert!(here.local);
        assert_eq!(here.file_ids, vec![intro.clone()]);
        assert_eq!(
            serde_json::to_value(&here).unwrap()["local"],
            serde_json::json!(true)
        );
        {
            let mut live = alice.live.lock().unwrap();
            create_at(
                &mut live,
                &alice.who,
                "chapters/intro.tex",
                4,
                9,
                None,
                "Quick?",
                &[],
                1,
            )
            .unwrap();
        }
        deliver(&alice, &bob, 1);
        let heard = HeardComments::default();
        announce("paper", &bob.live, bob.who.account, &heard);
        let told = heard.taken();
        assert_eq!(told.len(), 1);
        assert!(!told[0].local);
    }

    #[test]
    fn each_refusal_reaches_the_app_as_its_own_code() {
        let (alice, bob, intro) = sides();
        let thread = {
            let mut live = alice.live.lock().unwrap();
            create_at(
                &mut live,
                &alice.who,
                "chapters/intro.tex",
                4,
                9,
                None,
                "Quick?",
                &[],
                1,
            )
            .unwrap()
        };
        deliver(&alice, &bob, 1);
        let reply = {
            let mut live = bob.live.lock().unwrap();
            reply_in(&mut live, &bob.who, &intro, thread.id, "Yes", &[], 2).unwrap()
        };
        deliver(&bob, &alice, 2);
        let mut live = alice.live.lock().unwrap();
        let mut codes = vec![
            command_error(
                delete_in(&mut live, &alice.who, &intro, thread.id, reply.id).unwrap_err(),
            )
            .code,
            command_error(delete_thread_in(&mut live, &alice.who, &intro, thread.id).unwrap_err())
                .code,
        ];
        let mine = thread.messages[0].id;
        delete_in(&mut live, &alice.who, &intro, thread.id, mine).unwrap();
        codes.push(
            command_error(
                edit_in(
                    &mut live,
                    &alice.who,
                    &intro,
                    thread.id,
                    mine,
                    "Back",
                    &[],
                    3,
                )
                .unwrap_err(),
            )
            .code,
        );
        codes.push(
            command_error(
                create_at(
                    &mut live,
                    &alice.who,
                    "chapters/intro.tex",
                    40,
                    90,
                    None,
                    "Past the end",
                    &[],
                    4,
                )
                .unwrap_err(),
            )
            .code,
        );
        let long = "x".repeat(oleafly_collab::comments::MAX_BODY_CHARS + 1);
        codes.push(
            command_error(
                reply_in(&mut live, &alice.who, &intro, thread.id, &long, &[], 5).unwrap_err(),
            )
            .code,
        );
        codes.push(
            command_error(
                reply_in(&mut live, &alice.who, &intro, thread.id, "   ", &[], 6).unwrap_err(),
            )
            .code,
        );
        assert_eq!(
            codes,
            vec![
                "comment_not_yours",
                "comment_someone_replied",
                "comment_message_deleted",
                "comment_selection_changed",
                "comment_too_long",
                "comment_empty",
            ]
        );
        assert_eq!(
            command_error(
                reply_in(
                    &mut live,
                    &alice.who,
                    &intro,
                    CommentId::new_v7(),
                    "Lost",
                    &[],
                    7
                )
                .unwrap_err()
            )
            .code,
            "not_found"
        );
        assert_eq!(
            command_error(CollabError::Network("offline".to_owned())).code,
            "unreachable"
        );
    }

    #[test]
    fn writing_to_a_project_that_is_not_live_says_so() {
        let dir = tempfile::tempdir().unwrap();
        let state = crate::collab::state::CollabState::new(
            CollabPaths::new(dir.path().join("collab")),
            Arc::new(oleafly_collab::secret_port::MemorySecrets::default()),
        );
        let refused = write_comment(&state, "never-live", |_, _| Ok(())).unwrap_err();
        assert_eq!(command_error(refused).code, "comment_not_live");
    }
}
