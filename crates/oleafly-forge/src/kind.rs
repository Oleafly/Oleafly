//! Server kinds, the hosted presets, API roots and the user name Git sends
//! with a token.
use crate::ForgeError;
use serde::{Deserialize, Serialize};

pub const GITHUB_COM: &str = "https://github.com";
pub const GITLAB_COM: &str = "https://gitlab.com";
pub const CODEBERG: &str = "https://codeberg.org";

/// The REST API a server speaks. Gitea covers Forgejo and Codeberg.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ForgeKind {
    GitHub,
    GitLab,
    Gitea,
}

/// Which Gitea-compatible server it is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerFlavor {
    Gitea,
    Forgejo,
}

/// How the account signed in.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthMethod {
    OAuth,
    Token,
}

/// The kind of a hosted preset, answered without any network call.
pub fn preset(base: &str) -> Option<(ForgeKind, Option<ServerFlavor>)> {
    match base {
        GITHUB_COM => Some((ForgeKind::GitHub, None)),
        GITLAB_COM => Some((ForgeKind::GitLab, None)),
        CODEBERG => Some((ForgeKind::Gitea, Some(ServerFlavor::Forgejo))),
        _ => None,
    }
}

/// The product name of a hosted preset, else the host and any non-default
/// port: what messages say instead of a full address.
pub fn host_label(url_or_base: &str) -> String {
    let host = crate::address::host_of(url_or_base).unwrap_or_else(|| url_or_base.to_string());
    match host.as_str() {
        "github.com" => "GitHub".to_string(),
        "gitlab.com" => "GitLab".to_string(),
        "codeberg.org" => "Codeberg".to_string(),
        _ => host,
    }
}

impl ForgeKind {
    /// The API root, with a trailing slash so relative joins stay under it.
    pub fn api_root(self, base: &str) -> Result<url::Url, ForgeError> {
        let root = match self {
            ForgeKind::GitHub if base == GITHUB_COM => "https://api.github.com/".to_string(),
            ForgeKind::GitHub => format!("{base}/api/v3/"),
            ForgeKind::GitLab => format!("{base}/api/v4/"),
            ForgeKind::Gitea => format!("{base}/api/v1/"),
        };
        url::Url::parse(&root).map_err(|_| ForgeError::InvalidBaseUrl {
            input: base.to_string(),
        })
    }

    /// The user name Git sends with a token. GitHub and GitLab accept a fixed
    /// name for every token; Gitea gets the account's login when it is a
    /// plain name.
    pub fn git_username(self, login: &str) -> String {
        match self {
            ForgeKind::GitHub => "x-access-token".to_string(),
            ForgeKind::GitLab => "oauth2".to_string(),
            ForgeKind::Gitea => {
                let plain = !login.is_empty()
                    && login.len() <= 255
                    && login.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.')
                    });
                if plain {
                    login.to_string()
                } else {
                    "oleafly".to_string()
                }
            }
        }
    }

    /// The token scopes Oleafly needs, as named on each server's token page.
    pub fn scopes_hint(self) -> &'static str {
        match self {
            ForgeKind::GitHub => "repo, read:user",
            ForgeKind::GitLab => "api, write_repository",
            ForgeKind::Gitea => "read:user, write:user, read:repository, write:repository",
        }
    }

    /// The product name.
    pub fn label(self, flavor: Option<ServerFlavor>) -> &'static str {
        match (self, flavor) {
            (ForgeKind::GitHub, _) => "GitHub",
            (ForgeKind::GitLab, _) => "GitLab",
            (ForgeKind::Gitea, Some(ServerFlavor::Forgejo)) => "Forgejo",
            (ForgeKind::Gitea, _) => "Gitea",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_roots_follow_each_server() {
        assert_eq!(
            ForgeKind::GitHub.api_root(GITHUB_COM).unwrap().as_str(),
            "https://api.github.com/"
        );
        assert_eq!(
            ForgeKind::GitHub
                .api_root("https://ghe.example.org")
                .unwrap()
                .as_str(),
            "https://ghe.example.org/api/v3/"
        );
        assert_eq!(
            ForgeKind::GitLab
                .api_root("https://example.org/gitlab")
                .unwrap()
                .as_str(),
            "https://example.org/gitlab/api/v4/"
        );
        assert_eq!(
            ForgeKind::Gitea.api_root(CODEBERG).unwrap().as_str(),
            "https://codeberg.org/api/v1/"
        );
    }

    #[test]
    fn git_usernames_follow_each_server() {
        assert_eq!(ForgeKind::GitHub.git_username("octo-cat"), "x-access-token");
        assert_eq!(ForgeKind::GitLab.git_username("octo-cat"), "oauth2");
        assert_eq!(ForgeKind::Gitea.git_username("octo-cat"), "octo-cat");
        assert_eq!(ForgeKind::Gitea.git_username("bad name\n"), "oleafly");
        assert_eq!(ForgeKind::Gitea.git_username(""), "oleafly");
    }

    #[test]
    fn kinds_serialize_as_lowercase_names() {
        assert_eq!(
            serde_json::to_string(&ForgeKind::GitHub).unwrap(),
            "\"github\""
        );
        assert_eq!(
            serde_json::to_string(&ForgeKind::GitLab).unwrap(),
            "\"gitlab\""
        );
        assert_eq!(
            serde_json::to_string(&ServerFlavor::Forgejo).unwrap(),
            "\"forgejo\""
        );
        assert_eq!(
            serde_json::to_string(&AuthMethod::OAuth).unwrap(),
            "\"oauth\""
        );
        assert_eq!(
            serde_json::from_str::<ForgeKind>("\"gitea\"").unwrap(),
            ForgeKind::Gitea
        );
    }

    #[test]
    fn presets_and_host_labels_name_the_hosted_services() {
        assert_eq!(
            preset(CODEBERG),
            Some((ForgeKind::Gitea, Some(ServerFlavor::Forgejo)))
        );
        assert_eq!(preset("https://git.example.org"), None);
        assert_eq!(host_label(GITHUB_COM), "GitHub");
        assert_eq!(host_label("git@gitlab.com:g/p.git"), "GitLab");
        assert_eq!(
            host_label("https://git.example.org:8443/x"),
            "git.example.org:8443"
        );
        assert_eq!(
            ForgeKind::Gitea.label(Some(ServerFlavor::Forgejo)),
            "Forgejo"
        );
    }
}
