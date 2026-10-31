use serde_json::Value;

const MAX_RPC_MESSAGE_CHARS: usize = 600;

pub fn rpc_error_message(error: &Value) -> String {
    let message = clean_text(error["message"].as_str());
    let detail = clean_text(error_detail(&error["data"]));
    let text = match (message, detail) {
        (Some(message), Some(detail))
            if is_generic(&message) || detail.contains(message.as_str()) =>
        {
            detail
        }
        (Some(message), Some(detail)) if message.contains(detail.as_str()) => message,
        (Some(message), Some(detail)) => format!("{message}: {detail}"),
        (Some(text), None) | (None, Some(text)) => text,
        (None, None) => return "The agent could not complete this request.".to_owned(),
    };
    let bounded: String = text.chars().take(MAX_RPC_MESSAGE_CHARS).collect();
    bounded.trim().to_owned()
}

fn error_detail(data: &Value) -> Option<&str> {
    data.as_str().or_else(|| {
        ["details", "detail", "message", "error"]
            .iter()
            .find_map(|key| data[*key].as_str())
    })
}

fn clean_text(text: Option<&str>) -> Option<String> {
    let cleaned: String = text?.chars().filter(|value| !value.is_control()).collect();
    let cleaned = cleaned.trim();
    (!cleaned.is_empty()).then(|| cleaned.to_owned())
}

fn is_generic(message: &str) -> bool {
    matches!(
        message.trim_end_matches('.').to_lowercase().as_str(),
        "internal error" | "internal server error" | "unknown error" | "error"
    )
}

pub fn reads_as_command_help(tail: &str) -> bool {
    tail.contains("--help") || tail.contains("Options:") || tail.starts_with("Usage:")
}

pub fn disconnect_message(prefix: &str, stderr_tail: &str) -> String {
    if stderr_tail.is_empty() {
        prefix.to_owned()
    } else if reads_as_command_help(stderr_tail) {
        format!("{prefix} It answered with its command-line help, so this version does not accept the options Oleafly started it with.")
    } else {
        format!("{prefix} Last output from the agent: {stderr_tail}")
    }
}

const AUTH_FAILURE_PHRASES: &[&str] = &[
    "failed to authenticate",
    "authentication fail",
    "incorrect api key",
    "not authenticated",
    "oauth",
    "unauthorized",
    "invalid api key",
    "expired credentials",
    "credentials have expired",
    "session expired",
    "please log in",
    "please sign in",
    "log in again",
    "sign in again",
    "no llm provider configured",
    "no provider configured",
    "no api key",
];

pub fn reads_as_auth_failure(message: &str) -> bool {
    names_auth_failure(message, false)
}

fn names_auth_failure(message: &str, quotes_output: bool) -> bool {
    let message = message.to_lowercase();
    AUTH_FAILURE_PHRASES
        .iter()
        .filter(|phrase| !quotes_output || phrase.contains(' '))
        .any(|phrase| message.contains(phrase))
        || (message.contains("api key") && message.contains("is invalid"))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ErrorKind {
    Disconnected,
    DisconnectedBeforeReply,
    TimedOutStopped,
    TimedOut,
    Silent { minutes: u64 },
    SpawnFailed { kind: String, path: String },
    NotConnected,
}

impl ErrorKind {
    fn message(&self, output: &str) -> String {
        match self {
            Self::Disconnected => disconnect_message("The agent disconnected.", output),
            Self::DisconnectedBeforeReply => {
                disconnect_message("The agent disconnected before replying.", output)
            }
            Self::TimedOutStopped => {
                disconnect_message("The agent did not reply in time and was stopped.", output)
            }
            Self::TimedOut => "The agent did not reply in time.".into(),
            Self::Silent { minutes } => format!(
                "The agent sent nothing for {minutes} minutes, so Oleafly stopped it. Reconnect to continue."
            ),
            Self::SpawnFailed { kind, path } => format!(
                "The agent could not be started. Check its installation and executable permissions. ({kind}: {path})"
            ),
            Self::NotConnected => "The agent is disconnected.".into(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    pub kind: Option<ErrorKind>,
    pub output: Option<String>,
}

impl RpcError {
    pub fn local(message: &str) -> Self {
        Self {
            code: -32603,
            message: message.into(),
            kind: None,
            output: None,
        }
    }

    pub fn agent(code: i64, message: String) -> Self {
        Self {
            code,
            message,
            kind: None,
            output: None,
        }
    }

    pub fn connection(kind: ErrorKind, output: &str) -> Self {
        let quotes = matches!(
            kind,
            ErrorKind::Disconnected
                | ErrorKind::DisconnectedBeforeReply
                | ErrorKind::TimedOutStopped
        );
        let output = if quotes { output } else { "" };
        Self {
            code: -32603,
            message: kind.message(output),
            kind: Some(kind),
            output: (!output.is_empty()).then(|| output.to_owned()),
        }
    }

    pub fn command_help(&self) -> bool {
        self.output.as_deref().is_some_and(reads_as_command_help)
    }

    pub fn auth_required(&self) -> bool {
        self.code == -32000 || names_auth_failure(&self.message, self.output.is_some())
    }

    pub fn method_not_found(&self) -> bool {
        self.code == -32601
    }
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for RpcError {}

impl From<RpcError> for String {
    fn from(error: RpcError) -> Self {
        error.message
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn command_help_and_auth_failures_are_recognised() {
        assert!(reads_as_command_help("Usage: agent [OPTIONS]"));
        assert!(reads_as_command_help(
            "error: unexpected argument, see --help"
        ));
        assert!(!reads_as_command_help("connection refused"));
        assert!(reads_as_auth_failure(
            "Authentication failed: token expired"
        ));
        assert!(reads_as_auth_failure("Please sign in again"));
        assert!(!reads_as_auth_failure("model not found"));
        assert!(reads_as_auth_failure("Internal error: turn failed: Authentication Fails, Your api key: ****iBZW is invalid (request_id: fa74)"));
        assert!(reads_as_auth_failure("Incorrect API key provided"));
        assert!(!reads_as_auth_failure(
            "The api key field is optional for local models"
        ));
        assert!(!reads_as_auth_failure("tool input is invalid"));
        assert!(reads_as_auth_failure("Internal error: turn failed: llm-deepseek: no API key for provider route \"deepseek-official\"; store DEEPSEEK_API_KEY through the credentials service"));
        assert!(RpcError::agent(-32000, "x".into()).auth_required());
    }

    #[test]
    fn connection_failures_keep_their_english_message_and_their_kind() {
        let cases = [
            (ErrorKind::Disconnected, "", "The agent disconnected."),
            (
                ErrorKind::DisconnectedBeforeReply,
                "panic: boom",
                "The agent disconnected before replying. Last output from the agent: panic: boom",
            ),
            (
                ErrorKind::TimedOutStopped,
                "Usage: agent [OPTIONS]",
                "The agent did not reply in time and was stopped. It answered with its command-line help, so this version does not accept the options Oleafly started it with.",
            ),
            (ErrorKind::TimedOut, "ignored", "The agent did not reply in time."),
            (
                ErrorKind::Silent { minutes: 20 },
                "",
                "The agent sent nothing for 20 minutes, so Oleafly stopped it. Reconnect to continue.",
            ),
            (
                ErrorKind::SpawnFailed {
                    kind: "NotFound".into(),
                    path: "/bin/agent".into(),
                },
                "",
                "The agent could not be started. Check its installation and executable permissions. (NotFound: /bin/agent)",
            ),
            (ErrorKind::NotConnected, "", "The agent is disconnected."),
        ];
        for (kind, output, message) in cases {
            let error = RpcError::connection(kind.clone(), output);
            assert_eq!(error.message, message);
            assert_eq!(error.kind, Some(kind));
            assert_eq!(error.code, -32603);
            assert_eq!(error.to_string(), message);
        }
        let quoted = RpcError::connection(ErrorKind::Disconnected, "Usage: agent");
        assert_eq!(quoted.output.as_deref(), Some("Usage: agent"));
        assert!(quoted.command_help());
        let unquoted = RpcError::connection(ErrorKind::TimedOut, "panic: boom");
        assert_eq!(unquoted.output, None);
        assert!(!unquoted.command_help());
        assert_eq!(RpcError::local("x").kind, None);
        assert_eq!(String::from(RpcError::local("plain")), "plain");
    }

    #[test]
    fn a_quoted_sign_in_failure_still_asks_for_sign_in() {
        let error = RpcError::connection(
            ErrorKind::DisconnectedBeforeReply,
            "Error: Please sign in again",
        );
        assert!(error.auth_required());
        assert!(!error.method_not_found());
    }

    #[test]
    fn a_crash_whose_stack_names_oauth_code_is_shown_as_the_crash() {
        let crash = RpcError::connection(
            ErrorKind::DisconnectedBeforeReply,
            "Error: connect ETIMEDOUT 142.250.72.10:443 at OAuth2Client.refreshTokenNoCache (/usr/lib/node_modules/google-auth-library/build/src/auth/oauth2client.js:212:19) at handleUnauthorized (/srv/agent/unauthorized.js:3:1)",
        );
        assert!(!crash.auth_required());
        assert!(crash.message.contains("ETIMEDOUT"));
        assert!(RpcError::connection(
            ErrorKind::Disconnected,
            "Error: 401 Unauthorized. Not authenticated, run `agent login`"
        )
        .auth_required());
        assert!(RpcError::agent(-32603, "Unauthorized".into()).auth_required());
        assert!(RpcError::agent(-32603, "OAuth token was revoked".into()).auth_required());
    }

    #[test]
    fn rpc_messages_are_cleaned_and_bounded() {
        assert_eq!(
            rpc_error_message(&json!({"message": "  \u{7}bad\nthing  "})),
            "badthing"
        );
        assert_eq!(
            rpc_error_message(&json!({})),
            "The agent could not complete this request."
        );
        assert_eq!(
            rpc_error_message(&json!({"message": "x".repeat(700)})).len(),
            600
        );
    }

    #[test]
    fn disconnect_messages_quote_the_stderr_tail() {
        assert_eq!(disconnect_message("Gone.", ""), "Gone.");
        assert_eq!(
            disconnect_message("Gone.", "panic: boom"),
            "Gone. Last output from the agent: panic: boom"
        );
        assert!(disconnect_message("Gone.", "Usage: x").contains("command-line help"));
    }
}
