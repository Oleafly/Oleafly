//! `oleafly mcp`: an MCP server for the project on stdio, either on its own
//! (the tools in `tools.rs`) or bridged to the running app's server.
pub mod bridge;
pub mod clients;
pub(crate) mod server;
pub mod tools;

pub use oleafly_research::mcp::protocol::{ToolAnnotations, ToolMeta};
pub use tools::{McpToolSet, ToolContext, ToolError, ToolLimits};
