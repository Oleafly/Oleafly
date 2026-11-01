use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex, PoisonError};

use oleafly_collab::doc::{encode_version, FileNode, NodeKind, NodeParent, ProjectDoc};
use oleafly_collab::history::HistoryPage;
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize;
use oleafly_collab::review::changed_between;
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

const KEPT_VERSIONS: usize = 4;

pub(crate) struct Versions<'a> {
    doc: &'a ProjectDoc,
    old: &'a mut Vec<(String, ProjectDoc)>,
}

impl<'a> Versions<'a> {
    fn of(doc: &'a ProjectDoc, old: &'a mut Vec<(String, ProjectDoc)>) -> Versions<'a> {
        Versions { doc, old }
    }

    fn doc(&self) -> &ProjectDoc {
        self.doc
    }

    fn hold(&mut self, version: &str) -> Result<(), CollabError> {
        if let Some(index) = self.old.iter().position(|(id, _)| id == version) {
            let kept = self.old.remove(index);
            self.old.push(kept);
            return Ok(());
        }
        let copy = self.doc.at_history(version)?;
        if self.old.len() >= KEPT_VERSIONS {
            self.old.remove(0);
        }
        self.old.push((version.to_owned(), copy));
        Ok(())
    }

    fn at(&self, version: &str) -> Result<&ProjectDoc, CollabError> {
        self.old
            .iter()
            .find(|(id, _)| id == version)
            .map(|(_, copy)| copy)
            .ok_or_else(|| CollabError::Corrupt("a version copy went missing".to_owned()))
    }
}

struct Loaded {
    doc: ProjectDoc,
    old: Vec<(String, ProjectDoc)>,
}

struct Copied {
    snapshot: Mutex<Option<Vec<u8>>>,
    authors: oleafly_collab::comments::Authorship,
    author: Option<(String, String)>,
    loaded: tokio::sync::OnceCell<Arc<Mutex<Loaded>>>,
}

impl Copied {
    fn load(&self) -> Result<Loaded, CollabError> {
        let snapshot = self
            .snapshot
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
            .ok_or_else(|| CollabError::Corrupt("this copy was already loaded".to_owned()))?;
        let mut doc = ProjectDoc::load_contained(&snapshot)?;
        doc.set_authorship(self.authors.clone());
        if let Some((account, name)) = &self.author {
            doc.set_author(account, name);
        }
        Ok(Loaded {
            doc,
            old: Vec::new(),
        })
    }
}

fn copied(live: &LiveProject) -> Result<Copied, CollabError> {
    let doc = live.doc();
    Ok(Copied {
        snapshot: Mutex::new(Some(doc.snapshot()?)),
        authors: doc.authorship().clone(),
        author: doc.author_key().map(|account| {
            (
                account.to_owned(),
                doc.author_name().unwrap_or_default().to_owned(),
            )
        }),
        loaded: tokio::sync::OnceCell::new(),
    })
}

struct LastCopy {
    project_id: String,
    version: Vec<u8>,
    copy: Arc<Copied>,
}

static LAST_COPY: Mutex<Option<LastCopy>> = Mutex::new(None);

fn live_copy(project_id: &str) -> Option<Result<Arc<Copied>, CollabError>> {
    let mut last = LAST_COPY.lock().unwrap_or_else(PoisonError::into_inner);
    super::live::read_live(project_id, |live| {
        let version = encode_version(&live.doc().version());
        if let Some(kept) = last
            .as_ref()
            .filter(|kept| kept.project_id == project_id && kept.version == version)
        {
            return Ok(Arc::clone(&kept.copy));
        }
        let copy = Arc::new(copied(live)?);
        *last = Some(LastCopy {
            project_id: project_id.to_owned(),
            version,
            copy: Arc::clone(&copy),
        });
        Ok(copy)
    })
}

async fn loaded(copy: Arc<Copied>) -> Result<Arc<Mutex<Loaded>>, CollabError> {
    let cell = Arc::clone(&copy);
    cell.loaded
        .get_or_try_init(|| async move {
            tokio::task::spawn_blocking(move || copy.load())
                .await
                .map_err(io)?
                .map(|loaded| Arc::new(Mutex::new(loaded)))
        })
        .await
        .cloned()
}

async fn with_copy<T: Send + 'static>(
    state: &CollabState,
    project_id: &str,
    work: impl FnOnce(&mut Versions<'_>) -> Result<T, CollabError> + Send + 'static,
) -> Result<T, CollabError> {
    if let Some(copy) = live_copy(project_id) {
        let held = loaded(copy?).await?;
        return tokio::task::spawn_blocking(move || {
            let mut held = held.lock().unwrap_or_else(PoisonError::into_inner);
            let Loaded { doc, old } = &mut *held;
            work(&mut Versions::of(doc, old))
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
        work(&mut Versions::of(saved.doc(), &mut Vec::new()))
    })
    .await
    .map_err(io)?
}

struct Labels {
    alive: HashMap<String, String>,
    gone: HashMap<String, String>,
}

impl Labels {
    fn of(doc: &ProjectDoc) -> Labels {
        let nodes = doc.nodes().unwrap_or_default();
        let alive: HashMap<String, String> = materialize::layout(&nodes)
            .into_iter()
            .map(|(id, placed)| (id, placed.path))
            .collect();
        let folders: HashMap<String, Option<String>> = doc
            .trashed()
            .unwrap_or_default()
            .into_iter()
            .map(|trashed| (trashed.id, trashed.folder))
            .collect();
        let by_id: HashMap<&str, &FileNode> =
            nodes.iter().map(|node| (node.id.as_str(), node)).collect();
        let mut gone = HashMap::new();
        for node in &nodes {
            if alive.contains_key(&node.id) {
                continue;
            }
            let mut names = vec![node.name.clone()];
            let mut current = node;
            for _ in 0..nodes.len() {
                match &current.parent {
                    NodeParent::Node(parent) => match by_id.get(parent.as_str()) {
                        Some(found) => {
                            names.push(found.name.clone());
                            current = found;
                        }
                        None => break,
                    },
                    NodeParent::Trash => {
                        if let Some(Some(folder)) = folders.get(&current.id) {
                            names.push(folder.clone());
                        }
                        break;
                    }
                    NodeParent::Root => break,
                }
            }
            names.reverse();
            gone.insert(node.id.clone(), names.join("/"));
        }
        Labels { alive, gone }
    }

    fn label(&self, id: &str) -> Option<&String> {
        self.alive.get(id).or_else(|| self.gone.get(id))
    }

    fn id_for(&self, then: &materialize::Layout, path: &str) -> Option<String> {
        let named = |labels: &HashMap<String, String>| {
            labels
                .iter()
                .find(|(_, label)| label.as_str() == path)
                .map(|(id, _)| id.clone())
        };
        named(&self.alive)
            .or_else(|| named(&self.gone))
            .or_else(|| {
                then.iter()
                    .find(|(_, placed)| placed.path == path)
                    .map(|(id, _)| id.clone())
            })
    }
}

pub(crate) fn page_with_paths(doc: &ProjectDoc, mut page: HistoryPage) -> HistoryPage {
    let names = Labels::of(doc);
    for entry in &mut page.entries {
        let mut paths: Vec<String> = entry
            .files
            .iter()
            .filter_map(|file| names.label(file).cloned())
            .collect();
        paths.sort();
        paths.dedup();
        entry.files = paths;
    }
    page
}

#[cfg(test)]
pub(crate) fn file_at_version(
    doc: &ProjectDoc,
    version: &str,
    path: &str,
) -> Result<FileAtVersion, CollabError> {
    file_in(&mut Versions::of(doc, &mut Vec::new()), version, path)
}

fn file_in(
    versions: &mut Versions<'_>,
    version: &str,
    path: &str,
) -> Result<FileAtVersion, CollabError> {
    versions.hold(version)?;
    let (doc, old) = (versions.doc(), versions.at(version)?);
    let mut layout = materialize::layout(&old.nodes()?);
    let found = Labels::of(doc)
        .id_for(&layout, path)
        .and_then(|id| layout.remove(&id).map(|placed| (id, placed)));
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

#[cfg(test)]
pub(crate) fn files_changed_between(
    doc: &ProjectDoc,
    from: &str,
    to: &str,
) -> Result<Vec<String>, CollabError> {
    changed_in(&mut Versions::of(doc, &mut Vec::new()), from, to)
}

fn changed_in(
    versions: &mut Versions<'_>,
    from: &str,
    to: &str,
) -> Result<Vec<String>, CollabError> {
    versions.hold(from)?;
    versions.hold(to)?;
    let labels = Labels::of(versions.doc());
    let mut paths: Vec<String> = changed_between(versions.at(from)?, versions.at(to)?)?
        .into_iter()
        .map(|file| labels.label(&file.id).cloned().unwrap_or(file.path))
        .collect();
    paths.sort();
    paths.dedup();
    Ok(paths)
}

#[cfg(test)]
pub(crate) fn ids_for(
    doc: &ProjectDoc,
    version: &str,
    paths: &[String],
) -> Result<BTreeSet<String>, CollabError> {
    ids_in(&mut Versions::of(doc, &mut Vec::new()), version, paths)
}

fn ids_in(
    versions: &mut Versions<'_>,
    version: &str,
    paths: &[String],
) -> Result<BTreeSet<String>, CollabError> {
    versions.hold(version)?;
    let then = materialize::layout(&versions.at(version)?.nodes()?);
    let labels = Labels::of(versions.doc());
    Ok(paths
        .iter()
        .filter_map(|path| labels.id_for(&then, path))
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
    with_copy(state.inner(), &project_id, move |versions| {
        let doc = versions.doc();
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
    with_copy(state.inner(), &project_id, move |versions| {
        file_in(versions, &version_id, &path)
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
    with_copy(state.inner(), &project_id, move |versions| {
        changed_in(versions, &from_version, &to_version)
    })
    .await
    .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_history_restore(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
    version_id: String,
    paths: Option<Vec<String>>,
) -> Result<(), CollabCommandError> {
    let files = match paths {
        Some(paths) => {
            let version = version_id.clone();
            let ids = with_copy(state.inner(), &project_id, move |versions| {
                ids_in(versions, &version, &paths)
            })
            .await
            .map_err(CollabCommandError::from)?;
            Some(ids)
        }
        None => None,
    };
    let restored = super::live::review_live(&project_id, |live, _| {
        restore_in(live, &version_id, files.as_ref())
    })
    .map_err(CollabCommandError::from)?;
    super::suggesting::tell_local(&app, &project_id, &restored.into_iter().collect());
    Ok(())
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
    fn a_moved_or_deleted_file_is_found_in_an_older_version_by_the_name_it_is_listed_under() {
        let (mut live, intro, _) = project();
        let sections = live
            .doc_mut()
            .add_node(None, "sections", NodeKind::Dir, None, "")
            .unwrap();
        let old = live
            .doc_mut()
            .add_node(Some(&sections), "old.tex", NodeKind::Text, None, "old text")
            .unwrap();
        let version = live.doc().current_version_id();
        live.doc_mut().move_to(&intro, None).unwrap();
        live.doc_mut().trash(&old).unwrap();
        live.local_text(&intro, "second").unwrap();
        let later = live.doc().current_version_id();
        let page = page_with_paths(live.doc(), live.doc().history(None, 50));
        let listed: Vec<&str> = page
            .entries
            .iter()
            .flat_map(|entry| entry.files.iter().map(String::as_str))
            .collect();
        assert!(listed.contains(&"intro.tex"), "{listed:?}");
        assert!(listed.contains(&"sections/old.tex"), "{listed:?}");
        for (path, text) in [("intro.tex", "first"), ("sections/old.tex", "old text")] {
            let then = file_at_version(live.doc(), &version, path).unwrap();
            assert!(then.existed, "{path}");
            assert_eq!(then.text.as_deref(), Some(text), "{path}");
        }
        assert_eq!(
            ids_for(live.doc(), &version, &["sections/old.tex".to_owned()]).unwrap(),
            BTreeSet::from([old])
        );
        let changed = files_changed_between(live.doc(), &version, &later).unwrap();
        assert!(changed.contains(&"intro.tex".to_owned()), "{changed:?}");
        let after = file_at_version(live.doc(), &later, "intro.tex").unwrap();
        assert_eq!(after.text.as_deref(), Some("second"));
    }

    #[test]
    fn history_reads_share_one_copy_of_the_project_until_it_changes() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("project");
        std::fs::create_dir_all(&root).unwrap();
        let rig = crate::collab::live::write::rig::LiveRig::start(
            "history-copy",
            &root,
            &[("main.tex", "abc")],
        );
        let _live = rig.go_live();
        let first = live_copy("history-copy").unwrap().unwrap();
        let again = live_copy("history-copy").unwrap().unwrap();
        assert!(Arc::ptr_eq(&first, &again));
        let (one, two) = tauri::async_runtime::block_on(async {
            (
                loaded(Arc::clone(&first)).await.unwrap(),
                loaded(Arc::clone(&again)).await.unwrap(),
            )
        });
        assert!(Arc::ptr_eq(&one, &two));
        rig.remote("main.tex", "abcd");
        let changed = live_copy("history-copy").unwrap().unwrap();
        assert!(!Arc::ptr_eq(&first, &changed));
        assert!(live_copy("not-live").is_none());
    }

    #[test]
    fn versions_read_for_history_are_kept_for_the_next_request_up_to_a_few() {
        let (mut live, intro, _) = project();
        let mut ids = vec![live.doc().current_version_id()];
        for text in ["two", "three", "four", "five", "six"] {
            live.local_text(&intro, text).unwrap();
            ids.push(live.doc().current_version_id());
        }
        let mut kept = Vec::new();
        let mut versions = Versions::of(live.doc(), &mut kept);
        let first = file_in(&mut versions, &ids[0], "chapters/intro.tex").unwrap();
        assert_eq!(first.text.as_deref(), Some("first"));
        let held = versions.at(&ids[0]).unwrap() as *const ProjectDoc;
        file_in(&mut versions, &ids[0], "chapters/intro.tex").unwrap();
        assert_eq!(versions.at(&ids[0]).unwrap() as *const ProjectDoc, held);
        for id in &ids[1..] {
            file_in(&mut versions, id, "chapters/intro.tex").unwrap();
        }
        assert_eq!(kept.len(), KEPT_VERSIONS);
        assert!(kept.iter().all(|(id, _)| id != &ids[0]));
        assert_eq!(
            kept.last().map(|(id, _)| id.as_str()),
            ids.last().map(String::as_str)
        );
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
