//! Signed-in sessions and Git tokens per server, kept in the shared
//! encrypted secret store. Every change goes through the store's
//! cross-process update, so the app and the CLI never lose each other's
//! entries.
use std::collections::BTreeMap;

use oleafly_secrets::SecretStore;
use serde::{Deserialize, Serialize};

use crate::client::Http;
use crate::error::{OnlineError, OnlineErrorKind};
use crate::service::{BARE_HOST, DEFAULT_SERVER, GIT_TOKENS_ACCOUNT, SESSIONS_ACCOUNT, WWW_HOST};

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub cookie: String,
    pub user_id: String,
    pub email: String,
    /// Who saved it: "app", "cli" or "cli:browser:<id>". Absent in 0.4.7.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub saved_by: Option<String>,
}

impl std::fmt::Debug for Session {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Session")
            .field("cookie", &"[redacted]")
            .field("user_id", &self.user_id)
            .field("email", &self.email)
            .field("saved_by", &self.saved_by)
            .finish()
    }
}

pub fn normalize_server(input: Option<&str>) -> Result<String, OnlineError> {
    let raw = input
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_SERVER);
    let with_scheme = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("https://{raw}")
    };
    let invalid = || OnlineError::new(OnlineErrorKind::InvalidServer).param("server", raw);
    let url = url::Url::parse(&with_scheme).map_err(|_| invalid())?;
    let host = url
        .host_str()
        .filter(|host| !host.is_empty())
        .ok_or_else(invalid)?
        .to_ascii_lowercase();
    if !matches!(url.scheme(), "https" | "http")
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(invalid());
    }
    let host = if host == BARE_HOST {
        WWW_HOST.to_string()
    } else {
        host
    };
    let port = url
        .port()
        .map(|port| format!(":{port}"))
        .unwrap_or_default();
    let path = url.path().trim_end_matches('/');
    Ok(format!("{}://{host}{port}{path}", url.scheme()))
}

pub fn origin_of(base: &str) -> String {
    url::Url::parse(base)
        .map(|url| url.origin().ascii_serialization())
        .unwrap_or_else(|_| base.to_string())
}

pub fn cookie_header<I, N, V>(pairs: I) -> String
where
    I: IntoIterator<Item = (N, V)>,
    N: Into<String>,
    V: Into<String>,
{
    let mut ordered: Vec<(String, String)> = Vec::new();
    for (name, value) in pairs {
        let (name, value) = (name.into(), value.into());
        let name = name.trim().to_string();
        if name.is_empty()
            || name.contains(['=', ';', '\r', '\n'])
            || value.contains([';', '\r', '\n'])
        {
            continue;
        }
        match ordered.iter_mut().find(|(existing, _)| *existing == name) {
            Some(entry) => entry.1 = value,
            None => ordered.push((name, value)),
        }
    }
    ordered
        .into_iter()
        .map(|(name, value)| format!("{name}={value}"))
        .collect::<Vec<_>>()
        .join("; ")
}

pub fn parse_cookie_header(header: &str) -> Vec<(String, String)> {
    header
        .split(';')
        .filter_map(|part| {
            let (name, value) = part.split_once('=')?;
            Some((name.trim().to_string(), value.trim().to_string()))
        })
        .filter(|(name, _)| !name.is_empty())
        .collect()
}

pub fn merge_set_cookies<'a>(
    header: &str,
    set_cookies: impl IntoIterator<Item = &'a str>,
) -> String {
    let mut pairs = parse_cookie_header(header);
    for line in set_cookies {
        let first = line.split(';').next().unwrap_or_default();
        let Some((name, value)) = first.split_once('=') else {
            continue;
        };
        let (name, value) = (name.trim(), value.trim());
        let expired = value.is_empty()
            || line.split(';').skip(1).any(|attribute| {
                let attribute = attribute.trim().to_ascii_lowercase();
                attribute == "max-age=0" || attribute.starts_with("max-age=-")
            });
        pairs.retain(|(existing, _)| existing != name);
        if !expired {
            pairs.push((name.to_string(), value.to_string()));
        }
    }
    cookie_header(pairs)
}

pub fn cookie_applies(
    domain: Option<&str>,
    path: Option<&str>,
    secure: bool,
    url: &url::Url,
) -> bool {
    let Some(host) = url.host_str().map(str::to_ascii_lowercase) else {
        return false;
    };
    let ip_host = url.domain().is_none();
    let domain_ok = match domain.map(|value| value.trim_start_matches('.').to_ascii_lowercase()) {
        None => true,
        Some(value) if value.is_empty() => true,
        Some(value) => host == value || (!ip_host && host.ends_with(&format!(".{value}"))),
    };
    let path_ok = match path.filter(|value| !value.is_empty() && *value != "/") {
        None => true,
        Some(value) => {
            let request = url.path();
            request == value
                || request.starts_with(&format!("{}/", value.trim_end_matches('/')))
                || request.starts_with(value) && value.ends_with('/')
        }
    };
    let loopback = host == "localhost"
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback());
    let secure_ok = !secure || url.scheme() == "https" || loopback;
    domain_ok && path_ok && secure_ok
}

pub fn valid_git_token(token: &str) -> bool {
    (8..=256).contains(&token.len())
        && token
            .bytes()
            .all(|byte| byte.is_ascii_graphic() && byte != b'"' && byte != b'\'' && byte != b'\\')
}

/// Checks a cookie against the dashboard and returns the session it opens,
/// with any refreshed cookies merged in.
pub async fn session_from_cookie(
    http: &Http,
    cookie: String,
    saved_by: &str,
) -> Result<Session, OnlineError> {
    let dashboard = http.dashboard(&cookie).await?;
    let cookie = merge_set_cookies(&cookie, dashboard.set_cookies.iter().map(String::as_str));
    Ok(Session {
        cookie,
        user_id: dashboard.user_id,
        email: dashboard.email,
        saved_by: Some(saved_by.to_string()),
    })
}

fn store_error(error: String) -> OnlineError {
    OnlineError::io(error)
}

fn decode<T: serde::de::DeserializeOwned + Default>(raw: &Option<String>) -> T {
    raw.as_deref()
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or_default()
}

fn encode<T: Serialize>(map: &BTreeMap<String, T>) -> Option<String> {
    if map.is_empty() {
        None
    } else {
        serde_json::to_string(map).ok()
    }
}

/// Edits the `{base: Session}` map under the store's lock.
fn with_sessions<T>(
    store: &SecretStore,
    work: impl FnOnce(&mut BTreeMap<String, Session>) -> T,
) -> Result<T, OnlineError> {
    store
        .update(SESSIONS_ACCOUNT, |slot| {
            let mut sessions: BTreeMap<String, Session> = decode(slot);
            let before = sessions.clone();
            let output = work(&mut sessions);
            if sessions != before {
                *slot = encode(&sessions);
            }
            output
        })
        .map_err(store_error)
}

fn with_tokens<T>(
    store: &SecretStore,
    work: impl FnOnce(&mut BTreeMap<String, String>) -> T,
) -> Result<T, OnlineError> {
    store
        .update(GIT_TOKENS_ACCOUNT, |slot| {
            let mut tokens: BTreeMap<String, String> = decode(slot);
            let before = tokens.clone();
            let output = work(&mut tokens);
            if tokens != before {
                *slot = encode(&tokens);
            }
            output
        })
        .map_err(store_error)
}

pub fn load(store: &SecretStore, base: &str) -> Result<Option<Session>, OnlineError> {
    let raw = store.get(SESSIONS_ACCOUNT).map_err(store_error)?;
    let mut sessions: BTreeMap<String, Session> = decode(&raw);
    Ok(sessions.remove(base))
}

pub fn save(store: &SecretStore, base: &str, session: &Session) -> Result<(), OnlineError> {
    with_sessions(store, |sessions| {
        sessions.insert(base.to_string(), session.clone());
    })
}

/// Removes the session for `base`; true when there was one.
pub fn forget(store: &SecretStore, base: &str) -> Result<bool, OnlineError> {
    with_sessions(store, |sessions| sessions.remove(base).is_some())
}

/// Stores a refreshed cookie, unless another account signed in meanwhile.
pub fn refresh_cookie(
    store: &SecretStore,
    base: &str,
    session: &Session,
    cookie: &str,
) -> Result<(), OnlineError> {
    if session.cookie == cookie {
        return Ok(());
    }
    with_sessions(store, |sessions| {
        if let Some(stored) = sessions.get_mut(base) {
            if stored.user_id == session.user_id {
                stored.cookie = cookie.to_string();
            }
        }
    })
}

pub fn session_servers(store: &SecretStore) -> Result<Vec<String>, OnlineError> {
    let raw = store.get(SESSIONS_ACCOUNT).map_err(store_error)?;
    let sessions: BTreeMap<String, Session> = decode(&raw);
    Ok(sessions.into_keys().collect())
}

pub fn git_token(store: &SecretStore, base: &str) -> Result<Option<String>, OnlineError> {
    let raw = store.get(GIT_TOKENS_ACCOUNT).map_err(store_error)?;
    let mut tokens: BTreeMap<String, String> = decode(&raw);
    Ok(tokens.remove(base))
}

pub fn save_git_token(store: &SecretStore, base: &str, token: &str) -> Result<(), OnlineError> {
    let token = token.trim();
    if !valid_git_token(token) {
        return Err(OnlineError::new(OnlineErrorKind::GitTokenInvalid));
    }
    with_tokens(store, |tokens| {
        tokens.insert(base.to_string(), token.to_string());
    })
}

pub fn forget_git_token(store: &SecretStore, base: &str) -> Result<bool, OnlineError> {
    with_tokens(store, |tokens| tokens.remove(base).is_some())
}

pub fn git_token_servers(store: &SecretStore) -> Result<Vec<String>, OnlineError> {
    let raw = store.get(GIT_TOKENS_ACCOUNT).map_err(store_error)?;
    let tokens: BTreeMap<String, String> = decode(&raw);
    Ok(tokens.into_keys().collect())
}

/// The one server with a session or Git token; the service default when
/// there is none or more than one.
pub fn default_server(store: &SecretStore) -> Result<String, OnlineError> {
    let mut servers = session_servers(store)?;
    servers.extend(git_token_servers(store)?);
    servers.sort();
    servers.dedup();
    Ok(match servers.as_slice() {
        [only] => only.clone(),
        _ => DEFAULT_SERVER.to_string(),
    })
}
