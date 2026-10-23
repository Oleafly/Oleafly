//! Git hosting accounts: non-secret metadata in `<root>/forge-accounts.json`,
//! tokens in the encrypted `forge_tokens` secret of `oleafly-secrets`.
//!
//! `<root>/.forge-store.lock` serializes the app, the CLI and the daemon:
//! readers take it shared, writers exclusive. Token refreshes take a second
//! lock, `<root>/.forge-refresh.lock`, so a slow refresh never blocks a
//! reader. Lock order is forge store, then the app's config, then the secret
//! store; nothing takes them the other way round. A refresh holds the refresh
//! lock and takes the store lock inside it; nothing takes the refresh lock
//! while holding the store lock.
use crate::address::normalize_base_url;
use crate::git::valid_token;
use crate::http::ForgeHttp;
use crate::kind::{AuthMethod, ForgeKind, ServerFlavor, GITHUB_COM};
use crate::oauth;
use crate::{blocking, ForgeError, ForgeToken};
use oleafly_secrets::accounts as secret_accounts;
use oleafly_secrets::SecretStore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

pub use oleafly_secrets::accounts::FORGE_TOKENS_ACCOUNT;

/// The account metadata file inside the data folder.
pub const ACCOUNTS_FILE: &str = "forge-accounts.json";
const LOCK_FILE: &str = ".forge-store.lock";
const REFRESH_LOCK_FILE: &str = ".forge-refresh.lock";

/// One signed-in account. Never holds a token.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeAccount {
    /// The normalized base URL, the account's key.
    pub base: String,
    pub kind: ForgeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flavor: Option<ServerFlavor>,
    pub login: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    /// A certificate authority file for servers whose certificate comes from
    /// the user's organization.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ca_file: Option<String>,
    pub auth: AuthMethod,
    /// Epoch milliseconds.
    pub added_at: u64,
}

/// The GitHub sign-in of 0.4.7 and earlier: `github_token` in the encrypted
/// store and `github_user` in `config.json`.
pub struct LegacyGithub {
    pub token: String,
    pub login: String,
}

impl std::fmt::Debug for LegacyGithub {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LegacyGithub")
            .field("token", &"[redacted]")
            .field("login", &self.login)
            .finish()
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountsFile {
    #[serde(default = "first_version")]
    version: u32,
    #[serde(default)]
    accounts: Vec<ForgeAccount>,
    #[serde(default)]
    legacy_github_migrated: bool,
    /// The legacy GitHub token's fingerprint when last read (`""` for none),
    /// so a sign-in an older build made after a downgrade is noticed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    legacy_github_seen: Option<String>,
}

fn first_version() -> u32 {
    1
}

impl Default for AccountsFile {
    fn default() -> Self {
        AccountsFile {
            version: first_version(),
            accounts: Vec::new(),
            legacy_github_migrated: false,
            legacy_github_seen: None,
        }
    }
}

/// Holds one of the store's lock files until dropped.
pub(crate) struct StoreLock {
    _file: std::fs::File,
}

fn store_error(detail: impl std::fmt::Display) -> ForgeError {
    ForgeError::Store {
        detail: detail.to_string(),
    }
}

/// The accounts of one data folder. Cheap to clone, so async code can move a
/// clone into blocking work.
#[derive(Clone, Debug)]
pub struct ForgeStore {
    root: PathBuf,
    secrets: SecretStore,
}

impl ForgeStore {
    /// The store of the data folder `root` (the app's `oleafly_root`, the
    /// CLI's `oleafly_secrets::paths::data_root`).
    pub fn new(root: impl Into<PathBuf>) -> ForgeStore {
        let root = root.into();
        ForgeStore {
            secrets: SecretStore::at(&root),
            root,
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn lock_named(&self, name: &str, exclusive: bool) -> Result<StoreLock, ForgeError> {
        std::fs::create_dir_all(&self.root)
            .map_err(|error| store_error(format!("could not create the data folder: {error}")))?;
        let path = self.root.join(name);
        if std::fs::symlink_metadata(&path)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false)
        {
            return Err(store_error(
                "the account store lock cannot be a symbolic link",
            ));
        }
        let mut options = std::fs::OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options.open(&path).map_err(|error| {
            store_error(format!("could not open the account store lock: {error}"))
        })?;
        oleafly_core::locking::lock_file(
            &file,
            exclusive,
            oleafly_core::locking::STORAGE_LOCK_TIMEOUT,
        )
        .map_err(|error| store_error(format!("could not lock the account store: {error}")))?;
        Ok(StoreLock { _file: file })
    }

    fn lock(&self, exclusive: bool) -> Result<StoreLock, ForgeError> {
        self.lock_named(LOCK_FILE, exclusive)
    }

    /// Serializes token refreshes across processes.
    pub(crate) fn lock_refresh(&self) -> Result<StoreLock, ForgeError> {
        self.lock_named(REFRESH_LOCK_FILE, true)
    }

    fn file_path(&self) -> PathBuf {
        self.root.join(ACCOUNTS_FILE)
    }

    /// The accounts file. A missing file means no accounts; a corrupt one is
    /// an error, never an empty list that a later write would save.
    fn read_file_locked(&self) -> Result<AccountsFile, ForgeError> {
        let path = self.file_path();
        if std::fs::symlink_metadata(&path)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false)
        {
            return Err(store_error(format!(
                "{ACCOUNTS_FILE} cannot be a symbolic link"
            )));
        }
        match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|error| store_error(format!("{ACCOUNTS_FILE} is corrupt: {error}"))),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(AccountsFile::default())
            }
            Err(error) => Err(store_error(format!(
                "could not read {ACCOUNTS_FILE}: {error}"
            ))),
        }
    }

    fn write_file_locked(&self, file: &AccountsFile) -> Result<(), ForgeError> {
        let mut bytes = serde_json::to_vec_pretty(file).map_err(store_error)?;
        bytes.push(b'\n');
        let path = self.file_path();
        oleafly_secrets::fs::write_atomic(&path, &bytes).map_err(store_error)?;
        oleafly_secrets::fsperm::harden_file(&path);
        Ok(())
    }

    /// Every account, in the order they were added.
    pub fn accounts(&self) -> Result<Vec<ForgeAccount>, ForgeError> {
        let _lock = self.lock(false)?;
        Ok(self.read_file_locked()?.accounts)
    }

    pub fn account(&self, base: &str) -> Result<Option<ForgeAccount>, ForgeError> {
        let base = normalize_base_url(base)?;
        let _lock = self.lock(false)?;
        Ok(self
            .read_file_locked()?
            .accounts
            .into_iter()
            .find(|account| account.base == base))
    }

    /// The stored token for `base`, as it is (see [`ForgeStore::usable_token`]
    /// for one that is refreshed when it is about to expire).
    pub fn token(&self, base: &str) -> Result<Option<ForgeToken>, ForgeError> {
        let base = normalize_base_url(base)?;
        secret_accounts::forge_token(&self.secrets, &base).map_err(store_error)
    }

    /// Save an account and its token. The token is checked before anything
    /// is written; an existing account for the same base is replaced.
    pub fn save(&self, account: ForgeAccount, token: ForgeToken) -> Result<(), ForgeError> {
        let mut account = account;
        account.base = normalize_base_url(&account.base)?;
        let token = ForgeToken {
            token: token.token.trim().to_string(),
            refresh: token.refresh.map(|refresh| refresh.trim().to_string()),
            expires_at: token.expires_at,
        };
        if !valid_token(&token.token)
            || token
                .refresh
                .as_deref()
                .is_some_and(|refresh| !valid_token(refresh))
        {
            return Err(ForgeError::InvalidToken);
        }
        let _lock = self.lock(true)?;
        let mut file = self.read_file_locked()?;
        secret_accounts::save_forge_token(&self.secrets, &account.base, token)
            .map_err(store_error)?;
        match file
            .accounts
            .iter_mut()
            .find(|existing| existing.base == account.base)
        {
            Some(existing) => *existing = account,
            None => file.accounts.push(account),
        }
        self.write_file_locked(&file)
    }

    /// Replace an account's metadata (login, name, avatar, CA file). Never
    /// touches its token.
    pub fn update_account(&self, account: ForgeAccount) -> Result<(), ForgeError> {
        let mut account = account;
        account.base = normalize_base_url(&account.base)?;
        let _lock = self.lock(true)?;
        let mut file = self.read_file_locked()?;
        let Some(existing) = file
            .accounts
            .iter_mut()
            .find(|existing| existing.base == account.base)
        else {
            return Err(store_error("there is no account for this server"));
        };
        *existing = account;
        self.write_file_locked(&file)
    }

    /// Save a changed login, name or picture into the account as it is now.
    /// Only those three fields change, inside the exclusive lock, so a check
    /// that started before the user changed the CA file never writes the old
    /// one back. Returns the stored account, or `None` when it was removed.
    pub fn update_profile(
        &self,
        base: &str,
        login: &str,
        name: Option<String>,
        avatar_url: Option<String>,
    ) -> Result<Option<ForgeAccount>, ForgeError> {
        self.patch_account(base, |account| {
            account.login = login.to_string();
            account.name = name;
            account.avatar_url = avatar_url;
        })
    }

    /// Set or clear an account's CA file in the account as it is now.
    /// Returns the stored account, or `None` when it was removed.
    pub fn set_ca_file(
        &self,
        base: &str,
        ca_file: Option<String>,
    ) -> Result<Option<ForgeAccount>, ForgeError> {
        self.patch_account(base, |account| account.ca_file = ca_file)
    }

    fn patch_account(
        &self,
        base: &str,
        patch: impl FnOnce(&mut ForgeAccount),
    ) -> Result<Option<ForgeAccount>, ForgeError> {
        let base = normalize_base_url(base)?;
        let _lock = self.lock(true)?;
        let mut file = self.read_file_locked()?;
        let Some(account) = file
            .accounts
            .iter_mut()
            .find(|account| account.base == base)
        else {
            return Ok(None);
        };
        let before = account.clone();
        patch(account);
        let after = account.clone();
        if after != before {
            self.write_file_locked(&file)?;
        }
        Ok(Some(after))
    }

    /// Add or replace an account's metadata without touching its token, for
    /// a token that was saved without an account.
    pub(crate) fn put_account(&self, account: ForgeAccount) -> Result<(), ForgeError> {
        let mut account = account;
        account.base = normalize_base_url(&account.base)?;
        let _lock = self.lock(true)?;
        let mut file = self.read_file_locked()?;
        match file
            .accounts
            .iter_mut()
            .find(|existing| existing.base == account.base)
        {
            Some(existing) => *existing = account,
            None => file.accounts.push(account),
        }
        self.write_file_locked(&file)
    }

    /// Forget an account. The token goes first, so a failure part way leaves
    /// an account that reads as signed out, never a hidden token. Returns
    /// whether there was anything to forget.
    pub fn remove(&self, base: &str) -> Result<bool, ForgeError> {
        let base = normalize_base_url(base)?;
        let _lock = self.lock(true)?;
        let mut file = self.read_file_locked()?;
        let had_token =
            secret_accounts::forget_forge_token(&self.secrets, &base).map_err(store_error)?;
        let before = file.accounts.len();
        file.accounts.retain(|account| account.base != base);
        let had_account = file.accounts.len() != before;
        if had_account {
            self.write_file_locked(&file)?;
        }
        Ok(had_token || had_account)
    }

    /// Servers that have a token but no account, such as one saved by an
    /// older command-line tool. [`crate::accounts::adopt_orphan`] completes
    /// them.
    pub fn orphan_bases(&self) -> Result<Vec<String>, ForgeError> {
        let _lock = self.lock(false)?;
        let file = self.read_file_locked()?;
        let tokens = secret_accounts::forge_tokens(&self.secrets).map_err(store_error)?;
        Ok(tokens
            .into_keys()
            .filter(|base| !file.accounts.iter().any(|account| &account.base == base))
            .collect())
    }

    /// Store a refreshed token, unless the account was signed out or signed
    /// in again while the refresh ran: then the refreshed token is dropped,
    /// so a sign-out is never undone. `spent_refresh` is the refresh token
    /// the refresh used. Returns the token now stored (`None` when signed
    /// out).
    pub(crate) fn replace_refreshed_token(
        &self,
        base: &str,
        spent_refresh: Option<&str>,
        fresh: &ForgeToken,
    ) -> Result<Option<ForgeToken>, ForgeError> {
        let _lock = self.lock(true)?;
        let file = self.read_file_locked()?;
        if !file.accounts.iter().any(|account| account.base == base) {
            return Ok(None);
        }
        let current = secret_accounts::forge_token(&self.secrets, base).map_err(store_error)?;
        let unchanged = current
            .as_ref()
            .is_some_and(|token| token.refresh.as_deref() == spent_refresh);
        if !unchanged {
            return Ok(current);
        }
        secret_accounts::save_forge_token(&self.secrets, base, fresh.clone())
            .map_err(store_error)?;
        Ok(Some(fresh.clone()))
    }

    /// Turn the 0.4.7 GitHub sign-in into a github.com account the first
    /// time, and later follow a new sign-in an older build made after a
    /// downgrade (its token then replaces the github.com one). The legacy
    /// token stays where it is so an older build keeps working. `read_legacy`
    /// runs while this store's lock is held and may take the app's config
    /// lock (lock order: forge store, config). Returns whether the github.com
    /// account changed.
    pub fn migrate_legacy_github(
        &self,
        read_legacy: impl FnOnce() -> Result<Option<LegacyGithub>, String>,
    ) -> Result<bool, ForgeError> {
        let _lock = self.lock(true)?;
        let mut file = self.read_file_locked()?;
        let legacy = read_legacy().map_err(store_error)?;
        let usable = legacy
            .as_ref()
            .filter(|legacy| valid_token(legacy.token.trim()));
        let seen = usable
            .map(|legacy| secret_accounts::token_fingerprint(legacy.token.trim()))
            .unwrap_or_default();
        if file.legacy_github_migrated && file.legacy_github_seen.as_deref() == Some(seen.as_str())
        {
            return Ok(false);
        }
        let first = !file.legacy_github_migrated;
        // An older build signed in since this one last looked. (A file from
        // before fingerprints only gets one recorded.)
        let signed_in_elsewhere = !first && file.legacy_github_seen.is_some();
        let existing = file
            .accounts
            .iter()
            .position(|account| account.base == GITHUB_COM);
        // A github.com token saved without an account (`oleafly auth login
        // git`) is newer than the 0.4.7 sign-in the first run would import,
        // and it gets its account later; only a sign-in an older build made
        // since then replaces it.
        let saved_token = secret_accounts::forge_token(&self.secrets, GITHUB_COM)
            .map_err(store_error)?
            .is_some();
        let mut changed = false;
        if let Some(legacy) = usable {
            let token = legacy.token.trim();
            if (first && existing.is_none() && !saved_token) || signed_in_elsewhere {
                secret_accounts::save_forge_token(
                    &self.secrets,
                    GITHUB_COM,
                    ForgeToken {
                        token: token.to_string(),
                        refresh: None,
                        expires_at: None,
                    },
                )
                .map_err(store_error)?;
                let account = ForgeAccount {
                    base: GITHUB_COM.to_string(),
                    kind: ForgeKind::GitHub,
                    flavor: None,
                    login: legacy.login.trim().to_string(),
                    name: None,
                    avatar_url: None,
                    ca_file: None,
                    auth: if token.starts_with("gho_") {
                        AuthMethod::OAuth
                    } else {
                        AuthMethod::Token
                    },
                    added_at: existing
                        .map(|index| file.accounts[index].added_at)
                        .unwrap_or_else(crate::now_ms),
                };
                match existing {
                    Some(index) => file.accounts[index] = account,
                    None => file.accounts.push(account),
                }
                changed = true;
            }
        }
        file.legacy_github_migrated = true;
        file.legacy_github_seen = Some(seen);
        self.write_file_locked(&file)?;
        Ok(changed)
    }

    /// Run `write_legacy`, which sets (or, for a sign-out, clears) the 0.4.7
    /// `github_token` and `github_user` to mirror the github.com account, and
    /// record that token's fingerprint. [`ForgeStore::migrate_legacy_github`]
    /// then reads the mirror as this build's own write, not as a sign-in an
    /// older build made, and leaves the account (its name, picture and CA
    /// file) alone. `token` is what `write_legacy` writes, `None` when it
    /// clears. `write_legacy` runs while this store's lock is held and may
    /// take the app's config lock (lock order: forge store, config).
    pub fn mirror_legacy_github(
        &self,
        token: Option<&str>,
        write_legacy: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), ForgeError> {
        let _lock = self.lock(true)?;
        let mut file = self.read_file_locked()?;
        write_legacy().map_err(store_error)?;
        file.legacy_github_migrated = true;
        file.legacy_github_seen = Some(
            token
                .map(str::trim)
                .filter(|token| valid_token(token))
                .map(secret_accounts::token_fingerprint)
                .unwrap_or_default(),
        );
        self.write_file_locked(&file)
    }

    /// The token for `base`, refreshed first when it is a GitLab OAuth token
    /// about to expire. `Ok(None)` when no token is stored.
    pub async fn usable_token(
        &self,
        http: &ForgeHttp,
        base: &str,
        now_ms: u64,
    ) -> Result<Option<ForgeToken>, ForgeError> {
        self.usable_token_with(http, base, now_ms, oauth::GITLAB_COM_CLIENT_ID)
            .await
    }

    /// [`ForgeStore::usable_token`] with an explicit GitLab client id. The
    /// only place a token is ever refreshed: one refresh per base at a time
    /// in this process (a gate) and across processes (the refresh lock), so
    /// two pushes never spend one rotating refresh token twice.
    pub async fn usable_token_with(
        &self,
        http: &ForgeHttp,
        base: &str,
        now_ms: u64,
        gitlab_client_id: Option<&str>,
    ) -> Result<Option<ForgeToken>, ForgeError> {
        let base = normalize_base_url(base)?;
        let store = self.clone();
        let lookup = base.clone();
        let Some(token) = blocking(move || store.token(&lookup)).await? else {
            return Ok(None);
        };
        if !oauth::needs_refresh(&token, now_ms) {
            return Ok(Some(token));
        }

        let gate = refresh_gate(&self.root, &base);
        let _in_process = gate.lock().await;
        let store = self.clone();
        let refresh_lock = blocking(move || store.lock_refresh()).await?;
        let store = self.clone();
        let lookup = base.clone();
        let (account, current) =
            blocking(move || Ok((store.account(&lookup)?, store.token(&lookup)?))).await?;
        let current = match current {
            Some(token) if oauth::needs_refresh(&token, now_ms) => token,
            // Someone else refreshed or signed out while this one waited.
            other => return Ok(other),
        };
        let refreshable = account.filter(|account| {
            account.kind == ForgeKind::GitLab && account.auth == AuthMethod::OAuth
        });
        let (Some(_), Some(client_id), Some(refresh)) =
            (refreshable, gitlab_client_id, current.refresh.clone())
        else {
            return Ok(Some(current));
        };
        let grant = match oauth::refresh_gitlab(http, &base, client_id, &refresh).await {
            Ok(grant) => grant,
            Err(ForgeError::Unauthorized) => return Err(ForgeError::Unauthorized),
            // A network problem: the token still works until it expires.
            Err(_) if !oauth::expired(&current, now_ms) => return Ok(Some(current)),
            Err(error) => return Err(error),
        };
        let mut fresh = grant.into_token(now_ms);
        if fresh.refresh.is_none() {
            fresh.refresh = current.refresh.clone();
        }
        let store = self.clone();
        let target = base.clone();
        let saved = fresh.clone();
        let stored = blocking(move || {
            store.replace_refreshed_token(&target, current.refresh.as_deref(), &saved)
        })
        .await?;
        drop(refresh_lock);
        Ok(stored)
    }
}

type Gate = Arc<tokio::sync::Mutex<()>>;

/// One async mutex per data folder and base URL.
fn refresh_gate(root: &Path, base: &str) -> Gate {
    static GATES: OnceLock<Mutex<HashMap<(PathBuf, String), Gate>>> = OnceLock::new();
    let mut gates = GATES
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    gates
        .entry((root.to_path_buf(), base.to_string()))
        .or_default()
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account(base: &str) -> ForgeAccount {
        ForgeAccount {
            base: base.to_string(),
            kind: ForgeKind::GitLab,
            flavor: None,
            login: "octo".into(),
            name: Some("Octo Cat".into()),
            avatar_url: None,
            ca_file: None,
            auth: AuthMethod::Token,
            added_at: 1_760_000_000_000,
        }
    }

    fn token(value: &str) -> ForgeToken {
        ForgeToken {
            token: value.to_string(),
            refresh: None,
            expires_at: None,
        }
    }

    #[test]
    fn tokens_round_trip_with_camel_case_fields_and_expiry_in_seconds() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let saved = ForgeToken {
            token: "glpat-abc12345".into(),
            refresh: Some("rt-1-refresh".into()),
            expires_at: Some(1_760_000_000),
        };
        store
            .save(account("https://gitlab.com"), saved.clone())
            .unwrap();
        assert_eq!(store.token("https://gitlab.com").unwrap(), Some(saved));
        let raw = SecretStore::at(dir.path())
            .get(FORGE_TOKENS_ACCOUNT)
            .unwrap()
            .unwrap();
        assert!(raw.contains("\"expiresAt\":1760000000"), "{raw}");
        assert!(raw.contains("\"refresh\":\"rt-1-refresh\""), "{raw}");
    }

    #[test]
    fn removing_the_last_account_clears_the_secret() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        store
            .save(account("https://gitlab.com"), token("glpat-abc12345"))
            .unwrap();
        assert!(store.remove("https://gitlab.com").unwrap());
        assert_eq!(
            SecretStore::at(dir.path())
                .get(FORGE_TOKENS_ACCOUNT)
                .unwrap(),
            None
        );
        assert!(!store.remove("https://gitlab.com").unwrap());
    }

    #[test]
    fn a_corrupt_token_secret_reads_as_signed_out_and_keeps_the_account() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        store
            .save(account("https://gitlab.com"), token("glpat-abc12345"))
            .unwrap();
        SecretStore::at(dir.path())
            .set(&[(FORGE_TOKENS_ACCOUNT, "{not json")])
            .unwrap();
        assert_eq!(store.token("https://gitlab.com").unwrap(), None);
        assert_eq!(store.accounts().unwrap().len(), 1);
    }

    #[test]
    fn debug_output_never_contains_a_token() {
        let secret = ForgeToken {
            token: "glpat-secret".into(),
            refresh: Some("rt-secret".into()),
            expires_at: Some(1),
        };
        let debug = format!("{secret:?}");
        assert!(
            !debug.contains("glpat-secret") && !debug.contains("rt-secret"),
            "{debug}"
        );
        let legacy = LegacyGithub {
            token: "gho_legacy-secret".into(),
            login: "octocat".into(),
        };
        assert!(!format!("{legacy:?}").contains("gho_legacy-secret"));
    }

    #[test]
    fn saving_an_account_writes_the_token_and_the_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let saved = account("https://gitlab.com");
        store
            .save(saved.clone(), token("glpat-plain-secret"))
            .unwrap();
        assert_eq!(store.accounts().unwrap(), vec![saved.clone()]);
        assert_eq!(store.account("gitlab.com").unwrap(), Some(saved));
        assert_eq!(
            store.token("https://gitlab.com").unwrap().unwrap().token,
            "glpat-plain-secret"
        );
        let text = std::fs::read_to_string(dir.path().join(ACCOUNTS_FILE)).unwrap();
        assert!(!text.contains("glpat-plain-secret"), "{text}");
        assert!(text.contains("\"addedAt\""), "{text}");
        let secrets = std::fs::read(dir.path().join("app-secrets.json")).unwrap();
        assert!(!String::from_utf8_lossy(&secrets).contains("glpat-plain-secret"));
    }

    #[test]
    fn saving_twice_replaces_the_account_for_the_same_base() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        store
            .save(account("https://gitlab.com"), token("glpat-first123"))
            .unwrap();
        let mut renamed = account("https://gitlab.com/");
        renamed.login = "octo-two".into();
        store.save(renamed, token("glpat-second12")).unwrap();
        let accounts = store.accounts().unwrap();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].login, "octo-two");
        assert_eq!(accounts[0].base, "https://gitlab.com");
        assert_eq!(
            store.token("https://gitlab.com").unwrap().unwrap().token,
            "glpat-second12"
        );
    }

    #[test]
    fn removing_an_account_deletes_its_token_and_its_record() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        store
            .save(account("https://gitlab.com"), token("glpat-abc12345"))
            .unwrap();
        store
            .save(account("https://codeberg.org"), token("codeberg-token1"))
            .unwrap();
        assert!(store.remove("gitlab.com").unwrap());
        assert_eq!(store.token("https://gitlab.com").unwrap(), None);
        let left: Vec<String> = store
            .accounts()
            .unwrap()
            .into_iter()
            .map(|account| account.base)
            .collect();
        assert_eq!(left, ["https://codeberg.org"]);
        assert!(store.token("https://codeberg.org").unwrap().is_some());
    }

    #[test]
    fn updating_metadata_never_touches_the_token() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        store
            .save(account("https://gitlab.com"), token("glpat-abc12345"))
            .unwrap();
        let mut changed = account("https://gitlab.com");
        changed.ca_file = Some("/etc/ssl/corp.pem".into());
        store.update_account(changed).unwrap();
        assert_eq!(
            store
                .account("https://gitlab.com")
                .unwrap()
                .unwrap()
                .ca_file
                .as_deref(),
            Some("/etc/ssl/corp.pem")
        );
        assert_eq!(
            store.token("https://gitlab.com").unwrap().unwrap().token,
            "glpat-abc12345"
        );
        assert!(matches!(
            store.update_account(account("https://codeberg.org")),
            Err(ForgeError::Store { .. })
        ));
    }

    #[test]
    fn a_corrupt_accounts_file_is_reported_and_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let path = dir.path().join(ACCOUNTS_FILE);
        std::fs::write(&path, "{").unwrap();
        assert!(matches!(store.accounts(), Err(ForgeError::Store { .. })));
        assert!(matches!(
            store.save(account("https://gitlab.com"), token("glpat-abc12345")),
            Err(ForgeError::Store { .. })
        ));
        assert_eq!(std::fs::read(&path).unwrap(), b"{");
        assert_eq!(
            store.token("https://gitlab.com").unwrap(),
            None,
            "the token is not saved when the account cannot be"
        );
    }

    #[test]
    fn concurrent_saves_keep_every_account() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let workers: Vec<_> = (0..8)
            .map(|index| {
                let store = ForgeStore::new(&root);
                std::thread::spawn(move || {
                    store
                        .save(
                            account(&format!("https://git{index}.example.org")),
                            token(&format!("token-number-{index}")),
                        )
                        .unwrap();
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
        let store = ForgeStore::new(&root);
        assert_eq!(store.accounts().unwrap().len(), 8);
        for index in 0..8 {
            assert_eq!(
                store
                    .token(&format!("https://git{index}.example.org"))
                    .unwrap()
                    .unwrap()
                    .token,
                format!("token-number-{index}")
            );
        }
    }

    #[test]
    fn store_paths_with_spaces_and_non_ascii_work() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path().join("Zoë Q data"));
        store
            .save(account("https://gitlab.com"), token("glpat-abc12345"))
            .unwrap();
        assert_eq!(store.accounts().unwrap().len(), 1);
        assert!(dir.path().join("Zoë Q data").join(ACCOUNTS_FILE).is_file());
    }

    #[test]
    fn invalid_tokens_are_refused_before_they_are_stored() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        assert_eq!(
            store.save(account("https://gitlab.com"), token("a b c d\n")),
            Err(ForgeError::InvalidToken)
        );
        let with_bad_refresh = ForgeToken {
            token: "glpat-abc12345".into(),
            refresh: Some("re\"fresh-x".into()),
            expires_at: None,
        };
        assert_eq!(
            store.save(account("https://gitlab.com"), with_bad_refresh),
            Err(ForgeError::InvalidToken)
        );
        assert!(!dir.path().join(ACCOUNTS_FILE).exists());
        assert_eq!(store.token("https://gitlab.com").unwrap(), None);
    }

    #[test]
    fn the_legacy_github_token_is_migrated_once() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let added = store
            .migrate_legacy_github(|| {
                Ok(Some(LegacyGithub {
                    token: "gho_legacy123".into(),
                    login: "octocat".into(),
                }))
            })
            .unwrap();
        assert!(added);
        let accounts = store.accounts().unwrap();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].base, GITHUB_COM);
        assert_eq!(accounts[0].kind, ForgeKind::GitHub);
        assert_eq!(accounts[0].auth, AuthMethod::OAuth);
        assert_eq!(accounts[0].login, "octocat");
        assert_eq!(
            store.token(GITHUB_COM).unwrap().unwrap().token,
            "gho_legacy123"
        );

        let legacy = |token: &str| -> Result<Option<LegacyGithub>, String> {
            Ok(Some(LegacyGithub {
                token: token.into(),
                login: "octocat".into(),
            }))
        };
        assert!(!store
            .migrate_legacy_github(|| legacy("gho_legacy123"))
            .unwrap());

        // A downgrade, a new sign-in in the older build, an upgrade again.
        assert!(store
            .migrate_legacy_github(|| legacy("gho_newer456"))
            .unwrap());
        assert_eq!(store.accounts().unwrap().len(), 1);
        assert_eq!(
            store.token(GITHUB_COM).unwrap().unwrap().token,
            "gho_newer456"
        );
        assert!(!store
            .migrate_legacy_github(|| legacy("gho_newer456"))
            .unwrap());
        // Signing out there leaves this build's account alone.
        assert!(!store.migrate_legacy_github(|| Ok(None)).unwrap());
        assert_eq!(
            store.token(GITHUB_COM).unwrap().unwrap().token,
            "gho_newer456"
        );

        for (legacy, method) in [
            ("ghp_legacy123", AuthMethod::Token),
            ("github_pat_11AAAA", AuthMethod::Token),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let store = ForgeStore::new(dir.path());
            assert!(store
                .migrate_legacy_github(|| Ok(Some(LegacyGithub {
                    token: legacy.into(),
                    login: "octocat".into(),
                })))
                .unwrap());
            assert_eq!(store.accounts().unwrap()[0].auth, method, "{legacy}");
        }
    }

    #[test]
    fn a_missing_legacy_token_still_marks_the_migration_done() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        assert!(!store.migrate_legacy_github(|| Ok(None)).unwrap());
        let text = std::fs::read_to_string(dir.path().join(ACCOUNTS_FILE)).unwrap();
        let file: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(file["legacyGithubMigrated"], true);
        assert_eq!(file["legacyGithubSeen"], "");
        assert_eq!(file["accounts"], serde_json::json!([]));
    }

    #[test]
    fn a_failed_legacy_read_is_retried_later() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        assert!(store
            .migrate_legacy_github(|| Err("config.json is corrupt".into()))
            .is_err());
        assert!(store
            .migrate_legacy_github(|| Ok(Some(LegacyGithub {
                token: "gho_legacy123".into(),
                login: "octocat".into(),
            })))
            .unwrap());
    }

    #[test]
    fn a_legacy_token_never_replaces_a_github_account() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let mut github = account(GITHUB_COM);
        github.kind = ForgeKind::GitHub;
        store.save(github, token("ghp_current123")).unwrap();
        assert!(!store
            .migrate_legacy_github(|| Ok(Some(LegacyGithub {
                token: "gho_legacy123".into(),
                login: "octocat".into(),
            })))
            .unwrap());
        assert_eq!(
            store.token(GITHUB_COM).unwrap().unwrap().token,
            "ghp_current123"
        );
    }

    fn github_account_with_details() -> ForgeAccount {
        let mut github = account(GITHUB_COM);
        github.kind = ForgeKind::GitHub;
        github.auth = AuthMethod::OAuth;
        github.avatar_url = Some("https://avatars.example/o.png".into());
        github.ca_file = Some("/etc/ssl/corp.pem".into());
        github
    }

    #[test]
    fn mirroring_the_legacy_token_keeps_the_account_through_the_next_launch() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        // First launch of a new user: nothing to migrate yet.
        assert!(!store.migrate_legacy_github(|| Ok(None)).unwrap());
        // Signing in saves the account, then mirrors the token for 0.4.7.
        let github = github_account_with_details();
        store
            .save(github.clone(), token("gho_signedin123"))
            .unwrap();
        let mut written = false;
        store
            .mirror_legacy_github(Some(" gho_signedin123 "), || {
                written = true;
                Ok(())
            })
            .unwrap();
        assert!(written);

        // The next launch is a new process with a new store handle.
        let relaunched = ForgeStore::new(dir.path());
        let changed = relaunched
            .migrate_legacy_github(|| {
                Ok(Some(LegacyGithub {
                    token: "gho_signedin123".into(),
                    login: "octo".into(),
                }))
            })
            .unwrap();
        assert!(!changed, "the mirror is this build's own write");
        assert_eq!(relaunched.accounts().unwrap(), vec![github]);
        assert_eq!(
            relaunched.token(GITHUB_COM).unwrap().unwrap().token,
            "gho_signedin123"
        );
    }

    #[test]
    fn mirroring_a_sign_out_leaves_the_next_migration_with_nothing_to_do() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        store
            .save(github_account_with_details(), token("gho_signedin123"))
            .unwrap();
        store
            .mirror_legacy_github(Some("gho_signedin123"), || Ok(()))
            .unwrap();
        store.mirror_legacy_github(None, || Ok(())).unwrap();
        assert!(!store.migrate_legacy_github(|| Ok(None)).unwrap());
        let text = std::fs::read_to_string(dir.path().join(ACCOUNTS_FILE)).unwrap();
        let file: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(file["legacyGithubMigrated"], true);
        assert_eq!(file["legacyGithubSeen"], "");
    }

    #[test]
    fn a_failed_legacy_write_records_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let failed = store.mirror_legacy_github(Some("gho_signedin123"), || {
            Err("config.json is corrupt".into())
        });
        assert!(matches!(failed, Err(ForgeError::Store { .. })));
        assert!(!dir.path().join(ACCOUNTS_FILE).exists());
    }

    #[test]
    fn an_older_build_signing_in_after_the_mirror_is_still_followed() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let github = github_account_with_details();
        store.save(github, token("gho_signedin123")).unwrap();
        store
            .mirror_legacy_github(Some("gho_signedin123"), || Ok(()))
            .unwrap();
        assert!(store
            .migrate_legacy_github(|| {
                Ok(Some(LegacyGithub {
                    token: "gho_elsewhere456".into(),
                    login: "other".into(),
                }))
            })
            .unwrap());
        assert_eq!(store.accounts().unwrap()[0].login, "other");
        assert_eq!(
            store.token(GITHUB_COM).unwrap().unwrap().token,
            "gho_elsewhere456"
        );
    }

    #[test]
    fn a_github_token_saved_by_the_cli_survives_the_first_migration() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        secret_accounts::save_forge_token(
            &SecretStore::at(dir.path()),
            GITHUB_COM,
            token("github_pat_fromcli"),
        )
        .unwrap();
        let legacy = |value: &str| -> Result<Option<LegacyGithub>, String> {
            Ok(Some(LegacyGithub {
                token: value.into(),
                login: "octocat".into(),
            }))
        };
        assert!(!store
            .migrate_legacy_github(|| legacy("gho_legacy123"))
            .unwrap());
        assert_eq!(
            store.token(GITHUB_COM).unwrap().unwrap().token,
            "github_pat_fromcli"
        );
        assert!(store.accounts().unwrap().is_empty());
        assert_eq!(store.orphan_bases().unwrap(), [GITHUB_COM]);

        // A sign-in an older build makes later still replaces it.
        assert!(store
            .migrate_legacy_github(|| legacy("gho_newer456"))
            .unwrap());
        assert_eq!(
            store.token(GITHUB_COM).unwrap().unwrap().token,
            "gho_newer456"
        );
    }

    #[test]
    fn a_profile_update_keeps_a_ca_file_set_after_the_check_began() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        store
            .save(account("https://gitlab.com"), token("glpat-abc12345"))
            .unwrap();
        // A check read the account without a CA file...
        let snapshot = store.account("https://gitlab.com").unwrap().unwrap();
        assert_eq!(snapshot.ca_file, None);
        // ...then the user set one before the check finished.
        store
            .set_ca_file("https://gitlab.com", Some("/etc/ssl/corp.pem".into()))
            .unwrap();
        let stored = store
            .update_profile(
                "https://gitlab.com",
                "octo-renamed",
                Some("New Name".into()),
                Some("https://a.example/n.png".into()),
            )
            .unwrap()
            .unwrap();
        assert_eq!(stored.login, "octo-renamed");
        assert_eq!(stored.name.as_deref(), Some("New Name"));
        assert_eq!(stored.ca_file.as_deref(), Some("/etc/ssl/corp.pem"));
        assert_eq!(store.accounts().unwrap(), vec![stored]);
        assert_eq!(
            store.update_profile("https://codeberg.org", "x", None, None),
            Ok(None)
        );
        assert_eq!(store.set_ca_file("https://codeberg.org", None), Ok(None));
        assert_eq!(
            store.token("https://gitlab.com").unwrap().unwrap().token,
            "glpat-abc12345"
        );
    }

    #[test]
    fn a_refreshed_token_is_dropped_when_the_account_was_signed_out_meanwhile() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let base = "https://gitlab.com";
        let spent = ForgeToken {
            token: "old-access-token".into(),
            refresh: Some("old-refresh-token".into()),
            expires_at: Some(1),
        };
        let fresh = ForgeToken {
            token: "new-access-token".into(),
            refresh: Some("new-refresh-token".into()),
            expires_at: Some(2),
        };
        store.save(account(base), spent).unwrap();
        assert!(store.remove(base).unwrap());
        assert_eq!(
            store
                .replace_refreshed_token(base, Some("old-refresh-token"), &fresh)
                .unwrap(),
            None
        );
        assert_eq!(store.token(base).unwrap(), None);
        assert!(store.orphan_bases().unwrap().is_empty());
    }

    #[test]
    fn a_refreshed_token_never_replaces_a_newer_sign_in() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let base = "https://gitlab.com";
        let spent = ForgeToken {
            token: "old-access-token".into(),
            refresh: Some("old-refresh-token".into()),
            expires_at: Some(1),
        };
        let fresh = ForgeToken {
            token: "new-access-token".into(),
            refresh: Some("new-refresh-token".into()),
            expires_at: Some(2),
        };
        store.save(account(base), spent.clone()).unwrap();
        assert_eq!(
            store
                .replace_refreshed_token(base, Some("old-refresh-token"), &fresh)
                .unwrap(),
            Some(fresh.clone()),
            "an unchanged token takes the refreshed one"
        );
        let signed_in_again = token("glpat-signed-in-again");
        store.save(account(base), signed_in_again.clone()).unwrap();
        assert_eq!(
            store
                .replace_refreshed_token(base, Some("new-refresh-token"), &fresh)
                .unwrap(),
            Some(signed_in_again.clone())
        );
        assert_eq!(store.token(base).unwrap(), Some(signed_in_again));
    }

    #[test]
    fn tokens_without_an_account_are_listed_as_orphans() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        store
            .save(account("https://gitlab.com"), token("glpat-abc12345"))
            .unwrap();
        secret_accounts::save_forge_token(
            &SecretStore::at(dir.path()),
            "https://git.example.org",
            token("cli-token-1234"),
        )
        .unwrap();
        assert_eq!(store.orphan_bases().unwrap(), ["https://git.example.org"]);
    }
}
