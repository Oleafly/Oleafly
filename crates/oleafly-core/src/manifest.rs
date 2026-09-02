use crate::{Error, ErrorKind, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Engine {
    Tectonic,
    Latexmk,
    Typst,
    Markdown,
}

impl Engine {
    pub fn from_manifest(value: &str, main_document: &str) -> Result<Self> {
        let engine = match value.trim().to_ascii_lowercase().as_str() {
            "" | "latex" | "tex" | "tectonic" | "xetex" | "luatex" => Self::Tectonic,
            "latexmk" => Self::Latexmk,
            "typst" | "typ" => Self::Typst,
            "markdown" | "md" | "pandoc" => Self::Markdown,
            _ => {
                return Err(Error::new(
                    ErrorKind::InvalidManifest,
                    format!("unsupported document engine `{value}`"),
                ))
            }
        };
        if !engine.accepts(main_document) {
            return Err(Error::new(
                ErrorKind::InvalidManifest,
                format!(
                    "engine `{}` cannot compile `{main_document}`",
                    engine.manifest_name()
                ),
            ));
        }
        Ok(engine)
    }

    pub fn infer(main_document: &str) -> Result<Self> {
        let extension = Path::new(main_document)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        match extension.to_ascii_lowercase().as_str() {
            "tex" | "ltx" | "latex" => Ok(Self::Tectonic),
            "typ" => Ok(Self::Typst),
            "md" | "markdown" => Ok(Self::Markdown),
            _ => Err(Error::new(
                ErrorKind::InvalidInput,
                format!("cannot infer an engine for `{main_document}`"),
            )),
        }
    }

    pub fn accepts(self, main_document: &str) -> bool {
        let extension = Path::new(main_document)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        match self {
            Self::Tectonic | Self::Latexmk => {
                matches!(
                    extension.to_ascii_lowercase().as_str(),
                    "tex" | "ltx" | "latex"
                )
            }
            Self::Typst => extension.eq_ignore_ascii_case("typ"),
            Self::Markdown => {
                matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown")
            }
        }
    }

    pub const fn manifest_name(self) -> &'static str {
        match self {
            Self::Tectonic => "xetex",
            Self::Latexmk => "latexmk",
            Self::Typst => "typst",
            Self::Markdown => "markdown",
        }
    }

    pub const fn canonical_name(self) -> &'static str {
        match self {
            Self::Tectonic => "tectonic",
            Self::Latexmk => "latexmk",
            Self::Typst => "typst",
            Self::Markdown => "markdown",
        }
    }

    pub const fn default_main_document(self) -> &'static str {
        match self {
            Self::Tectonic | Self::Latexmk => "main.tex",
            Self::Typst => "main.typ",
            Self::Markdown => "main.md",
        }
    }

    pub const fn tool_name(self) -> &'static str {
        match self {
            Self::Tectonic => "tectonic",
            Self::Latexmk => "latexmk",
            Self::Typst => "typst",
            Self::Markdown => "pandoc",
        }
    }
}

#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
pub struct TexSpec {
    #[serde(default)]
    pub distribution: String,
    #[serde(default)]
    pub distribution_label: String,
    #[serde(default)]
    pub packages: BTreeMap<String, String>,
    #[serde(default)]
    pub recorded_at: f64,
}

#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
pub struct ExportRecord {
    pub date: f64,
    pub filename: String,
    pub path: String,
}

#[derive(Default, Clone, Debug, PartialEq, Eq)]
pub enum CheckpointCaptureMode {
    #[default]
    EngineDependencies,
    Unsupported(String),
}

impl CheckpointCaptureMode {
    pub fn as_str(&self) -> &str {
        match self {
            Self::EngineDependencies => "engine_dependencies",
            Self::Unsupported(value) => value,
        }
    }
}

impl Serialize for CheckpointCaptureMode {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for CheckpointCaptureMode {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Ok(match value.as_str() {
            "engine_dependencies" => Self::EngineDependencies,
            _ => Self::Unsupported(value),
        })
    }
}

#[derive(Default, Clone, Debug, PartialEq)]
pub struct CheckpointPolicy {
    pub mode: CheckpointCaptureMode,
    pub always_include: Vec<String>,
    pub ignored: Vec<String>,
    pub extra: HashMap<String, serde_json::Value>,
    invalid: Option<InvalidCheckpointPolicy>,
}

#[derive(Clone, Debug, PartialEq)]
struct InvalidCheckpointPolicy {
    raw: serde_json::Value,
    reason: String,
}

#[derive(Serialize, Deserialize)]
struct CheckpointPolicyFields {
    #[serde(default)]
    mode: CheckpointCaptureMode,
    #[serde(default)]
    always_include: Vec<String>,
    #[serde(default)]
    ignored: Vec<String>,
    #[serde(flatten)]
    extra: HashMap<String, serde_json::Value>,
}

impl Serialize for CheckpointPolicy {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        if let Some(invalid) = &self.invalid {
            return invalid.raw.serialize(serializer);
        }
        CheckpointPolicyFields {
            mode: self.mode.clone(),
            always_include: self.always_include.clone(),
            ignored: self.ignored.clone(),
            extra: self.extra.clone(),
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for CheckpointPolicy {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw = serde_json::Value::deserialize(deserializer)?;
        match serde_json::from_value::<CheckpointPolicyFields>(raw.clone()) {
            Ok(fields) => Ok(Self {
                mode: fields.mode,
                always_include: fields.always_include,
                ignored: fields.ignored,
                extra: fields.extra,
                invalid: None,
            }),
            Err(error) => Ok(Self {
                invalid: Some(InvalidCheckpointPolicy {
                    raw,
                    reason: error.to_string(),
                }),
                ..Self::default()
            }),
        }
    }
}

impl CheckpointPolicy {
    /// Validate policy only when a checkpoint or policy editor needs it.
    /// Ordinary project open and compile deliberately do not call this method.
    pub fn validate(&self) -> Result<()> {
        if let Some(invalid) = &self.invalid {
            return Err(Error::new(
                ErrorKind::InvalidManifest,
                format!("invalid checkpoints policy: {}", invalid.reason),
            ));
        }
        if let CheckpointCaptureMode::Unsupported(mode) = &self.mode {
            return Err(Error::new(
                ErrorKind::InvalidManifest,
                format!("unsupported checkpoints.mode {mode:?}"),
            ));
        }
        for pattern in &self.always_include {
            validate_checkpoint_pattern("always_include", pattern, false)?;
        }
        for pattern in &self.ignored {
            validate_checkpoint_pattern("ignored", pattern, true)?;
        }
        Ok(())
    }

    pub fn is_always_included(&self, relative_path: &str) -> bool {
        self.always_include
            .iter()
            .any(|pattern| checkpoint_pattern_matches(pattern, relative_path))
    }

    pub fn is_ignored(&self, relative_path: &str) -> bool {
        self.ignored
            .iter()
            .any(|pattern| checkpoint_pattern_matches(pattern, relative_path))
    }
}

fn checkpoint_pattern_matches(pattern: &str, relative_path: &str) -> bool {
    let pattern_segments = pattern.split('/').collect::<Vec<_>>();
    let path_segments = relative_path.split('/').collect::<Vec<_>>();
    let contains_wildcard = pattern.contains(['*', '?']);
    if !contains_wildcard
        && path_segments.len() >= pattern_segments.len()
        && pattern_segments
            .iter()
            .zip(&path_segments)
            .all(|(expected, actual)| expected.eq_ignore_ascii_case(actual))
    {
        return true;
    }
    pattern_segments.len() == path_segments.len()
        && pattern_segments
            .iter()
            .zip(path_segments)
            .all(|(expected, actual)| wildcard_matches_ascii_case_insensitive(expected, actual))
}

fn validate_checkpoint_pattern(
    field: &str,
    pattern: &str,
    protects_project_manifest: bool,
) -> Result<()> {
    let invalid = |reason: &str| {
        Error::new(
            ErrorKind::InvalidManifest,
            format!("invalid checkpoints.{field} pattern {pattern:?}: {reason}"),
        )
    };
    if pattern.is_empty() {
        return Err(invalid("patterns cannot be empty"));
    }
    if pattern.chars().any(char::is_control) {
        return Err(invalid("control characters are not portable"));
    }
    if pattern.nfc().collect::<String>() != pattern {
        return Err(invalid("use Unicode NFC normalization"));
    }
    if pattern.starts_with('/') {
        return Err(invalid("use a relative project path"));
    }
    if pattern.contains('\\') {
        return Err(invalid("use forward slashes"));
    }
    if pattern.contains(':') {
        return Err(invalid(
            "drive paths, URLs, and credential schemes are not allowed",
        ));
    }
    if pattern.contains(['[', ']', '{', '}']) {
        return Err(invalid("only '*' and '?' glob tokens are supported"));
    }

    let segments = pattern.split('/').collect::<Vec<_>>();
    if segments.iter().any(|segment| segment.is_empty()) {
        return Err(invalid("path segments cannot be empty"));
    }
    if segments
        .iter()
        .any(|segment| *segment == "." || *segment == "..")
    {
        return Err(invalid("'.' and '..' path segments are not allowed"));
    }
    if segments
        .iter()
        .any(|segment| segment.ends_with('.') || segment.ends_with(' '))
    {
        return Err(invalid("path segments cannot end with a dot or space"));
    }
    if segments.iter().any(|segment| {
        let stem = segment.split('.').next().unwrap_or_default();
        !stem.contains(['*', '?']) && is_windows_reserved_component(stem)
    }) {
        return Err(invalid("the pattern contains a Windows-reserved path name"));
    }
    if segments.iter().any(|segment| {
        wildcard_matches_ascii_case_insensitive(segment, ".git")
            || wildcard_matches_ascii_case_insensitive(segment, ".oleafly")
    }) {
        return Err(invalid("the pattern could target protected project data"));
    }
    if protects_project_manifest
        && segments.len() == 1
        && wildcard_matches_ascii_case_insensitive(segments[0], "project.json")
    {
        return Err(invalid("project.json is mandatory and cannot be ignored"));
    }
    Ok(())
}

fn is_windows_reserved_component(stem: &str) -> bool {
    let upper = stem.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || upper
            .strip_prefix("COM")
            .or_else(|| upper.strip_prefix("LPT"))
            .is_some_and(|suffix| suffix.len() == 1 && matches!(suffix.as_bytes()[0], b'1'..=b'9'))
}

fn wildcard_matches_ascii_case_insensitive(pattern: &str, candidate: &str) -> bool {
    let pattern = pattern.to_ascii_lowercase().chars().collect::<Vec<_>>();
    let candidate = candidate.to_ascii_lowercase().chars().collect::<Vec<_>>();
    let (mut pattern_index, mut candidate_index) = (0, 0);
    let (mut star_index, mut star_candidate_index) = (None, 0);

    while candidate_index < candidate.len() {
        if pattern_index < pattern.len()
            && (pattern[pattern_index] == '?'
                || pattern[pattern_index] == candidate[candidate_index])
        {
            pattern_index += 1;
            candidate_index += 1;
        } else if pattern_index < pattern.len() && pattern[pattern_index] == '*' {
            star_index = Some(pattern_index);
            pattern_index += 1;
            star_candidate_index = candidate_index;
        } else if let Some(star) = star_index {
            pattern_index = star + 1;
            star_candidate_index += 1;
            candidate_index = star_candidate_index;
        } else {
            return false;
        }
    }
    while pattern_index < pattern.len() && pattern[pattern_index] == '*' {
        pattern_index += 1;
    }
    pattern_index == pattern.len()
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ProjectManifest {
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_main_document")]
    pub main_doc: String,
    #[serde(default = "default_engine")]
    pub engine: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tex: Option<TexSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tex_flavor: Option<String>,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub exports: Vec<ExportRecord>,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub forked_from: Option<String>,
    #[serde(default)]
    pub checkpoints: CheckpointPolicy,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl Default for ProjectManifest {
    fn default() -> Self {
        Self {
            name: String::new(),
            main_doc: default_main_document(),
            engine: default_engine(),
            tex: None,
            tex_flavor: None,
            color: String::new(),
            kind: String::new(),
            exports: Vec::new(),
            hidden: false,
            forked_from: None,
            checkpoints: CheckpointPolicy::default(),
            extra: HashMap::new(),
        }
    }
}

impl ProjectManifest {
    pub fn engine(&self) -> Result<Engine> {
        Engine::from_manifest(&self.engine, &self.main_doc)
    }

    pub fn normalized_tex_flavor(&self) -> Result<Option<String>> {
        if self.engine()? != Engine::Latexmk {
            return Ok(None);
        }
        match self.tex_flavor.as_deref().map(str::trim) {
            None | Some("") | Some("auto") => Ok(None),
            Some(flavor @ ("pdflatex" | "xelatex" | "lualatex")) => Ok(Some(flavor.to_string())),
            Some(flavor) => Err(Error::new(
                ErrorKind::InvalidManifest,
                format!("unsupported tex_flavor `{flavor}`"),
            )),
        }
    }

    pub fn validate(&self) -> Result<()> {
        if self.main_doc.trim().is_empty() {
            return Err(Error::new(
                ErrorKind::InvalidManifest,
                "project.json has an empty main_doc",
            ));
        }
        self.normalized_tex_flavor()?;
        Ok(())
    }
}

fn default_main_document() -> String {
    "main.tex".to_string()
}

fn default_engine() -> String {
    "xetex".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_manifest_fields_round_trip_with_unknown_fields() {
        let source = r#"{
          "name": "Paper",
          "main_doc": "paper.tex",
          "engine": "latexmk",
          "tex_flavor": "xelatex",
          "future": {"enabled": true}
        }"#;
        let manifest: ProjectManifest = serde_json::from_str(source).unwrap();
        manifest.validate().unwrap();
        let output = serde_json::to_value(manifest).unwrap();
        assert_eq!(output["future"]["enabled"], true);
    }

    #[test]
    fn engine_and_extension_must_agree() {
        let error = Engine::from_manifest("typst", "main.tex").unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidManifest);
    }

    #[test]
    fn missing_checkpoint_policy_defaults_to_engine_dependencies() {
        let manifest: ProjectManifest =
            serde_json::from_str(r#"{"name":"Legacy","main_doc":"main.tex","engine":"xetex"}"#)
                .unwrap();

        let output = serde_json::to_value(manifest).unwrap();
        assert_eq!(output["checkpoints"]["mode"], "engine_dependencies");
        assert_eq!(
            output["checkpoints"]["always_include"],
            serde_json::json!([])
        );
        assert_eq!(output["checkpoints"]["ignored"], serde_json::json!([]));
    }

    #[test]
    fn checkpoint_policy_round_trips_portable_fields_and_future_extensions() {
        let source = r#"{
          "name": "Portable",
          "main_doc": "main.tex",
          "engine": "xetex",
          "checkpoints": {
            "mode": "engine_dependencies",
            "always_include": ["figures/*.png", "research/notes"],
            "ignored": ["scratch/*.tmp"],
            "future_option": {"enabled": true}
          }
        }"#;

        let manifest: ProjectManifest = serde_json::from_str(source).unwrap();
        let output = serde_json::to_value(manifest).unwrap();

        assert_eq!(output["checkpoints"]["mode"], "engine_dependencies");
        assert_eq!(
            output["checkpoints"]["always_include"],
            serde_json::json!(["figures/*.png", "research/notes"])
        );
        assert_eq!(
            output["checkpoints"]["ignored"],
            serde_json::json!(["scratch/*.tmp"])
        );
        assert_eq!(output["checkpoints"]["future_option"]["enabled"], true);
    }

    #[test]
    fn checkpoint_policy_accepts_portable_relative_globs() {
        let policy: CheckpointPolicy = serde_json::from_value(serde_json::json!({
            "mode": "engine_dependencies",
            "always_include": [
                "figures/*.png",
                "research/notes",
                "chapters/section?.tex",
                "references/caf\u{e9}.bib"
            ],
            "ignored": ["scratch/*.tmp", "generated/output-?.bib"]
        }))
        .unwrap();

        policy.validate().unwrap();
    }

    #[test]
    fn checkpoint_policy_matches_capture_and_ignore_paths_by_segment() {
        let policy: CheckpointPolicy = serde_json::from_value(serde_json::json!({
            "always_include": ["figures/*.png", "research/notes"],
            "ignored": ["scratch/*.tmp"]
        }))
        .unwrap();
        policy.validate().unwrap();

        assert!(policy.is_always_included("figures/plot.png"));
        assert!(!policy.is_always_included("figures/deep/plot.png"));
        assert!(policy.is_always_included("research/notes"));
        assert!(policy.is_always_included("research/notes/day-1.md"));
        assert!(policy.is_ignored("scratch/draft.tmp"));
        assert!(!policy.is_ignored("chapters/scratch/draft.tmp"));

        let unicode: CheckpointPolicy = serde_json::from_value(serde_json::json!({
            "always_include": ["references/secret-?.bib"]
        }))
        .unwrap();
        unicode.validate().unwrap();
        assert!(unicode.is_always_included("references/secret-é.bib"));
        assert!(!unicode.is_always_included("references/secret-ab.bib"));
    }

    #[test]
    fn checkpoint_policy_rejects_non_portable_or_protected_patterns() {
        let cases = [
            ("empty", "", false),
            ("absolute", "/private/notes.tex", false),
            ("drive", "C:/Users/me/notes.tex", false),
            ("unc", "//server/share/notes.tex", false),
            ("parent", "notes/../private.tex", false),
            ("backslash", "notes\\private.tex", false),
            ("control", "notes/secret\n.tex", false),
            ("unicode normalization", "references/cafe\u{301}.bib", false),
            ("url", "https://example.test/notes.tex", false),
            ("credentials", "token:secret@host/notes.tex", false),
            ("reserved bare", "CON", false),
            ("reserved extension", "references/prn.bib", false),
            ("reserved wildcard extension", "devices/COM1.*", false),
            ("trailing dot", "figures/file.", false),
            ("trailing space", "notes/file ", false),
            ("git", ".git/config", false),
            ("oleafly", "assets/.oleafly/build", false),
            ("protected wildcard", "assets/*", false),
            ("mandatory exact", "project.json", true),
            ("mandatory wildcard", "*.json", true),
        ];

        for (name, pattern, ignored) in cases {
            let policy: CheckpointPolicy = serde_json::from_value(if ignored {
                serde_json::json!({"ignored": [pattern]})
            } else {
                serde_json::json!({"always_include": [pattern]})
            })
            .unwrap();
            assert!(policy.validate().is_err(), "{name} unexpectedly passed");
        }
    }

    #[test]
    fn unsupported_checkpoint_mode_does_not_block_project_open_and_round_trips() {
        let source = r#"{
          "name": "Future",
          "main_doc": "main.tex",
          "engine": "xetex",
          "checkpoints": {
            "mode": "future_dependency_mode",
            "always_include": [],
            "ignored": []
          }
        }"#;

        let manifest: ProjectManifest = serde_json::from_str(source).unwrap();
        manifest.validate().unwrap();
        assert!(manifest.checkpoints.validate().is_err());

        let output = serde_json::to_value(manifest).unwrap();
        assert_eq!(output["checkpoints"]["mode"], "future_dependency_mode");
    }

    #[test]
    fn malformed_checkpoint_policy_does_not_block_project_open_and_round_trips() {
        let checkpoints = serde_json::json!({
            "mode": "engine_dependencies",
            "always_include": "figures",
            "ignored": []
        });
        let source = serde_json::json!({
            "name": "Malformed policy",
            "main_doc": "main.tex",
            "engine": "xetex",
            "checkpoints": checkpoints.clone()
        });

        let manifest: ProjectManifest = serde_json::from_value(source).unwrap();
        manifest.validate().unwrap();
        assert!(manifest.checkpoints.validate().is_err());

        let output = serde_json::to_value(manifest).unwrap();
        assert_eq!(output["checkpoints"], checkpoints);
    }
}
