//! GitLab (`/api/v4`), gitlab.com or self-managed, including nested groups.
//! A project id is its full path as one percent-encoded segment.
use super::{header_text, ForgeRepo, ForgeUser, RepoInfo, RepoPage, Session};
use crate::http;
use crate::repo_path::RepoPath;
use crate::{ForgeError, ForgeKind};
use serde::Deserialize;

#[derive(Deserialize)]
struct User {
    username: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    avatar_url: Option<String>,
}

#[derive(Deserialize)]
struct Project {
    id: u64,
    path_with_namespace: String,
    #[serde(default)]
    visibility: Option<String>,
    #[serde(default)]
    default_branch: Option<String>,
    #[serde(default)]
    empty_repo: bool,
}

#[derive(Deserialize)]
struct TokenSelf {
    #[serde(default)]
    scopes: Vec<String>,
}

#[derive(Deserialize)]
struct Branch {
    commit: BranchCommit,
}

#[derive(Deserialize)]
struct BranchCommit {
    id: String,
}

fn row(session: &Session<'_>, project: Project) -> Option<ForgeRepo> {
    let private = project.visibility.as_deref() != Some("public");
    ForgeRepo::from_path(
        ForgeKind::GitLab,
        session.base,
        project.id,
        &project.path_with_namespace,
        private,
        project.default_branch,
    )
}

pub(super) async fn current_user(session: &Session<'_>) -> Result<ForgeUser, ForgeError> {
    let response = session
        .http
        .send(session.get(session.endpoint(&["user"])?))
        .await?;
    let user: User = http::read_json(response, &session.secrets(), session.scopes()).await?;
    Ok(ForgeUser {
        login: user.username,
        name: user.name,
        avatar_url: user.avatar_url,
    })
}

/// A personal access token's scopes. OAuth tokens and older servers have no
/// such endpoint, which reads as "unknown".
pub(super) async fn token_scopes(session: &Session<'_>) -> Option<Vec<String>> {
    let url = session.endpoint(&["personal_access_tokens", "self"]).ok()?;
    let response = session.http.send(session.get(url)).await.ok()?;
    let found: TokenSelf = http::read_json(response, &session.secrets(), session.scopes())
        .await
        .ok()?;
    Some(found.scopes)
}

pub(super) async fn list_repos(
    session: &Session<'_>,
    page: u32,
    query: Option<&str>,
) -> Result<RepoPage, ForgeError> {
    let mut url = session.endpoint(&["projects"])?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs
            .append_pair("membership", "true")
            .append_pair("order_by", "last_activity_at")
            .append_pair("sort", "desc")
            .append_pair("per_page", "100")
            .append_pair("page", &page.to_string());
        if let Some(query) = query.map(str::trim).filter(|query| !query.is_empty()) {
            pairs.append_pair("search", query);
        }
    }
    let response = session.http.send(session.get(url)).await?;
    let next_page = header_text(&response, "x-next-page").and_then(|value| value.parse().ok());
    let projects: Vec<Project> =
        http::read_json(response, &session.secrets(), session.scopes()).await?;
    Ok(RepoPage {
        repos: projects
            .into_iter()
            .filter_map(|project| row(session, project))
            .collect(),
        next_page,
        searched: true,
    })
}

pub(super) async fn create_repo(
    session: &Session<'_>,
    name: &str,
    private: bool,
) -> Result<ForgeRepo, ForgeError> {
    let call = session.post_json(
        session.endpoint(&["projects"])?,
        serde_json::json!({
            "name": name,
            "path": name,
            "visibility": if private { "private" } else { "public" },
            "initialize_with_readme": false,
        }),
    );
    let response = session.http.send(call).await?;
    if response.status().as_u16() == 400 {
        let body = http::read_limited(response, 64 * 1024)
            .await
            .unwrap_or_default();
        let text = String::from_utf8_lossy(&body);
        if text.contains("has already been taken") {
            return Err(ForgeError::Conflict);
        }
        return Err(ForgeError::Server {
            status: 400,
            detail: http::scrub(&http::body_message(&text), &session.secrets()),
        });
    }
    let project: Project = http::read_json(response, &session.secrets(), session.scopes()).await?;
    row(session, project).ok_or(ForgeError::InvalidResponse {
        detail: "the server named the new repository oddly".into(),
    })
}

pub(super) async fn repo_info(
    session: &Session<'_>,
    repo: &RepoPath,
) -> Result<RepoInfo, ForgeError> {
    let id = repo.full_name();
    let response = session
        .http
        .send(session.get(session.endpoint(&["projects", &id])?))
        .await?;
    let project: Project = http::read_json(response, &session.secrets(), session.scopes()).await?;
    Ok(RepoInfo {
        default_branch: project.default_branch,
        empty: project.empty_repo,
    })
}

pub(super) async fn branch_commit(
    session: &Session<'_>,
    repo: &RepoPath,
    branch: &str,
) -> Result<String, ForgeError> {
    let id = repo.full_name();
    let url = session.endpoint(&["projects", &id, "repository", "branches", branch])?;
    let response = session.http.send(session.get(url)).await?;
    let found: Branch = http::read_json(response, &session.secrets(), session.scopes()).await?;
    Ok(found.commit.id)
}

pub(super) fn archive_url(
    session: &Session<'_>,
    repo: &RepoPath,
    commit: &str,
) -> Result<url::Url, ForgeError> {
    let id = repo.full_name();
    let mut url = session.endpoint(&["projects", &id, "repository", "archive.zip"])?;
    url.query_pairs_mut().append_pair("sha", commit);
    Ok(url)
}
