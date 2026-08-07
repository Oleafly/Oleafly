use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentError {
    NotConfigured(String),
    Transport(String),
    Provider { status: u16, message: String },
    Decode(String),
    Cancelled,
    Timeout,
}

impl AgentError {
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
