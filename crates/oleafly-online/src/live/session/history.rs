use std::path::Path;

use serde_json::Value;

use super::OverleafSession;
use crate::live::rest::{
    within, DocAtVersion, HistoryError, HistoryLabel, RestError, Restored, SettingsUpdate,
    TreeDiffEntry, UpdatesPage, HISTORY_DEADLINE, RESTORE_DEADLINE, ZIP_DEADLINE,
};
use crate::live::DocId;
use crate::realtime::{ImageChoice, SpellLanguage};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ProjectSettings {
    pub root_doc: Option<DocId>,
    pub compiler: Option<String>,
    pub image: Option<String>,
    pub spelling: Option<String>,
    pub bibliography: Option<DocId>,
    pub images: Vec<ImageChoice>,
    pub languages: Vec<SpellLanguage>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HistoryAccess {
    pub restricted: bool,
    pub full: bool,
}

impl OverleafSession {
    pub fn history_access(&self) -> HistoryAccess {
        let state = self.shared.lock();
        HistoryAccess {
            restricted: state.project.restricted,
            full: state
                .project
                .features
                .get("versioning")
                .and_then(Value::as_bool)
                .unwrap_or(true),
        }
    }

    pub fn project_settings(&self) -> ProjectSettings {
        let (images, languages) = self.rest.choices();
        let state = self.shared.lock();
        let project = &state.project;
        ProjectSettings {
            root_doc: project.root_doc.clone(),
            compiler: project.compiler.clone(),
            image: project.image.clone(),
            spelling: project.spell_language.clone(),
            bibliography: project.main_bibliography.clone(),
            images,
            languages,
        }
    }

    pub async fn history_page(
        &self,
        before: Option<u64>,
        min_count: usize,
    ) -> Result<UpdatesPage, HistoryError> {
        let session = self.shared.session();
        within(
            HISTORY_DEADLINE,
            HistoryError::TimedOut,
            self.rest.updates(&session, before, min_count),
        )
        .await
    }

    pub async fn history_tree_diff(
        &self,
        from: u64,
        to: u64,
    ) -> Result<Vec<TreeDiffEntry>, HistoryError> {
        let session = self.shared.session();
        within(
            HISTORY_DEADLINE,
            HistoryError::TimedOut,
            self.rest.tree_diff(&session, from, to),
        )
        .await
    }

    pub async fn doc_at_version(
        &self,
        version: u64,
        path: &str,
    ) -> Result<DocAtVersion, HistoryError> {
        let session = self.shared.session();
        within(
            HISTORY_DEADLINE,
            HistoryError::TimedOut,
            self.rest.doc_at(&session, version, path),
        )
        .await
    }

    pub async fn history_labels(&self) -> Result<Vec<HistoryLabel>, HistoryError> {
        let session = self.shared.session();
        within(
            HISTORY_DEADLINE,
            HistoryError::TimedOut,
            self.rest.labels(&session),
        )
        .await
    }

    pub async fn add_label(
        &self,
        version: u64,
        comment: &str,
    ) -> Result<HistoryLabel, HistoryError> {
        let session = self.shared.session();
        within(
            HISTORY_DEADLINE,
            HistoryError::TimedOut,
            self.rest.add_label(&session, version, comment),
        )
        .await
    }

    pub async fn delete_label(&self, label: &str) -> Result<(), HistoryError> {
        let session = self.shared.session();
        within(
            HISTORY_DEADLINE,
            HistoryError::TimedOut,
            self.rest.delete_label(&session, label),
        )
        .await
    }

    pub async fn revert_file(&self, version: u64, path: &str) -> Result<Restored, HistoryError> {
        let session = self.shared.session();
        within(
            RESTORE_DEADLINE,
            HistoryError::TimedOut,
            self.rest.revert_file(&session, version, path),
        )
        .await
    }

    pub async fn restore_file(&self, version: u64, path: &str) -> Result<Restored, HistoryError> {
        let session = self.shared.session();
        within(
            RESTORE_DEADLINE,
            HistoryError::TimedOut,
            self.rest.restore_file(&session, version, path),
        )
        .await
    }

    pub async fn revert_project(&self, version: u64) -> Result<Vec<Restored>, HistoryError> {
        let session = self.shared.session();
        within(
            RESTORE_DEADLINE,
            HistoryError::TimedOut,
            self.rest.revert_project(&session, version),
        )
        .await
    }

    pub async fn version_zip(
        &self,
        version: u64,
        destination: &Path,
        progress: impl FnMut(u64, Option<u64>),
    ) -> Result<u64, HistoryError> {
        let session = self.shared.session();
        within(
            ZIP_DEADLINE,
            HistoryError::TimedOut,
            self.rest
                .version_zip(&session, version, destination, progress),
        )
        .await
    }

    pub async fn update_settings(&self, update: &SettingsUpdate) -> Result<(), RestError> {
        let session = self.shared.session();
        within(
            HISTORY_DEADLINE,
            |limit| RestError::Lost(format!("no reply within {} s", limit.as_secs())),
            self.rest.update_settings(&session, update),
        )
        .await
    }
}
