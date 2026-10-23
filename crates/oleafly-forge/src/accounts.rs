//! Account flows the app and the CLI share: sign in with an access token,
//! finish a browser (device) sign-in, check that an account still works,
//! and give a token that was saved without an account its account.
use crate::address::normalize_base_url;
use crate::api::{self, Session};
use crate::detect;
use crate::git::valid_token;
use crate::http::ForgeHttp;
use crate::kind::{preset, AuthMethod, ForgeKind, ServerFlavor, GITHUB_COM};
use crate::oauth::TokenGrant;
use crate::store::{ForgeAccount, ForgeStore};
use crate::{blocking, ForgeError, ForgeToken};
use serde::Serialize;

/// What checking an account found.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckState {
    Ok,
    SignedOut,
    Unreachable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountCheck {
    pub base: String,
    pub state: CheckState,
    pub account: Option<ForgeAccount>,
    /// The account's login, name or picture changed and was saved.
    #[serde(skip)]
    pub changed: bool,
}

async fn flavor_for(http: &ForgeHttp, kind: ForgeKind, base: &str) -> Option<ServerFlavor> {
    match kind {
        ForgeKind::Gitea => Some(match preset(base) {
            Some((_, Some(flavor))) => flavor,
            _ => detect::gitea_flavor(http, base).await,
        }),
        ForgeKind::GitHub | ForgeKind::GitLab => None,
    }
}

async fn stored_account(
    store: &ForgeStore,
    base: &str,
) -> Result<Option<ForgeAccount>, ForgeError> {
    let store = store.clone();
    let base = base.to_string();
    blocking(move || store.account(&base)).await
}

async fn save(
    store: &ForgeStore,
    account: ForgeAccount,
    token: ForgeToken,
) -> Result<(), ForgeError> {
    let store = store.clone();
    blocking(move || store.save(account, token)).await
}

/// Sign in with an access token: check it, read the account, and save both.
/// GitLab tokens that report their scopes must be able to push. `ca_file`
/// sets the account's CA file, an empty path clears it, and `None` keeps the
/// one the account has.
pub async fn sign_in_with_token(
    store: &ForgeStore,
    http: &ForgeHttp,
    base: &str,
    kind: ForgeKind,
    token: &str,
    ca_file: Option<&str>,
    now_ms: u64,
) -> Result<ForgeAccount, ForgeError> {
    let base = normalize_base_url(base)?;
    let token = token.trim();
    if !valid_token(token) {
        return Err(ForgeError::InvalidToken);
    }
    let session = Session {
        http,
        kind,
        base: &base,
        token,
    };
    // A 401 here means the pasted token is wrong, not that a sign-in expired.
    let user = api::current_user(&session)
        .await
        .map_err(|error| match error {
            ForgeError::Unauthorized => ForgeError::TokenRejected,
            other => other,
        })?;
    if kind == ForgeKind::GitLab {
        if let Some(scopes) = api::token_scopes(&session).await? {
            let can_push = scopes
                .iter()
                .any(|scope| scope == "api" || scope == "write_repository");
            if !can_push {
                return Err(ForgeError::MissingScopes {
                    scopes: ForgeKind::GitLab.scopes_hint(),
                });
            }
        }
    }
    let flavor = flavor_for(http, kind, &base).await;
    let existing = stored_account(store, &base).await?;
    let account = ForgeAccount {
        base: base.clone(),
        kind,
        flavor,
        login: user.login,
        name: user.name,
        avatar_url: user.avatar_url,
        ca_file: match ca_file {
            Some(path) if path.trim().is_empty() => None,
            Some(path) => Some(path.to_string()),
            None => existing
                .as_ref()
                .and_then(|account| account.ca_file.clone()),
        },
        auth: AuthMethod::Token,
        added_at: existing.map(|account| account.added_at).unwrap_or(now_ms),
    };
    save(
        store,
        account.clone(),
        ForgeToken {
            token: token.to_string(),
            refresh: None,
            expires_at: None,
        },
    )
    .await?;
    Ok(account)
}

/// Finish a device sign-in: read the account with the granted token and
/// save both.
pub async fn finish_device_sign_in(
    store: &ForgeStore,
    http: &ForgeHttp,
    base: &str,
    kind: ForgeKind,
    grant: TokenGrant,
    now_ms: u64,
) -> Result<ForgeAccount, ForgeError> {
    let base = normalize_base_url(base)?;
    let token = grant.into_token(now_ms);
    if !valid_token(&token.token) {
        return Err(ForgeError::InvalidResponse {
            detail: "the server sent an unusable token".into(),
        });
    }
    let user = api::current_user(&Session {
        http,
        kind,
        base: &base,
        token: &token.token,
    })
    .await?;
    let existing = stored_account(store, &base).await?;
    let account = ForgeAccount {
        base: base.clone(),
        kind,
        flavor: None,
        login: user.login,
        name: user.name,
        avatar_url: user.avatar_url,
        ca_file: existing
            .as_ref()
            .and_then(|account| account.ca_file.clone()),
        auth: AuthMethod::OAuth,
        added_at: existing.map(|account| account.added_at).unwrap_or(now_ms),
    };
    save(store, account.clone(), token).await?;
    Ok(account)
}

/// Check that an account's token still works, refreshing it when needed,
/// and save a changed login, name or picture. A revoked token reads as
/// signed out and the account stays; so does a server that can't be
/// reached.
pub async fn check_account(
    store: &ForgeStore,
    http: &ForgeHttp,
    base: &str,
    now_ms: u64,
) -> Result<AccountCheck, ForgeError> {
    let base = normalize_base_url(base)?;
    let outcome = |state: CheckState, account: Option<ForgeAccount>, changed: bool| AccountCheck {
        base: base.clone(),
        state,
        account,
        changed,
    };
    let Some(account) = stored_account(store, &base).await? else {
        return Ok(outcome(CheckState::SignedOut, None, false));
    };
    let token = match store.usable_token(http, &base, now_ms).await {
        Ok(Some(token)) => token,
        Ok(None) | Err(ForgeError::Unauthorized) => {
            return Ok(outcome(CheckState::SignedOut, Some(account), false))
        }
        Err(ForgeError::Unreachable { .. } | ForgeError::Tls { .. }) => {
            return Ok(outcome(CheckState::Unreachable, Some(account), false))
        }
        Err(error) => return Err(error),
    };
    let session = Session {
        http,
        kind: account.kind,
        base: &base,
        token: &token.token,
    };
    let user = match api::current_user(&session).await {
        Ok(user) => user,
        Err(ForgeError::Unauthorized) => {
            return Ok(outcome(CheckState::SignedOut, Some(account), false))
        }
        Err(ForgeError::Unreachable { .. } | ForgeError::Tls { .. }) => {
            return Ok(outcome(CheckState::Unreachable, Some(account), false))
        }
        Err(error) => return Err(error),
    };
    if user.login == account.login
        && user.name == account.name
        && user.avatar_url == account.avatar_url
    {
        return Ok(outcome(CheckState::Ok, Some(account), false));
    }
    // Only the profile fields are written, into the account as it is now:
    // a CA file the user set while this check ran stays.
    let writer = store.clone();
    let target = base.clone();
    let stored =
        blocking(move || writer.update_profile(&target, &user.login, user.name, user.avatar_url))
            .await?;
    Ok(match stored {
        Some(updated) => outcome(CheckState::Ok, Some(updated), true),
        // Signed out while the check ran: leave it gone.
        None => outcome(CheckState::SignedOut, None, false),
    })
}

/// Give a token that was saved without an account (for example by an older
/// command-line tool) its account: detect the server, read the user, and
/// save the metadata. The token itself is not rewritten.
pub async fn adopt_orphan(
    store: &ForgeStore,
    http: &ForgeHttp,
    base: &str,
    now_ms: u64,
) -> Result<ForgeAccount, ForgeError> {
    let base = normalize_base_url(base)?;
    let reader = store.clone();
    let lookup = base.clone();
    let token = blocking(move || reader.token(&lookup))
        .await?
        .ok_or(ForgeError::Unauthorized)?;
    let (kind, flavor) = match preset(&base) {
        Some(found) => found,
        None => {
            let info = detect::detect_server(http, &base).await?;
            (info.kind.ok_or(ForgeError::UnknownServer)?, info.flavor)
        }
    };
    let user = api::current_user(&Session {
        http,
        kind,
        base: &base,
        token: &token.token,
    })
    .await?;
    let oauth = token.refresh.is_some() || (base == GITHUB_COM && token.token.starts_with("gho_"));
    let account = ForgeAccount {
        base,
        kind,
        flavor,
        login: user.login,
        name: user.name,
        avatar_url: user.avatar_url,
        ca_file: None,
        auth: if oauth {
            AuthMethod::OAuth
        } else {
            AuthMethod::Token
        },
        added_at: now_ms,
    };
    let writer = store.clone();
    let saved = account.clone();
    blocking(move || writer.put_account(saved)).await?;
    Ok(account)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{MockResponse, MockServer};

    const USER: &str =
        r#"{"username":"octo","name":"Octo Cat","avatar_url":"https://a.example/o.png"}"#;

    fn gitlab(scopes: &str) -> MockServer {
        MockServer::start(vec![
            MockResponse::json(200, USER).on("GET", "/api/v4/user"),
            MockResponse::json(200, scopes).on("GET", "/api/v4/personal_access_tokens/self"),
        ])
    }

    #[tokio::test]
    async fn token_sign_in_saves_the_account_and_never_returns_the_token() {
        let server = gitlab(r#"{"scopes":["api"]}"#);
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let http = ForgeHttp::new(None).unwrap();
        let account = sign_in_with_token(
            &store,
            &http,
            &server.url(),
            ForgeKind::GitLab,
            " glpat-test-secret ",
            None,
            42,
        )
        .await
        .unwrap();
        assert_eq!(account.login, "octo");
        assert_eq!(account.auth, AuthMethod::Token);
        assert_eq!(account.added_at, 42);
        let returned = serde_json::to_string(&account).unwrap();
        let listed = serde_json::to_string(&store.accounts().unwrap()).unwrap();
        for text in [returned, listed] {
            assert!(!text.contains("glpat-test-secret"), "{text}");
        }
        assert_eq!(
            store.token(&server.url()).unwrap().unwrap().token,
            "glpat-test-secret"
        );
    }

    #[tokio::test]
    async fn a_gitlab_token_without_push_scopes_is_refused() {
        let server = gitlab(r#"{"scopes":["read_api"]}"#);
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let http = ForgeHttp::new(None).unwrap();
        let result = sign_in_with_token(
            &store,
            &http,
            &server.url(),
            ForgeKind::GitLab,
            "glpat-test-secret",
            None,
            1,
        )
        .await;
        assert_eq!(
            result,
            Err(ForgeError::MissingScopes {
                scopes: "api, write_repository"
            })
        );
        assert!(store.accounts().unwrap().is_empty());
        assert_eq!(store.token(&server.url()).unwrap(), None);
    }

    #[tokio::test]
    async fn a_malformed_token_is_refused_before_any_request() {
        let server = MockServer::start(Vec::new());
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let http = ForgeHttp::new(None).unwrap();
        let result = sign_in_with_token(
            &store,
            &http,
            &server.url(),
            ForgeKind::Gitea,
            "two words",
            None,
            1,
        )
        .await;
        assert_eq!(result, Err(ForgeError::InvalidToken));
        assert!(server.requests().is_empty());
    }

    #[tokio::test]
    async fn a_token_the_server_turns_down_is_named_as_such() {
        let server =
            MockServer::start(vec![MockResponse::json(401, "{}").on("GET", "/api/v1/user")]);
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let http = ForgeHttp::new(None).unwrap();
        let result = sign_in_with_token(
            &store,
            &http,
            &server.url(),
            ForgeKind::Gitea,
            "mistyped-token",
            None,
            1,
        )
        .await;
        assert_eq!(result, Err(ForgeError::TokenRejected));
        assert!(store.accounts().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_gitea_sign_in_records_the_server_flavor() {
        let server = MockServer::start(vec![
            MockResponse::json(200, r#"{"login":"me","full_name":"Me"}"#).on("GET", "/api/v1/user"),
            MockResponse::json(200, r#"{"version":"9.0.0"}"#).on("GET", "/api/forgejo/v1/version"),
            MockResponse::json(404, "{}").on("GET", "/api/v1/version"),
        ]);
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let http = ForgeHttp::new(None).unwrap();
        let account = sign_in_with_token(
            &store,
            &http,
            &server.url(),
            ForgeKind::Gitea,
            "gitea-token-1234",
            Some("/etc/ssl/corp.pem"),
            1,
        )
        .await
        .unwrap();
        assert_eq!(account.flavor, Some(ServerFlavor::Forgejo));
        assert_eq!(account.name.as_deref(), Some("Me"));
        assert_eq!(account.ca_file.as_deref(), Some("/etc/ssl/corp.pem"));
    }

    #[tokio::test]
    async fn signing_in_again_keeps_when_the_account_was_added() {
        let server = MockServer::start(vec![
            MockResponse::json(200, USER).on("GET", "/api/v4/user"),
            MockResponse::json(200, r#"{"scopes":["write_repository"]}"#)
                .on("GET", "/api/v4/personal_access_tokens/self"),
            MockResponse::json(200, USER).on("GET", "/api/v4/user"),
            MockResponse::json(404, "{}").on("GET", "/api/v4/personal_access_tokens/self"),
        ]);
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let http = ForgeHttp::new(None).unwrap();
        let base = server.url();
        sign_in_with_token(
            &store,
            &http,
            &base,
            ForgeKind::GitLab,
            "glpat-first-1",
            None,
            10,
        )
        .await
        .unwrap();
        let again = sign_in_with_token(
            &store,
            &http,
            &base,
            ForgeKind::GitLab,
            "glpat-second-2",
            None,
            99,
        )
        .await
        .unwrap();
        assert_eq!(again.added_at, 10);
        assert_eq!(store.token(&base).unwrap().unwrap().token, "glpat-second-2");
    }

    #[tokio::test]
    async fn signing_in_again_can_set_keep_or_clear_the_ca_file() {
        let mut replies = Vec::new();
        for _ in 0..3 {
            replies.push(MockResponse::json(200, USER).on("GET", "/api/v4/user"));
            replies.push(
                MockResponse::json(404, "{}").on("GET", "/api/v4/personal_access_tokens/self"),
            );
        }
        let server = MockServer::start(replies);
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let http = ForgeHttp::new(None).unwrap();
        let base = server.url();
        let sign_in = |token: &'static str, ca_file: Option<&'static str>| {
            sign_in_with_token(&store, &http, &base, ForgeKind::GitLab, token, ca_file, 1)
        };
        let set = sign_in("glpat-first-123", Some("/etc/ssl/corp.pem"))
            .await
            .unwrap();
        assert_eq!(set.ca_file.as_deref(), Some("/etc/ssl/corp.pem"));
        let kept = sign_in("glpat-second-12", None).await.unwrap();
        assert_eq!(kept.ca_file.as_deref(), Some("/etc/ssl/corp.pem"));
        let cleared = sign_in("glpat-third-123", Some("")).await.unwrap();
        assert_eq!(cleared.ca_file, None);
        assert_eq!(store.accounts().unwrap()[0].ca_file, None);
    }

    #[tokio::test]
    async fn a_device_grant_saves_an_oauth_account() {
        let server =
            MockServer::start(vec![MockResponse::json(200, USER).on("GET", "/api/v4/user")]);
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let http = ForgeHttp::new(None).unwrap();
        let grant = TokenGrant {
            access_token: "oauth-access-1".into(),
            refresh_token: Some("oauth-refresh-1".into()),
            expires_in: Some(7200),
            scope: None,
        };
        let account = finish_device_sign_in(
            &store,
            &http,
            &server.url(),
            ForgeKind::GitLab,
            grant,
            5_000,
        )
        .await
        .unwrap();
        assert_eq!(account.auth, AuthMethod::OAuth);
        let stored = store.token(&server.url()).unwrap().unwrap();
        assert_eq!(stored.refresh.as_deref(), Some("oauth-refresh-1"));
        assert_eq!(stored.expires_at, Some(5 + 7200));
        assert_eq!(
            server.requests()[0].header("authorization").as_deref(),
            Some("Bearer oauth-access-1")
        );
    }

    async fn saved_account(store: &ForgeStore, base: &str) {
        store
            .save(
                ForgeAccount {
                    base: base.to_string(),
                    kind: ForgeKind::GitLab,
                    flavor: None,
                    login: "octo".into(),
                    name: Some("Octo Cat".into()),
                    avatar_url: Some("https://a.example/o.png".into()),
                    ca_file: None,
                    auth: AuthMethod::Token,
                    added_at: 1,
                },
                ForgeToken {
                    token: "glpat-saved-1234".into(),
                    refresh: None,
                    expires_at: None,
                },
            )
            .unwrap();
    }

    #[tokio::test]
    async fn validation_reports_signed_out_for_a_revoked_token() {
        let server = MockServer::start(vec![MockResponse::json(
            401,
            r#"{"message":"401 Unauthorized"}"#,
        )]);
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        saved_account(&store, &server.url()).await;
        let http = ForgeHttp::new(None).unwrap();
        let check = check_account(&store, &http, &server.url(), 1)
            .await
            .unwrap();
        assert_eq!(check.state, CheckState::SignedOut);
        assert!(check.account.is_some());
        assert_eq!(store.accounts().unwrap().len(), 1, "the account stays");
    }

    #[tokio::test]
    async fn validation_saves_a_changed_name() {
        let server = MockServer::start(vec![MockResponse::json(
            200,
            r#"{"username":"octo","name":"Dr. Octo Cat","avatar_url":"https://a.example/o.png"}"#,
        )]);
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        saved_account(&store, &server.url()).await;
        let http = ForgeHttp::new(None).unwrap();
        let check = check_account(&store, &http, &server.url(), 1)
            .await
            .unwrap();
        assert_eq!(check.state, CheckState::Ok);
        assert!(check.changed);
        assert_eq!(
            store.accounts().unwrap()[0].name.as_deref(),
            Some("Dr. Octo Cat")
        );
        let json = serde_json::to_value(&check).unwrap();
        assert_eq!(json["state"], "ok");
        assert!(json.get("changed").is_none());
    }

    #[tokio::test]
    async fn validation_reports_an_unreachable_server() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        saved_account(&store, &base).await;
        let http = ForgeHttp::new(None).unwrap();
        let check = check_account(&store, &http, &base, 1).await.unwrap();
        assert_eq!(check.state, CheckState::Unreachable);
    }

    #[tokio::test]
    async fn a_token_saved_without_an_account_gets_one() {
        let server = MockServer::start(vec![
            MockResponse::json(401, r#"{"message":"401 Unauthorized"}"#)
                .on("GET", "/api/v4/version"),
            MockResponse::json(404, "{}").on("GET", "/api/forgejo/v1/version"),
            MockResponse::json(404, "{}").on("GET", "/api/v1/version"),
            MockResponse::json(404, "{}").on("GET", "/api/v3/meta"),
            MockResponse::json(200, USER).on("GET", "/api/v4/user"),
        ]);
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        oleafly_secrets::accounts::save_forge_token(
            &oleafly_secrets::SecretStore::at(dir.path()),
            &server.url(),
            ForgeToken {
                token: "glpat-from-cli-1".into(),
                refresh: None,
                expires_at: None,
            },
        )
        .unwrap();
        let http = ForgeHttp::new(None).unwrap();
        let account = adopt_orphan(&store, &http, &server.url(), 7).await.unwrap();
        assert_eq!(account.kind, ForgeKind::GitLab);
        assert_eq!(account.login, "octo");
        assert!(store.orphan_bases().unwrap().is_empty());
        assert_eq!(store.accounts().unwrap(), vec![account]);
    }
}
