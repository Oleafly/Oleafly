pub mod complete;
pub mod error;
pub mod event;
pub mod message;
pub mod models;
pub mod provider;
pub mod run;
pub mod sse;
pub mod stream;
pub mod tool;
pub mod wire;

pub use complete::{complete, CompletionRequest, CompletionResponse, Usage};
pub use error::{AgentError, Result};
pub use event::AgentEvent;
pub use message::{ContentPart, Message, Role};
pub use models::{list_models, ModelInfo};
pub use provider::{resolve, CustomProvider, ProviderConfig, Resolved, Wire};
pub use run::{run_agent, RunConfig, RunOutcome, ToolOutput, ToolRunner};
pub use stream::{stream_completion, StreamOutcome, ToolCall};
pub use tool::ToolSchema;

use std::time::Duration;

pub fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .user_agent(concat!("oleafly/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("the TLS backend failed to initialise, so no provider is reachable")
}
