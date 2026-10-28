use oleafly_collab::doc::NodeKind;
use oleafly_collab::live::{DocSink, LiveProject};
use oleafly_collab::materialize;
use oleafly_collab::ot::TextOperation;
use oleafly_collab::CollabError;
use oleafly_collab_protocol::ids::AccountId;
use oleafly_collab_protocol::projects::PresenceState;

use super::payloads::DocOpened;
use super::session::{active_for, lock, not_live};

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
    let suggested = {
        let mut live = lock(&active.live);
        let suggesting = live.suggesting();
        live.editor_change(file_id, rev, operation)?;
        suggesting.then(|| crate::collab::suggesting::path_of(live.doc(), file_id))
    };
    active.handle.flush();
    active.kick();
    active.refresh_pending();
    if let Some(path) = suggested {
        crate::collab::suggesting::tell(active.host.as_ref(), project_id, path, true);
    }
    Ok(())
}

// The work below runs the document engine on the shared document from a
// desktop thread, so it goes through `guarded`: a panic in it marks the
// project damaged and ends the session as failed, where it would otherwise
// leave the editors writing into a broken document.
pub fn document_snapshot(project_id: &str) -> Option<Result<Vec<u8>, CollabError>> {
    active_for(project_id).map(|active| lock(&active.live).guarded(|live| live.doc().snapshot()))
}

// Nothing when the project isn't live, or when the work broke the document.
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
