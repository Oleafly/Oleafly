use std::collections::BTreeSet;

use axum::http::header::{COOKIE, USER_AGENT};
use axum::http::{HeaderMap, HeaderValue};
use oleafly_collab_protocol::admin::{MemberStatus, SecurityEventKind};
use oleafly_collab_protocol::crypto::b64url_encode;
use oleafly_collab_protocol::ids::{AccountId, DeviceId};
use ring::hkdf;
use ring::signature::{Ed25519KeyPair, KeyPair};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;
use url::Host;

use crate::auth::pending::{PendingSignIn, PENDING_TTL_MS};
use crate::auth::{browser_binding, devices};
use crate::config::ServerConfig;
use crate::db::parse_id;
use crate::error::ServerError;
use crate::members;
use crate::security_log::{self, NewSecurityEvent};
use crate::state::DAY_MS;
use crate::tokens::{self, hash_token, random_token};

pub const COOKIE_NAME: &str = "oleafly_web";
pub const HOST_COOKIE_NAME: &str = "__Host-oleafly_web";
pub const PLATFORM: &str = "web";
pub const SESSION_DAYS: i64 = 30;
pub const SESSION_TTL_MS: i64 = SESSION_DAYS * DAY_MS;
pub const HOME: &str = "/web/";
pub const EDITING: &str = "editing";
pub const SUGGESTING: &str = "suggesting";
const RETURN_PREFIX: &str = "web:";
const MAX_RETURN_CHARS: usize = 512;
const TOKEN_CHARS: usize = 43;
const KEY_SALT: &[u8] = b"oleafly-web-device-key/v1";
const KEY_INFO: &[u8] = b"ed25519 seed";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Opened {
    pub token: String,
    pub account_id: AccountId,
    pub device_id: DeviceId,
    pub device_name: String,
    pub return_to: String,
    pub added: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebCaller {
    pub account_id: AccountId,
    pub device_id: DeviceId,
    pub public_key: String,
    pub mode: String,
    pub expires_at: i64,
}

pub fn return_path(raw: Option<&str>) -> String {
    let Some(raw) = raw.map(str::trim).filter(|raw| !raw.is_empty()) else {
        return HOME.to_string();
    };
    let under_web = raw == "/web"
        || raw.starts_with("/web/")
        || raw.starts_with("/web?")
        || raw.starts_with("/web#");
    let safe = under_web
        && raw.chars().count() <= MAX_RETURN_CHARS
        && !raw.contains('\\')
        && !raw.chars().any(char::is_control);
    if safe {
        raw.to_string()
    } else {
        HOME.to_string()
    }
}

pub fn pending(
    provider: &str,
    return_to: &str,
    device_name: &str,
    binding: String,
    now: i64,
) -> PendingSignIn {
    PendingSignIn {
        id: random_token(),
        provider_id: provider.to_string(),
        client_state: String::new(),
        redirect_uri: format!("{RETURN_PREFIX}{return_to}"),
        code_challenge: binding,
        device_public_key: String::new(),
        device_name: device_name.to_string(),
        platform: PLATFORM.to_string(),
        setup_code_hash: None,
        provider_verifier: random_token(),
        provider_nonce: random_token(),
        expires_at: now + PENDING_TTL_MS,
        device_authorization: None,
    }
}

pub fn return_of(pending: &PendingSignIn) -> Option<&str> {
    if pending.platform != PLATFORM || pending.device_authorization.is_some() {
        return None;
    }
    pending.redirect_uri.strip_prefix(RETURN_PREFIX)
}

pub fn is_web(pending: &PendingSignIn) -> bool {
    return_of(pending).is_some()
}

pub fn browser_name(headers: &HeaderMap) -> String {
    let agent = headers
        .get(USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let browser = [
        ("Edg/", "Edge"),
        ("OPR/", "Opera"),
        ("Firefox/", "Firefox"),
        ("Chrome/", "Chrome"),
        ("Safari/", "Safari"),
    ]
    .iter()
    .find(|(mark, _)| agent.contains(mark))
    .map(|(_, name)| *name);
    let system = [
        ("iPhone", "iOS"),
        ("iPad", "iPadOS"),
        ("Android", "Android"),
        ("Mac OS X", "macOS"),
        ("Windows", "Windows"),
        ("CrOS", "ChromeOS"),
        ("Linux", "Linux"),
    ]
    .iter()
    .find(|(mark, _)| agent.contains(mark))
    .map(|(_, name)| *name);
    match (browser, system) {
        (Some(browser), Some(system)) => format!("{browser} on {system}"),
        (Some(browser), None) => browser.to_string(),
        (None, Some(system)) => format!("Browser on {system}"),
        (None, None) => "Web browser".to_string(),
    }
}

fn seed(token: &str) -> Result<[u8; 32], ServerError> {
    let failed = || ServerError::Internal("could not derive a browser session key".to_string());
    let prk = hkdf::Salt::new(hkdf::HKDF_SHA256, KEY_SALT).extract(token.as_bytes());
    let okm = prk
        .expand(&[KEY_INFO], hkdf::HKDF_SHA256)
        .map_err(|_| failed())?;
    let mut seed = [0u8; 32];
    okm.fill(&mut seed).map_err(|_| failed())?;
    Ok(seed)
}

pub fn signing_key(token: &str) -> Result<Ed25519KeyPair, ServerError> {
    Ed25519KeyPair::from_seed_unchecked(&seed(token)?).map_err(|error| {
        ServerError::Internal(format!("a browser session key was refused: {error}"))
    })
}

pub fn public_key_of(token: &str) -> Result<String, ServerError> {
    Ok(b64url_encode(signing_key(token)?.public_key().as_ref()))
}

pub fn open(
    conn: &Connection,
    pending: &PendingSignIn,
    account: AccountId,
    ip: Option<String>,
    now: i64,
) -> Result<Opened, ServerError> {
    let return_to = return_of(pending)
        .map(|path| return_path(Some(path)))
        .unwrap_or_else(|| HOME.to_string());
    let token = random_token();
    let public_key = public_key_of(&token)?;
    let registered = devices::register(
        conn,
        account,
        &public_key,
        &pending.device_name,
        PLATFORM,
        now,
    )?;
    if registered.added {
        security_log::record(
            conn,
            now,
            NewSecurityEvent {
                actor: Some(account),
                kind: SecurityEventKind::DeviceAdded,
                target: Some(registered.device_id.to_string()),
                ip,
                detail: json!({ "name": pending.device_name, "platform": PLATFORM }),
            },
        )?;
    }
    conn.execute(
        "INSERT INTO web_sessions (token_hash, device_id, account_id, mode, created_at, expires_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            hash_token(&token),
            registered.device_id.to_string(),
            account.to_string(),
            EDITING,
            now,
            now + SESSION_TTL_MS
        ],
    )?;
    Ok(Opened {
        token,
        account_id: account,
        device_id: registered.device_id,
        device_name: pending.device_name.clone(),
        return_to,
        added: registered.added,
    })
}

pub fn expired() -> ServerError {
    ServerError::Refused {
        status: axum::http::StatusCode::UNAUTHORIZED,
        code: "session_expired",
        message: "This browser session has expired. Sign in again.".to_string(),
    }
}

pub fn resolve(conn: &Connection, token: &str, now: i64) -> Result<WebCaller, ServerError> {
    let row = conn
        .query_row(
            "SELECT w.account_id, w.device_id, w.mode, w.expires_at, d.public_key \
             FROM web_sessions w JOIN devices d ON d.id = w.device_id AND d.account_id = w.account_id \
             WHERE w.token_hash = ?1 AND d.revoked_at IS NULL",
            params![hash_token(token)],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()?;
    let Some((account, device, mode, expires_at, public_key)) = row else {
        return Err(ServerError::Unauthorized);
    };
    if expires_at <= now {
        return Err(expired());
    }
    let account_id: AccountId = parse_id(&account)?;
    if members::account_status(conn, account_id)? != Some(MemberStatus::Active) {
        return Err(members::session_end_reason(conn, account_id)?
            .map_or(ServerError::Unauthorized, ServerError::SessionEnded));
    }
    Ok(WebCaller {
        account_id,
        device_id: parse_id(&device)?,
        public_key,
        mode,
        expires_at,
    })
}

pub fn set_mode(conn: &Connection, device: DeviceId, mode: &str) -> Result<(), ServerError> {
    conn.execute(
        "UPDATE web_sessions SET mode = ?2 WHERE device_id = ?1",
        params![device.to_string(), mode],
    )?;
    Ok(())
}

pub fn sign_out(conn: &Connection, device: DeviceId, now: i64) -> Result<(), ServerError> {
    tokens::sign_out_device(conn, device, now)?;
    conn.execute(
        "DELETE FROM web_sessions WHERE device_id = ?1",
        [device.to_string()],
    )?;
    Ok(())
}

pub fn prune(conn: &Connection, now: i64) -> Result<Vec<DeviceId>, ServerError> {
    let mut statement =
        conn.prepare("SELECT device_id FROM web_sessions WHERE expires_at <= ?1")?;
    let ended = statement
        .query_map([now], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut devices = Vec::with_capacity(ended.len());
    for device in ended {
        let device: DeviceId = parse_id(&device)?;
        sign_out(conn, device, now)?;
        devices.push(device);
    }
    Ok(devices)
}

pub fn cookie_name(config: &ServerConfig) -> &'static str {
    if browser_binding::host_only(config) {
        HOST_COOKIE_NAME
    } else {
        COOKIE_NAME
    }
}

pub fn presented(headers: &HeaderMap, config: &ServerConfig) -> Option<String> {
    let wanted = cookie_name(config);
    let tokens: BTreeSet<&str> = headers
        .get_all(COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .filter(|(name, _)| *name == wanted)
        .map(|(_, value)| value.trim())
        .filter(|value| {
            value.len() == TOKEN_CHARS
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        })
        .collect();
    let mut tokens = tokens.into_iter();
    match (tokens.next(), tokens.next()) {
        (Some(token), None) => Some(token.to_string()),
        _ => None,
    }
}

fn plain_loopback(config: &ServerConfig) -> bool {
    if config.public_url.scheme() != "http" {
        return false;
    }
    match config.public_url.host() {
        Some(Host::Ipv4(address)) => address.is_loopback(),
        Some(Host::Ipv6(address)) => address.is_loopback(),
        Some(Host::Domain(name)) => {
            name.eq_ignore_ascii_case("localhost")
                || name.to_ascii_lowercase().ends_with(".localhost")
        }
        None => false,
    }
}

fn cookie_with(config: &ServerConfig, value: &str, max_age: i64) -> HeaderValue {
    let secure = if plain_loopback(config) {
        ""
    } else {
        "; Secure"
    };
    let path = format!("{}/", config.path_prefix());
    let name = cookie_name(config);
    HeaderValue::from_str(&format!(
        "{name}={value}; Path={path}; Max-Age={max_age}; HttpOnly; SameSite=Lax{secure}"
    ))
    .unwrap_or_else(|_| HeaderValue::from_static("oleafly_web=; Path=/; Max-Age=0"))
}

pub fn cookie(config: &ServerConfig, token: &str) -> HeaderValue {
    cookie_with(config, token, SESSION_TTL_MS / 1000)
}

pub fn cleared_cookie(config: &ServerConfig) -> HeaderValue {
    cookie_with(config, "", 0)
}

#[cfg(test)]
mod tests {
    use oleafly_collab_protocol::roles::ServerRole;
    use ring::signature::UnparsedPublicKey;

    use super::*;
    use crate::db::Db;
    use crate::test_support::test_config;

    #[test]
    fn only_paths_inside_the_browser_app_are_returned_to() {
        assert_eq!(return_path(None), HOME);
        assert_eq!(return_path(Some("")), HOME);
        for kept in [
            "/web/",
            "/web",
            "/web/?project=abc",
            "/web/projects?x=1#top",
        ] {
            assert_eq!(return_path(Some(kept)), kept);
        }
        for refused in [
            "https://evil.example/web/",
            "//evil.example/web/",
            "/webby",
            "/api/v1/me",
            "/web/\\evil",
            "/web/\nSet-Cookie: x",
            "web/",
        ] {
            assert_eq!(return_path(Some(refused)), HOME, "{refused:?}");
        }
        assert_eq!(
            return_path(Some(&format!("/web/{}", "a".repeat(600)))),
            HOME
        );
    }

    #[test]
    fn a_web_sign_in_is_known_by_its_platform_and_return_path() {
        let web = pending(
            "github",
            "/web/?project=p",
            "Firefox on Linux",
            "b".into(),
            5,
        );
        assert!(is_web(&web));
        assert_eq!(return_of(&web), Some("/web/?project=p"));
        assert_eq!(web.platform, PLATFORM);
        let mut app = web.clone();
        app.redirect_uri = "http://127.0.0.1:9/callback".into();
        app.platform = "macos".into();
        assert!(!is_web(&app));
        let mut code = web.clone();
        code.device_authorization = Some("authorization".into());
        assert!(!is_web(&code));
    }

    #[test]
    fn browsers_are_named_from_their_user_agent() {
        let named = |agent: &str| {
            let mut headers = HeaderMap::new();
            headers.insert(USER_AGENT, HeaderValue::from_str(agent).unwrap());
            browser_name(&headers)
        };
        assert_eq!(
            named("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"),
            "Safari on macOS"
        );
        assert_eq!(
            named("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0"),
            "Edge on Windows"
        );
        assert_eq!(
            named("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"),
            "Firefox on Linux"
        );
        assert_eq!(browser_name(&HeaderMap::new()), "Web browser");
    }

    #[test]
    fn the_session_key_comes_from_the_cookie_and_signs_as_the_device() {
        let token = random_token();
        let key = signing_key(&token).unwrap();
        assert_eq!(
            signing_key(&token).unwrap().public_key().as_ref(),
            key.public_key().as_ref()
        );
        assert_ne!(
            signing_key(&random_token()).unwrap().public_key().as_ref(),
            key.public_key().as_ref()
        );
        let signature = key.sign(b"change");
        let public =
            oleafly_collab_protocol::crypto::b64url_decode(&public_key_of(&token).unwrap())
                .unwrap();
        assert!(UnparsedPublicKey::new(&ring::signature::ED25519, public)
            .verify(b"change", signature.as_ref())
            .is_ok());
    }

    #[test]
    fn the_cookie_is_secure_except_over_plain_http_on_this_computer() {
        let mut config = test_config();
        let text = cookie(&config, "abc").to_str().unwrap().to_owned();
        for part in [
            "oleafly_web=abc;",
            "Path=/;",
            "Max-Age=2592000",
            "HttpOnly",
            "SameSite=Lax",
            "Secure",
        ] {
            assert!(text.contains(part), "{text} lacks {part}");
        }
        for loopback in [
            "http://127.0.0.1:8787/",
            "http://localhost:8787/",
            "http://[::1]:8787/",
        ] {
            config.public_url = url::Url::parse(loopback).unwrap();
            let text = cookie(&config, "abc").to_str().unwrap().to_owned();
            assert!(!text.contains("Secure"), "{text}");
        }
        config.public_url = url::Url::parse("http://lab.example.edu/").unwrap();
        assert!(cookie(&config, "abc").to_str().unwrap().contains("Secure"));
        config.public_url = url::Url::parse("https://uni.edu/oleafly/").unwrap();
        let cleared = cleared_cookie(&config).to_str().unwrap().to_owned();
        assert!(cleared.contains("Path=/oleafly/;"), "{cleared}");
        assert!(cleared.contains("Max-Age=0"), "{cleared}");
    }

    fn carrying(cookies: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(COOKIE, HeaderValue::from_str(cookies).unwrap());
        headers
    }

    #[test]
    fn only_a_well_formed_session_cookie_is_read() {
        let mut config = test_config();
        config.public_url = url::Url::parse("https://uni.edu/oleafly/").unwrap();
        let token = random_token();
        let headers = carrying(&format!(
            "theme=dark; oleafly_web=short; oleafly_web={token}; oleafly_web={token}"
        ));
        assert_eq!(presented(&headers, &config), Some(token));
        assert_eq!(presented(&HeaderMap::new(), &config), None);
    }

    #[test]
    fn a_session_cookie_planted_beside_the_real_one_is_not_trusted() {
        let mut config = test_config();
        config.public_url = url::Url::parse("https://uni.edu/oleafly/").unwrap();
        let (mine, planted) = (random_token(), random_token());
        let both = carrying(&format!("oleafly_web={planted}; oleafly_web={mine}"));
        assert_eq!(presented(&both, &config), None);
        config.public_url = url::Url::parse("https://collab.uni.edu/").unwrap();
        assert_eq!(cookie_name(&config), HOST_COOKIE_NAME);
        let text = cookie(&config, &mine).to_str().unwrap().to_owned();
        assert!(
            text.starts_with(&format!("__Host-oleafly_web={mine}; Path=/;")),
            "{text}"
        );
        assert!(
            text.contains("Secure") && !text.contains("Domain"),
            "{text}"
        );
        let sibling = carrying(&format!("oleafly_web={planted}; __Host-oleafly_web={mine}"));
        assert_eq!(presented(&sibling, &config), Some(mine));
        assert_eq!(
            presented(&carrying(&format!("oleafly_web={planted}")), &config),
            None
        );
    }

    #[tokio::test]
    async fn a_session_is_a_device_that_changes_mode_signs_out_and_expires() {
        let db = Db::open_in_memory().unwrap();
        let (ada, opened, caller, platform, late, mode, wrong, pruned, after, revoked) = db
            .call(|conn| {
                let ada = members::create_account(conn, "Ada", None, ServerRole::Member, 1)?;
                let pending = pending("github", "/web/", "Firefox on Linux", "b".into(), 1);
                let opened = open(conn, &pending, ada, None, 10)?;
                let caller = resolve(conn, &opened.token, 11)?;
                let platform: String = conn.query_row(
                    "SELECT platform FROM devices WHERE id = ?1",
                    [opened.device_id.to_string()],
                    |row| row.get(0),
                )?;
                let late = resolve(conn, &opened.token, 10 + SESSION_TTL_MS).map_err(|e| e.code());
                set_mode(conn, opened.device_id, SUGGESTING)?;
                let mode = resolve(conn, &opened.token, 12)?.mode;
                let wrong = resolve(conn, &random_token(), 12).map_err(|e| e.code());
                let pruned = prune(conn, 10 + SESSION_TTL_MS)?;
                let after = resolve(conn, &opened.token, 12).map_err(|e| e.code());
                let revoked: Option<i64> = conn.query_row(
                    "SELECT revoked_at FROM devices WHERE id = ?1",
                    [opened.device_id.to_string()],
                    |row| row.get(0),
                )?;
                Ok((
                    ada, opened, caller, platform, late, mode, wrong, pruned, after, revoked,
                ))
            })
            .await
            .unwrap();
        assert!(opened.added);
        assert_eq!(caller.account_id, ada);
        assert_eq!(caller.device_id, opened.device_id);
        assert_eq!(caller.public_key, public_key_of(&opened.token).unwrap());
        assert_eq!(caller.mode, EDITING);
        assert_eq!(platform, PLATFORM);
        assert_eq!(late, Err("session_expired"));
        assert_eq!(mode, SUGGESTING);
        assert_eq!(wrong, Err("unauthorized"));
        assert_eq!(pruned, vec![opened.device_id]);
        assert_eq!(after, Err("unauthorized"));
        assert!(revoked.is_some());
    }
}
