//! Which sign-in a remote Git command uses: the token of the account whose
//! base URL the remote lies under, or the user's own Git setup for every
//! other remote (SSH, other servers, servers without an account).
use super::{app_error, host_label, http_for_async, now_ms, store};
use crate::git::{AccountCredential, RemoteAuth};
use oleafly_forge::address::{self, RemoteProtocol};
use oleafly_forge::git::valid_token;
use oleafly_forge::{ForgeAccount, ForgeError, ForgeToken};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

/// The sign-in for a remote address. Only `http(s)` remotes under an
/// account's base get its token; a GitLab OAuth token is refreshed first.
pub(crate) async fn remote_auth_for_url(url: &str) -> Result<RemoteAuth, String> {
    let Some(remote) = address::parse_remote(url) else {
        return Ok(RemoteAuth::User);
    };
    if !matches!(
        remote.protocol,
        RemoteProtocol::Https | RemoteProtocol::Http
    ) {
        return Ok(RemoteAuth::User);
    }
    let target = url.trim().to_string();
    let found = tauri::async_runtime::spawn_blocking(move || {
        let read = store().and_then(|store| {
            let accounts = store
                .accounts()
                .map_err(|error| app_error(&error, &host_label(&target)))?;
            Ok((store, accounts))
        });
        match read {
            Ok((store, accounts)) => address::account_for_remote(&accounts, &target)
                .cloned()
                .map(|account| (store, account)),
            // An account store that can't be read (damaged, locked) never
            // stops a remote: Git signs in as the user set it up to.
            Err(error) => {
                note_unreadable_accounts(&error);
                None
            }
        }
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some((store, account)) = found else {
        return Ok(RemoteAuth::User);
    };
    let host = host_label(&account.base);
    let http = http_for_async(account.ca_file.clone())
        .await
        .map_err(|error| app_error(&error, &host))?;
    match store.usable_token(&http, &account.base, now_ms()).await {
        Ok(Some(token)) => Ok(RemoteAuth::Account(credential_for(&account, &token)?)),
        // An account without a token reads as signed out in Settings; Git
        // still gets a chance with the user's own sign-in.
        Ok(None) => Ok(RemoteAuth::User),
        Err(error) => Err(app_error(&error, &host)),
    }
}

/// Write an account store that can't be read to the app log, once per
/// process.
fn note_unreadable_accounts(error: &str) {
    static LOGGED: AtomicBool = AtomicBool::new(false);
    if LOGGED.swap(true, Ordering::Relaxed) {
        return;
    }
    let _ = crate::project::append_app_log(format!(
        "Oleafly couldn't read the Git hosting accounts ({}), so Git signs in with your own setup for now.",
        crate::app_error::english_error(error)
    ));
}

/// What Git needs to sign in as `account`: its base URL as the credential
/// scope, the server's user name for tokens, the token and any CA file.
pub(crate) fn credential_for(
    account: &ForgeAccount,
    token: &ForgeToken,
) -> Result<AccountCredential, String> {
    if !valid_token(&token.token) {
        return Err(app_error(
            &ForgeError::InvalidToken,
            &host_label(&account.base),
        ));
    }
    Ok(AccountCredential {
        credential_url: account.base.clone(),
        username: account.kind.git_username(&account.login),
        login: account.login.clone(),
        token: token.token.clone(),
        ca_file: account.ca_file.as_ref().map(PathBuf::from),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::forge::tests::DataDir;
    use oleafly_forge::kind::{AuthMethod, ForgeKind};

    fn account(base: &str, kind: ForgeKind, login: &str) -> ForgeAccount {
        ForgeAccount {
            base: base.to_string(),
            kind,
            flavor: None,
            login: login.to_string(),
            name: None,
            avatar_url: None,
            ca_file: Some("/certs/corp ca.pem".into()),
            auth: AuthMethod::Token,
            added_at: 1,
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
    fn credentials_use_each_servers_user_name_and_the_account_scope() {
        let gitea = credential_for(
            &account("https://git.example.org", ForgeKind::Gitea, "zoe"),
            &token("gitea-token-1234"),
        )
        .unwrap();
        assert_eq!(gitea.username, "zoe");
        assert_eq!(gitea.credential_url, "https://git.example.org");
        assert_eq!(gitea.ca_file, Some(PathBuf::from("/certs/corp ca.pem")));
        let gitlab = credential_for(
            &account("https://gitlab.com", ForgeKind::GitLab, "zoe"),
            &token("glpat-test-1234"),
        )
        .unwrap();
        assert_eq!(gitlab.username, "oauth2");
        let refused = credential_for(
            &account("https://gitlab.com", ForgeKind::GitLab, "zoe"),
            &token("bad token\n"),
        )
        .unwrap_err();
        assert!(refused.contains("git.forge_token_invalid"), "{refused}");
        assert!(!refused.contains("bad token"));
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn only_remotes_under_an_account_get_its_token() {
        let _env = crate::paths::data_dir_env_lock();
        let _data = DataDir::new();
        let mut lab = account("https://example.org/gitlab", ForgeKind::GitLab, "zoe");
        lab.ca_file = None;
        store()
            .unwrap()
            .save(lab, token("glpat-test-1234"))
            .unwrap();

        let matched = remote_auth_for_url("https://example.org/gitlab/g/p.git")
            .await
            .unwrap();
        let RemoteAuth::Account(credential) = matched else {
            panic!("the account's remote gets its token");
        };
        assert_eq!(credential.credential_url, "https://example.org/gitlab");
        assert_eq!(credential.token, "glpat-test-1234");

        for other in [
            "https://example.org/g/p.git",
            "git@example.org:gitlab/g/p.git",
            "https://gitlab.com/g/p.git",
            "/home/zoe/remote.git",
        ] {
            assert!(
                matches!(remote_auth_for_url(other).await.unwrap(), RemoteAuth::User),
                "{other}"
            );
        }
    }

    #[test]
    fn a_damaged_account_store_leaves_git_to_the_users_own_sign_in() {
        let _env = crate::paths::data_dir_env_lock();
        let data = DataDir::new();
        std::fs::write(
            data.path().join(oleafly_forge::store::ACCOUNTS_FILE),
            "{ not json",
        )
        .unwrap();
        let auth = tauri::async_runtime::block_on(remote_auth_for_url(
            "https://bitbucket.org/team/paper.git",
        ))
        .unwrap();
        assert!(matches!(auth, RemoteAuth::User));
    }
}
