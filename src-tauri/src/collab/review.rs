use oleafly_collab::doc::ProjectDoc;
use oleafly_collab::live::LiveProject;
use oleafly_collab::review::{changed_files, decode_mark};
use oleafly_collab::CollabError;
use oleafly_collab_protocol::projects::ProjectRole;
use serde::Serialize;

use super::commands::CollabCommandError;
use super::state::CollabState;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MergeReviewFile {
    pub path: String,
    pub before: Option<String>,
    pub after: Option<String>,
}

pub async fn merge_review(
    state: &CollabState,
    project_id: &str,
    before: &str,
    after: &str,
) -> Result<Vec<MergeReviewFile>, CollabError> {
    let before = decode_mark(before)?;
    let after = decode_mark(after)?;
    let live = super::live::document_snapshot(project_id).transpose()?;
    let document_dir = state.paths()?.document_dir(project_id)?;
    let reviewed = tokio::task::spawn_blocking(move || match live {
        Some(snapshot) => changed_files(&ProjectDoc::load_contained(&snapshot)?, &before, &after),
        None => changed_files(
            LiveProject::load(&document_dir, ProjectRole::Viewer)?.doc(),
            &before,
            &after,
        ),
    })
    .await
    .map_err(|error| CollabError::Io(error.to_string()))??;
    Ok(reviewed
        .into_iter()
        .map(|file| MergeReviewFile {
            path: file.path,
            before: file.before,
            after: file.after,
        })
        .collect())
}

#[tauri::command]
pub async fn collab_merge_review(
    state: tauri::State<'_, CollabState>,
    project_id: String,
    before: String,
    after: String,
) -> Result<Vec<MergeReviewFile>, CollabCommandError> {
    merge_review(state.inner(), &project_id, &before, &after)
        .await
        .map_err(CollabCommandError::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_collab::doc::{encode_version, NodeKind, ProjectDoc};
    use oleafly_collab::live::LiveProject;
    use oleafly_collab::review::encode_mark;
    use oleafly_collab_protocol::projects::ProjectRole;

    #[test]
    fn a_merge_review_reads_the_saved_document_and_shows_each_changed_file() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let paths = oleafly_collab::CollabPaths::new(dir.path().join("collab"));
            let state = CollabState::new(
                paths.clone(),
                std::sync::Arc::new(oleafly_collab::secret_port::MemorySecrets::default()),
            );
            let mut doc = ProjectDoc::create().unwrap();
            let main = doc
                .add_node(None, "main.tex", NodeKind::Text, None, "abc")
                .unwrap();
            let before = encode_mark(&encode_version(&doc.version()));
            doc.set_text(&main, "abcd").unwrap();
            doc.add_node(None, "notes.md", NodeKind::Text, None, "hi")
                .unwrap();
            let after = encode_mark(&encode_version(&doc.version()));
            LiveProject::new(doc, 0, ProjectRole::Owner)
                .save(&paths.document_dir("reviewed").unwrap())
                .unwrap();
            let files = merge_review(&state, "reviewed", &before, &after)
                .await
                .unwrap();
            assert_eq!(
                files,
                vec![
                    MergeReviewFile {
                        path: "main.tex".to_owned(),
                        before: Some("abc".to_owned()),
                        after: Some("abcd".to_owned()),
                    },
                    MergeReviewFile {
                        path: "notes.md".to_owned(),
                        before: None,
                        after: Some("hi".to_owned()),
                    },
                ]
            );
            assert!(merge_review(&state, "reviewed", "not a mark!", &after)
                .await
                .is_err());
            assert!(merge_review(&state, "elsewhere", &before, &after)
                .await
                .is_err());
        });
    }
}
