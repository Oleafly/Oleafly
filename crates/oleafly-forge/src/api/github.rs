//! GitHub and GitHub Enterprise Server (`/api/v3`).
use super::{header_text, next_page_from_link, ForgeRepo, ForgeUser, RepoInfo, RepoPage, Session};
use crate::http;
use crate::repo_path::RepoPath;
use crate::{ForgeError, ForgeKind};
use serde::Deserialize;

pub(super) const ACCEPT: &str = "application/vnd.github+json";
pub(super) const HEADERS: &[(&str, &str)] = &[("x-github-api-version", "2022-11-28")];

#[derive(Deserialize)]
struct User {
    login: String,
    #[serde(default)]
    name: Option<String>,
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
}

#[derive(Deserialize)]
struct Branch {
    commit: BranchCommit,
}

#[derive(Deserialize)]
struct BranchCommit {
    sha: String,
}

fn row(session: &Session<'_>, repo: Repo) -> Option<ForgeRepo> {
    ForgeRepo::from_path(
        ForgeKind::GitHub,
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

/// The user, and the token's scopes from `X-OAuth-Scopes` when GitHub sends
/// it (classic tokens; fine-grained tokens have none).
pub(super) async fn current_user(
    session: &Session<'_>,
) -> Result<(ForgeUser, Option<Vec<String>>), ForgeError> {
    let response = session
        .http
        .send(session.get(session.endpoint(&["user"])?))
        .await?;
    let scopes = header_text(&response, "x-oauth-scopes").map(|value| {
        value
            .split(',')
            .map(|scope| scope.trim().to_string())
            .filter(|scope| !scope.is_empty())
            .collect()
    });
    let user: User = http::read_json(response, &session.secrets(), session.scopes()).await?;
    Ok((
        ForgeUser {
            login: user.login,
            name: user.name,
            avatar_url: user.avatar_url,
        },
        scopes,
    ))
}

pub(super) async fn list_repos(session: &Session<'_>, page: u32) -> Result<RepoPage, ForgeError> {
    let mut url = session.endpoint(&["user", "repos"])?;
    url.query_pairs_mut()
        .append_pair("per_page", "100")
        .append_pair("page", &page.to_string())
        .append_pair("sort", "updated")
        .append_pair("affiliation", "owner,collaborator,organization_member");
    let response = session.http.send(session.get(url)).await?;
    let next_page = header_text(&response, "link").and_then(|link| next_page_from_link(&link));
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
    if response.status().as_u16() == 422 {
        let body = http::read_limited(response, 64 * 1024)
            .await
            .unwrap_or_default();
        let text = String::from_utf8_lossy(&body);
        if text.contains("already exists") {
            return Err(ForgeError::Conflict);
        }
        return Err(ForgeError::Server {
            status: 422,
            detail: http::scrub(&http::body_message(&text), &session.secrets()),
        });
    }
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
        empty: false,
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
    Ok(found.commit.sha)
}

pub(super) fn archive_url(
    session: &Session<'_>,
    repo: &RepoPath,
    commit: &str,
) -> Result<url::Url, ForgeError> {
    let [owner, name] = owner_repo(repo);
    session.endpoint(&["repos", owner, name, "zipball", commit])
}
