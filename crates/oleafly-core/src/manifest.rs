use crate::{Error, ErrorKind, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;

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
    /// Validate a policy only where an unreadable one must be reported.
    /// Project open, compile, and checkpoint capture deliberately do not call
    /// this method.
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
        Ok(())
    }
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
        assert!(output["checkpoints"].get("always_include").is_none());
        assert!(output["checkpoints"].get("ignored").is_none());
    }

    #[test]
    fn checkpoint_policy_round_trips_future_extensions() {
        let source = r#"{
          "name": "Portable",
          "main_doc": "main.tex",
          "engine": "xetex",
          "checkpoints": {
            "mode": "engine_dependencies",
            "future_option": {"enabled": true}
          }
        }"#;

        let manifest: ProjectManifest = serde_json::from_str(source).unwrap();
        let output = serde_json::to_value(manifest).unwrap();

        assert_eq!(output["checkpoints"]["mode"], "engine_dependencies");
        assert_eq!(output["checkpoints"]["future_option"]["enabled"], true);
    }

    #[test]
    fn retired_include_and_ignore_lists_still_open_and_survive_a_rewrite() {
        let checkpoints = serde_json::json!({
            "mode": "engine_dependencies",
            "always_include": ["figures/*.png", "research/notes"],
            "ignored": ["scratch/*.tmp"]
        });
        let source = serde_json::json!({
            "name": "Legacy lists",
            "main_doc": "main.tex",
            "engine": "xetex",
            "checkpoints": checkpoints.clone()
        });

        let manifest: ProjectManifest = serde_json::from_value(source).unwrap();
        manifest.validate().unwrap();
        manifest.checkpoints.validate().unwrap();
        assert_eq!(
            manifest.checkpoints.extra["always_include"],
            serde_json::json!(["figures/*.png", "research/notes"])
        );

        let output = serde_json::to_value(manifest).unwrap();
        assert_eq!(output["checkpoints"], checkpoints);
    }

    #[test]
    fn a_retired_list_of_the_wrong_shape_still_opens_and_survives_a_rewrite() {
        let checkpoints = serde_json::json!({
            "mode": "engine_dependencies",
            "always_include": "figures"
        });
        let source = serde_json::json!({
            "name": "Legacy scalar",
            "main_doc": "main.tex",
            "engine": "xetex",
            "checkpoints": checkpoints.clone()
        });

        let manifest: ProjectManifest = serde_json::from_value(source).unwrap();
        manifest.validate().unwrap();
        manifest.checkpoints.validate().unwrap();

        let output = serde_json::to_value(manifest).unwrap();
        assert_eq!(output["checkpoints"], checkpoints);
    }

    #[test]
    fn unsupported_checkpoint_mode_does_not_block_project_open_and_round_trips() {
        let source = r#"{
          "name": "Future",
          "main_doc": "main.tex",
          "engine": "xetex",
          "checkpoints": {
            "mode": "future_dependency_mode"
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
            "mode": ["engine_dependencies"]
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
