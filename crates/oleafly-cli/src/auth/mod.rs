pub(crate) mod forge;
pub(crate) mod online;
pub(crate) mod shared;

use clap::{Args, Subcommand, ValueEnum};
use serde_json::{json, Value};

use crate::commands::CommandModule;
use crate::contract::{CliError, Context, ErrorKind, Outcome};
use shared::{Env, Report};

#[derive(Debug, Subcommand)]
pub enum Commands {
    /// Sign in to online LaTeX services, collaboration servers and Git hosts
    #[command(subcommand)]
    Auth(AuthCommand),
}

#[derive(Debug, Subcommand)]
pub enum AuthCommand {
    /// Sign in and save the credential in Oleafly's encrypted store
    #[command(subcommand)]
    Login(LoginTarget),
    /// Show every saved sign-in and where it comes from
    Status(StatusArgs),
    /// Remove a saved sign-in
    #[command(subcommand)]
    Logout(LogoutTarget),
    /// Print a saved token for scripts
    #[command(subcommand)]
    Token(TokenTarget),
}

#[derive(Debug, Subcommand)]
pub enum LoginTarget {
    /// Save a session or a Git token for an online LaTeX service
    Online(OnlineLogin),
    /// Sign in to an Oleafly collaboration server
    Server(ServerLogin),
    /// Save a token for a Git host
    Git(GitLogin),
}

#[derive(Debug, Default, Args)]
pub struct OnlineLogin {
    #[arg(long, value_name = "URL", help = "Server address")]
    pub server: Option<String>,
    #[arg(long, group = "method", help = "Read a token from standard input")]
    pub with_token: bool,
    #[arg(
        long,
        group = "method",
        help = "Read a session cookie from standard input"
    )]
    pub cookie_stdin: bool,
    #[arg(
        long,
        group = "method",
        value_enum,
        value_name = "BROWSER",
        help = "Copy the sign-in from a browser on this computer"
    )]
    pub from_browser: Option<BrowserArg>,
    #[arg(long, requires = "from_browser", help = "Browser profile to read")]
    pub profile: Option<String>,
    #[arg(long, help = "Show what would change without changing anything")]
    pub dry_run: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum BrowserArg {
    Chrome,
    Edge,
    Brave,
    Firefox,
}

#[derive(Debug, Args)]
pub struct ServerLogin {
    #[arg(value_name = "URL", help = "Server address")]
    pub url: String,
    #[arg(
        long,
        help = "Setup code for a new server's first sign-in (other users here can see it in the process list; prefer --setup-code-stdin)"
    )]
    pub setup_code: Option<String>,
    #[arg(
        long,
        conflicts_with = "setup_code",
        help = "Read the setup code from standard input"
    )]
    pub setup_code_stdin: bool,
    #[arg(long, help = "Open the sign-in page in your browser")]
    pub open: bool,
}

#[derive(Debug, Args)]
pub struct GitLogin {
    #[arg(
        long,
        value_name = "URL",
        help = "Git host address, such as https://gitlab.com"
    )]
    pub host: String,
    #[arg(long, help = "Show what would change without changing anything")]
    pub dry_run: bool,
}

#[derive(Debug, Args)]
pub struct StatusArgs {
    #[arg(
        value_enum,
        value_name = "KIND",
        help = "Show only online, server or git sign-ins"
    )]
    pub only: Option<AccountKind>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum AccountKind {
    Online,
    Server,
    Git,
}

#[derive(Debug, Subcommand)]
pub enum LogoutTarget {
    /// Remove the session and Git token for an online LaTeX service
    Online(OnlineLogout),
    /// Sign this command line out of a collaboration server
    Server {
        #[arg(value_name = "SERVER", help = "Server address, name or ID")]
        which: String,
        #[arg(long, help = "Show what would change without changing anything")]
        dry_run: bool,
    },
    /// Remove the token for a Git host
    Git {
        #[arg(
            long,
            value_name = "URL",
            help = "Git host address, such as https://gitlab.com"
        )]
        host: String,
        #[arg(long, help = "Show what would change without changing anything")]
        dry_run: bool,
    },
}

#[derive(Debug, Default, Args)]
pub struct OnlineLogout {
    #[arg(long, value_name = "URL", help = "Server address")]
    pub server: Option<String>,
    #[arg(
        long,
        conflicts_with = "git_token_only",
        help = "Remove only the session"
    )]
    pub session_only: bool,
    #[arg(long, help = "Remove only the Git token")]
    pub git_token_only: bool,
    #[arg(long, help = "Show what would change without changing anything")]
    pub dry_run: bool,
}

#[derive(Debug, Subcommand)]
pub enum TokenTarget {
    /// The Git token for an online LaTeX service
    Online {
        #[arg(long, value_name = "URL", help = "Server address")]
        server: Option<String>,
    },
    /// This command line's current access token for a collaboration server
    Server {
        #[arg(value_name = "SERVER", help = "Server address, name or ID")]
        which: String,
    },
    /// The token for a Git host
    Git {
        #[arg(
            long,
            value_name = "URL",
            help = "Git host address, such as https://gitlab.com"
        )]
        host: String,
    },
}

impl CommandModule for Commands {
    fn name(&self) -> &'static str {
        let Self::Auth(command) = self;
        match command {
            AuthCommand::Login(LoginTarget::Online(_)) => "auth login online",
            AuthCommand::Login(LoginTarget::Server(_)) => "auth login server",
            AuthCommand::Login(LoginTarget::Git(_)) => "auth login git",
            AuthCommand::Status(_) => "auth status",
            AuthCommand::Logout(LogoutTarget::Online(_)) => "auth logout online",
            AuthCommand::Logout(LogoutTarget::Server { .. }) => "auth logout server",
            AuthCommand::Logout(LogoutTarget::Git { .. }) => "auth logout git",
            AuthCommand::Token(TokenTarget::Online { .. }) => "auth token online",
            AuthCommand::Token(TokenTarget::Server { .. }) => "auth token server",
            AuthCommand::Token(TokenTarget::Git { .. }) => "auth token git",
        }
    }

    async fn run(self, ctx: &Context) -> Result<Outcome, CliError> {
        let Self::Auth(command) = self;
        if matches!(command, AuthCommand::Token(_)) && ctx.json() {
            return Err(CliError::new(
                ErrorKind::Usage,
                "auth.token_json",
                "Tokens print as plain text only. Run the command without --json.",
            ));
        }
        let env = Env::from_context(ctx)?;
        let report = match command {
            AuthCommand::Login(LoginTarget::Online(args)) => {
                let mut stdin = std::io::stdin();
                online::login(
                    &env,
                    args,
                    &mut stdin,
                    &oleafly_online::browser_cookies::MacSafeStorage,
                )
                .await?
            }
            AuthCommand::Login(LoginTarget::Server(args)) => {
                let setup_code =
                    crate::server::account::setup_code(&env, &args, &mut std::io::stdin())?;
                crate::server::account::sign_in_from(ctx, &env, &args.url, setup_code, args.open)
                    .await?
            }
            AuthCommand::Login(LoginTarget::Git(args)) => {
                let mut stdin = std::io::stdin();
                forge::login(&env, &args.host, args.dry_run, &mut stdin)?
            }
            AuthCommand::Status(args) => status(&env, args.only)?,
            AuthCommand::Logout(LogoutTarget::Online(args)) => online::logout(&env, &args)?,
            AuthCommand::Logout(LogoutTarget::Server { which, dry_run }) => {
                let collab = crate::server::account::CliCollab::open(&env);
                crate::server::account::sign_out(&collab, &which, dry_run).await?
            }
            AuthCommand::Logout(LogoutTarget::Git { host, dry_run }) => {
                forge::logout(&env, &host, dry_run)?
            }
            AuthCommand::Token(target) => token(&env, target).await?,
        };
        Ok(report.deliver(ctx))
    }
}

pub(crate) fn status(env: &Env, only: Option<AccountKind>) -> Result<Report, CliError> {
    let wants = |kind: AccountKind| only.is_none_or(|only| only == kind);
    let mut data = serde_json::Map::new();
    let mut lines = vec![format!(
        "Secrets: encrypted file in {}, shared with the Oleafly app",
        env.data_root.display()
    )];
    data.insert("store".into(), json!({"root": env.data_root}));
    if wants(AccountKind::Online) {
        let rows = online::status_rows(env)?;
        lines.push(String::new());
        lines.push("Online LaTeX service".into());
        if rows.is_empty() {
            lines.push("  No sign-ins.".into());
        }
        for row in &rows {
            lines.push(format!("  {}", online::status_line(row)));
        }
        if env.online_git_token.is_some() {
            lines.push(format!(
                "  {} is set and is used instead of saved Git tokens",
                shared::ONLINE_GIT_TOKEN_VARIABLE
            ));
        }
        data.insert("online".into(), Value::Array(rows));
        data.insert(
            "onlineEnv".into(),
            json!({"gitToken": env.online_git_token.is_some()}),
        );
    }
    if wants(AccountKind::Server) {
        let rows = crate::server::account::status_rows(env)?;
        lines.push(String::new());
        lines.push("Collaboration servers".into());
        if rows.is_empty() {
            lines.push("  No servers.".into());
        }
        for row in &rows {
            lines.extend(
                crate::server::account::status_lines(row)
                    .into_iter()
                    .map(|line| format!("  {line}")),
            );
        }
        data.insert("servers".into(), Value::Array(rows));
    }
    if wants(AccountKind::Git) {
        let rows = forge::status_rows(env)?;
        lines.push(String::new());
        lines.push("Git hosts".into());
        if rows.is_empty() {
            lines.push("  No tokens.".into());
        }
        for row in &rows {
            lines.push(format!("  {}", forge::status_line(row)));
        }
        data.insert("git".into(), Value::Array(rows));
    }
    Ok(Report::new(Value::Object(data)).lines(lines))
}

pub(crate) async fn token(env: &Env, target: TokenTarget) -> Result<Report, CliError> {
    let token = match target {
        TokenTarget::Online { server } => online::token(env, server.as_deref())?,
        TokenTarget::Git { host } => forge::token(env, &host)?,
        TokenTarget::Server { which } => {
            let collab = crate::server::account::CliCollab::open(env);
            crate::server::account::access_token(&collab, &which).await?
        }
    };
    Ok(Report::new(Value::Null).line(token.as_str()))
}

#[cfg(test)]
pub(crate) mod test_env {
    use std::path::Path;

    use oleafly_online::browser_cookies::HostPlatform;
    use oleafly_secrets::SecretStore;

    use super::shared::Env;

    pub(crate) fn env_at(root: &Path) -> Env {
        let data_root = root.join("data");
        let home = root.join("home");
        std::fs::create_dir_all(&data_root).unwrap();
        std::fs::create_dir_all(&home).unwrap();
        Env {
            store: SecretStore::at(&data_root),
            data_root,
            home,
            online_git_token: None,
            interactive: false,
            stdin_is_tty: false,
            platform: HostPlatform::current(),
        }
    }

    pub(crate) fn assert_secret_free(text: &str, secrets: &[&str]) {
        for secret in secrets {
            assert!(!text.contains(secret), "{secret} leaked");
            for length in [4, 6, 8] {
                assert!(
                    !text.contains(&secret[..length]),
                    "{secret} leaked its first {length} characters"
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_env::{assert_secret_free, env_at};
    use super::*;
    use oleafly_online::session::{save, save_git_token, Session};

    fn render(report: &Report) -> String {
        format!("{}\n{}", report.lines.join("\n"), report.data)
    }

    #[test]
    fn status_never_prints_secrets_or_prefixes() {
        let dir = tempfile::tempdir().unwrap();
        let mut env = env_at(dir.path());
        save(
            &env.store,
            "https://latex.example.edu",
            &Session {
                cookie: "site_session=COOKIEVALUE77".into(),
                user_id: "u1".into(),
                email: "ana@uni.edu".into(),
                saved_by: Some("cli".into()),
            },
        )
        .unwrap();
        save_git_token(&env.store, "https://latex.example.edu", "olp_GITTOKEN88").unwrap();
        oleafly_secrets::accounts::save_forge_token(
            &env.store,
            "https://gitlab.com",
            oleafly_secrets::accounts::ForgeToken {
                token: "glpat-FORGE99".into(),
                refresh: None,
                expires_at: None,
            },
        )
        .unwrap();
        env.store
            .set(&[(
                oleafly_secrets::accounts::GITHUB_TOKEN_ACCOUNT,
                "ghp_LEGACY11",
            )])
            .unwrap();
        let server_id = oleafly_collab_protocol::ids::ServerId::new_v7();
        env.store
            .set(&[(
                oleafly_collab::session_account(server_id).as_str(),
                r#"{"access_token":"ACCESS22xyz","refresh_token":"REFRESH33xyz"}"#,
            )])
            .unwrap();
        env.online_git_token = Some(zeroize::Zeroizing::new("env_TOKEN44".to_string()));
        let report = status(&env, None).unwrap();
        assert_secret_free(
            &render(&report),
            &[
                "COOKIEVALUE77",
                "olp_GITTOKEN88",
                "glpat-FORGE99",
                "ghp_LEGACY11",
                "ACCESS22xyz",
                "REFRESH33xyz",
                "env_TOKEN44",
            ],
        );
        assert_eq!(report.data["onlineEnv"]["gitToken"], true);
        assert_eq!(report.data["online"][0]["session"]["email"], "ana@uni.edu");
        assert_eq!(report.data["online"][0]["gitToken"]["saved"], true);
        let hosts: Vec<_> = report.data["git"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| (row["host"].clone(), row["source"].clone()))
            .collect();
        assert!(
            hosts.contains(&(json!("https://gitlab.com"), json!("store"))),
            "{hosts:?}"
        );
        assert!(
            hosts.contains(&(json!("https://github.com"), json!("app-github"))),
            "{hosts:?}"
        );
    }

    #[test]
    fn status_can_show_one_kind() {
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        let report = status(&env, Some(AccountKind::Git)).unwrap();
        assert!(report.data.get("online").is_none());
        assert!(report.data.get("servers").is_none());
        assert_eq!(report.data["git"], json!([]));
    }

    #[tokio::test]
    async fn token_prints_only_the_token() {
        let dir = tempfile::tempdir().unwrap();
        let mut env = env_at(dir.path());
        oleafly_secrets::accounts::save_forge_token(
            &env.store,
            "https://gitlab.com",
            oleafly_secrets::accounts::ForgeToken {
                token: "glpat-FORGE99".into(),
                refresh: None,
                expires_at: None,
            },
        )
        .unwrap();
        let report = token(
            &env,
            TokenTarget::Git {
                host: "gitlab.com".into(),
            },
        )
        .await
        .unwrap();
        assert_eq!(report.lines, vec!["glpat-FORGE99".to_string()]);
        assert_eq!(report.data, Value::Null);
        env.online_git_token = Some(zeroize::Zeroizing::new("env_TOKEN44".to_string()));
        let report = token(&env, TokenTarget::Online { server: None })
            .await
            .unwrap();
        assert_eq!(report.lines, vec!["env_TOKEN44".to_string()]);
    }

    #[test]
    fn the_token_command_refuses_json_before_reading_anything() {
        use clap::Parser as _;
        let cli = crate::Cli::try_parse_from([
            "oleafly",
            "--json",
            "auth",
            "token",
            "git",
            "--host",
            "gitlab.com",
        ])
        .unwrap();
        let ctx = Context::for_test(crate::contract::ContextOptions {
            json: true,
            command: "auth token git",
            ..Default::default()
        });
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        let error = runtime.block_on(cli.command.run(&ctx)).unwrap_err();
        assert_eq!(
            (error.code.as_ref(), error.exit() as u8),
            ("auth.token_json", 2)
        );
    }

    #[test]
    fn login_needs_one_method_and_methods_exclude_each_other() {
        use clap::Parser as _;
        assert!(crate::Cli::try_parse_from([
            "oleafly",
            "auth",
            "login",
            "online",
            "--with-token",
            "--cookie-stdin"
        ])
        .is_err());
        assert!(crate::Cli::try_parse_from([
            "oleafly",
            "auth",
            "login",
            "online",
            "--profile",
            "Default"
        ])
        .is_err());
        assert!(crate::Cli::try_parse_from([
            "oleafly",
            "auth",
            "logout",
            "online",
            "--session-only",
            "--git-token-only"
        ])
        .is_err());
    }
}
