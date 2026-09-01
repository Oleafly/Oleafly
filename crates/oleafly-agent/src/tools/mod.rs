//! Tool registry, router policy, and the parallel execution pipeline.
//!
//! Execution model (mirroring the desktop agent core): tool calls from one
//! model response run concurrently, but their results feed back in call
//! order. A single read-write gate serializes exclusive (mutating) tools
//! against everything else: parallel-safe tools hold a read lock, exclusive
//! tools hold the write lock.

pub mod orchestrator;
pub mod parallel;
pub mod registry;

pub use orchestrator::{
    classification_from_policy, ApprovalRequirement, PolicyDecision, ToolOrchestrator, ToolRisk,
};
pub use parallel::{run_tool_calls, ToolGate};
pub use registry::{ParallelPolicy, RegisteredTool, ToolExposure, ToolRegistry};
