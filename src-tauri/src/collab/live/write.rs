use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use oleafly_collab::doc::NodeKind;
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize;
use oleafly_collab::CollabError;
use serde::Serialize;
use tokio::sync::oneshot;

use super::import::Renamed;
use super::{
    active_for, by_path, ensure_dir, guard, lock, merged_onto, name_of, nearest, parent_of, Active,
    WriterSignal, WrittenTexts,
};
use crate::collab::commands::CollabCommandError;
use crate::collab::disk::{crlf_only, lf_text, safe_target, ShareRules};

const WRITE_SETTLE: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WriteOutcome {
    pub handled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

static READS: LazyLock<Mutex<HashMap<String, WrittenTexts>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn normalized(path: &str) -> Option<String> {
    let parts: Vec<&str> = path
        .split('/')
        .filter(|part| !part.is_empty() && *part != ".")
        .collect();
    (!parts.is_empty() && !parts.contains(&"..")).then(|| parts.join("/"))
}

fn closest_base(
    bases: &WrittenTexts,
    reads: Option<&WrittenTexts>,
    path: &str,
    text: &str,
) -> Option<String> {
    let read = reads.into_iter().flat_map(|reads| reads.kept(path));
    nearest(bases.kept(path).chain(read), text).cloned()
}

type Placed = HashMap<String, (String, NodeKind, Option<String>)>;

fn under_a_file(placed: &Placed, path: &str) -> bool {
    let mut ancestor = parent_of(path);
    while let Some(folder) = ancestor {
        if placed
            .get(folder)
            .is_some_and(|(_, kind, _)| *kind != NodeKind::Dir)
        {
            return true;
        }
        ancestor = parent_of(folder);
    }
    false
}

#[cfg(test)]
fn write_into(
    live: &mut LiveProject,
    bases: &mut WrittenTexts,
    reads: Option<&WrittenTexts>,
    root: &Path,
    path: &str,
    base: Option<&str>,
    text: &str,
) -> Result<bool, CollabError> {
    Ok(write_renaming(live, bases, reads, root, path, base, text)?.0)
}

fn write_renaming(
    live: &mut LiveProject,
    bases: &mut WrittenTexts,
    reads: Option<&WrittenTexts>,
    root: &Path,
    path: &str,
    base: Option<&str>,
    text: &str,
) -> Result<(bool, Renamed), CollabError> {
    let refused = (false, Renamed::new());
    let Some(path) = normalized(path) else {
        return Ok(refused);
    };
    let Some(target) = safe_target(root, &path) else {
        return Ok(refused);
    };
    if !live.can_edit() && !live.suggesting() {
        return Ok(refused);
    }
    let mut placed = by_path(&materialize::layout(&live.doc().nodes()?));
    if under_a_file(&placed, &path) {
        return Ok(refused);
    }
    let crlf = crlf_only(text.as_bytes()) == Some(true);
    let text = lf_text(text);
    let base = base.map(lf_text);
    let suggested = live.suggesting();
    if !live.can_edit() && !matches!(placed.get(&path), Some((_, NodeKind::Text, _))) {
        return Ok(refused);
    }
    let added = match placed.get(&path).cloned() {
        Some((id, NodeKind::Text, _)) => {
            let current = live.doc().text(&id)?;
            let chosen = match base {
                Some(base) => Some(base.into_owned()),
                None => closest_base(bases, reads, &path, &text),
            };
            let merged = chosen
                .as_deref()
                .and_then(|base| merged_onto(base, &text, &current));
            match merged {
                Some(operation) if suggested => live.suggested_operation(&id, &operation)?,
                None if suggested => {
                    live.suggested_operation(&id, &oleafly_collab::merge::diff(&current, &text))?
                }
                Some(operation) => live.local_operation(&id, &operation)?,
                None => live.local_text(&id, &text)?,
            };
            None
        }
        Some((_, NodeKind::Dir, _)) => return Ok(refused),
        Some((id, NodeKind::Blob, _)) => {
            live.doc_mut().trash(&id)?;
            let parent = ensure_dir(live, &mut placed, parent_of(&path))?;
            let id = live.doc_mut().add_node(
                parent.as_deref(),
                name_of(&path),
                NodeKind::Text,
                None,
                &text,
            )?;
            live.doc_mut().set_crlf(&id, crlf)?;
            Some(id)
        }
        None => {
            if std::fs::symlink_metadata(&target).is_ok()
                || ShareRules::load(root).leaves_out(&path, false)
            {
                return Ok(refused);
            }
            let parent = ensure_dir(live, &mut placed, parent_of(&path))?;
            let id = live.doc_mut().add_node(
                parent.as_deref(),
                name_of(&path),
                NodeKind::Text,
                None,
                &text,
            )?;
            live.doc_mut().set_crlf(&id, crlf)?;
            Some(id)
        }
    };
    let laid = match added {
        Some(id) => materialize::layout(&live.doc().nodes()?)
            .remove(&id)
            .map(|placed| placed.path)
            .filter(|laid| *laid != path),
        None => None,
    };
    bases.record(laid.as_deref().unwrap_or(&path), &text);
    Ok((
        true,
        laid.map(|laid| vec![(path, laid)]).unwrap_or_default(),
    ))
}

const READ_ONLY: &str = "read_only";

fn kept_from_a_viewer(live: &LiveProject, root: &Path, path: &str) -> Result<bool, CollabError> {
    if live.can_edit() {
        return Ok(false);
    }
    let Some(path) = normalized(path) else {
        return Ok(false);
    };
    let Some(target) = safe_target(root, &path) else {
        return Ok(false);
    };
    let placed = by_path(&materialize::layout(&live.doc().nodes()?));
    if under_a_file(&placed, &path) {
        return Ok(false);
    }
    Ok(match placed.get(&path) {
        Some((_, NodeKind::Dir, _)) => false,
        Some((_, NodeKind::Text, _)) => !live.suggesting(),
        Some(_) => true,
        None => {
            std::fs::symlink_metadata(target).is_err()
                && !ShareRules::load(root).leaves_out(&path, false)
        }
    })
}

impl Active {
    async fn write_text(
        &self,
        path: &str,
        base: Option<&str>,
        text: &str,
    ) -> Result<WriteOutcome, CollabError> {
        let (handled, renamed, suggested) = {
            let reads = guard(&READS);
            let mut live = lock(&self.live);
            if kept_from_a_viewer(&live, &self.root, path)? {
                return Ok(WriteOutcome {
                    handled: false,
                    reason: Some(READ_ONLY.to_owned()),
                });
            }
            let mut bases = guard(&self.bases);
            let (handled, renamed) = write_renaming(
                &mut live,
                &mut bases,
                reads.get(&self.project_id),
                &self.root,
                path,
                base,
                text,
            )?;
            let suggested = (handled && live.suggesting())
                .then(|| normalized(path))
                .flatten();
            (handled, renamed, suggested)
        };
        if !handled {
            return Ok(WriteOutcome {
                handled: false,
                reason: None,
            });
        }
        if let Some(path) = suggested {
            crate::collab::suggesting::tell(self.host.as_ref(), &self.project_id, Some(path), true);
        }
        self.handle.flush();
        self.refresh_pending();
        let (done, wait) = oneshot::channel();
        let _ = self.writer.send(WriterSignal::Flush(done));
        let _ = tokio::time::timeout(WRITE_SETTLE, wait).await;
        self.announce_new_names(renamed);
        Ok(WriteOutcome {
            handled: true,
            reason: None,
        })
    }
}

fn remember_read(project_id: &str, path: &str, text: &str) {
    let Some(path) = normalized(path) else {
        return;
    };
    let mut reads = guard(&READS);
    reads.retain(|known, _| known == project_id);
    reads
        .entry(project_id.to_owned())
        .or_default()
        .record(&path, &lf_text(text));
}

pub fn note_read(project_id: &str, path: &str, text: &str) {
    if active_for(project_id).is_some() {
        remember_read(project_id, path, text);
    }
}

pub async fn write_text(
    project_id: &str,
    path: &str,
    base: Option<&str>,
    text: &str,
) -> Result<WriteOutcome, CollabError> {
    let Some(active) = active_for(project_id) else {
        return Ok(WriteOutcome {
            handled: false,
            reason: None,
        });
    };
    let outcome = active.write_text(path, base, text).await?;
    if outcome.handled {
        crate::agent_turns::note_app_write(project_id, path);
    }
    Ok(outcome)
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct SharedText<'a> {
    pub(crate) path: &'a str,
    pub(crate) before: Option<&'a str>,
    pub(crate) text: &'a str,
}

pub(crate) struct SharedDocument(Arc<Active>);

fn write_shared(
    live: &mut LiveProject,
    bases: &mut WrittenTexts,
    root: &Path,
    shared: &SharedText<'_>,
) -> Result<(bool, Renamed), CollabError> {
    let Some(path) = normalized(shared.path) else {
        return Ok((false, Renamed::new()));
    };
    let placed = by_path(&materialize::layout(&live.doc().nodes()?));
    let starts_as_reviewed = match (placed.get(&path), shared.before) {
        (Some((_, NodeKind::Text, _)), Some(_)) => true,
        (None, None) => safe_target(root, &path)
            .is_some_and(|target| std::fs::symlink_metadata(target).is_err()),
        _ => false,
    };
    if !starts_as_reviewed {
        return Ok((false, Renamed::new()));
    }
    write_renaming(live, bases, None, root, &path, shared.before, shared.text)
}

fn undo_shared(
    live: &mut LiveProject,
    existing: &BTreeSet<String>,
    written: &[SharedText<'_>],
) -> Result<(), CollabError> {
    for shared in written.iter().rev() {
        let (Some(before), Some(path)) = (shared.before, normalized(shared.path)) else {
            continue;
        };
        let placed = by_path(&materialize::layout(&live.doc().nodes()?));
        let Some((id, NodeKind::Text, _)) = placed.get(&path).cloned() else {
            continue;
        };
        let current = live.doc().text(&id)?;
        let before = lf_text(before);
        match merged_onto(&lf_text(shared.text), &before, &current) {
            Some(operation) => live.local_operation(&id, &operation)?,
            None => live.local_text(&id, &before)?,
        };
    }
    let layout = materialize::layout(&live.doc().nodes()?);
    let created: BTreeSet<&str> = layout
        .iter()
        .filter(|(id, _)| !existing.contains(*id))
        .map(|(_, placed)| placed.path.as_str())
        .collect();
    for (id, placed) in &layout {
        let topmost = parent_of(&placed.path).is_none_or(|parent| !created.contains(parent));
        if !existing.contains(id) && topmost {
            live.doc_mut().trash(id)?;
        }
    }
    Ok(())
}

fn write_all_shared(
    live: &mut LiveProject,
    bases: &mut WrittenTexts,
    root: &Path,
    texts: &[SharedText<'_>],
) -> Result<Result<Renamed, String>, CollabError> {
    let existing: BTreeSet<String> = materialize::layout(&live.doc().nodes()?)
        .into_keys()
        .collect();
    let mut written = Vec::new();
    let mut renamed = Renamed::new();
    for shared in texts {
        match write_shared(live, bases, root, shared) {
            Ok((true, laid)) => {
                written.push(*shared);
                renamed.extend(laid);
            }
            Ok((false, _)) => {
                undo_shared(live, &existing, &written)?;
                return Ok(Err(shared.path.to_owned()));
            }
            Err(error) => {
                let _ = undo_shared(live, &existing, &written);
                return Err(error);
            }
        }
    }
    Ok(Ok(renamed))
}

impl SharedDocument {
    pub(crate) fn of(project_id: &str) -> Option<SharedDocument> {
        active_for(project_id)
            .map(SharedDocument)
            .filter(SharedDocument::can_edit)
    }

    pub(crate) fn can_edit(&self) -> bool {
        lock(&self.0.live).can_edit()
    }

    pub(crate) fn holds(&self, path: &str, new_file: bool) -> bool {
        let Some(path) = normalized(path) else {
            return false;
        };
        if safe_target(&self.0.root, &path).is_none() {
            return false;
        }
        let live = lock(&self.0.live);
        let Ok(nodes) = live.doc().nodes() else {
            return false;
        };
        let placed = by_path(&materialize::layout(&nodes));
        if under_a_file(&placed, &path) {
            return false;
        }
        match placed.get(&path) {
            Some((_, NodeKind::Text, _)) => true,
            Some(_) => false,
            None => new_file,
        }
    }

    pub(crate) fn write(&self, texts: &[SharedText<'_>]) -> Result<Option<String>, CollabError> {
        let written = {
            let mut live = lock(&self.0.live);
            let mut bases = guard(&self.0.bases);
            write_all_shared(&mut live, &mut bases, &self.0.root, texts)?
        };
        self.0.handle.flush();
        self.0.refresh_pending();
        let renamed = match written {
            Ok(renamed) => renamed,
            Err(refused) => return Ok(Some(refused)),
        };
        for shared in texts {
            crate::agent_turns::note_app_write(&self.0.project_id, shared.path);
        }
        let (done, wait) = oneshot::channel();
        let _ = self.0.writer.send(WriterSignal::Flush(done));
        tauri::async_runtime::block_on(async move {
            let _ = tokio::time::timeout(WRITE_SETTLE, wait).await;
        });
        self.0.announce_new_names(renamed);
        Ok(None)
    }

    pub(crate) fn wrote_on_disk(&self, path: &str) {
        let target = self.0.root.join(path);
        if std::fs::symlink_metadata(&target).is_ok() {
            crate::folder_watch::note_own_write(&target);
        } else {
            crate::folder_watch::note_own_removal(&target);
        }
    }

    pub(crate) fn import_now(&self, paths: Vec<String>) {
        if paths.is_empty() {
            return;
        }
        let active = Arc::clone(&self.0);
        tauri::async_runtime::spawn(async move {
            let _ = active.import_paths(Some(paths)).await;
        });
    }
}

#[cfg(test)]
#[path = "write_rig.rs"]
pub(crate) mod rig;

#[tauri::command]
pub async fn collab_write_text(
    project_id: String,
    path: String,
    base: Option<String>,
    text: String,
) -> Result<WriteOutcome, CollabCommandError> {
    write_text(&project_id, &path, base.as_deref(), &text)
        .await
        .map_err(CollabCommandError::from)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use oleafly_collab::doc::{NodeKind, ProjectDoc};
    use oleafly_collab::editor::DocMessage;
    use oleafly_collab::live::{DocSink, OpenedFile};
    use oleafly_collab::materialize;
    use oleafly_collab::ot::TextOperation;
    use oleafly_collab::sync::{spawn_live, LiveLink, LiveStatus, SharedLive};
    use oleafly_collab::{ServerClient, ServerUrl};
    use oleafly_collab_protocol::ids::{AccountId, DeviceId};
    use oleafly_collab_protocol::projects::ProjectRole;
    use tokio::sync::mpsc;

    use super::super::{writer_loop, LiveHost};
    use super::*;
    use crate::collab::disk::{sha256_hex, DiskState};
    use crate::collab::state::CollabState;
    use crate::folder_watch::FolderChange;

    fn shared(text: &str) -> (LiveProject, String) {
        let mut doc = ProjectDoc::create().unwrap();
        let main = doc
            .add_node(None, "main.tex", NodeKind::Text, None, text)
            .unwrap();
        (LiveProject::new(doc, 0, ProjectRole::Owner), main)
    }

    fn recorder() -> (DocSink, Arc<Mutex<Vec<DocMessage>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let copy = Arc::clone(&seen);
        let sink: DocSink = Arc::new(move |message| copy.lock().unwrap().push(message));
        (sink, seen)
    }

    fn typed(text: &str, at_end: &str) -> TextOperation {
        let mut operation = TextOperation::new();
        operation.retain(text.encode_utf16().count()).insert(at_end);
        operation
    }

    fn paths_of(live: &LiveProject) -> Vec<String> {
        let mut paths: Vec<String> = materialize::layout(&live.doc().nodes().unwrap())
            .values()
            .map(|placed| placed.path.clone())
            .collect();
        paths.sort();
        paths
    }

    #[test]
    fn a_write_from_a_stale_base_keeps_newer_text_outside_the_lines_it_changed() {
        let dir = tempfile::tempdir().unwrap();
        let (mut live, main) = shared("one\ntwo\nthree\n");
        let read = live.doc().text(&main).unwrap();
        live.local_text(&main, "one\ntwo\nthree\nfour from a collaborator\n")
            .unwrap();
        let handled = write_into(
            &mut live,
            &mut WrittenTexts::default(),
            None,
            dir.path(),
            "main.tex",
            Some(&read),
            "ONE\ntwo\nthree\n",
        )
        .unwrap();
        assert!(handled);
        assert_eq!(
            live.doc().text(&main).unwrap(),
            "ONE\ntwo\nthree\nfour from a collaborator\n"
        );
    }

    #[test]
    fn a_reviewers_write_from_a_stale_base_suggests_only_its_own_change() {
        let dir = tempfile::tempdir().unwrap();
        let read = "one\ntwo\nthree\nfour\n";
        let (mut live, main) = shared(read);
        live.local_text(&main, "one\ntwo\nthree\nnew paragraph\nfour\n")
            .unwrap();
        live.set_role(ProjectRole::Reviewer);
        live.doc_mut()
            .set_author(&AccountId::new_v7().to_string(), "Rae");
        assert!(write_into(
            &mut live,
            &mut WrittenTexts::default(),
            None,
            dir.path(),
            "main.tex",
            Some(read),
            "ONE\ntwo\nthree\nfour\n",
        )
        .unwrap());
        assert_eq!(
            live.doc().text(&main).unwrap(),
            "ONE\ntwo\nthree\nnew paragraph\nfour\n"
        );
        let suggested: Vec<String> = live
            .doc()
            .suggestions(&main)
            .unwrap()
            .into_iter()
            .map(|found| found.text)
            .collect();
        assert!(
            suggested.iter().all(|text| !text.contains("two")),
            "{suggested:?}"
        );
        live.doc_mut().reject_file_suggestions(&main).unwrap();
        assert_eq!(
            live.doc().text(&main).unwrap(),
            "one\ntwo\nthree\nnew paragraph\nfour\n"
        );
    }

    #[test]
    fn a_write_without_a_base_merges_from_the_closest_text_this_app_wrote() {
        let dir = tempfile::tempdir().unwrap();
        let (mut live, main) = shared("one\ntwo\nthree\n");
        let mut bases = WrittenTexts::default();
        bases.record("main.tex", "something else entirely\n");
        bases.record("main.tex", "one\ntwo\nthree\n");
        live.local_text(&main, "one\ntwo\nthree\nfour from a collaborator\n")
            .unwrap();
        bases.record("main.tex", "one\ntwo\nthree\nfour from a collaborator\n");
        assert!(write_into(
            &mut live,
            &mut bases,
            None,
            dir.path(),
            "main.tex",
            None,
            "ONE\ntwo\nthree\n",
        )
        .unwrap());
        assert_eq!(
            live.doc().text(&main).unwrap(),
            "ONE\ntwo\nthree\nfour from a collaborator\n"
        );
        assert_eq!(
            bases.latest("main.tex").map(String::as_str),
            Some("ONE\ntwo\nthree\n")
        );
    }

    #[test]
    fn an_ai_write_the_document_already_holds_is_not_applied_twice() {
        let dir = tempfile::tempdir().unwrap();
        let read = "intro\nold line\noutro\n";
        let rewritten = "intro\nAI REWRITE of the line\noutro\n";
        let (mut live, main) = shared(read);
        live.local_text(&main, "intro\nAI REWRITE of the line\noutro\ntyped later\n")
            .unwrap();
        assert!(write_into(
            &mut live,
            &mut WrittenTexts::default(),
            None,
            dir.path(),
            "main.tex",
            Some(read),
            rewritten,
        )
        .unwrap());
        assert_eq!(
            live.doc().text(&main).unwrap(),
            "intro\nAI REWRITE of the line\noutro\ntyped later\n"
        );
    }

    #[test]
    fn an_open_editor_gets_the_write_as_a_remote_change() {
        let dir = tempfile::tempdir().unwrap();
        let (mut live, main) = shared("abc\n");
        let (sink, seen) = recorder();
        let opened = live.open_file(&main, sink).unwrap();
        let rev = opened.rev;
        assert!(write_into(
            &mut live,
            &mut WrittenTexts::default(),
            None,
            dir.path(),
            "main.tex",
            Some("abc\n"),
            "abcd\n",
        )
        .unwrap());
        let messages = seen.lock().unwrap().clone();
        assert_eq!(messages.len(), 1, "{messages:?}");
        match &messages[0] {
            DocMessage::Remote { rev: next, op, .. } => {
                assert_eq!(*next, rev + 1);
                assert_eq!(op.apply(&opened.text).unwrap(), "abcd\n");
            }
            other => panic!("expected a remote change, got {other:?}"),
        }
    }

    #[test]
    fn a_crlf_write_reaches_the_document_and_the_open_editor_as_lf() {
        let dir = tempfile::tempdir().unwrap();
        let (mut live, main) = shared("a\n");
        let (sink, seen) = recorder();
        let opened = live.open_file(&main, sink).unwrap();
        assert!(write_into(
            &mut live,
            &mut WrittenTexts::default(),
            None,
            dir.path(),
            "main.tex",
            Some("a\r\n"),
            "a\r\nb\r\n",
        )
        .unwrap());
        assert_eq!(live.doc().text(&main).unwrap(), "a\nb\n");
        let messages = seen.lock().unwrap().clone();
        match &messages[..] {
            [DocMessage::Remote { op, .. }] => {
                assert_eq!(op.apply(&opened.text).unwrap(), "a\nb\n");
            }
            other => panic!("expected one remote change, got {other:?}"),
        }
        assert!(write_into(
            &mut live,
            &mut WrittenTexts::default(),
            None,
            dir.path(),
            "main.tex",
            None,
            "a\rb\r\nc\n",
        )
        .unwrap());
        assert_eq!(live.doc().text(&main).unwrap(), "a\nb\nc\n");
    }

    #[test]
    fn a_new_crlf_file_is_lf_in_the_document_and_remembered_as_crlf() {
        let dir = tempfile::tempdir().unwrap();
        let (mut live, _) = shared("abc\n");
        for (path, text) in [
            ("windows.tex", "one\r\ntwo\r\n"),
            ("unix.tex", "one\ntwo\n"),
        ] {
            assert!(write_into(
                &mut live,
                &mut WrittenTexts::default(),
                None,
                dir.path(),
                path,
                None,
                text,
            )
            .unwrap());
        }
        let layout = materialize::layout(&live.doc().nodes().unwrap());
        let id_of = |path: &str| {
            layout
                .iter()
                .find(|(_, placed)| placed.path == path)
                .unwrap()
                .0
                .clone()
        };
        let (windows, unix) = (id_of("windows.tex"), id_of("unix.tex"));
        assert_eq!(live.doc().text(&windows).unwrap(), "one\ntwo\n");
        assert!(live.doc().crlf(&windows));
        assert_eq!(live.doc().text(&unix).unwrap(), "one\ntwo\n");
        assert!(!live.doc().crlf(&unix));
    }

    #[test]
    fn an_ai_full_file_write_during_live_typing_never_erases_newer_keystrokes() {
        let dir = tempfile::tempdir().unwrap();
        let read = "alpha\nbeta\ngamma\n";
        let (mut live, main) = shared(read);
        let (sink, _seen) = recorder();
        let OpenedFile { mut rev, .. } = live.open_file(&main, sink).unwrap();
        let mut bases = WrittenTexts::default();
        bases.record("main.tex", read);
        let mut reads = WrittenTexts::default();
        reads.record("main.tex", read);
        for key in ["d", "e", "l", "t", "a"] {
            let current = live.doc().text(&main).unwrap();
            live.editor_change(&main, rev, typed(&current, key))
                .unwrap();
            rev += 1;
            bases.record("main.tex", &live.doc().text(&main).unwrap());
        }
        let stale = "ALPHA\nbeta\ngamma\n";
        let (mut with_base, with_base_main) = shared(&live.doc().text(&main).unwrap());
        assert!(write_into(
            &mut with_base,
            &mut WrittenTexts::default(),
            None,
            dir.path(),
            "main.tex",
            Some(read),
            stale,
        )
        .unwrap());
        assert_eq!(
            with_base.doc().text(&with_base_main).unwrap(),
            "ALPHA\nbeta\ngamma\ndelta"
        );
        assert!(write_into(
            &mut live,
            &mut bases,
            Some(&reads),
            dir.path(),
            "main.tex",
            None,
            stale,
        )
        .unwrap());
        assert_eq!(live.doc().text(&main).unwrap(), "ALPHA\nbeta\ngamma\ndelta");
    }

    #[test]
    fn a_new_path_becomes_a_file_node_with_its_folders() {
        let dir = tempfile::tempdir().unwrap();
        let (mut live, _) = shared("abc\n");
        assert!(write_into(
            &mut live,
            &mut WrittenTexts::default(),
            None,
            dir.path(),
            "./chapters/intro.tex",
            None,
            "Intro\n",
        )
        .unwrap());
        assert_eq!(
            paths_of(&live),
            vec!["chapters", "chapters/intro.tex", "main.tex"]
        );
        let layout = materialize::layout(&live.doc().nodes().unwrap());
        let (id, _) = layout
            .iter()
            .find(|(_, placed)| placed.path == "chapters/intro.tex")
            .unwrap();
        assert_eq!(live.doc().text(id).unwrap(), "Intro\n");
    }

    #[test]
    fn writes_the_shared_document_cannot_take_are_left_to_the_disk() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("notes.tex"), "outside").unwrap();
        std::fs::write(dir.path().join(".gitignore"), "*.aux\nbuild/\n").unwrap();
        let (mut live, main) = shared("abc\n");
        for path in [
            "../escape.tex",
            "project.json",
            ".git/config",
            "notes.tex",
            "",
            "main.aux",
            "build/out.tex",
            ".main.tex.swp",
            "draft.tex~",
        ] {
            assert!(
                !write_into(
                    &mut live,
                    &mut WrittenTexts::default(),
                    None,
                    dir.path(),
                    path,
                    None,
                    "x",
                )
                .unwrap(),
                "{path} was taken"
            );
        }
        live.set_role(ProjectRole::Viewer);
        assert!(!write_into(
            &mut live,
            &mut WrittenTexts::default(),
            None,
            dir.path(),
            "main.tex",
            None,
            "viewer text",
        )
        .unwrap());
        assert_eq!(live.doc().text(&main).unwrap(), "abc\n");
        assert_eq!(paths_of(&live), vec!["main.tex"]);
    }

    #[test]
    fn a_viewer_is_told_a_write_to_the_shared_tree_is_read_only() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("outside.tex"), "local").unwrap();
        let (mut live, _) = shared("abc\n");
        live.doc_mut()
            .add_node(None, "chapters", NodeKind::Dir, None, "")
            .unwrap();
        assert!(!kept_from_a_viewer(&live, dir.path(), "main.tex").unwrap());
        live.set_role(ProjectRole::Viewer);
        for path in ["main.tex", "./main.tex", "new.tex", "chapters/new.tex"] {
            assert!(
                kept_from_a_viewer(&live, dir.path(), path).unwrap(),
                "{path}"
            );
        }
        std::fs::write(dir.path().join(".gitignore"), "*.aux\nbuild/\n").unwrap();
        for path in [
            "project.json",
            ".git/config",
            "../escape.tex",
            "chapters",
            "main.tex/inner.tex",
            "outside.tex",
            "main.aux",
            "build/out.tex",
            "chapters/.new.tex.swp",
        ] {
            assert!(
                !kept_from_a_viewer(&live, dir.path(), path).unwrap(),
                "{path}"
            );
        }
    }

    #[test]
    fn a_binary_file_written_as_text_becomes_a_text_file() {
        let dir = tempfile::tempdir().unwrap();
        let (mut live, _) = shared("abc\n");
        live.doc_mut()
            .add_node(None, "figure.svg", NodeKind::Blob, Some("0123"), "")
            .unwrap();
        assert!(write_into(
            &mut live,
            &mut WrittenTexts::default(),
            None,
            dir.path(),
            "figure.svg",
            None,
            "<svg/>",
        )
        .unwrap());
        let layout = materialize::layout(&live.doc().nodes().unwrap());
        let placed: Vec<_> = layout
            .iter()
            .filter(|(_, placed)| placed.path == "figure.svg")
            .collect();
        assert_eq!(placed.len(), 1);
        assert_eq!(placed[0].1.kind, NodeKind::Text);
        assert_eq!(live.doc().text(placed[0].0).unwrap(), "<svg/>");
    }

    #[test]
    fn a_path_inside_a_file_is_left_to_the_disk() {
        let dir = tempfile::tempdir().unwrap();
        let (mut live, _) = shared("abc\n");
        assert!(!write_into(
            &mut live,
            &mut WrittenTexts::default(),
            None,
            dir.path(),
            "main.tex/inner.tex",
            None,
            "x",
        )
        .unwrap());
        assert_eq!(paths_of(&live), vec!["main.tex"]);
    }

    #[test]
    fn reads_of_a_project_that_is_not_live_are_not_kept() {
        note_read("a-project-that-is-not-live-either", "main.tex", "x");
        assert!(!guard(&READS).contains_key("a-project-that-is-not-live-either"));
    }

    #[test]
    fn a_project_that_is_not_live_is_left_to_the_disk() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let outcome = runtime
            .block_on(write_text(
                "a-project-that-is-not-live",
                "main.tex",
                None,
                "x",
            ))
            .unwrap();
        assert_eq!(
            outcome,
            WriteOutcome {
                handled: false,
                reason: None,
            }
        );
        assert_eq!(
            serde_json::to_value(&outcome).unwrap(),
            serde_json::json!({ "handled": false })
        );
    }

    #[test]
    fn a_refused_write_carries_its_reason_on_the_wire() {
        let refused = WriteOutcome {
            handled: false,
            reason: Some("read_only".to_owned()),
        };
        assert_eq!(
            serde_json::to_value(&refused).unwrap(),
            serde_json::json!({ "handled": false, "reason": "read_only" })
        );
    }

    struct QuietHost;

    impl LiveHost for QuietHost {
        fn status(&self, _: super::super::StatusPayload) {}
        fn role(&self, _: super::super::RolePayload) {}
        fn merged(&self, _: super::super::MergedPayload) {}
        fn presence(&self, _: super::super::PresencePayload) {}
        fn presence_left(&self, _: super::super::PresenceLeftPayload) {}
        fn folder_changed(&self, _: FolderChange) {}
        fn new_device(&self, _: super::super::NewDevicePayload) {}
    }

    #[test]
    fn a_live_write_reaches_disk_through_the_materializer_before_it_answers() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let state = CollabState::new(
                oleafly_collab::CollabPaths::new(dir.path().join("collab")),
                Arc::new(oleafly_collab::secret_port::MemorySecrets::default()),
            );
            let keys = state.keys().await.unwrap();
            let link = LiveLink {
                client: Arc::new(
                    ServerClient::new(ServerUrl::parse("http://127.0.0.1:9").unwrap()).unwrap(),
                ),
                server_id: oleafly_collab_protocol::ids::ServerId::new_v7(),
                project: oleafly_collab_protocol::ids::SharedProjectId::new_v7(),
                device_id: DeviceId::new_v7(),
                key: Arc::clone(&keys.key),
                sessions: Arc::clone(&keys.sessions),
            };
            let root = dir.path().join("project");
            std::fs::create_dir_all(&root).unwrap();
            std::fs::write(root.join("main.tex"), "alpha\nbeta\n").unwrap();
            let (live, main) = shared("alpha\nbeta\n");
            let layout = materialize::layout(&live.doc().nodes().unwrap());
            let disk = DiskState {
                layout,
                hashes: [("main.tex".to_owned(), sha256_hex(b"alpha\nbeta\n"))]
                    .into_iter()
                    .collect(),
                owed: Default::default(),
            };
            let shared_live: SharedLive = Arc::new(Mutex::new(live));
            let (events, _events) = mpsc::unbounded_channel();
            let (writer, writer_rx) = mpsc::unbounded_channel();
            let handle = spawn_live(link.clone(), Arc::clone(&shared_live), events);
            let mut bases = WrittenTexts::default();
            bases.record("main.tex", "alpha\nbeta\n");
            let active = Arc::new(Active {
                project_id: "written-live".to_owned(),
                root: root.clone(),
                document_dir: dir.path().join("document"),
                disk_file: dir.path().join("disk.json"),
                live: Arc::clone(&shared_live),
                handle,
                link,
                disk: Mutex::new(disk),
                host: Arc::new(QuietHost),
                writer,
                account_id: AccountId::new_v7(),
                quiet_merge: AtomicBool::new(false),
                waiting: AtomicBool::new(false),
                last_status: Mutex::new(LiveStatus::Connecting),
                bases: Mutex::new(bases),
                upkeep: Default::default(),
            });
            tokio::spawn(writer_loop(Arc::downgrade(&active), writer_rx));
            let created = tokio::time::timeout(
                Duration::from_secs(10),
                active.write_text("figures/plot.tex", None, "\\draw;\n"),
            )
            .await
            .expect("the write never answered")
            .unwrap();
            assert!(created.handled);
            assert_eq!(
                std::fs::read_to_string(root.join("figures/plot.tex")).unwrap(),
                "\\draw;\n"
            );
            shared_live
                .lock()
                .unwrap()
                .local_text(&main, "alpha\nbeta\ngamma\n")
                .unwrap();
            {
                let mut bases = active.bases.lock().unwrap();
                for typed in ["g", "ga", "gam", "gamm"] {
                    bases.record("main.tex", &format!("alpha\nbeta\n{typed}"));
                }
            }
            remember_read("written-live", "main.tex", "alpha\nbeta\n");
            assert!(
                active
                    .write_text("main.tex", None, "ALPHA\nbeta\n")
                    .await
                    .unwrap()
                    .handled
            );
            assert_eq!(
                shared_live.lock().unwrap().doc().text(&main).unwrap(),
                "ALPHA\nbeta\ngamma\n"
            );
            assert_eq!(
                std::fs::read_to_string(root.join("main.tex")).unwrap(),
                "ALPHA\nbeta\ngamma\n"
            );
            active.handle.stop();
        });
    }
}
