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
    from_collab, from_store, now_ms, one_line, read_secret_input, CliSecrets, Env, Report,
    CLI_ACCOUNT_PREFIX,
};
use crate::auth::ServerLogin;
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
    /// The server at the address still is the one signed in to (checked
    /// once before the first token goes out).
    verified: std::sync::atomic::AtomicBool,
}

/// How long a sign-out waits for the server.
const SIGN_OUT_WAIT: Duration = Duration::from_secs(10);

/// Refuses a server whose id isn't the one this device pinned (the address
/// now points at another server), before a token is sent to it.
async fn check_pin(client: &ServerClient, entry: &ServerEntry) -> Result<(), CollabError> {
    let advertised = client.capabilities().await?;
    if advertised.server_id == entry.server_id {
        Ok(())
    } else {
        Err(CollabError::ServerChanged {
            expected: entry.server_id,
            found: advertised.server_id,
        })
    }
}

/// Holds `<collab-cli>/servers.lock` while the server list is read,
/// changed and saved, so two sign-ins never drop each other's entry.
fn with_registry_lock<T>(
    collab: &CliCollab,
    change: impl FnOnce(&mut ServerRegistry) -> T,
) -> Result<T, CliError> {
    std::fs::create_dir_all(collab.paths.root()).map_err(CliError::from)?;
    let lock_path = collab.paths.root().join("servers.lock");
    if std::fs::symlink_metadata(&lock_path).is_ok_and(|metadata| !metadata.is_file()) {
        return Err(CliError::new(
            ErrorKind::UnsafePath,
            "server.unsafe_path",
            "The server list's lock isn't a regular file, so the CLI won't use it.",
        ));
    }
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
        .map_err(CliError::from)?;
    fs4::FileExt::lock(&file).map_err(CliError::from)?;
    let mut registry = collab.registry()?;
    let value = change(&mut registry);
    registry
        .save(&collab.paths)
        .map_err(|error| collab.local(&error))?;
    Ok(value)
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
            verified: std::sync::atomic::AtomicBool::new(false),
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

    /// Once per command, before the first token (or a refresh, which
    /// sends the refresh token) goes to the address: the server there must
    /// still be the one this device signed in to, as the app checks.
    async fn verify(&self) -> Result<(), CliError> {
        use std::sync::atomic::Ordering;
        if self.verified.load(Ordering::Acquire) {
            return Ok(());
        }
        check_pin(&self.client, &self.entry)
            .await
            .map_err(|error| self.error(&error))?;
        self.verified.store(true, Ordering::Release);
        Ok(())
    }

    pub(crate) async fn access(&self) -> Result<String, CliError> {
        self.verify().await?;
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
                // The refresh sends the refresh token: the server is
                // checked again first.
                check_pin(&self.client, &self.entry)
                    .await
                    .map_err(|error| self.error(&error))?;
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
    let registry = collab.registry()?;
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
    // The approval can take minutes: the list is read again now, and only
    // this server's entry changes, under the list's lock.
    with_registry_lock(collab, |registry| {
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
    })?;
    let who = account
        .as_ref()
        .map(account_name)
        .unwrap_or_else(|| "your account".to_string());
    let mut report = Report::new(json!({
        "server": {"url": label, "serverId": server.to_string(), "name": manifest.name},
        "account": account.as_ref().map(|account| json!({"accountId": account.account_id.to_string(), "displayName": account.display_name})),
        "device": "cli",
    }))
    .line(format!("Signed in to {} as {}. This command line shows up as its own device.", one_line(&manifest.name), one_line(&who)));
    for warning in report_warnings {
        report = report.warning("server.account_unread", warning);
    }
    Ok(report)
}

/// The setup code for a new server: from `--setup-code`, or with
/// `--setup-code-stdin` from standard input (hidden when asked for in a
/// terminal), which keeps it out of the process list and the shell history.
pub(crate) fn setup_code(
    env: &Env,
    args: &ServerLogin,
    input: &mut dyn std::io::Read,
) -> Result<Option<String>, CliError> {
    if !args.setup_code_stdin {
        return Ok(args.setup_code.clone());
    }
    let code = read_secret_input(input, env.stdin_is_tty, env.interactive, "Setup code: ")?;
    Ok(Some(code.as_str().to_string()))
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
    let mut ended_on_server = true;
    if let Some(sessions) = collab.sessions(false)? {
        let stored = sessions.tokens(entry.server_id);
        if !matches!(stored, Ok(None)) {
            // The server forgets the device too. The stored access token
            // lasts minutes, so a fresh one is taken (after the server is
            // checked to be the one signed in to).
            ended_on_server = stored.is_ok()
                && match ServerUrl::parse(&entry.url).and_then(ServerClient::new) {
                    Ok(client) => tokio::time::timeout(SIGN_OUT_WAIT, async {
                        check_pin(&client, &entry).await?;
                        let access = sessions.access_token(entry.server_id, &client).await?;
                        client.sign_out(&access).await
                    })
                    .await
                    .is_ok_and(|ended| ended.is_ok()),
                    Err(_) => false,
                };
        }
        sessions
            .sign_out(entry.server_id)
            .map_err(|error| collab.local(&error))?;
    }
    with_registry_lock(collab, |registry| registry.remove(entry.server_id))?;
    let mut report =
        Report::new(json!({"removed": removed, "dryRun": false, "endedOnServer": ended_on_server}))
            .line(format!("Signed out of {}.", entry.url));
    if !ended_on_server {
        report = report.warning(
            "server.sign_out_unconfirmed",
            format!(
                "{} didn't confirm the sign-out, so this device may still be listed there. Remove it from your devices on the server.",
                entry.url
            ),
        );
    }
    Ok(report)
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
    // The server names itself and its account, so neither can start a line of
    // its own or steer the terminal.
    let text = |value: &Value| one_line(value.as_str().unwrap_or_default());
    let cli = match (&row["cli"]["signedIn"], row["cli"]["account"].as_str()) {
        (Value::Bool(true), Some(account)) => {
            format!("this command line: signed in as {}", one_line(account))
        }
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

    fn login_args(code: Option<&str>, from_stdin: bool) -> ServerLogin {
        ServerLogin {
            url: "https://collab.uni.edu".into(),
            setup_code: code.map(str::to_string),
            setup_code_stdin: from_stdin,
            open: false,
        }
    }

    #[test]
    fn the_setup_code_can_come_from_standard_input_instead_of_the_command_line() {
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        let from = |args: ServerLogin, input: &str| setup_code(&env, &args, &mut input.as_bytes());
        assert_eq!(
            from(login_args(Some("abc-123"), false), "")
                .unwrap()
                .as_deref(),
            Some("abc-123")
        );
        assert_eq!(from(login_args(None, false), "ignored\n").unwrap(), None);
        assert_eq!(
            from(login_args(None, true), "code-9\r\n")
                .unwrap()
                .as_deref(),
            Some("code-9")
        );
        assert_eq!(
            from(login_args(None, true), "").unwrap_err().code,
            "auth.empty_input"
        );
    }

    #[test]
    fn a_server_name_cannot_start_a_line_or_steer_the_terminal() {
        let lines = status_lines(&json!({
            "name": "Lab\n  this command line: signed in as admin\u{1b}[2J",
            "url": "https://collab.uni.edu",
            "cli": {"signedIn": true, "account": "Ada\nOleafly app: signed in"},
            "app": {"signedIn": false},
        }));
        assert_eq!(lines.len(), 3, "{lines:?}");
        assert!(lines.iter().all(|line| !line.contains(['\n', '\u{1b}'])));
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
        let signed_out = sign_out(&collab, "Lab", false).await.unwrap();
        // Nothing answers at that address: the sign-out there is unconfirmed.
        assert_eq!(signed_out.data["endedOnServer"], false);
        assert!(signed_out
            .warnings
            .iter()
            .any(|warning| warning.code == "server.sign_out_unconfirmed"));
        assert!(!collab.cli_signed_in(lab.server_id).unwrap());
        assert_eq!(
            env.store.get(&account).unwrap().as_deref(),
            Some("app-tokens")
        );
        assert!(collab.registry().unwrap().list().is_empty());
    }
}

#[cfg(test)]
mod pin_tests {
    use std::io::{BufRead, BufReader, Write};

    use oleafly_collab_protocol::auth::SessionTokens;
    use oleafly_collab_protocol::capabilities::{
        CapabilityManifest, EncryptionSupport, Features, Limits, ProtocolRange,
    };
    use oleafly_collab_protocol::ids::ServerId;

    use super::*;
    use crate::auth::test_env::env_at;

    /// Answers every request with `manifest` and returns what it was sent.
    fn manifest_server(
        manifest: CapabilityManifest,
    ) -> (String, std::sync::mpsc::Receiver<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let body = serde_json::to_string(&manifest).unwrap();
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut stream = stream;
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut request = String::new();
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    request.push_str(&line);
                }
                let _ = sender.send(request);
                let reply = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(reply.as_bytes());
            }
        });
        (url, receiver)
    }

    fn manifest(server_id: ServerId) -> CapabilityManifest {
        CapabilityManifest {
            server_id,
            name: "Other".into(),
            icon_url: None,
            version: "0.1.0".into(),
            protocol: ProtocolRange { min: 1, max: 1 },
            needs_setup: false,
            providers: Vec::new(),
            features: Features {
                email: false,
                guests: false,
                link_sharing: false,
                access_logs: false,
                comments: false,
                encryption: EncryptionSupport::None,
            },
            limits: Limits {
                max_project_mb: 1,
                max_file_mb: 1,
                max_members_per_project: 1,
            },
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn no_token_goes_to_an_address_that_now_has_another_server() {
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        let collab = CliCollab::open(&env);
        let (url, requests) = manifest_server(manifest(ServerId::new_v7()));
        let pinned = ServerEntry {
            server_id: ServerId::new_v7(),
            url: url.clone(),
            name: "Lab".into(),
            icon_url: None,
            account: None,
            added_at: 1,
        };
        let mut registry = ServerRegistry::default();
        registry.upsert(pinned.clone());
        registry.save(&collab.paths).unwrap();
        let sessions = collab.sessions(true).unwrap().unwrap();
        sessions
            .store(
                pinned.server_id,
                &SessionTokens {
                    account_id: "01920000-0000-7000-8000-000000000002".parse().unwrap(),
                    device_id: "01920000-0000-7000-8000-000000000003".parse().unwrap(),
                    access_token: "ACCESS-not-for-them".into(),
                    access_expires_at: i64::MAX,
                    refresh_token: "REFRESH-not-for-them".into(),
                },
            )
            .unwrap();
        let link = collab.link("Lab").unwrap();
        let error = link.access().await.unwrap_err();
        assert_eq!(error.code, "server.changed");
        let seen: Vec<String> = requests.try_iter().collect();
        assert!(!seen.is_empty());
        assert!(seen
            .iter()
            .all(|request| !request.to_ascii_lowercase().contains("authorization")));
    }
}
