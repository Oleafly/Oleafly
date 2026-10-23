//! What an agent reports about usage: context, cost, tokens, plan limit
//! windows and how it is signed in. Every value is read leniently: a
//! malformed number or string is skipped, never fatal.
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::redact::Redactor;

const MAX_WINDOWS: usize = 8;
const MAX_MODELS: usize = 16;
const MAX_TEXT: usize = 200;
/// The plan summary kept from a hidden `/usage` or `/status` turn.
pub const MAX_PLAN_MARKDOWN: usize = 16 * 1024;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionUsage {
    pub context_used: Option<u64>,
    pub context_size: Option<u64>,
    /// Cumulative cost as the agent reports it.
    pub cost_amount: Option<f64>,
    pub cost_currency: Option<String>,
    pub last_turn: Option<TurnTokens>,
    /// The sum of every turn's reported tokens in this session.
    pub session_tokens: Option<TurnTokens>,
    pub model_usage: Vec<ModelTokens>,
    /// The latest window of each kind, at most 8.
    pub rate_limits: Vec<RateLimitWindow>,
    pub auth: Option<AuthStatus>,
    pub plan_markdown: Option<String>,
    pub plan_markdown_at: Option<u64>,
    pub model: Option<String>,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TurnTokens {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub thought_tokens: Option<u64>,
    pub cached_read_tokens: Option<u64>,
    pub cached_write_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ModelTokens {
    pub model: String,
    pub tokens: TurnTokens,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RateLimitWindow {
    pub id: String,
    pub status: String,
    /// 0..=1.
    pub utilization: Option<f64>,
    /// Epoch milliseconds.
    pub resets_at: Option<u64>,
    pub overage_status: Option<String>,
    pub using_overage: Option<bool>,
}

/// How the agent is signed in. Never the account's email address or
/// organization.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AuthStatus {
    pub kind: String,
    pub label: String,
    pub detail: Option<String>,
    pub plan: Option<String>,
}

/// A utilization as a fraction: values above 1 are percentages.
pub fn normalize_utilization(raw: f64) -> f64 {
    if !raw.is_finite() || raw <= 0.0 {
        return 0.0;
    }
    let fraction = if raw > 1.0 { raw / 100.0 } else { raw };
    fraction.clamp(0.0, 1.0)
}

/// An epoch time in milliseconds; values below 1e11 are seconds.
pub fn normalize_epoch_ms(raw: f64) -> Option<u64> {
    if !raw.is_finite() || raw <= 0.0 {
        return None;
    }
    let millis = if raw < 100_000_000_000.0 {
        raw * 1000.0
    } else {
        raw
    };
    (millis < 1e16).then_some(millis as u64)
}

fn count(value: &Value) -> Option<u64> {
    match value {
        Value::Number(number) => number.as_u64().or_else(|| {
            number
                .as_f64()
                .filter(|v| v.is_finite() && *v >= 0.0)
                .map(|v| v as u64)
        }),
        _ => None,
    }
}

fn amount(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .filter(|value| value.is_finite() && *value >= 0.0)
}

fn word(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty() && text.len() <= 64)
        .filter(|text| {
            text.chars()
                .all(|c| c.is_ascii_alphanumeric() || "_-.:/ ".contains(c))
        })
        .map(str::to_owned)
}

fn short_text(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| {
            text.chars()
                .filter(|c| !c.is_control())
                .take(MAX_TEXT)
                .collect()
        })
}

fn first<'a>(value: &'a Value, keys: &[&str]) -> &'a Value {
    keys.iter()
        .map(|key| &value[*key])
        .find(|value| !value.is_null())
        .unwrap_or(&Value::Null)
}

impl TurnTokens {
    /// Token counters in ACP (`inputTokens`) or snake case (`input_tokens`).
    pub fn parse(value: &Value) -> Option<Self> {
        if !value.is_object() {
            return None;
        }
        let tokens = Self {
            input_tokens: count(first(value, &["inputTokens", "input_tokens", "prompt"])),
            output_tokens: count(first(
                value,
                &["outputTokens", "output_tokens", "candidates"],
            )),
            thought_tokens: count(first(
                value,
                &[
                    "thoughtTokens",
                    "thought_tokens",
                    "reasoningTokens",
                    "thoughts",
                ],
            )),
            cached_read_tokens: count(first(
                value,
                &[
                    "cachedReadTokens",
                    "cached_read_tokens",
                    "cacheReadTokens",
                    "cached",
                ],
            )),
            cached_write_tokens: count(first(
                value,
                &[
                    "cachedWriteTokens",
                    "cached_write_tokens",
                    "cacheWriteTokens",
                ],
            )),
            total_tokens: count(first(value, &["totalTokens", "total_tokens", "total"])),
        };
        (tokens != Self::default()).then_some(tokens)
    }

    fn add(&mut self, other: &Self) {
        fn sum(into: &mut Option<u64>, value: Option<u64>) {
            if let Some(value) = value {
                *into = Some(into.unwrap_or(0).saturating_add(value));
            }
        }
        sum(&mut self.input_tokens, other.input_tokens);
        sum(&mut self.output_tokens, other.output_tokens);
        sum(&mut self.thought_tokens, other.thought_tokens);
        sum(&mut self.cached_read_tokens, other.cached_read_tokens);
        sum(&mut self.cached_write_tokens, other.cached_write_tokens);
        sum(&mut self.total_tokens, other.total_tokens);
    }
}

fn rate_window(value: &Value) -> Option<RateLimitWindow> {
    let id = word(first(value, &["rateLimitType", "type", "id", "window"]))?;
    let status = word(first(value, &["status", "state"])).unwrap_or_else(|| "allowed".into());
    Some(RateLimitWindow {
        id,
        status,
        utilization: first(value, &["utilization", "used", "percentUsed"])
            .as_f64()
            .filter(|value| value.is_finite() && *value >= 0.0)
            .map(normalize_utilization),
        resets_at: first(value, &["resetsAt", "resets_at", "resetAt"])
            .as_f64()
            .and_then(normalize_epoch_ms),
        overage_status: word(first(value, &["overageStatus", "overage_status"])),
        using_overage: first(value, &["isUsingOverage", "usingOverage", "using_overage"]).as_bool(),
    })
}

impl SessionUsage {
    /// A copy for a usage event. The plan summary (up to 16 KiB) is left
    /// out: views keep the one from the event that brought it, and every
    /// other update would only repeat it in the transcript.
    pub fn without_plan(&self) -> Self {
        Self {
            context_used: self.context_used,
            context_size: self.context_size,
            cost_amount: self.cost_amount,
            cost_currency: self.cost_currency.clone(),
            last_turn: self.last_turn.clone(),
            session_tokens: self.session_tokens.clone(),
            model_usage: self.model_usage.clone(),
            rate_limits: self.rate_limits.clone(),
            auth: self.auth.clone(),
            plan_markdown: None,
            plan_markdown_at: None,
            model: self.model.clone(),
            updated_at: self.updated_at,
        }
    }

    fn upsert_window(&mut self, window: RateLimitWindow) {
        if let Some(existing) = self.rate_limits.iter_mut().find(|w| w.id == window.id) {
            *existing = window;
        } else if self.rate_limits.len() < MAX_WINDOWS {
            self.rate_limits.push(window);
        }
    }

    /// A `usage_update`: context `used`/`size`, cumulative `cost`, and the
    /// Claude bridge's rate-limit and model metadata.
    pub fn apply_usage_update(&mut self, update: &Value, now: u64) {
        if let Some(used) = count(&update["used"]) {
            self.context_used = Some(used);
        }
        if let Some(size) = count(&update["size"]).filter(|size| *size > 0) {
            self.context_size = Some(size);
        }
        if let Some(cost) = update.get("cost").filter(|cost| cost.is_object()) {
            if let Some(value) = amount(&cost["amount"]) {
                self.cost_amount = Some(value);
                self.cost_currency = cost["currency"]
                    .as_str()
                    .filter(|code| code.len() == 3 && code.chars().all(|c| c.is_ascii_alphabetic()))
                    .map(str::to_ascii_uppercase)
                    .or_else(|| Some("USD".into()));
            }
        }
        let meta = &update["_meta"];
        match &meta["_claude/rateLimit"] {
            Value::Array(windows) => {
                for window in windows.iter().filter_map(rate_window) {
                    self.upsert_window(window);
                }
            }
            value @ Value::Object(_) => {
                if let Some(window) = rate_window(value) {
                    self.upsert_window(window);
                }
            }
            _ => {}
        }
        if let Some(model) =
            short_text(&meta["_claude/model"]).or_else(|| short_text(&meta["_claude/model"]["id"]))
        {
            self.model = Some(model);
        }
        self.updated_at = now;
    }

    /// A `session/prompt` answer: its `usage` and the `_meta.quota` some
    /// agents add.
    pub fn apply_prompt_response(&mut self, response: &Value, now: u64) {
        let quota = &response["_meta"]["quota"];
        let turn = TurnTokens::parse(&response["usage"])
            .or_else(|| TurnTokens::parse(&quota["token_count"]));
        if let Some(turn) = turn {
            self.session_tokens
                .get_or_insert_with(TurnTokens::default)
                .add(&turn);
            self.last_turn = Some(turn);
        }
        if let Some(models) = quota["model_usage"].as_array() {
            for entry in models {
                let Some(model) = short_text(first(entry, &["model", "modelId", "name"])) else {
                    continue;
                };
                let Some(tokens) =
                    TurnTokens::parse(first(entry, &["token_count", "tokens", "usage"]))
                else {
                    continue;
                };
                if let Some(existing) = self.model_usage.iter_mut().find(|m| m.model == model) {
                    existing.tokens.add(&tokens);
                } else if self.model_usage.len() < MAX_MODELS {
                    self.model_usage.push(ModelTokens { model, tokens });
                }
            }
        }
        self.updated_at = now;
    }

    /// `_auth/status_update`: `{authStatus: {kind, label, detail?, account: {plan?}}}`.
    /// The account's email and organization are never kept.
    pub fn apply_auth_status(&mut self, params: &Value, now: u64) {
        let status = if params["authStatus"].is_object() {
            &params["authStatus"]
        } else {
            params
        };
        let Some(kind) = word(&status["kind"]) else {
            return;
        };
        self.auth = Some(AuthStatus {
            label: short_text(&status["label"]).unwrap_or_else(|| kind.clone()),
            kind,
            detail: short_text(&status["detail"]),
            plan: short_text(&status["account"]["plan"]).or_else(|| short_text(&status["plan"])),
        });
        self.updated_at = now;
    }

    /// Sets the plan summary from a hidden usage turn, cut to 16 KiB.
    pub fn set_plan_markdown(&mut self, markdown: &str, now: u64) {
        let trimmed = markdown.trim();
        if trimmed.is_empty() {
            return;
        }
        let mut end = trimmed.len().min(MAX_PLAN_MARKDOWN);
        while !trimmed.is_char_boundary(end) {
            end -= 1;
        }
        self.plan_markdown = Some(trimmed[..end].to_owned());
        self.plan_markdown_at = Some(now);
        self.updated_at = now;
    }

    /// Passes every agent-written text through the session's redactor.
    pub fn redact(&mut self, redactor: &Redactor) {
        let clean = |text: &mut String| *text = redactor.text(text);
        if let Some(auth) = &mut self.auth {
            clean(&mut auth.label);
            if let Some(detail) = &mut auth.detail {
                clean(detail);
            }
            if let Some(plan) = &mut auth.plan {
                clean(plan);
            }
        }
        if let Some(model) = &mut self.model {
            clean(model);
        }
        if let Some(markdown) = &mut self.plan_markdown {
            clean(markdown);
        }
        for model in &mut self.model_usage {
            clean(&mut model.model);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn an_event_copy_keeps_everything_but_the_plan_summary() {
        let mut usage = SessionUsage::default();
        usage.apply_usage_update(&json!({"used": 900, "size": 200000}), 5);
        usage.set_plan_markdown(&"plan ".repeat(1000), 6);
        assert!(usage.plan_markdown.is_some());
        let copy = usage.without_plan();
        assert_eq!(copy.plan_markdown, None);
        assert_eq!(copy.plan_markdown_at, None);
        assert_eq!(
            SessionUsage {
                plan_markdown: None,
                plan_markdown_at: None,
                ..usage.clone()
            },
            copy
        );
        assert!(usage.plan_markdown.is_some(), "the session keeps its plan");
    }

    #[test]
    fn usage_update_reads_used_size_and_cost() {
        let mut usage = SessionUsage::default();
        usage.apply_usage_update(
            &json!({"used": 900, "size": 200000, "cost": {"amount": 0.42, "currency": "USD"}}),
            5,
        );
        assert_eq!(usage.context_used, Some(900));
        assert_eq!(usage.context_size, Some(200_000));
        assert_eq!(usage.cost_amount, Some(0.42));
        assert_eq!(usage.cost_currency.as_deref(), Some("USD"));
        assert_eq!(usage.updated_at, 5);
    }

    #[test]
    fn claude_rate_limit_meta_keeps_the_latest_window_per_type() {
        let mut usage = SessionUsage::default();
        let window = |kind: &str, status: &str, utilization: f64| {
            json!({"_meta": {"_claude/rateLimit": {"rateLimitType": kind, "status": status,
                "utilization": utilization, "resetsAt": 1_760_000_000}}})
        };
        usage.apply_usage_update(&window("five_hour", "allowed", 0.5), 1);
        usage.apply_usage_update(&window("five_hour", "allowed_warning", 0.82), 2);
        usage.apply_usage_update(&window("seven_day", "allowed", 0.1), 3);
        assert_eq!(usage.rate_limits.len(), 2);
        let w = &usage.rate_limits[0];
        assert_eq!(w.id, "five_hour");
        assert_eq!(w.status, "allowed_warning");
        assert_eq!(w.utilization, Some(0.82));
        assert_eq!(w.resets_at, Some(1_760_000_000_000));
    }

    #[test]
    fn utilization_in_percent_is_normalised() {
        assert_eq!(normalize_utilization(0.4), 0.4);
        assert_eq!(normalize_utilization(82.0), 0.82);
        assert!((normalize_utilization(1.5) - 0.015).abs() < 1e-12);
        assert_eq!(normalize_utilization(150.0), 1.0);
        assert_eq!(normalize_epoch_ms(1_760_000_000.0), Some(1_760_000_000_000));
        assert_eq!(
            normalize_epoch_ms(1_760_000_000_000.0),
            Some(1_760_000_000_000)
        );
        assert_eq!(normalize_epoch_ms(-1.0), None);
    }

    #[test]
    fn prompt_usage_reads_thought_tokens_and_quota_model_usage() {
        let mut usage = SessionUsage::default();
        usage.apply_prompt_response(
            &json!({"stopReason": "end_turn",
                "usage": {"inputTokens": 10, "outputTokens": 4, "thoughtTokens": 3, "totalTokens": 17},
                "_meta": {"quota": {"model_usage": [
                    {"model": "gemini-3-pro", "token_count": {"input_tokens": 10, "output_tokens": 4}}]}}}),
            1,
        );
        usage.apply_prompt_response(&json!({"usage": {"inputTokens": 5, "outputTokens": 1}}), 2);
        assert_eq!(usage.last_turn.as_ref().unwrap().input_tokens, Some(5));
        let session = usage.session_tokens.as_ref().unwrap();
        assert_eq!(session.input_tokens, Some(15));
        assert_eq!(session.thought_tokens, Some(3));
        assert_eq!(usage.model_usage[0].model, "gemini-3-pro");
        assert_eq!(usage.model_usage[0].tokens.output_tokens, Some(4));
    }

    #[test]
    fn auth_status_never_keeps_the_account_email() {
        let mut usage = SessionUsage::default();
        usage.apply_auth_status(
            &json!({"authStatus": {"kind": "account", "label": "Claude Max",
                "account": {"email": "a@example.com", "organization": "Lab", "plan": "max"}}}),
            1,
        );
        let text = serde_json::to_string(&usage).unwrap();
        assert!(!text.contains("a@example.com") && !text.contains("Lab"));
        assert_eq!(usage.auth.unwrap().plan.as_deref(), Some("max"));
    }

    #[test]
    fn malformed_usage_values_are_ignored() {
        let mut usage = SessionUsage::default();
        usage.apply_usage_update(
            &json!({"used": "900", "size": -4, "cost": {"amount": "NaN"},
                "_meta": {"_claude/rateLimit": {"status": "allowed"}}}),
            1,
        );
        assert_eq!(usage.context_used, None);
        assert_eq!(usage.context_size, None);
        assert_eq!(usage.cost_amount, None);
        assert!(usage.rate_limits.is_empty());
        usage.apply_prompt_response(&json!({"usage": {"inputTokens": -3}}), 2);
        assert!(usage.last_turn.is_none());
    }

    #[test]
    fn plan_markdown_is_trimmed_and_cut() {
        let mut usage = SessionUsage::default();
        usage.set_plan_markdown(&format!("  ## Usage\n{}", "é".repeat(20_000)), 9);
        let text = usage.plan_markdown.unwrap();
        assert!(text.starts_with("## Usage") && text.len() <= MAX_PLAN_MARKDOWN);
        assert_eq!(usage.plan_markdown_at, Some(9));
    }
}
