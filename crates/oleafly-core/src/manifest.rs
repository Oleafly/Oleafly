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
    pub fn named(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "" | "latex" | "tex" | "tectonic" | "xetex" | "luatex" => Some(Self::Tectonic),
            "latexmk" => Some(Self::Latexmk),
            "typst" | "typ" => Some(Self::Typst),
            "markdown" | "md" | "pandoc" => Some(Self::Markdown),
            _ => None,
        }
    }

    pub fn from_manifest(value: &str, main_document: &str) -> Result<Self> {
        let engine = Self::named(value).ok_or_else(|| {
            Error::new(
                ErrorKind::InvalidManifest,
                format!("unsupported document engine `{value}`"),
            )
        })?;
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
            .and_then(std::ffi::OsStr::to_str)
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
            .and_then(std::ffi::OsStr::to_str)
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

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct TypstSpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub vendor_packages: bool,
    #[serde(
        default,
        skip_serializing_if = "Vec::is_empty",
        deserialize_with = "lenient_paths"
    )]
    pub font_paths: Vec<String>,
    #[serde(
        default = "enabled",
        skip_serializing_if = "is_enabled",
        deserialize_with = "lenient_enabled"
    )]
    pub system_fonts: bool,
    #[serde(
        default,
        skip_serializing_if = "std::ops::Not::not",
        deserialize_with = "lenient_disabled"
    )]
    pub reproducible: bool,
    #[serde(
        default,
        skip_serializing_if = "BTreeMap::is_empty",
        deserialize_with = "lenient_inputs"
    )]
    pub inputs: BTreeMap<String, String>,
    #[serde(
        default,
        skip_serializing_if = "BTreeMap::is_empty",
        deserialize_with = "lenient_variants"
    )]
    pub variants: BTreeMap<String, TypstVariant>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl Default for TypstSpec {
    fn default() -> Self {
        Self {
            version: None,
            vendor_packages: false,
            font_paths: Vec::new(),
            system_fonts: true,
            reproducible: false,
            inputs: BTreeMap::new(),
            variants: BTreeMap::new(),
            extra: HashMap::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
pub struct TypstVariant {
    #[serde(
        default,
        skip_serializing_if = "BTreeMap::is_empty",
        deserialize_with = "lenient_inputs"
    )]
    pub inputs: BTreeMap<String, String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl TypstSpec {
    pub fn is_empty(&self) -> bool {
        serde_json::to_value(self)
            .ok()
            .and_then(|value| value.as_object().map(serde_json::Map::is_empty))
            .unwrap_or(false)
    }

    pub fn ignores_system_fonts(&self) -> bool {
        !self.system_fonts || self.reproducible
    }

    pub fn inputs_for(&self, variant: Option<&str>) -> Vec<(String, String)> {
        let mut inputs = self.inputs.clone();
        if let Some(chosen) = variant.and_then(|name| self.variants.get(name)) {
            inputs.extend(chosen.inputs.clone());
        }
        inputs.into_iter().collect()
    }
}

pub fn valid_typst_input_key(key: &str) -> bool {
    !key.trim().is_empty() && !key.contains('=') && !key.chars().any(char::is_control)
}

const fn enabled() -> bool {
    true
}

const fn is_enabled(value: &bool) -> bool {
    *value
}

fn lenient_value<'de, D>(deserializer: D) -> std::result::Result<serde_json::Value, D::Error>
where
    D: serde::Deserializer<'de>,
{
    serde_json::Value::deserialize(deserializer)
}

fn lenient_paths<'de, D>(deserializer: D) -> std::result::Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(match lenient_value(deserializer)? {
        serde_json::Value::String(path) => vec![path],
        serde_json::Value::Array(paths) => paths
            .into_iter()
            .filter_map(|path| path.as_str().map(str::to_owned))
            .collect(),
        _ => Vec::new(),
    }
    .into_iter()
    .filter(|path| !path.trim().is_empty())
    .collect())
}

fn lenient_enabled<'de, D>(deserializer: D) -> std::result::Result<bool, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(lenient_value(deserializer)?.as_bool().unwrap_or(true))
}

fn lenient_disabled<'de, D>(deserializer: D) -> std::result::Result<bool, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(lenient_value(deserializer)?.as_bool().unwrap_or(false))
}

fn input_map(value: serde_json::Value) -> BTreeMap<String, String> {
    let serde_json::Value::Object(entries) = value else {
        return BTreeMap::new();
    };
    entries
        .into_iter()
        .filter(|(key, _)| valid_typst_input_key(key))
        .filter_map(|(key, value)| {
            let text = match value {
                serde_json::Value::String(text) => text,
                serde_json::Value::Bool(flag) => flag.to_string(),
                serde_json::Value::Number(number) => number.to_string(),
                _ => return None,
            };
            Some((key, text))
        })
        .collect()
}

fn lenient_inputs<'de, D>(
    deserializer: D,
) -> std::result::Result<BTreeMap<String, String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(input_map(lenient_value(deserializer)?))
}

fn lenient_variants<'de, D>(
    deserializer: D,
) -> std::result::Result<BTreeMap<String, TypstVariant>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let serde_json::Value::Object(entries) = lenient_value(deserializer)? else {
        return Ok(BTreeMap::new());
    };
    Ok(entries
        .into_iter()
        .filter(|(name, _)| !name.trim().is_empty())
        .filter_map(|(name, value)| {
            value.is_object().then_some(())?;
            serde_json::from_value::<TypstVariant>(value)
                .ok()
                .map(|variant| (name, variant))
        })
        .collect())
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub typst: Option<TypstSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dictionary_locale: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compile_dir: Option<String>,
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
            typst: None,
            dictionary_locale: None,
            compile_dir: None,
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

pub const MAX_MANIFEST_BYTES: u64 = 4 * 1024 * 1024;

pub fn sniff_oleafly_manifest(bytes: &[u8]) -> Option<ProjectManifest> {
    let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    if !is_oleafly_manifest(&value) {
        return None;
    }
    serde_json::from_value(value).ok()
}

pub fn is_oleafly_manifest(value: &serde_json::Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    let main_document = object
        .get("main_doc")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|main| Engine::infer(main).is_ok());
    let engine = match object.get("engine") {
        None => true,
        Some(serde_json::Value::String(name)) => Engine::named(name).is_some(),
        Some(_) => false,
    };
    main_document && engine
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

    pub fn typst_version_pin(&self) -> Option<&str> {
        self.typst
            .as_ref()?
            .version
            .as_deref()
            .map(str::trim)
            .filter(|version| !version.is_empty())
    }

    pub fn typst_vendor_packages(&self) -> bool {
        self.typst.as_ref().is_some_and(|spec| spec.vendor_packages)
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
    fn typst_pin_round_trips_in_snake_case_and_is_omitted_when_unset() {
        let manifest: ProjectManifest = serde_json::from_str(
            r#"{"name":"Paper","main_doc":"main.typ","engine":"typst","typst":{"version":"0.13.1"}}"#,
        )
        .unwrap();
        assert_eq!(
            manifest.typst,
            Some(TypstSpec {
                version: Some("0.13.1".into()),
                ..TypstSpec::default()
            })
        );
        assert_eq!(manifest.typst_version_pin(), Some("0.13.1"));
        let output = serde_json::to_value(&manifest).unwrap();
        assert_eq!(output["typst"], serde_json::json!({"version": "0.13.1"}));
        let again: ProjectManifest = serde_json::from_value(output).unwrap();
        assert_eq!(again, manifest);

        let unpinned = ProjectManifest {
            main_doc: "main.typ".into(),
            engine: "typst".into(),
            ..ProjectManifest::default()
        };
        assert_eq!(unpinned.typst_version_pin(), None);
        let output = serde_json::to_value(&unpinned).unwrap();
        assert!(output.get("typst").is_none());

        let empty = ProjectManifest {
            typst: Some(TypstSpec::default()),
            ..unpinned.clone()
        };
        let output = serde_json::to_value(&empty).unwrap();
        assert_eq!(output["typst"], serde_json::json!({}));
        assert_eq!(empty.typst_version_pin(), None);
    }

    #[test]
    fn blank_and_null_typst_pins_read_as_unpinned() {
        for source in [
            r#"{"main_doc":"main.typ","engine":"typst","typst":null}"#,
            r#"{"main_doc":"main.typ","engine":"typst","typst":{}}"#,
            r#"{"main_doc":"main.typ","engine":"typst","typst":{"version":null}}"#,
            r#"{"main_doc":"main.typ","engine":"typst","typst":{"version":"  "}}"#,
        ] {
            let manifest: ProjectManifest = serde_json::from_str(source).unwrap();
            assert_eq!(manifest.typst_version_pin(), None, "{source}");
        }
        let padded: ProjectManifest = serde_json::from_str(
            r#"{"main_doc":"main.typ","engine":"typst","typst":{"version":" 0.15.1 "}}"#,
        )
        .unwrap();
        assert_eq!(padded.typst_version_pin(), Some("0.15.1"));
    }

    #[test]
    fn future_typst_fields_survive_a_rewrite() {
        let typst = serde_json::json!({
            "version": "0.15.1",
            "font_paths": ["fonts"],
            "inputs": {"draft": "true"},
            "packages": {"future": {"enabled": true}}
        });
        let source = serde_json::json!({
            "name": "Future Typst",
            "main_doc": "main.typ",
            "engine": "typst",
            "typst": typst.clone()
        });
        let manifest: ProjectManifest = serde_json::from_value(source).unwrap();
        manifest.validate().unwrap();
        assert_eq!(manifest.typst_version_pin(), Some("0.15.1"));
        let output = serde_json::to_value(manifest).unwrap();
        assert_eq!(output["typst"], typst);
        assert!(output.get("font_paths").is_none());
        assert!(sniff_oleafly_manifest(output.to_string().as_bytes()).is_some());
    }

    #[test]
    fn typst_vendor_packages_round_trips_and_is_omitted_when_off() {
        let manifest: ProjectManifest = serde_json::from_str(
            r#"{"main_doc":"main.typ","engine":"typst","typst":{"version":"0.15.1","vendor_packages":true}}"#,
        )
        .unwrap();
        assert!(manifest.typst_vendor_packages());
        assert_eq!(manifest.typst_version_pin(), Some("0.15.1"));
        let output = serde_json::to_value(&manifest).unwrap();
        assert_eq!(
            output["typst"],
            serde_json::json!({"version": "0.15.1", "vendor_packages": true})
        );

        let off: ProjectManifest = serde_json::from_str(
            r#"{"main_doc":"main.typ","engine":"typst","typst":{"version":"0.15.1","vendor_packages":false}}"#,
        )
        .unwrap();
        assert!(!off.typst_vendor_packages());
        let output = serde_json::to_value(&off).unwrap();
        assert_eq!(output["typst"], serde_json::json!({"version": "0.15.1"}));

        let unset: ProjectManifest =
            serde_json::from_str(r#"{"main_doc":"main.typ","engine":"typst"}"#).unwrap();
        assert!(!unset.typst_vendor_packages());
    }

    #[test]
    fn typst_compile_options_round_trip_in_snake_case() {
        let typst = serde_json::json!({
            "version": "0.15.1",
            "font_paths": ["fonts/extra", "assets/type"],
            "system_fonts": false,
            "reproducible": true,
            "inputs": {"draft": "false", "lang": "en"},
            "variants": {
                "camera-ready": {"inputs": {"draft": "false", "anonymous": "false"}},
                "review": {"inputs": {"anonymous": "true"}}
            }
        });
        let manifest: ProjectManifest = serde_json::from_value(serde_json::json!({
            "main_doc": "main.typ",
            "engine": "typst",
            "typst": typst.clone()
        }))
        .unwrap();
        let spec = manifest.typst.clone().unwrap();
        assert_eq!(spec.font_paths, ["fonts/extra", "assets/type"]);
        assert!(!spec.system_fonts);
        assert!(spec.reproducible);
        assert_eq!(spec.inputs["lang"], "en");
        assert_eq!(spec.variants["review"].inputs["anonymous"], "true");
        assert!(spec.extra.is_empty());
        let output = serde_json::to_value(&manifest).unwrap();
        assert_eq!(output["typst"], typst);
        let again: ProjectManifest = serde_json::from_value(output).unwrap();
        assert_eq!(again, manifest);
    }

    #[test]
    fn default_typst_compile_options_are_omitted() {
        let spec = TypstSpec::default();
        assert!(spec.system_fonts);
        assert!(!spec.reproducible);
        assert!(spec.is_empty());
        assert_eq!(serde_json::to_value(&spec).unwrap(), serde_json::json!({}));
        let explicit: TypstSpec = serde_json::from_value(serde_json::json!({
            "system_fonts": true,
            "reproducible": false,
            "font_paths": [],
            "inputs": {},
            "variants": {}
        }))
        .unwrap();
        assert!(explicit.is_empty());
        assert_eq!(
            serde_json::to_value(&explicit).unwrap(),
            serde_json::json!({})
        );
        for spec in [
            TypstSpec {
                system_fonts: false,
                ..TypstSpec::default()
            },
            TypstSpec {
                reproducible: true,
                ..TypstSpec::default()
            },
            TypstSpec {
                font_paths: vec!["fonts".into()],
                ..TypstSpec::default()
            },
            TypstSpec {
                extra: HashMap::from([("future".into(), serde_json::json!(1))]),
                ..TypstSpec::default()
            },
        ] {
            assert!(!spec.is_empty(), "{spec:?}");
        }
    }

    #[test]
    fn an_unknown_typst_field_keeps_the_spec_through_a_setter() {
        let mut spec: TypstSpec =
            serde_json::from_value(serde_json::json!({"version": "0.15.1", "future": {"a": 1}}))
                .unwrap();
        spec.version = None;
        assert!(!spec.is_empty());
        assert_eq!(
            serde_json::to_value(&spec).unwrap(),
            serde_json::json!({"future": {"a": 1}})
        );
        spec.extra.clear();
        assert!(spec.is_empty());
    }

    #[test]
    fn malformed_typst_compile_options_still_open() {
        let manifest: ProjectManifest = serde_json::from_value(serde_json::json!({
            "main_doc": "main.typ",
            "engine": "typst",
            "typst": {
                "font_paths": "fonts",
                "system_fonts": "no",
                "reproducible": 1,
                "inputs": {"draft": true, "copies": 2, "bad=key": "x", "": "y", "nested": {"a": 1}},
                "variants": {"ok": {"inputs": {"a": "b"}}, "broken": "x", "  ": {"inputs": {}}}
            }
        }))
        .unwrap();
        let spec = manifest.typst.unwrap();
        assert_eq!(spec.font_paths, ["fonts"]);
        assert!(spec.system_fonts);
        assert!(!spec.reproducible);
        assert_eq!(
            spec.inputs,
            BTreeMap::from([
                ("copies".to_string(), "2".to_string()),
                ("draft".to_string(), "true".to_string()),
            ])
        );
        assert_eq!(spec.variants.keys().collect::<Vec<_>>(), ["ok"]);
        assert_eq!(spec.variants["ok"].inputs["a"], "b");
    }

    #[test]
    fn typst_variant_inputs_overlay_the_base_inputs() {
        let spec: TypstSpec = serde_json::from_value(serde_json::json!({
            "inputs": {"draft": "true", "lang": "en"},
            "variants": {"final": {"inputs": {"draft": "false", "venue": "acm"}}}
        }))
        .unwrap();
        assert_eq!(
            spec.inputs_for(None),
            vec![
                ("draft".to_string(), "true".to_string()),
                ("lang".to_string(), "en".to_string()),
            ]
        );
        assert_eq!(
            spec.inputs_for(Some("final")),
            vec![
                ("draft".to_string(), "false".to_string()),
                ("lang".to_string(), "en".to_string()),
                ("venue".to_string(), "acm".to_string()),
            ]
        );
        assert_eq!(spec.inputs_for(Some("missing")), spec.inputs_for(None));
        assert!(!spec.ignores_system_fonts());
        let reproducible = TypstSpec {
            reproducible: true,
            ..TypstSpec::default()
        };
        assert!(reproducible.ignores_system_fonts());
    }

    #[test]
    fn engine_and_extension_must_agree() {
        let error = Engine::from_manifest("typst", "main.tex").unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidManifest);
    }

    #[test]
    fn only_oleafly_manifests_are_sniffed_as_ours() {
        for ours in [
            r#"{"main_doc":"main.tex"}"#,
            r##"{"name":"Thesis","main_doc":"thesis/main.tex","engine":"xetex","color":"#123456"}"##,
            r#"{"main_doc":"paper.typ","engine":"typst"}"#,
            r#"{"main_doc":"notes.md","engine":"pandoc"}"#,
            r#"{"main_doc":"main.tex","engine":"LaTeXmk","tex_flavor":"xelatex"}"#,
        ] {
            assert!(sniff_oleafly_manifest(ours.as_bytes()).is_some(), "{ours}");
        }
        for foreign in [
            r#"{"name":"web","$schema":"node_modules/nx/schemas/project-schema.json","targets":{}}"#,
            r#"{"main_doc":"main.py"}"#,
            r#"{"main_doc":42}"#,
            r#"{"main_doc":"main.tex","engine":"make"}"#,
            r#"{"main_doc":"main.tex","engine":["xetex"]}"#,
            r#"{"main_doc":"notes.md","engine":null}"#,
            r#"{"main_doc":"main.tex","hidden":"yes"}"#,
            r#"["main.tex"]"#,
            "not json",
        ] {
            assert!(
                sniff_oleafly_manifest(foreign.as_bytes()).is_none(),
                "{foreign}"
            );
        }
    }

    #[test]
    fn engine_names_resolve_without_a_main_document() {
        assert_eq!(Engine::named(" Tectonic "), Some(Engine::Tectonic));
        assert_eq!(Engine::named(""), Some(Engine::Tectonic));
        assert_eq!(Engine::named("LATEXMK"), Some(Engine::Latexmk));
        assert_eq!(Engine::named("typ"), Some(Engine::Typst));
        assert_eq!(Engine::named("pandoc"), Some(Engine::Markdown));
        assert_eq!(Engine::named("pdflatex"), None);
    }

    #[test]
    fn oleafly_manifests_are_told_apart_from_other_tools_project_files() {
        let oleafly = [
            serde_json::json!({"name": "Paper", "main_doc": "main.tex", "engine": "xetex"}),
            serde_json::json!({"main_doc": "paper/thesis.ltx"}),
            serde_json::json!({"main_doc": "slides.typ", "engine": "typst"}),
            serde_json::json!({"main_doc": "notes.MD", "engine": "pandoc"}),
            serde_json::json!({"main_doc": "main.tex", "engine": "typst"}),
        ];
        for value in &oleafly {
            assert!(is_oleafly_manifest(value), "{value}");
        }
        let foreign = [
            serde_json::json!({
                "name": "web",
                "$schema": "../../node_modules/nx/schemas/project-schema.json",
                "sourceRoot": "apps/web/src",
                "projectType": "application",
                "targets": {"build": {"executor": "@nx/vite:build"}}
            }),
            serde_json::json!({
                "version": "1.0.0-*",
                "dependencies": {"NETStandard.Library": "1.6.0"},
                "frameworks": {"netstandard1.6": {}}
            }),
            serde_json::json!({"main_doc": "main.pdf"}),
            serde_json::json!({"main_doc": 7}),
            serde_json::json!({"main_doc": "main.tex", "engine": "pdflatex-custom"}),
            serde_json::json!({"main_doc": "main.tex", "engine": null}),
            serde_json::json!(["main.tex"]),
            serde_json::json!("main.tex"),
        ];
        for value in &foreign {
            assert!(!is_oleafly_manifest(value), "{value}");
        }
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
