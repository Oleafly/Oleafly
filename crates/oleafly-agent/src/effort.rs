//! How hard a model thinks: the levels a chat can ask for, which levels each
//! provider and model accepts, and the nearest accepted level for a request.
//! `packages/ai-core/src/effort.ts` mirrors `effort_choices`; both run the
//! shared table in `tests/fixtures/effort-cases.json`.
use serde::Serialize;

use crate::caps::ModelCaps;
use crate::provider::Resolved;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Effort {
    /// No thinking. Serialized as `"none"`; the variant is not named `None`
    /// so `Some(Off)` never reads like a missing value.
    #[serde(rename = "none")]
    Off,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

impl Effort {
    pub const ALL: [Effort; 7] = [
        Effort::Off,
        Effort::Minimal,
        Effort::Low,
        Effort::Medium,
        Effort::High,
        Effort::Xhigh,
        Effort::Max,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Effort::Off => "none",
            Effort::Minimal => "minimal",
            Effort::Low => "low",
            Effort::Medium => "medium",
            Effort::High => "high",
            Effort::Xhigh => "xhigh",
            Effort::Max => "max",
        }
    }

    pub fn parse(value: &str) -> Option<Effort> {
        Effort::ALL
            .into_iter()
            .find(|effort| effort.as_str() == value)
    }

    fn rank(self) -> i32 {
        self as i32
    }
}

impl<'de> serde::Deserialize<'de> for Effort {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        Effort::parse(&value)
            .ok_or_else(|| serde::de::Error::custom(format!("unknown effort `{value}`")))
    }
}

/// A requested effort from the renderer. Unknown names and non-strings
/// (a newer renderer, a stored chat) read as auto.
pub(crate) fn lenient_effort<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Effort>, D::Error> {
    let value: Option<serde_json::Value> = serde::Deserialize::deserialize(deserializer)?;
    Ok(value
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .and_then(Effort::parse))
}

use Effort::{High, Low, Max, Medium, Minimal, Off, Xhigh};

fn starts_with_any(id: &str, prefixes: &[&str]) -> bool {
    prefixes.iter().any(|prefix| id.starts_with(prefix))
}

/// `o1`…`o9` and their variants (`o3-mini`, `o4-mini-high`).
fn openai_o_series(id: &str) -> bool {
    let bytes = id.as_bytes();
    bytes.len() >= 2 && bytes[0] == b'o' && matches!(bytes[1], b'1'..=b'9')
}

pub(crate) fn openai_reasoning_id(id: &str) -> bool {
    starts_with_any(id, &["gpt-5", "gpt-6", "gpt-7"]) || openai_o_series(id)
}

/// Gemini models that take a thinking budget (2.5) rather than a level.
pub(crate) fn google_budget_model(model_id: &str, caps: &ModelCaps) -> bool {
    let reasoning = &caps.reasoning;
    if reasoning.budget.is_some() && reasoning.efforts.is_none() {
        return true;
    }
    let no_metadata = reasoning.flag.is_none()
        && reasoning.efforts.is_none()
        && reasoning.budget.is_none()
        && !reasoning.toggle;
    no_metadata && model_id.to_ascii_lowercase().starts_with("gemini-2.5")
}

fn anthropic_fallback(id: &str, caps: &ModelCaps) -> Vec<Effort> {
    if caps.reasoning.budget.is_some() {
        return Vec::new();
    }
    if starts_with_any(
        id,
        &[
            "claude-opus-5",
            "claude-sonnet-5",
            "claude-haiku-5",
            "claude-fable-",
            "claude-mythos-",
            "claude-opus-4-7",
            "claude-opus-4-8",
        ],
    ) {
        return vec![Low, Medium, High, Xhigh, Max];
    }
    if starts_with_any(id, &["claude-opus-4-6", "claude-sonnet-4-6"]) {
        return vec![Low, Medium, High, Max];
    }
    if id.starts_with("claude-opus-4-5") {
        return vec![Low, Medium, High];
    }
    Vec::new()
}

/// The levels the selector offers for this model, ascending. Empty hides
/// the selector (and the request then sends no effort).
pub fn effort_choices(provider_id: &str, model_id: &str, caps: &ModelCaps) -> Vec<Effort> {
    let id = model_id.to_ascii_lowercase();
    let reasoning = &caps.reasoning;
    let all = Effort::ALL.to_vec();
    let (wire_set, base): (Vec<Effort>, Vec<Effort>) = match provider_id {
        "anthropic" => {
            let mut wire = vec![Low, Medium, High, Xhigh, Max];
            if reasoning.toggle {
                wire.push(Off);
            }
            let base = match &reasoning.efforts {
                Some(efforts) => {
                    let mut base = efforts.clone();
                    if reasoning.toggle {
                        base.push(Off);
                    }
                    base
                }
                None => anthropic_fallback(&id, caps),
            };
            (wire, base)
        }
        "openai" => {
            let base = match &reasoning.efforts {
                Some(efforts) => efforts.clone(),
                None if reasoning.flag == Some(false) => Vec::new(),
                None if openai_reasoning_id(&id) => vec![Low, Medium, High],
                None => Vec::new(),
            };
            (all, base)
        }
        "google" => {
            let budget_model = google_budget_model(&id, caps);
            let wire = if budget_model {
                let mut wire = vec![Low, Medium, High];
                if reasoning.toggle || reasoning.budget.and_then(|budget| budget.min) == Some(0) {
                    wire.push(Off);
                }
                wire
            } else {
                vec![Minimal, Low, Medium, High]
            };
            let base = match &reasoning.efforts {
                Some(efforts) => efforts.clone(),
                None if budget_model && reasoning.budget.is_some() => {
                    let mut base = vec![Low, Medium, High];
                    if reasoning.toggle || reasoning.budget.and_then(|budget| budget.min) == Some(0)
                    {
                        base.push(Off);
                    }
                    base
                }
                None if budget_model => {
                    let mut base = vec![Low, Medium, High];
                    if id.starts_with("gemini-2.5-flash") {
                        base.push(Off);
                    }
                    base
                }
                None if starts_with_any(&id, &["gemini-3", "gemini-4", "gemini-flash"]) => {
                    vec![Low, Medium, High]
                }
                None => Vec::new(),
            };
            // A budget model without metadata may still turn thinking off
            // (Flash); the wire allows it whenever the base offers it.
            let mut wire = wire;
            if budget_model && base.contains(&Off) && !wire.contains(&Off) {
                wire.push(Off);
            }
            (wire, base)
        }
        "xai" => {
            let base = match &reasoning.efforts {
                Some(efforts) => efforts.clone(),
                None if id.starts_with("grok-4.5") => vec![Low, Medium, High],
                None if starts_with_any(&id, &["grok-4.6", "grok-4.7"]) => {
                    vec![Low, Medium, High, Xhigh]
                }
                None => Vec::new(),
            };
            (vec![Low, Medium, High, Xhigh], base)
        }
        "groq" => {
            let base = match &reasoning.efforts {
                Some(efforts) => efforts.clone(),
                None if id.starts_with("openai/gpt-oss-") => vec![Low, Medium, High],
                None => Vec::new(),
            };
            (all, base)
        }
        "openrouter" => (all, reasoning.efforts.clone().unwrap_or_default()),
        "ollama" => {
            let base = match &reasoning.efforts {
                Some(efforts) => efforts.clone(),
                None if id.contains("gpt-oss") => vec![Low, Medium, High],
                None if reasoning.flag == Some(true) => vec![Off],
                None => Vec::new(),
            };
            (all, base)
        }
        _ => (Vec::new(), Vec::new()),
    };
    let mut choices: Vec<Effort> = base
        .into_iter()
        .filter(|effort| wire_set.contains(effort))
        .collect();
    choices.sort();
    choices.dedup();
    choices
}

/// The accepted level nearest to `requested` (ties go up); `None` when the
/// model takes no effort.
pub fn clamp_effort(requested: Effort, choices: &[Effort]) -> Option<Effort> {
    if choices.contains(&requested) {
        return Some(requested);
    }
    choices.iter().copied().min_by_key(|choice| {
        let distance = (choice.rank() - requested.rank()).abs();
        // Equal distances prefer the higher level.
        (distance, -choice.rank())
    })
}

/// The effort a request sends for this model: the requested level clamped
/// to what the model accepts. Auto (`None`) sends nothing.
pub fn effective_effort(resolved: &Resolved, requested: Option<Effort>) -> Option<Effort> {
    requested.and_then(|effort| {
        clamp_effort(
            effort,
            &effort_choices(&resolved.provider_id, &resolved.model_id, &resolved.caps),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::Wire;

    fn resolved(provider: &str, model: &str, wire: Wire) -> Resolved {
        Resolved {
            provider_id: provider.into(),
            model_id: model.into(),
            credential: String::new(),
            auth: None,
            wire,
            caps: ModelCaps::default(),
        }
    }

    #[test]
    fn effort_choices_match_the_shared_fixture() {
        let cases: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("../tests/fixtures/effort-cases.json")).unwrap();
        for case in cases {
            let meta = &case["metadata"];
            let caps = if meta.is_null() {
                ModelCaps::default()
            } else {
                ModelCaps::from_metadata_json(meta)
            };
            let got: Vec<&str> = effort_choices(
                case["provider"].as_str().unwrap(),
                case["model"].as_str().unwrap(),
                &caps,
            )
            .into_iter()
            .map(Effort::as_str)
            .collect();
            let want: Vec<&str> = case["expected"]
                .as_array()
                .unwrap()
                .iter()
                .map(|value| value.as_str().unwrap())
                .collect();
            assert_eq!(got, want, "{} {}", case["provider"], case["model"]);
        }
    }

    #[test]
    fn clamping_picks_the_nearest_supported_level() {
        assert_eq!(clamp_effort(Xhigh, &[Low, Medium, High]), Some(High));
        assert_eq!(clamp_effort(Off, &[Low, Medium, High]), Some(Low));
        assert_eq!(clamp_effort(Minimal, &[Off, Low]), Some(Low));
        assert_eq!(clamp_effort(Medium, &[Low, High]), Some(High));
        assert_eq!(clamp_effort(High, &[High]), Some(High));
        assert_eq!(clamp_effort(Max, &[]), None);
    }

    #[test]
    fn hidden_providers_and_auto_send_no_effort() {
        let deepseek = resolved(
            "deepseek",
            "deepseek-flash",
            Wire::OpenAiChat {
                base_url: "https://api.deepseek.com".into(),
                reasoning_content: true,
            },
        );
        assert_eq!(effective_effort(&deepseek, Some(Effort::High)), None);
        let opus = resolved(
            "anthropic",
            "claude-opus-5-5",
            Wire::Anthropic {
                base_url: "https://api.anthropic.com/v1".into(),
            },
        );
        assert_eq!(effective_effort(&opus, None), None);
        assert_eq!(
            effective_effort(&opus, Some(Effort::Off)),
            Some(Effort::Low)
        );
    }

    #[test]
    fn effort_names_parse_exactly() {
        assert_eq!(Effort::parse("xhigh"), Some(Xhigh));
        assert_eq!(Effort::parse("none"), Some(Off));
        assert_eq!(Effort::parse("High"), None);
        assert_eq!(Effort::parse("default"), None);
        assert_eq!(serde_json::to_value(Off).unwrap(), "none");
    }
}
