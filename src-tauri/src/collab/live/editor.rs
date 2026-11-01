use oleafly_collab::doc::NodeKind;
use oleafly_collab::live::{DocSink, LiveProject};
use oleafly_collab::materialize;
use oleafly_collab::ot::TextOperation;
use oleafly_collab::CollabError;
use oleafly_collab_protocol::ids::AccountId;
use oleafly_collab_protocol::projects::PresenceState;

use super::payloads::DocOpened;
use super::session::{active_for, lock, not_live};
use crate::collab::commands::CollabCommandError;

pub fn doc_open(
    project_id: &str,
    path: &str,
    sink: DocSink,
) -> Result<Option<DocOpened>, CollabError> {
    let Some(active) = active_for(project_id) else {
        return Ok(None);
    };
    let mut live = lock(&active.live);
    let layout = materialize::layout(&live.doc().nodes()?);
    let Some((id, _)) = layout
        .iter()
        .find(|(_, placed)| placed.path == path && placed.kind == NodeKind::Text)
    else {
        return Ok(None);
    };
    let id = id.clone();
    let opened = live.open_file(&id, sink)?;
    Ok(Some(DocOpened {
        file_id: id,
        rev: opened.rev,
        text: opened.text,
        session: opened.session,
    }))
}

pub fn doc_change(
    project_id: &str,
    file_id: &str,
    rev: u64,
    operation: TextOperation,
) -> Result<(), CollabError> {
    let active = active_for(project_id).ok_or_else(not_live)?;
    let (suggested, refused) = {
        let mut live = lock(&active.live);
        let reviewed = live.suggesting()
            || live
                .guarded(|live| Ok(live.doc().holds_suggestions(file_id)))
                .unwrap_or(false);
        live.editor_change(file_id, rev, operation)?;
        let path = crate::collab::suggesting::path_of(live.doc(), file_id);
        let refused = live
            .take_refusal(file_id)
            .zip(path.clone())
            .map(|(error, path)| (CollabCommandError::from(error).code, path));
        (reviewed.then_some(path), refused)
    };
    active.handle.flush();
    active.kick();
    active.refresh_pending();
    if let Some(path) = suggested {
        crate::collab::suggesting::tell(active.host.as_ref(), project_id, path, true);
    }
    if let Some((code, path)) = refused {
        active
            .host
            .suggestion_refused(crate::collab::suggesting::SuggestionRefusedPayload {
                project_id: project_id.to_owned(),
                path,
                code,
            });
    }
    Ok(())
}

pub fn document_snapshot(project_id: &str) -> Option<Result<Vec<u8>, CollabError>> {
    active_for(project_id).map(|active| lock(&active.live).guarded(|live| live.doc().snapshot()))
}

pub(in crate::collab) fn read_live<T>(
    project_id: &str,
    work: impl FnOnce(&LiveProject) -> T,
) -> Option<T> {
    let active = active_for(project_id)?;
    let mut live = lock(&active.live);
    live.guarded(|live| Ok(work(live))).ok()
}

pub(in crate::collab) fn comment_live<T>(
    project_id: &str,
    work: impl FnOnce(&mut LiveProject, AccountId) -> Result<T, CollabError>,
) -> Result<T, CollabError> {
    let active = active_for(project_id).ok_or_else(not_live)?;
    let outcome = lock(&active.live).guarded(|live| work(live, active.account_id))?;
    active.save_now();
    active.handle.flush();
    active.refresh_pending();
    Ok(outcome)
}

pub(in crate::collab) fn review_live<T>(
    project_id: &str,
    work: impl FnOnce(&mut LiveProject, AccountId) -> Result<T, CollabError>,
) -> Result<T, CollabError> {
    let active = active_for(project_id).ok_or_else(not_live)?;
    let outcome = lock(&active.live).guarded(|live| work(live, active.account_id))?;
    active.save_now();
    active.handle.flush();
    active.kick();
    active.refresh_pending();
    Ok(outcome)
}

pub(in crate::collab) fn live_root(project_id: &str) -> Option<std::path::PathBuf> {
    active_for(project_id).map(|active| active.root.clone())
}

pub(in crate::collab) fn edit_live<T>(
    project_id: &str,
    work: impl FnOnce(&mut LiveProject) -> Result<T, CollabError>,
) -> Result<T, CollabError> {
    let active = active_for(project_id).ok_or_else(not_live)?;
    let outcome = lock(&active.live).guarded(work)?;
    active.handle.flush();
    active.kick();
    active.refresh_pending();
    Ok(outcome)
}

pub fn doc_close(project_id: &str, file_id: &str, session: u64) {
    if let Some(active) = active_for(project_id) {
        lock(&active.live).close_file(file_id, session);
    }
}

pub fn presence_set(
    project_id: &str,
    path: Option<String>,
    cursor: Option<u32>,
    anchor: Option<u32>,
) {
    if let Some(active) = active_for(project_id) {
        active.handle.presence(PresenceState {
            file_id: path.filter(|path| path.len() <= 256),
            cursor,
            anchor,
        });
    }
}

pub fn presence_leave(project_id: &str) {
    if let Some(active) = active_for(project_id) {
        active.handle.leave_presence();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use oleafly_collab::ot::TextOperation;
    use oleafly_collab_protocol::ids::AccountId;

    use super::*;
    use crate::collab::live::write::rig::LiveRig;
    use crate::collab::live::{
        LiveHost, MergedPayload, NewDevicePayload, PresenceLeftPayload, PresencePayload,
        RolePayload, StatusPayload,
    };
    use crate::collab::suggesting::{SuggestionRefusedPayload, SuggestionsChangedPayload};
    use crate::folder_watch::FolderChange;

    #[derive(Default)]
    struct Heard(
        Mutex<Vec<SuggestionsChangedPayload>>,
        Mutex<Vec<SuggestionRefusedPayload>>,
    );

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
        fn suggestion_refused(&self, payload: SuggestionRefusedPayload) {
            self.1.lock().unwrap().push(payload);
        }
    }

    fn typed(text: &str, at: usize, inserted: &str) -> TextOperation {
        let mut operation = TextOperation::new();
        operation
            .retain(at)
            .insert(inserted)
            .retain(text.encode_utf16().count() - at);
        operation
    }

    #[test]
    fn typing_in_editing_mode_in_a_file_with_suggestions_refreshes_them_here() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("project");
        std::fs::create_dir_all(&root).unwrap();
        let heard = Arc::new(Heard::default());
        let rig = LiveRig::heard_by(
            "editing-refresh",
            &root,
            &[("main.tex", "Hello world\n"), ("plain.tex", "abc\n")],
            Arc::clone(&heard) as Arc<dyn LiveHost>,
        );
        let _live = rig.go_live();
        let (main, _) = rig.open("main.tex");
        {
            let shared = rig.shared_live();
            let mut live = shared.lock().unwrap();
            let operation = typed("Hello world\n", 5, ", dear");
            live.doc_mut()
                .suggest_operation(&main, &operation, AccountId::new_v7(), None, 1)
                .unwrap();
        }
        let (main, rev) = rig.open("main.tex");
        let (plain, plain_rev) = rig.open("plain.tex");
        doc_change("editing-refresh", &plain, plain_rev, typed("abc\n", 0, "x")).unwrap();
        assert!(heard.0.lock().unwrap().is_empty());
        let text = rig.text("main.tex").unwrap();
        doc_change("editing-refresh", &main, rev, typed(&text, 0, "> ")).unwrap();
        let heard = heard.0.lock().unwrap();
        assert_eq!(heard.len(), 1, "{heard:?}");
        assert_eq!(heard[0].paths, vec!["main.tex".to_owned()]);
        assert!(heard[0].local);
    }

    #[test]
    fn a_suggested_deletion_over_the_limit_tells_the_window_why_it_was_put_back() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("project");
        std::fs::create_dir_all(&root).unwrap();
        let heard = Arc::new(Heard::default());
        let long = "x".repeat(oleafly_collab::suggestions::MAX_DELETED_CHARS + 5);
        let rig = LiveRig::heard_by(
            "too-long-refusal",
            &root,
            &[("main.tex", long.as_str())],
            Arc::clone(&heard) as Arc<dyn LiveHost>,
        );
        let _live = rig.go_live();
        rig.set_role(oleafly_collab_protocol::projects::ProjectRole::Reviewer);
        rig.shared_live()
            .lock()
            .unwrap()
            .doc_mut()
            .set_author(&AccountId::new_v7().to_string(), "Rae");
        let (main, rev) = rig.open("main.tex");
        let mut operation = TextOperation::new();
        operation
            .delete(oleafly_collab::suggestions::MAX_DELETED_CHARS + 1)
            .retain(4);
        doc_change("too-long-refusal", &main, rev, operation).unwrap();
        assert_eq!(rig.text("main.tex").unwrap(), long);
        let refused = heard.1.lock().unwrap().clone();
        assert_eq!(
            refused,
            vec![SuggestionRefusedPayload {
                project_id: "too-long-refusal".to_owned(),
                path: "main.tex".to_owned(),
                code: "suggestion_too_long",
            }]
        );
        assert_eq!(
            serde_json::to_value(&refused[0]).unwrap(),
            serde_json::json!({
                "projectId": "too-long-refusal",
                "path": "main.tex",
                "code": "suggestion_too_long",
            })
        );
    }
}
