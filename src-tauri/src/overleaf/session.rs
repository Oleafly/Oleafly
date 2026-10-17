use std::collections::BTreeMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::app_error::AppError;

const ACCOUNT: &str = "overleaf_sessions";
pub(crate) const DEFAULT_SERVER: &str = "https://www.overleaf.com";

static STORE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Session {
    pub cookie: String,
    pub user_id: String,
    pub email: String,
}

pub(crate) fn normalize_server(input: Option<&str>) -> Result<String, String> {
    let raw = input
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_SERVER);
    let with_scheme = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("https://{raw}")
    };
    let invalid = || String::from(AppError::new("overleaf.invalid_server").param("server", raw));
    let url = tauri::Url::parse(&with_scheme).map_err(|_| invalid())?;
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
    let host = if host == "overleaf.com" {
        "www.overleaf.com".to_string()
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

pub(crate) fn origin_of(base: &str) -> String {
    tauri::Url::parse(base)
        .map(|url| url.origin().ascii_serialization())
        .unwrap_or_else(|_| base.to_string())
}

pub(crate) fn cookie_header<I, N, V>(pairs: I) -> String
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

pub(crate) fn parse_cookie_header(header: &str) -> Vec<(String, String)> {
    header
        .split(';')
        .filter_map(|part| {
            let (name, value) = part.split_once('=')?;
            Some((name.trim().to_string(), value.trim().to_string()))
        })
        .filter(|(name, _)| !name.is_empty())
        .collect()
}

pub(crate) fn merge_set_cookies<'a>(
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

fn read_all() -> Result<BTreeMap<String, Session>, String> {
    match crate::secrets::get_secret(ACCOUNT)? {
        Some(raw) => Ok(serde_json::from_str(&raw).unwrap_or_default()),
        None => Ok(BTreeMap::new()),
    }
}

fn write_all(sessions: &BTreeMap<String, Session>) -> Result<(), String> {
    let raw = if sessions.is_empty() {
        String::new()
    } else {
        serde_json::to_string(sessions).map_err(|error| error.to_string())?
    };
    crate::secrets::set_secrets(&[(ACCOUNT, raw.as_str())])
}

fn with_store<T>(
    work: impl FnOnce(&mut BTreeMap<String, Session>) -> T,
) -> Result<(T, bool), String> {
    let _guard = STORE_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut sessions = read_all()?;
    let before = sessions.clone();
    let result = work(&mut sessions);
    let changed = sessions != before;
    if changed {
        write_all(&sessions)?;
    }
    Ok((result, changed))
}

pub(crate) fn load(base: &str) -> Result<Option<Session>, String> {
    let _guard = STORE_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    Ok(read_all()?.remove(base))
}

pub(crate) fn save(base: &str, session: &Session) -> Result<(), String> {
    with_store(|sessions| {
        sessions.insert(base.to_string(), session.clone());
    })
    .map(|_| ())
}

pub(crate) fn forget(base: &str) -> Result<(), String> {
    with_store(|sessions| {
        sessions.remove(base);
    })
    .map(|_| ())
}

pub(crate) fn refresh_cookie(base: &str, session: &Session, cookie: &str) -> Result<(), String> {
    if session.cookie == cookie {
        return Ok(());
    }
    with_store(|sessions| {
        if let Some(stored) = sessions.get_mut(base) {
            if stored.user_id == session.user_id {
                stored.cookie = cookie.to_string();
            }
        }
    })
    .map(|_| ())
}

const GIT_ACCOUNT: &str = "overleaf_git_tokens";

fn read_git_tokens() -> Result<BTreeMap<String, String>, String> {
    match crate::secrets::get_secret(GIT_ACCOUNT)? {
        Some(raw) => Ok(serde_json::from_str(&raw).unwrap_or_default()),
        None => Ok(BTreeMap::new()),
    }
}

fn write_git_tokens(tokens: &BTreeMap<String, String>) -> Result<(), String> {
    let raw = if tokens.is_empty() {
        String::new()
    } else {
        serde_json::to_string(tokens).map_err(|error| error.to_string())?
    };
    crate::secrets::set_secrets(&[(GIT_ACCOUNT, raw.as_str())])
}

pub(crate) fn valid_git_token(token: &str) -> bool {
    (8..=256).contains(&token.len())
        && token
            .bytes()
            .all(|byte| byte.is_ascii_graphic() && byte != b'"' && byte != b'\'' && byte != b'\\')
}

pub(crate) fn git_token(base: &str) -> Result<Option<String>, String> {
    let _guard = STORE_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    Ok(read_git_tokens()?.remove(base))
}

pub(crate) fn save_git_token(base: &str, token: &str) -> Result<(), String> {
    let token = token.trim();
    if !valid_git_token(token) {
        return Err(AppError::new("overleaf.git_token_invalid").into());
    }
    let _guard = STORE_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut tokens = read_git_tokens()?;
    tokens.insert(base.to_string(), token.to_string());
    write_git_tokens(&tokens)
}

pub(crate) fn forget_git_token(base: &str) -> Result<(), String> {
    let _guard = STORE_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut tokens = read_git_tokens()?;
    if tokens.remove(base).is_some() {
        write_git_tokens(&tokens)?;
    }
    Ok(())
}

pub(crate) fn cookie_applies(
    domain: Option<&str>,
    path: Option<&str>,
    secure: bool,
    url: &tauri::Url,
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
