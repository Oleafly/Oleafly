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
    pub fn kind(&self) -> &'static str {
        match self {
            AgentError::NotConfigured(_) => "not_configured",
            AgentError::Transport(_) => "transport",
            AgentError::Provider { status, .. } if *status == 401 || *status == 403 => "auth",
            AgentError::Provider { .. } => "provider",
            AgentError::Decode(_) => "decode",
            AgentError::Cancelled => "cancelled",
            AgentError::Timeout => "timeout",
        }
    }

    pub fn status(&self) -> Option<u16> {
        match self {
            AgentError::Provider { status, .. } => Some(*status),
            _ => None,
        }
    }

    pub fn retryable(&self) -> bool {
        match self {
            AgentError::Transport(_) | AgentError::Timeout => true,
            AgentError::Provider { status, .. } => *status == 429 || *status >= 500,
            AgentError::NotConfigured(_) | AgentError::Decode(_) | AgentError::Cancelled => false,
        }
    }

    /// A provider rejection that means the prompt exceeded the model's actual
    /// context window. The turn loop treats this as a signal to compact and
    /// retry, honoring the real deployed window rather than a static estimate.
    pub fn is_context_overflow(&self) -> bool {
        let AgentError::Provider { status, message } = self else {
            return false;
        };
        // Providers report an oversized prompt as 400 (most) or 413 (payload).
        if *status != 400 && *status != 413 {
            return false;
        }
        let message = message.to_ascii_lowercase();
        const MARKERS: [&str; 7] = [
            "context length",
            "context window",
            "context_length_exceeded",
            "maximum context",
            "too many tokens",
            "reduce the length",
            "prompt is too long",
        ];
        MARKERS.iter().any(|marker| message.contains(marker))
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
    fn a_rejected_credential_is_classified_without_reading_the_message() {
        let err = AgentError::Provider {
            status: 401,
            message: "Incorrect API key".into(),
        };
        assert_eq!(err.kind(), "auth");
        assert_eq!(err.status(), Some(401));

        let err = AgentError::Provider {
            status: 500,
            message: "boom".into(),
        };
        assert_eq!(err.kind(), "provider");
    }

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
