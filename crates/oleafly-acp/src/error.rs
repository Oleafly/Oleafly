//! Errors from the agent connection and the messages Oleafly shows for them.
use serde_json::Value;

const MAX_RPC_MESSAGE_CHARS: usize = 600;

/// The message of an agent's JSON-RPC error, cleaned for display.
pub fn rpc_error_message(error: &Value) -> String {
    let message: String = error["message"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("The agent could not complete this request.")
        .chars()
        .filter(|value| !value.is_control())
        .take(MAX_RPC_MESSAGE_CHARS)
        .collect();
    let message = message.trim();
    if message.is_empty() {
        "The agent could not complete this request.".to_owned()
    } else {
        message.to_owned()
    }
}

/// Whether stderr reads like a CLI's `--help` output (the agent did not
/// accept the options it was started with).
pub fn reads_as_command_help(tail: &str) -> bool {
    tail.contains("--help") || tail.contains("Options:") || tail.starts_with("Usage:")
}

/// `prefix`, followed by what the agent wrote to stderr when there is any.
pub fn disconnect_message(prefix: &str, stderr_tail: &str) -> String {
    if stderr_tail.is_empty() {
        prefix.to_owned()
    } else if reads_as_command_help(stderr_tail) {
        format!("{prefix} It answered with its command-line help, so this version does not accept the options Oleafly started it with.")
    } else {
        format!("{prefix} It reported: {stderr_tail}")
    }
}

const AUTH_FAILURE_PHRASES: &[&str] = &[
    "failed to authenticate",
    "authentication failed",
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
];

/// Whether an error message says the agent needs the user to sign in.
pub fn reads_as_auth_failure(message: &str) -> bool {
    let message = message.to_lowercase();
    AUTH_FAILURE_PHRASES
        .iter()
        .any(|phrase| message.contains(phrase))
}

#[derive(Clone, Debug)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
}

impl RpcError {
    /// An error raised by Oleafly, not by the agent.
    pub fn local(message: &str) -> Self {
        Self {
            code: -32603,
            message: message.into(),
        }
    }

    pub fn auth_required(&self) -> bool {
        self.code == -32000 || reads_as_auth_failure(&self.message)
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
        assert!(RpcError {
            code: -32000,
            message: "x".into()
        }
        .auth_required());
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
            "Gone. It reported: panic: boom"
        );
        assert!(disconnect_message("Gone.", "Usage: x").contains("command-line help"));
    }
}
