//! Research tasks for Oleafly, without Tauri: the task store, workspace
//! isolation, the queue, the built-in task agent and its tools, the research
//! MCP bridge, literature search and citation lookups.
//!
//! The desktop app hosts this runtime while it is open; the background
//! daemon hosts it after the app quits. Each host implements the ports in
//! [`host`].
pub mod aliases;
pub mod approvals;
pub mod budget;
pub mod builtin;
pub mod citation;
// 0.4.8 L: conversations saved across a handoff, and handoff records.
pub mod conversation;
pub mod evidence;
pub mod handoff;
pub mod host;
pub mod isolation;
pub mod keep_awake;
pub mod literature;
pub mod mcp;
pub mod model;
pub mod progress;
pub mod prompt;
pub mod record;
mod recorder;
pub mod runs;
pub mod scheduler;
pub mod similarity;
pub mod store;
pub mod task_tools;
#[cfg(any(test, feature = "test-support"))]
pub mod test_support;

pub use oleafly_sandbox::profile::RunProfile;
pub use scheduler::{
    ResearchTaskState, TaskEventSink, TaskRuntimeAdapter, TaskRuntimeFuture, TaskServices,
    NOT_ATTACHED,
};
