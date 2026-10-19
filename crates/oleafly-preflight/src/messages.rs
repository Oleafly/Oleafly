//! Message references and the English catalog.
//!
//! Findings carry a [`MessageRef`] (a catalog key plus parameters) exactly
//! like the TypeScript rules, so goldens compare keys and parameters rather
//! than English sentences. Text comes from the app's own English catalog,
//! embedded at build time, and is rendered the way the test translator in
//! `packages/i18n-contract/src/testing.ts` renders it.

use std::collections::BTreeMap;
use std::fmt;
use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::text::{js_number_to_string, js_trim};
use crate::types::Finding;

/// A message parameter: JavaScript `string | number`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ParamValue {
    Int(i64),
    Float(f64),
    Text(String),
}

impl ParamValue {
    fn as_number(&self) -> Option<f64> {
        match self {
            Self::Int(value) => Some(*value as f64),
            Self::Float(value) => Some(*value),
            Self::Text(_) => None,
        }
    }
}

/// `String(value)` in JavaScript.
impl fmt::Display for ParamValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Int(value) => write!(f, "{value}"),
            Self::Float(value) => f.write_str(&js_number_to_string(*value)),
            Self::Text(value) => f.write_str(value),
        }
    }
}

macro_rules! int_param {
    ($($ty:ty),*) => {
        $(impl From<$ty> for ParamValue {
            fn from(value: $ty) -> Self {
                Self::Int(value as i64)
            }
        })*
    };
}

int_param!(i32, i64, u32, u64, usize);

impl From<f64> for ParamValue {
    fn from(value: f64) -> Self {
        Self::Float(value)
    }
}

impl From<String> for ParamValue {
    fn from(value: String) -> Self {
        Self::Text(value)
    }
}

impl From<&String> for ParamValue {
    fn from(value: &String) -> Self {
        Self::Text(value.clone())
    }
}

impl From<&str> for ParamValue {
    fn from(value: &str) -> Self {
        Self::Text(value.to_string())
    }
}

pub type Params = BTreeMap<String, ParamValue>;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MessageRef {
    pub key: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub params: Params,
}

pub fn message(key: &str) -> MessageRef {
    MessageRef {
        key: key.to_string(),
        params: Params::new(),
    }
}

/// `msg!("rules.x.title", "count" => 2, "file" => path)`.
#[macro_export]
macro_rules! msg {
    ($key:expr $(, $name:literal => $value:expr)* $(,)?) => {{
        #[allow(unused_mut)]
        let mut params = $crate::messages::Params::new();
        $(params.insert($name.to_string(), $crate::messages::ParamValue::from($value));)*
        $crate::messages::MessageRef { key: ($key).to_string(), params }
    }};
}

static PLACEHOLDER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\{\{\s*([0-9A-Za-z_.-]+)\s*\}\}").unwrap());

/// An English message catalog (a nested JSON object of strings).
pub struct Catalog {
    root: serde_json::Value,
}

static PREFLIGHT: LazyLock<Catalog> = LazyLock::new(|| {
    Catalog::from_json(
        include_str!("../../../src/i18n/locales/en/preflight.json"),
        None,
    )
});

impl Catalog {
    /// Parses `json`, optionally keeping only one top-level subtree (the
    /// editor catalog keeps its package strings under `package`).
    pub fn from_json(json: &str, subtree: Option<&str>) -> Self {
        let parsed: serde_json::Value =
            serde_json::from_str(json).unwrap_or(serde_json::Value::Null);
        let root = match subtree {
            Some(name) => parsed.get(name).cloned().unwrap_or(serde_json::Value::Null),
            None => parsed,
        };
        Self { root }
    }

    /// The preflight catalog the app ships (`src/i18n/locales/en/preflight.json`).
    pub fn preflight() -> &'static Catalog {
        &PREFLIGHT
    }

    /// The string at a dotted key (`catalogEntry` in the TypeScript test
    /// translator): `None` for a missing key or a key that names an object.
    pub fn template(&self, key: &str) -> Option<&str> {
        let mut node = &self.root;
        for part in key.split('.') {
            node = node.as_object()?.get(part)?;
        }
        node.as_str()
    }

    /// The object at a dotted key, for callers that list a rule's strings.
    pub fn object(&self, key: &str) -> Option<&serde_json::Map<String, serde_json::Value>> {
        let mut node = &self.root;
        for part in key.split('.') {
            node = node.as_object()?.get(part)?;
        }
        node.as_object()
    }

    /// English plural forms first (`key_one` / `key_other` when `count` is a
    /// number), then the key itself, then the bare key as text. Placeholders
    /// without a parameter stay as written.
    pub fn render(&self, message: &MessageRef) -> String {
        let plural = message
            .params
            .get("count")
            .and_then(ParamValue::as_number)
            .and_then(|count| {
                let form = if count.abs() == 1.0 { "one" } else { "other" };
                self.template(&format!("{}_{form}", message.key))
            });
        let template = plural
            .or_else(|| self.template(&message.key))
            .unwrap_or(&message.key);
        interpolate(template, &message.params)
    }
}

fn interpolate(template: &str, params: &Params) -> String {
    if params.is_empty() {
        return template.to_string();
    }
    PLACEHOLDER
        .replace_all(template, |captures: &regex::Captures<'_>| {
            match params.get(&captures[1]) {
                Some(value) => value.to_string(),
                None => captures[0].to_string(),
            }
        })
        .into_owned()
}

/// A finding's detail followed by its detail parts, joined with spaces, as
/// `src/components/preflight/message.ts` renders it.
pub fn render_detail(catalog: &Catalog, finding: &Finding) -> String {
    std::iter::once(&finding.detail)
        .chain(finding.detail_parts.iter().flatten())
        .map(|part| catalog.render(part))
        .collect::<Vec<_>>()
        .join(" ")
}

static ESCAPED_PLACEHOLDER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\\\{\{\s*[0-9A-Za-z_.-]+\s*\}\}").unwrap());
static COUNT_PLACEHOLDER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\{\{\s*count\s*\}\} ?").unwrap());
static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r" {2,}").unwrap());

/// Rule text without parameters, for SARIF rule descriptions: `\{{name}}`
/// tokens and a leading `{{count}} ` disappear, other placeholders become
/// `…`, and the first letter is upper case.
pub fn describe_template(template: &str) -> String {
    let without_commands = ESCAPED_PLACEHOLDER.replace_all(template, "");
    let without_count = COUNT_PLACEHOLDER.replace_all(&without_commands, "");
    let elided = PLACEHOLDER.replace_all(&without_count, "…");
    let collapsed = SPACES.replace_all(&elided, " ");
    let trimmed = js_trim(&collapsed);
    let mut chars = trimmed.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

fn first_template<'c>(catalog: &'c Catalog, base: &str, prefix: &str) -> Option<&'c str> {
    let entries = catalog.object(base)?;
    for preferred in [
        prefix.to_string(),
        format!("{prefix}_other"),
        format!("{prefix}_one"),
    ] {
        if let Some(text) = entries.get(&preferred).and_then(|value| value.as_str()) {
            return Some(text);
        }
    }
    let mut names: Vec<&String> = entries
        .keys()
        .filter(|name| name.starts_with(prefix))
        .collect();
    names.sort();
    names
        .into_iter()
        .find_map(|name| entries.get(name).and_then(|value| value.as_str()))
}

/// A short and a full description of a preflight rule from the catalog's
/// `rules.<id>.title*` and `rules.<id>.detail*` strings.
pub fn describe_rule(id: &str) -> (String, String) {
    let catalog = Catalog::preflight();
    let base = format!("rules.{id}");
    let short = first_template(catalog, &base, "title")
        .map(describe_template)
        .unwrap_or_else(|| id.to_string());
    let full = first_template(catalog, &base, "detail")
        .map(describe_template)
        .unwrap_or_else(|| short.clone());
    (short, full)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_uses_english_plural_forms() {
        let c = Catalog::preflight();
        assert_eq!(
            c.render(&msg!("rules.refs-uncited-entries.title", "count" => 1)),
            "1 uncited bibliography entry"
        );
        assert_eq!(
            c.render(&msg!("rules.refs-uncited-entries.title", "count" => 2)),
            "2 uncited bibliography entries"
        );
    }

    #[test]
    fn render_keeps_unknown_placeholders_and_falls_back_to_the_key() {
        let c = Catalog::preflight();
        assert_eq!(
            c.render(&message("rules.refs-undefined-cite.title")),
            "Citation \"{{key}}\" is not in any .bib"
        );
        assert_eq!(c.render(&message("no.such.key")), "no.such.key");
        assert_eq!(
            c.render(&msg!("rules.refs-undefined-cite.title", "key" => "smith")),
            "Citation \"smith\" is not in any .bib"
        );
    }

    #[test]
    fn describe_template_drops_count_and_elides_params() {
        assert_eq!(
            describe_template("{{count}} uncited bibliography entries"),
            "Uncited bibliography entries"
        );
        assert_eq!(
            describe_template("Citation \"{{key}}\" is not in any .bib"),
            "Citation \"…\" is not in any .bib"
        );
        assert_eq!(
            describe_template("\\{{command}} requires a braced argument"),
            "Requires a braced argument"
        );
    }

    #[test]
    fn params_print_like_javascript() {
        assert_eq!(ParamValue::Float(10.0).to_string(), "10");
        assert_eq!(ParamValue::Int(3).to_string(), "3");
        let json = serde_json::to_value(msg!("k", "count" => 2usize)).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "key": "k", "params": { "count": 2 } })
        );
        let bare = serde_json::to_value(message("k")).unwrap();
        assert_eq!(bare, serde_json::json!({ "key": "k" }));
    }

    #[test]
    fn rules_have_descriptions() {
        let (short, full) = describe_rule("refs-uncited-entries");
        assert_eq!(short, "Uncited bibliography entries");
        assert!(full.starts_with("Unused entries"));
    }
}
