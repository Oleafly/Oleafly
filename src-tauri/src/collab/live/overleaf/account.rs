use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use oleafly_online::live::journal;
use oleafly_online::session::{Session, SessionHandle};

use super::OverleafLive;
use crate::collab::live::lifecycle::stop;
use crate::collab::live::session::{guard, Live, ACTIVE};
use crate::collab::live::unsent::named;
use crate::collab::live::UnsentProject;

pub(crate) fn overleaf_live_on(server: &str) -> Option<Arc<OverleafLive>> {
    guard(&ACTIVE)
        .as_ref()
        .and_then(Live::overleaf)
        .filter(|live| live.link.server == server)
        .cloned()
}

pub(crate) fn overleaf_signed_in(base: &str, session: &Session) -> Result<(), String> {
    let Some(live) = overleaf_live_on(base) else {
        return Ok(());
    };
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

fn stored_unsent(data: &Path, base: &str, live: Option<&str>) -> Vec<UnsentProject> {
    let mut remote: BTreeMap<String, Vec<String>> = journal::unsent_on(data, base)
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
            if link.server != base {
                return None;
            }
            with_paths(project.id, remote.remove(&link.project_id)?)
        })
        .collect()
}

pub(crate) async fn overleaf_unsent(
    base: &str,
    wait: Duration,
) -> Result<Vec<UnsentProject>, String> {
    let live = overleaf_live_on(base);
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
    let base = base.to_owned();
    let remote = live.map(|live| live.link.project_id.clone());
    let stored = tauri::async_runtime::spawn_blocking(move || {
        stored_unsent(&data, &base, remote.as_deref())
    })
    .await
    .map_err(|error| error.to_string())?;
    unsent.extend(stored);
    Ok(unsent)
}

pub(crate) async fn overleaf_stop_live(base: &str) {
    let Some(project_id) = overleaf_live_on(base).map(|live| live.project_id().to_owned()) else {
        return;
    };
    stop(&project_id).await;
}
