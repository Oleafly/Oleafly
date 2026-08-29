//! ~/.oleafly/agent.toml — the multi-agent configuration surface, key-for-key
//! compatible with the audited core's subagent settings: depth and
//! concurrency gates, wait-timeout bounds, and operator-tunable prompt
//! fragments (the delegation guidance is config text, not baked code).

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const DEFAULT_USAGE_HINT: &str = "You can use spawn_agent to create a new \
subagent that inherits your current model by default; do not set the model \
field unless the user explicitly asks for a different one. Task names are \
canonical: spawning task_3 under your task /root/task1 creates \
/root/task1/task_3, and list_agents filters by that path. When calling \
wait_agent, prefer longer waits (minutes) over busy polling; it returns as \
soon as any listed agent finishes. Completed agents stay open and count \
toward the concurrency limit until close_agent, so close agents when their \
work is done. Spawning subagents increases usage quickly; parallelize only \
truly independent work and do the work yourself when steps depend on each \
other.";

pub const DEFAULT_SUBAGENT_INSTRUCTIONS: &str = "You are a focused subagent \
working one delegated task inside the same project. Stay inside your task's \
scope, report a complete final answer, and do not spawn further agents.";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MultiAgentConfig {
    /// How deep agents may nest (2 = a run's children may not delegate).
    #[serde(alias = "max_agent_depth")]
    pub max_agent_depth: u32,
    /// Concurrent running agents per session, audited default 8.
    #[serde(alias = "max_concurrent_subagents")]
    pub max_concurrent_subagents: usize,
    #[serde(alias = "min_wait_timeout_ms")]
    pub min_wait_timeout_ms: u64,
    #[serde(alias = "max_wait_timeout_ms")]
    pub max_wait_timeout_ms: u64,
    #[serde(alias = "default_wait_timeout_ms")]
    pub default_wait_timeout_ms: u64,
    #[serde(alias = "wait_agent_enabled")]
    pub wait_agent_enabled: bool,
    /// Delegation guidance injected into the parent's system prompt.
    #[serde(alias = "usage_hint_text")]
    pub usage_hint_text: String,
    /// Developer instructions appended to every child's system prompt.
    #[serde(alias = "subagent_developer_instructions")]
    pub subagent_developer_instructions: String,
}

impl Default for MultiAgentConfig {
    fn default() -> Self {
        Self {
            max_agent_depth: 2,
            max_concurrent_subagents: 8,
            min_wait_timeout_ms: 1_000,
            max_wait_timeout_ms: 300_000,
            default_wait_timeout_ms: 120_000,
            wait_agent_enabled: true,
            usage_hint_text: DEFAULT_USAGE_HINT.to_string(),
            subagent_developer_instructions: DEFAULT_SUBAGENT_INSTRUCTIONS.to_string(),
        }
    }
}

impl MultiAgentConfig {
    /// Enforce the audited invariants: wait bounds ordered and positive.
    pub fn sanitized(self) -> Self {
        let mut config = self;
        if config.max_agent_depth == 0 {
            config.max_agent_depth = 1;
        }
        if config.max_concurrent_subagents == 0 {
            config.max_concurrent_subagents = 1;
        }
        config.min_wait_timeout_ms = config.min_wait_timeout_ms.max(1);
        if config.max_wait_timeout_ms < config.min_wait_timeout_ms {
            config.max_wait_timeout_ms = config.min_wait_timeout_ms;
        }
        config.default_wait_timeout_ms = config
            .default_wait_timeout_ms
            .clamp(config.min_wait_timeout_ms, config.max_wait_timeout_ms);
        config
    }

    pub fn load(root: &std::path::Path) -> Self {
        let path = root.join("agent.toml");
        let Ok(raw) = std::fs::read_to_string(&path) else {
            return Self::default();
        };
        match toml::from_str::<Self>(&raw) {
            Ok(config) => config.sanitized(),
            Err(error) => {
                crate::logsafe::warning(
                    "agent config ignored",
                    serde_json::json!({ "path": path, "error": error.to_string() }),
                    Value::Null,
                );
                Self::default()
            }
        }
    }
}

#[tauri::command]
pub fn agent_multi_agent_config() -> Result<MultiAgentConfig, String> {
    Ok(MultiAgentConfig::load(&crate::paths::oleafly_root()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> std::path::PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "oleafly-agent-config-{tag}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn defaults_match_the_audited_surface() {
        let config = MultiAgentConfig::default();
        assert_eq!(config.max_agent_depth, 2);
        assert_eq!(config.max_concurrent_subagents, 8);
        assert!(config.wait_agent_enabled);
        assert!(config.usage_hint_text.contains("wait_agent"));
        assert!(config.usage_hint_text.contains("close_agent"));
    }

    #[test]
    fn sanitized_enforces_wait_bound_ordering() {
        let config = MultiAgentConfig {
            min_wait_timeout_ms: 500,
            max_wait_timeout_ms: 100,
            default_wait_timeout_ms: 90_000,
            ..MultiAgentConfig::default()
        }
        .sanitized();
        assert!(config.min_wait_timeout_ms <= config.default_wait_timeout_ms);
        assert!(config.default_wait_timeout_ms <= config.max_wait_timeout_ms);
    }

    #[test]
    fn a_missing_or_corrupt_file_falls_back_to_defaults() {
        let root = temp_root("missing");
        assert_eq!(
            MultiAgentConfig::load(&root).max_concurrent_subagents,
            MultiAgentConfig::default().max_concurrent_subagents
        );

        std::fs::write(root.join("agent.toml"), "not [ valid toml").unwrap();
        assert_eq!(
            MultiAgentConfig::load(&root).max_agent_depth,
            MultiAgentConfig::default().max_agent_depth
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_valid_file_overrides_the_defaults() {
        let root = temp_root("valid");
        std::fs::write(
            root.join("agent.toml"),
            "max_agent_depth = 3\nmax_concurrent_subagents = 4\n",
        )
        .unwrap();
        let config = MultiAgentConfig::load(&root);
        assert_eq!(config.max_agent_depth, 3);
        assert_eq!(config.max_concurrent_subagents, 4);
        let _ = std::fs::remove_dir_all(&root);
    }
}
