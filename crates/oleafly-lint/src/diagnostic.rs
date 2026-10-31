use std::cmp::Ordering;

use oleafly_preflight::messages::MessageRef;
use oleafly_preflight::types::Severity;
use serde::{Deserialize, Serialize};

use crate::messages::editor_catalog;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LintSource {
    Latex,
    Bibtex,
    Harper,
}

impl LintSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Latex => "latex",
            Self::Bibtex => "bibtex",
            Self::Harper => "harper",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum LintMessage {
    Catalog(MessageRef),
    Text(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SuggestionKind {
    Replace,
    Remove,
    InsertAfter,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FixSuggestion {
    pub kind: SuggestionKind,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LintDiagnostic {
    pub from: usize,
    pub to: usize,
    pub severity: Severity,
    pub message: LintMessage,
    pub source: LintSource,
    pub rule_id: String,
    pub suggestions: Vec<FixSuggestion>,
    pub fixable: bool,
}

impl LintDiagnostic {
    pub fn catalog(
        from: usize,
        to: usize,
        severity: Severity,
        message: MessageRef,
        source: LintSource,
    ) -> Self {
        Self {
            from,
            to: to.max(from + 1),
            severity,
            rule_id: rule_id_for_key(&message.key),
            message: LintMessage::Catalog(message),
            source,
            suggestions: Vec::new(),
            fixable: false,
        }
    }

    pub fn key(&self) -> Option<&str> {
        match &self.message {
            LintMessage::Catalog(message) => Some(&message.key),
            LintMessage::Text(_) => None,
        }
    }
}

fn kebab(name: &str) -> String {
    let mut out = String::with_capacity(name.len() + 4);
    for (index, ch) in name.chars().enumerate() {
        if ch.is_ascii_uppercase() {
            if index > 0 {
                out.push('-');
            }
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

pub fn rule_id_for_key(key: &str) -> String {
    let parts: Vec<&str> = key.split('.').collect();
    match parts.as_slice() {
        [namespace, "lint", name] => format!("{namespace}/{}", kebab(name)),
        [namespace, group, name] => format!("{namespace}/{group}-{}", kebab(name)),
        _ => key.replace('.', "/"),
    }
}

pub fn render(message: &LintMessage) -> String {
    match message {
        LintMessage::Catalog(message) => editor_catalog().render(message),
        LintMessage::Text(text) => text.clone(),
    }
}

pub fn canonical_params(message: &MessageRef) -> String {
    serde_json::to_string(&message.params).unwrap_or_default()
}

pub fn compare(left: &LintDiagnostic, right: &LintDiagnostic) -> Ordering {
    left.from
        .cmp(&right.from)
        .then_with(|| left.to.cmp(&right.to))
        .then_with(|| match (&left.message, &right.message) {
            (LintMessage::Catalog(a), LintMessage::Catalog(b)) => a
                .key
                .cmp(&b.key)
                .then_with(|| canonical_params(a).cmp(&canonical_params(b))),
            (a, b) => render(a).cmp(&render(b)),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_preflight::msg;

    #[test]
    fn rule_ids_are_stable_kebab_names() {
        assert_eq!(
            rule_id_for_key("latex.lint.unmatchedClosingBrace"),
            "latex/unmatched-closing-brace"
        );
        assert_eq!(
            rule_id_for_key("latex.xparse.unknownType"),
            "latex/xparse-unknown-type"
        );
        assert_eq!(
            rule_id_for_key("bibtex.lint.invalidYear"),
            "bibtex/invalid-year"
        );
    }

    #[test]
    fn editor_messages_render_english() {
        let message = LintMessage::Catalog(msg!("latex.lint.duplicateLabel", "label" => "a"));
        assert_eq!(
            render(&message),
            "Duplicate label “a” (first defined earlier in this file)"
        );
    }

    #[test]
    fn diagnostics_cover_at_least_one_unit() {
        let diagnostic = LintDiagnostic::catalog(
            4,
            4,
            Severity::Error,
            msg!("latex.lint.unmatchedClosingBrace"),
            LintSource::Latex,
        );
        assert_eq!((diagnostic.from, diagnostic.to), (4, 5));
    }
}
