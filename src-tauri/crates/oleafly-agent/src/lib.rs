//! LLM provider clients for Oleafly.
//!
//! This crate owns everything between "the user has a provider configured" and
//! "here is the model's reply". It knows nothing about Tauri, the webview, or
//! the project on disk, so the desktop app and the CLI can both drive it.
//!
//! Three wire formats cover the whole provider catalog: OpenAI-compatible
//! chat completions, Anthropic messages, and Google generateContent. Adding a
//! provider that speaks one of those is a catalog entry in [`provider`], not
//! new code.
//!
//! Credentials enter here and go no further. Nothing in this crate logs a key,
//! returns one, or writes one to disk, which is what lets the desktop stop
//! handing provider keys to the renderer.

pub mod complete;
pub mod error;
pub mod event;
pub mod message;
pub mod provider;
pub mod run;
pub mod sse;
pub mod stream;
pub mod tool;

pub use complete::{complete, CompletionRequest, CompletionResponse, Usage};
pub use error::{AgentError, Result};
pub use event::AgentEvent;
pub use message::{ContentPart, Message, Role};
pub use provider::{resolve, CustomProvider, ProviderConfig, Resolved, Wire};
pub use run::{run_agent, RunConfig, RunOutcome, ToolOutput, ToolRunner};
pub use stream::{stream_completion, StreamOutcome, ToolCall};
pub use tool::ToolSchema;

use std::time::Duration;

/// Build the HTTP client used for provider calls.
///
/// One client is meant to be created once and shared: it owns the connection
/// pool, and a fresh client per request would pay a new TLS handshake every
/// time. No global timeout is set here because each request carries its own.
pub fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .user_agent(concat!("oleafly/", env!("CARGO_PKG_VERSION")))
        .build()
        .unwrap_or_default()
}
