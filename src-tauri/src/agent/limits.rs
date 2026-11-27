use std::sync::Arc;

use oleafly_agent::{RunConfig, TokenBudget};
use serde::{Deserialize, Serialize};

use crate::config::AppConfig;

pub const MAX_TURN_STEPS: u32 = 2_000;
pub const MIN_OUTPUT_TOKENS: u32 = 1_024;
pub const MAX_OUTPUT_TOKENS: u32 = 1_048_576;
pub const MIN_TURN_TOKENS: u64 = 1_000;
pub const MAX_TURN_TOKENS: u64 = 100_000_000;
const LONG_TURN_DURATION_MS: u64 = 8 * 60 * 60 * 1_000;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentLimits {
    pub max_steps: Option<u32>,
    pub max_output_tokens: Option<u32>,
    pub turn_tokens: Option<u64>,
}

impl AgentLimits {
    pub fn stored(config: &AppConfig) -> Self {
        Self {
            max_steps: config
                .ai_agent_max_steps
                .map(|steps| steps.clamp(1, MAX_TURN_STEPS)),
            max_output_tokens: config
                .ai_agent_max_output_tokens
                .map(|tokens| tokens.clamp(MIN_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS)),
            turn_tokens: config
                .ai_agent_turn_tokens
                .map(|tokens| tokens.clamp(MIN_TURN_TOKENS, MAX_TURN_TOKENS)),
        }
    }

    fn validated(self) -> Result<Self, String> {
        let in_range = self
            .max_steps
            .is_none_or(|steps| (1..=MAX_TURN_STEPS).contains(&steps))
            && self
                .max_output_tokens
                .is_none_or(|tokens| (MIN_OUTPUT_TOKENS..=MAX_OUTPUT_TOKENS).contains(&tokens))
            && self
                .turn_tokens
                .is_none_or(|tokens| (MIN_TURN_TOKENS..=MAX_TURN_TOKENS).contains(&tokens));
        if in_range {
            Ok(self)
        } else {
            Err("A turn limit is outside the range Settings allows.".into())
        }
    }

    fn store(self, config: &mut AppConfig) {
        config.ai_agent_max_steps = self.max_steps;
        config.ai_agent_max_output_tokens = self.max_output_tokens;
        config.ai_agent_turn_tokens = self.turn_tokens;
    }

    pub fn turn_config(self, mut config: RunConfig) -> RunConfig {
        if let Some(steps) = self.max_steps {
            config.max_steps = steps;
            config.allow_long_runs = steps > super::MAX_RUN_STEPS;
            if config.allow_long_runs {
                config.max_duration_ms = Some(LONG_TURN_DURATION_MS);
            }
        }
        config
    }

    pub fn token_budget(self) -> Option<Arc<TokenBudget>> {
        self.turn_tokens
            .map(|tokens| Arc::new(TokenBudget::new(tokens)))
    }
}

#[tauri::command]
pub async fn agent_limits_get() -> Result<AgentLimits, String> {
    tauri::async_runtime::spawn_blocking(|| {
        crate::config::read_config().map(|config| AgentLimits::stored(&config))
    })
    .await
    .map_err(|error| format!("configuration worker failed: {error}"))?
}

#[tauri::command]
pub async fn agent_limits_set(limits: AgentLimits) -> Result<AgentLimits, String> {
    let limits = limits.validated()?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::config::update_config(|config| {
            limits.store(config);
            Ok(())
        })
    })
    .await
    .map_err(|error| format!("configuration worker failed: {error}"))??;
    Ok(limits)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored(steps: Option<u32>, output: Option<u32>, turn: Option<u64>) -> AgentLimits {
        AgentLimits::stored(&AppConfig {
            ai_agent_max_steps: steps,
            ai_agent_max_output_tokens: output,
            ai_agent_turn_tokens: turn,
            ..AppConfig::default()
        })
    }

    #[test]
    fn blank_limits_keep_the_turn_as_it_was() {
        let limits = stored(None, None, None);
        let base = RunConfig::default();
        let turn = limits.turn_config(base.clone());
        assert_eq!(turn.max_steps, base.max_steps);
        assert!(!turn.allow_long_runs);
        assert_eq!(turn.max_duration_ms, None);
        assert!(limits.token_budget().is_none());
    }

    #[test]
    fn more_than_fifty_steps_makes_a_long_turn() {
        let turn = stored(Some(500), None, None).turn_config(RunConfig::default());
        assert_eq!(turn.max_steps, 500);
        assert!(turn.allow_long_runs);
        assert_eq!(turn.max_duration_ms, Some(LONG_TURN_DURATION_MS));
        let short = stored(Some(20), None, None).turn_config(RunConfig::default());
        assert_eq!(short.max_steps, 20);
        assert!(!short.allow_long_runs);
        assert_eq!(short.max_duration_ms, None);
    }

    #[test]
    fn a_hand_edited_config_is_pulled_back_into_range() {
        let limits = stored(Some(0), Some(1), Some(u64::MAX));
        assert_eq!(limits.max_steps, Some(1));
        assert_eq!(limits.max_output_tokens, Some(MIN_OUTPUT_TOKENS));
        assert_eq!(limits.turn_tokens, Some(MAX_TURN_TOKENS));
        let high = stored(Some(u32::MAX), Some(u32::MAX), Some(0));
        assert_eq!(high.max_steps, Some(MAX_TURN_STEPS));
        assert_eq!(high.max_output_tokens, Some(MAX_OUTPUT_TOKENS));
        assert_eq!(high.turn_tokens, Some(MIN_TURN_TOKENS));
    }

    #[test]
    fn saving_rejects_a_limit_out_of_range() {
        let limits = |steps, output, turn| AgentLimits {
            max_steps: steps,
            max_output_tokens: output,
            turn_tokens: turn,
        };
        assert!(limits(Some(2_000), Some(1_024), Some(1_000))
            .validated()
            .is_ok());
        assert!(limits(None, None, None).validated().is_ok());
        assert!(limits(Some(0), None, None).validated().is_err());
        assert!(limits(Some(2_001), None, None).validated().is_err());
        assert!(limits(None, Some(1_023), None).validated().is_err());
        assert!(limits(None, None, Some(MAX_TURN_TOKENS + 1))
            .validated()
            .is_err());
    }

    #[test]
    fn the_token_budget_starts_empty_for_each_turn() {
        let budget = stored(None, None, Some(5_000)).token_budget().unwrap();
        assert_eq!(budget.used(), 0);
        assert!(!budget.reached());
    }
}
