//! Per-wire effort, thinking and output-ceiling fragments. Every builder
//! calls `effective_effort` once and hands the result here.
use serde_json::{json, Map, Value};

use crate::caps::{BudgetRange, ModelCaps};
use crate::complete::CompletionRequest;
use crate::effort::{google_budget_model, openai_reasoning_id, Effort};
use crate::provider::Resolved;

pub(crate) const STREAMING_MAX_TOKENS_CAP: u32 = 64_000;
pub(crate) const BLOCKING_MAX_TOKENS_CAP: u32 = 16_000;
pub(crate) const FALLBACK_MAX_TOKENS: u32 = 16_000;

/// The output ceiling a request gets when it sets none: the model's own
/// limit, else a conservative default, never above `cap`.
pub(crate) fn default_max_tokens(caps: &ModelCaps, cap: u32) -> u32 {
    caps.output_limit
        .filter(|limit| *limit > 0)
        .unwrap_or(FALLBACK_MAX_TOKENS)
        .min(cap)
}

/// A Claude model id as `(family, major, minor)`: `claude-opus-4-6` is
/// `("opus", 4, 6)`; a date suffix (`claude-sonnet-4-20250514`) reads as
/// minor 0. Older `claude-3-…` ids have no family word and return `None`.
pub(crate) fn claude_version(model_id: &str) -> Option<(String, u32, u32)> {
    let id = model_id.to_ascii_lowercase();
    let at = id.find("claude-")?;
    let mut parts = id[at + "claude-".len()..].split('-');
    let family = parts.next()?;
    if family.is_empty() || !family.bytes().all(|byte| byte.is_ascii_alphabetic()) {
        return None;
    }
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = parts
        .next()
        .filter(|part| part.len() <= 2)
        .and_then(|part| part.parse::<u32>().ok())
        .unwrap_or(0);
    Some((family.to_string(), major, minor))
}

fn named_family(model_id: &str) -> bool {
    let id = model_id.to_ascii_lowercase();
    id.contains("claude-fable-") || id.contains("claude-mythos-")
}

/// The default output ceiling for Claude models that check it against the
/// window (see `anthropic_checks_output_room`).
pub(crate) const OUTPUT_ROOM_MAX_TOKENS: u32 = 16_000;

/// Claude models before 4.5 refuse a request whose input and `max_tokens`
/// together pass the context window; later ones stop at the window instead.
pub(crate) fn anthropic_checks_output_room(model_id: &str) -> bool {
    if named_family(model_id) {
        return false;
    }
    match claude_version(model_id) {
        Some((_, major, minor)) => (major, minor) < (4, 5),
        None => {
            let id = model_id.to_ascii_lowercase();
            ["claude-3", "claude-2", "claude-instant"]
                .iter()
                .any(|old| id.contains(old))
        }
    }
}

/// Claude models that think unless told not to: 5.x, Fable and Mythos.
pub(crate) fn anthropic_thinks_by_default(model_id: &str) -> bool {
    named_family(model_id) || matches!(claude_version(model_id), Some((_, major, _)) if major >= 5)
}

/// Claude models with adaptive thinking: Opus and Sonnet 4.6 on, every 5.x,
/// Fable and Mythos.
pub(crate) fn anthropic_adaptive_model(model_id: &str) -> bool {
    if anthropic_thinks_by_default(model_id) {
        return true;
    }
    matches!(
        claude_version(model_id),
        Some((family, 4, minor)) if (family == "opus" || family == "sonnet") && minor >= 6
    )
}

/// The Anthropic `thinking` object, or `None` to leave it out.
pub(crate) fn anthropic_thinking(
    resolved: &Resolved,
    req: &CompletionRequest,
    effort: Option<Effort>,
    replays_thinking: bool,
) -> Option<Value> {
    if effort == Some(Effort::Off) {
        return Some(json!({ "type": "disabled" }));
    }
    let model = &resolved.model_id;
    let on =
        anthropic_adaptive_model(model) && (anthropic_thinks_by_default(model) || effort.is_some());
    if !on {
        return None;
    }
    let mut thinking = json!({ "type": "adaptive" });
    if req.reasoning_summary == Some(true) {
        thinking["display"] = json!("summarized");
    }
    if replays_thinking {
        // Earlier thinking that no longer matches its prefix is dropped
        // instead of failing the request.
        thinking["block_binding"] = json!({ "prefix_mismatch_behavior": "drop_block" });
    }
    Some(thinking)
}

fn responses_reasoning_model(resolved: &Resolved) -> bool {
    let reasoning = &resolved.caps.reasoning;
    reasoning.flag == Some(true)
        || reasoning
            .efforts
            .as_ref()
            .is_some_and(|efforts| !efforts.is_empty())
        || (reasoning.flag.is_none()
            && reasoning.efforts.is_none()
            && openai_reasoning_id(&resolved.model_id.to_ascii_lowercase()))
}

/// The Responses `reasoning` object for reasoning models.
pub(crate) fn responses_reasoning(
    resolved: &Resolved,
    req: &CompletionRequest,
    effort: Option<Effort>,
    web_search: bool,
) -> Option<Value> {
    if !responses_reasoning_model(resolved) {
        return None;
    }
    let mut reasoning = Map::new();
    if let Some(effort) = effort {
        // Hosted web search refuses minimal effort.
        let effort = if web_search && effort == Effort::Minimal {
            Effort::Low
        } else {
            effort
        };
        reasoning.insert("effort".into(), json!(effort.as_str()));
    }
    // Only on request: OpenAI refuses summaries for organizations it hasn't
    // verified, which would fail every request.
    if req.reasoning_summary == Some(true) {
        reasoning.insert("summary".into(), json!("auto"));
    }
    (!reasoning.is_empty()).then_some(Value::Object(reasoning))
}

/// Extra body fields for OpenAI-compatible chat providers.
pub(crate) fn chat_reasoning_fields(
    resolved: &Resolved,
    req: &CompletionRequest,
    effort: Option<Effort>,
) -> Vec<(&'static str, Value)> {
    match resolved.provider_id.as_str() {
        "xai" | "groq" | "ollama" => effort
            .map(|effort| vec![("reasoning_effort", json!(effort.as_str()))])
            .unwrap_or_default(),
        "openrouter" => {
            let mut reasoning = Map::new();
            if let Some(effort) = effort {
                reasoning.insert("effort".into(), json!(effort.as_str()));
            }
            if req.reasoning_summary == Some(false) {
                reasoning.insert("exclude".into(), json!(true));
            }
            if reasoning.is_empty() {
                Vec::new()
            } else {
                vec![("reasoning", Value::Object(reasoning))]
            }
        }
        _ => Vec::new(),
    }
}

/// Gemini's `thinkingBudget` for an effort: off is 0, low a small budget,
/// medium 8k, high the model's maximum.
pub(crate) fn google_thinking_budget(effort: Effort, budget: Option<BudgetRange>) -> u32 {
    let min = budget.and_then(|range| range.min);
    let max = budget.and_then(|range| range.max);
    let raw = match effort {
        Effort::Off => 0,
        Effort::Minimal | Effort::Low => 1_024u32.max(min.unwrap_or(0)),
        Effort::Medium => 8_192,
        Effort::High | Effort::Xhigh | Effort::Max => max.unwrap_or(24_576),
    };
    let floored = min.map_or(raw, |min| raw.max(min));
    max.map_or(floored, |max| floored.min(max))
}

/// Gemini's `thinkingConfig`: a budget for 2.5 models, a level for later
/// ones, never both.
pub(crate) fn google_thinking_config(
    resolved: &Resolved,
    req: &CompletionRequest,
    effort: Option<Effort>,
) -> Option<Value> {
    let model = resolved.model_id.to_ascii_lowercase();
    if !model.starts_with("gemini-") {
        return None;
    }
    let mut config = json!({ "includeThoughts": req.reasoning_summary != Some(false) });
    if google_budget_model(&model, &resolved.caps) {
        if let Some(effort) = effort {
            config["thinkingBudget"] = json!(google_thinking_budget(
                effort,
                resolved.caps.reasoning.budget
            ));
        }
    } else if let Some(effort) = effort {
        config["thinkingLevel"] = json!(effort.as_str());
    } else if model.starts_with("gemini-4") {
        // Gemini 4 requires a thinking level; medium is its documented default.
        config["thinkingLevel"] = json!("medium");
    }
    Some(config)
}

/// The system prompt with the per-run suffix after it, for wires that take
/// one string.
pub(crate) fn joined_system(req: &CompletionRequest) -> Option<String> {
    let system = req.system.as_deref().filter(|text| !text.is_empty());
    let suffix = req.system_suffix.as_deref().filter(|text| !text.is_empty());
    match (system, suffix) {
        (Some(system), Some(suffix)) => Some(format!("{system}\n\n{suffix}")),
        (Some(text), None) | (None, Some(text)) => Some(text.to_string()),
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_ids_read_their_family_and_version() {
        assert_eq!(
            claude_version("claude-opus-4-6"),
            Some(("opus".into(), 4, 6))
        );
        assert_eq!(
            claude_version("claude-sonnet-4-20250514"),
            Some(("sonnet".into(), 4, 0))
        );
        assert_eq!(claude_version("claude-3-5-haiku-latest"), None);
        assert!(anthropic_thinks_by_default("claude-haiku-5-5"));
        assert!(anthropic_thinks_by_default("claude-fable-5-1"));
        assert!(!anthropic_thinks_by_default("claude-opus-4-8"));
        assert!(anthropic_adaptive_model("claude-opus-4-8"));
        assert!(anthropic_adaptive_model("claude-sonnet-4-6"));
        assert!(!anthropic_adaptive_model("claude-opus-4-5"));
        assert!(!anthropic_adaptive_model("claude-3-7-sonnet-latest"));
    }

    #[test]
    fn gemini_budgets_stay_inside_the_models_range() {
        let flash = Some(BudgetRange {
            min: Some(0),
            max: Some(24_576),
        });
        assert_eq!(google_thinking_budget(Effort::Off, flash), 0);
        assert_eq!(google_thinking_budget(Effort::Low, flash), 1_024);
        assert_eq!(google_thinking_budget(Effort::Max, flash), 24_576);
        let pro = Some(BudgetRange {
            min: Some(128),
            max: Some(32_768),
        });
        assert_eq!(google_thinking_budget(Effort::High, pro), 32_768);
        assert_eq!(google_thinking_budget(Effort::Medium, None), 8_192);
    }

    #[test]
    fn a_zero_output_limit_is_treated_as_unknown() {
        let caps = ModelCaps {
            output_limit: Some(0),
            ..ModelCaps::default()
        };
        assert_eq!(default_max_tokens(&caps, 64_000), FALLBACK_MAX_TOKENS);
    }
}
