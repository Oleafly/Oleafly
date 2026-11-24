pub(crate) mod account;
#[cfg(test)]
mod account_tests;
pub(crate) mod chat;
#[cfg(test)]
mod chat_tests;
pub(crate) mod commands;
#[cfg(test)]
mod elsewhere_tests;
#[cfg(test)]
mod first_start_tests;
pub(crate) mod history;
#[cfg(test)]
mod history_tests;
#[cfg(test)]
mod linked_tests;
pub(crate) mod notices;
pub(crate) mod review;
#[cfg(test)]
mod review_tests;
#[cfg(test)]
pub(crate) mod rig;
pub(crate) mod settings;
#[cfg(test)]
mod settings_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tree_tests;

use std::ops::Deref;
use std::path::Path;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use oleafly_collab::CollabError;
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_live::overleaf as shared;
use oleafly_online::live::doc::Origin;
use oleafly_online::live::journal::{self, Holder, HolderKind, JournalError};
use oleafly_online::live::session::{ChatChange, ReviewChange};
use oleafly_online::realtime::events::ProjectEvent;
use oleafly_online::realtime::DocId;
use oleafly_ot::{DocOpened, DocSink, TextOperation};

pub(crate) use oleafly_live::overleaf::*;

use super::host::LiveHost;
use super::payloads::LiveInfo;
pub(crate) use super::session::off_runtime;
use super::session::{forget_live, guard, Live, ACTIVE, LIFECYCLE};
use super::write::WriteOutcome;
use crate::collab::disk::lf_text;
use crate::overleaf::OverleafLink;

pub(crate) struct Mirror {
    shared: Arc<shared::Mirror>,
    host: Arc<dyn LiveHost>,
    owner: OnceLock<String>,
    chat: chat::ChatMemory,
    review: review::Memory,
    history: history::HistoryWork,
    settings: settings::SettingsSync,
}

impl Deref for Mirror {
    type Target = shared::Mirror;

    fn deref(&self) -> &shared::Mirror {
        &self.shared
    }
}

impl MirrorHooks for Mirror {
    fn owner_known(&self) -> bool {
        self.owner.get().is_some()
    }

    fn record_owner(&self) {
        account::record_owner(self);
    }

    fn ended(self: Arc<Self>) {
        retire(&self);
    }

    fn role_known(&self) {
        self.tell_review_status();
    }

    fn project_event(&self, event: ProjectEvent) {
        self.follow_project(event);
    }

    fn review_trouble(&self, change: &ReviewChange) -> Vec<String> {
        review::trouble_lines(self, change)
    }

    fn review_changed(&self, change: ReviewChange) {
        self.review_noticed(change);
    }

    fn chat_trouble(&self, change: &ChatChange) -> Option<String> {
        self.chat_noticed(change)
    }

    fn chat_changed(&self, change: ChatChange) {
        self.tell_chat(&change);
    }
}

pub struct OverleafLive {
    shared: Arc<shared::OverleafLive>,
    pub(crate) mirror: Arc<Mirror>,
}

impl Deref for OverleafLive {
    type Target = shared::OverleafLive;

    fn deref(&self) -> &shared::OverleafLive {
        &self.shared
    }
}

pub(super) fn retire(mirror: &Arc<Mirror>) {
    let mirror = Arc::downgrade(mirror);
    tauri::async_runtime::spawn(async move {
        let _lifecycle = LIFECYCLE.lock().await;
        let retired = {
            let mut slot = guard(&ACTIVE);
            let ours = slot
                .as_ref()
                .and_then(Live::overleaf)
                .is_some_and(|live| std::ptr::eq(Arc::as_ptr(&live.mirror), mirror.as_ptr()));
            if ours {
                slot.take()
            } else {
                None
            }
        };
        if let Some(Live::Overleaf(live)) = retired {
            live.finish().await;
        }
    });
}

fn remove_tree(dir: &Path) -> std::io::Result<()> {
    oleafly_core::atomic::retry_tree_operation(|| match std::fs::remove_dir_all(dir) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    })
}

fn remove_empty_parents(dir: &Path, levels: usize) {
    for parent in dir.ancestors().skip(1).take(levels) {
        if std::fs::remove_dir(parent).is_err() {
            return;
        }
    }
}

pub(crate) fn remove_folder_lock(folder: &Path) -> std::io::Result<()> {
    let lock = journal::folder_lock_path(folder);
    oleafly_core::atomic::retry_tree_operation(|| match std::fs::remove_file(&lock) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    })
}

fn linked_elsewhere(link: &OverleafLink, project_id: &str) -> bool {
    let Ok(projects) = crate::project::list_projects_blocking() else {
        return true;
    };
    projects
        .into_iter()
        .filter(|project| project.id != project_id)
        .any(|project| {
            crate::overleaf::overleaf_link_of(&project.id)
                .ok()
                .flatten()
                .is_some_and(|other| {
                    other.server == link.server && other.project_id == link.project_id
                })
        })
}

const SETTLE: Duration = Duration::from_millis(50);

pub(crate) enum Holding {
    Free,
    Ours,
    Elsewhere(Option<Holder>),
}

pub(crate) fn holding(data: &Path, link: &OverleafLink, folder: Option<&Path>) -> Holding {
    let probe = || match journal::holder(data, &link.server, &link.project_id) {
        Some(Holder {
            by: HolderKind::App,
            pid,
            ..
        }) if pid == std::process::id() => Holding::Ours,
        Some(holder) => Holding::Elsewhere(Some(holder)),
        None if folder.is_some_and(journal::live_in) => Holding::Elsewhere(None),
        None => Holding::Free,
    };
    match probe() {
        Holding::Elsewhere(None) => {
            std::thread::sleep(SETTLE);
            probe()
        }
        found => found,
    }
}

pub(crate) fn forget_overleaf_project(
    link: &OverleafLink,
    project_id: &str,
    folder: Option<&Path>,
) -> Result<(), String> {
    let data = crate::paths::oleafly_root()?;
    if let Holding::Elsewhere(holder) = holding(&data, link, folder) {
        let refused = JournalError::LiveElsewhere(holder).to_string();
        let _ = crate::project::append_app_log(format!(
            "Live editing kept what project {project_id} keeps for Overleaf: {refused}"
        ));
        return Err(refused);
    }
    let mut failed = Vec::new();
    match mirror_dir(&data, link, project_id) {
        Ok(mirror) => match remove_tree(&mirror) {
            Ok(()) => remove_empty_parents(&mirror, 2),
            Err(error) => failed.push(format!("{}: {error}", mirror.display())),
        },
        Err(error) => failed.push(error.to_string()),
    }
    if !linked_elsewhere(link, project_id) {
        match journal::journal_dir(&data, &link.server, &link.project_id) {
            Ok(journal) => match remove_tree(&journal) {
                Ok(()) => remove_empty_parents(&journal, 1),
                Err(error) => failed.push(format!("{}: {error}", journal.display())),
            },
            Err(error) => failed.push(error.to_string()),
        }
    }
    if let Some(folder) = folder {
        if let Err(error) = remove_folder_lock(folder) {
            failed.push(format!("the live lock in {}: {error}", folder.display()));
        }
    }
    if failed.is_empty() {
        return Ok(());
    }
    let failed = failed.join(", ");
    let _ = crate::project::append_app_log(format!(
        "Live editing could not remove what project {project_id} kept for Overleaf: {failed}"
    ));
    Err(failed)
}

pub(crate) enum Backend {
    Server,
    Overleaf(OverleafLink),
    Both,
}

pub(crate) fn live_backend_for(
    paths: &oleafly_collab::CollabPaths,
    project_id: &str,
    card_on: bool,
) -> Result<Option<Backend>, CollabError> {
    let shared = oleafly_collab::load_binding(paths, project_id)?.is_some();
    let link = crate::overleaf::overleaf_link_of(project_id).map_err(CollabError::Io)?;
    let claimed = match link {
        Some(link) if card_on || unsent_journal(&link)? => Some(link),
        Some(_) | None => None,
    };
    Ok(match (shared, claimed) {
        (true, Some(_)) => Some(Backend::Both),
        (true, None) => Some(Backend::Server),
        (false, Some(link)) => Some(Backend::Overleaf(link)),
        (false, None) => None,
    })
}

fn unsent_journal(link: &OverleafLink) -> Result<bool, CollabError> {
    let data = crate::paths::oleafly_root().map_err(CollabError::Io)?;
    Ok(journal::unsent_on(&data, &link.server, None)
        .iter()
        .any(|(project, _)| *project == link.project_id))
}

pub(crate) fn overleaf_linked() -> CollabError {
    CollabError::Api {
        status: 409,
        code: "overleaf_linked".to_owned(),
        message: "this project is linked to Overleaf".to_owned(),
    }
}

pub(crate) fn collab_shared() -> CollabError {
    CollabError::Api {
        status: 409,
        code: "collab_shared".to_owned(),
        message: "this project is shared on an Oleafly Server".to_owned(),
    }
}

pub(crate) fn git_sync_waits(project_id: &str) -> Result<bool, CollabError> {
    if let Some(super::session::Live::Overleaf(_)) = super::session::live_for(project_id) {
        return Ok(true);
    }
    let Some(link) = crate::overleaf::overleaf_link_of(project_id).map_err(CollabError::Io)? else {
        return Ok(false);
    };
    let data = crate::paths::oleafly_root().map_err(CollabError::Io)?;
    let folder = crate::paths::project_dir(project_id).ok();
    Ok(journal::stands_down(&data, &link.server, &link.project_id, folder.as_deref()).is_some())
}

pub(crate) fn refuse_overleaf_linked(
    paths: &oleafly_collab::CollabPaths,
    project_id: &str,
    card_on: bool,
) -> Result<(), CollabError> {
    let live = matches!(
        super::session::live_for(project_id),
        Some(super::session::Live::Overleaf(_))
    );
    match live_backend_for(paths, project_id, card_on || live)? {
        Some(Backend::Overleaf(_) | Backend::Both) => Err(overleaf_linked()),
        Some(Backend::Server) | None => Ok(()),
    }
}

impl OverleafLive {
    pub(crate) async fn start_with(
        parts: Parts,
        host: Arc<dyn LiveHost>,
    ) -> Result<Arc<OverleafLive>, CollabError> {
        let me = parts.config.session.user_id().to_owned();
        let owner = parts.link.user_id.clone();
        let (shared, mirror) = shared::OverleafLive::start_with(parts, move |core| {
            let mirror = Mirror {
                shared: Arc::clone(core),
                host,
                owner: OnceLock::new(),
                chat: chat::ChatMemory::default(),
                review: review::Memory::default(),
                history: history::HistoryWork::default(),
                settings: settings::SettingsSync::default(),
            };
            mirror.review.know_me(&me);
            if let Some(owner) = owner {
                let _ = mirror.owner.set(owner);
            }
            Arc::new(mirror)
        })
        .await?;
        mirror.settings.start(&mirror);
        Ok(Arc::new(OverleafLive { shared, mirror }))
    }

    pub(crate) async fn finish(&self) {
        self.mirror.settings.close();
        self.mirror.history.close();
        self.shared.finish().await;
        forget_live(&self.mirror.disk);
        crate::folder_watch::release_live(self.project_id());
    }

    pub(crate) async fn quit(&self, within: Duration) {
        self.mirror.settings.close();
        self.mirror.history.close();
        self.shared.quit(within).await;
        forget_live(&self.mirror.disk);
        crate::folder_watch::release_live(self.project_id());
    }

    pub(crate) fn info(&self) -> LiveInfo {
        LiveInfo {
            role: self
                .mirror
                .role()
                .map_or(ProjectRole::Viewer, |(role, _)| role),
            account_id: self.me.clone(),
            device_id: self.me.clone(),
        }
    }

    pub(crate) fn upload_list(&self) -> Vec<super::uploads::UploadFile> {
        self.session
            .tree_queue()
            .iter()
            .filter_map(|queued| port::upload_row(&self.mirror, queued))
            .collect()
    }

    pub(crate) fn retry_uploads(&self) {
        self.session.retry_tree(None);
    }

    pub(crate) fn dismiss_upload(&self, path: &str) {
        self.refresh_names();
        self.session.dismiss_tree(&self.mirror.engine_path(path));
    }

    pub(crate) fn reconnect_now(&self) {
        self.session.reconnect_now();
    }

    pub(crate) fn presence(&self, path: Option<&str>, cursor: Option<u32>) {
        let doc = path.and_then(|path| self.doc_at(path));
        let at = doc.zip(cursor.and_then(|cursor| usize::try_from(cursor).ok()));
        self.session.presence(at);
    }

    pub(crate) fn repeat_status(&self) {
        self.mirror.repeat_status();
        if let Some((role, tracking)) = self.mirror.role() {
            port::announce_role(&self.mirror, role, tracking);
        }
    }

    pub(crate) fn open(&self, path: &str, sink: DocSink) -> Option<DocOpened> {
        self.refresh_names();
        let doc = self.doc_at(path)?;
        let opened = self
            .session
            .open(&self.mirror.engine_path(path), Arc::clone(&sink))?;
        if opened.file_id != doc.0 {
            self.session
                .close(&DocId(opened.file_id.clone()), opened.session);
            return None;
        }
        guard(&self.mirror.sinks).insert(doc, (opened.session, sink));
        Some(opened)
    }

    pub(crate) fn change(
        &self,
        file_id: &str,
        rev: u64,
        op: TextOperation,
        origin: Option<Origin>,
    ) -> Result<(), CollabError> {
        let doc = DocId(file_id.to_owned());
        self.session
            .editor_change_from(&doc, rev, op, origin)
            .map_err(live_error)?;
        self.mirror.mark([file_id.to_owned()], false);
        self.mirror.typed(&doc);
        Ok(())
    }

    pub(crate) fn close(&self, file_id: &str, session: u64) {
        let doc = DocId(file_id.to_owned());
        self.session.close(&doc, session);
        let mut sinks = guard(&self.mirror.sinks);
        if sinks.get(&doc).is_some_and(|(open, _)| *open == session) {
            sinks.remove(&doc);
        }
    }

    pub(crate) async fn write_text(
        &self,
        path: &str,
        base: Option<&str>,
        text: &str,
    ) -> Result<WriteOutcome, CollabError> {
        let Some(doc) = self.doc_at(path) else {
            return Ok(WriteOutcome {
                handled: false,
                reason: None,
            });
        };
        let text = lf_text(text);
        match self.edit_toward(&doc, path, base, &text)? {
            Edit::Live => {}
            Edit::NotLive => {
                return Ok(WriteOutcome {
                    handled: false,
                    reason: None,
                })
            }
            Edit::ReadOnly => {
                return Ok(WriteOutcome {
                    handled: false,
                    reason: Some(super::write::READ_ONLY.to_owned()),
                })
            }
        }
        self.mirror.mark([doc.0], false);
        self.mirror.flush().await;
        Ok(WriteOutcome {
            handled: true,
            reason: None,
        })
    }
}
