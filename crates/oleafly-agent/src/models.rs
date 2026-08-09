use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::complete::{auth_headers, read_body_limited, read_provider_error, request_error};
use crate::error::{AgentError, Result};
use crate::provider::{Resolved, Wire};

const MODEL_LIST_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_MODEL_BODY_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
}

pub(crate) fn models_url(resolved: &Resolved) -> String {
    let base = match &resolved.wire {
        Wire::OpenAiChat { base_url, .. } => base_url,
        Wire::Anthropic { base_url } => base_url,
        Wire::Google { base_url } => base_url,
    };
    format!("{}/models", base.trim_end_matches('/'))
}

pub(crate) fn parse_models(wire: &Wire, body: &Value) -> Result<Vec<ModelInfo>> {
    let models = match wire {
        Wire::Google { .. } => body
            .get("models")
            .and_then(|m| m.as_array())
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|entry| {
                        let raw = entry.get("name").and_then(|n| n.as_str())?;
                        let id = raw.strip_prefix("models/").unwrap_or(raw).to_string();
                        let name = entry
                            .get("displayName")
                            .and_then(|d| d.as_str())
                            .unwrap_or(&id)
                            .to_string();
                        Some(ModelInfo { id, name })
                    })
                    .collect::<Vec<_>>()
            }),
        _ => body.get("data").and_then(|d| d.as_array()).map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    let id = entry.get("id").and_then(|i| i.as_str())?.to_string();
                    let name = entry
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or(&id)
                        .to_string();
                    Some(ModelInfo { id, name })
                })
                .collect::<Vec<_>>()
        }),
    };

    let models = models.unwrap_or_default();
    if models.is_empty() {
        return Err(AgentError::Decode("the provider listed no models".into()));
    }
    Ok(models)
}

pub async fn list_models(client: &reqwest::Client, resolved: &Resolved) -> Result<Vec<ModelInfo>> {
    let mut request = client
        .get(models_url(resolved))
        .headers(auth_headers(resolved))
        .timeout(MODEL_LIST_TIMEOUT);
    if matches!(resolved.wire, Wire::Anthropic { .. }) {
        request = request.header("anthropic-version", "2023-06-01");
    }

    let response = request.send().await.map_err(request_error)?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(
            read_provider_error(response, status, "model listing error response body").await,
        );
    }
    let raw = read_body_limited(
        response,
        MAX_MODEL_BODY_BYTES,
        "model listing response body",
    )
    .await?;
    let body: Value =
        serde_json::from_slice(&raw).map_err(|e| AgentError::Decode(e.to_string()))?;
    parse_models(&resolved.wire, &body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::{ANTHROPIC_BASE, GOOGLE_BASE, OPENAI_BASE};
    use serde_json::json;

    fn resolved(wire: Wire) -> Resolved {
        Resolved {
            provider_id: "p".into(),
            model_id: "m".into(),
            credential: "k".into(),
            auth: Some("k".into()),
            wire,
        }
    }

    #[test]
    fn each_provider_is_asked_at_its_own_models_endpoint() {
        assert_eq!(
            models_url(&resolved(Wire::OpenAiChat {
                base_url: OPENAI_BASE.into(),
                reasoning_content: false
            })),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            models_url(&resolved(Wire::OpenAiChat {
                base_url: "https://openrouter.ai/api/v1".into(),
                reasoning_content: false
            })),
            "https://openrouter.ai/api/v1/models"
        );
        assert_eq!(
            models_url(&resolved(Wire::Anthropic {
                base_url: ANTHROPIC_BASE.into()
            })),
            "https://api.anthropic.com/v1/models"
        );
    }

    #[test]
    fn a_custom_base_with_a_trailing_slash_still_forms_one_url() {
        assert_eq!(
            models_url(&resolved(Wire::OpenAiChat {
                base_url: "http://127.0.0.1:8000/v1/".into(),
                reasoning_content: true
            })),
            "http://127.0.0.1:8000/v1/models"
        );
    }

    #[test]
    fn an_openai_shaped_listing_parses() {
        let wire = Wire::OpenAiChat {
            base_url: OPENAI_BASE.into(),
            reasoning_content: false,
        };
        let body = json!({
            "object": "list",
            "data": [{ "id": "gpt-4o" }, { "id": "glm-5.2", "name": "GLM-5.2" }]
        });
        assert_eq!(
            parse_models(&wire, &body).unwrap(),
            vec![
                ModelInfo {
                    id: "gpt-4o".into(),
                    name: "gpt-4o".into()
                },
                ModelInfo {
                    id: "glm-5.2".into(),
                    name: "GLM-5.2".into()
                },
            ]
        );
    }

    #[test]
    fn gemini_strips_the_models_prefix_from_its_ids() {
        let wire = Wire::Google {
            base_url: GOOGLE_BASE.into(),
        };
        let body = json!({
            "models": [
                { "name": "models/gemini-2.5-pro", "displayName": "Gemini 2.5 Pro" },
                { "name": "gemini-2.0-flash" }
            ]
        });
        assert_eq!(
            parse_models(&wire, &body).unwrap(),
            vec![
                ModelInfo {
                    id: "gemini-2.5-pro".into(),
                    name: "Gemini 2.5 Pro".into()
                },
                ModelInfo {
                    id: "gemini-2.0-flash".into(),
                    name: "gemini-2.0-flash".into()
                },
            ]
        );
    }

    #[test]
    fn an_empty_listing_is_an_error_rather_than_an_empty_picker() {
        let wire = Wire::OpenAiChat {
            base_url: OPENAI_BASE.into(),
            reasoning_content: false,
        };
        assert!(parse_models(&wire, &json!({ "data": [] })).is_err());
        assert!(parse_models(&wire, &json!({})).is_err());
    }

    #[test]
    fn a_rejected_key_is_reported_as_a_provider_error_and_is_not_retryable() {
        let error =
            crate::complete::error_message(401, r#"{"error":{"message":"Incorrect API key"}}"#);
        assert!(!error.retryable());
        assert!(error.to_string().contains("Incorrect API key"));
    }
}
