use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Arc, Weak};
use std::time::Duration;

use oleafly_online::live::journal;
use oleafly_online::session::{Session, SessionHandle};

use super::{off_runtime, Mirror, OverleafLive};
use crate::collab::live::lifecycle::stop;
use crate::collab::live::session::{guard, links_changed, starting_on, Live, ACTIVE};
use crate::collab::live::unsent::named;
use crate::collab::live::UnsentProject;

impl OverleafLive {
    pub(crate) fn account(&self) -> String {
        self.session.account().user_id
    }

    pub(crate) fn owner(&self) -> Option<&str> {
        self.mirror.owner.get().map(String::as_str)
    }
}

pub(super) fn record_owner(mirror: &Mirror) {
    if mirror.owner.get().is_some() {
        return;
    }
    let Some(session) = mirror.session.get().and_then(Weak::upgrade) else {
        return;
    };
    let project_id = &mirror.disk.project_id;
    let account = session.account();
    let recorded = crate::overleaf::overleaf_link_of(project_id).and_then(|link| match link {
        Some(link) if link.user_id.is_none() => crate::overleaf::record_linked_account(
            project_id,
            &link,
            &account.user_id,
            &account.email,
        ),
        _ => Ok(false),
    });
    match recorded {
        Ok(true) => {
            let _ = mirror.owner.set(account.user_id);
        }
        Ok(false) => {}
        Err(error) => {
            let _ = crate::project::append_app_log(format!(
                "Could not record which Overleaf account project {project_id} uses: {error}"
            ));
        }
    }
}

pub(crate) fn overleaf_live_on(server: &str, user: Option<&str>) -> Option<Arc<OverleafLive>> {
    guard(&ACTIVE)
        .as_ref()
        .and_then(Live::overleaf)
        .filter(|live| live.link.server == server)
        .filter(|live| user.is_none_or(|user| live.account() == user))
        .cloned()
}

pub(crate) fn overleaf_signed_in(base: &str, session: &Session) -> Result<(), String> {
    let Some(live) = overleaf_live_on(base, None) else {
        return Ok(());
    };
    if live.owner().is_some_and(|owner| owner != session.user_id) {
        return Ok(());
    }
    let store = crate::secrets::store()?;
    live.session
        .signed_in(SessionHandle::new(base, session.clone(), Some(store)));
    Ok(())
}

fn with_paths(project_id: String, paths: Vec<String>) -> Option<UnsentProject> {
    if paths.is_empty() {
        return None;
    }
    let changes = paths.len() as u64;
    named(project_id, changes).map(|project| UnsentProject { paths, ..project })
}

fn stored_unsent(
    data: &Path,
    base: &str,
    user: Option<&str>,
    live: Option<&str>,
) -> Vec<UnsentProject> {
    let mut remote: BTreeMap<String, Vec<String>> = journal::unsent_on(data, base, user)
        .into_iter()
        .filter(|(project, _)| Some(project.as_str()) != live)
        .collect();
    if remote.is_empty() {
        return Vec::new();
    }
    crate::project::list_projects_blocking()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|project| {
            let link = crate::overleaf::overleaf_link_of(&project.id).ok()??;
            if link.server != base
                || user.is_some_and(|user| link.user_id.as_deref().is_some_and(|own| own != user))
            {
                return None;
            }
            with_paths(project.id, remote.remove(&link.project_id)?)
        })
        .collect()
}

pub(crate) async fn overleaf_unsent(
    base: &str,
    user: Option<&str>,
    wait: Duration,
) -> Result<Vec<UnsentProject>, String> {
    let live = overleaf_live_on(base, user);
    let mut unsent = Vec::new();
    if let Some(live) = &live {
        let paths = live
            .session
            .unsent(wait)
            .await
            .into_iter()
            .map(|doc| doc.path)
            .collect();
        unsent.extend(with_paths(live.project_id().to_owned(), paths));
    }
    let data = crate::paths::oleafly_root()?;
    let (base, user) = (base.to_owned(), user.map(str::to_owned));
    let remote = live.map(|live| live.link.project_id.clone());
    let stored =
        off_runtime(move || stored_unsent(&data, &base, user.as_deref(), remote.as_deref()))
            .await?;
    unsent.extend(stored);
    Ok(unsent)
}

pub(crate) async fn overleaf_stop_live(base: &str, user: Option<&str>) {
    let live = overleaf_live_on(base, user).map(|live| live.project_id().to_owned());
    for project_id in live.into_iter().chain(starting_on(base, user)) {
        stop(&project_id).await;
    }
}

pub(crate) async fn overleaf_signed_out(base: &str, user: Option<&str>) {
    links_changed();
    overleaf_stop_live(base, user).await;
}
