//! The command line as its own device on collaboration servers: its device
//! key and sessions live in the shared encrypted store under `cli:`, and
//! its server list and document copies in `<data>/collab-cli`. The app's
//! sign-ins are only ever read for presence.
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use oleafly_collab::{
    session_account, sign_in_with_code_as, CodeSignInRequest, CollabError, CollabPaths, DeviceKey,
    SecretPort, ServerClient, ServerEntry, ServerRegistry, ServerUrl, SessionManager, SignInCode,
    DEVICE_KEY_ACCOUNT,
};
use oleafly_collab_protocol::auth::AccountSummary;
use serde_json::{json, Value};
use zeroize::Zeroizing;

use crate::auth::shared::{
    from_collab, from_store, now_ms, CliSecrets, Env, Report, CLI_ACCOUNT_PREFIX,
};
use crate::contract::{CliError, Context, ErrorKind};

/// Where the command line keeps its collaboration state.
pub(crate) const CLI_COLLAB_DIR: &str = "collab-cli";

pub(crate) struct CliCollab {
    /// `<data>/collab-cli`: this device's servers and document copies.
    pub paths: CollabPaths,
    /// `<data>/collab`: the app's (read only).
    pub app_paths: CollabPaths,
    pub secrets: Arc<CliSecrets>,
    pub store: oleafly_secrets::SecretStore,
    data_root: std::path::PathBuf,
}

/// One server this device is signed in to, ready for calls.
pub(crate) struct ServerLink {
    pub entry: ServerEntry,
    pub client: Arc<ServerClient>,
    pub sessions: Arc<SessionManager>,
}

impl CliCollab {
    pub(crate) fn open(env: &Env) -> CliCollab {
        CliCollab {
            paths: CollabPaths::new(env.data_root.join(CLI_COLLAB_DIR)),
            app_paths: CollabPaths::new(env.data_root.join("collab")),
            secrets: Arc::new(CliSecrets::new(env.store.clone())),
            store: env.store.clone(),
            data_root: env.data_root.clone(),
        }
    }

    pub(crate) fn local(&self, error: &CollabError) -> CliError {
        from_collab(error, "this computer")
    }

    pub(crate) fn registry(&self) -> Result<ServerRegistry, CliError> {
        ServerRegistry::load(&self.paths).map_err(|error| self.local(&error))
    }

    /// The app's server list, or an empty one when it can't be read.
    pub(crate) fn app_registry(&self) -> ServerRegistry {
        ServerRegistry::load(&self.app_paths).unwrap_or_default()
    }

    /// This device's sessions; `None` before its first sign-in unless
    /// `create_key`.
    pub(crate) fn sessions(
        &self,
        create_key: bool,
    ) -> Result<Option<Arc<SessionManager>>, CliError> {
        let secrets: Arc<dyn SecretPort> = self.secrets.clone();
        let key = if create_key {
            Some(DeviceKey::load_or_create(secrets.as_ref()).map_err(|error| self.local(&error))?)
        } else {
            DeviceKey::load(secrets.as_ref(), DEVICE_KEY_ACCOUNT)
                .map_err(|error| self.local(&error))?
        };
        Ok(key.map(|key| Arc::new(SessionManager::new(secrets, Arc::new(key)))))
    }

    /// A server this device knows, by address, ID or name.
    pub(crate) fn find_server(&self, which: &str) -> Result<ServerEntry, CliError> {
        let registry = self.registry()?;
        let wanted = which.trim();
        let url = ServerUrl::parse(wanted)
            .ok()
            .map(|url| url.as_str().to_string());
        let exact = registry.list().iter().find(|entry| {
            entry.server_id.to_string() == wanted || url.as_deref() == Some(entry.url.as_str())
        });
        let named: Vec<&ServerEntry> = registry
            .list()
            .iter()
            .filter(|entry| entry.name.eq_ignore_ascii_case(wanted))
            .collect();
        match (exact, named.as_slice()) {
            (Some(entry), _) => Ok(entry.clone()),
            (None, [entry]) => Ok((*entry).clone()),
            _ => Err(CliError::new(
                ErrorKind::Usage,
                "server.unknown",
                format!("No collaboration server matches \"{wanted}\"."),
            )
            .hint("Run oleafly server status to see your servers.")),
        }
    }

    /// A signed-in link to `entry`.
    pub(crate) fn link_to(&self, entry: ServerEntry) -> Result<ServerLink, CliError> {
        let signed_out = || {
            CliError::new(
                ErrorKind::Auth,
                "server.signed_out",
                format!("This command line isn't signed in to {}.", entry.url),
            )
            .hint(format!("Run oleafly server sign-in {}.", entry.url))
        };
        let sessions = self.sessions(false)?.ok_or_else(signed_out)?;
        if sessions
            .tokens(entry.server_id)
            .map_err(|error| self.local(&error))?
            .is_none()
        {
            return Err(signed_out());
        }
        let url = ServerUrl::parse(&entry.url).map_err(|error| from_collab(&error, &entry.url))?;
        let client =
            Arc::new(ServerClient::new(url).map_err(|error| from_collab(&error, &entry.url))?);
        Ok(ServerLink {
            entry,
            client,
            sessions,
        })
    }

    pub(crate) fn link(&self, which: &str) -> Result<ServerLink, CliError> {
        let entry = self.find_server(which)?;
        self.link_to(entry)
    }

    /// Whether this device holds a session for `server` (presence only).
    pub(crate) fn cli_signed_in(
        &self,
        server: oleafly_collab_protocol::ids::ServerId,
    ) -> Result<bool, CliError> {
        self.store
            .contains(&format!("{CLI_ACCOUNT_PREFIX}{}", session_account(server)))
            .map_err(|error| from_store(error, &self.data_root))
    }

    /// Whether the app holds a session for `server` (presence only).
    pub(crate) fn app_signed_in(
        &self,
        server: oleafly_collab_protocol::ids::ServerId,
    ) -> Result<bool, CliError> {
        self.store
            .contains(&session_account(server))
            .map_err(|error| from_store(error, &self.data_root))
    }
}

impl ServerLink {
    pub(crate) fn error(&self, error: &CollabError) -> CliError {
        from_collab(error, &self.entry.url)
    }

    pub(crate) async fn access(&self) -> Result<String, CliError> {
        self.sessions
            .access_token(self.entry.server_id, &self.client)
            .await
            .map_err(|error| self.error(&error))
    }

    /// One call with a fresh token; a token the server turns away is
    /// refreshed once and the call tried again.
    pub(crate) async fn call<T, F, Fut>(&self, mut call: F) -> Result<T, CliError>
    where
        F: FnMut(Arc<ServerClient>, String) -> Fut,
        Fut: Future<Output = Result<T, CollabError>>,
    {
        let access = self.access().await?;
        match call(Arc::clone(&self.client), access.clone()).await {
            Err(CollabError::Unauthorized) => {
                let fresh = self
                    .sessions
                    .refresh_rejected(self.entry.server_id, &self.client, &access)
                    .await
                    .map_err(|error| self.error(&error))?;
                call(Arc::clone(&self.client), fresh)
                    .await
                    .map_err(|error| self.error(&error))
            }
            other => other.map_err(|error| self.error(&error)),
        }
    }
}

/// How the device shows up in the server's device list.
pub(crate) fn device_name() -> String {
    let host = host_name()
        .map(|name| name.trim().trim_end_matches(".local").to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "this computer".to_string());
    format!("Oleafly command line ({host})")
}

#[cfg(windows)]
fn host_name() -> Option<String> {
    std::env::var("COMPUTERNAME").ok()
}

#[cfg(unix)]
fn host_name() -> Option<String> {
    let mut buffer = [0_u8; 256];
    // SAFETY: the buffer is writable for its whole length, which is passed.
    let failed = unsafe { libc::gethostname(buffer.as_mut_ptr().cast(), buffer.len()) } != 0;
    if failed {
        return None;
    }
    let end = buffer
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(buffer.len());
    String::from_utf8(buffer[..end].to_vec()).ok()
}

#[cfg(not(any(unix, windows)))]
fn host_name() -> Option<String> {
    None
}

fn account_name(account: &AccountSummary) -> String {
    if !account.display_name.trim().is_empty() {
        return account.display_name.clone();
    }
    account
        .emails
        .first()
        .or(account.logins.first())
        .cloned()
        .unwrap_or_else(|| "your account".to_string())
}

/// Signs this command line in with a code shown to the person, and adds the
/// server to its list.
pub(crate) async fn sign_in(
    collab: &CliCollab,
    url: &str,
    setup_code: Option<String>,
    show: &(dyn Fn(&SignInCode) -> Result<(), CollabError> + Send + Sync),
) -> Result<Report, CliError> {
    let server_url = ServerUrl::parse(url).map_err(|error| from_collab(&error, url))?;
    let label = server_url.as_str().to_string();
    let failed = |error: CollabError| from_collab(&error, &label);
    let client = ServerClient::new(server_url.clone()).map_err(failed)?;
    let advertised = client.capabilities().await.map_err(failed)?;
    let mut registry = collab.registry()?;
    if let Some(pinned) = registry.list().iter().find(|entry| entry.url == label) {
        if pinned.server_id != advertised.server_id {
            return Err(failed(CollabError::ServerChanged {
                expected: pinned.server_id,
                found: advertised.server_id,
            }));
        }
    }
    if let Some(existing) = registry.get(advertised.server_id) {
        if existing.url != label {
            return Err(failed(CollabError::DuplicateServer {
                url: existing.url.clone(),
            }));
        }
    }
    let sessions = collab
        .sessions(true)?
        .ok_or_else(|| CliError::internal("The device key wasn't created."))?;
    let request = CodeSignInRequest {
        url: server_url.clone(),
        device_name: device_name(),
        platform: std::env::consts::OS.to_string(),
        setup_code,
    };
    let (manifest, tokens) = sign_in_with_code_as(request, &sessions, advertised.server_id, show)
        .await
        .map_err(failed)?;
    let server = manifest.server_id;
    sessions
        .store(server, &tokens)
        .map_err(|error| collab.local(&error))?;
    let mut report_warnings = Vec::new();
    let account = match client.me(&tokens.access_token).await {
        Ok(account) => Some(account),
        Err(_) => {
            report_warnings.push("Signed in, but the account's details couldn't be read yet.");
            None
        }
    };
    let added_at = registry
        .get(server)
        .map_or_else(now_ms, |entry| entry.added_at);
    registry.upsert(ServerEntry {
        server_id: server,
        url: label.clone(),
        name: manifest.name.clone(),
        icon_url: manifest.icon_url.clone(),
        account: account.clone(),
        added_at,
    });
    registry.set_ended(server, None);
    registry
        .save(&collab.paths)
        .map_err(|error| collab.local(&error))?;
    let who = account
        .as_ref()
        .map(account_name)
        .unwrap_or_else(|| "your account".to_string());
    let mut report = Report::new(json!({
        "server": {"url": label, "serverId": server.to_string(), "name": manifest.name},
        "account": account.as_ref().map(|account| json!({"accountId": account.account_id.to_string(), "displayName": account.display_name})),
        "device": "cli",
    }))
    .line(format!("Signed in to {} as {who}. This command line shows up as its own device.", manifest.name));
    for warning in report_warnings {
        report = report.warning("server.account_unread", warning);
    }
    Ok(report)
}

/// `server sign-in` / `auth login server`: the code goes to standard error
/// (and to `--events` as `sign_in_code`), so `--json` output stays clean.
pub(crate) async fn sign_in_from(
    ctx: &Context,
    env: &Env,
    url: &str,
    setup_code: Option<String>,
    open_page: bool,
) -> Result<Report, CliError> {
    let collab = CliCollab::open(env);
    let show = |code: &SignInCode| -> Result<(), CollabError> {
        let _ = ctx.event(
            "sign_in_code",
            json!({"userCode": code.user_code, "verificationUri": code.verification_uri, "expiresAt": code.expires_at}),
        );
        crate::human::note(&format!(
            "To sign in, open {} and enter {}.",
            code.verification_uri, code.user_code
        ));
        crate::human::note("Waiting for approval.");
        if open_page {
            let _ = open::that_detached(&code.verification_uri_complete);
        }
        Ok(())
    };
    sign_in(&collab, url, setup_code, &show).await
}

/// Signs this command line out of a server and forgets it. The app's own
/// sign-in to that server is untouched.
pub(crate) async fn sign_out(
    collab: &CliCollab,
    which: &str,
    dry_run: bool,
) -> Result<Report, CliError> {
    let entry = collab.find_server(which)?;
    let removed = vec![json!({"kind": "serverSession", "target": entry.url})];
    if dry_run {
        return Ok(
            Report::new(json!({"removed": removed, "dryRun": true})).line(format!(
                "Dry run: would sign this command line out of {}.",
                entry.url
            )),
        );
    }
    if let Some(sessions) = collab.sessions(false)? {
        if let Ok(Some(tokens)) = sessions.tokens(entry.server_id) {
            if let Ok(client) = ServerUrl::parse(&entry.url).and_then(ServerClient::new) {
                // Best effort: the server forgets the session too.
                let _ = tokio::time::timeout(
                    Duration::from_secs(10),
                    client.sign_out(&tokens.access_token),
                )
                .await;
            }
        }
        sessions
            .sign_out(entry.server_id)
            .map_err(|error| collab.local(&error))?;
    }
    let mut registry = collab.registry()?;
    registry.remove(entry.server_id);
    registry
        .save(&collab.paths)
        .map_err(|error| collab.local(&error))?;
    Ok(Report::new(json!({"removed": removed, "dryRun": false}))
        .line(format!("Signed out of {}.", entry.url)))
}

/// This device's current access token for a server (refreshed if needed).
pub(crate) async fn access_token(
    collab: &CliCollab,
    which: &str,
) -> Result<Zeroizing<String>, CliError> {
    let link = collab.link(which)?;
    link.access().await.map(Zeroizing::new)
}

/// Every server the command line or the app knows, with who is signed in
/// (presence only).
pub(crate) fn status_rows(env: &Env) -> Result<Vec<Value>, CliError> {
    let collab = CliCollab::open(env);
    let mine = collab.registry().unwrap_or_default();
    let app = collab.app_registry();
    let mut rows = Vec::new();
    for entry in mine.list() {
        let mut cli = json!({"signedIn": collab.cli_signed_in(entry.server_id)?});
        if let Some(account) = &entry.account {
            cli["account"] = json!(account_name(account));
        }
        rows.push(json!({
            "url": entry.url,
            "serverId": entry.server_id.to_string(),
            "name": entry.name,
            "cli": cli,
            "app": {"signedIn": collab.app_signed_in(entry.server_id)?},
        }));
    }
    for entry in app.list() {
        if mine.get(entry.server_id).is_some() {
            continue;
        }
        rows.push(json!({
            "url": entry.url,
            "serverId": entry.server_id.to_string(),
            "name": entry.name,
            "cli": {"signedIn": false},
            "app": {"signedIn": collab.app_signed_in(entry.server_id)?},
        }));
    }
    Ok(rows)
}

pub(crate) fn status_lines(row: &Value) -> Vec<String> {
    let text = |value: &Value| value.as_str().unwrap_or_default().to_string();
    let cli = match (&row["cli"]["signedIn"], row["cli"]["account"].as_str()) {
        (Value::Bool(true), Some(account)) => format!("this command line: signed in as {account}"),
        (Value::Bool(true), None) => "this command line: signed in".to_string(),
        _ => "this command line: not signed in".to_string(),
    };
    let app = if row["app"]["signedIn"] == true {
        "Oleafly app: signed in"
    } else {
        "Oleafly app: not signed in"
    };
    vec![
        format!("{} ({})", text(&row["name"]), text(&row["url"])),
        format!("  {cli}"),
        format!("  {app}"),
    ]
}

#[cfg(test)]
mod tests {
    use oleafly_collab_protocol::ids::ServerId;

    use super::*;
    use crate::auth::test_env::{assert_secret_free, env_at};

    fn entry(url: &str, name: &str) -> ServerEntry {
        ServerEntry {
            server_id: ServerId::new_v7(),
            url: url.into(),
            name: name.into(),
            icon_url: None,
            account: None,
            added_at: 1,
        }
    }

    #[test]
    fn status_shows_app_sign_ins_by_presence_only() {
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        let collab = CliCollab::open(&env);
        let lab = entry("https://collab.uni.edu", "Lab");
        let mut app = ServerRegistry::default();
        app.upsert(lab.clone());
        app.save(&collab.app_paths).unwrap();
        env.store
            .set(&[(
                session_account(lab.server_id).as_str(),
                r#"{"access_token":"ACCESS22xyz","refresh_token":"REFRESH33xyz"}"#,
            )])
            .unwrap();
        let rows = status_rows(&env).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(
            (
                rows[0]["app"]["signedIn"].clone(),
                rows[0]["cli"]["signedIn"].clone()
            ),
            (json!(true), json!(false))
        );
        let text = format!("{rows:?}{:?}", status_lines(&rows[0]));
        assert_secret_free(&text, &["ACCESS22xyz", "REFRESH33xyz"]);
    }

    #[test]
    fn servers_are_found_by_address_id_or_name() {
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        let collab = CliCollab::open(&env);
        let lab = entry("https://collab.uni.edu", "Lab");
        let mut mine = ServerRegistry::default();
        mine.upsert(lab.clone());
        mine.save(&collab.paths).unwrap();
        assert_eq!(
            collab.find_server("collab.uni.edu").unwrap().server_id,
            lab.server_id
        );
        assert_eq!(
            collab
                .find_server(&lab.server_id.to_string())
                .unwrap()
                .server_id,
            lab.server_id
        );
        assert_eq!(collab.find_server("lab").unwrap().server_id, lab.server_id);
        assert_eq!(
            collab.find_server("elsewhere.edu").unwrap_err().code,
            "server.unknown"
        );
        let error = collab.link_to(lab).err().unwrap();
        assert_eq!(
            (error.code.as_ref(), error.exit() as u8),
            ("server.signed_out", 6)
        );
    }

    #[test]
    fn the_device_name_is_readable() {
        let name = device_name();
        assert!(
            name.starts_with("Oleafly command line (") && name.ends_with(')'),
            "{name}"
        );
        assert!(!name.contains(".local)"), "{name}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn sign_out_clears_the_cli_session_and_keeps_the_app_one() {
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        let collab = CliCollab::open(&env);
        let lab = entry("https://127.0.0.1:9", "Lab");
        let mut mine = ServerRegistry::default();
        mine.upsert(lab.clone());
        mine.save(&collab.paths).unwrap();
        let account = session_account(lab.server_id);
        env.store.set(&[(account.as_str(), "app-tokens")]).unwrap();
        let sessions = collab.sessions(true).unwrap().unwrap();
        collab.secrets.set(&account, "cli-tokens-not-json").unwrap();
        drop(sessions);
        let dry = sign_out(&collab, "Lab", true).await.unwrap();
        assert_eq!(dry.data["dryRun"], true);
        assert!(collab.cli_signed_in(lab.server_id).unwrap());
        sign_out(&collab, "Lab", false).await.unwrap();
        assert!(!collab.cli_signed_in(lab.server_id).unwrap());
        assert_eq!(
            env.store.get(&account).unwrap().as_deref(),
            Some("app-tokens")
        );
        assert!(collab.registry().unwrap().list().is_empty());
    }
}
