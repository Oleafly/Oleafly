use std::collections::BTreeSet;

use reqwest::header::ACCEPT;
use serde_json::Value;

use crate::client::Http;
use crate::session::SessionHandle;

const PAGE: usize = 100;
const MAX_PAGES: usize = 20;

#[derive(Clone, Debug, PartialEq, Eq)]
struct Update {
    from: u64,
    to: u64,
    started_ms: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct History {
    pub latest: Option<u64>,
    pub changed: Option<BTreeSet<String>>,
}

async fn get_json(http: &Http, session: &SessionHandle, path: &str) -> Option<Value> {
    let response = http
        .send_public(
            http.get(path, &session.cookie())
                .header(ACCEPT, "application/json"),
        )
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json().await.ok()
}

fn update_of(value: &Value) -> Option<Update> {
    Some(Update {
        from: value.get("fromV")?.as_u64()?,
        to: value.get("toV")?.as_u64()?,
        started_ms: value
            .pointer("/meta/start_ts")
            .and_then(Value::as_u64)
            .unwrap_or_default(),
    })
}

async fn updates(
    http: &Http,
    session: &SessionHandle,
    project_id: &str,
    since: u64,
) -> Option<Vec<Update>> {
    let mut found = Vec::new();
    let mut before: Option<u64> = None;
    for _ in 0..MAX_PAGES {
        let mut path = format!("/project/{project_id}/updates?min_count={PAGE}");
        if let Some(before) = before {
            path.push_str(&format!("&before={before}"));
        }
        let page = get_json(http, session, &path).await?;
        let listed: Vec<Update> = page
            .get("updates")
            .and_then(Value::as_array)?
            .iter()
            .filter_map(update_of)
            .collect();
        let reached = listed.iter().any(|update| update.from <= since);
        found.extend(listed.into_iter().filter(|update| update.to > since));
        before = page.get("nextBeforeTimestamp").and_then(Value::as_u64);
        if reached || before.is_none() {
            return Some(found);
        }
    }
    None
}

async fn changed_paths(
    http: &Http,
    session: &SessionHandle,
    project_id: &str,
    from: u64,
    to: u64,
) -> Option<BTreeSet<String>> {
    let path = format!("/project/{project_id}/filetree/diff?from={from}&to={to}");
    let diff = get_json(http, session, &path).await?;
    Some(
        diff.get("diff")
            .and_then(Value::as_array)?
            .iter()
            .filter(|entry| entry.get("operation").is_some())
            .filter_map(|entry| entry.get("pathname").and_then(Value::as_str))
            .map(str::to_string)
            .collect(),
    )
}

pub(super) async fn since(
    http: &Http,
    session: &SessionHandle,
    project_id: &str,
    version: Option<u64>,
) -> History {
    let Some(version) = version else {
        return History {
            latest: latest(http, session, project_id).await,
            changed: None,
        };
    };
    let Some(found) = updates(http, session, project_id, version).await else {
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
        changed: changed_paths(http, session, project_id, version, latest).await,
    }
}

pub(super) async fn latest(http: &Http, session: &SessionHandle, project_id: &str) -> Option<u64> {
    let path = format!("/project/{project_id}/updates?min_count=1");
    let page = get_json(http, session, &path).await?;
    Some(
        page.get("updates")
            .and_then(Value::as_array)?
            .iter()
            .filter_map(update_of)
            .map(|update| update.to)
            .max()
            .unwrap_or(0),
    )
}

pub(super) async fn changed_between(
    http: &Http,
    session: &SessionHandle,
    project_id: &str,
    after_ms: u64,
    before_ms: u64,
) -> Option<BTreeSet<String>> {
    let path = format!("/project/{project_id}/updates?min_count={PAGE}");
    let page = get_json(http, session, &path).await?;
    let recent: Vec<Update> = page
        .get("updates")
        .and_then(Value::as_array)?
        .iter()
        .filter_map(update_of)
        .filter(|update| (after_ms..=before_ms).contains(&update.started_ms))
        .collect();
    let from = recent.iter().map(|update| update.from).min()?;
    let to = recent.iter().map(|update| update.to).max()?;
    changed_paths(http, session, project_id, from, to).await
}
