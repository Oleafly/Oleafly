use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

pub const ELICITATION_CREATE: &str = "elicitation/create";
pub const ELICITATION_COMPLETE: &str = "elicitation/complete";
pub const ELICITATION_TTL_MS: u64 = 10 * 60 * 1000;
const MAX_FIELDS: usize = 32;
const MAX_CHOICES: usize = 256;
const MAX_MESSAGE: usize = 2000;
const MAX_TEXT: usize = 300;
const MAX_ANSWER: usize = 64 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ElicitationView {
    pub id: String,
    pub mode: String,
    pub message: String,
    pub url: Option<String>,
    pub fields: Vec<ElicitationField>,
    pub session_id: Option<String>,
    pub tool_call_id: Option<String>,
    pub expires_at: u64,
    #[serde(skip)]
    pub elicitation_id: Option<String>,
    #[serde(skip)]
    pub request_scoped: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ElicitationField {
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub kind: FieldKind,
    pub required: bool,
    pub default: Option<Value>,
    pub secret: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum FieldKind {
    String {
        min_length: Option<u32>,
        max_length: Option<u32>,
        format: Option<String>,
    },
    Number {
        integer: bool,
        minimum: Option<f64>,
        maximum: Option<f64>,
    },
    Boolean,
    Choice {
        options: Vec<(String, String)>,
        multiple: bool,
    },
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn clean_text(value: &Value, limit: usize) -> Option<String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| {
            text.chars()
                .filter(|c| *c == '\n' || !c.is_control())
                .take(limit)
                .collect()
        })
}

fn is_secret(name: &str, title: Option<&str>) -> bool {
    let text = format!("{} {}", name, title.unwrap_or("")).to_ascii_lowercase();
    [
        "password",
        "passphrase",
        "token",
        "secret",
        "api_key",
        "apikey",
        "api-key",
        "api key",
        "credential",
    ]
    .iter()
    .any(|marker| text.contains(marker))
}

fn choices(values: &Value, titled: bool) -> Option<Vec<(String, String)>> {
    let values = values.as_array()?;
    if values.is_empty() || values.len() > MAX_CHOICES {
        return None;
    }
    values
        .iter()
        .map(|value| {
            if titled {
                let id = value["const"].as_str()?.to_owned();
                let title = clean_text(&value["title"], MAX_TEXT).unwrap_or_else(|| id.clone());
                Some((id, title))
            } else {
                let id = value.as_str()?.to_owned();
                Some((id.clone(), id))
            }
        })
        .collect()
}

fn bound(value: &Value) -> Option<u32> {
    value.as_u64().and_then(|value| u32::try_from(value).ok())
}

fn field_kind(schema: &Value) -> Option<FieldKind> {
    match schema["type"].as_str()? {
        "string" => {
            if let Some(options) =
                choices(&schema["oneOf"], true).or_else(|| choices(&schema["enum"], false))
            {
                return Some(FieldKind::Choice {
                    options,
                    multiple: false,
                });
            }
            let format = schema["format"]
                .as_str()
                .filter(|format| matches!(*format, "email" | "uri" | "date" | "date-time"))
                .map(str::to_owned);
            Some(FieldKind::String {
                min_length: bound(&schema["minLength"]),
                max_length: bound(&schema["maxLength"]),
                format,
            })
        }
        kind @ ("number" | "integer") => Some(FieldKind::Number {
            integer: kind == "integer",
            minimum: schema["minimum"].as_f64(),
            maximum: schema["maximum"].as_f64(),
        }),
        "boolean" => Some(FieldKind::Boolean),
        "array" => {
            let items = &schema["items"];
            let options =
                choices(&items["anyOf"], true).or_else(|| choices(&items["enum"], false))?;
            Some(FieldKind::Choice {
                options,
                multiple: true,
            })
        }
        _ => None,
    }
}

fn link_allowed(link: &str) -> Result<String, String> {
    let parsed = url::Url::parse(link).map_err(|_| "The agent sent a link Oleafly cannot open.")?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(
            "The agent sent a link with a sign-in name in it, so Oleafly will not open it.".into(),
        );
    }
    let local = matches!(
        parsed.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    match parsed.scheme() {
        "https" => Ok(parsed.into()),
        "http" if local => Ok(parsed.into()),
        _ => Err("Oleafly only opens secure (https) links from agents.".into()),
    }
}

pub fn parse_create(params: &Value, now: u64) -> Result<ElicitationView, String> {
    let mode = params["mode"].as_str().unwrap_or("");
    let message = clean_text(&params["message"], MAX_MESSAGE).unwrap_or_default();
    let session_id = params["sessionId"].as_str().map(str::to_owned);
    let request_scoped = session_id.is_none() && !params["requestId"].is_null();
    if session_id.is_none() && !request_scoped {
        return Err("The agent's question is not tied to a session or a request.".into());
    }
    let tool_call_id = params["toolCallId"].as_str().map(str::to_owned);
    let id = format!("q{}-{}", now, NEXT_ID.fetch_add(1, Ordering::Relaxed));
    let expires_at = now.saturating_add(ELICITATION_TTL_MS);
    match mode {
        "form" => {
            let schema = &params["requestedSchema"];
            let properties = schema["properties"]
                .as_object()
                .ok_or("The agent's form has no fields.")?;
            if properties.len() > MAX_FIELDS {
                return Err("The agent's form has more than 32 fields.".into());
            }
            let required: Vec<&str> = schema["required"]
                .as_array()
                .map(|names| names.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            let mut fields = Vec::new();
            for (name, property) in properties {
                let is_required = required.contains(&name.as_str());
                let Some(kind) = field_kind(property) else {
                    if is_required {
                        return Err(
                            "The agent's form asks for something Oleafly cannot show.".into()
                        );
                    }
                    continue;
                };
                let title = clean_text(&property["title"], MAX_TEXT);
                let secret = is_secret(name, title.as_deref());
                let default = if secret {
                    None
                } else {
                    property
                        .get("default")
                        .filter(|value| !value.is_null())
                        .cloned()
                };
                fields.push(ElicitationField {
                    name: name.chars().take(128).collect(),
                    description: clean_text(&property["description"], MAX_TEXT),
                    title,
                    kind,
                    required: is_required,
                    default,
                    secret,
                });
            }
            Ok(ElicitationView {
                id,
                mode: "form".into(),
                message,
                url: None,
                fields,
                session_id,
                tool_call_id,
                expires_at,
                elicitation_id: None,
                request_scoped,
            })
        }
        "url" => {
            let link = link_allowed(params["url"].as_str().unwrap_or(""))?;
            let elicitation_id = params["elicitationId"]
                .as_str()
                .filter(|id| !id.is_empty() && id.len() <= 256)
                .ok_or("The agent's link question has no id.")?
                .to_owned();
            Ok(ElicitationView {
                id,
                mode: "url".into(),
                message,
                url: Some(link),
                fields: Vec::new(),
                session_id,
                tool_call_id,
                expires_at,
                elicitation_id: Some(elicitation_id),
                request_scoped,
            })
        }
        _ => Err("Oleafly does not support this kind of question from the agent.".into()),
    }
}

fn label(field: &ElicitationField) -> &str {
    field.title.as_deref().unwrap_or(&field.name)
}

fn check(field: &ElicitationField, value: &Value) -> Result<Value, String> {
    let wrong = || format!("Check the value for {}.", label(field));
    match &field.kind {
        FieldKind::String {
            min_length,
            max_length,
            format,
        } => {
            let text = value.as_str().ok_or_else(wrong)?;
            let length = text.chars().count() as u64;
            if text.len() > MAX_ANSWER
                || min_length.is_some_and(|min| length < u64::from(min))
                || max_length.is_some_and(|max| length > u64::from(max))
            {
                return Err(wrong());
            }
            let valid = match format.as_deref() {
                Some("email") => text.contains('@') && !text.contains(char::is_whitespace),
                Some("uri") => url::Url::parse(text).is_ok(),
                Some("date") => {
                    text.len() == 10 && text.as_bytes()[4] == b'-' && text.as_bytes()[7] == b'-'
                }
                Some("date-time") => text.len() >= 16 && text.contains('T'),
                _ => true,
            };
            if !valid {
                return Err(wrong());
            }
            Ok(Value::String(text.to_owned()))
        }
        FieldKind::Number {
            integer,
            minimum,
            maximum,
        } => {
            let number = value
                .as_f64()
                .filter(|number| number.is_finite())
                .ok_or_else(wrong)?;
            if (*integer && number.fract() != 0.0)
                || minimum.is_some_and(|min| number < min)
                || maximum.is_some_and(|max| number > max)
            {
                return Err(wrong());
            }
            Ok(if *integer {
                json!(number as i64)
            } else {
                json!(number)
            })
        }
        FieldKind::Boolean => value.as_bool().map(Value::Bool).ok_or_else(wrong),
        FieldKind::Choice { options, multiple } => {
            let known = |id: &str| options.iter().any(|(value, _)| value == id);
            if *multiple {
                let picked = value.as_array().ok_or_else(wrong)?;
                let mut ids = Vec::new();
                for entry in picked {
                    let id = entry.as_str().filter(|id| known(id)).ok_or_else(wrong)?;
                    ids.push(Value::String(id.to_owned()));
                }
                Ok(Value::Array(ids))
            } else {
                let id = value.as_str().filter(|id| known(id)).ok_or_else(wrong)?;
                Ok(Value::String(id.to_owned()))
            }
        }
    }
}

pub fn accept(view: &ElicitationView, content: &Map<String, Value>) -> Result<Value, String> {
    if view.mode == "url" {
        return Ok(json!({"action": "accept"}));
    }
    let mut answer = Map::new();
    for field in &view.fields {
        match content.get(&field.name).filter(|value| !value.is_null()) {
            Some(value) => {
                answer.insert(field.name.clone(), check(field, value)?);
            }
            None if field.required => {
                return Err(format!("Fill in {}.", label(field)));
            }
            None => {}
        }
    }
    Ok(json!({"action": "accept", "content": answer}))
}

pub fn decline() -> Value {
    json!({"action": "decline"})
}

pub fn cancel() -> Value {
    json!({"action": "cancel"})
}

#[cfg(test)]
mod tests {
    use super::*;

    fn form(properties: Value, required: Value) -> Value {
        json!({"mode": "form", "sessionId": "s", "message": "Sign in",
            "requestedSchema": {"type": "object", "properties": properties, "required": required}})
    }

    #[test]
    fn form_schemas_with_string_number_boolean_and_enum_parse() {
        let view = parse_create(
            &form(
                json!({
                    "name": {"type": "string", "title": "Name", "maxLength": 40},
                    "age": {"type": "integer", "minimum": 0},
                    "ok": {"type": "boolean", "default": true},
                    "region": {"type": "string", "oneOf": [{"const": "eu", "title": "Europe"}, {"const": "us", "title": "US"}]},
                    "tags": {"type": "array", "items": {"type": "string", "enum": ["a", "b"]}},
                }),
                json!(["name"]),
            ),
            100,
        )
        .unwrap();
        assert_eq!(view.fields.len(), 5);
        assert_eq!(view.expires_at, 100 + ELICITATION_TTL_MS);
        let region = view.fields.iter().find(|f| f.name == "region").unwrap();
        assert!(
            matches!(&region.kind, FieldKind::Choice { options, multiple: false } if options[0] == ("eu".into(), "Europe".into()))
        );
        let tags = view.fields.iter().find(|f| f.name == "tags").unwrap();
        assert!(matches!(
            &tags.kind,
            FieldKind::Choice { multiple: true, .. }
        ));
        assert!(
            view.fields
                .iter()
                .find(|f| f.name == "name")
                .unwrap()
                .required
        );
    }

    #[test]
    fn url_mode_requires_an_http_url_without_credentials() {
        let link = |url: &str| {
            parse_create(
                &json!({"mode": "url", "sessionId": "s", "elicitationId": "e1", "url": url, "message": "Open"}),
                1,
            )
        };
        assert!(link("https://u:p@x.example").is_err());
        assert!(link("http://example.com").is_err());
        assert!(link("http://localhost:8080/cb").is_ok());
        assert!(link("https://claude.ai/device").is_ok());
        assert!(link("file:///etc/passwd").is_err());
    }

    #[test]
    fn accept_validates_required_fields_and_types() {
        let view = parse_create(
            &form(
                json!({"name": {"type": "string"}, "age": {"type": "integer", "maximum": 120}}),
                json!(["name"]),
            ),
            1,
        )
        .unwrap();
        let answer = |value: Value| accept(&view, value.as_object().unwrap());
        assert!(answer(json!({"age": 3})).is_err());
        assert!(answer(json!({"name": 3})).is_err());
        assert!(answer(json!({"name": "A", "age": 3.5})).is_err());
        assert!(answer(json!({"name": "A", "age": 300})).is_err());
        assert_eq!(
            answer(json!({"name": "A", "age": 30, "extra": "x"})).unwrap(),
            json!({"action": "accept", "content": {"name": "A", "age": 30}})
        );
    }

    #[test]
    fn password_and_token_fields_are_marked_secret() {
        let view = parse_create(
            &form(
                json!({"password": {"type": "string", "default": "hunter2"},
                       "code": {"type": "string", "title": "Access token"},
                       "user": {"type": "string"}}),
                json!([]),
            ),
            1,
        )
        .unwrap();
        let secret = |name: &str| view.fields.iter().find(|f| f.name == name).unwrap().secret;
        assert!(secret("password") && secret("code") && !secret("user"));
        assert!(view
            .fields
            .iter()
            .find(|f| f.name == "password")
            .unwrap()
            .default
            .is_none());
    }

    #[test]
    fn more_than_32_fields_are_refused() {
        let properties: Map<String, Value> = (0..33)
            .map(|index| (format!("f{index}"), json!({"type": "string"})))
            .collect();
        assert!(parse_create(&form(Value::Object(properties), json!([])), 1).is_err());
    }

    #[test]
    fn unknown_modes_and_unscoped_questions_are_refused() {
        assert!(parse_create(&json!({"mode": "telepathy", "sessionId": "s"}), 1).is_err());
        assert!(parse_create(
            &json!({"mode": "form", "requestedSchema": {"properties": {}}}),
            1
        )
        .is_err());
        let request = parse_create(
            &json!({"mode": "form", "requestId": 7, "requestedSchema": {"properties": {"x": {"type": "string"}}}}),
            1,
        )
        .unwrap();
        assert!(request.request_scoped && request.session_id.is_none());
    }
}
