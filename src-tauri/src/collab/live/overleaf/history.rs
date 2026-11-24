use std::collections::{BTreeSet, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use oleafly_collab::history::{
    checked_name, history_unavailable, HistoryEntry, HistoryPage, MAX_HISTORY_PAGE,
};
use oleafly_collab::CollabError;
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_online::live::rest::{
    DocAtVersion, HistoryError, HistoryLabel, HistoryUpdate, RestError,
};
use serde::Serialize;

use super::{off_runtime, OverleafLive};
use crate::collab::history::FileAtVersion;
use crate::collab::live::session::{guard, io};

const PLAN_WINDOW_MS: i64 = 24 * 60 * 60 * 1000;
const SETTLE_BEFORE_RESTORE: Duration = Duration::from_secs(5);
const KEPT_TEXTS: usize = 16;
const KEPT_TEXT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollabHistoryStatus {
    pub available: bool,
    pub name: bool,
    pub restore: bool,
    pub download: bool,
    pub limited: bool,
}

type Kept = ((u64, String), Option<String>);

#[derive(Default)]
pub(crate) struct HistoryWork {
    texts: Mutex<VecDeque<Kept>>,
    zips: Mutex<Vec<tokio::task::AbortHandle>>,
}

impl HistoryWork {
    fn kept(&self, version: u64, path: &str) -> Option<Option<String>> {
        guard(&self.texts)
            .iter()
            .find(|((at, kept), _)| *at == version && kept == path)
            .map(|(_, text)| text.clone())
    }

    fn keep(&self, version: u64, path: &str, text: Option<String>) {
        if text
            .as_ref()
            .is_some_and(|text| text.len() > KEPT_TEXT_BYTES)
        {
            return;
        }
        let mut texts = guard(&self.texts);
        texts.push_back(((version, path.to_owned()), text));
        let size = |texts: &VecDeque<Kept>| {
            texts
                .iter()
                .map(|(_, text)| text.as_ref().map_or(0, String::len))
                .sum::<usize>()
        };
        while texts.len() > KEPT_TEXTS || size(&texts) > KEPT_TEXT_BYTES {
            texts.pop_front();
        }
    }

    pub(super) fn close(&self) {
        guard(&self.texts).clear();
        for zip in std::mem::take(&mut *guard(&self.zips)) {
            zip.abort();
        }
    }
}

impl Drop for HistoryWork {
    fn drop(&mut self) {
        self.close();
    }
}

fn refused(status: u16, code: &str, message: &str) -> CollabError {
    CollabError::Api {
        status,
        code: code.to_owned(),
        message: message.to_owned(),
    }
}

fn forbidden() -> CollabError {
    refused(
        403,
        "forbidden",
        "your role on this Overleaf project doesn't allow it",
    )
}

pub(crate) fn failed(project_id: &str, task: &str, error: HistoryError) -> CollabError {
    if !matches!(error, HistoryError::PlanLimit | HistoryError::Missing) {
        let _ = crate::project::append_app_log(format!(
            "Overleaf history could not {task} for project {project_id}: {error}"
        ));
    }
    match error {
        HistoryError::PlanLimit => refused(
            402,
            "history_plan_limit",
            "this Overleaf plan keeps no older versions",
        ),
        HistoryError::Missing => history_unavailable(),
        HistoryError::CannotRevert => refused(
            409,
            "restore_off_server",
            "this Overleaf server can't put a version back over the current files",
        ),
        HistoryError::Invalid(reason) => refused(400, "invalid", reason),
        HistoryError::Saving(reason) => CollabError::Io(reason),
        HistoryError::TimedOut(_) => refused(503, "unreachable", &error.to_string()),
        HistoryError::Rest(rest) => rest_failed(rest),
    }
}

pub(crate) fn rest_failed(error: RestError) -> CollabError {
    match error {
        RestError::NotAllowed => forbidden(),
        RestError::SignedOut => refused(401, "signed_out", "the Overleaf sign-in expired"),
        RestError::RateLimited(_) => refused(429, "rate_limited", &error.to_string()),
        RestError::Refused { status, message } => refused(status, "server", &message),
        other => refused(503, "unreachable", &other.to_string()),
    }
}

fn version_of(version: &str) -> Result<u64, CollabError> {
    version.trim().parse().map_err(|_| history_unavailable())
}

impl OverleafLive {
    pub(super) fn role_now(&self) -> ProjectRole {
        self.mirror
            .role()
            .map_or(ProjectRole::Viewer, |(role, _)| role)
    }

    pub(crate) fn refuses_settings(&self) -> bool {
        self.mirror
            .role()
            .is_some_and(|(role, _)| !matches!(role, ProjectRole::Owner | ProjectRole::Editor))
    }

    pub(crate) fn writes(&self) -> bool {
        matches!(self.role_now(), ProjectRole::Owner | ProjectRole::Editor)
    }

    pub(crate) fn history_status(&self) -> CollabHistoryStatus {
        let access = self.session.history_access();
        let open = !access.restricted;
        CollabHistoryStatus {
            available: open,
            name: open && !matches!(self.role_now(), ProjectRole::Viewer | ProjectRole::Unknown),
            restore: open && self.writes(),
            download: open,
            limited: !access.full,
        }
    }

    fn readable(&self) -> Result<(), CollabError> {
        if self.history_status().available {
            Ok(())
        } else {
            Err(forbidden())
        }
    }

    fn local_paths<'a>(&self, paths: impl IntoIterator<Item = &'a String>) -> Vec<String> {
        let shown: BTreeSet<String> = paths
            .into_iter()
            .map(|path| self.mirror.disk_path(path))
            .collect();
        shown.into_iter().collect()
    }

    fn entry_of(&self, update: HistoryUpdate) -> HistoryEntry<String, String> {
        let label = update.labels.first();
        let mut authors: Vec<String> = Vec::new();
        for user in &update.users {
            if !authors.contains(&user.id) {
                authors.push(user.id.clone());
            }
        }
        HistoryEntry {
            id: update.to.to_string(),
            at: update.start_ms,
            until: update.end_ms.max(update.start_ms),
            authors,
            files: self.local_paths(&update.paths),
            name: label.map(|label| label.comment.clone()),
            version_id: label.map(|label| label.id.clone()),
        }
    }

    pub(crate) async fn history_list(
        &self,
        before: Option<&str>,
        limit: usize,
        now_ms: i64,
    ) -> Result<HistoryPage<String, String>, CollabError> {
        self.readable()?;
        let before = before.map(version_of).transpose()?;
        let full = self.session.history_access().full;
        let page = self
            .session
            .history_page(before, limit.clamp(1, MAX_HISTORY_PAGE))
            .await
            .map_err(|error| failed(self.project_id(), "list versions", error))?;
        self.session
            .know_people(page.updates.iter().flat_map(|update| &update.users));
        self.refresh_names();
        let mut entries = Vec::new();
        let mut limited = false;
        for update in page.updates {
            let older = update.end_ms < now_ms - PLAN_WINDOW_MS;
            entries.push(self.entry_of(update));
            if !full && older {
                limited = true;
                break;
            }
        }
        Ok(HistoryPage {
            entries,
            next_before: page
                .next_before
                .filter(|_| !limited)
                .map(|before| before.to_string()),
            limited,
        })
    }

    pub(crate) async fn history_file(
        &self,
        version: &str,
        path: &str,
    ) -> Result<FileAtVersion, CollabError> {
        self.readable()?;
        let version = version_of(version)?;
        self.refresh_names();
        let engine = self.mirror.engine_path(path);
        let text = match self.mirror.history.kept(version, &engine) {
            Some(text) => Some(text),
            None => match self.session.doc_at_version(version, &engine).await {
                Ok(DocAtVersion::Text(text)) => Some(Some(text)),
                Ok(DocAtVersion::Binary) => Some(None),
                Err(HistoryError::Missing) => None,
                Err(error) => return Err(failed(self.project_id(), "read a past version", error)),
            },
        };
        if let Some(text) = &text {
            self.mirror.history.keep(version, &engine, text.clone());
        }
        Ok(FileAtVersion {
            path: path.to_owned(),
            existed: text.is_some(),
            text: text.flatten(),
        })
    }

    pub(crate) async fn history_changed(
        &self,
        from: &str,
        to: &str,
    ) -> Result<Vec<String>, CollabError> {
        self.readable()?;
        let (from, to) = (version_of(from)?, version_of(to)?);
        let diff = self
            .session
            .history_tree_diff(from.min(to), from.max(to))
            .await
            .map_err(|error| failed(self.project_id(), "compare versions", error))?;
        self.refresh_names();
        let changed: Vec<String> = diff
            .iter()
            .filter(|entry| entry.op.is_some())
            .flat_map(|entry| std::iter::once(entry.path.clone()).chain(entry.new_path.clone()))
            .collect();
        Ok(self.local_paths(&changed))
    }

    fn exists_now(&self, path: &str) -> bool {
        self.doc_at(path).is_some()
            || guard(&self.mirror.disk.disk)
                .layout
                .values()
                .any(|placed| placed.path == path)
    }

    pub(crate) async fn history_restore(
        &self,
        version: &str,
        paths: Option<Vec<String>>,
    ) -> Result<(), CollabError> {
        self.readable()?;
        if !self.writes() {
            return Err(forbidden());
        }
        let version = version_of(version)?;
        if !self.session.settle(SETTLE_BEFORE_RESTORE).await {
            return Err(super::commands::overleaf_unsent());
        }
        let project = self.project_id().to_owned();
        let Some(paths) = paths else {
            return self
                .session
                .revert_project(version)
                .await
                .map(drop)
                .map_err(|error| failed(&project, "restore the project", error));
        };
        self.refresh_names();
        for path in paths {
            let engine = self.mirror.engine_path(&path);
            let restored = if self.exists_now(&path) {
                self.session.revert_file(version, &engine).await
            } else {
                self.session.restore_file(version, &engine).await
            };
            restored.map_err(|error| failed(&project, &format!("restore {path}"), error))?;
        }
        Ok(())
    }

    async fn label(&self, id: &str) -> Result<HistoryLabel, CollabError> {
        self.session
            .history_labels()
            .await
            .map_err(|error| failed(self.project_id(), "read version names", error))?
            .into_iter()
            .find(|label| label.id == id)
            .ok_or_else(history_unavailable)
    }

    fn may_remove(&self, label: &HistoryLabel) -> bool {
        self.role_now() == ProjectRole::Owner || label.user_id.as_deref() == Some(self.me.as_str())
    }

    pub(crate) async fn history_name(&self, version: &str, name: &str) -> Result<(), CollabError> {
        if !self.history_status().name {
            return Err(forbidden());
        }
        let name = checked_name(name)?;
        let project = self.project_id().to_owned();
        if let Ok(version) = version.trim().parse::<u64>() {
            return self
                .session
                .add_label(version, name)
                .await
                .map(drop)
                .map_err(|error| failed(&project, "name a version", error));
        }
        let old = self.label(version).await?;
        if !self.may_remove(&old) {
            return Err(forbidden());
        }
        self.session
            .add_label(old.version, name)
            .await
            .map_err(|error| failed(&project, "rename a version", error))?;
        self.session
            .delete_label(&old.id)
            .await
            .map_err(|error| failed(&project, "remove the old version name", error))
    }

    pub(crate) async fn history_unname(&self, label: &str) -> Result<(), CollabError> {
        if !self.history_status().name {
            return Err(forbidden());
        }
        let label = self.label(label).await?;
        if !self.may_remove(&label) {
            return Err(forbidden());
        }
        self.session
            .delete_label(&label.id)
            .await
            .map_err(|error| failed(self.project_id(), "remove a version name", error))
    }

    pub(crate) async fn history_zip(
        self: &Arc<Self>,
        version: &str,
        dest: String,
    ) -> Result<u64, CollabError> {
        if !self.history_status().download {
            return Err(forbidden());
        }
        let version = version_of(version)?;
        crate::path_grants::require_save(&dest)
            .map_err(|message| refused(403, "forbidden", &message))?;
        let staged = off_runtime(move || crate::sandbox::AtomicFile::for_export(&dest))
            .await
            .map_err(io)?
            .map_err(CollabError::Io)?;
        let live = Arc::clone(self);
        let task = tauri::async_runtime::spawn(async move {
            let staging = staged.staging_path().to_path_buf();
            let size = live
                .session
                .version_zip(version, &staging, |_, _| {})
                .await
                .map_err(|error| failed(live.project_id(), "download a version", error))?;
            off_runtime(move || {
                read_back(&staging)?;
                staged.commit()
            })
            .await
            .map_err(io)?
            .map_err(CollabError::Io)?;
            Ok::<u64, CollabError>(size)
        });
        let abort = task.inner().abort_handle();
        guard(&self.mirror.history.zips).push(abort.clone());
        let finished = task.await;
        guard(&self.mirror.history.zips).retain(|kept| kept.id() != abort.id());
        match finished {
            Ok(result) => result,
            Err(_) => Err(refused(409, "cancelled", "the download stopped")),
        }
    }
}

fn read_back(path: &std::path::Path) -> Result<(), String> {
    let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("the download is not a zip: {error}"))?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("the download is damaged: {error}"))?;
        std::io::copy(&mut entry, &mut std::io::sink())
            .map_err(|error| format!("the download is damaged: {error}"))?;
    }
    Ok(())
}
