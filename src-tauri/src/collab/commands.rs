use std::future::Future;
use std::pin::Pin;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use oleafly_collab::{
    sign_in_as, sign_in_with_code_as, test_connection_pinned, CodeSignInRequest, CollabError,
    ConnectionCheck, ServerClient, ServerEntry, ServerUrl, SignInCode, SignInRequest,
};
use oleafly_collab_protocol::admin::{
    AllowlistEntry, DomainRule, MemberPatch, MemberSummary, NewAllowlistEntry, NewDomainRule, Page,
    RuntimeSettings, RuntimeSettingsPatch, SecurityEvent,
};
use oleafly_collab_protocol::auth::{
    AccountSummary, DeviceSummary, SessionEndReason, SessionTokens,
};
use oleafly_collab_protocol::capabilities::{
    negotiate, CapabilityManifest, ProtocolRange, VersionMismatch, PROTOCOL_VERSION,
};
use oleafly_collab_protocol::ids::{AccountId, DeviceId, ServerId};
use serde::Serialize;
use tauri::Emitter;

use super::state::CollabState;

pub const SERVER_CHANGED_EVENT: &str = "collab-server-changed";
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);

pub(crate) type ApiCall<'a, T> = Pin<Box<dyn Future<Output = Result<T, CollabError>> + Send + 'a>>;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CollabCommandError {
    pub code: &'static str,
    pub message: String,
}

impl From<CollabError> for CollabCommandError {
    fn from(error: CollabError) -> Self {
        let (code, message) = match error {
            CollabError::Network(message) => ("unreachable", message),
            CollabError::NotHttps => ("not_https", String::new()),
            CollabError::ProtocolMismatch(VersionMismatch::ClientTooOld) => {
                ("client_too_old", String::new())
            }
            CollabError::ProtocolMismatch(VersionMismatch::ServerTooOld) => {
                ("server_too_old", String::new())
            }
            CollabError::Api {
                status,
                code,
                message,
            } => (api_code(status, &code), message),
            CollabError::NotAdmitted => ("not_admitted", String::new()),
            CollabError::SignInCancelled => ("sign_in_cancelled", String::new()),
            CollabError::SignInTimedOut => ("sign_in_timed_out", String::new()),
            CollabError::Unauthorized | CollabError::SessionEnded(_) => {
                ("unauthorized", String::new())
            }
            CollabError::ServerChanged { expected, found } => {
                ("server_changed", format!("{expected} {found}"))
            }
            CollabError::DuplicateServer { url } => ("duplicate_server", url),
            CollabError::Io(message)
            | CollabError::Corrupt(message)
            | CollabError::Secret(message)
            | CollabError::Crypto(message)
            | CollabError::InvalidPath(message) => ("internal", message),
        };
        CollabCommandError { code, message }
    }
}

fn api_code(status: u16, code: &str) -> &'static str {
    match (code, status) {
        ("not_admitted", _) => "not_admitted",
        ("setup_code_invalid", _) => "setup_code_invalid",
        ("device_in_use", _) => "device_in_use",
        ("server_unknown", _) => "server_unknown",
        ("too_large", _) | (_, 413) => "too_large",
        ("rate_limited", _) | (_, 429) => "rate_limited",
        (_, 401) => "unauthorized",
        (_, 403) => "forbidden",
        (_, 404) => "not_found",
        (_, 409) => "conflict",
        _ => "server",
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct CollabServer {
    pub server_id: ServerId,
    pub url: String,
    pub name: String,
    pub icon_url: Option<String>,
    pub account: Option<AccountSummary>,
    pub added_at: i64,
    pub signed_in: bool,
    pub ended: Option<SessionEndReason>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerChanged {
    pub server_id: ServerId,
}

pub trait CollabHost: Send + Sync {
    fn open_browser(&self, url: &str) -> Result<(), CollabError>;
    fn server_changed(&self, server: ServerId);
    fn signed_in(&self);
    fn device_name(&self) -> String;
    fn platform(&self) -> String;
}

pub struct AppHost {
    app: tauri::AppHandle,
}

impl AppHost {
    pub fn new(app: tauri::AppHandle) -> AppHost {
        AppHost { app }
    }
}

impl CollabHost for AppHost {
    fn open_browser(&self, url: &str) -> Result<(), CollabError> {
        let scripted = scripted_browser(
            url,
            cfg!(feature = "e2e-testing"),
            std::env::var_os(E2E_BROWSER_ENV),
        );
        if let Some(mut command) = scripted {
            let mut child = command
                .spawn()
                .map_err(|error| CollabError::Io(error.to_string()))?;
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            return Ok(());
        }
        open::that_detached(url).map_err(|error| CollabError::Io(error.to_string()))
    }

    fn server_changed(&self, server: ServerId) {
        let _ = self
            .app
            .emit(SERVER_CHANGED_EVENT, ServerChanged { server_id: server });
    }

    fn signed_in(&self) {
        crate::single_instance::reveal_main_window(&self.app);
    }

    fn device_name(&self) -> String {
        let host = tauri_plugin_os::hostname();
        let name = host.trim().trim_end_matches(".local");
        if name.is_empty() {
            "Oleafly".to_string()
        } else {
            name.to_string()
        }
    }

    fn platform(&self) -> String {
        std::env::consts::OS.to_string()
    }
}

pub(crate) const E2E_BROWSER_ENV: &str = "OLEAFLY_E2E_BROWSER";

pub(crate) fn scripted_browser(
    url: &str,
    e2e_build: bool,
    configured: Option<std::ffi::OsString>,
) -> Option<std::process::Command> {
    let program = configured.filter(|program| e2e_build && !program.is_empty())?;
    let mut command = std::process::Command::new(program);
    command.arg(url);
    Some(command)
}

#[cfg(test)]
mod scripted_browser_tests {
    use super::scripted_browser;
    use std::ffi::{OsStr, OsString};

    const PAGE: &str = "http://127.0.0.1:9/auth/start?provider=github&state=s";

    #[test]
    fn an_e2e_build_hands_the_sign_in_page_to_the_scripted_browser() {
        let command = scripted_browser(PAGE, true, Some(OsString::from("/tmp/e2e-browser")))
            .expect("an e2e build with a scripted browser uses it");
        assert_eq!(command.get_program(), OsStr::new("/tmp/e2e-browser"));
        assert_eq!(command.get_args().collect::<Vec<_>>(), [OsStr::new(PAGE)]);
    }

    #[test]
    fn a_build_without_the_e2e_feature_never_uses_a_scripted_browser() {
        assert!(scripted_browser(PAGE, false, Some(OsString::from("/tmp/e2e-browser"))).is_none());
    }

    #[test]
    fn an_e2e_build_without_a_scripted_browser_opens_the_system_one() {
        assert!(scripted_browser(PAGE, true, None).is_none());
        assert!(scripted_browser(PAGE, true, Some(OsString::new())).is_none());
    }
}

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

fn unknown_server() -> CollabError {
    CollabError::Api {
        status: 404,
        code: "not_found".to_string(),
        message: "this server is not in the list".to_string(),
    }
}

pub(crate) fn known(state: &CollabState, server: ServerId) -> Result<ServerEntry, CollabError> {
    state
        .registry()?
        .get(server)
        .cloned()
        .ok_or_else(unknown_server)
}

fn to_dto(state: &CollabState, entry: &ServerEntry) -> Result<CollabServer, CollabError> {
    let ended = state.registry()?.ended(entry.server_id);
    dto(state, entry, ended)
}

fn dto(
    state: &CollabState,
    entry: &ServerEntry,
    ended: Option<SessionEndReason>,
) -> Result<CollabServer, CollabError> {
    Ok(CollabServer {
        server_id: entry.server_id,
        url: entry.url.clone(),
        name: entry.name.clone(),
        icon_url: entry.icon_url.clone(),
        account: entry.account.clone(),
        added_at: entry.added_at,
        signed_in: state.has_session(entry.server_id)?,
        ended,
    })
}

pub(crate) fn client_for(entry: &ServerEntry) -> Result<ServerClient, CollabError> {
    ServerClient::new(ServerUrl::parse(&entry.url)?)
}

fn pinned_id(state: &CollabState, url: &ServerUrl) -> Result<Option<ServerId>, CollabError> {
    Ok(state
        .registry()?
        .list()
        .iter()
        .find(|entry| entry.url == url.as_str())
        .map(|entry| entry.server_id))
}

fn check_pin(expected: Option<ServerId>, found: ServerId) -> Result<(), CollabError> {
    match expected {
        Some(expected) if expected != found => Err(CollabError::ServerChanged { expected, found }),
        _ => Ok(()),
    }
}

fn check_unique(state: &CollabState, url: &ServerUrl, found: ServerId) -> Result<(), CollabError> {
    match state.registry()?.get(found) {
        Some(entry) if entry.url != url.as_str() => Err(CollabError::DuplicateServer {
            url: entry.url.clone(),
        }),
        _ => Ok(()),
    }
}

fn store_account(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    account: AccountSummary,
) -> Result<(), CollabError> {
    state.update_registry(|registry| {
        if let Some(mut entry) = registry.get(server).cloned() {
            entry.account = Some(account);
            registry.upsert(entry);
        }
    })?;
    host.server_changed(server);
    Ok(())
}

pub(crate) async fn verify_pin(
    client: &ServerClient,
    expected: ServerId,
) -> Result<(), CollabError> {
    let manifest = client.capabilities().await?;
    check_pin(Some(expected), manifest.server_id)
}

fn clear_account(state: &CollabState, server: ServerId) -> Result<(), CollabError> {
    state.update_registry(|registry| {
        if let Some(mut entry) = registry.get(server).cloned() {
            entry.account = None;
            registry.upsert(entry);
        }
    })
}

async fn end_session(
    state: &CollabState,
    server: ServerId,
    entry: &ServerEntry,
) -> Result<(), CollabError> {
    if !state.has_session(server)? {
        return Ok(());
    }
    let keys = state.keys().await?;
    if let Ok(client) = client_for(entry) {
        if verify_pin(&client, server).await.is_ok() {
            if let Ok(access) = keys.sessions.access_token(server, &client).await {
                let _ = client.sign_out(&access).await;
            }
        }
    }
    keys.sessions.sign_out(server)
}

pub(crate) fn note_session_end(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    reason: SessionEndReason,
) -> Result<(), CollabError> {
    state.update_registry(|registry| registry.set_ended(server, Some(reason)))?;
    host.server_changed(server);
    Ok(())
}

async fn settle_revocation(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    error: CollabError,
) -> CollabError {
    if let CollabError::SessionEnded(reason) = error {
        if let Ok(keys) = state.keys().await {
            let _ = keys.sessions.clear(server);
        }
        let _ = note_session_end(state, host, server, reason);
        return error;
    }
    if matches!(error, CollabError::Unauthorized) {
        if let Ok(keys) = state.keys().await {
            let _ = keys.sessions.clear(server);
        }
        let _ = clear_account(state, server);
        host.server_changed(server);
    }
    error
}

pub(crate) async fn authed<T, F>(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    call: F,
) -> Result<T, CollabError>
where
    F: for<'a> Fn(&'a ServerClient, &'a str) -> ApiCall<'a, T>,
{
    let client = client_for(&known(state, server)?)?;
    verify_pin(&client, server).await?;
    let keys = state.keys().await?;
    let first = match keys.sessions.access_token(server, &client).await {
        Ok(access) => call(&client, access.as_str()).await,
        Err(error) => Err(error),
    };
    let result = match first {
        Err(CollabError::Unauthorized) => {
            match keys.sessions.force_refresh(server, &client).await {
                Ok(access) => call(&client, access.as_str()).await,
                Err(error) => Err(error),
            }
        }
        other => other,
    };
    if matches!(result, Err(CollabError::Api { status: 403, .. })) {
        if let Ok(access) = keys.sessions.access_token(server, &client).await {
            if let Ok(account) = client.me(&access).await {
                let _ = store_account(state, host, server, account);
            }
        }
    }
    match result {
        Err(error) => Err(settle_revocation(state, host, server, error).await),
        ok => ok,
    }
}

pub(crate) fn parse_id<T: std::str::FromStr>(
    text: &str,
    kind: &str,
) -> Result<T, CollabCommandError> {
    text.parse::<T>().map_err(|_| CollabCommandError {
        code: "not_found",
        message: format!("unknown {kind} {text}"),
    })
}

pub fn list_servers(state: &CollabState) -> Result<Vec<CollabServer>, CollabError> {
    let registry = state.registry()?;
    registry
        .list()
        .iter()
        .map(|entry| dto(state, entry, registry.ended(entry.server_id)))
        .collect()
}

pub async fn probe_server(
    state: &CollabState,
    url: &str,
) -> Result<CapabilityManifest, CollabError> {
    let url = ServerUrl::parse(url)?;
    let manifest = ServerClient::new(url.clone())?.capabilities().await?;
    check_pin(pinned_id(state, &url)?, manifest.server_id)?;
    check_unique(state, &url, manifest.server_id)?;
    negotiate(
        ProtocolRange {
            min: PROTOCOL_VERSION,
            max: PROTOCOL_VERSION,
        },
        ProtocolRange {
            min: manifest.protocol.min,
            max: manifest.protocol.max,
        },
    )
    .map_err(CollabError::ProtocolMismatch)?;
    Ok(manifest)
}

pub async fn sign_in_server(
    state: &CollabState,
    host: &dyn CollabHost,
    url: &str,
    provider_id: String,
    setup_code: Option<String>,
    timeout: Duration,
) -> Result<CollabServer, CollabError> {
    let url = ServerUrl::parse(url)?;
    let pinned = pinned_id(state, &url)?;
    let advertised = ServerClient::new(url.clone())?.capabilities().await?;
    check_pin(pinned, advertised.server_id)?;
    check_unique(state, &url, advertised.server_id)?;
    let keys = state.keys().await?;
    let cancel = state.begin_sign_in();
    let request = SignInRequest {
        url: url.clone(),
        provider_id,
        device_name: host.device_name(),
        platform: host.platform(),
        setup_code,
    };
    let open = |target: &str| host.open_browser(target);
    let (manifest, tokens) = tokio::select! {
        result = sign_in_as(request, &keys.sessions, advertised.server_id, &open, timeout) => result?,
        _ = cancel => return Err(CollabError::SignInCancelled),
    };
    finish_sign_in(state, host, &url, pinned, manifest, tokens).await
}

async fn finish_sign_in(
    state: &CollabState,
    host: &dyn CollabHost,
    url: &ServerUrl,
    pinned: Option<ServerId>,
    manifest: CapabilityManifest,
    tokens: SessionTokens,
) -> Result<CollabServer, CollabError> {
    let keys = state.keys().await?;
    let server = manifest.server_id;
    check_pin(pinned, server)?;
    check_unique(state, url, server)?;
    let account = ServerClient::new(url.clone())?
        .me(&tokens.access_token)
        .await?;
    keys.sessions.store(server, &tokens)?;
    state.update_registry(|registry| {
        let added_at = registry
            .get(server)
            .map_or_else(now_ms, |entry| entry.added_at);
        registry.upsert(ServerEntry {
            server_id: server,
            url: url.as_str().to_string(),
            name: manifest.name.clone(),
            icon_url: manifest.icon_url.clone(),
            account: Some(account),
            added_at,
        });
        registry.set_ended(server, None);
    })?;
    host.server_changed(server);
    host.signed_in();
    to_dto(state, &known(state, server)?)
}

pub async fn code_sign_in_server(
    state: &CollabState,
    host: &dyn CollabHost,
    url: &str,
    setup_code: Option<String>,
    show_code: &(dyn Fn(&SignInCode) -> Result<(), CollabError> + Send + Sync),
) -> Result<CollabServer, CollabError> {
    let url = ServerUrl::parse(url)?;
    let pinned = pinned_id(state, &url)?;
    let advertised = ServerClient::new(url.clone())?.capabilities().await?;
    check_pin(pinned, advertised.server_id)?;
    check_unique(state, &url, advertised.server_id)?;
    let keys = state.keys().await?;
    let cancel = state.begin_sign_in();
    let request = CodeSignInRequest {
        url: url.clone(),
        device_name: host.device_name(),
        platform: host.platform(),
        setup_code,
    };
    let (manifest, tokens) = tokio::select! {
        result = sign_in_with_code_as(request, &keys.sessions, advertised.server_id, show_code) => result?,
        _ = cancel => return Err(CollabError::SignInCancelled),
    };
    finish_sign_in(state, host, &url, pinned, manifest, tokens).await
}

pub async fn sign_out_server(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
) -> Result<(), CollabError> {
    let entry = known(state, server)?;
    end_session(state, server, &entry).await?;
    clear_account(state, server)?;
    host.server_changed(server);
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnsentChoice {
    Ask,
    KeepLocalCopy,
}

impl UnsentChoice {
    fn from_flag(keep_local_copy: Option<bool>) -> UnsentChoice {
        if keep_local_copy.unwrap_or(false) {
            UnsentChoice::KeepLocalCopy
        } else {
            UnsentChoice::Ask
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SignOutOutcome {
    pub signed_out: bool,
    pub unsent: Vec<super::live::UnsentProject>,
    pub detached: Vec<DetachedProject>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct DetachedProject {
    pub project_id: String,
    pub name: String,
}

async fn settle_unsent(
    state: &CollabState,
    server: ServerId,
    choice: UnsentChoice,
    wait: Duration,
) -> Result<SignOutOutcome, CollabError> {
    known(state, server)?;
    let unsent = super::live::unsent_changes(state, server, wait).await?;
    if !unsent.is_empty() {
        if choice == UnsentChoice::Ask {
            return Ok(SignOutOutcome {
                signed_out: false,
                unsent,
                detached: Vec::new(),
            });
        }
        super::live::keep_local_copies(state, &unsent).await?;
    }
    Ok(SignOutOutcome {
        signed_out: true,
        unsent,
        detached: Vec::new(),
    })
}

pub async fn sign_out_within(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    choice: UnsentChoice,
    wait: Duration,
) -> Result<SignOutOutcome, CollabError> {
    let outcome = settle_unsent(state, server, choice, wait).await?;
    if outcome.signed_out {
        sign_out_server(state, host, server).await?;
    }
    Ok(outcome)
}

pub async fn remove_within(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    choice: UnsentChoice,
    wait: Duration,
) -> Result<SignOutOutcome, CollabError> {
    let outcome = settle_unsent(state, server, choice, wait).await?;
    if outcome.signed_out {
        remove_server(state, host, server).await?;
    }
    Ok(outcome)
}

pub async fn remove_server(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
) -> Result<(), CollabError> {
    let entry = known(state, server)?;
    end_session(state, server, &entry).await?;
    state.update_registry(|registry| registry.remove(server))?;
    host.server_changed(server);
    Ok(())
}

pub async fn refresh_account(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
) -> Result<CollabServer, CollabError> {
    let account = authed(state, host, server, |client, access| {
        Box::pin(client.me(access))
    })
    .await?;
    store_account(state, host, server, account)?;
    to_dto(state, &known(state, server)?)
}

pub async fn server_devices(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
) -> Result<Vec<DeviceSummary>, CollabError> {
    authed(state, host, server, |client, access| {
        Box::pin(client.devices(access))
    })
    .await
}

pub async fn sign_out_device(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    device: DeviceId,
) -> Result<(), CollabError> {
    authed(state, host, server, move |client, access| {
        Box::pin(client.sign_out_device(access, device))
    })
    .await?;
    let keys = state.keys().await?;
    if keys
        .sessions
        .tokens(server)?
        .is_some_and(|tokens| tokens.device_id == device)
    {
        keys.sessions.sign_out(server)?;
        clear_account(state, server)?;
        host.server_changed(server);
    }
    Ok(())
}

pub async fn admin_members(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
) -> Result<Vec<MemberSummary>, CollabError> {
    authed(state, host, server, |client, access| {
        Box::pin(client.admin_members(access))
    })
    .await
}

pub async fn admin_patch_member(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    account: AccountId,
    patch: MemberPatch,
) -> Result<MemberSummary, CollabError> {
    authed(state, host, server, move |client, access| {
        Box::pin(async move { client.admin_patch_member(access, account, &patch).await })
    })
    .await
}

pub async fn admin_member_devices(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    account: AccountId,
) -> Result<Vec<DeviceSummary>, CollabError> {
    authed(state, host, server, move |client, access| {
        Box::pin(client.admin_member_devices(access, account))
    })
    .await
}

pub async fn admin_remove_member(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    account: AccountId,
) -> Result<(), CollabError> {
    authed(state, host, server, move |client, access| {
        Box::pin(client.admin_remove_member(access, account))
    })
    .await
}

pub async fn admin_sign_out_device(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    device: DeviceId,
) -> Result<(), CollabError> {
    authed(state, host, server, move |client, access| {
        Box::pin(client.admin_sign_out_device(access, device))
    })
    .await
}

pub async fn admin_allowlist(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
) -> Result<Vec<AllowlistEntry>, CollabError> {
    authed(state, host, server, |client, access| {
        Box::pin(client.admin_allowlist(access))
    })
    .await
}

pub async fn admin_add_allowlist(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    entry: NewAllowlistEntry,
) -> Result<AllowlistEntry, CollabError> {
    authed(state, host, server, move |client, access| {
        let entry = entry.clone();
        Box::pin(async move { client.admin_add_allowlist(access, &entry).await })
    })
    .await
}

pub async fn admin_remove_allowlist(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    id: String,
) -> Result<(), CollabError> {
    authed(state, host, server, move |client, access| {
        let id = id.clone();
        Box::pin(async move { client.admin_remove_allowlist(access, &id).await })
    })
    .await
}

pub async fn admin_domain_rules(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
) -> Result<Vec<DomainRule>, CollabError> {
    authed(state, host, server, |client, access| {
        Box::pin(client.admin_domain_rules(access))
    })
    .await
}

pub async fn admin_add_domain_rule(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    rule: NewDomainRule,
) -> Result<DomainRule, CollabError> {
    authed(state, host, server, move |client, access| {
        let rule = rule.clone();
        Box::pin(async move { client.admin_add_domain_rule(access, &rule).await })
    })
    .await
}

pub async fn admin_remove_domain_rule(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    id: String,
) -> Result<(), CollabError> {
    authed(state, host, server, move |client, access| {
        let id = id.clone();
        Box::pin(async move { client.admin_remove_domain_rule(access, &id).await })
    })
    .await
}

pub async fn admin_settings(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
) -> Result<RuntimeSettings, CollabError> {
    authed(state, host, server, |client, access| {
        Box::pin(client.admin_settings(access))
    })
    .await
}

pub async fn admin_patch_settings(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    patch: RuntimeSettingsPatch,
) -> Result<RuntimeSettings, CollabError> {
    authed(state, host, server, move |client, access| {
        Box::pin(async move { client.admin_patch_settings(access, &patch).await })
    })
    .await
}

pub async fn admin_security_log(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    cursor: Option<String>,
) -> Result<Page<SecurityEvent>, CollabError> {
    authed(state, host, server, move |client, access| {
        let cursor = cursor.clone();
        Box::pin(async move { client.admin_security_log(access, cursor.as_deref()).await })
    })
    .await
}

pub async fn test_server(
    state: &CollabState,
    url: &str,
) -> Result<Vec<ConnectionCheck>, CollabError> {
    let url = ServerUrl::parse(url)?;
    let expected = pinned_id(state, &url)?;
    Ok(test_connection_pinned(&url, expected).await)
}

#[tauri::command]
pub async fn collab_servers_list(
    state: tauri::State<'_, CollabState>,
) -> Result<Vec<CollabServer>, CollabCommandError> {
    list_servers(state.inner()).map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_server_probe(
    state: tauri::State<'_, CollabState>,
    url: String,
) -> Result<CapabilityManifest, CollabCommandError> {
    probe_server(state.inner(), &url)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_server_sign_in(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    url: String,
    provider_id: String,
    setup_code: Option<String>,
) -> Result<CollabServer, CollabCommandError> {
    let host = AppHost::new(app);
    sign_in_server(
        state.inner(),
        &host,
        &url,
        provider_id,
        setup_code,
        SIGN_IN_TIMEOUT,
    )
    .await
    .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_server_code_sign_in(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    url: String,
    setup_code: Option<String>,
    on_code: tauri::ipc::Channel<SignInCode>,
) -> Result<CollabServer, CollabCommandError> {
    let host = AppHost::new(app);
    let show = move |code: &SignInCode| {
        on_code
            .send(code.clone())
            .map_err(|error| CollabError::Io(error.to_string()))
    };
    code_sign_in_server(state.inner(), &host, &url, setup_code, &show)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_server_sign_in_cancel(
    state: tauri::State<'_, CollabState>,
) -> Result<(), CollabCommandError> {
    state.inner().cancel_sign_in();
    Ok(())
}

#[tauri::command]
pub async fn collab_server_sign_out(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    keep_local_copy: Option<bool>,
) -> Result<SignOutOutcome, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    sign_out_within(
        state.inner(),
        &AppHost::new(app),
        server,
        UnsentChoice::from_flag(keep_local_copy),
        super::live::SIGN_OUT_WAIT,
    )
    .await
    .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_server_remove(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    keep_local_copy: Option<bool>,
) -> Result<SignOutOutcome, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    remove_within(
        state.inner(),
        &AppHost::new(app),
        server,
        UnsentChoice::from_flag(keep_local_copy),
        super::live::SIGN_OUT_WAIT,
    )
    .await
    .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_server_devices(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
) -> Result<Vec<DeviceSummary>, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    server_devices(state.inner(), &AppHost::new(app), server)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_server_sign_out_device(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    device_id: String,
) -> Result<(), CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    let device = parse_id(&device_id, "device")?;
    sign_out_device(state.inner(), &AppHost::new(app), server, device)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_server_test(
    state: tauri::State<'_, CollabState>,
    url: String,
) -> Result<Vec<ConnectionCheck>, CollabCommandError> {
    test_server(state.inner(), &url)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_server_refresh(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
) -> Result<CollabServer, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    refresh_account(state.inner(), &AppHost::new(app), server)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_members(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
) -> Result<Vec<MemberSummary>, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    admin_members(state.inner(), &AppHost::new(app), server)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_patch_member(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    account_id: String,
    patch: MemberPatch,
) -> Result<MemberSummary, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    let account = parse_id(&account_id, "account")?;
    admin_patch_member(state.inner(), &AppHost::new(app), server, account, patch)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_member_devices(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    account_id: String,
) -> Result<Vec<DeviceSummary>, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    let account = parse_id(&account_id, "account")?;
    admin_member_devices(state.inner(), &AppHost::new(app), server, account)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_remove_member(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    account_id: String,
) -> Result<(), CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    let account = parse_id(&account_id, "account")?;
    admin_remove_member(state.inner(), &AppHost::new(app), server, account)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_sign_out_device(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    device_id: String,
) -> Result<(), CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    let device = parse_id(&device_id, "device")?;
    admin_sign_out_device(state.inner(), &AppHost::new(app), server, device)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_allowlist(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
) -> Result<Vec<AllowlistEntry>, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    admin_allowlist(state.inner(), &AppHost::new(app), server)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_add_allowlist(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    entry: NewAllowlistEntry,
) -> Result<AllowlistEntry, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    admin_add_allowlist(state.inner(), &AppHost::new(app), server, entry)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_remove_allowlist(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    entry_id: String,
) -> Result<(), CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    admin_remove_allowlist(state.inner(), &AppHost::new(app), server, entry_id)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_domain_rules(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
) -> Result<Vec<DomainRule>, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    admin_domain_rules(state.inner(), &AppHost::new(app), server)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_add_domain_rule(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    rule: NewDomainRule,
) -> Result<DomainRule, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    admin_add_domain_rule(state.inner(), &AppHost::new(app), server, rule)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_remove_domain_rule(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    rule_id: String,
) -> Result<(), CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    admin_remove_domain_rule(state.inner(), &AppHost::new(app), server, rule_id)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
) -> Result<RuntimeSettings, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    admin_settings(state.inner(), &AppHost::new(app), server)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_patch_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    patch: RuntimeSettingsPatch,
) -> Result<RuntimeSettings, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    admin_patch_settings(state.inner(), &AppHost::new(app), server, patch)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_security_log(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    cursor: Option<String>,
) -> Result<Page<SecurityEvent>, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    admin_security_log(state.inner(), &AppHost::new(app), server, cursor)
        .await
        .map_err(CollabCommandError::from)
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use oleafly_collab::{CollabPaths, MemorySecrets};
    use oleafly_collab_protocol::admin::AllowlistMatcher;
    use oleafly_collab_protocol::roles::ServerRole;
    use oleafly_server::config::ProviderConfig;
    use oleafly_server::test_support::{test_config, MockGithub, MockGithubUser, TestServer};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};

    use super::*;

    const LONG: Duration = Duration::from_secs(20);

    struct TestHost {
        follow: bool,
        changed: Mutex<Vec<ServerId>>,
        opened: Mutex<Option<String>>,
    }

    impl TestHost {
        fn following() -> TestHost {
            TestHost {
                follow: true,
                changed: Mutex::new(Vec::new()),
                opened: Mutex::new(None),
            }
        }

        fn ignoring() -> TestHost {
            TestHost {
                follow: false,
                changed: Mutex::new(Vec::new()),
                opened: Mutex::new(None),
            }
        }

        fn changed(&self) -> Vec<ServerId> {
            self.changed.lock().expect("lock").clone()
        }

        fn opened(&self) -> Option<String> {
            self.opened.lock().expect("lock").clone()
        }
    }

    impl CollabHost for TestHost {
        fn open_browser(&self, url: &str) -> Result<(), CollabError> {
            *self.opened.lock().expect("lock") = Some(url.to_string());
            if self.follow {
                let url = url.to_string();
                tokio::spawn(async move {
                    if let Ok(client) = reqwest::Client::builder().no_proxy().build() {
                        let _ = client.get(url).send().await;
                    }
                });
            }
            Ok(())
        }

        fn server_changed(&self, server: ServerId) {
            self.changed.lock().expect("lock").push(server);
        }

        fn signed_in(&self) {}

        fn device_name(&self) -> String {
            "Test Mac".to_string()
        }

        fn platform(&self) -> String {
            "macos".to_string()
        }
    }

    fn collab_state(dir: &tempfile::TempDir) -> CollabState {
        CollabState::new(
            CollabPaths::new(dir.path().join("collab")),
            Arc::new(MemorySecrets::default()),
        )
    }

    fn api(status: u16, code: &str) -> CollabError {
        CollabError::Api {
            status,
            code: code.to_string(),
            message: format!("{code} message"),
        }
    }

    async fn github_server() -> (MockGithub, TestServer) {
        let github = MockGithub::start(vec![MockGithubUser {
            id: 1,
            login: "carol".to_string(),
            name: "Carol".to_string(),
            emails: vec![("carol@uni.edu".to_string(), true)],
        }])
        .await;
        let mut config = test_config();
        config.providers.push(ProviderConfig::Github {
            id: "github".to_string(),
            label: "GitHub".to_string(),
            client_id: "oleafly-test".to_string(),
            client_secret: "oleafly-test-secret".to_string(),
            web_url: github.web_url(),
            api_url: github.api_url(),
        });
        let server = TestServer::start(config).await;
        (github, server)
    }

    fn address_of(server: &TestServer) -> String {
        server
            .url()
            .trim_start_matches("http://")
            .trim_end_matches('/')
            .to_string()
    }

    fn loopback_port(start: &str) -> u16 {
        let start = reqwest::Url::parse(start).expect("start url");
        let redirect = start
            .query_pairs()
            .find(|(name, _)| name == "redirect_uri")
            .map(|(_, value)| value.into_owned())
            .expect("redirect_uri");
        reqwest::Url::parse(&redirect)
            .expect("redirect")
            .port()
            .expect("port")
    }

    struct Relay {
        url: String,
        upstream: Arc<Mutex<String>>,
        seen: Arc<Mutex<Vec<u8>>>,
    }

    impl Relay {
        async fn start(first: &TestServer) -> Relay {
            let listener = TcpListener::bind(("127.0.0.1", 0)).await.expect("bind");
            let url = format!(
                "http://127.0.0.1:{}",
                listener.local_addr().expect("address").port()
            );
            let upstream = Arc::new(Mutex::new(address_of(first)));
            let seen = Arc::new(Mutex::new(Vec::new()));
            let (target, log) = (upstream.clone(), seen.clone());
            tokio::spawn(async move {
                while let Ok((client, _)) = listener.accept().await {
                    let address = target.lock().expect("lock").clone();
                    let log = log.clone();
                    tokio::spawn(async move {
                        let Ok(server) = TcpStream::connect(address).await else {
                            return;
                        };
                        let (mut client_read, mut client_write) = client.into_split();
                        let (mut server_read, mut server_write) = server.into_split();
                        let upward = async move {
                            let mut buffer = [0u8; 8192];
                            loop {
                                match client_read.read(&mut buffer).await {
                                    Ok(0) | Err(_) => break,
                                    Ok(count) => {
                                        log.lock()
                                            .expect("lock")
                                            .extend_from_slice(&buffer[..count]);
                                        if server_write.write_all(&buffer[..count]).await.is_err() {
                                            break;
                                        }
                                    }
                                }
                            }
                            let _ = server_write.shutdown().await;
                        };
                        let downward = async move {
                            let _ = tokio::io::copy(&mut server_read, &mut client_write).await;
                            let _ = client_write.shutdown().await;
                        };
                        tokio::join!(upward, downward);
                    });
                }
            });
            Relay {
                url,
                upstream,
                seen,
            }
        }

        fn point_at(&self, server: &TestServer) {
            *self.upstream.lock().expect("lock") = address_of(server);
            self.seen.lock().expect("lock").clear();
        }

        fn saw_a_bearer_token(&self) -> bool {
            String::from_utf8_lossy(&self.seen.lock().expect("lock"))
                .to_ascii_lowercase()
                .contains("authorization: bearer")
        }
    }

    async fn signed_in(state: &CollabState, host: &TestHost, server: &TestServer) -> CollabServer {
        sign_in_server(
            state,
            host,
            &server.url(),
            "github".to_string(),
            Some(server.setup_code()),
            LONG,
        )
        .await
        .expect("sign in")
    }

    #[test]
    fn every_error_maps_to_a_code_the_frontend_knows() {
        let contract = include_str!("../../../packages/backend-port/src/index.ts");
        let start = contract
            .find("export type CollabErrorCode =")
            .expect("CollabErrorCode in backend-port");
        let end = start + contract[start..].find(';').expect("end of CollabErrorCode");
        let union = &contract[start..end];
        let cases = vec![
            (CollabError::Network("refused".to_string()), "unreachable"),
            (CollabError::NotHttps, "not_https"),
            (
                CollabError::ProtocolMismatch(VersionMismatch::ClientTooOld),
                "client_too_old",
            ),
            (
                CollabError::ProtocolMismatch(VersionMismatch::ServerTooOld),
                "server_too_old",
            ),
            (CollabError::NotAdmitted, "not_admitted"),
            (CollabError::SignInCancelled, "sign_in_cancelled"),
            (CollabError::SignInTimedOut, "sign_in_timed_out"),
            (CollabError::Unauthorized, "unauthorized"),
            (api(403, "forbidden"), "forbidden"),
            (api(404, "not_found"), "not_found"),
            (api(409, "conflict"), "conflict"),
            (api(429, "slow_down"), "rate_limited"),
            (api(400, "setup_code_invalid"), "setup_code_invalid"),
            (api(400, "not_admitted"), "not_admitted"),
            (api(502, "http_502"), "server"),
            (api(400, "bad_request"), "server"),
            (CollabError::Io("disk".to_string()), "internal"),
            (CollabError::Corrupt("json".to_string()), "internal"),
            (CollabError::Secret("store".to_string()), "internal"),
            (CollabError::Crypto("random".to_string()), "internal"),
            (CollabError::InvalidPath("..".to_string()), "internal"),
            (
                CollabError::ServerChanged {
                    expected: ServerId::new_v7(),
                    found: ServerId::new_v7(),
                },
                "server_changed",
            ),
            (
                CollabError::DuplicateServer {
                    url: "https://collab.uni.edu".to_string(),
                },
                "duplicate_server",
            ),
            (api(409, "device_in_use"), "device_in_use"),
            (
                CollabError::SessionEnded(SessionEndReason::AccountSuspended),
                "unauthorized",
            ),
            (
                CollabError::SessionEnded(SessionEndReason::AccessEnded),
                "unauthorized",
            ),
        ];
        for (error, expected) in cases {
            assert_eq!(CollabCommandError::from(error).code, expected);
            assert!(
                union.contains(&format!("\"{expected}\"")),
                "{expected} is missing from CollabErrorCode"
            );
        }
        assert_eq!(
            CollabCommandError::from(api(409, "conflict")).message,
            "conflict message"
        );
    }

    #[test]
    fn ids_that_do_not_parse_are_not_found() {
        let error = parse_id::<ServerId>("not-an-id", "server").expect_err("refused");
        assert_eq!(error.code, "not_found");
    }

    #[test]
    fn no_servers_before_the_first_sign_in() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(list_servers(&collab_state(&dir)).expect("list").is_empty());
    }

    #[test]
    fn change_event_payload_is_camel_case() {
        let server = ServerId::new_v7();
        let payload = serde_json::to_value(ServerChanged { server_id: server }).expect("json");
        assert_eq!(
            payload,
            serde_json::json!({ "serverId": server.to_string() })
        );
    }

    #[tokio::test]
    async fn probe_refuses_plain_http_on_a_public_host() {
        let dir = tempfile::tempdir().expect("tempdir");
        let error = probe_server(&collab_state(&dir), "http://uni.edu/oleafly")
            .await
            .expect_err("refused");
        assert_eq!(CollabCommandError::from(error).code, "not_https");
    }

    #[tokio::test]
    async fn probe_of_a_closed_port_is_unreachable() {
        let dir = tempfile::tempdir().expect("tempdir");
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind");
        let port = listener.local_addr().expect("address").port();
        drop(listener);
        let error = probe_server(&collab_state(&dir), &format!("http://127.0.0.1:{port}"))
            .await
            .expect_err("refused");
        assert_eq!(CollabCommandError::from(error).code, "unreachable");
    }

    #[test]
    fn a_sign_out_outcome_lists_detached_projects_in_snake_case() {
        let outcome = SignOutOutcome {
            signed_out: true,
            unsent: Vec::new(),
            detached: vec![DetachedProject {
                project_id: "p1".to_owned(),
                name: "Thesis".to_owned(),
            }],
        };
        assert_eq!(
            serde_json::to_value(&outcome).unwrap(),
            serde_json::json!({
                "signed_out": true,
                "unsent": [],
                "detached": [{ "project_id": "p1", "name": "Thesis" }]
            })
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn sign_in_lists_devices_signs_out_and_removes() {
        let (_github, server) = github_server().await;
        let dir = tempfile::tempdir().expect("tempdir");
        let state = collab_state(&dir);
        let host = TestHost::following();
        let added = signed_in(&state, &host, &server).await;
        assert!(added.signed_in);
        assert_eq!(added.server_id, server.state().server_id);
        assert!(matches!(
            added.account.as_ref().map(|account| &account.server_role),
            Some(ServerRole::Admin)
        ));
        let json = serde_json::to_value(&added).expect("json");
        assert!(json.get("server_id").is_some() && json.get("signed_in").is_some());
        assert_eq!(list_servers(&state).expect("list").len(), 1);
        let devices = server_devices(&state, &host, added.server_id)
            .await
            .expect("devices");
        assert!(devices
            .iter()
            .any(|device| device.current && device.name == "Test Mac"));
        sign_out_server(&state, &host, added.server_id)
            .await
            .expect("sign out");
        let listed = list_servers(&state).expect("list");
        assert!(!listed[0].signed_in);
        assert!(listed[0].account.is_none());
        let keys = state.keys().await.expect("keys");
        assert_ne!(
            keys.sessions
                .device_key(added.server_id)
                .expect("key")
                .public_key(),
            keys.key.public_key()
        );
        remove_server(&state, &host, added.server_id)
            .await
            .expect("remove");
        assert!(list_servers(&state).expect("list").is_empty());
        assert_eq!(host.changed(), vec![added.server_id; 3]);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn revoked_session_marks_the_server_signed_out() {
        let (_github, server) = github_server().await;
        let dir = tempfile::tempdir().expect("tempdir");
        let state = collab_state(&dir);
        let host = TestHost::following();
        let added = signed_in(&state, &host, &server).await;
        let keys = state.keys().await.expect("keys");
        let tokens = keys
            .sessions
            .tokens(added.server_id)
            .expect("read")
            .expect("session");
        let client =
            ServerClient::new(ServerUrl::parse(&server.url()).expect("url")).expect("client");
        client
            .sign_out(&tokens.access_token)
            .await
            .expect("server sign out");
        let result = server_devices(&state, &host, added.server_id).await;
        assert!(matches!(result, Err(CollabError::Unauthorized)));
        assert!(!list_servers(&state).expect("list")[0].signed_in);
        assert_eq!(host.changed(), vec![added.server_id; 2]);
    }

    async fn set_status(server: &TestServer, account: AccountId, status: &'static str) {
        server
            .state()
            .db
            .call(move |conn| {
                conn.execute(
                    "UPDATE accounts SET status = ?2 WHERE id = ?1",
                    [account.to_string(), status.to_string()],
                )?;
                Ok(())
            })
            .await
            .expect("status stored");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_paused_account_is_remembered_with_its_reason_until_the_next_sign_in() {
        let (_github, server) = github_server().await;
        let dir = tempfile::tempdir().expect("tempdir");
        let state = collab_state(&dir);
        let host = TestHost::following();
        let added = signed_in(&state, &host, &server).await;
        assert_eq!(added.ended, None);
        let account = added.account.as_ref().expect("account").account_id;
        set_status(&server, account, "suspended").await;
        let result = server_devices(&state, &host, added.server_id).await;
        assert_eq!(
            result.err(),
            Some(CollabError::SessionEnded(
                SessionEndReason::AccountSuspended
            ))
        );
        let listed = list_servers(&state).expect("list");
        assert!(!listed[0].signed_in);
        assert_eq!(listed[0].ended, Some(SessionEndReason::AccountSuspended));
        assert_eq!(
            listed[0].account.as_ref().map(|kept| kept.account_id),
            Some(account)
        );
        assert_eq!(host.changed(), vec![added.server_id; 2]);
        set_status(&server, account, "active").await;
        let back = sign_in_server(
            &state,
            &host,
            &server.url(),
            "github".to_string(),
            None,
            LONG,
        )
        .await
        .expect("signs in again");
        assert!(back.signed_in);
        assert_eq!(back.ended, None);
        assert_eq!(list_servers(&state).expect("list")[0].ended, None);
    }

    #[test]
    fn a_session_end_heard_live_is_remembered_and_announced() {
        let dir = tempfile::tempdir().expect("tempdir");
        let state = collab_state(&dir);
        let host = TestHost::following();
        let server = ServerId::new_v7();
        state
            .update_registry(|registry| {
                registry.upsert(ServerEntry {
                    server_id: server,
                    url: "https://collab.uni.edu".to_string(),
                    name: "Smith Lab".to_string(),
                    icon_url: None,
                    account: None,
                    added_at: 1,
                })
            })
            .expect("registry");
        note_session_end(&state, &host, server, SessionEndReason::AccessEnded).expect("noted");
        assert_eq!(
            list_servers(&state).expect("list")[0].ended,
            Some(SessionEndReason::AccessEnded)
        );
        assert_eq!(host.changed(), vec![server]);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_new_sign_in_cancels_the_pending_one() {
        let (_github, server) = github_server().await;
        let dir = tempfile::tempdir().expect("tempdir");
        let state = collab_state(&dir);
        let ignoring = TestHost::ignoring();
        let following = TestHost::following();
        let url = server.url();
        let code = server.setup_code();
        let (first, second) = tokio::join!(
            sign_in_server(
                &state,
                &ignoring,
                &url,
                "github".to_string(),
                Some(code.clone()),
                LONG
            ),
            async {
                tokio::time::sleep(Duration::from_millis(500)).await;
                sign_in_server(
                    &state,
                    &following,
                    &url,
                    "github".to_string(),
                    Some(code.clone()),
                    LONG,
                )
                .await
            }
        );
        assert!(matches!(first, Err(CollabError::SignInCancelled)));
        assert!(second.is_ok());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancel_during_the_wait_frees_the_port_and_a_later_sign_in_works() {
        let (_github, server) = github_server().await;
        let dir = tempfile::tempdir().expect("tempdir");
        let state = collab_state(&dir);
        let waiting = TestHost::ignoring();
        let url = server.url();
        let code = server.setup_code();
        let (first, ()) = tokio::join!(
            sign_in_server(
                &state,
                &waiting,
                &url,
                "github".to_string(),
                Some(code.clone()),
                LONG
            ),
            async {
                for _ in 0..100 {
                    if waiting.opened().is_some() {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                state.cancel_sign_in();
            }
        );
        assert!(matches!(first, Err(CollabError::SignInCancelled)));
        let port = loopback_port(&waiting.opened().expect("browser opened"));
        assert!(TcpStream::connect(("127.0.0.1", port)).await.is_err());
        let later = sign_in_server(
            &state,
            &TestHost::following(),
            &url,
            "github".to_string(),
            Some(code),
            LONG,
        )
        .await;
        assert!(later.is_ok());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_code_sign_in_shows_the_code_then_adds_the_signed_in_server() {
        let (_github, server) = github_server().await;
        let dir = tempfile::tempdir().expect("tempdir");
        let state = collab_state(&dir);
        let host = TestHost::ignoring();
        let shown: Arc<Mutex<Vec<SignInCode>>> = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&shown);
        let show = move |code: &SignInCode| -> Result<(), CollabError> {
            seen.lock().expect("lock").push(code.clone());
            let complete = code.verification_uri_complete.clone();
            tokio::spawn(async move {
                oleafly_server::test_support::approve_code(&complete, "GitHub")
                    .await
                    .expect("the browser finishes")
            });
            Ok(())
        };
        let added = tokio::time::timeout(
            Duration::from_secs(60),
            code_sign_in_server(
                &state,
                &host,
                &server.url(),
                Some(server.setup_code()),
                &show,
            ),
        )
        .await
        .expect("the code sign-in finishes")
        .expect("signed in with a code");
        assert!(added.signed_in);
        assert_eq!(
            added
                .account
                .as_ref()
                .map(|account| account.display_name.as_str()),
            Some("Carol")
        );
        assert_eq!(shown.lock().expect("lock").len(), 1);
        assert_eq!(host.opened(), None);
        assert_eq!(host.changed(), [added.server_id]);
        assert_eq!(list_servers(&state).expect("servers").len(), 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancelling_a_code_sign_in_stops_the_wait() {
        let (_github, server) = github_server().await;
        let dir = tempfile::tempdir().expect("tempdir");
        let state = collab_state(&dir);
        let host = TestHost::ignoring();
        let shown = Arc::new(Mutex::new(false));
        let seen = Arc::clone(&shown);
        let show = move |_: &SignInCode| -> Result<(), CollabError> {
            *seen.lock().expect("lock") = true;
            Ok(())
        };
        let url = server.url();
        let (outcome, ()) = tokio::join!(
            code_sign_in_server(&state, &host, &url, Some(server.setup_code()), &show),
            async {
                for _ in 0..100 {
                    if *shown.lock().expect("lock") {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                state.cancel_sign_in();
            }
        );
        assert!(matches!(outcome, Err(CollabError::SignInCancelled)));
        assert!(list_servers(&state).expect("servers").is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_replaced_server_at_the_same_address_gets_no_token() {
        let (_github, first) = github_server().await;
        let relay = Relay::start(&first).await;
        let dir = tempfile::tempdir().expect("tempdir");
        let state = collab_state(&dir);
        let host = TestHost::following();
        let added = sign_in_server(
            &state,
            &host,
            &relay.url,
            "github".to_string(),
            Some(first.setup_code()),
            LONG,
        )
        .await
        .expect("sign in");
        let replacement = TestServer::start(test_config()).await;
        relay.point_at(&replacement);
        let (expected, found) = (added.server_id, replacement.state().server_id);
        let changed = |result: &Result<(), CollabError>| {
            matches!(
                result,
                Err(CollabError::ServerChanged { expected: e, found: f })
                    if *e == expected && *f == found
            )
        };
        assert!(changed(&probe_server(&state, &relay.url).await.map(|_| ())));
        assert!(changed(
            &server_devices(&state, &host, expected).await.map(|_| ())
        ));
        assert!(changed(
            &admin_members(&state, &host, expected).await.map(|_| ())
        ));
        let late = TestHost::following();
        assert!(changed(
            &sign_in_server(&state, &late, &relay.url, "github".to_string(), None, LONG)
                .await
                .map(|_| ())
        ));
        assert!(late.opened().is_none());
        let checks = test_server(&state, &relay.url).await.expect("checks");
        assert_eq!(
            checks[2].detail.as_deref(),
            Some(format!("server_changed {expected} {found}").as_str())
        );
        assert!(!relay.saw_a_bearer_token());
        let listed = list_servers(&state).expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].server_id, expected);
        assert!(listed[0].signed_in);
        remove_server(&state, &host, expected)
            .await
            .expect("remove");
        assert!(!relay.saw_a_bearer_token());
        assert!(list_servers(&state).expect("list").is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_second_address_claiming_a_known_server_is_refused() {
        let (_github, server) = github_server().await;
        let dir = tempfile::tempdir().expect("tempdir");
        let state = collab_state(&dir);
        let host = TestHost::following();
        let added = signed_in(&state, &host, &server).await;
        let relay = Relay::start(&server).await;
        let duplicate = |result: &Result<(), CollabError>| matches!(result, Err(CollabError::DuplicateServer { url }) if *url == added.url);
        assert!(duplicate(
            &probe_server(&state, &relay.url).await.map(|_| ())
        ));
        let late = TestHost::following();
        assert!(duplicate(
            &sign_in_server(&state, &late, &relay.url, "github".to_string(), None, LONG)
                .await
                .map(|_| ())
        ));
        assert!(late.opened().is_none());
        assert!(!relay.saw_a_bearer_token());
        let listed = list_servers(&state).expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].url, added.url);
        assert!(listed[0].signed_in);
        assert!(server_devices(&state, &host, added.server_id).await.is_ok());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_role_change_on_the_server_reaches_the_saved_account() {
        use oleafly_collab_protocol::roles::ServerRole;
        let (_github, server) = github_server().await;
        let dir = tempfile::tempdir().expect("tempdir");
        let state = collab_state(&dir);
        let host = TestHost::following();
        let added = signed_in(&state, &host, &server).await;
        let account = added
            .account
            .as_ref()
            .expect("account")
            .account_id
            .to_string();
        let set_role = |role: &'static str| {
            let id = account.clone();
            server.state().db.call(move |conn| {
                conn.execute(
                    "UPDATE accounts SET server_role = ?2 WHERE id = ?1",
                    [id.as_str(), role],
                )?;
                Ok(())
            })
        };
        let role_of = |listed: &[CollabServer]| {
            listed[0]
                .account
                .as_ref()
                .map(|account| account.server_role)
        };
        set_role("maintainer").await.expect("promote");
        let before = host.changed().len();
        let refreshed = refresh_account(&state, &host, added.server_id)
            .await
            .expect("refresh");
        assert!(matches!(
            refreshed
                .account
                .as_ref()
                .map(|account| account.server_role),
            Some(ServerRole::Maintainer)
        ));
        assert!(host.changed().len() > before);
        assert!(matches!(
            role_of(&list_servers(&state).expect("list")),
            Some(ServerRole::Maintainer)
        ));
        set_role("member").await.expect("demote");
        assert!(matches!(
            admin_members(&state, &host, added.server_id).await,
            Err(CollabError::Api { status: 403, .. })
        ));
        assert!(matches!(
            role_of(&list_servers(&state).expect("list")),
            Some(ServerRole::Member)
        ));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn admin_commands_reach_the_server() {
        let (_github, server) = github_server().await;
        let dir = tempfile::tempdir().expect("tempdir");
        let state = collab_state(&dir);
        let host = TestHost::following();
        let added = signed_in(&state, &host, &server).await;
        let id = added.server_id;
        let account = added.account.as_ref().expect("account").account_id;
        let devices = admin_member_devices(&state, &host, id, account)
            .await
            .expect("member devices");
        assert!(devices.iter().any(|device| device.name == "Test Mac"));
        let entry = admin_add_allowlist(
            &state,
            &host,
            id,
            NewAllowlistEntry {
                matcher: AllowlistMatcher::Email {
                    email: "Alice@Uni.EDU".to_string(),
                },
                role: ServerRole::Member,
            },
        )
        .await
        .expect("add");
        assert!(admin_allowlist(&state, &host, id)
            .await
            .expect("list")
            .iter()
            .any(|item| item.id == entry.id));
        admin_remove_allowlist(&state, &host, id, entry.id.clone())
            .await
            .expect("remove");
        assert!(admin_allowlist(&state, &host, id)
            .await
            .expect("list")
            .iter()
            .all(|item| item.id != entry.id));
        let patch = RuntimeSettingsPatch {
            guests_enabled: Some(true),
            guest_approval_required: None,
            directory_visible: None,
            directory_shows_email: None,
            link_sharing_allowed: None,
            access_logs_allowed: None,
            email_notifications: None,
            comments_allowed: None,
            email_link_sign_in: None,
        };
        assert!(
            admin_patch_settings(&state, &host, id, patch)
                .await
                .expect("patch")
                .guests_enabled
        );
        assert!(
            admin_settings(&state, &host, id)
                .await
                .expect("settings")
                .guests_enabled
        );
        assert_eq!(
            admin_members(&state, &host, id)
                .await
                .expect("members")
                .len(),
            1
        );
        assert!(!admin_security_log(&state, &host, id, None)
            .await
            .expect("log")
            .items
            .is_empty());
    }
}
