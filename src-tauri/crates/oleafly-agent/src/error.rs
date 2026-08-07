use std::fmt;

/// Why a completion failed, and whether retrying it could succeed.
///
/// The distinction matters to the caller: the chat surfaces offer a retry
/// button for transient failures and a settings link for configuration ones,
/// so collapsing everything into a string would lose the difference.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentError {
    /// No provider is configured, or the configured one has no credential.
    NotConfigured(String),
    /// The request never reached the provider.
    Transport(String),
    /// The provider answered with a non-success status.
    Provider {
        status: u16,
        message: String,
    },
    /// The provider answered, but not in the shape its API documents.
    Decode(String),
    /// The caller cancelled, or the deadline elapsed.
    Cancelled,
    Timeout,
}

impl AgentError {
    /// Whether offering the user a retry makes sense.
    ///
    /// 401/403 mean a bad key and 400 means a malformed request: retrying
    /// those verbatim just burns another round trip. 429 and 5xx are the
    /// provider asking for patience.
    pub fn retryable(&self) -> bool {
        match self {
            AgentError::Transport(_) | AgentError::Timeout => true,
            AgentError::Provider { status, .. } => *status == 429 || *status >= 500,
            AgentError::NotConfigured(_) | AgentError::Decode(_) | AgentError::Cancelled => false,
        }
    }
}

impl fmt::Display for AgentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AgentError::NotConfigured(m) => write!(f, "{m}"),
            AgentError::Transport(m) => write!(f, "Could not reach the provider. {m}"),
            AgentError::Provider { status, message } => {
                write!(f, "The provider returned {status}. {message}")
            }
            AgentError::Decode(m) => write!(f, "Unexpected response from the provider. {m}"),
            AgentError::Cancelled => write!(f, "The request was cancelled."),
            AgentError::Timeout => write!(f, "The request timed out."),
        }
    }
}

impl std::error::Error for AgentError {}

pub type Result<T> = std::result::Result<T, AgentError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retryable_covers_transient_failures_only() {
        assert!(AgentError::Timeout.retryable());
        assert!(AgentError::Transport("dns".into()).retryable());
        assert!(AgentError::Provider {
            status: 429,
            message: String::new()
        }
        .retryable());
        assert!(AgentError::Provider {
            status: 503,
            message: String::new()
        }
        .retryable());

        assert!(!AgentError::Provider {
            status: 401,
            message: String::new()
        }
        .retryable());
        assert!(!AgentError::Provider {
            status: 400,
            message: String::new()
        }
        .retryable());
        assert!(!AgentError::Cancelled.retryable());
        assert!(!AgentError::NotConfigured("no key".into()).retryable());
    }
}
