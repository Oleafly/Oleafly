pub mod caps;
pub mod complete;
pub mod effort;
pub mod error;
pub mod event;
// The typed item record; consumed by the rollout store and the shell.
#[allow(dead_code)]
pub mod items;
pub mod message;
pub mod models;
pub mod pricing;
pub mod provider;
pub mod run;
pub mod session;
pub mod sse;
pub mod stream;
pub mod tasks;
pub mod tool;
pub mod tools;
pub mod wire;

pub use caps::{BudgetRange, ModelCaps, ReasoningCaps, MAX_AGENT_DOCUMENTS, MAX_RUN_START_IMAGES};
pub use complete::{
    complete, CompletionRequest, CompletionResponse, InputTokenSemantics, Usage, WebTools,
};
pub use effort::{clamp_effort, effective_effort, effort_choices, Effort};
pub use error::{AgentError, Result};
pub use event::AgentEvent;
pub use message::{ContentPart, Message, ProviderWire, Role, SUPPORTED_IMAGE_TYPES};
pub use models::{list_models, ModelInfo};
pub use provider::{resolve, CustomProvider, ProviderConfig, Resolved, Wire};
pub use run::{
    bound_tool_output, run_agent, run_agent_with_pipeline, validate_completion_request, RunConfig,
    RunOutcome, SteerHandle, ToolOutput, ToolPipeline, ToolRunner,
};
pub use session::turn::assistant_message;
pub use stream::{
    is_output_limit_stop, is_refusal_stop, stream_completion, StreamOutcome, ToolCall,
};
pub use tasks::CancellationToken;
pub use tool::ToolSchema;
pub use tools::orchestrator::{
    classification_from_policy, ApprovalRequirement, PolicyDecision, ToolOrchestrator, ToolRisk,
};
pub use tools::parallel::ToolGate;
pub use tools::registry::{ParallelPolicy, RegisteredTool, ToolExposure, ToolRegistry};
pub use wire::server_tools::{native_web, NativeWeb};

use std::time::Duration;

pub fn build_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .user_agent(concat!("oleafly/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| AgentError::Transport(format!("HTTP client setup failed: {error}")))
}
