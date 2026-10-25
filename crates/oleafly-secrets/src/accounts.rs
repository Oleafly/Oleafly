//! Account names in the app secrets file, and the Git-host token map shared
//! by the app's Git hosting accounts and `oleafly auth`.
use crate::SecretStore;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const GITHUB_TOKEN_ACCOUNT: &str = "github_token";
pub const MCP_TOKEN_ACCOUNT: &str = "mcp_token";
/// JSON map: normalized Git-host base URL → [`ForgeToken`].
pub const FORGE_TOKENS_ACCOUNT: &str = "forge_tokens";

/// A Git-host token (GitHub, GitLab, Gitea, Forgejo, Codeberg).
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeToken {
    pub token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh: Option<String>,
    /// Epoch seconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
}

impl std::fmt::Debug for ForgeToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ForgeToken")
            .field("token", &"[redacted]")
            .field("refresh", &self.refresh.as_ref().map(|_| "[redacted]"))
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

/// A one-way fingerprint of a token (SHA-256, hex): enough to notice that a
/// token changed without keeping a second copy of it.
pub fn token_fingerprint(token: &str) -> String {
    ring::digest::digest(&ring::digest::SHA256, token.as_bytes())
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// `https://host[:port][/path]` with a lowercase host, no default port and no
/// trailing slash. A bare host gets `https://`. Refuses other schemes,
/// credentials, queries and fragments.
pub fn normalize_forge_base(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Enter the server address.".to_string());
    }
    let candidate = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let url = url::Url::parse(&candidate)
        .map_err(|_| "This isn't a valid server address.".to_string())?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err("Use an https:// or http:// server address.".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Leave the user name and password out of the server address.".to_string());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("Leave queries and # parts out of the server address.".to_string());
    }
    let host = url
        .host_str()
        .filter(|host| !host.is_empty())
        .ok_or_else(|| "The server address has no host.".to_string())?
        .to_ascii_lowercase();
    let mut base = format!("{}://{host}", url.scheme());
    if let Some(port) = url.port() {
        base.push_str(&format!(":{port}"));
    }
    let path = url.path().trim_end_matches('/');
    base.push_str(path);
    Ok(base)
}

/// A token Git's credential protocol can carry safely: 1–4096 printable
/// ASCII characters without quotes or backslashes.
pub fn valid_forge_token(token: &str) -> bool {
    !token.is_empty()
        && token.len() <= 4096
        && token
            .bytes()
            .all(|b| b.is_ascii_graphic() && b != b'"' && b != b'\'' && b != b'\\')
}

fn parse_map(raw: Option<&str>) -> BTreeMap<String, ForgeToken> {
    raw.and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or_default()
}

/// Every saved Git-host token. A corrupt map reads as empty.
pub fn forge_tokens(store: &SecretStore) -> Result<BTreeMap<String, ForgeToken>, String> {
    Ok(parse_map(store.get(FORGE_TOKENS_ACCOUNT)?.as_deref()))
}

pub fn forge_token(store: &SecretStore, base: &str) -> Result<Option<ForgeToken>, String> {
    let base = normalize_forge_base(base)?;
    Ok(forge_tokens(store)?.remove(&base))
}

pub fn save_forge_token(store: &SecretStore, base: &str, token: ForgeToken) -> Result<(), String> {
    let base = normalize_forge_base(base)?;
    let token = ForgeToken {
        token: token.token.trim().to_string(),
        refresh: token.refresh.map(|refresh| refresh.trim().to_string()),
        expires_at: token.expires_at,
    };
    if !valid_forge_token(&token.token)
        || token
            .refresh
            .as_deref()
            .is_some_and(|refresh| !valid_forge_token(refresh))
    {
        return Err("This token has characters a Git host never issues.".to_string());
    }
    store.update(FORGE_TOKENS_ACCOUNT, |slot| {
        let mut map = parse_map(slot.as_deref());
        map.insert(base, token);
        *slot = serde_json::to_string(&map).ok();
    })
}

/// Remove the token for `base`. Returns whether there was one.
pub fn forget_forge_token(store: &SecretStore, base: &str) -> Result<bool, String> {
    let base = normalize_forge_base(base)?;
    store.update(FORGE_TOKENS_ACCOUNT, |slot| {
        let mut map = parse_map(slot.as_deref());
        let existed = map.remove(&base).is_some();
        if existed {
            *slot = if map.is_empty() {
                None
            } else {
                serde_json::to_string(&map).ok()
            };
        }
        existed
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forge_bases_normalize_scheme_host_port_and_trailing_slash() {
        assert_eq!(
            normalize_forge_base("github.com").unwrap(),
            "https://github.com"
        );
        assert_eq!(
            normalize_forge_base("https://GitLab.Example.org:443/").unwrap(),
            "https://gitlab.example.org"
        );
        assert_eq!(
            normalize_forge_base("https://example.org/gitlab/").unwrap(),
            "https://example.org/gitlab"
        );
        assert_eq!(
            normalize_forge_base("http://localhost:3000").unwrap(),
            "http://localhost:3000"
        );
        for bad in [
            "ftp://x.org",
            "https://user:pw@x.org",
            "https://x.org/?q=1",
            "https://x.org/#f",
            "",
        ] {
            assert!(normalize_forge_base(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn forge_tokens_round_trip_and_never_print_in_debug() {
        let dir = tempfile::tempdir().unwrap();
        let store = SecretStore::at(dir.path());
        let token = ForgeToken {
            token: "glpat-SECRETVALUE1".into(),
            refresh: Some("refresh-SECRET2".into()),
            expires_at: Some(1_900_000_000),
        };
        save_forge_token(&store, "https://gitlab.com", token.clone()).unwrap();
        assert_eq!(
            forge_token(&store, "https://gitlab.com").unwrap(),
            Some(token.clone())
        );
        let debug = format!("{token:?}");
        assert!(!debug.contains("SECRETVALUE1") && !debug.contains("SECRET2"));
        let raw = store.get(FORGE_TOKENS_ACCOUNT).unwrap().unwrap();
        assert!(raw.contains("\"expiresAt\":1900000000"));
    }

    #[test]
    fn forget_forge_token_reports_whether_it_existed() {
        let dir = tempfile::tempdir().unwrap();
        let store = SecretStore::at(dir.path());
        let token = |value: &str| ForgeToken {
            token: value.into(),
            refresh: None,
            expires_at: None,
        };
        save_forge_token(&store, "https://codeberg.org", token("a1")).unwrap();
        save_forge_token(&store, "gitlab.com", token("b2")).unwrap();
        assert!(forget_forge_token(&store, "codeberg.org/").unwrap());
        assert!(!forget_forge_token(&store, "https://codeberg.org").unwrap());
        assert_eq!(
            forge_token(&store, "https://gitlab.com")
                .unwrap()
                .unwrap()
                .token,
            "b2"
        );
        assert!(forget_forge_token(&store, "gitlab.com").unwrap());
        assert_eq!(store.get(FORGE_TOKENS_ACCOUNT).unwrap(), None);
    }

    #[test]
    fn a_store_without_forge_tokens_reads_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        let store = SecretStore::at(dir.path());
        assert!(forge_tokens(&store).unwrap().is_empty());
        store.set(&[(FORGE_TOKENS_ACCOUNT, "not json")]).unwrap();
        assert!(forge_tokens(&store).unwrap().is_empty());
    }

    #[test]
    fn tokens_with_quotes_newlines_or_backslashes_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let store = SecretStore::at(dir.path());
        for bad in ["a\"b", "line\nbreak", "back\\slash", "sp ace", ""] {
            let result = save_forge_token(
                &store,
                "https://gitlab.com",
                ForgeToken {
                    token: bad.into(),
                    refresh: None,
                    expires_at: None,
                },
            );
            assert!(result.is_err(), "{bad:?}");
        }
        assert!(valid_forge_token("glpat-abc_DEF.123"));
    }
}
