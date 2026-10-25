//! What `auth`, `remote` and `server` share: the encrypted store and the
//! data folder, reading a secret from standard input, the command line's
//! own collaboration secrets, error mapping and the report type.
use std::io::Read;
use std::path::{Path, PathBuf};

use oleafly_collab::{CollabError, SecretPort};
use oleafly_collab_protocol::capabilities::VersionMismatch;
use oleafly_online::browser_cookies::HostPlatform;
use oleafly_online::{OnlineError, OnlineErrorKind};
use oleafly_secrets::SecretStore;
use serde_json::{json, Value};
use zeroize::Zeroizing;

use crate::contract::{CliError, Context, ErrorKind, Exit, Outcome, Warning};

/// A Git token for the online LaTeX service that wins over saved ones (CI).
pub(crate) const ONLINE_GIT_TOKEN_VARIABLE: &str = "OLEAFLY_ONLINE_GIT_TOKEN";
/// The most a secret read from standard input may hold.
pub(crate) const MAX_SECRET_INPUT: usize = 16 * 1024;
/// The command line keeps its collaboration secrets under this prefix, so
/// it never reads or replaces the app's device key and sessions.
pub(crate) const CLI_ACCOUNT_PREFIX: &str = "cli:";

/// What a command found: its JSON fields, the lines people see, warnings
/// and the exit code.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Report {
    pub data: Value,
    pub lines: Vec<String>,
    pub warnings: Vec<Warning>,
    pub exit: Exit,
}

impl Report {
    pub(crate) fn new(data: Value) -> Report {
        Report {
            data,
            lines: Vec::new(),
            warnings: Vec::new(),
            exit: Exit::Ok,
        }
    }

    pub(crate) fn line(mut self, line: impl Into<String>) -> Report {
        self.lines.push(line.into());
        self
    }

    pub(crate) fn lines(mut self, lines: impl IntoIterator<Item = String>) -> Report {
        self.lines.extend(lines);
        self
    }

    pub(crate) fn warning(mut self, code: &'static str, message: impl Into<String>) -> Report {
        self.warnings.push(Warning::new(code, message));
        self
    }

    pub(crate) fn exit(mut self, exit: Exit) -> Report {
        self.exit = exit;
        self
    }

    /// Prints the lines (people) and warnings, and returns the outcome.
    /// The lines carry names and text from other people's accounts, so
    /// nothing in them can steer the terminal.
    pub(crate) fn deliver(self, ctx: &Context) -> Outcome {
        for line in &self.lines {
            ctx.say(plain_text(line));
        }
        for warning in self.warnings {
            ctx.warn(warning.code, warning.message);
        }
        if self.exit == Exit::Ok {
            Outcome::success(self.data)
        } else {
            Outcome::failure(self.exit, self.data)
        }
    }
}

/// `text` without anything a terminal would act on: control characters
/// (escape sequences, carriage returns, bells) and the characters that
/// reorder text. New lines and tabs stay. Text from a collaborator or a
/// server (a project name, a comment) goes through this before it is printed.
pub(crate) fn plain_text(text: &str) -> String {
    text.chars()
        .filter(|character| {
            matches!(character, '\n' | '\t')
                || !(character.is_control()
                    || matches!(*character, '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}'))
        })
        .collect()
}

/// [`plain_text`] for a value that belongs on one line, such as a project
/// name: line breaks and tabs become spaces, so it can't start a line of its
/// own.
pub(crate) fn one_line(text: &str) -> String {
    plain_text(&text.replace(['\n', '\t', '\r'], " "))
}

/// Lists a failure's files for people (JSON has them in `details`).
pub(crate) fn note_failure_files(ctx: &Context, error: &CliError) {
    let Some(details) = &error.details else {
        return;
    };
    for key in ["conflicts", "differing"] {
        if let Some(files) = details.get(key).and_then(Value::as_array) {
            for file in files.iter().filter_map(Value::as_str) {
                ctx.note(format!("  {file}"));
            }
        }
    }
}

/// The process's view of accounts: where data lives and what it may ask.
pub(crate) struct Env {
    pub data_root: PathBuf,
    pub home: PathBuf,
    pub store: SecretStore,
    pub online_git_token: Option<Zeroizing<String>>,
    /// Questions may be asked (a terminal, no `--no-input`, not CI).
    pub interactive: bool,
    pub stdin_is_tty: bool,
    pub platform: HostPlatform,
}

impl Env {
    /// The only place that reads the data folder, the home folder and the
    /// token variable from the process.
    pub(crate) fn from_context(ctx: &Context) -> Result<Env, CliError> {
        use std::io::IsTerminal as _;
        let data_root = ctx.data_root().map(Path::to_path_buf).ok_or_else(no_home)?;
        let home = oleafly_secrets::paths::home_dir().map_err(|_| no_home())?;
        let online_git_token = std::env::var(ONLINE_GIT_TOKEN_VARIABLE)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(Zeroizing::new);
        Ok(Env {
            store: SecretStore::at(&data_root),
            data_root,
            home,
            online_git_token,
            interactive: ctx.interactive(),
            stdin_is_tty: std::io::stdin().is_terminal(),
            platform: HostPlatform::current(),
        })
    }

    /// The app's library of projects.
    pub(crate) fn projects_root(&self) -> PathBuf {
        self.data_root.join("projects")
    }
}

fn no_home() -> CliError {
    CliError::new(
        ErrorKind::MissingTool,
        "store.unavailable",
        "Oleafly couldn't find your home folder.",
    )
    .hint("Set HOME (or USERPROFILE on Windows), or OLEAFLY_DATA_DIR.")
}

/// One line of secret text: asked for with hidden input in a terminal,
/// else read from standard input (at most 16 KB, one line).
pub(crate) fn read_secret_input(
    input: &mut dyn Read,
    is_tty: bool,
    interactive: bool,
    prompt: &str,
) -> Result<Zeroizing<String>, CliError> {
    let usage = |code: &'static str, message: &str| CliError::new(ErrorKind::Usage, code, message);
    let raw = if is_tty {
        if !interactive {
            return Err(usage(
                "auth.no_input",
                "Pipe the secret on standard input when --no-input is set.",
            ));
        }
        Zeroizing::new(rpassword::prompt_password(prompt).map_err(CliError::from)?)
    } else {
        let mut bytes = Zeroizing::new(Vec::new());
        input
            .take(MAX_SECRET_INPUT as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(CliError::from)?;
        if bytes.len() > MAX_SECRET_INPUT {
            return Err(usage(
                "auth.input_too_long",
                "The input is longer than 16 KB.",
            ));
        }
        match std::str::from_utf8(&bytes) {
            Ok(text) => Zeroizing::new(text.to_string()),
            Err(_) => return Err(usage("auth.not_text", "The input isn't plain text.")),
        }
    };
    let line = raw
        .strip_suffix('\n')
        .map(|rest| rest.strip_suffix('\r').unwrap_or(rest))
        .unwrap_or(&raw);
    if line.contains(['\n', '\r']) {
        return Err(usage(
            "auth.multiline_input",
            "Paste the value on one line.",
        ));
    }
    let value = line.trim();
    if value.is_empty() {
        return Err(usage(
            "auth.empty_input",
            "Nothing was read from standard input.",
        ));
    }
    Ok(Zeroizing::new(value.to_string()))
}

/// `Oleafly/<version>`, the agent every request names.
pub(crate) fn user_agent() -> String {
    format!("Oleafly/{}", crate::version::APP_VERSION)
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

/// The command line's collaboration secrets in the shared store: every
/// account is kept as `cli:<account>`.
pub(crate) struct CliSecrets {
    store: SecretStore,
}

impl CliSecrets {
    pub(crate) fn new(store: SecretStore) -> CliSecrets {
        CliSecrets { store }
    }

    fn account(account: &str) -> String {
        format!("{CLI_ACCOUNT_PREFIX}{account}")
    }
}

impl SecretPort for CliSecrets {
    fn get(&self, account: &str) -> Result<Option<String>, CollabError> {
        self.store
            .get(&Self::account(account))
            .map_err(CollabError::Secret)
    }

    fn set(&self, account: &str, value: &str) -> Result<(), CollabError> {
        if value.is_empty() {
            return Err(CollabError::Secret(format!(
                "refusing to store an empty value for {account}"
            )));
        }
        self.store
            .set(&[(&Self::account(account), value)])
            .map_err(CollabError::Secret)
    }

    fn remove(&self, account: &str) -> Result<(), CollabError> {
        self.store
            .set(&[(&Self::account(account), "")])
            .map_err(CollabError::Secret)
    }
}

/// The encrypted store couldn't be read or written.
pub(crate) fn from_store(error: String, root: &Path) -> CliError {
    CliError::new(
        ErrorKind::MissingTool,
        "store.unavailable",
        format!(
            "Oleafly couldn't use its encrypted store in {}.",
            root.display()
        ),
    )
    .details(json!({"cause": error}))
}

const SIGNED_OUT_HINT: &str = "Run oleafly auth login online, or sign in from the Oleafly app.";
const TOKEN_HINT: &str =
    "Create a Git token in your account settings, then run oleafly auth login online --with-token.";

/// An online-service failure as the command line reports it. Credential
/// failures never carry the error's detail, which may echo what was sent.
pub(crate) fn from_online(error: &OnlineError) -> CliError {
    use OnlineErrorKind as Kind;
    let param = |name: &str| error.params.get(name).cloned();
    let server = param("server").unwrap_or_else(|| "the server".to_string());
    let file = param("file").unwrap_or_else(|| "A file".to_string());
    let files = param("files").unwrap_or_default();
    let new =
        |kind: ErrorKind, code: &'static str, message: String| CliError::new(kind, code, message);
    let failure = match error.kind {
        Kind::InvalidServer => new(ErrorKind::Usage, "online.invalid_server", format!("\"{server}\" isn't a server address Oleafly can use."))
            .hint("Use an address like https://latex.example.edu."),
        Kind::SignedOut => new(ErrorKind::Auth, "online.signed_out", format!("You're not signed in to {server}.")).hint(SIGNED_OUT_HINT),
        Kind::SessionExpired => new(ErrorKind::Auth, "online.session_expired", format!("Your sign-in to {server} expired.")).hint(SIGNED_OUT_HINT),
        Kind::SignInFailed => new(ErrorKind::Auth, "online.sign_in_failed", format!("Oleafly couldn't confirm the sign-in to {server}."))
            .hint("Copy the session again and try once more."),
        Kind::SignInCancelled => new(ErrorKind::Auth, "online.sign_in_cancelled", "Sign-in was cancelled.".to_string()),
        Kind::RateLimited => new(ErrorKind::Network, "online.rate_limited", format!("{server} asked Oleafly to slow down."))
            .hint("Wait a minute and try again.")
            .retryable(),
        Kind::Unreachable => new(ErrorKind::Network, "online.unreachable", format!("Oleafly couldn't reach {server}."))
            .hint("Check your connection and the server address.")
            .retryable(),
        Kind::Unrecognized => new(ErrorKind::Network, "online.unrecognized", format!("The project list from {server} isn't in a format Oleafly knows."))
            .hint("Download the project as a .zip from the website instead."),
        Kind::ProjectUnavailable => new(
            ErrorKind::InvalidInput,
            "online.project_unavailable",
            "This project couldn't be downloaded. You may no longer have access to it.".to_string(),
        ),
        Kind::TooLarge => new(ErrorKind::InvalidInput, "online.too_large", "This project is larger than the 2 GB import limit.".to_string()),
        Kind::NotAnArchive => new(ErrorKind::InvalidInput, "online.not_an_archive", "The server sent something other than a project archive.".to_string()),
        Kind::TemplateUnavailable | Kind::TemplateLinkInvalid => {
            new(ErrorKind::InvalidInput, "online.template_unavailable", "This template couldn't be opened.".to_string())
        }
        Kind::GitTokenInvalid => new(ErrorKind::Usage, "online.git_token_invalid", "That doesn't look like a Git token.".to_string())
            .hint("Copy the whole token from your account settings."),
        Kind::GitTokenMissing => new(ErrorKind::Auth, "online.git_token_missing", format!("No Git token is saved for {server}.")).hint(TOKEN_HINT),
        Kind::GitTokenRejected => new(ErrorKind::Auth, "online.git_token_rejected", format!("{server} didn't accept the Git token. It may have expired."))
            .hint("Create a new token and save it with oleafly auth login online --with-token."),
        Kind::GitUnavailable => new(
            ErrorKind::InvalidInput,
            "online.git_unavailable",
            "Git access isn't available for this project. The project's owner needs a paid or institutional plan.".to_string(),
        )
        .hint("Use oleafly remote import to download a copy."),
        Kind::GitNotInstalled => new(ErrorKind::MissingTool, "online.git_not_installed", "Git isn't installed.".to_string()).hint("Install Git, then try again."),
        Kind::SyncBusy => new(ErrorKind::Conflict, "remote.busy", "Another sync is running for this project.".to_string())
            .hint("Wait for it to finish, then try again.")
            .retryable(),
        Kind::WorktreeBusy => new(ErrorKind::Conflict, "remote.project_busy", "The Oleafly app is changing this project right now.".to_string())
            .hint("Try again in a moment.")
            .retryable(),
        Kind::SyncNotLinked => new(ErrorKind::InvalidInput, "remote.not_linked", "This folder isn't linked to an online project.".to_string())
            .hint("Run oleafly remote link first."),
        Kind::SyncAlreadyLinked => new(ErrorKind::Conflict, "remote.already_linked", "This folder is linked to a different online project.".to_string())
            .hint("Run oleafly remote unlink first."),
        Kind::SyncNeedsRelink => new(ErrorKind::InvalidInput, "remote.needs_relink", "The private sync copy for this folder is missing.".to_string())
            .hint("Run oleafly remote unlink, then oleafly remote link."),
        Kind::SyncOffline => new(ErrorKind::Network, "remote.offline", "Oleafly couldn't reach the online project. Nothing changed here.".to_string()).retryable(),
        Kind::SyncFailed => new(ErrorKind::Internal, "remote.failed", "The sync didn't finish. Your files here are unchanged.".to_string()),
        Kind::SyncKeptChanging => new(ErrorKind::Conflict, "remote.kept_changing", "The online project kept changing during the sync.".to_string())
            .hint("Try again in a moment.")
            .retryable(),
        Kind::SyncCaseClash => new(
            ErrorKind::InvalidInput,
            "remote.case_clash",
            format!("The online project has files whose names differ only in capital letters: {files}."),
        )
        .hint("Rename one of them online, then sync again."),
        Kind::SyncInvalidNames => new(ErrorKind::InvalidInput, "remote.invalid_names", format!("Some online file names can't be saved on this computer: {files}."))
            .hint("Rename them online, then sync again."),
        Kind::SyncFileTooLarge => new(ErrorKind::InvalidInput, "remote.file_too_large", format!("{file} is larger than the 50 MB limit for one file.")),
        Kind::SyncTooLarge => new(ErrorKind::InvalidInput, "remote.too_large", "This project is too large to sync. The limit is 5,000 files or 2 GB.".to_string()),
        Kind::SyncPathBlocked => new(ErrorKind::InvalidInput, "remote.path_blocked", format!("{file} can't be written because a folder with that name is in the way.")),
        Kind::FolderExists => new(
            ErrorKind::InvalidInput,
            "remote.folder_exists",
            format!("{} already exists.", param("folder").unwrap_or_else(|| "The folder".to_string())),
        )
        .hint("Choose another place with --into."),
        Kind::Io => new(ErrorKind::Io, "online.local_error", error.detail.clone().unwrap_or_else(|| "A local file couldn't be used.".to_string())),
    };
    let shares_detail = matches!(
        error.kind,
        Kind::Unreachable | Kind::Unrecognized | Kind::SyncFailed | Kind::SyncOffline
    );
    match (&error.detail, shares_detail) {
        (Some(detail), true) => failure.details(json!({"cause": detail})),
        _ => failure,
    }
}

/// A collaboration-server failure as the command line reports it.
pub(crate) fn from_collab(error: &CollabError, server: &str) -> CliError {
    let new =
        |kind: ErrorKind, code: &'static str, message: String| CliError::new(kind, code, message);
    let sign_in_hint = format!("Run oleafly server sign-in {server}.");
    match error {
        CollabError::Io(cause)
        | CollabError::Corrupt(cause)
        | CollabError::Secret(cause)
        | CollabError::Crypto(cause)
        | CollabError::InvalidPath(cause) => new(
            ErrorKind::Internal,
            "server.local_error",
            "Oleafly couldn't read its saved server data.".to_string(),
        )
        .details(json!({"cause": cause})),
        CollabError::Network(cause) => new(
            ErrorKind::Network,
            "server.unreachable",
            format!("{server} couldn't be reached."),
        )
        .hint("Check your connection and the server address.")
        .retryable()
        .details(json!({"cause": cause})),
        CollabError::NotHttps => new(
            ErrorKind::Usage,
            "server.not_https",
            "Collaboration servers need an https:// address.".to_string(),
        ),
        CollabError::ProtocolMismatch(VersionMismatch::ClientTooOld) => new(
            ErrorKind::MissingTool,
            "server.client_too_old",
            "This server needs a newer Oleafly.".to_string(),
        )
        .hint("Update Oleafly, then try again."),
        CollabError::ProtocolMismatch(VersionMismatch::ServerTooOld) => new(
            ErrorKind::MissingTool,
            "server.server_too_old",
            "This server is too old for this version of Oleafly.".to_string(),
        ),
        CollabError::Api {
            status,
            code,
            message,
        } => {
            let details = json!({"status": status, "code": code, "message": message});
            let failure = match status {
                401 => new(
                    ErrorKind::Auth,
                    "server.unauthorized",
                    format!("{server} didn't accept this command line's sign-in."),
                )
                .hint(sign_in_hint),
                403 => new(
                    ErrorKind::Auth,
                    "server.forbidden",
                    "You don't have access to that.".to_string(),
                ),
                404 => new(
                    ErrorKind::InvalidInput,
                    "server.not_found",
                    format!("That wasn't found on {server}."),
                ),
                409 => new(
                    ErrorKind::Conflict,
                    "server.conflict",
                    "That changed on the server at the same time.".to_string(),
                )
                .retryable(),
                413 => new(
                    ErrorKind::InvalidInput,
                    "server.too_large",
                    "That's larger than the server allows.".to_string(),
                ),
                429 => new(
                    ErrorKind::Network,
                    "server.rate_limited",
                    format!("{server} asked Oleafly to slow down."),
                )
                .hint("Wait a minute and try again.")
                .retryable(),
                400..=499 => new(
                    ErrorKind::Usage,
                    "server.invalid",
                    "The server didn't accept that request.".to_string(),
                ),
                _ => new(
                    ErrorKind::Network,
                    "server.error",
                    "The server had a problem. Try again later.".to_string(),
                )
                .retryable(),
            };
            failure.details(details)
        }
        CollabError::SignInCancelled => new(
            ErrorKind::Auth,
            "server.sign_in_cancelled",
            "Sign-in was declined or cancelled.".to_string(),
        ),
        CollabError::SignInTimedOut => new(
            ErrorKind::Auth,
            "server.sign_in_timed_out",
            "The sign-in code expired.".to_string(),
        )
        .hint("Run oleafly server sign-in again."),
        CollabError::NotAdmitted => new(
            ErrorKind::Auth,
            "server.not_admitted",
            "Your account isn't admitted to this server yet.".to_string(),
        )
        .hint("Ask the server's admin to let you in."),
        CollabError::Unauthorized => new(
            ErrorKind::Auth,
            "server.unauthorized",
            format!("{server} didn't accept this command line's sign-in."),
        )
        .hint(sign_in_hint),
        CollabError::SessionEnded(reason) => new(
            ErrorKind::Auth,
            "server.session_ended",
            format!("{server} ended this command line's sign-in."),
        )
        .hint(sign_in_hint)
        .details(json!({"reason": reason.as_str()})),
        CollabError::ServerChanged { .. } => new(
            ErrorKind::Auth,
            "server.changed",
            format!("The server at {server} isn't the one you signed in to before."),
        )
        .hint(format!(
            "Sign out with oleafly auth logout server {server}, then sign in again."
        )),
        CollabError::DuplicateServer { url } => new(
            ErrorKind::Usage,
            "server.duplicate",
            format!("This server is already in the list at {url}."),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(input: &str) -> Result<Zeroizing<String>, CliError> {
        read_secret_input(&mut input.as_bytes(), false, false, "")
    }

    #[test]
    fn piped_secrets_lose_crlf_and_reject_inner_newlines() {
        assert_eq!(read("tok_abc12345\r\n").unwrap().as_str(), "tok_abc12345");
        assert_eq!(read("tok_abc12345").unwrap().as_str(), "tok_abc12345");
        assert_eq!(read("a\nb\n").unwrap_err().code, "auth.multiline_input");
        assert_eq!(read("a\rb").unwrap_err().kind, ErrorKind::Usage);
        assert_eq!(read("").unwrap_err().code, "auth.empty_input");
        assert_eq!(read("  \n").unwrap_err().code, "auth.empty_input");
    }

    #[test]
    fn secret_input_over_16_kib_is_refused() {
        let huge = vec![b'a'; 10_000_000];
        assert_eq!(
            read_secret_input(&mut huge.as_slice(), false, false, "")
                .unwrap_err()
                .code,
            "auth.input_too_long"
        );
        let fits = vec![b'a'; MAX_SECRET_INPUT];
        assert_eq!(
            read_secret_input(&mut fits.as_slice(), false, false, "")
                .unwrap()
                .len(),
            MAX_SECRET_INPUT
        );
    }

    #[test]
    fn a_terminal_stdin_with_no_input_is_a_usage_error() {
        let error = read_secret_input(&mut std::io::empty(), true, false, "").unwrap_err();
        assert_eq!(
            (error.code.as_ref(), error.exit() as u8),
            ("auth.no_input", 2)
        );
    }

    #[test]
    fn binary_input_is_refused() {
        assert_eq!(
            read_secret_input(&mut [0xff_u8, 0xfe].as_slice(), false, false, "")
                .unwrap_err()
                .code,
            "auth.not_text"
        );
    }

    #[test]
    fn terminal_text_loses_escape_sequences_and_line_forgery() {
        assert_eq!(
            plain_text("ok\u{1b}]52;c;ZXZpbA==\u{7}\u{1b}[2J done\r\nnext\tcol"),
            "ok]52;c;ZXZpbA==[2J done\nnext\tcol"
        );
        assert_eq!(plain_text("a\u{85}b\u{9b}c\u{202e}d"), "abcd");
        assert_eq!(plain_text("Thèse – 论文 🙂"), "Thèse – 论文 🙂");
        assert_eq!(
            one_line("Real\n  p9  Fake project\u{1b}[0m"),
            "Real   p9  Fake project[0m"
        );
    }

    const SECRET: &str = "tok_SECRET_9f8e";

    fn rendered(error: &CliError) -> String {
        format!(
            "{} {} {}",
            error.message,
            error.hint.clone().unwrap_or_default(),
            error.details.clone().unwrap_or_default()
        )
    }

    #[test]
    fn failures_never_echo_the_input_secret() {
        use OnlineErrorKind as Kind;
        for kind in [
            Kind::GitTokenInvalid,
            Kind::GitTokenRejected,
            Kind::GitTokenMissing,
            Kind::SignInFailed,
            Kind::SessionExpired,
            Kind::SignedOut,
        ] {
            let error = OnlineError::new(kind)
                .param("server", "https://latex.example.edu")
                .detail(SECRET);
            let text = rendered(&from_online(&error));
            assert!(
                !text.contains(SECRET) && !text.contains("tok_SECR"),
                "{kind:?}: {text}"
            );
        }
    }

    #[test]
    fn every_online_and_collab_error_has_an_exit_code_and_a_stable_code() {
        use OnlineErrorKind as Kind;
        let online = |kind: Kind| {
            from_online(&OnlineError::new(kind).param("server", "https://latex.example.edu"))
        };
        let session = online(Kind::SessionExpired);
        assert_eq!(
            (session.code.as_ref(), session.exit() as u8),
            ("online.session_expired", 6)
        );
        let busy = online(Kind::SyncBusy);
        assert_eq!(
            (busy.code.as_ref(), busy.exit() as u8, busy.retryable),
            ("remote.busy", 8, true)
        );
        assert_eq!(online(Kind::GitNotInstalled).exit() as u8, 4);
        assert_eq!(online(Kind::ProjectUnavailable).exit() as u8, 3);
        let limited = from_collab(
            &CollabError::Api {
                status: 429,
                code: "rate_limited".into(),
                message: "slow down".into(),
            },
            "https://collab.example.edu",
        );
        assert_eq!(
            (
                limited.code.as_ref(),
                limited.exit() as u8,
                limited.retryable
            ),
            ("server.rate_limited", 7, true)
        );
        assert_eq!(from_collab(&CollabError::Unauthorized, "x").exit() as u8, 6);
        assert_eq!(from_collab(&CollabError::NotHttps, "x").exit() as u8, 2);
        assert_eq!(
            from_collab(&CollabError::Corrupt("servers.json".into()), "x").exit() as u8,
            1
        );
        for kind in [
            Kind::InvalidServer,
            Kind::SignedOut,
            Kind::RateLimited,
            Kind::Unreachable,
            Kind::Unrecognized,
            Kind::GitUnavailable,
            Kind::SyncCaseClash,
            Kind::SyncTooLarge,
            Kind::FolderExists,
            Kind::Io,
        ] {
            let error = online(kind);
            assert!(
                error.code.starts_with("online.") || error.code.starts_with("remote."),
                "{kind:?}"
            );
            let service = oleafly_online::service::SERVICE_ID;
            assert!(
                !error.code.contains(service)
                    && !error.message.to_ascii_lowercase().contains(service),
                "{kind:?}"
            );
        }
    }

    #[test]
    fn cli_secrets_never_touch_the_app_accounts() {
        let dir = tempfile::tempdir().unwrap();
        let store = SecretStore::at(dir.path());
        store.set(&[("collab_device_key", "app-key")]).unwrap();
        let cli = CliSecrets::new(store.clone());
        assert_eq!(cli.get("collab_device_key").unwrap(), None);
        cli.set("collab_device_key", "cli-key").unwrap();
        assert_eq!(
            store.get("collab_device_key").unwrap().as_deref(),
            Some("app-key")
        );
        assert_eq!(
            store.get("cli:collab_device_key").unwrap().as_deref(),
            Some("cli-key")
        );
        cli.remove("collab_device_key").unwrap();
        assert_eq!(store.get("cli:collab_device_key").unwrap(), None);
        assert_eq!(
            store.get("collab_device_key").unwrap().as_deref(),
            Some("app-key")
        );
        assert!(cli.set("x", "").is_err());
    }
}
