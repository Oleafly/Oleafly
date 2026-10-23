use std::fmt;
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentError {
    NotConfigured(String),
    Transport(String),
    Provider {
        status: u16,
        message: String,
        /// How long the provider asked the caller to wait before trying
        /// again (`Retry-After`), when it said.
        retry_after: Option<Duration>,
    },
    Decode(String),
    Cancelled,
    Timeout,
}

impl AgentError {
    /// A provider rejection that carries no wait hint.
    pub fn provider(status: u16, message: impl Into<String>) -> Self {
        AgentError::Provider {
            status,
            message: message.into(),
            retry_after: None,
        }
    }

    /// The wait the provider asked for before another attempt.
    pub fn retry_after(&self) -> Option<Duration> {
        match self {
            AgentError::Provider { retry_after, .. } => *retry_after,
            _ => None,
        }
    }

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
        let AgentError::Provider {
            status, message, ..
        } = self
        else {
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
            AgentError::Provider {
                status, message, ..
            } => {
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
        let err = AgentError::provider(401, "Incorrect API key");
        assert_eq!(err.kind(), "auth");
        assert_eq!(err.status(), Some(401));

        let err = AgentError::provider(500, "boom");
        assert_eq!(err.kind(), "provider");
    }

    #[test]
    fn retryable_covers_transient_failures_only() {
        assert!(AgentError::Timeout.retryable());
        assert!(AgentError::Transport("dns".into()).retryable());
        assert!(AgentError::provider(429, "").retryable());
        assert!(AgentError::provider(503, "").retryable());

        assert!(!AgentError::provider(401, "").retryable());
        assert!(!AgentError::provider(400, "").retryable());
        assert!(!AgentError::Cancelled.retryable());
        assert!(!AgentError::NotConfigured("no key".into()).retryable());
    }

    #[test]
    fn a_provider_error_carries_the_wait_it_asked_for() {
        assert_eq!(AgentError::provider(429, "slow down").retry_after(), None);
        let asked = AgentError::Provider {
            status: 429,
            message: "slow down".into(),
            retry_after: Some(Duration::from_secs(30)),
        };
        assert_eq!(asked.retry_after(), Some(Duration::from_secs(30)));
        assert!(asked.retryable());
        assert_eq!(AgentError::Timeout.retry_after(), None);
    }
}
