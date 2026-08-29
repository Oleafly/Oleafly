//! Tool registry: per-tool execution policy (parallel vs exclusive) and
//! model exposure. Unknown tools default to the exclusive policy so new or
//! foreign tools never run concurrently by accident.

use std::collections::BTreeMap;

use crate::error::{AgentError, Result};
use crate::stream::MAX_STREAM_TOOL_CALLS;

/// Names reserved for the built-in shell tools; external registrations
/// cannot shadow them.
pub const RESERVED_TOOL_NAMES: [&str; 2] = ["exec_command", "shell_command"];

/// Aggregate ceiling for one batch of tool results entering history.
pub const MAX_TOOL_RESULT_BATCH_BYTES: usize = 96 * 1024 * 1024;

pub fn validate_tool_calls_per_turn(calls: usize) -> Result<()> {
    if calls > MAX_STREAM_TOOL_CALLS {
        Err(AgentError::Decode(
            "tool calls in one turn exceeded its safety limit".into(),
        ))
    } else {
        Ok(())
    }
}

/// Accumulate one tool result's payload size against an aggregate ceiling.
pub fn add_tool_batch_bytes(total: &mut usize, bytes: usize, limit: usize) -> Result<()> {
    let next = total
        .checked_add(bytes)
        .filter(|next| *next <= limit)
        .ok_or_else(|| AgentError::Decode("tool result batch exceeded its safety limit".into()))?;
    *total = next;
    Ok(())
}

/// Whether a tool's model-visible surface is exposed directly, deferred
/// behind tool search, or restricted to direct model calls only.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolExposure {
    Direct,
    Deferred,
    DirectModelOnly,
}

/// Whether a tool may run concurrently with others.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum ParallelPolicy {
    /// Read-class tool: shares the gate's read side with every other
    /// parallel tool.
    Parallel,
    /// Mutating tool: takes the gate's write side, excluding all others.
    #[default]
    Exclusive,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RegisteredTool {
    pub exposure: ToolExposure,
    pub parallel: ParallelPolicy,
}

impl RegisteredTool {
    pub fn parallel() -> Self {
        Self {
            exposure: ToolExposure::Direct,
            parallel: ParallelPolicy::Parallel,
        }
    }

    pub fn exclusive() -> Self {
        Self {
            exposure: ToolExposure::Direct,
            parallel: ParallelPolicy::Exclusive,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct ToolRegistry {
    tools: BTreeMap<String, RegisteredTool>,
    first_collisions: Vec<String>,
    error_on_collision: bool,
}

impl ToolRegistry {
    pub fn new(error_on_collision: bool) -> Self {
        Self {
            tools: BTreeMap::new(),
            first_collisions: Vec::new(),
            error_on_collision,
        }
    }

    /// Register a host-owned tool. Trusted registrations win collisions
    /// silently (the host's policy is authoritative); the displaced name is
    /// recorded in the collision ledger.
    pub fn register_trusted(&mut self, name: &str, tool: RegisteredTool) {
        self.insert(name.to_string(), tool);
    }

    /// Register a host-owned tool at the front of the model-visible order
    /// (placeholder for ordered exposure; the map keeps alphabetical keys).
    pub fn prepend_trusted(&mut self, name: &str, tool: RegisteredTool) {
        self.register_trusted(name, tool);
    }

    /// Register a plugin/MCP tool. External tools never overwrite an
    /// existing registration; with `error_on_collision` set, a collision is
    /// an error the caller surfaces.
    pub fn register_external(
        &mut self,
        name: &str,
        tool: RegisteredTool,
    ) -> std::result::Result<(), String> {
        if RESERVED_TOOL_NAMES.contains(&name) {
            return Err(format!("{name} is a reserved tool name"));
        }
        if self.tools.contains_key(name) {
            self.note_collision(name);
            if self.error_on_collision {
                return Err(format!("{name} is already registered"));
            }
            return Ok(());
        }
        self.insert(name.to_string(), tool);
        Ok(())
    }

    fn insert(&mut self, name: String, tool: RegisteredTool) {
        if self.tools.insert(name.clone(), tool).is_some() {
            self.note_collision(&name);
        }
    }

    fn note_collision(&mut self, name: &str) {
        if !self
            .first_collisions
            .iter()
            .any(|existing| existing == name)
        {
            self.first_collisions.push(name.to_string());
        }
    }

    /// Execution policy for a call. Unknown tools are exclusive.
    pub fn parallel_policy(&self, name: &str) -> ParallelPolicy {
        self.tools
            .get(name)
            .map(|tool| tool.parallel)
            .unwrap_or_default()
    }

    pub fn exposure(&self, name: &str) -> Option<ToolExposure> {
        self.tools.get(name).map(|tool| tool.exposure)
    }

    pub fn contains(&self, name: &str) -> bool {
        self.tools.contains_key(name)
    }

    pub fn len(&self) -> usize {
        self.tools.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }

    pub fn names(&self) -> Vec<String> {
        self.tools.keys().cloned().collect()
    }

    /// First registration that displaced (or was displaced by) another tool
    /// of the same name — the `first_collision` ledger of the desktop core.
    pub fn first_collisions(&self) -> &[String] {
        &self.first_collisions
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_tools_default_to_exclusive() {
        let registry = ToolRegistry::default();
        assert_eq!(
            registry.parallel_policy("anything"),
            ParallelPolicy::Exclusive
        );
        assert_eq!(registry.exposure("anything"), None);
    }

    #[test]
    fn trusted_registrations_overwrite_and_ledger_the_collision() {
        let mut registry = ToolRegistry::default();
        registry.register_trusted("read_file", RegisteredTool::parallel());
        registry.register_trusted("read_file", RegisteredTool::exclusive());
        assert_eq!(
            registry.parallel_policy("read_file"),
            ParallelPolicy::Exclusive
        );
        assert_eq!(registry.first_collisions(), ["read_file"]);
    }

    #[test]
    fn external_registrations_never_displace_existing_tools() {
        let mut registry = ToolRegistry::default();
        registry.register_trusted("read_file", RegisteredTool::parallel());
        assert!(registry
            .register_external("read_file", RegisteredTool::exclusive())
            .is_ok());
        assert_eq!(
            registry.parallel_policy("read_file"),
            ParallelPolicy::Parallel
        );

        let mut strict = ToolRegistry::new(true);
        assert!(strict
            .register_external("read_file", RegisteredTool::exclusive())
            .is_ok());
        assert_eq!(
            strict.register_external("read_file", RegisteredTool::exclusive()),
            Err("read_file is already registered".to_string())
        );
    }

    #[test]
    fn reserved_names_reject_external_registration() {
        let mut registry = ToolRegistry::default();
        assert_eq!(
            registry.register_external("exec_command", RegisteredTool::exclusive()),
            Err("exec_command is a reserved tool name".to_string())
        );
    }

    #[test]
    fn collision_ledger_records_each_name_once() {
        let mut registry = ToolRegistry::default();
        registry.register_trusted("t", RegisteredTool::parallel());
        registry.register_trusted("t", RegisteredTool::exclusive());
        registry.register_trusted("t", RegisteredTool::parallel());
        assert_eq!(registry.first_collisions(), ["t"]);
    }

    #[test]
    fn tool_result_batches_have_an_aggregate_ceiling() {
        let mut bytes = 0;
        add_tool_batch_bytes(&mut bytes, 5, 8).unwrap();
        let error = add_tool_batch_bytes(&mut bytes, 4, 8).unwrap_err();

        assert!(matches!(error, AgentError::Decode(_)));
        assert!(!error.retryable());
        assert_eq!(bytes, 5);
    }
}
