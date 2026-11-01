mod gitea;
mod github;
mod gitlab;

use crate::http::{self, Call, Credential, ForgeHttp};
use crate::repo_path::RepoPath;
use crate::{ForgeError, ForgeKind};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::time::Duration;

pub const ARCHIVE_MAX_BYTES: usize = 256 * 1024 * 1024;
const ARCHIVE_TIMEOUT: Duration = Duration::from_secs(30 * 60);

pub struct Session<'a> {
    pub http: &'a ForgeHttp,
    pub kind: ForgeKind,
    pub base: &'a str,
    pub token: &'a str,
}

impl std::fmt::Debug for Session<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Session")
            .field("kind", &self.kind)
            .field("base", &self.base)
            .field("token", &"[redacted]")
            .finish()
    }
}

impl<'a> Session<'a> {
    fn credential(&self) -> Credential<'a> {
        match self.kind {
            ForgeKind::Gitea => Credential::Token(self.token),
            ForgeKind::GitHub | ForgeKind::GitLab => Credential::Bearer(self.token),
        }
    }

    fn secrets(&self) -> [&'a str; 1] {
        [self.token]
    }

    fn scopes(&self) -> &'static str {
        self.kind.scopes_hint()
    }

    fn endpoint(&self, segments: &[&str]) -> Result<url::Url, ForgeError> {
        let mut url = self.kind.api_root(self.base)?;
        {
            let mut path = url
                .path_segments_mut()
                .map_err(|_| ForgeError::InvalidBaseUrl {
                    input: self.base.to_string(),
                })?;
            path.pop_if_empty();
            path.extend(segments);
        }
        Ok(url)
    }

    fn get(&self, url: url::Url) -> Call<'a> {
        let call = Call::get(url, Some(self.credential()));
        match self.kind {
            ForgeKind::GitHub => call.accept(github::ACCEPT).headers(github::HEADERS),
            _ => call,
        }
    }

    fn post_json(&self, url: url::Url, body: serde_json::Value) -> Call<'a> {
        let call = Call::post(url, Some(self.credential()), http::CallBody::Json(body));
        match self.kind {
            ForgeKind::GitHub => call.accept(github::ACCEPT).headers(github::HEADERS),
            _ => call,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeUser {
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeRepo {
    pub id: String,
    pub full_name: String,
    pub name: String,
    pub web_url: String,
    pub clone_url: String,
    pub private: bool,
    pub default_branch: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoPage {
    pub repos: Vec<ForgeRepo>,
    pub next_page: Option<u32>,
    pub searched: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RepoInfo {
    pub default_branch: Option<String>,
    pub empty: bool,
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

impl ForgeRepo {
    fn from_path(
        kind: ForgeKind,
        base: &str,
        id: u64,
        full_name: &str,
        private: bool,
        default_branch: Option<String>,
    ) -> Option<ForgeRepo> {
        let path = RepoPath::parse(kind, full_name).ok()?;
        let full_name = path.full_name();
        Some(ForgeRepo {
            id: id.to_string(),
            name: path.name().to_string(),
            web_url: crate::address::web_url(base, &full_name),
            clone_url: crate::address::clone_url(base, &full_name),
            full_name,
            private,
            default_branch: non_empty(default_branch),
        })
    }
}

pub async fn current_user(session: &Session<'_>) -> Result<ForgeUser, ForgeError> {
    let user = match session.kind {
        ForgeKind::GitHub => github::current_user(session).await?.0,
        ForgeKind::GitLab => gitlab::current_user(session).await?,
        ForgeKind::Gitea => gitea::current_user(session).await?,
    };
    Ok(ForgeUser {
        login: user.login.trim().to_string(),
        name: non_empty(user.name),
        avatar_url: non_empty(user.avatar_url),
    })
}

pub async fn token_scopes(session: &Session<'_>) -> Result<Option<Vec<String>>, ForgeError> {
    match session.kind {
        ForgeKind::GitHub => Ok(github::current_user(session).await?.1),
        ForgeKind::GitLab => Ok(gitlab::token_scopes(session).await),
        ForgeKind::Gitea => Ok(None),
    }
}

/// One page of the repositories the account can push to. `query` is sent
/// only to GitLab, which searches on the server.
pub async fn list_repos(
    session: &Session<'_>,
    page: u32,
    query: Option<&str>,
) -> Result<RepoPage, ForgeError> {
    let page = page.max(1);
    match session.kind {
        ForgeKind::GitHub => github::list_repos(session, page).await,
        ForgeKind::GitLab => gitlab::list_repos(session, page, query).await,
        ForgeKind::Gitea => gitea::list_repos(session, page).await,
    }
}

pub async fn create_repo(
    session: &Session<'_>,
    name: &str,
    private: bool,
) -> Result<ForgeRepo, ForgeError> {
    if !crate::repo_path::valid_repo_name(name) {
        return Err(ForgeError::InvalidRepositoryName);
    }
    match session.kind {
        ForgeKind::GitHub => github::create_repo(session, name, private).await,
        ForgeKind::GitLab => gitlab::create_repo(session, name, private).await,
        ForgeKind::Gitea => gitea::create_repo(session, name, private).await,
    }
}

pub async fn repo_info(session: &Session<'_>, repo: &RepoPath) -> Result<RepoInfo, ForgeError> {
    let info = match session.kind {
        ForgeKind::GitHub => github::repo_info(session, repo).await?,
        ForgeKind::GitLab => gitlab::repo_info(session, repo).await?,
        ForgeKind::Gitea => gitea::repo_info(session, repo).await?,
    };
    Ok(RepoInfo {
        default_branch: non_empty(info.default_branch),
        empty: info.empty,
    })
}

pub async fn branch_commit(
    session: &Session<'_>,
    repo: &RepoPath,
    branch: &str,
) -> Result<String, ForgeError> {
    if !valid_branch(branch) {
        return Err(ForgeError::InvalidResponse {
            detail: "the server named an invalid branch".into(),
        });
    }
    let result = match session.kind {
        ForgeKind::GitHub => github::branch_commit(session, repo, branch).await,
        ForgeKind::GitLab => gitlab::branch_commit(session, repo, branch).await,
        ForgeKind::Gitea => gitea::branch_commit(session, repo, branch).await,
    };
    let commit = match result {
        Ok(commit) => commit,
        Err(ForgeError::NotFound | ForgeError::Conflict) => {
            return Err(ForgeError::RepositoryEmpty)
        }
        Err(error) => return Err(error),
    };
    if !valid_commit(&commit) {
        return Err(ForgeError::InvalidResponse {
            detail: "the server named an invalid commit".into(),
        });
    }
    Ok(commit)
}

pub async fn download_archive(
    session: &Session<'_>,
    repo: &RepoPath,
    commit: &str,
    max_bytes: usize,
) -> Result<Vec<u8>, ForgeError> {
    if !valid_commit(commit) {
        return Err(ForgeError::InvalidResponse {
            detail: "an invalid commit".into(),
        });
    }
    let url = match session.kind {
        ForgeKind::GitHub => github::archive_url(session, repo, commit)?,
        ForgeKind::GitLab => gitlab::archive_url(session, repo, commit)?,
        ForgeKind::Gitea => gitea::archive_url(session, repo, commit)?,
    };
    let call = session
        .get(url)
        .accept("application/zip, application/octet-stream, */*")
        .timeout(ARCHIVE_TIMEOUT);
    let response = session.http.send(call).await?;
    let response = http::ensure_success(response, &session.secrets(), session.scopes()).await?;
    let too_large = ForgeError::TooLarge {
        limit_mb: (max_bytes / (1024 * 1024)) as u64,
    };
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(too_large);
    }
    let mut archive = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(http::map_transport_error)?;
        if archive.len().saturating_add(chunk.len()) > max_bytes {
            return Err(too_large);
        }
        archive.extend_from_slice(&chunk);
    }
    if archive.len() < 4 || &archive[..2] != b"PK" {
        return Err(ForgeError::InvalidResponse {
            detail: "the server did not send a ZIP archive".into(),
        });
    }
    Ok(archive)
}

pub fn valid_commit(commit: &str) -> bool {
    matches!(commit.len(), 40 | 64)
        && commit
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// A branch name Git would accept (`git check-ref-format --branch` rules
/// that matter before the name reaches a URL).
pub fn valid_branch(branch: &str) -> bool {
    !branch.is_empty()
        && branch.len() <= 255
        && !branch.starts_with('/')
        && !branch.ends_with('/')
        && !branch.ends_with('.')
        && !branch.contains("..")
        && !branch.contains("//")
        && !branch.contains("@{")
        && branch != "@"
        && branch
            .split('/')
            .all(|part| !part.starts_with('.') && !part.ends_with(".lock"))
        && branch.chars().all(|character| {
            !character.is_control()
                && !matches!(character, ' ' | '~' | '^' | ':' | '?' | '*' | '[' | '\\')
        })
}

fn next_page_from_link(header: &str) -> Option<u32> {
    header.split(',').find_map(|link| {
        let (target, params) = link.split_once(';')?;
        let is_next = params
            .split(';')
            .any(|param| param.trim().replace(' ', "") == "rel=\"next\"");
        if !is_next {
            return None;
        }
        let target = target.trim().trim_start_matches('<').trim_end_matches('>');
        url::Url::parse(target)
            .ok()?
            .query_pairs()
            .find(|(name, _)| name == "page")
            .and_then(|(_, value)| value.parse::<u32>().ok())
    })
}

fn header_text(response: &reqwest::Response, name: &str) -> Option<String> {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
}

#[cfg(test)]
mod tests;
