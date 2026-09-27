use std::collections::BTreeMap;
use std::fmt;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PREFIX: &str = "@oleafly/error:";

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: &'static str,
    pub params: BTreeMap<String, String>,
    pub detail: Option<String>,
}

impl AppError {
    pub fn new(code: &'static str) -> Self {
        Self {
            code,
            params: BTreeMap::new(),
            detail: None,
        }
    }

    pub fn param(mut self, name: &str, value: impl ToString) -> Self {
        self.params.insert(name.to_string(), value.to_string());
        self
    }

    pub fn detail(mut self, detail: impl ToString) -> Self {
        self.detail = Some(detail.to_string());
        self
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let json = serde_json::to_string(self).map_err(|_| fmt::Error)?;
        write!(f, "{PREFIX}{json}")
    }
}

impl From<AppError> for String {
    fn from(error: AppError) -> Self {
        error.to_string()
    }
}

#[derive(Deserialize)]
struct Envelope {
    code: String,
    #[serde(default)]
    params: BTreeMap<String, String>,
    #[serde(default)]
    detail: Option<String>,
}

fn english_template(key: &str) -> Option<&'static str> {
    static CATALOG: OnceLock<Value> = OnceLock::new();
    let catalog = CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/i18n/locales/en/errors.json"))
            .unwrap_or_default()
    });
    key.split('.')
        .try_fold(catalog, |node, part| node.get(part))?
        .as_str()
}

fn interpolate<'a>(template: &str, params: impl IntoIterator<Item = (&'a str, &'a str)>) -> String {
    params
        .into_iter()
        .fold(template.to_string(), |text, (name, value)| {
            text.replace(&format!("{{{{{name}}}}}"), value)
        })
}

pub(crate) fn english(text: &str) -> Option<String> {
    let envelope: Envelope = serde_json::from_str(text.strip_prefix(PREFIX)?).ok()?;
    let template = english_template(&envelope.code)?;
    let message = interpolate(
        template,
        envelope
            .params
            .iter()
            .map(|(name, value)| (name.as_str(), value.as_str())),
    );
    Some(match envelope.detail {
        Some(detail) => interpolate(
            english_template("withDetail").unwrap_or("{{message}} ({{detail}})"),
            [("message", message.as_str()), ("detail", detail.as_str())],
        ),
        None => message,
    })
}

pub(crate) fn english_error(message: &str) -> String {
    english(message).unwrap_or_else(|| message.to_string())
}

fn english_error_field(value: &mut Value) -> bool {
    let Some(Value::String(text)) = value.get_mut("error") else {
        return false;
    };
    match english(text) {
        Some(message) => {
            *text = message;
            true
        }
        None => false,
    }
}

pub(crate) fn english_tool_output(text: &str) -> Option<String> {
    if !text.contains(PREFIX) {
        return None;
    }
    if let Some(message) = english(text) {
        return Some(message);
    }
    let mut value: Value = serde_json::from_str(text).ok()?;
    english_error_field(&mut value).then(|| value.to_string())
}

pub(crate) fn english_tool_result(result: &mut Value) -> bool {
    if let Value::String(text) = result {
        return match english(text) {
            Some(message) => {
                *text = message;
                true
            }
            None => false,
        };
    }
    let mut changed = english_error_field(result);
    if result.get("isError") != Some(&Value::Bool(true)) {
        return changed;
    }
    let Some(Value::Array(items)) = result.get_mut("content") else {
        return changed;
    };
    for item in items {
        if item.get("type").and_then(Value::as_str) != Some("text") {
            continue;
        }
        if let Some(Value::String(text)) = item.get_mut("text") {
            if let Some(message) = english_tool_output(text) {
                *text = message;
                changed = true;
            }
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_with_the_frontend_prefix() {
        let text: String = AppError::new("project.name_conflict")
            .param("name", "Thesis")
            .detail("existing folder")
            .into();
        assert!(text.starts_with(PREFIX));
        let json: serde_json::Value = serde_json::from_str(&text[PREFIX.len()..]).unwrap();
        assert_eq!(json["code"], "project.name_conflict");
        assert_eq!(json["params"]["name"], "Thesis");
        assert_eq!(json["detail"], "existing folder");
    }

    #[test]
    fn escapes_untrusted_params() {
        let text: String = AppError::new("x").param("v", "a\"b\\c\n").into();
        assert!(serde_json::from_str::<serde_json::Value>(&text[PREFIX.len()..]).is_ok());
    }

    const READ_ONLY_MAIN: &str = "Oleafly can't make this change because main.tex or its folder is read-only. Copy the folder you opened into your library and edit it there.";

    fn read_only_main() -> String {
        AppError::new("project.folder_read_only")
            .param("name", "main.tex")
            .into()
    }

    #[test]
    fn a_known_code_renders_in_english_with_its_params() {
        assert_eq!(english(&read_only_main()).as_deref(), Some(READ_ONLY_MAIN));
        assert_eq!(english_error(&read_only_main()), READ_ONLY_MAIN);
        let detailed: String = AppError::new("project.trash_unavailable")
            .param("path", "old.tex")
            .detail("no trash")
            .into();
        assert_eq!(
            english(&detailed).as_deref(),
            Some("Oleafly couldn't move old.tex to the Trash or Recycle Bin. The drive might not have one. (no trash)")
        );
    }

    #[test]
    fn unknown_codes_and_plain_text_are_not_rewritten() {
        let unknown: String = AppError::new("compile.failed").detail("log").into();
        assert_eq!(english(&unknown), None);
        assert_eq!(english_error(&unknown), unknown);
        assert_eq!(english_tool_output(&unknown), None);
        assert_eq!(english("failed to write main.tex"), None);
        assert_eq!(english_error("disk full"), "disk full");
        assert_eq!(english_tool_output("{\"error\":\"disk full\"}"), None);
    }

    #[test]
    fn a_tool_error_carries_the_english_sentence_instead_of_the_code() {
        let output =
            serde_json::json!({ "error": read_only_main(), "path": "main.tex" }).to_string();
        let rewritten = english_tool_output(&output).unwrap();
        let parsed: Value = serde_json::from_str(&rewritten).unwrap();
        assert_eq!(parsed["error"], READ_ONLY_MAIN);
        assert_eq!(parsed["path"], "main.tex");
        assert_eq!(
            english_tool_output(&read_only_main()).as_deref(),
            Some(READ_ONLY_MAIN)
        );

        let mut result = serde_json::json!({
            "content": [{ "type": "text", "text": output }],
            "isError": true,
        });
        assert!(english_tool_result(&mut result));
        let text = result["content"][0]["text"].as_str().unwrap();
        let parsed: Value = serde_json::from_str(text).unwrap();
        assert_eq!(parsed["error"], READ_ONLY_MAIN);
        assert_eq!(result["isError"], true);

        let mut bare = Value::String(read_only_main());
        assert!(english_tool_result(&mut bare));
        assert_eq!(bare, READ_ONLY_MAIN);
    }

    #[test]
    fn file_contents_in_successful_results_are_never_rewritten() {
        let document = serde_json::json!({ "error": read_only_main() }).to_string();
        let read = serde_json::json!({ "path": "data.json", "content": document }).to_string();
        assert_eq!(english_tool_output(&read), None);

        let mut result = serde_json::json!({ "content": [{ "type": "text", "text": read }] });
        let before = result.clone();
        assert!(!english_tool_result(&mut result));
        assert_eq!(result, before);

        let mut raw = serde_json::json!({ "content": [{ "type": "text", "text": document }] });
        let before = raw.clone();
        assert!(!english_tool_result(&mut raw));
        assert_eq!(raw, before);

        let listing =
            serde_json::json!({ "tasks": [{ "id": "t1", "error": read_only_main() }] }).to_string();
        assert_eq!(english_tool_output(&listing), None);
        let mut failed_listing = serde_json::json!({
            "content": [{ "type": "text", "text": listing }],
            "isError": true,
        });
        let before = failed_listing.clone();
        assert!(!english_tool_result(&mut failed_listing));
        assert_eq!(failed_listing, before);
    }
}
