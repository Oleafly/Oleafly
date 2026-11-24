use std::collections::BTreeMap;

use oleafly_secrets::SecretStore;
use serde::{Deserialize, Serialize};

use crate::client::Http;
use crate::error::{OnlineError, OnlineErrorKind};
use crate::service::{
    ACCOUNT_GIT_TOKENS, BARE_HOST, DEFAULT_SERVER, GIT_TOKENS_ACCOUNT, SESSIONS_ACCOUNT, WWW_HOST,
};

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub cookie: String,
    pub user_id: String,
    pub email: String,
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

pub fn is_loopback(url: &url::Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(domain)) => {
            let domain = domain.trim_end_matches('.').to_ascii_lowercase();
            domain == "localhost" || domain.ends_with(".localhost")
        }
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    }
}

pub fn is_secure_server(server: &str) -> bool {
    url::Url::parse(server)
        .is_ok_and(|url| url.scheme() == "https" || (url.scheme() == "http" && is_loopback(&url)))
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
    if !(url.scheme() == "https" || (url.scheme() == "http" && is_loopback(&url)))
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

pub fn is_dashboard(url: &url::Url, base: &str) -> bool {
    let Ok(base_url) = url::Url::parse(base) else {
        return false;
    };
    if url.origin() != base_url.origin() {
        return false;
    }
    let prefix = base_url.path().trim_end_matches('/');
    let Some(rest) = url.path().strip_prefix(prefix) else {
        return false;
    };
    matches!(rest, "/project" | "/project/")
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

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq)]
struct Accounts {
    #[serde(flatten)]
    current: Session,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    accounts: Vec<Session>,
}

impl Accounts {
    fn of(session: Session) -> Accounts {
        Accounts {
            current: session,
            accounts: Vec::new(),
        }
    }

    fn all(&self) -> impl Iterator<Item = &Session> {
        std::iter::once(&self.current).chain(&self.accounts)
    }

    fn find_mut(&mut self, user_id: &str) -> Option<&mut Session> {
        std::iter::once(&mut self.current)
            .chain(&mut self.accounts)
            .find(|session| session.user_id == user_id)
    }

    fn make_current(&mut self, session: Session) {
        self.accounts
            .retain(|other| other.user_id != session.user_id);
        let previous = std::mem::replace(&mut self.current, session);
        if previous.user_id != self.current.user_id {
            self.accounts.insert(0, previous);
        }
    }
}

type Servers = BTreeMap<String, Accounts>;

fn with_sessions<T>(
    store: &SecretStore,
    work: impl FnOnce(&mut Servers) -> T,
) -> Result<T, OnlineError> {
    update_slot(store, SESSIONS_ACCOUNT, work)
}

fn read_sessions(store: &SecretStore) -> Result<Servers, OnlineError> {
    read_slot(store, SESSIONS_ACCOUNT)
}

fn update_slot<V, T>(
    store: &SecretStore,
    slot_name: &str,
    work: impl FnOnce(&mut BTreeMap<String, V>) -> T,
) -> Result<T, OnlineError>
where
    V: Serialize + serde::de::DeserializeOwned + Clone + PartialEq,
{
    store
        .update(slot_name, |slot| {
            let mut values: BTreeMap<String, V> = decode(slot);
            let before = values.clone();
            let output = work(&mut values);
            if values != before {
                *slot = encode(&values);
            }
            output
        })
        .map_err(store_error)
}

fn read_slot<V: serde::de::DeserializeOwned>(
    store: &SecretStore,
    slot_name: &str,
) -> Result<BTreeMap<String, V>, OnlineError> {
    let raw = store.get(slot_name).map_err(store_error)?;
    Ok(decode(&raw))
}

pub fn load(store: &SecretStore, base: &str) -> Result<Option<Session>, OnlineError> {
    Ok(read_sessions(store)?
        .remove(base)
        .map(|accounts| accounts.current))
}

pub fn load_account(
    store: &SecretStore,
    base: &str,
    user_id: &str,
) -> Result<Option<Session>, OnlineError> {
    Ok(read_sessions(store)?.remove(base).and_then(|accounts| {
        accounts
            .all()
            .find(|session| session.user_id == user_id)
            .cloned()
    }))
}

pub fn load_for(
    store: &SecretStore,
    base: &str,
    user_id: Option<&str>,
) -> Result<Option<Session>, OnlineError> {
    match user_id {
        Some(user_id) => load_account(store, base, user_id),
        None => load(store, base),
    }
}

pub fn accounts(store: &SecretStore, base: &str) -> Result<Vec<Session>, OnlineError> {
    Ok(read_sessions(store)?
        .remove(base)
        .map(|accounts| accounts.all().cloned().collect())
        .unwrap_or_default())
}

pub fn save(store: &SecretStore, base: &str, session: &Session) -> Result<(), OnlineError> {
    with_sessions(store, |sessions| match sessions.get_mut(base) {
        Some(accounts) => accounts.make_current(session.clone()),
        None => {
            sessions.insert(base.to_string(), Accounts::of(session.clone()));
        }
    })
}

pub fn use_account(store: &SecretStore, base: &str, user_id: &str) -> Result<bool, OnlineError> {
    with_sessions(store, |sessions| {
        let Some(accounts) = sessions.get_mut(base) else {
            return false;
        };
        let Some(chosen) = accounts
            .all()
            .find(|session| session.user_id == user_id)
            .cloned()
        else {
            return false;
        };
        accounts.make_current(chosen);
        true
    })
}

pub fn forget(store: &SecretStore, base: &str) -> Result<bool, OnlineError> {
    with_sessions(store, |sessions| sessions.remove(base).is_some())
}

pub fn forget_account(store: &SecretStore, base: &str, user_id: &str) -> Result<bool, OnlineError> {
    with_sessions(store, |sessions| {
        let Some(accounts) = sessions.get_mut(base) else {
            return false;
        };
        if accounts.current.user_id == user_id {
            if accounts.accounts.is_empty() {
                sessions.remove(base);
            } else {
                accounts.current = accounts.accounts.remove(0);
            }
            return true;
        }
        let before = accounts.accounts.len();
        accounts
            .accounts
            .retain(|session| session.user_id != user_id);
        accounts.accounts.len() != before
    })
}

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
        if let Some(stored) = sessions
            .get_mut(base)
            .and_then(|accounts| accounts.find_mut(&session.user_id))
        {
            stored.cookie = cookie.to_string();
        }
    })
}

#[derive(Clone)]
pub struct SessionHandle {
    inner: std::sync::Arc<HandleInner>,
}

struct HandleInner {
    base: String,
    session: Session,
    cookie: std::sync::Mutex<String>,
    store: Option<SecretStore>,
    saving: std::sync::Mutex<()>,
    save_due: std::sync::atomic::AtomicBool,
}

impl HandleInner {
    fn cookie(&self) -> String {
        crate::locked(&self.cookie).clone()
    }

    fn save_cookie(&self) {
        let Some(store) = &self.store else {
            return;
        };
        let _turn = crate::locked(&self.saving);
        self.save_due
            .store(false, std::sync::atomic::Ordering::SeqCst);
        let _ = refresh_cookie(store, &self.base, &self.session, &self.cookie());
    }
}

impl std::fmt::Debug for SessionHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SessionHandle")
            .field("base", &self.inner.base)
            .field("user_id", &self.inner.session.user_id)
            .field("cookie", &"[redacted]")
            .finish()
    }
}

impl SessionHandle {
    pub fn new(base: &str, session: Session, store: Option<SecretStore>) -> SessionHandle {
        SessionHandle {
            inner: std::sync::Arc::new(HandleInner {
                base: base.to_string(),
                cookie: std::sync::Mutex::new(session.cookie.clone()),
                session,
                store,
                saving: std::sync::Mutex::new(()),
                save_due: std::sync::atomic::AtomicBool::new(false),
            }),
        }
    }

    pub fn user_id(&self) -> &str {
        &self.inner.session.user_id
    }

    pub fn email(&self) -> &str {
        &self.inner.session.email
    }

    pub fn cookie(&self) -> String {
        self.inner.cookie()
    }

    pub fn absorb<'a>(&self, set_cookies: impl IntoIterator<Item = &'a str>) -> bool {
        {
            let mut cookie = crate::locked(&self.inner.cookie);
            let merged = merge_set_cookies(&cookie, set_cookies);
            if merged == *cookie {
                return false;
            }
            *cookie = merged;
        }
        if self.inner.store.is_some()
            && !self
                .inner
                .save_due
                .swap(true, std::sync::atomic::Ordering::SeqCst)
        {
            let inner = std::sync::Arc::clone(&self.inner);
            match tokio::runtime::Handle::try_current() {
                Ok(runtime) => {
                    runtime.spawn_blocking(move || inner.save_cookie());
                }
                Err(_) => inner.save_cookie(),
            }
        }
        true
    }

    pub fn absorb_headers(&self, headers: &reqwest::header::HeaderMap) -> bool {
        let lines = crate::client::set_cookie_lines(headers);
        self.absorb(lines.iter().map(String::as_str))
    }
}

pub fn session_servers(store: &SecretStore) -> Result<Vec<String>, OnlineError> {
    Ok(read_sessions(store)?.into_keys().collect())
}

type AccountTokens = BTreeMap<String, String>;

pub fn git_token(
    store: &SecretStore,
    base: &str,
    account: Option<&str>,
) -> Result<Option<String>, OnlineError> {
    let mut by_account: BTreeMap<String, AccountTokens> = read_slot(store, ACCOUNT_GIT_TOKENS)?;
    let mut own = by_account.remove(base).unwrap_or_default();
    if let Some(user_id) = account {
        if let Some(token) = own.remove(user_id) {
            return Ok(Some(token));
        }
    }
    let mut shared: BTreeMap<String, String> = read_slot(store, GIT_TOKENS_ACCOUNT)?;
    if let Some(token) = shared.remove(base) {
        return Ok(Some(token));
    }
    if account.is_some() {
        return Ok(None);
    }
    if let Some(current) = load(store, base)? {
        if let Some(token) = own.remove(&current.user_id) {
            return Ok(Some(token));
        }
    }
    let mut left = own.into_values();
    Ok(match (left.next(), left.next()) {
        (Some(only), None) => Some(only),
        _ => None,
    })
}

pub fn save_git_token(
    store: &SecretStore,
    base: &str,
    account: Option<&str>,
    token: &str,
) -> Result<(), OnlineError> {
    let token = token.trim();
    if !valid_git_token(token) {
        return Err(OnlineError::new(OnlineErrorKind::GitTokenInvalid));
    }
    match account {
        Some(user_id) => update_slot(
            store,
            ACCOUNT_GIT_TOKENS,
            |tokens: &mut BTreeMap<String, AccountTokens>| {
                tokens
                    .entry(base.to_string())
                    .or_default()
                    .insert(user_id.to_string(), token.to_string());
            },
        ),
        None => update_slot(
            store,
            GIT_TOKENS_ACCOUNT,
            |tokens: &mut BTreeMap<String, String>| {
                tokens.insert(base.to_string(), token.to_string());
            },
        ),
    }
}

pub fn forget_git_token(
    store: &SecretStore,
    base: &str,
    account: Option<&str>,
) -> Result<bool, OnlineError> {
    let own = update_slot(
        store,
        ACCOUNT_GIT_TOKENS,
        |tokens: &mut BTreeMap<String, AccountTokens>| {
            let Some(server) = tokens.get_mut(base) else {
                return false;
            };
            let removed = match account {
                Some(user_id) => server.remove(user_id).is_some(),
                None => {
                    let any = !server.is_empty();
                    server.clear();
                    any
                }
            };
            if server.is_empty() {
                tokens.remove(base);
            }
            removed
        },
    )?;
    if own && account.is_some() {
        return Ok(true);
    }
    let shared = update_slot(
        store,
        GIT_TOKENS_ACCOUNT,
        |tokens: &mut BTreeMap<String, String>| tokens.remove(base).is_some(),
    )?;
    Ok(own || shared)
}

pub fn git_token_servers(store: &SecretStore) -> Result<Vec<String>, OnlineError> {
    let shared: BTreeMap<String, String> = read_slot(store, GIT_TOKENS_ACCOUNT)?;
    let by_account: BTreeMap<String, AccountTokens> = read_slot(store, ACCOUNT_GIT_TOKENS)?;
    let mut servers: Vec<String> = shared
        .into_keys()
        .chain(
            by_account
                .into_iter()
                .filter(|(_, tokens)| !tokens.is_empty())
                .map(|(base, _)| base),
        )
        .collect();
    servers.sort();
    servers.dedup();
    Ok(servers)
}

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
