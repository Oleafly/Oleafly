//! Gitea, Forgejo and Codeberg (`/api/v1`). Tokens go in `Authorization:
//! token …`.
use super::{header_text, next_page_from_link, ForgeRepo, ForgeUser, RepoInfo, RepoPage, Session};
use crate::http;
use crate::repo_path::RepoPath;
use crate::{ForgeError, ForgeKind};
use serde::Deserialize;

const PAGE_SIZE: u32 = 50;

#[derive(Deserialize)]
struct User {
    login: String,
    #[serde(default)]
    full_name: Option<String>,
    #[serde(default)]
    avatar_url: Option<String>,
}

#[derive(Deserialize)]
struct Repo {
    id: u64,
    full_name: String,
    #[serde(default)]
    private: bool,
    #[serde(default)]
    default_branch: Option<String>,
    #[serde(default)]
    empty: bool,
}

#[derive(Deserialize)]
struct Branch {
    commit: BranchCommit,
}

#[derive(Deserialize)]
struct BranchCommit {
    id: String,
}

fn row(session: &Session<'_>, repo: Repo) -> Option<ForgeRepo> {
    ForgeRepo::from_path(
        ForgeKind::Gitea,
        session.base,
        repo.id,
        &repo.full_name,
        repo.private,
        repo.default_branch,
    )
}

fn owner_repo(repo: &RepoPath) -> [&str; 2] {
    let segments = repo.segments();
    [segments[0].as_str(), segments[1].as_str()]
}

pub(super) async fn current_user(session: &Session<'_>) -> Result<ForgeUser, ForgeError> {
    let response = session
        .http
        .send(session.get(session.endpoint(&["user"])?))
        .await?;
    let user: User = http::read_json(response, &session.secrets(), session.scopes()).await?;
    Ok(ForgeUser {
        login: user.login,
        name: user.full_name,
        avatar_url: user.avatar_url,
    })
}

pub(super) async fn list_repos(session: &Session<'_>, page: u32) -> Result<RepoPage, ForgeError> {
    let mut url = session.endpoint(&["user", "repos"])?;
    url.query_pairs_mut()
        .append_pair("page", &page.to_string())
        .append_pair("limit", &PAGE_SIZE.to_string());
    let response = session.http.send(session.get(url)).await?;
    let total = header_text(&response, "x-total-count").and_then(|value| value.parse::<u64>().ok());
    // The server says whether another page follows. A server that caps the
    // page size below `limit` (`MAX_RESPONSE_ITEMS`) makes a count taken
    // against `PAGE_SIZE` stop early, so the count is only the fallback for
    // a reply without a `Link` header.
    let next_page = match header_text(&response, "link") {
        Some(link) => next_page_from_link(&link),
        None => match total {
            Some(total) if total > u64::from(page) * u64::from(PAGE_SIZE) => Some(page + 1),
            _ => None,
        },
    };
    let repos: Vec<Repo> = http::read_json(response, &session.secrets(), session.scopes()).await?;
    Ok(RepoPage {
        repos: repos
            .into_iter()
            .filter_map(|repo| row(session, repo))
            .collect(),
        next_page,
        searched: false,
    })
}

pub(super) async fn create_repo(
    session: &Session<'_>,
    name: &str,
    private: bool,
) -> Result<ForgeRepo, ForgeError> {
    let call = session.post_json(
        session.endpoint(&["user", "repos"])?,
        serde_json::json!({ "name": name, "private": private, "auto_init": false }),
    );
    let response = session.http.send(call).await?;
    let repo: Repo = http::read_json(response, &session.secrets(), session.scopes()).await?;
    row(session, repo).ok_or(ForgeError::InvalidResponse {
        detail: "the server named the new repository oddly".into(),
    })
}

pub(super) async fn repo_info(
    session: &Session<'_>,
    repo: &RepoPath,
) -> Result<RepoInfo, ForgeError> {
    let [owner, name] = owner_repo(repo);
    let response = session
        .http
        .send(session.get(session.endpoint(&["repos", owner, name])?))
        .await?;
    let found: Repo = http::read_json(response, &session.secrets(), session.scopes()).await?;
    Ok(RepoInfo {
        default_branch: found.default_branch,
        empty: found.empty,
    })
}

pub(super) async fn branch_commit(
    session: &Session<'_>,
    repo: &RepoPath,
    branch: &str,
) -> Result<String, ForgeError> {
    let [owner, name] = owner_repo(repo);
    let mut segments = vec!["repos", owner, name, "branches"];
    segments.extend(branch.split('/'));
    let response = session
        .http
        .send(session.get(session.endpoint(&segments)?))
        .await?;
    let found: Branch = http::read_json(response, &session.secrets(), session.scopes()).await?;
    Ok(found.commit.id)
}

pub(super) fn archive_url(
    session: &Session<'_>,
    repo: &RepoPath,
    commit: &str,
) -> Result<url::Url, ForgeError> {
    let [owner, name] = owner_repo(repo);
    let archive = format!("{commit}.zip");
    session.endpoint(&["repos", owner, name, "archive", &archive])
}
