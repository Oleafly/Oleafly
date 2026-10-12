use std::sync::PoisonError;

use oleafly_collab::doc::{NodeKind, Trashed};
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize::{self, Layout};
use oleafly_collab::sync::SharedLive;
use oleafly_collab::CollabError;
use oleafly_collab_protocol::ids::{AccountId, ServerId};
use serde::Serialize;

use super::commands::CollabCommandError;
use super::state::CollabState;

pub const LIVE_RENAMED_EVENT: &str = "collab-live-renamed";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub id: String,
    pub name: String,
    pub kind: NodeKind,
    pub folder: Option<String>,
    pub deleted_by: Option<String>,
    pub deleted_at: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeClash {
    pub path: String,
    pub name: String,
    pub other: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamedPayload {
    pub project_id: String,
    pub account_id: Option<String>,
    pub before: String,
    pub ours: String,
    pub theirs: String,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Settled {
    pub merged: bool,
    pub renamed: Vec<RenamedPayload>,
}

fn forbidden() -> CollabError {
    CollabError::Api {
        status: 403,
        code: "forbidden".to_owned(),
        message: "viewers cannot restore deleted files".to_owned(),
    }
}

fn entry(layout: &Layout, item: Trashed) -> TrashEntry {
    let folder = item
        .folder_id
        .as_ref()
        .and_then(|id| layout.get(id))
        .map(|placed| placed.path.clone())
        .or(item.folder);
    TrashEntry {
        id: item.id,
        name: item.name,
        kind: item.kind,
        folder,
        deleted_by: item.deleted_by,
        deleted_at: item.deleted_at,
    }
}

pub fn trash_list(live: &LiveProject) -> Result<Vec<TrashEntry>, CollabError> {
    let layout = materialize::layout(&live.doc().nodes()?);
    Ok(live
        .doc()
        .trashed()?
        .into_iter()
        .map(|item| entry(&layout, item))
        .collect())
}

pub fn trash_restore(live: &mut LiveProject, id: &str) -> Result<(), CollabError> {
    if !live.can_edit() {
        return Err(forbidden());
    }
    live.doc_mut().restore(id)
}

pub fn tree_clashes(live: &LiveProject) -> Result<Vec<TreeClash>, CollabError> {
    let nodes = live.doc().nodes()?;
    let layout = materialize::layout(&nodes);
    Ok(materialize::clashes(&nodes)
        .into_iter()
        .filter_map(|clash| {
            Some(TreeClash {
                path: layout.get(&clash.id)?.path.clone(),
                name: clash.name,
                other: layout.get(&clash.other)?.path.clone(),
            })
        })
        .collect())
}

pub(super) fn sign(
    live: &mut LiveProject,
    state: &CollabState,
    server: ServerId,
    account: AccountId,
) {
    let name = state
        .registry()
        .ok()
        .and_then(|registry| {
            registry
                .get(server)
                .and_then(|entry| entry.account.as_ref())
                .map(|account| account.display_name.clone())
        })
        .unwrap_or_default();
    live.doc_mut().set_author(&account.to_string(), &name);
}

pub(super) fn keep_beside(layout: &mut Layout, beside: Vec<(String, String, String)>) {
    for (ours, theirs, path) in beside {
        layout.remove(&theirs);
        if let Some(placed) = layout.get_mut(&ours) {
            placed.path = path;
        }
    }
}

pub(super) fn settle(project_id: &str, live: &SharedLive) -> Settled {
    let mut live = live.lock().unwrap_or_else(PoisonError::into_inner);
    if !live.doc().take_unsettled() {
        return Settled::default();
    }
    let renamed = live
        .doc()
        .lost_renames()
        .into_iter()
        .map(|lost| RenamedPayload {
            project_id: project_id.to_owned(),
            account_id: lost.by,
            before: lost.before,
            ours: lost.ours,
            theirs: lost.theirs,
        })
        .collect();
    let duplicated = live.can_edit()
        && live
            .doc()
            .nodes()
            .is_ok_and(|nodes| !materialize::duplicate_blobs(&nodes).is_empty());
    let merged = duplicated
        && live
            .doc_mut()
            .merge_identical_blobs()
            .is_ok_and(|count| count > 0);
    Settled { merged, renamed }
}

#[tauri::command]
pub async fn collab_trash_list(project_id: String) -> Result<Vec<TrashEntry>, CollabCommandError> {
    super::live::read_live(&project_id, trash_list)
        .transpose()
        .map(Option::unwrap_or_default)
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_trash_restore(
    project_id: String,
    id: String,
) -> Result<(), CollabCommandError> {
    super::live::edit_live(&project_id, |live| trash_restore(live, &id))
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_tree_clashes(project_id: String) -> Result<Vec<TreeClash>, CollabCommandError> {
    super::live::read_live(&project_id, tree_clashes)
        .transpose()
        .map(Option::unwrap_or_default)
        .map_err(CollabCommandError::from)
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;
    use oleafly_collab::doc::ProjectDoc;
    use oleafly_collab::{CollabPaths, MemorySecrets, ServerEntry};
    use oleafly_collab_protocol::auth::AccountSummary;
    use oleafly_collab_protocol::projects::ProjectRole;
    use oleafly_collab_protocol::roles::ServerRole;

    const ALICE: &str = "acct-alice";
    const BOB: &str = "acct-bob";

    fn doc(account: &str, name: &str) -> ProjectDoc {
        let mut doc = ProjectDoc::create().unwrap();
        doc.set_author(account, name);
        doc
    }

    fn joined(from: &ProjectDoc, account: &str, name: &str, role: ProjectRole) -> LiveProject {
        let mut doc = ProjectDoc::load(&from.snapshot().unwrap()).unwrap();
        doc.set_author(account, name);
        LiveProject::new(doc, 0, role)
    }

    fn deliver(from: &LiveProject, to: &mut LiveProject, seq: u64) {
        let payload = from.doc().export_since(&to.doc().version()).unwrap();
        assert!(to.import_update(seq, &payload).unwrap());
    }

    #[test]
    fn the_trash_lists_newest_first_with_the_folder_each_file_lived_in() {
        let mut owner = doc(ALICE, "Alice Chen");
        owner
            .add_node(None, "chapters", NodeKind::Dir, None, "")
            .unwrap();
        let second = owner
            .add_node(None, "Chapters", NodeKind::Dir, None, "")
            .unwrap();
        let old = owner
            .add_node(None, "old", NodeKind::Dir, None, "")
            .unwrap();
        let intro = owner
            .add_node(Some(&second), "intro.tex", NodeKind::Text, None, "x")
            .unwrap();
        let notes = owner
            .add_node(Some(&old), "notes.tex", NodeKind::Text, None, "y")
            .unwrap();
        owner.trash(&intro).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(3));
        owner.trash(&notes).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(3));
        owner.trash(&old).unwrap();
        let live = LiveProject::new(owner, 0, ProjectRole::Owner);
        let listed = trash_list(&live).unwrap();
        let short = &second[second.len() - 6..];
        let summary: Vec<(String, Option<String>, Option<String>)> = listed
            .iter()
            .map(|item| {
                (
                    item.name.clone(),
                    item.folder.clone(),
                    item.deleted_by.clone(),
                )
            })
            .collect();
        assert_eq!(
            summary,
            vec![
                ("old".to_owned(), None, Some(ALICE.to_owned())),
                (
                    "notes.tex".to_owned(),
                    Some("old".to_owned()),
                    Some(ALICE.to_owned())
                ),
                (
                    "intro.tex".to_owned(),
                    Some(format!("Chapters ({short})")),
                    Some(ALICE.to_owned())
                ),
            ]
        );
        assert!(listed.iter().all(|item| item.deleted_at.is_some()));
        assert_eq!(listed[0].kind, NodeKind::Dir);
        let json = serde_json::to_value(&listed[1]).unwrap();
        assert_eq!(json["deletedBy"], ALICE);
        assert_eq!(json["kind"], "text");
    }

    #[test]
    fn an_editor_restores_and_a_viewer_cannot() {
        let mut owner = doc(ALICE, "Alice Chen");
        let chapters = owner
            .add_node(None, "chapters", NodeKind::Dir, None, "")
            .unwrap();
        let intro = owner
            .add_node(Some(&chapters), "intro.tex", NodeKind::Text, None, "x")
            .unwrap();
        owner.trash(&intro).unwrap();
        let mut viewer = joined(&owner, BOB, "Bob Smith", ProjectRole::Viewer);
        let refused = trash_restore(&mut viewer, &intro).unwrap_err();
        assert_eq!(CollabCommandError::from(refused).code, "forbidden");
        assert_eq!(trash_list(&viewer).unwrap().len(), 1);
        let mut editor = joined(&owner, BOB, "Bob Smith", ProjectRole::Editor);
        editor.take_disk_work();
        trash_restore(&mut editor, &intro).unwrap();
        assert!(trash_list(&editor).unwrap().is_empty());
        assert!(editor.take_disk_work().tree);
        let placed = materialize::layout(&editor.doc().nodes().unwrap());
        assert_eq!(placed[&intro].path, "chapters/intro.tex");
        assert!(editor.has_unsent());
    }

    #[test]
    fn clashes_name_the_disk_path_the_original_name_and_the_other_file() {
        let mut owner = doc(ALICE, "Alice Chen");
        let figs = owner
            .add_node(None, "figs", NodeKind::Dir, None, "")
            .unwrap();
        let mut bob = joined(&owner, BOB, "Bob Smith", ProjectRole::Editor);
        owner
            .add_node(Some(&figs), "plot.png", NodeKind::Blob, Some("aaa"), "")
            .unwrap();
        let mut alice = LiveProject::new(owner, 0, ProjectRole::Owner);
        bob.doc_mut()
            .add_node(Some(&figs), "plot.png", NodeKind::Blob, Some("bbb"), "")
            .unwrap();
        deliver(&alice, &mut bob, 1);
        deliver(&bob, &mut alice, 1);
        let clashes = tree_clashes(&alice).unwrap();
        assert_eq!(clashes, tree_clashes(&bob).unwrap());
        assert_eq!(clashes.len(), 1);
        assert_eq!(clashes[0].name, "plot.png");
        assert_eq!(clashes[0].other, "figs/plot.png");
        assert!(
            clashes[0].path == "figs/plot (from Bob Smith).png"
                || clashes[0].path == "figs/plot (from Alice Chen).png",
            "{:?}",
            clashes[0]
        );
    }

    #[test]
    fn settling_reports_a_lost_rename_and_editors_merge_identical_figures() {
        let mut owner = doc(ALICE, "Alice Chen");
        let intro = owner
            .add_node(None, "intro.tex", NodeKind::Text, None, "x")
            .unwrap();
        let mut bob = joined(&owner, BOB, "Bob Smith", ProjectRole::Editor);
        let mut carol = joined(&owner, "acct-carol", "Carol Diaz", ProjectRole::Viewer);
        let mut alice = LiveProject::new(owner, 0, ProjectRole::Owner);
        alice.doc_mut().rename(&intro, "background.tex").unwrap();
        alice
            .doc_mut()
            .add_node(None, "plot.png", NodeKind::Blob, Some("same"), "")
            .unwrap();
        bob.doc_mut().rename(&intro, "overview.tex").unwrap();
        bob.doc_mut()
            .add_node(None, "plot.png", NodeKind::Blob, Some("same"), "")
            .unwrap();
        deliver(&alice, &mut bob, 1);
        deliver(&bob, &mut alice, 1);
        deliver(&alice, &mut carol, 1);
        deliver(&bob, &mut carol, 2);
        let shared = |live: LiveProject| -> SharedLive { Arc::new(Mutex::new(live)) };
        let (alice, bob, carol) = (shared(alice), shared(bob), shared(carol));
        let from_alice = settle("grant", &alice);
        let from_bob = settle("grant", &bob);
        let from_carol = settle("grant", &carol);
        assert!(from_alice.merged);
        assert!(from_bob.merged);
        assert!(!from_carol.merged);
        assert!(from_carol.renamed.is_empty());
        let mut reported: Vec<RenamedPayload> = from_alice.renamed;
        reported.extend(from_bob.renamed);
        assert_eq!(reported.len(), 1, "{reported:?}");
        let lost = &reported[0];
        assert_eq!(lost.project_id, "grant");
        assert_eq!(lost.before, "intro.tex");
        if lost.ours == "overview.tex" {
            assert_eq!(lost.theirs, "background.tex");
            assert_eq!(lost.account_id.as_deref(), Some(ALICE));
        } else {
            assert_eq!(lost.ours, "background.tex");
            assert_eq!(lost.theirs, "overview.tex");
            assert_eq!(lost.account_id.as_deref(), Some(BOB));
        }
        let json = serde_json::to_value(lost).unwrap();
        assert_eq!(json["projectId"], "grant");
        let blobs = |live: &SharedLive| {
            materialize::layout(&live.lock().unwrap().doc().nodes().unwrap())
                .values()
                .filter(|placed| placed.kind == NodeKind::Blob)
                .count()
        };
        assert_eq!(blobs(&alice), 1);
        assert_eq!(blobs(&bob), 1);
        assert_eq!(blobs(&carol), 2);
        assert_eq!(settle("grant", &alice), Settled::default());
    }

    #[test]
    fn signing_the_document_credits_new_files_to_the_signed_in_person() {
        let dir = tempfile::tempdir().unwrap();
        let state = CollabState::new(
            CollabPaths::new(dir.path().join("collab")),
            Arc::new(MemorySecrets::default()),
        );
        let server = ServerId::new_v7();
        let account = AccountId::new_v7();
        state
            .update_registry(|registry| {
                registry.upsert(ServerEntry {
                    server_id: server,
                    url: "https://lab.example".to_owned(),
                    name: "Lab".to_owned(),
                    icon_url: None,
                    account: Some(AccountSummary {
                        account_id: account,
                        display_name: "Alice Chen".to_owned(),
                        avatar_url: None,
                        server_role: ServerRole::Member,
                        emails: Vec::new(),
                        logins: Vec::new(),
                    }),
                    added_at: 0,
                });
            })
            .unwrap();
        let mut live = LiveProject::new(ProjectDoc::create().unwrap(), 0, ProjectRole::Owner);
        sign(&mut live, &state, server, account);
        let id = live
            .doc_mut()
            .add_node(None, "plot.png", NodeKind::Blob, Some("h"), "")
            .unwrap();
        live.doc_mut().trash(&id).unwrap();
        let listed = trash_list(&live).unwrap();
        assert_eq!(listed[0].deleted_by, Some(account.to_string()));
        let mut unknown = LiveProject::new(ProjectDoc::create().unwrap(), 0, ProjectRole::Owner);
        sign(&mut unknown, &state, ServerId::new_v7(), account);
        let other = unknown
            .doc_mut()
            .add_node(None, "a.png", NodeKind::Blob, Some("h"), "")
            .unwrap();
        let node = unknown
            .doc()
            .nodes()
            .unwrap()
            .into_iter()
            .find(|node| node.id == other)
            .unwrap();
        assert_eq!(node.author_name, None);
        let named = live
            .doc()
            .nodes()
            .unwrap()
            .into_iter()
            .find(|node| node.id == id)
            .unwrap();
        assert_eq!(named.author_name.as_deref(), Some("Alice Chen"));
    }
}
