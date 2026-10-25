use std::collections::{BTreeSet, HashMap};

use oleafly_collab::doc::{encode_version, NodeKind, ProjectDoc};
use oleafly_collab::history::HistoryPage;
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize;
use oleafly_collab::review::changed_files;
use oleafly_collab::{load_binding, CollabError};
use oleafly_collab_protocol::ids::{AccountId, VersionId};
use oleafly_collab_protocol::projects::{project_role_allows, ProjectAction, ProjectRole};
use serde::Serialize;

use super::commands::{now_ms, CollabCommandError};
use super::state::CollabState;
use super::suggesting::refused;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAtVersion {
    pub path: String,
    pub text: Option<String>,
    pub existed: bool,
}

fn not_allowed() -> CollabError {
    refused(
        403,
        "forbidden",
        "only owners and editors can change the project's history",
    )
}

fn io(error: impl std::fmt::Display) -> CollabError {
    CollabError::Io(error.to_string())
}

struct Copied {
    snapshot: Vec<u8>,
    authors: oleafly_collab::comments::Authorship,
    author: Option<(String, String)>,
}

fn copied(live: &LiveProject) -> Result<Copied, CollabError> {
    let doc = live.doc();
    Ok(Copied {
        snapshot: doc.snapshot()?,
        authors: doc.authorship().clone(),
        author: doc.author_key().map(|account| {
            (
                account.to_owned(),
                doc.author_name().unwrap_or_default().to_owned(),
            )
        }),
    })
}

async fn with_copy<T: Send + 'static>(
    state: &CollabState,
    project_id: &str,
    work: impl FnOnce(&ProjectDoc) -> Result<T, CollabError> + Send + 'static,
) -> Result<T, CollabError> {
    if let Some(copy) = super::live::read_live(project_id, copied) {
        let copy = copy?;
        return tokio::task::spawn_blocking(move || {
            let mut doc = ProjectDoc::load_contained(&copy.snapshot)?;
            doc.set_authorship(copy.authors);
            if let Some((account, name)) = copy.author {
                doc.set_author(&account, &name);
            }
            work(&doc)
        })
        .await
        .map_err(io)?;
    }
    let paths = state.paths()?;
    load_binding(paths, project_id)?
        .ok_or_else(|| refused(404, "not_found", "this project is not shared"))?;
    let dir = paths.document_dir(project_id)?;
    tokio::task::spawn_blocking(move || {
        let saved = LiveProject::load(&dir, ProjectRole::Viewer)?;
        work(saved.doc())
    })
    .await
    .map_err(io)?
}

fn names_of(doc: &ProjectDoc) -> HashMap<String, String> {
    let nodes = doc.nodes().unwrap_or_default();
    let mut names: HashMap<String, String> = nodes
        .iter()
        .map(|node| (node.id.clone(), node.name.clone()))
        .collect();
    for (id, placed) in materialize::layout(&nodes) {
        names.insert(id, placed.path);
    }
    names
}

pub(crate) fn page_with_paths(doc: &ProjectDoc, mut page: HistoryPage) -> HistoryPage {
    let names = names_of(doc);
    for entry in &mut page.entries {
        let mut paths: Vec<String> = entry
            .files
            .iter()
            .filter_map(|file| names.get(file).cloned())
            .collect();
        paths.sort();
        paths.dedup();
        entry.files = paths;
    }
    page
}

pub(crate) fn file_at_version(
    doc: &ProjectDoc,
    version: &str,
    path: &str,
) -> Result<FileAtVersion, CollabError> {
    let old = doc.at_history(version)?;
    let layout = materialize::layout(&old.nodes()?);
    let found = layout.into_iter().find(|(_, placed)| placed.path == path);
    Ok(match found {
        Some((id, placed)) if placed.kind == NodeKind::Text => FileAtVersion {
            path: path.to_owned(),
            text: Some(old.text(&id)?),
            existed: true,
        },
        Some(_) => FileAtVersion {
            path: path.to_owned(),
            text: None,
            existed: true,
        },
        None => FileAtVersion {
            path: path.to_owned(),
            text: None,
            existed: false,
        },
    })
}

pub(crate) fn files_changed_between(
    doc: &ProjectDoc,
    from: &str,
    to: &str,
) -> Result<Vec<String>, CollabError> {
    let before = encode_version(&doc.version_of(from)?);
    let after = encode_version(&doc.version_of(to)?);
    Ok(changed_files(doc, &before, &after)?
        .into_iter()
        .map(|file| file.path)
        .collect())
}

pub(crate) fn ids_for(
    doc: &ProjectDoc,
    version: &str,
    paths: &[String],
) -> Result<BTreeSet<String>, CollabError> {
    let old = doc.at_history(version)?;
    let then = materialize::layout(&old.nodes()?);
    let now = materialize::layout(&doc.nodes()?);
    Ok(paths
        .iter()
        .filter_map(|path| {
            then.iter()
                .chain(now.iter())
                .find(|(_, placed)| placed.path == *path)
                .map(|(id, _)| id.clone())
        })
        .collect())
}

pub(crate) fn restore_in(
    live: &mut LiveProject,
    version: &str,
    files: Option<&BTreeSet<String>>,
) -> Result<Vec<String>, CollabError> {
    if !project_role_allows(live.role(), ProjectAction::Edit) {
        return Err(not_allowed());
    }
    live.restore_version(version, files)
}

pub(crate) fn name_in(
    live: &mut LiveProject,
    who: AccountId,
    version: &str,
    name: &str,
    now: i64,
) -> Result<VersionId, CollabError> {
    if !project_role_allows(live.role(), ProjectAction::Edit) {
        return Err(not_allowed());
    }
    live.comment_doc().name_version(version, name, who, now)
}

pub(crate) fn unname_in(live: &mut LiveProject, version: &str) -> Result<bool, CollabError> {
    if !project_role_allows(live.role(), ProjectAction::Edit) {
        return Err(not_allowed());
    }
    live.comment_doc().unname_version(version)
}

#[tauri::command]
pub async fn collab_history_list(
    state: tauri::State<'_, CollabState>,
    project_id: String,
    before: Option<String>,
    limit: usize,
) -> Result<HistoryPage, CollabCommandError> {
    with_copy(state.inner(), &project_id, move |doc| {
        let page = doc.history(before.as_deref(), limit);
        Ok(page_with_paths(doc, page))
    })
    .await
    .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_history_file(
    state: tauri::State<'_, CollabState>,
    project_id: String,
    version_id: String,
    path: String,
) -> Result<FileAtVersion, CollabCommandError> {
    with_copy(state.inner(), &project_id, move |doc| {
        file_at_version(doc, &version_id, &path)
    })
    .await
    .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_history_changed_files(
    state: tauri::State<'_, CollabState>,
    project_id: String,
    from_version: String,
    to_version: String,
) -> Result<Vec<String>, CollabCommandError> {
    with_copy(state.inner(), &project_id, move |doc| {
        files_changed_between(doc, &from_version, &to_version)
    })
    .await
    .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_history_restore(
    state: tauri::State<'_, CollabState>,
    project_id: String,
    version_id: String,
    paths: Option<Vec<String>>,
) -> Result<(), CollabCommandError> {
    let files = match paths {
        Some(paths) => {
            let version = version_id.clone();
            let ids = with_copy(state.inner(), &project_id, move |doc| {
                ids_for(doc, &version, &paths)
            })
            .await
            .map_err(CollabCommandError::from)?;
            Some(ids)
        }
        None => None,
    };
    super::live::review_live(&project_id, |live, _| {
        restore_in(live, &version_id, files.as_ref())
    })
    .map(|_| ())
    .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_version_name(
    project_id: String,
    version_id: String,
    name: String,
) -> Result<(), CollabCommandError> {
    super::live::comment_live(&project_id, |live, who| {
        name_in(live, who, &version_id, &name, now_ms())
    })
    .map(|_| ())
    .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_version_unname(
    project_id: String,
    version_id: String,
) -> Result<(), CollabCommandError> {
    super::live::comment_live(&project_id, |live, _| unname_in(live, &version_id))
        .map(|_| ())
        .map_err(CollabCommandError::from)
}

#[cfg(test)]
mod tests {
    use oleafly_collab::doc::ProjectDoc;

    use super::*;

    fn code(error: CollabError) -> String {
        match error {
            CollabError::Api { code, .. } => code,
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    fn project() -> (LiveProject, String, String) {
        let mut doc = ProjectDoc::create().unwrap();
        doc.set_author(&AccountId::new_v7().to_string(), "Owen");
        let chapters = doc
            .add_node(None, "chapters", NodeKind::Dir, None, "")
            .unwrap();
        let intro = doc
            .add_node(Some(&chapters), "intro.tex", NodeKind::Text, None, "first")
            .unwrap();
        let notes = doc
            .add_node(None, "notes.md", NodeKind::Text, None, "notes")
            .unwrap();
        (LiveProject::new(doc, 0, ProjectRole::Owner), intro, notes)
    }

    #[test]
    fn a_version_shows_its_files_and_a_restore_brings_them_back() {
        let (mut live, intro, notes) = project();
        let version = live.doc().current_version_id();
        live.local_text(&intro, "second").unwrap();
        live.doc_mut().trash(&notes).unwrap();
        let then = file_at_version(live.doc(), &version, "chapters/intro.tex").unwrap();
        assert_eq!(
            then,
            FileAtVersion {
                path: "chapters/intro.tex".to_owned(),
                text: Some("first".to_owned()),
                existed: true,
            }
        );
        let missing = file_at_version(live.doc(), &version, "later.tex").unwrap();
        assert!(!missing.existed && missing.text.is_none());
        let now = live.doc().current_version_id();
        let changed = files_changed_between(live.doc(), &version, &now).unwrap();
        assert!(
            changed.contains(&"chapters/intro.tex".to_owned()),
            "{changed:?}"
        );
        let only = ids_for(live.doc(), &version, &["notes.md".to_owned()]).unwrap();
        assert_eq!(only, BTreeSet::from([notes.clone()]));
        restore_in(&mut live, &version, Some(&only)).unwrap();
        assert_eq!(live.doc().text(&intro).unwrap(), "second");
        restore_in(&mut live, &version, None).unwrap();
        assert_eq!(live.doc().text(&intro).unwrap(), "first");
        let page = page_with_paths(live.doc(), live.doc().history(None, 50));
        assert!(page
            .entries
            .iter()
            .any(|entry| entry.files.contains(&"chapters/intro.tex".to_owned())));
        let wire = serde_json::to_value(&page).unwrap();
        assert!(wire.get("nextBefore").is_some());
        for key in ["id", "at", "until", "authors", "files", "name", "versionId"] {
            assert!(wire["entries"][0].get(key).is_some(), "{key} in {wire}");
        }
    }

    #[test]
    fn only_owners_and_editors_restore_or_name_versions() {
        let (live, _, _) = project();
        let snapshot = live.doc().snapshot().unwrap();
        let version = live.doc().current_version_id();
        for role in [
            ProjectRole::Reviewer,
            ProjectRole::Commenter,
            ProjectRole::Viewer,
        ] {
            let mut other = LiveProject::new(ProjectDoc::load(&snapshot).unwrap(), 0, role);
            assert_eq!(
                code(restore_in(&mut other, &version, None).unwrap_err()),
                "forbidden"
            );
            assert_eq!(
                code(name_in(&mut other, AccountId::new_v7(), &version, "Draft", 1).unwrap_err()),
                "forbidden"
            );
            assert_eq!(
                code(unname_in(&mut other, &version).unwrap_err()),
                "forbidden"
            );
        }
        let mut editor =
            LiveProject::new(ProjectDoc::load(&snapshot).unwrap(), 0, ProjectRole::Editor);
        let id = name_in(&mut editor, AccountId::new_v7(), &version, "Draft", 1).unwrap();
        assert_eq!(editor.doc().version_name_of(id).as_deref(), Some("Draft"));
        assert!(unname_in(&mut editor, &version).unwrap());
        assert_eq!(
            code(file_at_version(editor.doc(), "nope", "a.tex").unwrap_err()),
            "history_unavailable"
        );
    }
}
