//! Tauri commands for Git hosting accounts. Tokens and device codes stay in
//! Rust: the webview sends a pasted token once and gets back only accounts.
use super::{
    account_and_token, app_error, host_label, http_for_async, mirror_legacy_github_or_log,
    normalized_base, now_ms, sign_out_here, store, ACCOUNTS_CHANGED_EVENT,
};
use oleafly_forge::accounts::{self, AccountCheck};
use oleafly_forge::api::{self, ForgeRepo, RepoPage, Session};
use oleafly_forge::detect;
use oleafly_forge::http::{ForgeHttp, CA_FILE_MAX_BYTES};
use oleafly_forge::kind::{ForgeKind, ServerFlavor, GITHUB_COM};
use oleafly_forge::oauth::{self, DevicePoll, TokenGrant};
use oleafly_forge::repo_path::valid_repo_name;
use oleafly_forge::{ForgeAccount, ForgeError, ForgeStore};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const REPO_PAGE_MAX: u32 = 1000;
const QUERY_MAX_CHARS: usize = 100;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeServerInfo {
    base: String,
    kind: Option<ForgeKind>,
    flavor: Option<ServerFlavor>,
    /// Whether "Sign in with the browser" is offered for this server.
    device_flow: bool,
}

/// A started browser sign-in. The device code stays in Rust under `flow_id`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeDeviceStart {
    flow_id: String,
    user_code: String,
    verification_uri: String,
    verification_uri_complete: Option<String>,
    expires_in: u64,
    interval: u64,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ForgeDevicePoll {
    Pending,
    SlowDown { interval: u64 },
    Done { account: ForgeAccount },
}

struct PendingFlow {
    base: String,
    kind: ForgeKind,
    client_id: &'static str,
    device_code: String,
    expires_at: Instant,
    polling: bool,
    /// The server's grant, kept from the moment it comes until the account
    /// is saved. The device code is spent by then, so a failure while
    /// reading the user (a network blip) is retried from the grant.
    granted: Option<TokenGrant>,
}

fn pending() -> std::sync::MutexGuard<'static, HashMap<String, PendingFlow>> {
    static FLOWS: OnceLock<Mutex<HashMap<String, PendingFlow>>> = OnceLock::new();
    FLOWS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

fn new_flow_id() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn notify_changed(app: &AppHandle) {
    let _ = app.emit(ACCOUNTS_CHANGED_EVENT, ());
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

/// A CA file is read only when the user picked it in Oleafly's dialog or the
/// account for `base` already trusts it.
async fn require_picked_ca_file(base: &str, ca_file: &Option<String>) -> Result<(), String> {
    let base = base.to_owned();
    let ca_file = ca_file.clone();
    blocking(move || ca_file_allowed(store, &base, ca_file.as_deref())).await
}

/// `require_picked_ca_file` against the account store `store` opens, which
/// is opened only when the path wasn't picked.
fn ca_file_allowed(
    store: impl FnOnce() -> Result<ForgeStore, String>,
    base: &str,
    ca_file: Option<&str>,
) -> Result<(), String> {
    let Some(path) = ca_file.map(str::trim).filter(|path| !path.is_empty()) else {
        return Ok(());
    };
    if crate::path_grants::granted(crate::path_grants::Access::Open, std::path::Path::new(path)) {
        return Ok(());
    }
    let trusted = store()?
        .account(base)
        .ok()
        .flatten()
        .and_then(|account| account.ca_file);
    if trusted.as_deref() == Some(path) {
        return Ok(());
    }
    crate::path_grants::require_open(path)
}

/// A CA file the user picked: an absolute path to a readable certificate
/// file of at most 1 MB. `None` clears it.
pub(crate) fn checked_ca_file(ca_file: Option<String>) -> Result<Option<String>, ForgeError> {
    let Some(path) = ca_file
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
    else {
        return Ok(None);
    };
    let candidate = std::path::Path::new(&path);
    if !candidate.is_absolute() {
        return Err(ForgeError::CaFile {
            detail: "choose the file again".into(),
        });
    }
    let size = std::fs::metadata(candidate)
        .map_err(|error| ForgeError::CaFile {
            detail: format!("the file could not be opened ({})", error.kind()),
        })?
        .len();
    if size > CA_FILE_MAX_BYTES {
        return Err(ForgeError::CaFile {
            detail: "the file is larger than 1 MB".into(),
        });
    }
    ForgeHttp::load_ca_certificates(candidate)?;
    Ok(Some(path))
}

/// Every account, in the order they were added. A token saved without an
/// account (by the command-line tool) gets its account in the background.
#[tauri::command]
pub async fn forge_accounts_list(app: AppHandle) -> Result<Vec<ForgeAccount>, String> {
    let (store, accounts, orphans) = blocking(|| {
        let store = store()?;
        let accounts = store.accounts().map_err(|error| app_error(&error, ""))?;
        let orphans = store.orphan_bases().unwrap_or_default();
        Ok((store, accounts, orphans))
    })
    .await?;
    adopt_in_background(app, store, orphans);
    Ok(accounts)
}

/// Complete each orphaned token once per session, without delaying the list.
fn adopt_in_background(app: AppHandle, store: ForgeStore, orphans: Vec<String>) {
    static TRIED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    let mut tried = TRIED
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let fresh: Vec<String> = orphans
        .into_iter()
        .filter(|base| tried.insert(base.clone()))
        .collect();
    drop(tried);
    if fresh.is_empty() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let Ok(http) = http_for_async(None).await else {
            return;
        };
        let mut adopted = false;
        for base in fresh {
            adopted |= accounts::adopt_orphan(&store, &http, &base, now_ms())
                .await
                .is_ok();
        }
        if adopted {
            notify_changed(&app);
        }
    });
}

/// What kind of server an address is, and whether it offers a browser
/// sign-in in this build.
#[tauri::command]
pub async fn forge_detect(
    base: String,
    ca_file: Option<String>,
) -> Result<ForgeServerInfo, String> {
    let base = normalized_base(&base)?;
    let host = host_label(&base);
    let fail = |error: ForgeError| app_error(&error, &host);
    require_picked_ca_file(&base, &ca_file).await?;
    let ca_file = checked_ca_file(ca_file).map_err(fail)?;
    let http = http_for_async(ca_file).await.map_err(fail)?;
    let info = detect::detect_server(&http, &base).await.map_err(fail)?;
    Ok(ForgeServerInfo {
        device_flow: oauth::device_client_id(&info.base).is_some(),
        base: info.base,
        kind: info.kind,
        flavor: info.flavor,
    })
}

/// Sign in with a pasted access token. The token is checked with the server
/// and stored in Rust; the webview gets the account back. `ca_file` is the
/// certificate authority file of the account after signing in: a path sets
/// it, an empty string clears it, and none keeps the one the account has.
#[tauri::command]
pub async fn forge_sign_in_token(
    app: AppHandle,
    base: String,
    kind: ForgeKind,
    token: String,
    ca_file: Option<String>,
) -> Result<ForgeAccount, String> {
    let base = normalized_base(&base)?;
    let host = host_label(&base);
    let fail = |error: ForgeError| app_error(&error, &host);
    let clear_ca = ca_file
        .as_deref()
        .is_some_and(|path| path.trim().is_empty());
    require_picked_ca_file(&base, &ca_file).await?;
    let ca_file = checked_ca_file(ca_file).map_err(fail)?;
    let store = blocking(store).await?;
    // The sign-in itself trusts what the account will trust afterwards.
    let used_ca = match &ca_file {
        Some(_) => ca_file.clone(),
        None if clear_ca => None,
        None => {
            let (store, lookup) = (store.clone(), base.clone());
            blocking(move || {
                Ok(store
                    .account(&lookup)
                    .map_err(|error| app_error(&error, &host_label(&lookup)))?
                    .and_then(|account| account.ca_file))
            })
            .await?
        }
    };
    let http = http_for_async(used_ca).await.map_err(fail)?;
    let account = accounts::sign_in_with_token(
        &store,
        &http,
        &base,
        kind,
        &token,
        if clear_ca {
            Some("")
        } else {
            ca_file.as_deref()
        },
        now_ms(),
    )
    .await
    .map_err(fail)?;
    if base == GITHUB_COM {
        let token = token.trim().to_string();
        let login = account.login.clone();
        let mirrored = base.clone();
        let _ = blocking(move || {
            mirror_legacy_github_or_log(&mirrored, Some((&token, &login)));
            Ok(())
        })
        .await;
    }
    notify_changed(&app);
    Ok(account)
}

/// Ask a server with a device flow for a sign-in code. Keeps the device code
/// and hands back an opaque flow id.
pub(crate) async fn begin_device_flow(
    http: &ForgeHttp,
    kind: ForgeKind,
    base: &str,
    client_id: &'static str,
) -> Result<ForgeDeviceStart, ForgeError> {
    let started = oauth::device_start(http, kind, base, client_id).await?;
    let flow_id = new_flow_id();
    let now = Instant::now();
    let mut flows = pending();
    flows.retain(|_, flow| flow.expires_at > now);
    flows.insert(
        flow_id.clone(),
        PendingFlow {
            base: base.to_string(),
            kind,
            client_id,
            device_code: started.device_code,
            // A little longer than the server's own expiry, so the server
            // decides when the code expired.
            expires_at: now + Duration::from_secs(started.expires_in.saturating_add(30)),
            polling: false,
            granted: None,
        },
    );
    Ok(ForgeDeviceStart {
        flow_id,
        user_code: started.user_code,
        verification_uri: started.verification_uri,
        verification_uri_complete: started.verification_uri_complete,
        expires_in: started.expires_in,
        interval: started.interval,
    })
}

#[tauri::command]
pub async fn forge_device_start(base: String) -> Result<ForgeDeviceStart, String> {
    let base = normalized_base(&base)?;
    let host = host_label(&base);
    let fail = |error: ForgeError| app_error(&error, &host);
    let (kind, client_id) =
        oauth::device_client_id(&base).ok_or_else(|| fail(ForgeError::DeviceFlowUnavailable))?;
    let http = http_for_async(None).await.map_err(fail)?;
    begin_device_flow(&http, kind, &base, client_id)
        .await
        .map_err(fail)
}

/// What one poll of a device flow found. `Done` carries the saved account.
pub(crate) async fn poll_device_flow(
    store: &ForgeStore,
    http: &ForgeHttp,
    flow_id: &str,
    now_ms: u64,
) -> Result<(ForgeDevicePoll, Option<String>), ForgeError> {
    let (base, kind, client_id, device_code, granted) = {
        let mut flows = pending();
        let now = Instant::now();
        flows.retain(|_, flow| flow.expires_at > now);
        let Some(flow) = flows.get_mut(flow_id) else {
            return Err(ForgeError::SignInExpired);
        };
        // A double click or an overlapping timer: one poll at a time.
        if flow.polling {
            return Ok((ForgeDevicePoll::Pending, None));
        }
        flow.polling = true;
        (
            flow.base.clone(),
            flow.kind,
            flow.client_id,
            flow.device_code.clone(),
            flow.granted.clone(),
        )
    };
    let finish = |remove: bool| {
        let mut flows = pending();
        if remove {
            flows.remove(flow_id);
        } else if let Some(flow) = flows.get_mut(flow_id) {
            flow.polling = false;
        }
    };
    let polled = match granted {
        // The server already granted this sign-in; only saving is left.
        Some(grant) => Ok(DevicePoll::Granted(grant)),
        None => oauth::device_poll(http, kind, &base, client_id, &device_code).await,
    };
    match polled {
        Ok(DevicePoll::Pending) => {
            finish(false);
            Ok((ForgeDevicePoll::Pending, None))
        }
        Ok(DevicePoll::SlowDown { interval }) => {
            finish(false);
            Ok((ForgeDevicePoll::SlowDown { interval }, None))
        }
        Ok(DevicePoll::Granted(grant)) => {
            if let Some(flow) = pending().get_mut(flow_id) {
                flow.granted = Some(grant.clone());
            }
            let token = grant.access_token.clone();
            match accounts::finish_device_sign_in(store, http, &base, kind, grant, now_ms).await {
                Ok(account) => {
                    finish(true);
                    Ok((ForgeDevicePoll::Done { account }, Some(token)))
                }
                Err(error) => {
                    // The grant stays: the next poll saves from it.
                    finish(false);
                    Err(error)
                }
            }
        }
        Err(error @ (ForgeError::SignInExpired | ForgeError::SignInDenied)) => {
            finish(true);
            Err(error)
        }
        Err(error) => {
            finish(false);
            Err(error)
        }
    }
}

fn flow_host(flow_id: &str) -> String {
    pending()
        .get(flow_id)
        .map(|flow| host_label(&flow.base))
        .unwrap_or_default()
}

#[tauri::command]
pub async fn forge_device_poll(app: AppHandle, flow_id: String) -> Result<ForgeDevicePoll, String> {
    let host = flow_host(&flow_id);
    let fail = |error: ForgeError| app_error(&error, &host);
    let http = http_for_async(None).await.map_err(fail)?;
    let store = blocking(store).await?;
    let (poll, token) = poll_device_flow(&store, &http, &flow_id, now_ms())
        .await
        .map_err(fail)?;
    if let ForgeDevicePoll::Done { account } = &poll {
        if let Some(token) = token.filter(|_| account.base == GITHUB_COM) {
            let base = account.base.clone();
            let login = account.login.clone();
            let _ = blocking(move || {
                mirror_legacy_github_or_log(&base, Some((&token, &login)));
                Ok(())
            })
            .await;
        }
        notify_changed(&app);
    }
    Ok(poll)
}

#[tauri::command]
pub async fn forge_device_cancel(flow_id: String) -> Result<(), String> {
    pending().remove(&flow_id);
    Ok(())
}

/// Forget an account and its token on this device. Tokens stay valid on the
/// server until the user revokes them there.
#[tauri::command]
pub async fn forge_sign_out(app: AppHandle, base: String) -> Result<(), String> {
    let base = normalized_base(&base)?;
    blocking(move || sign_out_here(&base)).await?;
    notify_changed(&app);
    Ok(())
}

/// Set or clear an account's certificate authority file.
#[tauri::command]
pub async fn forge_set_ca_file(
    app: AppHandle,
    base: String,
    ca_file: Option<String>,
) -> Result<ForgeAccount, String> {
    let base = normalized_base(&base)?;
    let host = host_label(&base);
    require_picked_ca_file(&base, &ca_file).await?;
    let ca_file = checked_ca_file(ca_file).map_err(|error| app_error(&error, &host))?;
    let account = blocking(move || {
        let store = store()?;
        // Only the CA file changes, in the account as it is now.
        store
            .set_ca_file(&base, ca_file)
            .map_err(|error| app_error(&error, &host))?
            .ok_or_else(|| {
                String::from(
                    crate::app_error::AppError::new("git.account_missing").param("host", &host),
                )
            })
    })
    .await?;
    notify_changed(&app);
    Ok(account)
}

/// Check that an account still works: `ok`, `signed_out` (revoked or
/// expired) or `unreachable`. A changed name or picture is saved.
#[tauri::command]
pub async fn forge_validate(app: AppHandle, base: String) -> Result<AccountCheck, String> {
    let base = normalized_base(&base)?;
    let host = host_label(&base);
    let fail = |error: ForgeError| app_error(&error, &host);
    let lookup = base.clone();
    let (store, ca_file) = blocking(move || {
        let store = store()?;
        let ca_file = store
            .account(&lookup)
            .map_err(|error| app_error(&error, &host_label(&lookup)))?
            .and_then(|account| account.ca_file);
        Ok((store, ca_file))
    })
    .await?;
    let http = match http_for_async(ca_file).await {
        Ok(http) => http,
        // A CA file that went missing reads as an unreachable server.
        Err(ForgeError::CaFile { .. }) => http_for_async(None).await.map_err(fail)?,
        Err(error) => return Err(fail(error)),
    };
    let check = accounts::check_account(&store, &http, &base, now_ms())
        .await
        .map_err(fail)?;
    if check.changed {
        notify_changed(&app);
    }
    Ok(check)
}

/// One page of the account's repositories. GitLab searches on the server
/// (`searched`); the others leave filtering to the caller.
#[tauri::command]
pub async fn forge_list_repos(
    base: String,
    page: u32,
    query: Option<String>,
) -> Result<RepoPage, String> {
    let (account, token, http) = account_and_token(&base).await?;
    let host = host_label(&account.base);
    let query = query
        .map(|query| {
            query
                .trim()
                .chars()
                .take(QUERY_MAX_CHARS)
                .collect::<String>()
        })
        .filter(|query| !query.is_empty());
    let session = Session {
        http: &http,
        kind: account.kind,
        base: &account.base,
        token: &token.token,
    };
    api::list_repos(&session, page.clamp(1, REPO_PAGE_MAX), query.as_deref())
        .await
        .map_err(|error| app_error(&error, &host))
}

/// Create an empty repository on the account.
#[tauri::command]
pub async fn forge_create_repo(
    base: String,
    name: String,
    private: bool,
) -> Result<ForgeRepo, String> {
    let name = name.trim().to_string();
    if !valid_repo_name(&name) {
        return Err(app_error(
            &ForgeError::InvalidRepositoryName,
            &host_label(base.trim()),
        ));
    }
    let (account, token, http) = account_and_token(&base).await?;
    let host = host_label(&account.base);
    let session = Session {
        http: &http,
        kind: account.kind,
        base: &account.base,
        token: &token.token,
    };
    api::create_repo(&session, &name, private)
        .await
        .map_err(|error| app_error(&error, &host))
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_forge::test_support::{MockResponse, MockServer};

    const START: &str = r#"{"device_code":"device-code-secret","user_code":"ABCD-1234","verification_uri":"https://gitlab.example/oauth/device","expires_in":900,"interval":5}"#;
    const USER: &str = r#"{"username":"octo","name":"Octo Cat"}"#;

    #[test]
    fn a_ca_file_is_read_only_when_picked_or_already_trusted() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let base = "https://gitlab.example";
        let trusted = dir.path().join("trusted.pem");
        let picked = dir.path().join("picked.pem");
        let planted = dir.path().join("planted.pem");
        for file in [&trusted, &picked, &planted] {
            std::fs::write(file, b"-----BEGIN CERTIFICATE-----").unwrap();
        }
        let trusted = trusted.to_string_lossy().into_owned();
        let picked = picked.to_string_lossy().into_owned();
        let planted = planted.to_string_lossy().into_owned();
        store
            .save(
                ForgeAccount {
                    base: base.into(),
                    kind: ForgeKind::GitLab,
                    flavor: None,
                    login: "octo".into(),
                    name: None,
                    avatar_url: None,
                    ca_file: Some(trusted.clone()),
                    auth: oleafly_forge::AuthMethod::Token,
                    added_at: 1_760_000_000_000,
                },
                oleafly_forge::ForgeToken {
                    token: "glpat-test".into(),
                    refresh: None,
                    expires_at: None,
                },
            )
            .unwrap();
        let open = || -> Result<ForgeStore, String> { Ok(ForgeStore::new(dir.path())) };
        let unopened = || -> Result<ForgeStore, String> { panic!("the store isn't needed") };

        assert_eq!(ca_file_allowed(unopened, base, None), Ok(()));
        assert_eq!(ca_file_allowed(unopened, base, Some("  ")), Ok(()));
        assert_eq!(ca_file_allowed(open, base, Some(&trusted)), Ok(()));
        let refusal = ca_file_allowed(open, base, Some(&planted)).unwrap_err();
        assert!(refusal.contains("file picker"), "{refusal}");
        let elsewhere = ca_file_allowed(open, "https://other.example", Some(&trusted));
        assert!(elsewhere.is_err());
        crate::path_grants::grant(
            crate::path_grants::Access::Open,
            std::path::Path::new(&picked),
        );
        assert_eq!(ca_file_allowed(unopened, base, Some(&picked)), Ok(()));
        assert_eq!(
            ca_file_allowed(|| Err("no store".to_string()), base, Some(&planted)),
            Err("no store".to_string())
        );
    }

    #[tokio::test]
    async fn device_start_keeps_the_device_code_in_rust() {
        let server = MockServer::start(vec![MockResponse::json(200, START)]);
        let http = ForgeHttp::new(None).unwrap();
        let started = begin_device_flow(&http, ForgeKind::GitLab, &server.url(), "client")
            .await
            .unwrap();
        let json = serde_json::to_string(&started).unwrap();
        assert!(!json.contains("device-code-secret"), "{json}");
        assert!(json.contains("\"flowId\""), "{json}");
        assert!(json.contains("ABCD-1234"), "{json}");
        assert_eq!(started.flow_id.len(), 32);
        pending().remove(&started.flow_id);
    }

    #[tokio::test]
    async fn a_granted_device_flow_saves_the_account_once() {
        let server = MockServer::start(vec![
            MockResponse::json(200, START).on("POST", "/oauth/authorize_device"),
            MockResponse::json(
                200,
                r#"{"access_token":"oauth-access-1","refresh_token":"oauth-refresh-1","expires_in":7200}"#,
            )
            .on("POST", "/oauth/token"),
            MockResponse::json(200, USER).on("GET", "/api/v4/user"),
        ]);
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let http = ForgeHttp::new(None).unwrap();
        let started = begin_device_flow(&http, ForgeKind::GitLab, &server.url(), "client")
            .await
            .unwrap();
        let (poll, token) = poll_device_flow(&store, &http, &started.flow_id, 1_000)
            .await
            .unwrap();
        let ForgeDevicePoll::Done { account } = poll else {
            panic!("a granted flow is done");
        };
        assert_eq!(account.login, "octo");
        assert_eq!(token.as_deref(), Some("oauth-access-1"));
        assert_eq!(store.accounts().unwrap().len(), 1);
        let json = serde_json::to_string(&ForgeDevicePoll::Done { account }).unwrap();
        assert!(!json.contains("oauth-access-1") && !json.contains("oauth-refresh-1"));
        assert!(json.contains("\"status\":\"done\""), "{json}");

        let again = poll_device_flow(&store, &http, &started.flow_id, 1_000).await;
        assert!(matches!(again, Err(ForgeError::SignInExpired)));
    }

    #[tokio::test]
    async fn a_failed_user_read_after_the_grant_is_retried_from_the_kept_grant() {
        let server = MockServer::start(vec![
            MockResponse::json(200, START).on("POST", "/oauth/authorize_device"),
            MockResponse::json(
                200,
                r#"{"access_token":"oauth-access-1","refresh_token":"oauth-refresh-1","expires_in":7200}"#,
            )
            .on("POST", "/oauth/token"),
            MockResponse::json(502, r#"{"message":"bad gateway"}"#).on("GET", "/api/v4/user"),
            MockResponse::json(200, USER).on("GET", "/api/v4/user"),
        ]);
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let http = ForgeHttp::new(None).unwrap();
        let started = begin_device_flow(&http, ForgeKind::GitLab, &server.url(), "client")
            .await
            .unwrap();

        let first = poll_device_flow(&store, &http, &started.flow_id, 1_000).await;
        assert!(matches!(first, Err(ForgeError::Server { status: 502, .. })));
        assert!(store.accounts().unwrap().is_empty());
        assert!(
            pending().get(&started.flow_id).is_some(),
            "the approved sign-in is not lost"
        );

        let (poll, token) = poll_device_flow(&store, &http, &started.flow_id, 1_000)
            .await
            .unwrap();
        let ForgeDevicePoll::Done { account } = poll else {
            panic!("the kept grant finishes the sign-in");
        };
        assert_eq!(account.login, "octo");
        assert_eq!(token.as_deref(), Some("oauth-access-1"));
        assert_eq!(store.accounts().unwrap().len(), 1);
        let token_requests = server
            .requests()
            .iter()
            .filter(|request| request.path == "/oauth/token")
            .count();
        assert_eq!(token_requests, 1, "the spent device code is not used again");
        assert!(pending().get(&started.flow_id).is_none());
    }

    #[tokio::test]
    async fn an_overlapping_poll_reports_pending() {
        let server = MockServer::start(vec![MockResponse::json(200, START)]);
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let http = ForgeHttp::new(None).unwrap();
        let started = begin_device_flow(&http, ForgeKind::GitLab, &server.url(), "client")
            .await
            .unwrap();
        pending().get_mut(&started.flow_id).unwrap().polling = true;
        let (poll, _) = poll_device_flow(&store, &http, &started.flow_id, 1)
            .await
            .unwrap();
        assert!(matches!(poll, ForgeDevicePoll::Pending));
        assert_eq!(server.requests().len(), 1, "no second request went out");
        pending().remove(&started.flow_id);
    }

    #[tokio::test]
    async fn a_denied_sign_in_ends_the_flow() {
        let server = MockServer::start(vec![
            MockResponse::json(200, START).on("POST", "/oauth/authorize_device"),
            MockResponse::json(400, r#"{"error":"access_denied"}"#).on("POST", "/oauth/token"),
        ]);
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let http = ForgeHttp::new(None).unwrap();
        let started = begin_device_flow(&http, ForgeKind::GitLab, &server.url(), "client")
            .await
            .unwrap();
        assert!(matches!(
            poll_device_flow(&store, &http, &started.flow_id, 1).await,
            Err(ForgeError::SignInDenied)
        ));
        assert!(pending().get(&started.flow_id).is_none());
    }

    #[test]
    fn poll_states_serialize_with_a_status_tag() {
        assert_eq!(
            serde_json::to_value(ForgeDevicePoll::SlowDown { interval: 10 }).unwrap(),
            serde_json::json!({ "status": "slow_down", "interval": 10 })
        );
        assert_eq!(
            serde_json::to_value(ForgeDevicePoll::Pending).unwrap(),
            serde_json::json!({ "status": "pending" })
        );
    }

    #[test]
    fn ca_files_must_be_absolute_and_small() {
        assert_eq!(checked_ca_file(None).unwrap(), None);
        assert_eq!(checked_ca_file(Some("  ".into())).unwrap(), None);
        assert!(matches!(
            checked_ca_file(Some("certs/corp.pem".into())),
            Err(ForgeError::CaFile { .. })
        ));
        let dir = tempfile::tempdir().unwrap();
        let large = dir.path().join("large ca.pem");
        std::fs::write(&large, vec![b'a'; 2 * 1024 * 1024]).unwrap();
        assert!(matches!(
            checked_ca_file(Some(large.to_string_lossy().into_owned())),
            Err(ForgeError::CaFile { .. })
        ));
        let missing = dir.path().join("missing.pem");
        assert!(matches!(
            checked_ca_file(Some(missing.to_string_lossy().into_owned())),
            Err(ForgeError::CaFile { .. })
        ));
    }
}
