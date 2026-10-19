//! The online LaTeX service from `oleafly auth`: a session (a pasted
//! cookie, or one copied from a browser on this computer) and a Git token,
//! per server.
use std::io::Read;

use oleafly_online::browser_cookies::{
    self, BrowserId, CookieSourceStatus, HostPlatform, ImportPolicy, SafeStoragePasswordProvider,
};
use oleafly_online::client::Http;
use oleafly_online::session;
use oleafly_online::{OnlineError, OnlineErrorKind};
use serde_json::{json, Value};
use zeroize::Zeroizing;

use super::shared::{from_online, read_secret_input, user_agent, Env, Report};
use super::{BrowserArg, OnlineLogin, OnlineLogout};
use crate::contract::{CliError, ErrorKind};

/// An online-service failure about `server`.
pub(crate) fn online_error(mut error: OnlineError, server: &str) -> CliError {
    error
        .params
        .entry("server".to_string())
        .or_insert_with(|| server.to_string());
    from_online(&error)
}

/// The server a command means: `--server`, else the only one with a saved
/// sign-in, else the service's own.
pub(crate) fn server_for(env: &Env, server: Option<&str>) -> Result<String, CliError> {
    match server {
        Some(server) => {
            session::normalize_server(Some(server)).map_err(|error| from_online(&error))
        }
        None => session::default_server(&env.store).map_err(|error| from_online(&error)),
    }
}

fn browser_id(browser: BrowserArg) -> BrowserId {
    match browser {
        BrowserArg::Chrome => BrowserId::Chrome,
        BrowserArg::Edge => BrowserId::Edge,
        BrowserArg::Brave => BrowserId::Brave,
        BrowserArg::Firefox => BrowserId::Firefox,
    }
}

fn browser_key(browser: BrowserArg) -> &'static str {
    match browser {
        BrowserArg::Chrome => "chrome",
        BrowserArg::Edge => "edge",
        BrowserArg::Brave => "brave",
        BrowserArg::Firefox => "firefox",
    }
}

fn browser_unsupported(browser: BrowserId, platform: HostPlatform) -> CliError {
    let hint = match platform {
        HostPlatform::Windows => {
            "Chrome, Edge and Brave on Windows lock their cookies to the browser. Use Firefox, --cookie-stdin, or sign in from the Oleafly app."
        }
        HostPlatform::Linux => {
            "These browsers keep their cookie key in the desktop keyring, which Oleafly can't read yet. Use Firefox, --cookie-stdin, or sign in from the Oleafly app."
        }
        _ => "Use --cookie-stdin, or sign in from the Oleafly app.",
    };
    CliError::new(
        ErrorKind::MissingTool,
        "auth.browser_unsupported",
        format!(
            "Oleafly can't read {} cookies on {}.",
            browser.name(),
            platform.name()
        ),
    )
    .hint(hint)
}

/// The `Cookie` header a browser profile holds for `server`.
fn browser_cookie(
    env: &Env,
    server: &str,
    browser: BrowserArg,
    profile: Option<&str>,
    safe_storage: &dyn SafeStoragePasswordProvider,
) -> Result<Zeroizing<String>, CliError> {
    let id = browser_id(browser);
    if !ImportPolicy::Cli.supports(env.platform, id) {
        return Err(browser_unsupported(id, env.platform));
    }
    let profile = match profile {
        Some(profile) => profile.to_string(),
        None => browser_cookies::detect_sources_at(&env.home, env.platform, ImportPolicy::Cli)
            .into_iter()
            .find(|source| source.browser == id && source.status == CookieSourceStatus::Available)
            .and_then(|source| source.profile)
            .ok_or_else(|| {
                CliError::new(
                    ErrorKind::MissingTool,
                    "auth.browser_profile_missing",
                    format!("No {} profile with saved cookies was found.", id.name()),
                )
                .hint("Sign in with that browser first, or name the profile with --profile.")
            })?,
    };
    let invalid =
        || from_online(&OnlineError::new(OnlineErrorKind::InvalidServer).param("server", server));
    let url = url::Url::parse(server).map_err(|_| invalid())?;
    let host = url.host_str().ok_or_else(invalid)?.to_string();
    let cookies = browser_cookies::read_cookies(
        &env.home,
        env.platform,
        id,
        &profile,
        Some(&host),
        ImportPolicy::Cli,
        safe_storage,
    )
    .map_err(|error| {
        CliError::new(
            ErrorKind::MissingTool,
            "auth.browser_read_failed",
            error.to_string(),
        )
    })?;
    let header = Zeroizing::new(browser_cookies::cookie_header_for(&cookies, &url));
    if header.is_empty() {
        return Err(CliError::new(
            ErrorKind::Auth,
            "auth.no_cookies",
            format!("No sign-in for {host} was found in {}.", id.name()),
        )
        .hint(format!("Sign in to {host} in that browser first.")));
    }
    Ok(header)
}

/// `auth login online`: a Git token, or a session checked against the
/// service before it is saved.
pub(crate) async fn login(
    env: &Env,
    args: OnlineLogin,
    stdin: &mut (dyn Read + Send),
    safe_storage: &(dyn SafeStoragePasswordProvider + Sync),
) -> Result<Report, CliError> {
    let server = server_for(env, args.server.as_deref())?;
    if args.with_token {
        let token = read_secret_input(stdin, env.stdin_is_tty, env.interactive, "Git token: ")?;
        if !session::valid_git_token(&token) {
            return Err(online_error(
                OnlineError::new(OnlineErrorKind::GitTokenInvalid),
                &server,
            ));
        }
        if !args.dry_run {
            session::save_git_token(&env.store, &server, &token)
                .map_err(|error| online_error(error, &server))?;
        }
        let signed_in = session::load(&env.store, &server)
            .map_err(|error| online_error(error, &server))?
            .is_some();
        let line = if args.dry_run {
            format!("Checked the token for {server}. Nothing was saved (--dry-run).")
        } else {
            format!("Saved the Git token for {server}.")
        };
        return Ok(Report::new(json!({
            "server": server,
            "signedIn": signed_in,
            "gitToken": {"saved": !args.dry_run},
            "dryRun": args.dry_run,
        }))
        .line(line));
    }
    let (cookie, saved_by) = if args.cookie_stdin {
        let raw = read_secret_input(stdin, env.stdin_is_tty, env.interactive, "Session cookie: ")?;
        let header = Zeroizing::new(session::cookie_header(session::parse_cookie_header(&raw)));
        if header.is_empty() {
            return Err(CliError::new(
                ErrorKind::Usage,
                "auth.cookie_invalid",
                "That doesn't look like a cookie.",
            )
            .hint("Copy the Cookie header, such as name=value; other=value."));
        }
        (header, "cli".to_string())
    } else if let Some(browser) = args.from_browser {
        (
            browser_cookie(env, &server, browser, args.profile.as_deref(), safe_storage)?,
            format!("cli:browser:{}", browser_key(browser)),
        )
    } else {
        return Err(CliError::new(
            ErrorKind::Usage,
            "auth.method_missing",
            "Choose how to sign in: --with-token, --cookie-stdin or --from-browser.",
        ));
    };
    let http = Http::new(&server, &user_agent()).map_err(|error| online_error(error, &server))?;
    let checked = session::session_from_cookie(&http, cookie.to_string(), &saved_by)
        .await
        .map_err(|error| {
            // A cookie the service turns away is a failed sign-in, not an
            // expired one.
            let error = match error.kind {
                OnlineErrorKind::SessionExpired | OnlineErrorKind::SignedOut => {
                    OnlineError::new(OnlineErrorKind::SignInFailed)
                }
                _ => error,
            };
            online_error(error, &server)
        })?;
    if !args.dry_run {
        session::save(&env.store, &server, &checked)
            .map_err(|error| online_error(error, &server))?;
    }
    let git_token = session::git_token(&env.store, &server)
        .map_err(|error| online_error(error, &server))?
        .is_some();
    let line = if args.dry_run {
        format!("Checked the sign-in for {server}. Nothing was saved (--dry-run).")
    } else {
        format!("Signed in to {server} as {}.", checked.email)
    };
    Ok(Report::new(json!({
        "server": server,
        "signedIn": true,
        "saved": !args.dry_run,
        "email": checked.email,
        "savedBy": saved_by,
        "gitToken": {"saved": git_token},
        "dryRun": args.dry_run,
    }))
    .line(line))
}

/// `auth logout online`: the session and the Git token, unless told to
/// keep one.
pub(crate) fn logout(env: &Env, args: &OnlineLogout) -> Result<Report, CliError> {
    let server = server_for(env, args.server.as_deref())?;
    let failed = |error| online_error(error, &server);
    let drop_session = !args.git_token_only
        && session::load(&env.store, &server)
            .map_err(failed)?
            .is_some();
    let drop_token = !args.session_only
        && session::git_token(&env.store, &server)
            .map_err(failed)?
            .is_some();
    if !args.dry_run {
        if drop_session {
            session::forget(&env.store, &server).map_err(failed)?;
        }
        if drop_token {
            session::forget_git_token(&env.store, &server).map_err(failed)?;
        }
    }
    let mut removed = Vec::new();
    if drop_session {
        removed.push(json!({"kind": "session", "target": server}));
    }
    if drop_token {
        removed.push(json!({"kind": "gitToken", "target": server}));
    }
    let what = match (drop_session, drop_token) {
        (true, true) => Some("the session and the Git token"),
        (true, false) => Some("the session"),
        (false, true) => Some("the Git token"),
        (false, false) => None,
    };
    let line = match (what, args.dry_run) {
        (None, _) => format!("Nothing is saved for {server}."),
        (Some(what), true) => format!("Dry run: would remove {what} for {server}."),
        (Some(what), false) => format!("Removed {what} for {server}."),
    };
    Ok(Report::new(json!({"removed": removed, "dryRun": args.dry_run})).line(line))
}

/// The Git token sync uses: `OLEAFLY_ONLINE_GIT_TOKEN`, else the saved one.
pub(crate) fn token(env: &Env, server: Option<&str>) -> Result<Zeroizing<String>, CliError> {
    if let Some(token) = &env.online_git_token {
        return Ok(token.clone());
    }
    let server = server_for(env, server)?;
    session::git_token(&env.store, &server)
        .map_err(|error| online_error(error, &server))?
        .map(Zeroizing::new)
        .ok_or_else(|| online_error(OnlineError::new(OnlineErrorKind::GitTokenMissing), &server))
}

/// One row per server with a session or a Git token: presence only.
pub(crate) fn status_rows(env: &Env) -> Result<Vec<Value>, CliError> {
    let failed = |error: OnlineError| from_online(&error);
    let mut servers = session::session_servers(&env.store).map_err(failed)?;
    servers.extend(session::git_token_servers(&env.store).map_err(failed)?);
    servers.sort();
    servers.dedup();
    let mut rows = Vec::new();
    for server in servers {
        let saved = session::load(&env.store, &server).map_err(failed)?;
        let token = session::git_token(&env.store, &server)
            .map_err(failed)?
            .is_some();
        let session = match saved {
            Some(saved) => {
                json!({"signedIn": true, "email": saved.email, "savedBy": saved.saved_by})
            }
            None => json!({"signedIn": false}),
        };
        rows.push(json!({"server": server, "session": session, "gitToken": {"saved": token}}));
    }
    Ok(rows)
}

fn saved_by_text(saved_by: &str) -> String {
    match saved_by {
        "app" => "from the Oleafly app".to_string(),
        "cli" => "from the command line".to_string(),
        other => match other.strip_prefix("cli:browser:") {
            Some(browser) => format!("copied from {browser}"),
            None => format!("saved by {other}"),
        },
    }
}

pub(crate) fn status_line(row: &Value) -> String {
    let server = row["server"].as_str().unwrap_or_default();
    let session = &row["session"];
    let signed_in = if session["signedIn"] == true {
        let email = session["email"].as_str().unwrap_or_default();
        match session["savedBy"].as_str() {
            Some(by) => format!("signed in as {email} ({})", saved_by_text(by)),
            None => format!("signed in as {email}"),
        }
    } else {
        "not signed in".to_string()
    };
    let token = if row["gitToken"]["saved"] == true {
        "Git token: saved"
    } else {
        "no Git token"
    };
    format!("{server}: {signed_in}; {token}")
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use oleafly_online::test_support::{dashboard_page, FixtureServer, Reply, Request};

    use super::super::test_env::{assert_secret_free, env_at};
    use super::*;

    struct NoProvider;

    impl SafeStoragePasswordProvider for NoProvider {
        fn password(
            &self,
            browser: BrowserId,
        ) -> Result<Zeroizing<Vec<u8>>, browser_cookies::CookieImportError> {
            Err(browser_cookies::CookieImportError::KeychainUnavailable { browser })
        }
    }

    fn render(report: &Report) -> String {
        format!("{}\n{}", report.lines.join("\n"), report.data)
    }

    fn args(server: &str) -> OnlineLogin {
        OnlineLogin {
            server: Some(server.to_string()),
            ..OnlineLogin::default()
        }
    }

    /// Answers the dashboard for `site_session=good`, else sends people to
    /// the sign-in page.
    async fn fixture() -> FixtureServer {
        let page = dashboard_page(&json!([]));
        FixtureServer::start(Arc::new(move |request: &Request| {
            let signed_in = request
                .headers
                .get("cookie")
                .is_some_and(|cookie| cookie.contains("site_session=good"));
            match request.path.as_str() {
                "/project" if signed_in => Reply::ok(page.clone()),
                "/project" => Reply::status(302).header("Location", "/login?redir=%2Fproject"),
                _ => Reply::status(404),
            }
        }))
        .await
    }

    #[tokio::test]
    async fn login_online_with_a_piped_git_token_saves_it_and_prints_nothing_secret() {
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        let login_args = OnlineLogin {
            with_token: true,
            ..args("https://latex.example.edu")
        };
        let report = login(
            &env,
            login_args,
            &mut "olp_TOKENVALUE123\n".as_bytes(),
            &NoProvider,
        )
        .await
        .unwrap();
        assert_eq!(
            session::git_token(&env.store, "https://latex.example.edu")
                .unwrap()
                .as_deref(),
            Some("olp_TOKENVALUE123")
        );
        assert_secret_free(&render(&report), &["olp_TOKENVALUE123"]);
        let short = OnlineLogin {
            with_token: true,
            ..args("https://latex.example.edu")
        };
        let error = login(&env, short, &mut "short".as_bytes(), &NoProvider)
            .await
            .unwrap_err();
        assert_eq!(
            (error.code.as_ref(), error.exit() as u8),
            ("online.git_token_invalid", 2)
        );
    }

    #[tokio::test]
    async fn login_online_with_a_cookie_checks_it_before_saving() {
        let server = fixture().await;
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        let good = OnlineLogin {
            cookie_stdin: true,
            ..args(&server.base)
        };
        let report = login(
            &env,
            good,
            &mut "site_session=good\n".as_bytes(),
            &NoProvider,
        )
        .await
        .unwrap();
        let saved = session::load(&env.store, &server.base).unwrap().unwrap();
        assert_eq!(
            (saved.email.as_str(), saved.saved_by.as_deref()),
            ("ada@uni.edu", Some("cli"))
        );
        assert_eq!(report.data["email"], "ada@uni.edu");
        session::forget(&env.store, &server.base).unwrap();
        let bad = OnlineLogin {
            cookie_stdin: true,
            ..args(&server.base)
        };
        let error = login(&env, bad, &mut "site_session=bad".as_bytes(), &NoProvider)
            .await
            .unwrap_err();
        assert_eq!(
            (error.code.as_ref(), error.exit() as u8),
            ("online.sign_in_failed", 6)
        );
        assert!(session::load(&env.store, &server.base).unwrap().is_none());
    }

    #[tokio::test]
    async fn dry_run_login_checks_but_saves_nothing() {
        let server = fixture().await;
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        let dry = OnlineLogin {
            cookie_stdin: true,
            dry_run: true,
            ..args(&server.base)
        };
        let report = login(&env, dry, &mut "site_session=good".as_bytes(), &NoProvider)
            .await
            .unwrap();
        assert_eq!(report.data["dryRun"], true);
        assert!(session::load(&env.store, &server.base).unwrap().is_none());
        assert_eq!(server.requests("/project").len(), 1);
    }

    #[tokio::test]
    async fn login_from_firefox_builds_the_header_for_the_server_only() {
        let server = fixture().await;
        let dir = tempfile::tempdir().unwrap();
        let mut env = env_at(dir.path());
        env.platform = HostPlatform::Linux;
        oleafly_online::test_support::write_firefox_cookie_store(
            &env.home
                .join(".mozilla/firefox/ab12cd.default-release/cookies.sqlite"),
            &[
                ("site_session", "good", "127.0.0.1"),
                ("other", "junk", "other.org"),
            ],
        );
        let from_firefox = OnlineLogin {
            from_browser: Some(BrowserArg::Firefox),
            ..args(&server.base)
        };
        login(&env, from_firefox, &mut std::io::empty(), &NoProvider)
            .await
            .unwrap();
        let requests = server.requests("/project");
        assert_eq!(
            requests[0].headers.get("cookie").map(String::as_str),
            Some("site_session=good")
        );
        let saved = session::load(&env.store, &server.base).unwrap().unwrap();
        assert_eq!(saved.saved_by.as_deref(), Some("cli:browser:firefox"));
    }

    #[test]
    fn chrome_on_windows_or_linux_explains_why_and_exits_4() {
        let dir = tempfile::tempdir().unwrap();
        for platform in [HostPlatform::Windows, HostPlatform::Linux] {
            let mut env = env_at(dir.path());
            env.platform = platform;
            let error = browser_cookie(
                &env,
                "https://latex.example.edu",
                BrowserArg::Chrome,
                None,
                &NoProvider,
            )
            .unwrap_err();
            assert_eq!(
                (error.code.as_ref(), error.exit() as u8),
                ("auth.browser_unsupported", 4)
            );
            let hint = error.hint.unwrap();
            assert!(
                hint.contains("Firefox") && hint.contains("--cookie-stdin"),
                "{hint}"
            );
        }
    }

    #[tokio::test]
    async fn login_needs_one_method() {
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        let error = login(
            &env,
            args("https://latex.example.edu"),
            &mut std::io::empty(),
            &NoProvider,
        )
        .await
        .unwrap_err();
        assert_eq!(
            (error.code.as_ref(), error.exit() as u8),
            ("auth.method_missing", 2)
        );
    }

    fn seed(env: &Env, server: &str) {
        session::save(
            &env.store,
            server,
            &session::Session {
                cookie: "site_session=x".into(),
                user_id: "u".into(),
                email: "ana@uni.edu".into(),
                saved_by: None,
            },
        )
        .unwrap();
        session::save_git_token(&env.store, server, "olp_GITTOKEN88").unwrap();
    }

    #[test]
    fn logout_online_removes_session_and_token_unless_told_otherwise() {
        let server = "https://latex.example.edu";
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        seed(&env, server);
        let dry = OnlineLogout {
            server: Some(server.into()),
            dry_run: true,
            ..OnlineLogout::default()
        };
        let report = logout(&env, &dry).unwrap();
        assert_eq!(report.data["removed"].as_array().unwrap().len(), 2);
        assert!(session::load(&env.store, server).unwrap().is_some());
        let session_only = OnlineLogout {
            server: Some(server.into()),
            session_only: true,
            ..OnlineLogout::default()
        };
        logout(&env, &session_only).unwrap();
        assert!(session::load(&env.store, server).unwrap().is_none());
        assert!(session::git_token(&env.store, server).unwrap().is_some());
        let rest = OnlineLogout {
            server: Some(server.into()),
            ..OnlineLogout::default()
        };
        let report = logout(&env, &rest).unwrap();
        assert_eq!(
            report.data["removed"],
            json!([{"kind": "gitToken", "target": server}])
        );
        assert!(session::git_token(&env.store, server).unwrap().is_none());
    }

    #[test]
    fn the_env_token_is_what_sync_uses() {
        let dir = tempfile::tempdir().unwrap();
        let mut env = env_at(dir.path());
        let error = token(&env, Some("https://latex.example.edu")).unwrap_err();
        assert_eq!(
            (error.code.as_ref(), error.exit() as u8),
            ("online.git_token_missing", 6)
        );
        assert!(error
            .hint
            .unwrap()
            .contains("oleafly auth login online --with-token"));
        env.online_git_token = Some(Zeroizing::new("env_TOKEN44".into()));
        assert_eq!(token(&env, None).unwrap().as_str(), "env_TOKEN44");
    }
}
