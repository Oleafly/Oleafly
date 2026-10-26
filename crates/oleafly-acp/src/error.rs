//! Errors from the agent connection and the messages Oleafly shows for them.
use serde_json::Value;

const MAX_RPC_MESSAGE_CHARS: usize = 600;

/// The message of an agent's JSON-RPC error, cleaned for display.
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

/// Whether an error message says the agent needs the user to sign in.
pub fn reads_as_auth_failure(message: &str) -> bool {
    let message = message.to_lowercase();
    AUTH_FAILURE_PHRASES
        .iter()
        .any(|phrase| message.contains(phrase))
        || (message.contains("api key") && message.contains("is invalid"))
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
        assert!(reads_as_auth_failure("Internal error: turn failed: Authentication Fails, Your api key: ****iBZW is invalid (request_id: fa74)"));
        assert!(reads_as_auth_failure("Incorrect API key provided"));
        assert!(!reads_as_auth_failure(
            "The api key field is optional for local models"
        ));
        assert!(!reads_as_auth_failure("tool input is invalid"));
        assert!(reads_as_auth_failure("Internal error: turn failed: llm-deepseek: no API key for provider route \"deepseek-official\"; store DEEPSEEK_API_KEY through the credentials service"));
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
            "Gone. Last output from the agent: panic: boom"
        );
        assert!(disconnect_message("Gone.", "Usage: x").contains("command-line help"));
    }
}
