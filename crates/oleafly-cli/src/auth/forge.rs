//! Git-host tokens (GitHub, GitLab, Gitea and others) from `oleafly auth`.
//! The command line only stores tokens; the Oleafly app keeps the account
//! records and makes the host's API calls.
use std::io::Read;

use oleafly_secrets::accounts::{self, ForgeToken, GITHUB_TOKEN_ACCOUNT};
use serde_json::{json, Value};
use zeroize::Zeroizing;

use super::shared::{from_store, read_secret_input, Env, Report};
use crate::contract::{CliError, ErrorKind};

const GITHUB: &str = "https://github.com";

/// The account key the app uses for `host` (`www.` and API paths dropped,
/// https required), so a token saved here is the one the app finds.
fn host_base(host: &str) -> Result<String, CliError> {
    oleafly_forge::address::normalize_base_url(host).map_err(|error| {
        CliError::new(
            ErrorKind::Usage,
            "git.invalid_host",
            format!("\"{host}\" isn't a Git host address Oleafly can use."),
        )
        .hint(error.to_string())
    })
}

/// `auth login git`: reads the token and saves it for the host.
pub(crate) fn login(
    env: &Env,
    host: &str,
    dry_run: bool,
    stdin: &mut dyn Read,
) -> Result<Report, CliError> {
    let base = host_base(host)?;
    let token = read_secret_input(
        stdin,
        env.stdin_is_tty,
        env.interactive,
        &format!("Token for {base}: "),
    )?;
    if !accounts::valid_forge_token(&token) {
        return Err(CliError::new(
            ErrorKind::Usage,
            "git.token_invalid",
            "That doesn't look like a token.",
        )
        .hint("Copy the whole token from the host's settings page."));
    }
    if !dry_run {
        accounts::save_forge_token(
            &env.store,
            &base,
            ForgeToken {
                token: token.to_string(),
                refresh: None,
                expires_at: None,
            },
        )
        .map_err(|error| from_store(error, &env.data_root))?;
    }
    let line = if dry_run {
        format!("Checked the token for {base}. Nothing was saved (--dry-run).")
    } else {
        format!("Saved the token for {base}.")
    };
    Ok(Report::new(json!({"host": base, "saved": !dry_run, "dryRun": dry_run})).line(line))
}

/// `auth logout git`: removes the host's token. For github.com it also
/// removes the token of the Oleafly app's own GitHub sign-in (`github_token`,
/// which the app keeps in step with its github.com account): `auth token`
/// would otherwise still hand out a working token after the logout. The app
/// then shows the account as signed out.
pub(crate) fn logout(env: &Env, host: &str, dry_run: bool) -> Result<Report, CliError> {
    let base = host_base(host)?;
    let saved = accounts::forge_token(&env.store, &base)
        .map_err(|error| from_store(error, &env.data_root))?
        .is_some();
    let app_token = base == GITHUB
        && env
            .store
            .contains(GITHUB_TOKEN_ACCOUNT)
            .map_err(|error| from_store(error, &env.data_root))?;
    if !dry_run {
        if saved {
            accounts::forget_forge_token(&env.store, &base)
                .map_err(|error| from_store(error, &env.data_root))?;
        }
        if app_token {
            env.store
                .set(&[(GITHUB_TOKEN_ACCOUNT, "")])
                .map_err(|error| from_store(error, &env.data_root))?;
        }
    }
    let mut removed: Vec<Value> = Vec::new();
    if saved {
        removed.push(json!({"kind": "hostToken", "target": base}));
    }
    if app_token {
        removed.push(json!({"kind": "appGithubToken", "target": base}));
    }
    let what = match (saved, app_token) {
        (true, false) => format!("the token for {base}"),
        (true, true) => {
            format!("the token for {base} and the token of the Oleafly app's GitHub sign-in")
        }
        (false, true) => "the token of the Oleafly app's GitHub sign-in".to_string(),
        (false, false) => String::new(),
    };
    let line = match (what.is_empty(), dry_run) {
        (true, _) => format!("No token is saved for {base}."),
        (false, true) => format!("Dry run: would remove {what}."),
        (false, false) => format!("Removed {what}."),
    };
    Ok(Report::new(json!({"removed": removed, "dryRun": dry_run})).line(line))
}

/// The host's token, or the Oleafly app's GitHub sign-in for github.com.
pub(crate) fn token(env: &Env, host: &str) -> Result<Zeroizing<String>, CliError> {
    let base = host_base(host)?;
    if let Some(saved) = accounts::forge_token(&env.store, &base)
        .map_err(|error| from_store(error, &env.data_root))?
    {
        return Ok(Zeroizing::new(saved.token.clone()));
    }
    if base == GITHUB {
        if let Some(legacy) = env
            .store
            .get(GITHUB_TOKEN_ACCOUNT)
            .map_err(|error| from_store(error, &env.data_root))?
        {
            return Ok(Zeroizing::new(legacy));
        }
    }
    Err(CliError::new(
        ErrorKind::Auth,
        "git.token_missing",
        format!("No token is saved for {base}."),
    )
    .hint(format!("Run oleafly auth login git --host {base}.")))
}

/// Hosts with a token: the store's, plus the app's GitHub sign-in.
pub(crate) fn status_rows(env: &Env) -> Result<Vec<Value>, CliError> {
    let tokens =
        accounts::forge_tokens(&env.store).map_err(|error| from_store(error, &env.data_root))?;
    let mut rows: Vec<Value> = tokens
        .keys()
        .map(|host| json!({"host": host, "source": "store"}))
        .collect();
    if !tokens.contains_key(GITHUB)
        && env
            .store
            .contains(GITHUB_TOKEN_ACCOUNT)
            .map_err(|error| from_store(error, &env.data_root))?
    {
        rows.push(json!({"host": GITHUB, "source": "app-github"}));
    }
    Ok(rows)
}

pub(crate) fn status_line(row: &Value) -> String {
    let host = row["host"].as_str().unwrap_or_default();
    if row["source"] == "app-github" {
        format!("{host}: token saved (from the Oleafly app's GitHub sign-in)")
    } else {
        format!("{host}: token saved")
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_env::{assert_secret_free, env_at};
    use super::*;

    #[test]
    fn git_login_normalizes_the_host_and_github_falls_back_to_the_app_token() {
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        let report = login(
            &env,
            "GitLab.com/",
            false,
            &mut "glpat-FORGE99\n".as_bytes(),
        )
        .unwrap();
        assert_eq!(report.data["host"], "https://gitlab.com");
        assert_secret_free(&format!("{:?}", report), &["glpat-FORGE99"]);
        assert_eq!(
            token(&env, "https://gitlab.com").unwrap().as_str(),
            "glpat-FORGE99"
        );
        assert_eq!(
            token(&env, "github.com").unwrap_err().code,
            "git.token_missing"
        );
        env.store
            .set(&[(GITHUB_TOKEN_ACCOUNT, "ghp_LEGACY11")])
            .unwrap();
        assert_eq!(token(&env, "github.com").unwrap().as_str(), "ghp_LEGACY11");
    }

    #[test]
    fn git_login_refuses_bad_hosts_and_tokens() {
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        assert_eq!(
            login(&env, "ftp://example.com", false, &mut "tok".as_bytes())
                .unwrap_err()
                .code,
            "git.invalid_host"
        );
        assert_eq!(
            login(
                &env,
                "gitlab.com",
                false,
                &mut "a \"quoted\" token".as_bytes()
            )
            .unwrap_err()
            .code,
            "git.token_invalid"
        );
        let dry = login(&env, "gitlab.com", true, &mut "glpat-FORGE99".as_bytes()).unwrap();
        assert_eq!(dry.data["saved"], false);
        assert!(accounts::forge_tokens(&env.store).unwrap().is_empty());
        // Plain http to a server elsewhere is refused, as the app refuses it.
        assert_eq!(
            login(&env, "http://git.example.org", true, &mut "tok".as_bytes())
                .unwrap_err()
                .code,
            "git.invalid_host"
        );
    }

    #[test]
    fn git_login_saves_under_the_address_the_app_uses() {
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        let report = login(
            &env,
            "www.github.com",
            false,
            &mut "ghp_WWW12345\n".as_bytes(),
        )
        .unwrap();
        assert_eq!(report.data["host"], "https://github.com");
        assert_eq!(token(&env, "github.com").unwrap().as_str(), "ghp_WWW12345");
    }

    #[test]
    fn logging_out_of_github_also_clears_the_app_sign_in_token() {
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        login(
            &env,
            "github.com",
            false,
            &mut "github_pat_CLI1234".as_bytes(),
        )
        .unwrap();
        login(&env, "gitlab.com", false, &mut "glpat-FORGE99".as_bytes()).unwrap();
        env.store
            .set(&[(GITHUB_TOKEN_ACCOUNT, "gho_APPSIGNIN1")])
            .unwrap();

        let dry = logout(&env, "github.com", true).unwrap();
        assert_eq!(dry.data["removed"].as_array().unwrap().len(), 2);
        assert!(env.store.contains(GITHUB_TOKEN_ACCOUNT).unwrap(), "dry run");
        assert!(token(&env, "github.com").is_ok());

        let report = logout(&env, "https://github.com", false).unwrap();
        let kinds: Vec<_> = report.data["removed"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["kind"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(kinds, ["hostToken", "appGithubToken"]);
        assert!(report
            .lines
            .iter()
            .any(|line| line.contains("GitHub sign-in")));
        // Nothing hands out a GitHub token any more, and no row lists one.
        assert_eq!(
            token(&env, "github.com").unwrap_err().code,
            "git.token_missing"
        );
        assert!(!env.store.contains(GITHUB_TOKEN_ACCOUNT).unwrap());
        let hosts: Vec<String> = status_rows(&env)
            .unwrap()
            .iter()
            .map(|row| row["host"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(hosts, ["https://gitlab.com"]);
        // Other hosts keep theirs.
        assert_eq!(token(&env, "gitlab.com").unwrap().as_str(), "glpat-FORGE99");
    }

    #[test]
    fn logging_out_of_github_with_only_the_app_token_removes_that_one() {
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        env.store
            .set(&[(GITHUB_TOKEN_ACCOUNT, "gho_APPSIGNIN1")])
            .unwrap();
        let report = logout(&env, "github.com", false).unwrap();
        assert_eq!(
            report.data["removed"],
            json!([{"kind": "appGithubToken", "target": "https://github.com"}])
        );
        assert!(!env.store.contains(GITHUB_TOKEN_ACCOUNT).unwrap());
        // Other hosts never touch it.
        env.store
            .set(&[(GITHUB_TOKEN_ACCOUNT, "gho_APPSIGNIN1")])
            .unwrap();
        logout(&env, "gitlab.com", false).unwrap();
        assert!(env.store.contains(GITHUB_TOKEN_ACCOUNT).unwrap());
    }

    #[test]
    fn logout_removes_only_that_host() {
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        login(&env, "gitlab.com", false, &mut "glpat-FORGE99".as_bytes()).unwrap();
        login(&env, "codeberg.org", false, &mut "cb-FORGE77".as_bytes()).unwrap();
        let report = logout(&env, "https://gitlab.com", false).unwrap();
        assert_eq!(report.data["removed"][0]["target"], "https://gitlab.com");
        let left: Vec<_> = accounts::forge_tokens(&env.store)
            .unwrap()
            .into_keys()
            .collect();
        assert_eq!(left, vec!["https://codeberg.org".to_string()]);
        assert_eq!(
            logout(&env, "gitlab.com", false).unwrap().data["removed"],
            json!([])
        );
    }
}
