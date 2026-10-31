use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::PoisonError;

use oleafly_collab::comments::{mentions_in, CommentMember, CommentThread};
use oleafly_collab::doc::{NodeKind, ProjectDoc};
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize::{self, Layout};
use oleafly_collab::suggestions::{EditMode, Suggestion};
use oleafly_collab::sync::SharedLive;
use oleafly_collab::{load_binding, write_atomic, CollabError, CollabPaths};
use oleafly_collab_protocol::ids::SuggestionId;
use oleafly_collab_protocol::projects::{project_role_allows, ProjectAction, ProjectRole};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use super::commands::{now_ms, CollabCommandError};
use super::live::LiveHost;
use super::state::CollabState;

pub const SUGGESTIONS_CHANGED_EVENT: &str = "collab://suggestions-changed";
pub const TREE_REFUSED: &str = "collab.suggestion_role";
const MODE_FILE: &str = "edit_mode.json";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionsChangedPayload {
    pub project_id: String,
    pub paths: Vec<String>,
    pub local: bool,
}

pub const SUGGESTION_REFUSED_EVENT: &str = "collab://suggestion-refused";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionRefusedPayload {
    pub project_id: String,
    pub path: String,
    pub code: &'static str,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionList {
    pub rev: Option<u64>,
    pub suggestions: Vec<Suggestion>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionCount {
    pub path: String,
    pub pending: usize,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
struct StoredMode {
    mode: EditMode,
}

pub(crate) fn refused(status: u16, code: &str, message: &str) -> CollabError {
    CollabError::Api {
        status,
        code: code.to_owned(),
        message: message.to_owned(),
    }
}

fn role_refused() -> CollabError {
    refused(
        403,
        "suggestion_role",
        "your role in this project doesn't allow this",
    )
}

fn not_shared() -> CollabError {
    refused(404, "not_found", "this project is not shared")
}

fn io(error: impl std::fmt::Display) -> CollabError {
    CollabError::Io(error.to_string())
}

fn mode_file(paths: &CollabPaths, project_id: &str) -> Result<PathBuf, CollabError> {
    Ok(paths.project_dir(project_id)?.join(MODE_FILE))
}

pub(crate) fn load_mode(paths: &CollabPaths, project_id: &str) -> EditMode {
    mode_file(paths, project_id)
        .ok()
        .and_then(|file| std::fs::read(file).ok())
        .and_then(|bytes| serde_json::from_slice::<StoredMode>(&bytes).ok())
        .map(|stored| stored.mode)
        .unwrap_or_default()
}

fn save_mode(paths: &CollabPaths, project_id: &str, mode: EditMode) -> Result<(), CollabError> {
    let file = mode_file(paths, project_id)?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(io)?;
    }
    let bytes = serde_json::to_vec(&StoredMode { mode }).map_err(io)?;
    write_atomic(&file, &bytes)
}

pub(crate) fn mode_for(role: ProjectRole, chosen: EditMode) -> EditMode {
    match role {
        ProjectRole::Reviewer => EditMode::Suggesting,
        ProjectRole::Owner | ProjectRole::Editor => chosen,
        ProjectRole::Commenter | ProjectRole::Viewer | ProjectRole::Unknown => EditMode::Editing,
    }
}

pub(crate) fn may_choose(role: ProjectRole, mode: EditMode) -> Result<(), CollabError> {
    match role {
        ProjectRole::Owner | ProjectRole::Editor => Ok(()),
        ProjectRole::Reviewer if mode == EditMode::Suggesting => Ok(()),
        _ => Err(role_refused()),
    }
}

fn layout_of(doc: &ProjectDoc) -> Layout {
    doc.nodes()
        .map(|nodes| materialize::layout(&nodes))
        .unwrap_or_default()
}

pub(crate) fn path_of(doc: &ProjectDoc, file_id: &str) -> Option<String> {
    layout_of(doc)
        .get(file_id)
        .map(|placed| placed.path.clone())
}

pub(crate) fn file_at(doc: &ProjectDoc, path: &str) -> Result<String, CollabError> {
    layout_of(doc)
        .into_iter()
        .find(|(_, placed)| placed.path == path && placed.kind == NodeKind::Text)
        .map(|(id, _)| id)
        .ok_or_else(|| refused(404, "not_found", "this file is not in the shared project"))
}

pub(crate) fn tell(host: &dyn LiveHost, project_id: &str, path: Option<String>, local: bool) {
    host.suggestions_changed(SuggestionsChangedPayload {
        project_id: project_id.to_owned(),
        paths: path.into_iter().collect(),
        local,
    });
}

pub(crate) fn announce(project_id: &str, live: &SharedLive, host: &dyn LiveHost) {
    let paths: Vec<String> = {
        let mut live = live.lock().unwrap_or_else(PoisonError::into_inner);
        let files = live.take_suggestion_changes();
        if files.is_empty() {
            return;
        }
        let layout = layout_of(live.doc());
        files
            .iter()
            .filter_map(|file| layout.get(file).map(|placed| placed.path.clone()))
            .collect()
    };
    host.suggestions_changed(SuggestionsChangedPayload {
        project_id: project_id.to_owned(),
        paths,
        local: false,
    });
}

pub(crate) fn list_in(live: &LiveProject, path: &str) -> Result<SuggestionList, CollabError> {
    let file = file_at(live.doc(), path)?;
    Ok(SuggestionList {
        rev: live.editor_rev(&file),
        suggestions: live.doc().suggestions(&file)?,
    })
}

pub(crate) fn counts_in(doc: &ProjectDoc) -> Vec<SuggestionCount> {
    let layout = layout_of(doc);
    let mut counts: Vec<SuggestionCount> = doc
        .suggestion_counts()
        .into_iter()
        .filter_map(|(file, pending)| {
            let placed = layout.get(&file)?;
            (placed.kind == NodeKind::Text).then(|| SuggestionCount {
                path: placed.path.clone(),
                pending,
            })
        })
        .collect();
    counts.sort_by(|left, right| left.path.cmp(&right.path));
    counts
}

async fn saved<T: Send + 'static>(
    state: &CollabState,
    project_id: &str,
    work: impl FnOnce(&LiveProject) -> Result<T, CollabError> + Send + 'static,
) -> Result<T, CollabError> {
    let paths = state.paths()?;
    load_binding(paths, project_id)?.ok_or_else(not_shared)?;
    let dir = paths.document_dir(project_id)?;
    tokio::task::spawn_blocking(move || {
        let saved = LiveProject::load(&dir, ProjectRole::Viewer)?;
        work(&saved)
    })
    .await
    .map_err(io)?
}

pub async fn list_suggestions(
    state: &CollabState,
    project_id: &str,
    path: &str,
) -> Result<SuggestionList, CollabError> {
    if let Some(listed) = super::live::read_live(project_id, |live| list_in(live, path)) {
        return listed;
    }
    let path = path.to_owned();
    saved(state, project_id, move |saved| {
        let file = file_at(saved.doc(), &path)?;
        Ok(SuggestionList {
            rev: None,
            suggestions: saved.doc().suggestions(&file)?,
        })
    })
    .await
}

pub async fn count_suggestions(
    state: &CollabState,
    project_id: &str,
) -> Result<Vec<SuggestionCount>, CollabError> {
    if let Some(counted) = super::live::read_live(project_id, |live| counts_in(live.doc())) {
        return Ok(counted);
    }
    saved(state, project_id, |saved| Ok(counts_in(saved.doc()))).await
}

pub fn edit_mode(state: &CollabState, project_id: &str) -> Result<EditMode, CollabError> {
    if let Some(mode) = super::live::read_live(project_id, |live| {
        mode_for(live.role(), live.chosen_edit_mode())
    }) {
        return Ok(mode);
    }
    let paths = state.paths()?;
    let binding = load_binding(paths, project_id)?.ok_or_else(not_shared)?;
    Ok(mode_for(binding.role, load_mode(paths, project_id)))
}

pub fn set_edit_mode(
    state: &CollabState,
    project_id: &str,
    mode: EditMode,
) -> Result<(), CollabError> {
    let paths = state.paths()?;
    let binding = load_binding(paths, project_id)?.ok_or_else(not_shared)?;
    let role = super::live::read_live(project_id, LiveProject::role).unwrap_or(binding.role);
    may_choose(role, mode)?;
    if !matches!(role, ProjectRole::Owner | ProjectRole::Editor) {
        return Ok(());
    }
    save_mode(paths, project_id, mode)?;
    if super::live::read_live(project_id, |_| ()).is_some() {
        super::live::edit_live(project_id, |live| {
            live.set_edit_mode(mode);
            Ok(())
        })?;
    }
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Decision {
    Accept,
    Reject,
    Withdraw,
}

pub(crate) fn decide_in(
    live: &mut LiveProject,
    who: oleafly_collab_protocol::ids::AccountId,
    decision: Decision,
    ids: &[SuggestionId],
) -> Result<BTreeSet<String>, CollabError> {
    let role = live.role();
    let allowed = match decision {
        Decision::Accept | Decision::Reject => project_role_allows(role, ProjectAction::Resolve),
        Decision::Withdraw => project_role_allows(role, ProjectAction::Suggest),
    };
    if !allowed {
        return Err(role_refused());
    }
    let files = ids
        .iter()
        .map(|id| live.doc().suggestion_file(*id))
        .collect::<Result<BTreeSet<String>, CollabError>>()?;
    live.edit_suggestions(&files, |doc| match decision {
        Decision::Accept => doc.accept_suggestions(ids),
        Decision::Reject => doc.reject_suggestions(ids),
        Decision::Withdraw => doc.withdraw_suggestions(ids, who),
    })
}

pub(crate) fn decide_file_in(
    live: &mut LiveProject,
    decision: Decision,
    path: &str,
) -> Result<String, CollabError> {
    if !project_role_allows(live.role(), ProjectAction::Resolve) {
        return Err(role_refused());
    }
    let file = file_at(live.doc(), path)?;
    let files = BTreeSet::from([file.clone()]);
    live.edit_suggestions(&files, |doc| match decision {
        Decision::Accept => doc.accept_file_suggestions(&file),
        _ => doc.reject_file_suggestions(&file),
    })?;
    Ok(file)
}

pub(crate) fn tell_local(app: &tauri::AppHandle, project_id: &str, files: &BTreeSet<String>) {
    let paths = super::live::read_live(project_id, |live| {
        let layout = layout_of(live.doc());
        files
            .iter()
            .filter_map(|file| layout.get(file).map(|placed| placed.path.clone()))
            .collect::<Vec<_>>()
    })
    .unwrap_or_default();
    let _ = app.emit(
        SUGGESTIONS_CHANGED_EVENT,
        SuggestionsChangedPayload {
            project_id: project_id.to_owned(),
            paths,
            local: true,
        },
    );
}

fn decided(
    app: &tauri::AppHandle,
    project_id: &str,
    decision: Decision,
    ids: &[SuggestionId],
) -> Result<(), CollabCommandError> {
    let files =
        super::live::review_live(project_id, |live, who| decide_in(live, who, decision, ids))
            .map_err(CollabCommandError::from)?;
    tell_local(app, project_id, &files);
    Ok(())
}

fn decided_file(
    app: &tauri::AppHandle,
    project_id: &str,
    decision: Decision,
    path: &str,
) -> Result<(), CollabCommandError> {
    let file = super::live::review_live(project_id, |live, _| decide_file_in(live, decision, path))
        .map_err(CollabCommandError::from)?;
    tell_local(app, project_id, &BTreeSet::from([file]));
    Ok(())
}

pub(crate) fn reply_in(
    live: &mut LiveProject,
    who: &crate::collab::comments::Commenter,
    id: SuggestionId,
    body: &str,
    members: &[CommentMember],
    now: i64,
) -> Result<CommentThread, CollabError> {
    who.may_write()?;
    let author = live.doc().suggestion_author(id)?;
    let role = live.role();
    let link = project_role_allows(role, ProjectAction::Edit)
        || (role == ProjectRole::Reviewer && author == who.account);
    live.comment_doc().reply_to_suggestion(
        id,
        who.account,
        now,
        body,
        &mentions_in(body, members),
        link,
    )
}

pub(crate) fn tree_change_refused(project_id: &str, paths: &[&str]) -> Result<(), String> {
    let role = super::live::read_live(project_id, LiveProject::role);
    if !matches!(role, Some(ProjectRole::Reviewer | ProjectRole::Commenter)) {
        return Ok(());
    }
    let local_only = super::live::live_root(project_id).is_some_and(|root| {
        let rules = crate::collab::disk::ShareRules::load(&root);
        !paths.is_empty()
            && paths.iter().all(|path| {
                let path = path.trim_matches('/');
                !path.is_empty() && rules.leaves_out(path, root.join(path).is_dir())
            })
    });
    if local_only {
        return Ok(());
    }
    Err(crate::app_error::AppError::new(TREE_REFUSED).to_string())
}

#[tauri::command]
pub async fn collab_suggestion_reply(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
    id: SuggestionId,
    body: String,
    members: Vec<CommentMember>,
) -> Result<CommentThread, CollabCommandError> {
    let thread = crate::collab::comments::write_comment(state.inner(), &project_id, |live, who| {
        reply_in(live, who, id, &body, &members, now_ms())
    })
    .map_err(crate::collab::comments::command_error)?;
    crate::collab::comments::tell_local(&app, &project_id, &thread.file_id);
    tell_local(&app, &project_id, &BTreeSet::from([thread.file_id.clone()]));
    Ok(thread)
}

#[tauri::command]
pub async fn collab_edit_mode_get(
    state: tauri::State<'_, CollabState>,
    project_id: String,
) -> Result<EditMode, CollabCommandError> {
    edit_mode(state.inner(), &project_id).map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_edit_mode_set(
    state: tauri::State<'_, CollabState>,
    project_id: String,
    mode: EditMode,
) -> Result<(), CollabCommandError> {
    set_edit_mode(state.inner(), &project_id, mode).map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_suggestion_list(
    state: tauri::State<'_, CollabState>,
    project_id: String,
    path: String,
) -> Result<SuggestionList, CollabCommandError> {
    list_suggestions(state.inner(), &project_id, &path)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_suggestion_counts(
    state: tauri::State<'_, CollabState>,
    project_id: String,
) -> Result<Vec<SuggestionCount>, CollabCommandError> {
    count_suggestions(state.inner(), &project_id)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_suggestion_accept(
    app: tauri::AppHandle,
    project_id: String,
    ids: Vec<SuggestionId>,
) -> Result<(), CollabCommandError> {
    decided(&app, &project_id, Decision::Accept, &ids)
}

#[tauri::command]
pub async fn collab_suggestion_reject(
    app: tauri::AppHandle,
    project_id: String,
    ids: Vec<SuggestionId>,
) -> Result<(), CollabCommandError> {
    decided(&app, &project_id, Decision::Reject, &ids)
}

#[tauri::command]
pub async fn collab_suggestion_withdraw(
    app: tauri::AppHandle,
    project_id: String,
    ids: Vec<SuggestionId>,
) -> Result<(), CollabCommandError> {
    decided(&app, &project_id, Decision::Withdraw, &ids)
}

#[tauri::command]
pub async fn collab_suggestion_accept_file(
    app: tauri::AppHandle,
    project_id: String,
    path: String,
) -> Result<(), CollabCommandError> {
    decided_file(&app, &project_id, Decision::Accept, &path)
}

#[tauri::command]
pub async fn collab_suggestion_reject_file(
    app: tauri::AppHandle,
    project_id: String,
    path: String,
) -> Result<(), CollabCommandError> {
    decided_file(&app, &project_id, Decision::Reject, &path)
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use oleafly_collab::doc::{NodeKind, ProjectDoc};
    use oleafly_collab::ot::TextOperation;
    use oleafly_collab::suggestions::SuggestionKind;
    use oleafly_collab_protocol::ids::AccountId;

    use super::*;
    use crate::collab::live::{
        MergedPayload, NewDevicePayload, PresenceLeftPayload, PresencePayload, RolePayload,
        StatusPayload,
    };
    use crate::folder_watch::FolderChange;

    #[derive(Default)]
    struct Heard(Mutex<Vec<SuggestionsChangedPayload>>);

    impl LiveHost for Heard {
        fn status(&self, _: StatusPayload) {}
        fn role(&self, _: RolePayload) {}
        fn merged(&self, _: MergedPayload) {}
        fn presence(&self, _: PresencePayload) {}
        fn presence_left(&self, _: PresenceLeftPayload) {}
        fn folder_changed(&self, _: FolderChange) {}
        fn new_device(&self, _: NewDevicePayload) {}
        fn suggestions_changed(&self, payload: SuggestionsChangedPayload) {
            self.0.lock().unwrap().push(payload);
        }
    }

    struct Side {
        live: SharedLive,
        account: AccountId,
    }

    fn side(doc: ProjectDoc, role: ProjectRole) -> Side {
        let account = AccountId::new_v7();
        let mut doc = doc;
        doc.set_author(&account.to_string(), "Someone");
        Side {
            live: Arc::new(Mutex::new(LiveProject::new(doc, 0, role))),
            account,
        }
    }

    fn room(role: ProjectRole) -> (Side, Side, String) {
        let mut doc = ProjectDoc::create().unwrap();
        let chapters = doc
            .add_node(None, "chapters", NodeKind::Dir, None, "")
            .unwrap();
        let intro = doc
            .add_node(
                Some(&chapters),
                "intro.tex",
                NodeKind::Text,
                None,
                "Hello world\n",
            )
            .unwrap();
        let snapshot = doc.snapshot().unwrap();
        let owner = side(doc, ProjectRole::Owner);
        let other = side(ProjectDoc::load(&snapshot).unwrap(), role);
        (owner, other, intro)
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

    fn suggest(side: &Side, file: &str, at: usize, typed: &str) {
        let mut live = side.live.lock().unwrap();
        let length = live.doc().text(file).unwrap().encode_utf16().count();
        let mut operation = TextOperation::new();
        operation.retain(at).insert(typed).retain(length - at);
        let account = side.account;
        live.edit_suggestions(&BTreeSet::from([file.to_owned()]), |doc| {
            doc.suggest_operation(file, &operation, account, None, 5)
        })
        .unwrap();
    }

    fn code(error: CollabError) -> String {
        match error {
            CollabError::Api { code, .. } => code,
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn every_review_command_is_registered_with_the_app() {
        let source = include_str!("../lib.rs");
        for name in [
            "suggesting::collab_edit_mode_get",
            "suggesting::collab_edit_mode_set",
            "suggesting::collab_suggestion_list",
            "suggesting::collab_suggestion_counts",
            "suggesting::collab_suggestion_accept",
            "suggesting::collab_suggestion_reject",
            "suggesting::collab_suggestion_withdraw",
            "suggesting::collab_suggestion_accept_file",
            "suggesting::collab_suggestion_reject_file",
            "suggesting::collab_suggestion_reply",
            "chat::collab_chat_list",
            "chat::collab_chat_send",
            "chat::collab_chat_delete",
            "chat::collab_chat_clear",
            "history::collab_history_list",
            "history::collab_history_file",
            "history::collab_history_changed_files",
            "history::collab_history_restore",
            "history::collab_version_name",
            "history::collab_version_unname",
            "output::collab_output_info",
        ] {
            assert!(
                source.contains(&format!("collab::{name},")),
                "{name} is not in the invoke handler"
            );
        }
        assert!(!source.contains("collab_live_collaboration_set"));
    }

    #[test]
    fn reviewers_and_commenters_cannot_change_the_file_tree_of_a_live_project() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("project");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(".gitignore"), "scratch/\n").unwrap();
        let rig = crate::collab::live::write::rig::LiveRig::start(
            "tree-roles",
            &root,
            &[("main.tex", "abc")],
        );
        let _live = rig.go_live();
        assert!(tree_change_refused("tree-roles", &["new.tex"]).is_ok());
        for role in [ProjectRole::Reviewer, ProjectRole::Commenter] {
            rig.set_role(role);
            for paths in [&["new.tex"][..], &["main.tex", "renamed.tex"], &[""]] {
                let refused = tree_change_refused("tree-roles", paths).unwrap_err();
                assert!(refused.contains(TREE_REFUSED), "{refused}");
            }
            assert!(tree_change_refused("tree-roles", &["scratch/notes.txt"]).is_ok());
        }
        rig.set_role(ProjectRole::Editor);
        assert!(tree_change_refused("tree-roles", &["new.tex"]).is_ok());
        assert!(tree_change_refused("not-live", &["new.tex"]).is_ok());
    }

    #[test]
    fn a_tool_write_by_a_reviewer_becomes_a_suggestion_and_a_new_file_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("project");
        std::fs::create_dir_all(&root).unwrap();
        let rig = crate::collab::live::write::rig::LiveRig::start(
            "tool-review",
            &root,
            &[("main.tex", "Hello world")],
        );
        let _live = rig.go_live();
        rig.set_role(ProjectRole::Reviewer);
        let shared = rig.shared_live();
        let reviewer = AccountId::new_v7();
        shared
            .lock()
            .unwrap()
            .doc_mut()
            .set_author(&reviewer.to_string(), "Rae");
        let written = tauri::async_runtime::block_on(crate::collab::live::write::write_text(
            "tool-review",
            "main.tex",
            None,
            "Hello brave world",
        ))
        .unwrap();
        assert!(written.handled);
        let live = shared.lock().unwrap();
        let file = file_at(live.doc(), "main.tex").unwrap();
        assert_eq!(live.doc().text(&file).unwrap(), "Hello brave world");
        let listed = live.doc().suggestions(&file).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].author, reviewer);
        drop(live);
        let fresh = tauri::async_runtime::block_on(crate::collab::live::write::write_text(
            "tool-review",
            "fresh.tex",
            None,
            "new",
        ))
        .unwrap();
        assert!(!fresh.handled);
    }

    #[test]
    fn the_edit_mode_follows_the_role() {
        assert_eq!(
            mode_for(ProjectRole::Reviewer, EditMode::Editing),
            EditMode::Suggesting
        );
        assert_eq!(
            mode_for(ProjectRole::Editor, EditMode::Suggesting),
            EditMode::Suggesting
        );
        assert_eq!(
            mode_for(ProjectRole::Owner, EditMode::Editing),
            EditMode::Editing
        );
        assert_eq!(
            mode_for(ProjectRole::Commenter, EditMode::Suggesting),
            EditMode::Editing
        );
        assert!(may_choose(ProjectRole::Editor, EditMode::Suggesting).is_ok());
        assert!(may_choose(ProjectRole::Reviewer, EditMode::Suggesting).is_ok());
        for (role, mode) in [
            (ProjectRole::Reviewer, EditMode::Editing),
            (ProjectRole::Commenter, EditMode::Suggesting),
            (ProjectRole::Viewer, EditMode::Editing),
        ] {
            assert_eq!(
                code(may_choose(role, mode).unwrap_err()),
                "suggestion_role",
                "{role:?}"
            );
        }
    }

    #[test]
    fn an_owners_chosen_mode_is_kept_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let paths = CollabPaths::new(dir.path().join("collab"));
        assert_eq!(load_mode(&paths, "paper"), EditMode::Editing);
        save_mode(&paths, "paper", EditMode::Suggesting).unwrap();
        assert_eq!(load_mode(&paths, "paper"), EditMode::Suggesting);
    }

    #[test]
    fn a_reviewers_suggestion_is_listed_counted_and_heard_by_the_owner() {
        let (owner, reviewer, intro) = room(ProjectRole::Reviewer);
        suggest(&reviewer, &intro, 5, ", dear");
        deliver(&reviewer, &owner, 1);
        let heard = Heard::default();
        announce("paper", &owner.live, &heard);
        assert_eq!(
            heard.0.lock().unwrap().clone(),
            vec![SuggestionsChangedPayload {
                project_id: "paper".to_owned(),
                paths: vec!["chapters/intro.tex".to_owned()],
                local: false,
            }]
        );
        announce("paper", &owner.live, &heard);
        assert_eq!(heard.0.lock().unwrap().len(), 1);
        let live = owner.live.lock().unwrap();
        let listed = list_in(&live, "chapters/intro.tex").unwrap();
        assert_eq!(listed.rev, None);
        assert_eq!(listed.suggestions.len(), 1);
        assert_eq!(listed.suggestions[0].kind, SuggestionKind::Insert);
        assert_eq!(listed.suggestions[0].author, reviewer.account);
        assert_eq!(
            counts_in(live.doc()),
            vec![SuggestionCount {
                path: "chapters/intro.tex".to_owned(),
                pending: 1,
            }]
        );
        let wire = serde_json::to_value(&listed).unwrap();
        let first = &wire["suggestions"][0];
        for key in [
            "id",
            "fileId",
            "kind",
            "author",
            "createdAt",
            "from",
            "to",
            "text",
            "threadId",
            "verified",
        ] {
            assert!(first.get(key).is_some(), "{key} in {first}");
        }
        assert_eq!(first["kind"], "insert");
    }

    #[test]
    fn only_owners_and_editors_accept_or_reject_and_only_the_author_withdraws() {
        let (owner, reviewer, intro) = room(ProjectRole::Reviewer);
        suggest(&reviewer, &intro, 5, ", dear");
        let ids: Vec<SuggestionId> = reviewer
            .live
            .lock()
            .unwrap()
            .doc()
            .suggestions(&intro)
            .unwrap()
            .into_iter()
            .map(|found| found.id)
            .collect();
        {
            let mut live = reviewer.live.lock().unwrap();
            for decision in [Decision::Accept, Decision::Reject] {
                let refused = decide_in(&mut live, reviewer.account, decision, &ids).unwrap_err();
                assert_eq!(code(refused), "suggestion_role");
            }
            let refused =
                decide_file_in(&mut live, Decision::Accept, "chapters/intro.tex").unwrap_err();
            assert_eq!(code(refused), "suggestion_role");
        }
        deliver(&reviewer, &owner, 1);
        {
            let mut live = owner.live.lock().unwrap();
            let refused =
                decide_in(&mut live, owner.account, Decision::Withdraw, &ids).unwrap_err();
            assert_eq!(code(refused), "suggestion_not_yours");
            let files = decide_in(&mut live, owner.account, Decision::Accept, &ids).unwrap();
            assert_eq!(files, BTreeSet::from([intro.clone()]));
            assert_eq!(live.doc().text(&intro).unwrap(), "Hello, dear world\n");
            let gone = decide_in(&mut live, owner.account, Decision::Reject, &ids).unwrap_err();
            assert_eq!(code(gone), "suggestion_not_found");
        }
        suggest(&reviewer, &intro, 0, "Oh. ");
        let mine: Vec<SuggestionId> = reviewer
            .live
            .lock()
            .unwrap()
            .doc()
            .suggestions(&intro)
            .unwrap()
            .into_iter()
            .map(|found| found.id)
            .collect();
        let mut live = reviewer.live.lock().unwrap();
        decide_in(&mut live, reviewer.account, Decision::Withdraw, &mine).unwrap();
        assert!(live.doc().suggestions(&intro).unwrap().is_empty());
    }

    #[test]
    fn anyone_who_may_comment_replies_on_a_suggestion_and_viewers_may_not() {
        let (owner, reviewer, intro) = room(ProjectRole::Reviewer);
        suggest(&reviewer, &intro, 5, ", dear");
        deliver(&reviewer, &owner, 1);
        let id = owner
            .live
            .lock()
            .unwrap()
            .doc()
            .suggestions(&intro)
            .unwrap()[0]
            .id;
        let commenter =
            |role: ProjectRole, account: AccountId| crate::collab::comments::Commenter {
                account,
                role,
                switches: crate::collab::comments::CommentSwitches::default(),
            };
        let mut live = owner.live.lock().unwrap();
        let who = commenter(ProjectRole::Commenter, AccountId::new_v7());
        live.set_role(ProjectRole::Commenter);
        let thread = reply_in(&mut live, &who, id, "Why?", &[], 9).unwrap();
        assert_eq!(thread.anchor.quote, ", dear");
        let listed = live.doc().suggestions(&intro).unwrap();
        assert_eq!(listed[0].thread_id, Some(thread.id));
        let who = commenter(ProjectRole::Viewer, AccountId::new_v7());
        live.set_role(ProjectRole::Viewer);
        assert_eq!(
            code(reply_in(&mut live, &who, id, "Hm", &[], 10).unwrap_err()),
            "viewer"
        );
        live.set_role(ProjectRole::Owner);
        let who = commenter(ProjectRole::Owner, owner.account);
        let again = reply_in(&mut live, &who, id, "Fine", &[], 11).unwrap();
        assert_eq!(again.id, thread.id);
        assert_eq!(again.messages.len(), 2);
    }

    #[test]
    fn rejecting_a_whole_file_puts_its_text_back() {
        let (owner, reviewer, intro) = room(ProjectRole::Reviewer);
        suggest(&reviewer, &intro, 0, "A ");
        suggest(&reviewer, &intro, 13, "!");
        deliver(&reviewer, &owner, 1);
        let mut live = owner.live.lock().unwrap();
        decide_file_in(&mut live, Decision::Reject, "chapters/intro.tex").unwrap();
        assert_eq!(live.doc().text(&intro).unwrap(), "Hello world\n");
        assert!(counts_in(live.doc()).is_empty());
        assert_eq!(
            code(decide_file_in(&mut live, Decision::Reject, "missing.tex").unwrap_err()),
            "not_found"
        );
    }
}
