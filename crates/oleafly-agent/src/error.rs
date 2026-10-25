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
        const MARKERS: [&str; 14] = [
            "context length",
            "context window",
            "context_length_exceeded",
            "maximum context",
            "too many tokens",
            "reduce the length",
            "prompt is too long",
            // Anthropic, when input and max_tokens together pass the window.
            "context limit",
            // Gemini, xAI and llama.cpp.
            "maximum number of tokens",
            "maximum prompt length",
            "context size",
            // Anthropic's 413 for a request over its byte limit.
            "request_too_large",
            "maximum allowed number of bytes",
            "request too large",
        ];
        MARKERS.iter().any(|marker| message.contains(marker))
    }
}

/// A limit Oleafly sets itself, reported as a decode error. It reads as
/// such, not as something the provider sent.
fn is_local_limit(message: &str) -> bool {
    message.contains("safety limit")
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
            AgentError::Decode(m) if is_local_limit(m) => {
                write!(f, "The run reached one of Oleafly's limits. {m}")
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
    fn every_providers_wording_for_an_oversized_prompt_is_an_overflow() {
        for (status, message) in [
            (400, "input length and `max_tokens` exceed context limit: 136000 + 64000 > 200000"),
            (400, "The input token count exceeds the maximum number of tokens allowed (1048576)."),
            (400, "This model's maximum prompt length is 131072 but the request contains 140000 tokens."),
            (400, "the request exceeds the available context size, try increasing it"),
            (413, "{\"type\":\"request_too_large\",\"message\":\"Request exceeds the maximum allowed number of bytes.\"}"),
        ] {
            assert!(
                AgentError::provider(status, message).is_context_overflow(),
                "{message}"
            );
        }
        assert!(!AgentError::provider(400, "invalid model id").is_context_overflow());
    }

    #[test]
    fn a_local_limit_does_not_read_as_a_provider_error() {
        let local = AgentError::Decode("agent message count exceeded its safety limit".into());
        assert!(local
            .to_string()
            .starts_with("The run reached one of Oleafly's limits."));
        let provider = AgentError::Decode("response carried no choices".into());
        assert!(provider
            .to_string()
            .starts_with("Unexpected response from the provider."));
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
