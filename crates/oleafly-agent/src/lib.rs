pub mod complete;
pub mod error;
pub mod event;
// The typed item record; consumed by the rollout store and the shell.
#[allow(dead_code)]
pub mod items;
pub mod message;
pub mod models;
pub mod provider;
pub mod run;
pub mod session;
pub mod sse;
pub mod stream;
pub mod tasks;
pub mod tool;
pub mod tools;
pub mod wire;

pub use complete::{complete, CompletionRequest, CompletionResponse, Usage};
pub use error::{AgentError, Result};
pub use event::AgentEvent;
pub use message::{ContentPart, Message, Role};
pub use models::{list_models, ModelInfo};
pub use provider::{resolve, CustomProvider, ProviderConfig, Resolved, Wire};
pub use run::{
    bound_tool_output, run_agent, run_agent_with_pipeline, validate_completion_request, RunConfig,
    RunOutcome, SteerHandle, ToolOutput, ToolPipeline, ToolRunner,
};
pub use stream::{stream_completion, StreamOutcome, ToolCall};
pub use tasks::CancellationToken;
pub use tool::ToolSchema;
pub use tools::orchestrator::{
    classification_from_policy, ApprovalRequirement, PolicyDecision, ToolOrchestrator, ToolRisk,
};
pub use tools::parallel::ToolGate;
pub use tools::registry::{ParallelPolicy, RegisteredTool, ToolExposure, ToolRegistry};

use std::time::Duration;

pub fn build_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .user_agent(concat!("oleafly/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| AgentError::Transport(format!("HTTP client setup failed: {error}")))
}
