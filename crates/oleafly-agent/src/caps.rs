//! What a model can take and produce, read from the model metadata
//! snapshot (models.dev): its context window and output limit, whether it
//! reads images and PDFs, and how its reasoning is controlled.
use serde_json::Value;

use crate::effort::Effort;
use crate::provider::{Resolved, Wire};

/// Documents one agent request may carry.
pub const MAX_AGENT_DOCUMENTS: usize = 10;
/// Images a run starts with; the rest of the request's image room is kept
/// for images tools return.
pub const MAX_RUN_START_IMAGES: usize = 12;

const MIB: usize = 1024 * 1024;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ModelCaps {
    pub context_window: Option<u32>,
    pub output_limit: Option<u32>,
    /// `None` when the metadata does not say.
    pub images: Option<bool>,
    pub pdf: Option<bool>,
    pub reasoning: ReasoningCaps,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReasoningCaps {
    /// The metadata's `reasoning` flag.
    pub flag: Option<bool>,
    /// Effort names the model accepts, ascending; `None` when unknown.
    pub efforts: Option<Vec<Effort>>,
    /// Thinking can be switched off.
    pub toggle: bool,
    /// A thinking budget in tokens, for models that take one.
    pub budget: Option<BudgetRange>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BudgetRange {
    pub min: Option<u32>,
    pub max: Option<u32>,
}

fn saturating_u32(value: Option<&Value>) -> Option<u32> {
    value
        .and_then(Value::as_u64)
        .map(|number| u32::try_from(number).unwrap_or(u32::MAX))
}

impl ReasoningCaps {
    /// Parses models.dev `reasoning_options`: an array of
    /// `{"type":"effort","values":[…]}`, `{"type":"toggle"}` and
    /// `{"type":"budget_tokens","min"?,"max"?}` entries. Unknown entries and
    /// unknown effort names are ignored.
    pub fn from_metadata(reasoning: Option<bool>, options: Option<&Value>) -> Self {
        let mut caps = ReasoningCaps {
            flag: reasoning,
            ..ReasoningCaps::default()
        };
        let Some(entries) = options.and_then(Value::as_array) else {
            return caps;
        };
        for entry in entries {
            match entry.get("type").and_then(Value::as_str) {
                Some("effort") => {
                    let mut efforts: Vec<Effort> = entry
                        .get("values")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                        .filter_map(Effort::parse)
                        .collect();
                    efforts.extend(caps.efforts.take().unwrap_or_default());
                    efforts.sort();
                    efforts.dedup();
                    caps.efforts = (!efforts.is_empty()).then_some(efforts);
                }
                Some("toggle") => caps.toggle = true,
                Some("budget_tokens") => {
                    caps.budget = Some(BudgetRange {
                        min: saturating_u32(entry.get("min")),
                        max: saturating_u32(entry.get("max")),
                    });
                }
                _ => {}
            }
        }
        caps
    }
}

impl ModelCaps {
    /// Reads one entry of the metadata snapshot (camelCase keys).
    pub fn from_metadata_json(entry: &Value) -> Self {
        let modalities: Option<Vec<&str>> = entry
            .get("inputModalities")
            .and_then(Value::as_array)
            .filter(|list| !list.is_empty())
            .map(|list| list.iter().filter_map(Value::as_str).collect());
        ModelCaps {
            context_window: saturating_u32(entry.get("contextWindow")),
            output_limit: saturating_u32(entry.get("outputLimit")),
            images: modalities.as_ref().map(|list| list.contains(&"image")),
            pdf: modalities.as_ref().map(|list| list.contains(&"pdf")),
            reasoning: ReasoningCaps::from_metadata(
                entry.get("reasoning").and_then(Value::as_bool),
                entry.get("reasoningOptions"),
            ),
        }
    }
}

/// Whether the model reads images; `None` when its metadata does not say.
pub fn accepts_images(resolved: &Resolved) -> Option<bool> {
    resolved.caps.images
}

/// Whether the model takes PDF documents as files.
pub fn accepts_documents(resolved: &Resolved) -> bool {
    let model = resolved.model_id.to_ascii_lowercase();
    let pdf = resolved.caps.pdf;
    match &resolved.wire {
        Wire::Anthropic { .. } => pdf.unwrap_or(model.starts_with("claude-")),
        Wire::Google { .. } => pdf.unwrap_or(model.starts_with("gemini-")),
        Wire::OpenAiResponses { .. } => pdf.unwrap_or(false),
        Wire::OpenAiChat { .. } => resolved.provider_id == "openrouter" && pdf == Some(true),
    }
}

/// The most pages a PDF sent as a document may have.
pub fn document_page_limit(resolved: &Resolved) -> u32 {
    match &resolved.wire {
        Wire::Anthropic { .. } => {
            if resolved
                .caps
                .context_window
                .is_none_or(|window| window <= 200_000)
            {
                100
            } else {
                600
            }
        }
        _ => 1_000,
    }
}

/// Base64 bytes of images and documents one request may carry, under the
/// provider's request size limit.
pub fn request_media_budget(resolved: &Resolved) -> usize {
    if resolved.is_local_endpoint() {
        return 64 * MIB;
    }
    match &resolved.wire {
        Wire::Anthropic { .. } => 30 * MIB,
        Wire::OpenAiResponses { .. } => 45 * MIB,
        Wire::Google { .. } | Wire::OpenAiChat { .. } => 18 * MIB,
    }
}

/// Characters of attachment text one run may add, from the context window.
pub fn text_attachment_budget(resolved: &Resolved) -> usize {
    resolved.caps.context_window.map_or(200_000, |window| {
        (window as usize).saturating_mul(2).clamp(40_000, 600_000)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reasoning_options_parse_the_models_dev_shapes() {
        let caps = ReasoningCaps::from_metadata(
            Some(true),
            Some(&json!([
                {"type":"toggle"},
                {"type":"effort","values":["high","none","default","low","ultra"]},
                {"type":"budget_tokens","min":0,"max":24576},
                {"type":"mystery"}
            ])),
        );
        assert_eq!(
            caps.efforts,
            Some(vec![Effort::Off, Effort::Low, Effort::High])
        );
        assert!(caps.toggle);
        assert_eq!(
            caps.budget,
            Some(BudgetRange {
                min: Some(0),
                max: Some(24576)
            })
        );
        assert_eq!(
            ReasoningCaps::from_metadata(Some(false), Some(&json!({"type":"toggle"}))),
            ReasoningCaps {
                flag: Some(false),
                ..Default::default()
            }
        );
        assert_eq!(
            ReasoningCaps::from_metadata(
                None,
                Some(&json!([{"type":"effort","values":["default"]}]))
            )
            .efforts,
            None
        );
    }

    #[test]
    fn caps_read_limits_and_modalities_from_a_snapshot_entry() {
        let caps = ModelCaps::from_metadata_json(&json!({
            "contextWindow": 1_000_000,
            "outputLimit": 128_000,
            "inputModalities": ["text","image","pdf"],
            "reasoning": true
        }));
        assert_eq!(
            (
                caps.context_window,
                caps.output_limit,
                caps.images,
                caps.pdf
            ),
            (Some(1_000_000), Some(128_000), Some(true), Some(true))
        );
        let text_only = ModelCaps::from_metadata_json(&json!({"inputModalities": ["text"]}));
        assert_eq!(
            (text_only.images, text_only.pdf),
            (Some(false), Some(false))
        );
        assert_eq!(
            ModelCaps::from_metadata_json(&json!({"contextWindow": 9_000_000_000u64}))
                .context_window,
            Some(u32::MAX)
        );
        assert_eq!(ModelCaps::from_metadata_json(&json!({})).images, None);
        assert_eq!(
            ModelCaps::from_metadata_json(&json!({"inputModalities": []})).pdf,
            None
        );
    }

    fn resolved(provider: &str, model: &str, wire: Wire, caps: ModelCaps) -> Resolved {
        Resolved {
            provider_id: provider.into(),
            model_id: model.into(),
            credential: String::new(),
            auth: None,
            wire,
            caps,
        }
    }

    #[test]
    fn media_limits_follow_the_provider() {
        let claude = resolved(
            "anthropic",
            "claude-opus-5-5",
            Wire::Anthropic {
                base_url: "https://api.anthropic.com/v1".into(),
            },
            ModelCaps {
                context_window: Some(1_000_000),
                ..ModelCaps::default()
            },
        );
        assert!(accepts_documents(&claude));
        assert_eq!(document_page_limit(&claude), 600);
        assert_eq!(request_media_budget(&claude), 30 * MIB);
        assert_eq!(text_attachment_budget(&claude), 600_000);
        let groq = resolved(
            "groq",
            "openai/gpt-oss-120b",
            Wire::OpenAiChat {
                base_url: "https://api.groq.com/openai/v1".into(),
                reasoning_content: false,
            },
            ModelCaps::default(),
        );
        assert!(!accepts_documents(&groq));
        assert_eq!(accepts_images(&groq), None);
        assert_eq!(text_attachment_budget(&groq), 200_000);
        let local = resolved(
            "ollama",
            "qwen3:8b",
            Wire::OpenAiChat {
                base_url: "http://localhost:11434/v1".into(),
                reasoning_content: false,
            },
            ModelCaps::default(),
        );
        assert_eq!(request_media_budget(&local), 64 * MIB);
    }
}
