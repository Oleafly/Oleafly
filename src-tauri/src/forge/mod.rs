//! Git hosting accounts in the app: the Tauri commands over the
//! `oleafly-forge` crate (accounts, sign-in, repositories), the one-time move
//! of the 0.4.7 GitHub sign-in, and the glue that imports a repository from
//! an account. Remote Git commands get their sign-in from `remote_auth`.
pub(crate) mod cancel;
pub(crate) mod commands;
pub(crate) mod import;
pub(crate) mod public_stats;
pub(crate) mod remote_auth;

use oleafly_forge::http::ForgeHttp;
use oleafly_forge::kind::GITHUB_COM;
use oleafly_forge::store::LegacyGithub;
use oleafly_forge::{ForgeAccount, ForgeError, ForgeStore, ForgeToken};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::SystemTime;

/// Emitted to every window after an account is added, changed or removed.
pub(crate) const ACCOUNTS_CHANGED_EVENT: &str = "forge-accounts-changed";

/// The account store of the app's data folder, with the 0.4.7 GitHub sign-in
/// moved in once. A migration that fails (the legacy token is read through
/// the app config, which fails on any unrelated bad secret) is logged and
/// retried on the next call; it never stops a Git hosting command, which
/// does not need the legacy sign-in. Blocking: call it from
/// `spawn_blocking`.
pub(crate) fn store() -> Result<ForgeStore, String> {
    let root = crate::paths::oleafly_root()?;
    let store = ForgeStore::new(&root);
    if let Err(error) = migrate_once(&store) {
        note_migration_failure(&error);
    }
    Ok(store)
}

/// Write a failed legacy migration to the app log, once per process.
fn note_migration_failure(error: &str) {
    static LOGGED: AtomicBool = AtomicBool::new(false);
    if LOGGED.swap(true, Ordering::Relaxed) {
        return;
    }
    let _ = crate::project::append_app_log(format!(
        "The GitHub sign-in of an earlier version could not be moved to Git hosting yet ({}). It is tried again the next time.",
        crate::app_error::english_error(error)
    ));
}

/// Check the legacy GitHub sign-in at most once per data folder and process:
/// migrated the first time, followed after an older build signed in again.
fn migrate_once(store: &ForgeStore) -> Result<(), String> {
    static CHECKED: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    let checked = CHECKED.get_or_init(Default::default);
    if checked
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .contains(store.root())
    {
        return Ok(());
    }
    store
        .migrate_legacy_github(read_legacy_github)
        .map_err(|error| app_error(&error, "GitHub"))?;
    checked
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(store.root().to_path_buf());
    Ok(())
}

/// The 0.4.7 GitHub sign-in: `github_token` from the encrypted store (the
/// config hydrates it) and `github_user` from `config.json`. Called with the
/// forge store's lock held; it takes the config lock after it, the one order
/// both locks are ever taken in.
fn read_legacy_github() -> Result<Option<LegacyGithub>, String> {
    let config = crate::config::read_config()?;
    let token = config.github_token.trim().to_string();
    Ok((!token.is_empty()).then_some(LegacyGithub {
        token,
        login: config.github_user,
    }))
}

/// A client for an account's CA file, or the default one. Clients are kept:
/// loading the platform's certificate store is slow. A CA client is rebuilt
/// when its file changes. Blocking: call it from `spawn_blocking`.
pub(crate) fn http_for(ca_file: Option<&str>) -> Result<ForgeHttp, ForgeError> {
    static DEFAULT: Mutex<Option<ForgeHttp>> = Mutex::new(None);
    type CaKey = (PathBuf, Option<SystemTime>, u64);
    static WITH_CA: OnceLock<Mutex<HashMap<CaKey, ForgeHttp>>> = OnceLock::new();
    let Some(ca_file) = ca_file else {
        let mut slot = DEFAULT.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(client) = slot.as_ref() {
            return Ok(client.clone());
        }
        let client = ForgeHttp::new(None)?;
        *slot = Some(client.clone());
        return Ok(client);
    };
    let path = PathBuf::from(ca_file);
    let metadata = std::fs::metadata(&path).map_err(|error| ForgeError::CaFile {
        detail: format!("the file could not be opened ({})", error.kind()),
    })?;
    let key = (path.clone(), metadata.modified().ok(), metadata.len());
    let mut clients = WITH_CA
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    if let Some(client) = clients.get(&key) {
        return Ok(client.clone());
    }
    let client = ForgeHttp::new(Some(&path))?;
    clients.retain(|(cached, _, _), _| cached != &path);
    clients.insert(key, client.clone());
    Ok(client)
}

/// [`http_for`] off the async runtime.
pub(crate) async fn http_for_async(ca_file: Option<String>) -> Result<ForgeHttp, ForgeError> {
    tauri::async_runtime::spawn_blocking(move || http_for(ca_file.as_deref()))
        .await
        .map_err(|error| ForgeError::Store {
            detail: error.to_string(),
        })?
}

/// A localizable error envelope for a forge error, naming the server.
pub(crate) fn app_error(error: &ForgeError, host: &str) -> String {
    use crate::app_error::AppError;
    let envelope = AppError::new(error.code()).param("host", host);
    let with_detail = |envelope: AppError, detail: &str| {
        if detail.is_empty() {
            envelope
        } else {
            envelope.detail(detail)
        }
    };
    let envelope = match error {
        ForgeError::InvalidBaseUrl { input } => envelope.param("server", input),
        ForgeError::Forbidden { scopes } | ForgeError::MissingScopes { scopes } => {
            envelope.param("scopes", scopes)
        }
        ForgeError::Server { status, detail } => {
            with_detail(envelope.param("status", status), detail)
        }
        ForgeError::TooLarge { limit_mb } => envelope.param("limit", limit_mb),
        ForgeError::RedirectRefused { target } => envelope.param("target", target),
        ForgeError::SignInFailed { detail }
        | ForgeError::Tls { detail }
        | ForgeError::Unreachable { detail }
        | ForgeError::InvalidResponse { detail }
        | ForgeError::CaFile { detail }
        | ForgeError::Store { detail } => with_detail(envelope, detail),
        _ => envelope,
    };
    envelope.into()
}

/// What messages call a server: GitHub, GitLab or Codeberg for the hosted
/// services, else its host and any non-default port.
pub(crate) fn host_label(base: &str) -> String {
    oleafly_forge::kind::host_label(base)
}

pub(crate) fn now_ms() -> u64 {
    oleafly_forge::now_ms()
}

/// Keep 0.4.7's `github_token` and `github_user` in step with the
/// github.com account, so an older build still pushes after a downgrade.
/// Other servers never touch them. The token's fingerprint is recorded in the
/// account store under its lock (lock order: forge store, config), so the
/// next launch's migration reads the mirror as this build's own write and
/// keeps the account's name, picture and CA file.
pub(crate) fn mirror_legacy_github(
    base: &str,
    signed_in: Option<(&str, &str)>,
) -> Result<(), String> {
    if base != GITHUB_COM {
        return Ok(());
    }
    let (token, login) = signed_in
        .map(|(token, login)| (token.to_string(), login.to_string()))
        .unwrap_or_default();
    let recorded = (!token.is_empty()).then(|| token.clone());
    let store = ForgeStore::new(crate::paths::oleafly_root()?);
    store
        .mirror_legacy_github(recorded.as_deref(), move || {
            crate::config::update_config(move |config| {
                config.github_token = token;
                config.github_user = login;
                Ok(())
            })
        })
        .map_err(|error| app_error(&error, "GitHub"))
}

/// [`mirror_legacy_github`] after the account change already happened: the
/// 0.4.7 fields only help a downgrade, so a config that can't be written
/// (a damaged config.json, a secret that can't be decrypted) is logged and
/// never fails the sign-in or sign-out. The next sign-in writes them again.
pub(crate) fn mirror_legacy_github_or_log(base: &str, signed_in: Option<(&str, &str)>) {
    if let Err(error) = mirror_legacy_github(base, signed_in) {
        let _ = crate::project::append_app_log(format!(
            "The GitHub sign-in could not be copied for earlier versions of Oleafly ({}). Git hosting is not affected.",
            crate::app_error::english_error(&error)
        ));
    }
}

/// Forget an account and its token on this device, then clear the 0.4.7
/// copy of a github.com sign-in as best effort. Blocking.
pub(crate) fn sign_out_here(base: &str) -> Result<(), String> {
    store()?
        .remove(base)
        .map_err(|error| app_error(&error, &host_label(base)))?;
    mirror_legacy_github_or_log(base, None);
    Ok(())
}

/// Normalize a base URL the user or the webview sent.
pub(crate) fn normalized_base(base: &str) -> Result<String, String> {
    oleafly_forge::address::normalize_base_url(base)
        .map_err(|error| app_error(&error, &host_label(base.trim())))
}

/// An account, a usable token (refreshed when needed) and a client for it.
pub(crate) async fn account_and_token(
    base: &str,
) -> Result<(ForgeAccount, ForgeToken, ForgeHttp), String> {
    let base = normalized_base(base)?;
    let host = host_label(&base);
    let lookup = base.clone();
    let (store, account, http) = tauri::async_runtime::spawn_blocking(move || {
        let store = store()?;
        let account = store
            .account(&lookup)
            .map_err(|error| app_error(&error, &host_label(&lookup)))?;
        let http = match &account {
            Some(account) => Some(
                http_for(account.ca_file.as_deref())
                    .map_err(|error| app_error(&error, &host_label(&lookup)))?,
            ),
            None => None,
        };
        Ok::<_, String>((store, account, http))
    })
    .await
    .map_err(|error| error.to_string())??;
    let (Some(account), Some(http)) = (account, http) else {
        return Err(crate::app_error::AppError::new("git.account_missing")
            .param("host", &host)
            .into());
    };
    let token = store
        .usable_token(&http, &base, now_ms())
        .await
        .map_err(|error| app_error(&error, &host))?
        .ok_or_else(|| app_error(&ForgeError::Unauthorized, &host))?;
    Ok((account, token, http))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_error::PREFIX;
    use oleafly_forge::kind::{AuthMethod, ForgeKind};

    fn envelope(error: &str) -> serde_json::Value {
        assert!(error.starts_with(PREFIX), "not an error envelope: {error}");
        serde_json::from_str(&error[PREFIX.len()..]).unwrap()
    }

    /// A throwaway data folder for one test. Hold the env lock first.
    pub(crate) struct DataDir {
        dir: tempfile::TempDir,
        previous: Option<std::ffi::OsString>,
    }

    impl DataDir {
        pub(crate) fn new() -> DataDir {
            let dir = tempfile::tempdir().unwrap();
            let previous = std::env::var_os("OLEAFLY_DATA_DIR");
            std::env::set_var("OLEAFLY_DATA_DIR", dir.path());
            DataDir { dir, previous }
        }

        pub(crate) fn path(&self) -> &std::path::Path {
            self.dir.path()
        }
    }

    impl Drop for DataDir {
        fn drop(&mut self) {
            match self.previous.take() {
                Some(previous) => std::env::set_var("OLEAFLY_DATA_DIR", previous),
                None => std::env::remove_var("OLEAFLY_DATA_DIR"),
            }
        }
    }

    fn gitlab_account(base: &str) -> ForgeAccount {
        ForgeAccount {
            base: base.to_string(),
            kind: ForgeKind::GitLab,
            flavor: None,
            login: "octo".into(),
            name: None,
            avatar_url: None,
            ca_file: None,
            auth: AuthMethod::Token,
            added_at: 1,
        }
    }

    #[test]
    fn cargo_manifest_declares_native_roots_for_reqwest() {
        let manifest = include_str!("../../Cargo.toml");
        let line = manifest
            .lines()
            .find(|line| line.trim_start().starts_with("reqwest ="))
            .unwrap();
        assert!(line.contains("rustls-tls-native-roots"), "{line}");
    }

    #[test]
    fn forge_errors_become_localizable_envelopes_with_the_host() {
        let signed_out = envelope(&app_error(&ForgeError::Unauthorized, "gitlab.com"));
        assert_eq!(signed_out["code"], "git.forge_signed_out");
        assert_eq!(signed_out["params"]["host"], "gitlab.com");

        let forbidden = envelope(&app_error(
            &ForgeError::Forbidden {
                scopes: "api, write_repository",
            },
            "GitLab",
        ));
        assert_eq!(forbidden["params"]["scopes"], "api, write_repository");

        let server = envelope(&app_error(
            &ForgeError::Server {
                status: 502,
                detail: "x".into(),
            },
            "git.example.org",
        ));
        assert_eq!(server["code"], "git.forge_server_error");
        assert_eq!(server["params"]["status"], "502");
        assert_eq!(server["detail"], "x");

        let invalid = envelope(&app_error(
            &ForgeError::InvalidBaseUrl {
                input: "ftp://x.org".into(),
            },
            "x.org",
        ));
        assert_eq!(invalid["params"]["server"], "ftp://x.org");

        let large = envelope(&app_error(
            &ForgeError::TooLarge { limit_mb: 256 },
            "GitHub",
        ));
        assert_eq!(large["params"]["limit"], "256");
    }

    #[test]
    fn forge_tokens_land_in_the_encrypted_store() {
        let _env = crate::paths::data_dir_env_lock();
        let data = DataDir::new();
        store()
            .unwrap()
            .save(
                gitlab_account("https://gitlab.com"),
                ForgeToken {
                    token: "glpat-plain-secret".into(),
                    refresh: None,
                    expires_at: None,
                },
            )
            .unwrap();
        let secrets = std::fs::read(data.path().join("app-secrets.json")).unwrap();
        assert!(!String::from_utf8_lossy(&secrets).contains("glpat-plain-secret"));
        let accounts =
            std::fs::read_to_string(data.path().join(oleafly_forge::store::ACCOUNTS_FILE)).unwrap();
        assert!(!accounts.contains("glpat-plain-secret"), "{accounts}");
    }

    #[test]
    fn the_legacy_github_token_becomes_a_github_account() {
        let _env = crate::paths::data_dir_env_lock();
        let _data = DataDir::new();
        crate::config::update_config(|config| {
            config.github_token = "gho_legacy1234".into();
            config.github_user = "octocat".into();
            Ok(())
        })
        .unwrap();
        let accounts = store().unwrap().accounts().unwrap();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].base, GITHUB_COM);
        assert_eq!(accounts[0].login, "octocat");
        assert_eq!(accounts[0].auth, AuthMethod::OAuth);
        assert_eq!(
            store().unwrap().token(GITHUB_COM).unwrap().unwrap().token,
            "gho_legacy1234"
        );
        assert_eq!(
            crate::config::read_config().unwrap().github_token,
            "gho_legacy1234",
            "an older build still finds its token"
        );
    }

    #[test]
    fn a_github_sign_in_keeps_its_account_through_the_next_launch() {
        let _env = crate::paths::data_dir_env_lock();
        let data = DataDir::new();
        let mut github = gitlab_account(GITHUB_COM);
        github.kind = ForgeKind::GitHub;
        github.name = Some("Octo Cat".into());
        github.avatar_url = Some("https://avatars.example/o.png".into());
        github.ca_file = Some("/certs/corp ca.pem".into());
        let sign_in = ForgeToken {
            token: "gho_signedin123".into(),
            refresh: None,
            expires_at: None,
        };
        store().unwrap().save(github.clone(), sign_in).unwrap();
        // What `forge_sign_in_token` and the browser sign-in do next.
        mirror_legacy_github(GITHUB_COM, Some(("gho_signedin123", "octocat"))).unwrap();

        // The next launch is a new process: a new store handle migrates again
        // from the config the mirror wrote.
        let relaunched = ForgeStore::new(data.path());
        let changed = relaunched
            .migrate_legacy_github(read_legacy_github)
            .unwrap();

        assert!(!changed, "the mirror is read as this build's own write");
        assert_eq!(relaunched.accounts().unwrap(), vec![github]);
        assert_eq!(
            relaunched.token(GITHUB_COM).unwrap().unwrap().token,
            "gho_signedin123"
        );
    }

    #[test]
    fn an_older_build_signing_in_after_a_mirror_is_still_followed() {
        let _env = crate::paths::data_dir_env_lock();
        let data = DataDir::new();
        let mut github = gitlab_account(GITHUB_COM);
        github.kind = ForgeKind::GitHub;
        store()
            .unwrap()
            .save(
                github,
                ForgeToken {
                    token: "gho_signedin123".into(),
                    refresh: None,
                    expires_at: None,
                },
            )
            .unwrap();
        mirror_legacy_github(GITHUB_COM, Some(("gho_signedin123", "octocat"))).unwrap();
        // A downgrade: 0.4.7 signs in as someone else.
        crate::config::update_config(|config| {
            config.github_token = "gho_elsewhere456".into();
            config.github_user = "other".into();
            Ok(())
        })
        .unwrap();

        let relaunched = ForgeStore::new(data.path());
        assert!(relaunched
            .migrate_legacy_github(read_legacy_github)
            .unwrap());
        assert_eq!(relaunched.accounts().unwrap()[0].login, "other");
    }

    #[test]
    fn a_config_that_cannot_be_read_does_not_stop_git_hosting() {
        let _env = crate::paths::data_dir_env_lock();
        let data = DataDir::new();
        std::fs::write(data.path().join("config.json"), "{ not json").unwrap();

        // The legacy sign-in cannot be read, yet the accounts still open.
        let opened = store().expect("Git hosting works without the legacy sign-in");
        assert!(opened.accounts().unwrap().is_empty());
        opened
            .save(
                gitlab_account("https://gitlab.com"),
                ForgeToken {
                    token: "glpat-plain-secret".into(),
                    refresh: None,
                    expires_at: None,
                },
            )
            .unwrap();
        let file: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(data.path().join(oleafly_forge::store::ACCOUNTS_FILE))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            file["legacyGithubMigrated"], false,
            "a migration that failed is not marked done"
        );

        // Once the config reads again, the next call migrates.
        std::fs::remove_file(data.path().join("config.json")).unwrap();
        crate::config::update_config(|config| {
            config.github_token = "gho_legacy1234".into();
            config.github_user = "octocat".into();
            Ok(())
        })
        .unwrap();
        let accounts = store().unwrap().accounts().unwrap();
        assert!(accounts.iter().any(|account| account.base == GITHUB_COM));
    }

    #[test]
    fn signing_out_of_github_clears_the_legacy_token_too() {
        let _env = crate::paths::data_dir_env_lock();
        let _data = DataDir::new();
        mirror_legacy_github(GITHUB_COM, Some(("gho_mirrored123", "octocat"))).unwrap();
        assert_eq!(
            crate::config::read_config().unwrap().github_token,
            "gho_mirrored123"
        );
        mirror_legacy_github(GITHUB_COM, None).unwrap();
        let config = crate::config::read_config().unwrap();
        assert!(config.github_token.is_empty());
        assert!(config.github_user.is_empty());
    }

    #[test]
    fn a_config_that_cannot_be_written_never_fails_a_github_sign_in_or_out() {
        let _env = crate::paths::data_dir_env_lock();
        let data = DataDir::new();
        let mut github = gitlab_account(GITHUB_COM);
        github.kind = ForgeKind::GitHub;
        store()
            .unwrap()
            .save(
                github,
                ForgeToken {
                    token: "gho_signedin123".into(),
                    refresh: None,
                    expires_at: None,
                },
            )
            .unwrap();
        std::fs::write(data.path().join("config.json"), "{ not json").unwrap();
        assert!(
            mirror_legacy_github(GITHUB_COM, None).is_err(),
            "the copy for earlier versions can't be written"
        );

        mirror_legacy_github_or_log(GITHUB_COM, Some(("gho_signedin123", "octocat")));
        assert_eq!(store().unwrap().accounts().unwrap().len(), 1);
        sign_out_here(GITHUB_COM).unwrap();
        assert!(store().unwrap().accounts().unwrap().is_empty());
        assert!(store().unwrap().token(GITHUB_COM).unwrap().is_none());
    }

    #[test]
    fn other_hosts_never_touch_the_legacy_github_fields() {
        let _env = crate::paths::data_dir_env_lock();
        let _data = DataDir::new();
        mirror_legacy_github(GITHUB_COM, Some(("gho_mirrored123", "octocat"))).unwrap();
        mirror_legacy_github("https://gitlab.com", None).unwrap();
        mirror_legacy_github("https://gitlab.com", Some(("glpat-other1234", "lab"))).unwrap();
        let config = crate::config::read_config().unwrap();
        assert_eq!(config.github_token, "gho_mirrored123");
        assert_eq!(config.github_user, "octocat");
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn a_missing_account_is_named_by_its_host() {
        let _env = crate::paths::data_dir_env_lock();
        let _data = DataDir::new();
        let error = account_and_token("https://git.example.org")
            .await
            .unwrap_err();
        let json = envelope(&error);
        assert_eq!(json["code"], "git.account_missing");
        assert_eq!(json["params"]["host"], "git.example.org");
    }
}
