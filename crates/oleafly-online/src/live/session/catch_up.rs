use std::collections::BTreeSet;

use crate::live::rest::{within, HistoryError, HistoryUpdate, ProjectRest, HISTORY_DEADLINE};
use crate::session::SessionHandle;

const PAGE: usize = 100;
const MAX_PAGES: usize = 20;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct History {
    pub latest: Option<u64>,
    pub changed: Option<BTreeSet<String>>,
}

async fn updates(
    rest: &ProjectRest,
    session: &SessionHandle,
    since: u64,
) -> Option<Vec<HistoryUpdate>> {
    let mut found = Vec::new();
    let mut before: Option<u64> = None;
    for _ in 0..MAX_PAGES {
        let page = within(
            HISTORY_DEADLINE,
            HistoryError::TimedOut,
            rest.updates(session, before, PAGE),
        )
        .await
        .ok()?;
        let reached = page.updates.iter().any(|update| update.from <= since);
        found.extend(page.updates.into_iter().filter(|update| update.to > since));
        before = page.next_before;
        if reached || before.is_none() {
            return Some(found);
        }
    }
    None
}

async fn changed_paths(
    rest: &ProjectRest,
    session: &SessionHandle,
    from: u64,
    to: u64,
) -> Option<BTreeSet<String>> {
    let diff = within(
        HISTORY_DEADLINE,
        HistoryError::TimedOut,
        rest.tree_diff(session, from, to),
    )
    .await
    .ok()?;
    Some(
        diff.into_iter()
            .filter(|entry| entry.op.is_some())
            .map(|entry| entry.path)
            .collect(),
    )
}

pub(super) async fn since(
    rest: &ProjectRest,
    session: &SessionHandle,
    version: Option<u64>,
) -> History {
    let Some(version) = version else {
        return History {
            latest: latest(rest, session).await,
            changed: None,
        };
    };
    let Some(found) = updates(rest, session, version).await else {
        return History::default();
    };
    let latest = found
        .iter()
        .map(|update| update.to)
        .max()
        .unwrap_or(version);
    if latest <= version {
        return History {
            latest: Some(latest),
            changed: Some(BTreeSet::new()),
        };
    }
    History {
        latest: Some(latest),
        changed: changed_paths(rest, session, version, latest).await,
    }
}

pub(super) async fn latest(rest: &ProjectRest, session: &SessionHandle) -> Option<u64> {
    let page = within(
        HISTORY_DEADLINE,
        HistoryError::TimedOut,
        rest.updates(session, None, 1),
    )
    .await
    .ok()?;
    Some(
        page.updates
            .iter()
            .map(|update| update.to)
            .max()
            .unwrap_or(0),
    )
}

pub(super) async fn changed_between(
    rest: &ProjectRest,
    session: &SessionHandle,
    after_ms: u64,
    before_ms: u64,
) -> Option<BTreeSet<String>> {
    let page = within(
        HISTORY_DEADLINE,
        HistoryError::TimedOut,
        rest.updates(session, None, PAGE),
    )
    .await
    .ok()?;
    let window =
        i64::try_from(after_ms).unwrap_or(i64::MAX)..=i64::try_from(before_ms).unwrap_or(i64::MAX);
    let recent: Vec<&HistoryUpdate> = page
        .updates
        .iter()
        .filter(|update| window.contains(&update.start_ms))
        .collect();
    let from = recent.iter().map(|update| update.from).min()?;
    let to = recent.iter().map(|update| update.to).max()?;
    changed_paths(rest, session, from, to).await
}
