use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub(crate) const MAX_SKILL_FILE_BYTES: u64 = 4 * 1024 * 1024;
pub(crate) const MAX_PACK_BYTES: u64 = 512 * 1024 * 1024;
pub(crate) const MAX_PACK_ENTRIES: usize = 50_000;
pub(crate) const MAX_PACK_DEPTH: usize = 32;
const MAX_STATE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_NAME_CHARS: usize = 100;
const MAX_DESCRIPTION_CHARS: usize = 2_000;
const MAX_FRONTMATTER_VALUE_CHARS: usize = 1_000;
const MAX_FRONTMATTER_ITEM_CHARS: usize = 100;
const MAX_FRONTMATTER_LIST_ITEMS: usize = 64;
const STATE_VERSION: u8 = 2;
pub(crate) const MANAGED_MANIFEST_FILE: &str = ".oleafly-skill.json";
pub(crate) const MANAGED_MANIFEST_SCHEMA_VERSION: u8 = 1;
pub(crate) const FIRST_PARTY_MARKER_FILE: &str = ".oleafly-first-party";
pub(crate) const FIRST_PARTY_MARKER: &str = "oleafly-first-party-v1\n";
pub(crate) const REMOVAL_STAGING_PREFIX: &str = ".skill-remove-";
pub(crate) const STALE_STAGING_PREFIX: &str = ".skill-stale-";
const DEFAULT_INSTRUCTIONS: &str =
    "Describe when this skill should be used and list the steps the assistant should follow.";

static SKILLS_WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SkillSource {
    Bundled,
    Catalog,
    User,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SkillTier {
    Native,
    Vendored,
    Shelf,
    User,
}

impl SkillTier {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "native" => Some(Self::Native),
            "vendored" => Some(Self::Vendored),
            "shelf" => Some(Self::Shelf),
            "user" => Some(Self::User),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SkillValidationCode {
    MissingSkillFile,
    UnreadableSkillFile,
    SkillTooLarge,
    InvalidFrontmatter,
    MissingName,
    InvalidName,
    MissingDescription,
    InvalidDescription,
    MissingInstructions,
    UnsafePath,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum SkillValidation {
    Valid,
    Invalid {
        code: SkillValidationCode,
        message: String,
    },
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillOrigin {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFile {
    pub path: String,
    pub bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFileContent {
    pub path: String,
    pub content: String,
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub instructions: String,
    pub dir: String,
    pub files: Vec<SkillFile>,
    pub license: Option<String>,
    pub compatibility: Option<String>,
    pub allowed_tools: Vec<String>,
    pub version: Option<String>,
    pub author: Option<String>,
    pub tier: SkillTier,
    pub phase: Option<String>,
    pub tools: Vec<String>,
    pub source: SkillSource,
    pub pack_version: Option<String>,
    pub update_available: bool,
    pub project_enabled: bool,
    pub enabled: bool,
    pub removable: bool,
    pub validation: SkillValidation,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedManifest {
    pub schema_version: u8,
    pub id: String,
    pub source: SkillSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pack: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pack_version: Option<String>,
    #[serde(default)]
    pub tree_sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tier: Option<SkillTier>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<SkillOrigin>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSkillInput {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub instructions: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSkillInput {
    pub name: String,
    pub description: String,
    pub instructions: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct SkillDocument {
    name: String,
    description: String,
    instructions: String,
    license: Option<String>,
    compatibility: Option<String>,
    allowed_tools: Vec<String>,
    version: Option<String>,
    author: Option<String>,
    tier: Option<SkillTier>,
    phase: Option<String>,
    tools: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SkillValidationError {
    code: SkillValidationCode,
    message: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillsState {
    version: u8,
    #[serde(default)]
    enabled: BTreeSet<String>,
    #[serde(default)]
    seen: BTreeSet<String>,
    #[serde(default)]
    project_enabled: BTreeMap<String, BTreeSet<String>>,
}

impl Default for SkillsState {
    fn default() -> Self {
        Self {
            version: STATE_VERSION,
            enabled: BTreeSet::new(),
            seen: BTreeSet::new(),
            project_enabled: BTreeMap::new(),
        }
    }
}

#[derive(Default)]
pub(crate) struct CopyBudget {
    entries: usize,
    bytes: u64,
}

#[cfg(test)]
pub(crate) fn skills_root(root: &Path) -> PathBuf {
    root.join("skills")
}

const LEGACY_DEFAULT_SKILLS: [(&str, &str, &str); 10] = [
    (
        "research-authoring",
        r#"{ "name": "research-authoring", "version": "1.0.0", "description": "Draft or extend a research manuscript section by section." }"#,
        "---\nname: research-authoring\ndescription: Draft or extend a research manuscript section by section.\n---\n\nWork through the manuscript one section at a time. Before writing, map the current outline and note gaps. Draft in the project's voice and formatting, keep claims tied to citations that exist in the bibliography, and compile after each section so the document never drifts from a building state.\n",
    ),
    (
        "research-review",
        r#"{ "name": "research-review", "version": "1.0.0", "description": "Review the manuscript the way a careful referee would." }"#,
        "---\nname: research-review\ndescription: Review the manuscript the way a careful referee would.\n---\n\nRead the full manuscript and produce a structured review: summary, strengths, major concerns, minor issues, and line-level notes. Check that every claim is supported, that figures and tables are referenced, and that notation stays consistent. Do not edit the document; report findings so I can decide what to change.\n",
    ),
    (
        "research-citation",
        r#"{ "name": "research-citation", "version": "1.0.0", "description": "Audit, verify, and complete the project's citations." }"#,
        "---\nname: research-citation\ndescription: Audit, verify, and complete the project's citations.\n---\n\nScan the document for citation problems: unresolved keys, entries never cited, claims that need a source, and bibliography entries with missing fields. Verify entries against the citation tools, fetch canonical BibTeX where it is missing, and recompile to confirm the bibliography resolves cleanly.\n",
    ),
    (
        "research-publish",
        r#"{ "name": "research-publish", "version": "1.0.0", "description": "Prepare the manuscript for submission to a venue." }"#,
        "---\nname: research-publish\ndescription: Prepare the manuscript for submission to a venue.\n---\n\nCheck the manuscript against the target venue: page limits, anonymity, template compliance, figure resolution, and reference style. Report every blocker with the exact file and line, fix the mechanical ones, and finish with a clean compile plus a short submission checklist.\n",
    ),
    (
        "conduct-research",
        r#"{ "name": "conduct-research", "version": "1.0.0", "description": "Run a literature sweep and turn it into usable notes." }"#,
        "---\nname: conduct-research\ndescription: Run a literature sweep and turn it into usable notes.\n---\n\nStart from the research question, search the literature tools, and keep the results that actually answer it. For each keeper, record the citation, the claim it supports, and where it belongs in the manuscript. Finish with a short synthesis that names the gap the project fills.\n",
    ),
    (
        "openresearch",
        r#"{ "name": "openresearch", "version": "1.0.0", "description": "Ground research in literature and run or inspect experiments with the local orx CLI." }"#,
        "---\nname: OpenResearch (orx)\ndescription: Ground research in literature and run or inspect experiments with the local orx CLI.\n---\n\nUse the orx CLI through run_command for literature and experiment work. Discover papers with `orx discover keyword <query>`, read one with `orx read <id>`, and inspect or launch experiments with `orx run`. Keep every downloaded source under research/sources/ and every note under research/notes/ so the project stays reproducible.\n",
    ),
    (
        "import-refine",
        r#"{ "name": "import-refine", "version": "1.0.0", "description": "Clean up an imported document until it compiles and reads well." }"#,
        "---\nname: import-refine\ndescription: Clean up an imported document until it compiles and reads well.\n---\n\nCompile first and read the log. Fix the errors in order, then the warnings that affect output. Normalize headings, figures, tables, and citation keys to the project's conventions, and recompile after each group of fixes so the document never regresses.\n",
    ),
    (
        "pdf-to-latex",
        r#"{ "name": "pdf-to-latex", "version": "1.0.0", "description": "Rebuild a PDF as a structured LaTeX source." }"#,
        "---\nname: pdf-to-latex\ndescription: Rebuild a PDF as a structured LaTeX source.\n---\n\nRead the PDF text, then rebuild the document as LaTeX section by section. Keep the original structure, preserve math and tables faithfully, and mark anything you could not recover with a clear TODO. Compile as you go so the rebuild always produces a document.\n",
    ),
    (
        "template-generate",
        r#"{ "name": "template-generate", "version": "1.0.0", "description": "Create a reusable project template from the current document." }"#,
        "---\nname: template-generate\ndescription: Create a reusable project template from the current document.\n---\n\nStrip the current document down to a reusable skeleton: keep the preamble, the section structure, and the placeholder content that shows how each part is used. Remove project-specific text and data, document the template's assumptions, and confirm it compiles from a clean state.\n",
    ),
    (
        "ai-figure",
        r#"{ "name": "ai-figure", "version": "1.0.0", "description": "Design and insert a figure that matches the document." }"#,
        "---\nname: ai-figure\ndescription: Design and insert a figure that matches the document.\n---\n\nDecide what the figure has to show before drawing anything. Match the document's fonts, colors, and line weights, keep labels readable at print size, and place the figure with a caption and a label that the text actually references. Compile to confirm the placement.\n",
    ),
];

fn validation_error(code: SkillValidationCode, message: impl Into<String>) -> SkillValidationError {
    SkillValidationError {
        code,
        message: message.into(),
    }
}

#[cfg(windows)]
pub(crate) fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
pub(crate) fn is_reparse_point(_metadata: &std::fs::Metadata) -> bool {
    false
}

pub(crate) fn open_nofollow(path: &Path) -> std::io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt as _;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options.open(path)
}

pub(crate) fn managed_skills_root(root: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(root)
        .map_err(|error| format!("Could not create the Oleafly data directory: {error}"))?;
    let root_metadata = std::fs::symlink_metadata(root)
        .map_err(|error| format!("Could not inspect the Oleafly data directory: {error}"))?;
    if !root_metadata.is_dir()
        || root_metadata.file_type().is_symlink()
        || is_reparse_point(&root_metadata)
    {
        return Err("The Oleafly data directory is not a real directory.".into());
    }
    let resolved_root = root
        .canonicalize()
        .map_err(|error| format!("Could not resolve the Oleafly data directory: {error}"))?;
    let skills = root.join("skills");
    match std::fs::symlink_metadata(&skills) {
        Ok(metadata)
            if metadata.is_dir()
                && !metadata.file_type().is_symlink()
                && !is_reparse_point(&metadata) => {}
        Ok(_) => return Err("The skills path is not a real directory.".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(&skills)
                .map_err(|error| format!("Could not create the skills directory: {error}"))?;
        }
        Err(error) => return Err(format!("Could not inspect the skills directory: {error}")),
    }
    let resolved_skills = skills
        .canonicalize()
        .map_err(|error| format!("Could not resolve the skills directory: {error}"))?;
    if resolved_skills.parent() != Some(resolved_root.as_path()) {
        return Err("The skills directory escapes the Oleafly data directory.".into());
    }
    Ok(resolved_skills)
}

pub(crate) fn validate_skill_id(id: &str) -> Result<(), String> {
    let components: Vec<_> = Path::new(id).components().collect();
    let is_single_segment = matches!(components.as_slice(), [Component::Normal(_)]);
    if id.is_empty()
        || !is_single_segment
        || id.contains(['/', '\\', ':', '\0'])
        || id.chars().any(char::is_control)
    {
        return Err(format!("Invalid skill id: {id}"));
    }
    Ok(())
}

fn secure_skill_directory(skills: &Path, id: &str) -> Result<PathBuf, String> {
    validate_skill_id(id)?;
    let directory = skills.join(id);
    let metadata = std::fs::symlink_metadata(&directory)
        .map_err(|error| format!("Could not inspect skill \"{id}\": {error}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(format!("Skill \"{id}\" is not stored in a real directory."));
    }
    let resolved = directory
        .canonicalize()
        .map_err(|error| format!("Could not resolve skill \"{id}\": {error}"))?;
    if resolved.parent() != Some(skills) {
        return Err(format!("Skill \"{id}\" escapes the skills directory."));
    }
    Ok(resolved)
}

fn split_frontmatter(markdown: &str) -> Result<(String, String), SkillValidationError> {
    let normalized = markdown.replace("\r\n", "\n");
    let mut lines = normalized.lines();
    if lines.next() != Some("---") {
        return Err(validation_error(
            SkillValidationCode::InvalidFrontmatter,
            "SKILL.md must start with YAML front matter between --- markers.",
        ));
    }
    let mut frontmatter = Vec::new();
    let mut closed = false;
    for line in &mut lines {
        if line == "---" {
            closed = true;
            break;
        }
        frontmatter.push(line);
    }
    if !closed {
        return Err(validation_error(
            SkillValidationCode::InvalidFrontmatter,
            "SKILL.md front matter is missing its closing --- marker.",
        ));
    }
    Ok((frontmatter.join("\n"), lines.collect::<Vec<_>>().join("\n")))
}

fn yaml_field<'a>(mapping: &'a serde_yaml::Mapping, field: &str) -> Option<&'a serde_yaml::Value> {
    mapping.get(serde_yaml::Value::String(field.to_string()))
}

fn required_frontmatter_field(
    mapping: &serde_yaml::Mapping,
    field: &str,
    missing_code: SkillValidationCode,
    invalid_code: SkillValidationCode,
    max_chars: usize,
) -> Result<String, SkillValidationError> {
    let Some(value) = yaml_field(mapping, field) else {
        return Err(validation_error(
            missing_code,
            format!("SKILL.md is missing the front matter field \"{field}\"."),
        ));
    };
    let serde_yaml::Value::String(value) = value else {
        return Err(validation_error(
            invalid_code,
            format!("SKILL.md field \"{field}\" must be a non-empty string."),
        ));
    };
    let value = value.trim();
    if value.is_empty() || value.contains(['\r', '\n']) || value.chars().count() > max_chars {
        return Err(validation_error(
            invalid_code,
            format!(
                "SKILL.md field \"{field}\" must be a non-empty single line of at most {max_chars} characters."
            ),
        ));
    }
    Ok(value.to_string())
}

fn scalar_text(value: &serde_yaml::Value) -> Option<String> {
    match value {
        serde_yaml::Value::String(text) => Some(text.trim().to_string()),
        serde_yaml::Value::Number(number) => Some(number.to_string()),
        serde_yaml::Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    }
}

fn optional_text(mapping: &serde_yaml::Mapping, field: &str) -> Option<String> {
    yaml_field(mapping, field)
        .and_then(scalar_text)
        .map(|text| text.replace(['\r', '\n'], " ").trim().to_string())
        .filter(|text| !text.is_empty() && text.chars().count() <= MAX_FRONTMATTER_VALUE_CHARS)
}

fn optional_text_list(mapping: &serde_yaml::Mapping, field: &str) -> Vec<String> {
    let Some(value) = yaml_field(mapping, field) else {
        return Vec::new();
    };
    let items: Vec<String> = match value {
        serde_yaml::Value::Sequence(items) => items.iter().filter_map(scalar_text).collect(),
        other => scalar_text(other)
            .map(|text| {
                text.split([',', ' ', '\t', '\r', '\n'])
                    .map(|part| part.trim().to_string())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
    };
    items
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty() && item.chars().count() <= MAX_FRONTMATTER_ITEM_CHARS)
        .take(MAX_FRONTMATTER_LIST_ITEMS)
        .collect()
}

fn parse_skill_markdown(markdown: &str) -> Result<SkillDocument, SkillValidationError> {
    if markdown.len() as u64 > MAX_SKILL_FILE_BYTES {
        return Err(validation_error(
            SkillValidationCode::SkillTooLarge,
            format!("SKILL.md exceeds the {MAX_SKILL_FILE_BYTES}-byte limit."),
        ));
    }
    let (frontmatter, instructions) = split_frontmatter(markdown)?;
    let value: serde_yaml::Value = serde_yaml::from_str(&frontmatter).map_err(|error| {
        validation_error(
            SkillValidationCode::InvalidFrontmatter,
            format!("SKILL.md front matter could not be parsed: {error}"),
        )
    })?;
    let serde_yaml::Value::Mapping(mapping) = value else {
        return Err(validation_error(
            SkillValidationCode::InvalidFrontmatter,
            "SKILL.md front matter must be a YAML mapping.",
        ));
    };
    let name = required_frontmatter_field(
        &mapping,
        "name",
        SkillValidationCode::MissingName,
        SkillValidationCode::InvalidName,
        MAX_NAME_CHARS,
    )?;
    let description = required_frontmatter_field(
        &mapping,
        "description",
        SkillValidationCode::MissingDescription,
        SkillValidationCode::InvalidDescription,
        MAX_DESCRIPTION_CHARS,
    )?;
    let instructions = instructions.trim().to_string();
    if instructions.is_empty() {
        return Err(validation_error(
            SkillValidationCode::MissingInstructions,
            "SKILL.md must include instructions after its front matter.",
        ));
    }
    let metadata = yaml_field(&mapping, "metadata")
        .and_then(serde_yaml::Value::as_mapping)
        .cloned()
        .unwrap_or_default();
    let oleafly = yaml_field(&metadata, "oleafly")
        .and_then(serde_yaml::Value::as_mapping)
        .cloned()
        .unwrap_or_default();
    Ok(SkillDocument {
        name,
        description,
        instructions,
        license: optional_text(&mapping, "license"),
        compatibility: optional_text(&mapping, "compatibility"),
        allowed_tools: optional_text_list(&mapping, "allowed-tools"),
        version: optional_text(&metadata, "version"),
        author: optional_text(&metadata, "skill-author"),
        tier: optional_text(&oleafly, "tier").and_then(|tier| SkillTier::parse(&tier)),
        phase: optional_text(&oleafly, "phase"),
        tools: optional_text_list(&oleafly, "tools"),
    })
}

fn read_skill_markdown(directory: &Path) -> Result<String, SkillValidationError> {
    let path = directory.join("SKILL.md");
    let metadata = std::fs::symlink_metadata(&path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            validation_error(
                SkillValidationCode::MissingSkillFile,
                "Skill folder does not contain a SKILL.md file.",
            )
        } else {
            validation_error(
                SkillValidationCode::UnreadableSkillFile,
                format!("SKILL.md could not be inspected: {error}"),
            )
        }
    })?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(validation_error(
            SkillValidationCode::UnreadableSkillFile,
            "SKILL.md is not a readable regular file.",
        ));
    }
    if metadata.len() > MAX_SKILL_FILE_BYTES {
        return Err(validation_error(
            SkillValidationCode::SkillTooLarge,
            format!("SKILL.md exceeds the {MAX_SKILL_FILE_BYTES}-byte limit."),
        ));
    }
    let mut file = open_nofollow(&path).map_err(|error| {
        validation_error(
            SkillValidationCode::UnreadableSkillFile,
            format!("SKILL.md could not be read: {error}"),
        )
    })?;
    let opened = file.metadata().map_err(|error| {
        validation_error(
            SkillValidationCode::UnreadableSkillFile,
            format!("SKILL.md could not be inspected after opening: {error}"),
        )
    })?;
    if !opened.is_file() || is_reparse_point(&opened) || opened.len() > MAX_SKILL_FILE_BYTES {
        return Err(validation_error(
            SkillValidationCode::UnreadableSkillFile,
            "SKILL.md changed while it was being opened.",
        ));
    }
    let mut bytes = Vec::with_capacity(opened.len() as usize);
    Read::by_ref(&mut file)
        .take(MAX_SKILL_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            validation_error(
                SkillValidationCode::UnreadableSkillFile,
                format!("SKILL.md could not be read: {error}"),
            )
        })?;
    if bytes.len() as u64 > MAX_SKILL_FILE_BYTES {
        return Err(validation_error(
            SkillValidationCode::SkillTooLarge,
            format!("SKILL.md exceeds the {MAX_SKILL_FILE_BYTES}-byte limit."),
        ));
    }
    String::from_utf8(bytes).map_err(|error| {
        validation_error(
            SkillValidationCode::UnreadableSkillFile,
            format!("SKILL.md is not valid UTF-8: {error}"),
        )
    })
}

fn recover_skill_fields(markdown: &str, id: &str) -> (String, String, String) {
    let Ok((frontmatter, body)) = split_frontmatter(markdown) else {
        return (id.to_string(), String::new(), markdown.trim().to_string());
    };
    let mapping = serde_yaml::from_str::<serde_yaml::Value>(&frontmatter)
        .ok()
        .and_then(|value| match value {
            serde_yaml::Value::Mapping(mapping) => Some(mapping),
            _ => None,
        });
    let string_field = |field: &str| {
        mapping
            .as_ref()
            .and_then(|mapping| yaml_field(mapping, field))
            .and_then(serde_yaml::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    (
        string_field("name").unwrap_or_else(|| id.to_string()),
        string_field("description").unwrap_or_default(),
        body.trim().to_string(),
    )
}

pub(crate) fn regular_file_matches(path: &Path, expected: &[u8]) -> bool {
    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return false;
    };
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || is_reparse_point(&metadata)
        || metadata.len() != expected.len() as u64
    {
        return false;
    }
    let Ok(mut file) = open_nofollow(path) else {
        return false;
    };
    let Ok(opened) = file.metadata() else {
        return false;
    };
    if !opened.is_file() || is_reparse_point(&opened) || opened.len() != expected.len() as u64 {
        return false;
    }
    let mut bytes = Vec::with_capacity(expected.len());
    Read::by_ref(&mut file)
        .take(expected.len() as u64 + 1)
        .read_to_end(&mut bytes)
        .is_ok()
        && bytes == expected
}

pub(crate) fn read_managed_manifest(directory: &Path) -> Option<ManagedManifest> {
    let path = directory.join(MANAGED_MANIFEST_FILE);
    let metadata = std::fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || is_reparse_point(&metadata)
        || metadata.len() > MAX_STATE_BYTES
    {
        return None;
    }
    let mut file = open_nofollow(&path).ok()?;
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(MAX_STATE_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    let manifest: ManagedManifest = serde_json::from_slice(&bytes).ok()?;
    if manifest.schema_version != MANAGED_MANIFEST_SCHEMA_VERSION {
        return None;
    }
    Some(manifest)
}

pub(crate) fn write_managed_manifest(
    directory: &Path,
    manifest: &ManagedManifest,
) -> Result<(), String> {
    let raw = serde_json::to_vec_pretty(manifest)
        .map_err(|error| format!("Could not encode skill provenance: {error}"))?;
    crate::sandbox::atomic_write(&directory.join(MANAGED_MANIFEST_FILE), &raw)
        .map_err(|error| format!("Could not write skill provenance: {error}"))
}

pub(crate) fn has_first_party_marker(directory: &Path) -> bool {
    regular_file_matches(
        &directory.join(FIRST_PARTY_MARKER_FILE),
        FIRST_PARTY_MARKER.as_bytes(),
    )
}

fn source_for(directory: &Path, manifest: Option<&ManagedManifest>) -> SkillSource {
    match manifest.map(|manifest| manifest.source) {
        Some(SkillSource::Bundled) if has_first_party_marker(directory) => SkillSource::Bundled,
        Some(SkillSource::Catalog) => SkillSource::Catalog,
        _ => SkillSource::User,
    }
}

fn walk_skill_files(
    directory: &Path,
    prefix: &str,
    depth: usize,
    budget: &mut CopyBudget,
    files: &mut Vec<(String, u64)>,
) -> Result<(), String> {
    if depth > MAX_PACK_DEPTH {
        return Err(format!(
            "Skill folder exceeds the maximum depth of {MAX_PACK_DEPTH}."
        ));
    }
    let entries = std::fs::read_dir(directory)
        .map_err(|error| format!("Could not read a skill folder: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Could not read a skill entry: {error}"))?;
        budget.entries += 1;
        if budget.entries > MAX_PACK_ENTRIES {
            return Err(format!(
                "Skill folder exceeds the limit of {MAX_PACK_ENTRIES} entries."
            ));
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let relative = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        if depth == 0 && (name == MANAGED_MANIFEST_FILE || name == FIRST_PARTY_MARKER_FILE) {
            continue;
        }
        let metadata = match std::fs::symlink_metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            continue;
        }
        if metadata.is_dir() {
            walk_skill_files(&entry.path(), &relative, depth + 1, budget, files)?;
            continue;
        }
        if !metadata.is_file() {
            continue;
        }
        budget.bytes = budget.bytes.saturating_add(metadata.len());
        if budget.bytes > MAX_PACK_BYTES {
            return Err(format!(
                "Skill folder exceeds the limit of {MAX_PACK_BYTES} bytes."
            ));
        }
        files.push((relative, metadata.len()));
    }
    Ok(())
}

pub(crate) fn skill_tree_files(directory: &Path) -> Result<Vec<(String, u64)>, String> {
    let mut files = Vec::new();
    walk_skill_files(directory, "", 0, &mut CopyBudget::default(), &mut files)?;
    files.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(files)
}

pub(crate) fn tree_sha256(directory: &Path) -> Result<String, String> {
    let files = skill_tree_files(directory)?;
    let mut hasher = Sha256::new();
    for (relative, _) in &files {
        let path = directory.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
        let mut file = open_nofollow(&path)
            .map_err(|error| format!("Could not read \"{relative}\": {error}"))?;
        let mut bytes = Vec::new();
        Read::by_ref(&mut file)
            .take(MAX_PACK_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("Could not read \"{relative}\": {error}"))?;
        hasher.update(relative.as_bytes());
        hasher.update([0u8]);
        hasher.update((bytes.len() as u64).to_le_bytes());
        hasher.update(&bytes);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn supporting_files(directory: &Path) -> Vec<SkillFile> {
    skill_tree_files(directory)
        .unwrap_or_default()
        .into_iter()
        .filter(|(path, _)| path != "SKILL.md")
        .map(|(path, bytes)| SkillFile { path, bytes })
        .collect()
}

fn directory_label(directory: &Path) -> String {
    directory.to_string_lossy().to_string()
}

fn invalid_record(
    id: &str,
    directory: Option<&Path>,
    source: SkillSource,
    update_available: bool,
    markdown: Option<&str>,
    error: SkillValidationError,
) -> SkillRecord {
    let (name, description, instructions) = markdown
        .map(|markdown| recover_skill_fields(markdown, id))
        .unwrap_or_else(|| (id.to_string(), String::new(), String::new()));
    SkillRecord {
        id: id.to_string(),
        name,
        description,
        instructions,
        dir: directory.map(directory_label).unwrap_or_default(),
        files: directory.map(supporting_files).unwrap_or_default(),
        license: None,
        compatibility: None,
        allowed_tools: Vec::new(),
        version: None,
        author: None,
        tier: SkillTier::User,
        phase: None,
        tools: Vec::new(),
        source,
        pack_version: None,
        update_available,
        project_enabled: false,
        enabled: false,
        removable: source != SkillSource::Bundled,
        validation: SkillValidation::Invalid {
            code: error.code,
            message: error.message,
        },
    }
}

struct RecordContext<'a> {
    state: &'a SkillsState,
    project_id: Option<&'a str>,
    pack_version: Option<&'a str>,
    pack_ids: &'a BTreeSet<String>,
}

fn inspect_real_skill(directory: &Path, id: &str, context: &RecordContext<'_>) -> SkillRecord {
    let manifest = read_managed_manifest(directory);
    let source = source_for(directory, manifest.as_ref());
    let repairable = source == SkillSource::Bundled
        && context.pack_ids.contains(id)
        && context.pack_version.is_some();
    let markdown = match read_skill_markdown(directory) {
        Ok(markdown) => markdown,
        Err(error) => return invalid_record(id, Some(directory), source, repairable, None, error),
    };
    let document = match parse_skill_markdown(&markdown) {
        Ok(document) => document,
        Err(error) => {
            return invalid_record(
                id,
                Some(directory),
                source,
                repairable,
                Some(&markdown),
                error,
            )
        }
    };
    let pack_version = manifest
        .as_ref()
        .and_then(|manifest| manifest.pack_version.clone());
    let update_available = source == SkillSource::Bundled
        && context.pack_ids.contains(id)
        && context.pack_version.is_some()
        && pack_version.as_deref() != context.pack_version;
    let tier = document
        .tier
        .or_else(|| manifest.as_ref().and_then(|manifest| manifest.tier))
        .unwrap_or(match source {
            SkillSource::Bundled => SkillTier::Native,
            SkillSource::Catalog => SkillTier::Shelf,
            SkillSource::User => SkillTier::User,
        });
    let project_enabled = context
        .project_id
        .and_then(|project| context.state.project_enabled.get(project))
        .map(|ids| ids.contains(id))
        .unwrap_or(false);
    SkillRecord {
        id: id.to_string(),
        name: document.name,
        description: document.description,
        instructions: document.instructions,
        dir: directory_label(directory),
        files: supporting_files(directory),
        license: document.license.or_else(|| {
            manifest
                .as_ref()
                .and_then(|manifest| manifest.license.clone())
        }),
        compatibility: document.compatibility,
        allowed_tools: document.allowed_tools,
        version: document.version,
        author: document.author,
        tier,
        phase: document.phase.or_else(|| {
            manifest
                .as_ref()
                .and_then(|manifest| manifest.phase.clone())
        }),
        tools: document.tools,
        source,
        pack_version,
        update_available,
        project_enabled,
        enabled: context.state.enabled.contains(id),
        removable: source != SkillSource::Bundled,
        validation: SkillValidation::Valid,
    }
}

fn state_path(root: &Path) -> PathBuf {
    root.join("skills-state.json")
}

fn read_state(root: &Path) -> Result<SkillsState, String> {
    let path = state_path(root);
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SkillsState::default());
        }
        Err(error) => return Err(format!("Could not inspect skill settings: {error}")),
    };
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || is_reparse_point(&metadata)
        || metadata.len() > MAX_STATE_BYTES
    {
        return Err("Skill settings are not stored in a readable regular file.".into());
    }
    let mut file =
        open_nofollow(&path).map_err(|error| format!("Could not read skill settings: {error}"))?;
    let opened = file
        .metadata()
        .map_err(|error| format!("Could not inspect opened skill settings: {error}"))?;
    if !opened.is_file() || is_reparse_point(&opened) || opened.len() > MAX_STATE_BYTES {
        return Err("Skill settings changed while they were being opened.".into());
    }
    let mut bytes = Vec::with_capacity(opened.len() as usize);
    Read::by_ref(&mut file)
        .take(MAX_STATE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read skill settings: {error}"))?;
    if bytes.len() as u64 > MAX_STATE_BYTES {
        return Err("Skill settings exceed the storage limit.".into());
    }
    let raw = String::from_utf8(bytes)
        .map_err(|error| format!("Skill settings are not valid UTF-8: {error}"))?;
    let state: SkillsState = serde_json::from_str(&raw)
        .map_err(|error| format!("Skill settings are invalid: {error}"))?;
    if state.version == 0 || state.version > STATE_VERSION {
        return Err(format!(
            "Skill settings use unsupported version {}.",
            state.version
        ));
    }
    Ok(state)
}

fn write_state(root: &Path, state: &SkillsState) -> Result<(), String> {
    let mut state = SkillsState {
        version: STATE_VERSION,
        enabled: state.enabled.clone(),
        seen: state.seen.clone(),
        project_enabled: state.project_enabled.clone(),
    };
    state.project_enabled.retain(|_, ids| !ids.is_empty());
    let raw = serde_json::to_vec_pretty(&state)
        .map_err(|error| format!("Could not encode skill settings: {error}"))?;
    crate::sandbox::atomic_write(&state_path(root), &raw)
        .map_err(|error| format!("Could not save skill settings: {error}"))
}

fn staged_removal_skill_id(id: &str) -> Option<&str> {
    let suffix = id.strip_prefix(REMOVAL_STAGING_PREFIX)?;
    let (nonce, skill_id) = suffix.split_once('-')?;
    if nonce.len() == 16
        && nonce.bytes().all(|byte| byte.is_ascii_hexdigit())
        && validate_skill_id(skill_id).is_ok()
    {
        Some(skill_id)
    } else {
        None
    }
}

pub(crate) fn legacy_default_skills() -> &'static [(&'static str, &'static str, &'static str); 10] {
    &LEGACY_DEFAULT_SKILLS
}

fn list_unlocked(
    root: &Path,
    pack_root: Option<&Path>,
    project_id: Option<&str>,
) -> Result<Vec<SkillRecord>, String> {
    let skills = managed_skills_root(root)?;
    let pack = pack_root.and_then(|pack_root| {
        let manifest = crate::skills_pack::read_pack_manifest(pack_root)
            .ok()
            .flatten()?;
        let _ = crate::skills_pack::seed_from_pack_in(&skills, pack_root, &manifest);
        Some(manifest)
    });
    let pack_ids: BTreeSet<String> = pack
        .as_ref()
        .map(|manifest| {
            manifest
                .skills
                .iter()
                .map(|skill| skill.id.clone())
                .collect()
        })
        .unwrap_or_default();
    let mut state = read_state(root)?;
    let upgraded = state.version != STATE_VERSION;
    let mut records = Vec::new();
    for entry in std::fs::read_dir(&skills)
        .map_err(|error| format!("Could not read the skills directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Could not read a skill entry: {error}"))?;
        let id = entry.file_name().to_string_lossy().to_string();
        if id.starts_with(".skill-import-") {
            continue;
        }
        if id.starts_with(STALE_STAGING_PREFIX) {
            let _ = std::fs::remove_dir_all(entry.path());
            continue;
        }
        if id.starts_with(REMOVAL_STAGING_PREFIX) {
            if let Some(skill_id) = staged_removal_skill_id(&id) {
                if state.enabled.remove(skill_id) {
                    write_state(root, &state)?;
                }
            }
            let _ = std::fs::remove_dir_all(entry.path());
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Could not inspect skill \"{id}\": {error}"))?;
        if !file_type.is_dir() && !file_type.is_symlink() {
            continue;
        }
        let context = RecordContext {
            state: &state,
            project_id,
            pack_version: pack.as_ref().map(|manifest| manifest.version.as_str()),
            pack_ids: &pack_ids,
        };
        match secure_skill_directory(&skills, &id) {
            Ok(directory) => records.push(inspect_real_skill(&directory, &id, &context)),
            Err(message) => records.push(invalid_record(
                &id,
                None,
                SkillSource::User,
                false,
                None,
                validation_error(SkillValidationCode::UnsafePath, message),
            )),
        }
    }
    records.sort_by(|left, right| left.id.cmp(&right.id));
    let mut normalized_enabled: BTreeSet<String> = BTreeSet::new();
    let mut normalized_seen: BTreeSet<String> = BTreeSet::new();
    let mut valid_ids: BTreeSet<String> = BTreeSet::new();
    for record in records.iter() {
        if !matches!(&record.validation, SkillValidation::Valid) {
            continue;
        }
        valid_ids.insert(record.id.clone());
        normalized_seen.insert(record.id.clone());
        let wanted = if state.seen.contains(&record.id) {
            state.enabled.contains(&record.id)
        } else {
            true
        };
        if wanted {
            normalized_enabled.insert(record.id.clone());
        }
    }
    let mut normalized_projects: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for (project, ids) in state.project_enabled.iter() {
        let kept: BTreeSet<String> = ids
            .iter()
            .filter(|id| valid_ids.contains(*id))
            .cloned()
            .collect();
        if !kept.is_empty() {
            normalized_projects.insert(project.clone(), kept);
        }
    }
    if upgraded
        || normalized_enabled != state.enabled
        || normalized_seen != state.seen
        || normalized_projects != state.project_enabled
    {
        state.version = STATE_VERSION;
        state.enabled = normalized_enabled;
        state.seen = normalized_seen;
        state.project_enabled = normalized_projects;
        write_state(root, &state)?;
    }
    for record in &mut records {
        record.enabled = matches!(&record.validation, SkillValidation::Valid)
            && state.enabled.contains(&record.id);
        record.project_enabled = matches!(&record.validation, SkillValidation::Valid)
            && project_id
                .and_then(|project| state.project_enabled.get(project))
                .map(|ids| ids.contains(&record.id))
                .unwrap_or(false);
    }
    Ok(records)
}

#[allow(dead_code)]
pub fn list(root: &Path) -> Result<Vec<SkillRecord>, String> {
    list_with(root, None, None)
}

pub fn list_with(
    root: &Path,
    pack_root: Option<&Path>,
    project_id: Option<&str>,
) -> Result<Vec<SkillRecord>, String> {
    let _guard = SKILLS_WRITE_LOCK
        .lock()
        .map_err(|_| "Skill storage is busy.".to_string())?;
    list_unlocked(root, pack_root, project_id)
}

fn validate_unlocked(root: &Path, id: &str) -> Result<SkillRecord, String> {
    let skills = managed_skills_root(root)?;
    validate_skill_id(id)?;
    let directory = secure_skill_directory(&skills, id)?;
    let state = read_state(root)?;
    let context = RecordContext {
        state: &state,
        project_id: None,
        pack_version: None,
        pack_ids: &BTreeSet::new(),
    };
    Ok(inspect_real_skill(&directory, id, &context))
}

pub fn validate(root: &Path, id: &str) -> Result<SkillRecord, String> {
    let _guard = SKILLS_WRITE_LOCK
        .lock()
        .map_err(|_| "Skill storage is busy.".to_string())?;
    validate_unlocked(root, id)
}

fn record_for(root: &Path, skills: &Path, id: &str) -> Result<SkillRecord, String> {
    let directory = secure_skill_directory(skills, id)?;
    let state = read_state(root)?;
    let context = RecordContext {
        state: &state,
        project_id: None,
        pack_version: None,
        pack_ids: &BTreeSet::new(),
    };
    Ok(inspect_real_skill(&directory, id, &context))
}

fn slugify(name: &str) -> String {
    let mut slug = String::new();
    let mut separator = false;
    for character in name.chars() {
        if character.is_ascii_alphanumeric() {
            if separator && !slug.is_empty() {
                slug.push('-');
            }
            separator = false;
            slug.push(character.to_ascii_lowercase());
        } else {
            separator = true;
        }
        if slug.len() >= 64 {
            break;
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        "skill".to_string()
    } else {
        slug.to_string()
    }
}

fn unique_skill_id(skills: &Path, name: &str) -> Result<String, String> {
    let base = slugify(name);
    for number in 1..=999 {
        let id = if number == 1 {
            base.clone()
        } else {
            format!("{base}-{number}")
        };
        match std::fs::symlink_metadata(skills.join(&id)) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(id),
            Ok(_) => {}
            Err(error) => return Err(format!("Could not check skill id \"{id}\": {error}")),
        }
    }
    Err(format!(
        "Could not find an available folder name for \"{name}\"."
    ))
}

fn render_skill_markdown(
    name: &str,
    description: &str,
    instructions: &str,
) -> Result<String, String> {
    render_skill_markdown_with_mapping(serde_yaml::Mapping::new(), name, description, instructions)
}

fn render_skill_markdown_with_mapping(
    mut mapping: serde_yaml::Mapping,
    name: &str,
    description: &str,
    instructions: &str,
) -> Result<String, String> {
    mapping.insert(
        serde_yaml::Value::String("name".into()),
        serde_yaml::Value::String(name.into()),
    );
    mapping.insert(
        serde_yaml::Value::String("description".into()),
        serde_yaml::Value::String(description.into()),
    );
    let yaml = serde_yaml::to_string(&mapping)
        .map_err(|error| format!("Could not encode SKILL.md front matter: {error}"))?;
    let markdown = format!(
        "---\n{}---\n\n{}\n",
        yaml.trim_start_matches("---\n"),
        instructions.trim()
    );
    parse_skill_markdown(&markdown).map_err(|error| error.message)?;
    Ok(markdown)
}

pub(crate) fn copy_tree(
    source_root: &Path,
    source: &Path,
    destination: &Path,
    depth: usize,
    budget: &mut CopyBudget,
) -> Result<(), String> {
    if depth > MAX_PACK_DEPTH {
        return Err(format!(
            "Skill folder exceeds the maximum depth of {MAX_PACK_DEPTH}."
        ));
    }
    let source_metadata = std::fs::symlink_metadata(source)
        .map_err(|error| format!("Could not inspect a skill folder: {error}"))?;
    if !source_metadata.is_dir()
        || source_metadata.file_type().is_symlink()
        || is_reparse_point(&source_metadata)
    {
        return Err("Skill folder contains a linked directory.".into());
    }
    let resolved_source = source
        .canonicalize()
        .map_err(|error| format!("Could not resolve a skill folder: {error}"))?;
    if !resolved_source.starts_with(source_root) {
        return Err("Skill folder contains a directory outside the selected folder.".into());
    }
    std::fs::create_dir(destination)
        .map_err(|error| format!("Could not create a skill folder: {error}"))?;
    for entry in std::fs::read_dir(&resolved_source)
        .map_err(|error| format!("Could not read the selected skill folder: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Could not read a skill entry: {error}"))?;
        budget.entries += 1;
        if budget.entries > MAX_PACK_ENTRIES {
            return Err(format!(
                "Skill folder exceeds the limit of {MAX_PACK_ENTRIES} entries."
            ));
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if depth == 0 && (name == MANAGED_MANIFEST_FILE || name == FIRST_PARTY_MARKER_FILE) {
            continue;
        }
        let path = entry.path();
        let target = destination.join(entry.file_name());
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| format!("Could not inspect a skill entry: {error}"))?;
        if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err(format!(
                "Skill folder contains a linked entry: {}",
                entry.file_name().to_string_lossy()
            ));
        }
        if metadata.is_dir() {
            copy_tree(source_root, &path, &target, depth + 1, budget)?;
            continue;
        }
        if !metadata.is_file() {
            return Err(format!(
                "Skill folder contains an unsupported entry: {}",
                entry.file_name().to_string_lossy()
            ));
        }
        budget.bytes = budget.bytes.saturating_add(metadata.len());
        if budget.bytes > MAX_PACK_BYTES {
            return Err(format!(
                "Skill folder exceeds the limit of {MAX_PACK_BYTES} bytes."
            ));
        }
        let resolved_path = path
            .canonicalize()
            .map_err(|error| format!("Could not resolve a skill file: {error}"))?;
        if !resolved_path.starts_with(source_root) {
            return Err("Skill folder contains a file outside the selected folder.".into());
        }
        let mut input = open_nofollow(&resolved_path)
            .map_err(|error| format!("Could not open a skill file: {error}"))?;
        let opened = input
            .metadata()
            .map_err(|error| format!("Could not inspect an opened skill file: {error}"))?;
        if !opened.is_file() || is_reparse_point(&opened) || opened.len() != metadata.len() {
            return Err("A skill file changed while it was being copied.".into());
        }
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|error| format!("Could not create a copied skill file: {error}"))?;
        let copied = std::io::copy(
            &mut Read::by_ref(&mut input).take(opened.len() + 1),
            &mut output,
        )
        .map_err(|error| format!("Could not copy a skill file: {error}"))?;
        if copied != opened.len() {
            return Err("A skill file changed while it was being copied.".into());
        }
        output
            .flush()
            .map_err(|error| format!("Could not finish copying a skill file: {error}"))?;
    }
    Ok(())
}

pub(crate) fn staging_path(skills: &Path, prefix: &str) -> PathBuf {
    loop {
        let candidate = skills.join(format!("{prefix}{:016x}", rand::random::<u64>()));
        if std::fs::symlink_metadata(&candidate).is_err() {
            return candidate;
        }
    }
}

pub(crate) fn install_tree(
    skills: &Path,
    id: &str,
    source: &Path,
    manifest: &ManagedManifest,
    marker: bool,
) -> Result<(), String> {
    validate_skill_id(id)?;
    let resolved_source = source
        .canonicalize()
        .map_err(|error| format!("Could not resolve the skill source folder: {error}"))?;
    let staging = staging_path(skills, ".skill-import-");
    let staged = (|| {
        copy_tree(
            &resolved_source,
            &resolved_source,
            &staging,
            0,
            &mut CopyBudget::default(),
        )?;
        let markdown = read_skill_markdown(&staging).map_err(|error| error.message)?;
        parse_skill_markdown(&markdown).map_err(|error| error.message)?;
        let mut manifest = manifest.clone();
        manifest.tree_sha256 = tree_sha256(&staging)?;
        write_managed_manifest(&staging, &manifest)?;
        if marker {
            crate::sandbox::atomic_write(
                &staging.join(FIRST_PARTY_MARKER_FILE),
                FIRST_PARTY_MARKER.as_bytes(),
            )
            .map_err(|error| format!("Could not write built-in skill provenance: {error}"))?;
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = staged {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }
    let destination = skills.join(id);
    let replaced = std::fs::symlink_metadata(&destination).is_ok();
    if replaced {
        let tombstone = staging_path(skills, STALE_STAGING_PREFIX);
        let tombstone = tombstone.with_file_name(format!(
            "{}-{id}",
            tombstone.file_name().unwrap_or_default().to_string_lossy()
        ));
        if let Err(error) = std::fs::rename(&destination, &tombstone) {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(format!("Could not replace skill \"{id}\": {error}"));
        }
        if let Err(error) = std::fs::rename(&staging, &destination) {
            let _ = std::fs::rename(&tombstone, &destination);
            let _ = std::fs::remove_dir_all(&staging);
            return Err(format!("Could not install skill \"{id}\": {error}"));
        }
        let _ = std::fs::remove_dir_all(&tombstone);
        return Ok(());
    }
    if let Err(error) = std::fs::rename(&staging, &destination) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(format!("Could not install skill \"{id}\": {error}"));
    }
    Ok(())
}

fn disable_id(root: &Path, id: &str) -> Result<(), String> {
    let mut state = read_state(root)?;
    let changed = state.enabled.remove(id);
    if changed {
        write_state(root, &state)?;
    }
    Ok(())
}

fn hide_new_skill(root: &Path, id: &str) -> Result<(), String> {
    let mut state = read_state(root)?;
    state.enabled.remove(id);
    state.seen.insert(id.to_string());
    write_state(root, &state)
}

pub fn add(root: &Path, pack_root: Option<&Path>, source: &Path) -> Result<SkillRecord, String> {
    let _guard = SKILLS_WRITE_LOCK
        .lock()
        .map_err(|_| "Skill storage is busy.".to_string())?;
    if !source.is_absolute() {
        return Err("Choose an absolute skill folder path.".into());
    }
    let skills = managed_skills_root(root)?;
    seed_in(&skills, pack_root);
    let metadata = std::fs::symlink_metadata(source)
        .map_err(|error| format!("Could not inspect the selected skill folder: {error}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err("The selected skill path is not a real directory.".into());
    }
    let resolved_source = source
        .canonicalize()
        .map_err(|error| format!("Could not resolve the selected skill folder: {error}"))?;
    if resolved_source.starts_with(&skills) {
        return Err("That skill is already inside the Oleafly skills directory.".into());
    }
    if skills.starts_with(&resolved_source) {
        return Err("Choose a skill folder outside the Oleafly data directory.".into());
    }
    let document = parse_skill_markdown(
        &read_skill_markdown(&resolved_source).map_err(|error| error.message)?,
    )
    .map_err(|error| error.message)?;
    let id = slugify(&document.name);
    if std::fs::symlink_metadata(skills.join(&id)).is_ok() {
        return Err(format!("A skill with folder id \"{id}\" already exists."));
    }
    let staging = staging_path(&skills, ".skill-import-");
    let copied = (|| {
        copy_tree(
            &resolved_source,
            &resolved_source,
            &staging,
            0,
            &mut CopyBudget::default(),
        )?;
        let staged_markdown = read_skill_markdown(&staging).map_err(|error| error.message)?;
        parse_skill_markdown(&staged_markdown).map_err(|error| error.message)?;
        disable_id(root, &id)?;
        std::fs::rename(&staging, skills.join(&id))
            .map_err(|error| format!("Could not install the skill: {error}"))?;
        Ok::<(), String>(())
    })();
    if let Err(error) = copied {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }
    record_for(root, &skills, &id)
}

pub fn create(
    root: &Path,
    pack_root: Option<&Path>,
    input: CreateSkillInput,
) -> Result<SkillRecord, String> {
    let _guard = SKILLS_WRITE_LOCK
        .lock()
        .map_err(|_| "Skill storage is busy.".to_string())?;
    let skills = managed_skills_root(root)?;
    seed_in(&skills, pack_root);
    let instructions = input
        .instructions
        .as_deref()
        .filter(|instructions| !instructions.trim().is_empty())
        .unwrap_or(DEFAULT_INSTRUCTIONS);
    let markdown = render_skill_markdown(&input.name, &input.description, instructions)?;
    let document = parse_skill_markdown(&markdown).map_err(|error| error.message)?;
    let id = unique_skill_id(&skills, &document.name)?;
    let directory = skills.join(&id);
    std::fs::create_dir(&directory)
        .map_err(|error| format!("Could not create the skill folder: {error}"))?;
    if let Err(error) =
        crate::sandbox::atomic_write(&directory.join("SKILL.md"), markdown.as_bytes())
            .map_err(|error| format!("Could not write SKILL.md: {error}"))
            .and_then(|_| hide_new_skill(root, &id))
    {
        let _ = std::fs::remove_dir_all(&directory);
        return Err(error);
    }
    record_for(root, &skills, &id)
}

pub fn update(root: &Path, id: &str, input: UpdateSkillInput) -> Result<SkillRecord, String> {
    let _guard = SKILLS_WRITE_LOCK
        .lock()
        .map_err(|_| "Skill storage is busy.".to_string())?;
    let skills = managed_skills_root(root)?;
    let directory = secure_skill_directory(&skills, id)?;
    let mapping = read_skill_markdown(&directory)
        .ok()
        .and_then(|markdown| split_frontmatter(&markdown).ok())
        .and_then(|(frontmatter, _)| serde_yaml::from_str::<serde_yaml::Value>(&frontmatter).ok())
        .and_then(|value| value.as_mapping().cloned())
        .unwrap_or_default();
    let markdown = render_skill_markdown_with_mapping(
        mapping,
        &input.name,
        &input.description,
        &input.instructions,
    )?;
    let _ = read_state(root)?;
    crate::sandbox::atomic_write(&directory.join("SKILL.md"), markdown.as_bytes())
        .map_err(|error| format!("Could not update SKILL.md: {error}"))?;
    record_for(root, &skills, id)
}

pub fn set_enabled(
    root: &Path,
    pack_root: Option<&Path>,
    project_id: Option<&str>,
    id: &str,
    enabled: bool,
) -> Result<SkillRecord, String> {
    let _guard = SKILLS_WRITE_LOCK
        .lock()
        .map_err(|_| "Skill storage is busy.".to_string())?;
    if let Some(project) = project_id {
        crate::paths::validate_project_id(project)?;
    }
    let _ = list_unlocked(root, pack_root, project_id)?;
    let skills = managed_skills_root(root)?;
    let directory = secure_skill_directory(&skills, id)?;
    let mut state = read_state(root)?;
    let context = RecordContext {
        state: &state,
        project_id,
        pack_version: None,
        pack_ids: &BTreeSet::new(),
    };
    let current = inspect_real_skill(&directory, id, &context);
    if enabled {
        if let SkillValidation::Invalid { message, .. } = &current.validation {
            return Err(message.clone());
        }
        state.enabled.insert(id.to_string());
    } else {
        state.enabled.remove(id);
    }
    state.seen.insert(id.to_string());
    write_state(root, &state)?;
    listed_record(root, pack_root, project_id, id)
}

pub fn set_project_enabled(
    root: &Path,
    pack_root: Option<&Path>,
    project_id: &str,
    id: &str,
    enabled: bool,
) -> Result<SkillRecord, String> {
    let _guard = SKILLS_WRITE_LOCK
        .lock()
        .map_err(|_| "Skill storage is busy.".to_string())?;
    crate::paths::validate_project_id(project_id)?;
    let _ = list_unlocked(root, pack_root, Some(project_id))?;
    let skills = managed_skills_root(root)?;
    let directory = secure_skill_directory(&skills, id)?;
    let mut state = read_state(root)?;
    let context = RecordContext {
        state: &state,
        project_id: Some(project_id),
        pack_version: None,
        pack_ids: &BTreeSet::new(),
    };
    let current = inspect_real_skill(&directory, id, &context);
    if enabled {
        if let SkillValidation::Invalid { message, .. } = &current.validation {
            return Err(message.clone());
        }
        state
            .project_enabled
            .entry(project_id.to_string())
            .or_default()
            .insert(id.to_string());
    } else if let Some(ids) = state.project_enabled.get_mut(project_id) {
        ids.remove(id);
        if ids.is_empty() {
            state.project_enabled.remove(project_id);
        }
    }
    state.seen.insert(id.to_string());
    write_state(root, &state)?;
    listed_record(root, pack_root, Some(project_id), id)
}

fn listed_record(
    root: &Path,
    pack_root: Option<&Path>,
    project_id: Option<&str>,
    id: &str,
) -> Result<SkillRecord, String> {
    list_unlocked(root, pack_root, project_id)?
        .into_iter()
        .find(|record| record.id == id)
        .ok_or_else(|| format!("Skill \"{id}\" could not be read after saving."))
}

fn remove_unlocked_with_writer(
    root: &Path,
    id: &str,
    state_writer: impl FnOnce(&Path, &SkillsState) -> Result<(), String>,
) -> Result<(), String> {
    let skills = managed_skills_root(root)?;
    let directory = secure_skill_directory(&skills, id)?;
    let manifest = read_managed_manifest(&directory);
    if source_for(&directory, manifest.as_ref()) == SkillSource::Bundled {
        return Err("Built-in skills can be disabled but cannot be removed.".into());
    }
    let mut state = read_state(root)?;
    let staging = staging_path(&skills, REMOVAL_STAGING_PREFIX);
    let staging = staging.with_file_name(format!(
        "{}-{id}",
        staging.file_name().unwrap_or_default().to_string_lossy()
    ));
    std::fs::rename(&directory, &staging)
        .map_err(|error| format!("Could not unregister skill \"{id}\": {error}"))?;
    let removed_enabled = state.enabled.remove(id);
    let mut removed_project = false;
    for ids in state.project_enabled.values_mut() {
        removed_project |= ids.remove(id);
    }
    if removed_enabled || removed_project {
        if let Err(error) = state_writer(root, &state) {
            return match std::fs::rename(&staging, &directory) {
                Ok(()) => Err(error),
                Err(rollback_error) => Err(format!(
                    "{error} The skill folder could not be restored: {rollback_error}"
                )),
            };
        }
    }
    let _ = std::fs::remove_dir_all(&staging);
    Ok(())
}

pub fn remove(root: &Path, id: &str) -> Result<(), String> {
    let _guard = SKILLS_WRITE_LOCK
        .lock()
        .map_err(|_| "Skill storage is busy.".to_string())?;
    remove_unlocked_with_writer(root, id, write_state)
}

pub(crate) fn install_staged_skill(
    root: &Path,
    id: &str,
    staged: &Path,
    manifest: &ManagedManifest,
) -> Result<SkillRecord, String> {
    let _guard = SKILLS_WRITE_LOCK
        .lock()
        .map_err(|_| "Skill storage is busy.".to_string())?;
    let skills = managed_skills_root(root)?;
    install_tree(&skills, id, staged, manifest, false)?;
    list_unlocked(root, None, None)?
        .into_iter()
        .find(|record| record.id == id)
        .ok_or_else(|| format!("Skill \"{id}\" could not be read after installing."))
}

fn seed_in(skills: &Path, pack_root: Option<&Path>) {
    let Some(pack_root) = pack_root else {
        return;
    };
    let Ok(Some(manifest)) = crate::skills_pack::read_pack_manifest(pack_root) else {
        return;
    };
    let _ = crate::skills_pack::seed_from_pack_in(skills, pack_root, &manifest);
}

pub fn update_builtin(root: &Path, pack_root: &Path, id: &str) -> Result<SkillRecord, String> {
    let _guard = SKILLS_WRITE_LOCK
        .lock()
        .map_err(|_| "Skill storage is busy.".to_string())?;
    let skills = managed_skills_root(root)?;
    crate::skills_pack::force_update_from_pack(&skills, pack_root, id)?;
    record_for(root, &skills, id)
}

fn resolve_skill_file(directory: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.trim().is_empty() {
        return Err("Name a file inside the skill folder.".into());
    }
    if relative.contains('\0') || relative.chars().any(char::is_control) {
        return Err("That skill file path is not allowed.".into());
    }
    if Path::new(relative).is_absolute() || relative.starts_with('/') || relative.starts_with('\\')
    {
        return Err("Use a path relative to the skill folder.".into());
    }
    let mut current = directory.to_path_buf();
    let mut segments = 0usize;
    let parts: Vec<&str> = relative.split(['/', '\\']).collect();
    let last = parts.len();
    for (index, segment) in parts.iter().enumerate() {
        if segment.is_empty() || *segment == "." {
            continue;
        }
        if *segment == ".." || segment.contains(':') {
            return Err("That skill file path is not allowed.".into());
        }
        segments += 1;
        if segments > MAX_PACK_DEPTH {
            return Err("That skill file path is too deeply nested.".into());
        }
        current = current.join(segment);
        let metadata = std::fs::symlink_metadata(&current)
            .map_err(|_| format!("The skill does not contain \"{relative}\"."))?;
        if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err("That skill file is a link and cannot be read.".into());
        }
        let is_last = index + 1 == last;
        if is_last {
            if !metadata.is_file() {
                return Err(format!("\"{relative}\" is not a file in this skill."));
            }
        } else if !metadata.is_dir() {
            return Err(format!("The skill does not contain \"{relative}\"."));
        }
    }
    if segments == 0 {
        return Err("Name a file inside the skill folder.".into());
    }
    let resolved = current
        .canonicalize()
        .map_err(|_| format!("The skill does not contain \"{relative}\"."))?;
    if !resolved.starts_with(directory) {
        return Err("That skill file path is not allowed.".into());
    }
    Ok(resolved)
}

pub fn read_skill_file(root: &Path, id: &str, relative: &str) -> Result<SkillFileContent, String> {
    let _guard = SKILLS_WRITE_LOCK
        .lock()
        .map_err(|_| "Skill storage is busy.".to_string())?;
    let skills = managed_skills_root(root)?;
    let directory = secure_skill_directory(&skills, id)?;
    let path = resolve_skill_file(&directory, relative)?;
    let mut file =
        open_nofollow(&path).map_err(|error| format!("Could not read that skill file: {error}"))?;
    let opened = file
        .metadata()
        .map_err(|error| format!("Could not inspect that skill file: {error}"))?;
    if !opened.is_file() || is_reparse_point(&opened) {
        return Err("That skill file is not a readable regular file.".into());
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(MAX_SKILL_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read that skill file: {error}"))?;
    let truncated = bytes.len() as u64 > MAX_SKILL_FILE_BYTES;
    if truncated {
        bytes.truncate(MAX_SKILL_FILE_BYTES as usize);
    }
    if bytes.contains(&0) {
        return Err(format!("\"{relative}\" is not a text file."));
    }
    let content = match std::str::from_utf8(&bytes) {
        Ok(text) => text.to_string(),
        Err(error) if truncated && error.error_len().is_none() => {
            String::from_utf8_lossy(&bytes[..error.valid_up_to()]).into_owned()
        }
        Err(_) => return Err(format!("\"{relative}\" is not a text file.")),
    };
    Ok(SkillFileContent {
        path: relative.replace('\\', "/"),
        content,
        truncated,
    })
}

fn app_pack_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    crate::skills_pack::pack_root(app)
}

#[tauri::command]
pub fn skills_list(
    app: tauri::AppHandle,
    project_id: Option<String>,
) -> Result<Vec<SkillRecord>, String> {
    let pack_root = app_pack_root(&app);
    let records = list_with(
        &crate::paths::oleafly_root()?,
        pack_root.as_deref(),
        project_id.as_deref().filter(|project| !project.is_empty()),
    )?;
    crate::skills_share::sync_after_list(&records);
    Ok(records)
}

#[tauri::command]
pub fn skills_add(app: tauri::AppHandle, source_path: String) -> Result<SkillRecord, String> {
    let pack_root = app_pack_root(&app);
    add(
        &crate::paths::oleafly_root()?,
        pack_root.as_deref(),
        Path::new(&source_path),
    )
}

#[tauri::command]
pub fn skills_create(
    app: tauri::AppHandle,
    input: CreateSkillInput,
) -> Result<SkillRecord, String> {
    let pack_root = app_pack_root(&app);
    create(&crate::paths::oleafly_root()?, pack_root.as_deref(), input)
}

#[tauri::command]
pub fn skills_update(id: String, input: UpdateSkillInput) -> Result<SkillRecord, String> {
    update(&crate::paths::oleafly_root()?, &id, input)
}

#[tauri::command]
pub fn skills_validate(id: String) -> Result<SkillRecord, String> {
    validate(&crate::paths::oleafly_root()?, &id)
}

#[tauri::command]
pub fn skills_set_enabled(
    app: tauri::AppHandle,
    id: String,
    enabled: bool,
    project_id: Option<String>,
) -> Result<SkillRecord, String> {
    let pack_root = app_pack_root(&app);
    set_enabled(
        &crate::paths::oleafly_root()?,
        pack_root.as_deref(),
        project_id.as_deref().filter(|project| !project.is_empty()),
        &id,
        enabled,
    )
}

#[tauri::command]
pub fn skills_set_project_enabled(
    app: tauri::AppHandle,
    project_id: String,
    id: String,
    enabled: bool,
) -> Result<SkillRecord, String> {
    let pack_root = app_pack_root(&app);
    set_project_enabled(
        &crate::paths::oleafly_root()?,
        pack_root.as_deref(),
        &project_id,
        &id,
        enabled,
    )
}

#[tauri::command]
pub fn skills_remove(id: String) -> Result<(), String> {
    remove(&crate::paths::oleafly_root()?, &id)
}

#[tauri::command]
pub fn skills_read_file(id: String, path: String) -> Result<SkillFileContent, String> {
    read_skill_file(&crate::paths::oleafly_root()?, &id, &path)
}

#[tauri::command]
pub fn skills_update_builtin(app: tauri::AppHandle, id: String) -> Result<SkillRecord, String> {
    let pack_root = app_pack_root(&app)
        .ok_or_else(|| "The built-in skill pack is not available.".to_string())?;
    update_builtin(&crate::paths::oleafly_root()?, &pack_root, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skills_pack::{seed_from_pack, PackManifest, PackOrigin, PackSkill};

    fn valid_skill(name: &str, description: &str, instructions: &str) -> String {
        format!("---\nname: {name}\ndescription: {description}\n---\n\n{instructions}\n")
    }

    fn write_skill(root: &Path, id: &str, markdown: &str) -> PathBuf {
        let directory = skills_root(root).join(id);
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("SKILL.md"), markdown).unwrap();
        directory
    }

    struct Pack {
        dir: tempfile::TempDir,
    }

    impl Pack {
        fn new(version: &str, ids: &[&str]) -> Self {
            let dir = tempfile::tempdir().unwrap();
            let pack = Pack { dir };
            for id in ids {
                pack.write_skill(
                    id,
                    &valid_skill(id, "A bundled research skill.", "Follow the steps."),
                );
            }
            pack.write_manifest(version, ids);
            pack
        }

        fn path(&self) -> &Path {
            self.dir.path()
        }

        fn write_skill(&self, id: &str, markdown: &str) {
            let directory = self.dir.path().join(id);
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::write(directory.join("SKILL.md"), markdown).unwrap();
        }

        fn write_file(&self, id: &str, relative: &str, contents: &str) {
            let path = self.dir.path().join(id).join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, contents).unwrap();
        }

        fn write_manifest(&self, version: &str, ids: &[&str]) {
            let manifest = PackManifest {
                schema_version: 1,
                pack: "research-core".into(),
                version: version.into(),
                skills: ids
                    .iter()
                    .map(|id| PackSkill {
                        id: (*id).to_string(),
                        name: Some((*id).to_string()),
                        description: Some("A bundled research skill.".into()),
                        tier: Some("native".into()),
                        phase: Some("research".into()),
                        license: Some("MIT".into()),
                        tree_sha256: String::new(),
                        files: None,
                        bytes: None,
                        origin: Some(PackOrigin {
                            repo: Some("https://example.invalid/pack".into()),
                            commit: Some("abc1234".into()),
                        }),
                    })
                    .collect(),
            };
            std::fs::write(
                self.dir.path().join("pack.json"),
                serde_json::to_vec_pretty(&manifest).unwrap(),
            )
            .unwrap();
        }
    }

    fn record<'a>(records: &'a [SkillRecord], id: &str) -> &'a SkillRecord {
        records
            .iter()
            .find(|record| record.id == id)
            .unwrap_or_else(|| panic!("no record for {id}"))
    }

    #[test]
    fn parses_valid_skill_frontmatter_and_instructions() {
        let parsed = parse_skill_markdown(&valid_skill(
            "proof-review",
            "Review a proof for logical gaps.",
            "Read each claim and verify its dependencies.",
        ))
        .unwrap();

        assert_eq!(parsed.name, "proof-review");
        assert_eq!(parsed.description, "Review a proof for logical gaps.");
        assert_eq!(
            parsed.instructions,
            "Read each claim and verify its dependencies."
        );
    }

    #[test]
    fn parses_the_optional_agent_skill_frontmatter() {
        let markdown = "---\nname: paper-lookup\ndescription: Find papers.\nlicense: MIT\ncompatibility: Oleafly 0.4\nallowed-tools: read_file, search_project\nmetadata:\n  version: 2.1.0\n  skill-author: K-Dense\n  oleafly:\n    tier: vendored\n    phase: research\n    tools:\n      - literature_search\n      - verify_citation\n---\n\nLook the paper up.\n";

        let parsed = parse_skill_markdown(markdown).unwrap();

        assert_eq!(parsed.license.as_deref(), Some("MIT"));
        assert_eq!(parsed.compatibility.as_deref(), Some("Oleafly 0.4"));
        assert_eq!(parsed.allowed_tools, vec!["read_file", "search_project"]);
        assert_eq!(
            parse_skill_markdown(
                "---\nname: paper-lookup\ndescription: Find papers.\nallowed-tools: Read Write Edit Bash\n---\n\nLook it up.\n"
            )
            .unwrap()
            .allowed_tools,
            vec!["Read", "Write", "Edit", "Bash"]
        );
        assert_eq!(parsed.version.as_deref(), Some("2.1.0"));
        assert_eq!(parsed.author.as_deref(), Some("K-Dense"));
        assert_eq!(parsed.tier, Some(SkillTier::Vendored));
        assert_eq!(parsed.phase.as_deref(), Some("research"));
        assert_eq!(parsed.tools, vec!["literature_search", "verify_citation"]);
    }

    #[test]
    fn rejects_a_skill_without_a_name() {
        let error = parse_skill_markdown(
            "---\ndescription: Review a proof for logical gaps.\n---\n\nRead each claim.\n",
        )
        .unwrap_err();

        assert_eq!(error.code, SkillValidationCode::MissingName);
        assert_eq!(
            error.message,
            "SKILL.md is missing the front matter field \"name\"."
        );
    }

    #[test]
    fn rejects_a_skill_without_a_description() {
        let error =
            parse_skill_markdown("---\nname: proof-review\n---\n\nRead each claim.\n").unwrap_err();

        assert_eq!(error.code, SkillValidationCode::MissingDescription);
        assert_eq!(
            error.message,
            "SKILL.md is missing the front matter field \"description\"."
        );
    }

    #[test]
    fn rejects_invalid_frontmatter_fields_and_missing_instructions() {
        let invalid_name = parse_skill_markdown(
            "---\nname: [proof, review]\ndescription: Review a proof.\n---\n\nRead each claim.\n",
        )
        .unwrap_err();
        assert_eq!(invalid_name.code, SkillValidationCode::InvalidName);

        let invalid_description = parse_skill_markdown(
            "---\nname: proof-review\ndescription: '   '\n---\n\nRead each claim.\n",
        )
        .unwrap_err();
        assert_eq!(
            invalid_description.code,
            SkillValidationCode::InvalidDescription
        );

        let missing_instructions =
            parse_skill_markdown("---\nname: proof-review\ndescription: Review a proof.\n---\n")
                .unwrap_err();
        assert_eq!(
            missing_instructions.code,
            SkillValidationCode::MissingInstructions
        );
    }

    #[test]
    fn accepts_the_long_descriptions_the_vendored_pack_ships() {
        let description = "Search, verify, and format references. ".repeat(20);
        assert!(description.chars().count() > 500);
        let markdown = valid_skill("citation-management", &description, "Follow the steps.");

        assert_eq!(
            parse_skill_markdown(&markdown).unwrap().description,
            description.trim()
        );

        let too_long = "x".repeat(MAX_DESCRIPTION_CHARS + 1);
        let error = parse_skill_markdown(&valid_skill("too-long", &too_long, "Follow the steps."))
            .unwrap_err();
        assert_eq!(error.code, SkillValidationCode::InvalidDescription);
    }

    #[test]
    fn the_repository_pack_seeds_every_skill_it_declares() {
        let Some(pack_root) = crate::skills_pack::cached_pack_root() else {
            return;
        };
        let Ok(Some(manifest)) = crate::skills_pack::read_pack_manifest(&pack_root) else {
            return;
        };
        let root = tempfile::tempdir().unwrap();

        let records = list_with(root.path(), Some(&pack_root), None).unwrap();

        for entry in &manifest.skills {
            let seeded = record(&records, &entry.id);
            assert!(
                matches!(seeded.validation, SkillValidation::Valid),
                "{} is invalid: {:?}",
                entry.id,
                seeded.validation
            );
            assert_eq!(seeded.source, SkillSource::Bundled, "{}", entry.id);
            assert_eq!(
                seeded.pack_version.as_deref(),
                Some(manifest.version.as_str()),
                "{}",
                entry.id
            );
            assert!(seeded.phase.is_some(), "{} has no phase", entry.id);
            assert!(seeded.license.is_some(), "{} has no license", entry.id);
        }
    }

    #[test]
    fn accepts_a_skill_file_far_larger_than_the_old_limit() {
        let body = "Follow the steps. ".repeat(2_000);
        let markdown = valid_skill("long-skill", "A long research skill.", &body);

        assert!(markdown.len() > 10_000);
        assert!(parse_skill_markdown(&markdown).is_ok());
    }

    #[test]
    fn extra_user_skills_are_listed_sorted() {
        let root = tempfile::tempdir().unwrap();
        write_skill(
            root.path(),
            "aa-custom",
            &valid_skill("aa-custom", "First.", "Follow the steps."),
        );
        write_skill(
            root.path(),
            "zz-custom",
            &valid_skill("zz-custom", "Last.", "Follow the steps."),
        );

        let records = list(root.path()).unwrap();

        assert_eq!(records.first().unwrap().id, "aa-custom");
        assert_eq!(records.last().unwrap().id, "zz-custom");
    }

    #[test]
    fn lists_an_unreadable_skill_as_invalid() {
        let root = tempfile::tempdir().unwrap();
        let directory = skills_root(root.path()).join("unreadable");
        std::fs::create_dir_all(directory.join("SKILL.md")).unwrap();

        let records = list(root.path()).unwrap();

        assert!(matches!(
            record(&records, "unreadable").validation,
            SkillValidation::Invalid {
                code: SkillValidationCode::UnreadableSkillFile,
                ..
            }
        ));
        assert!(!record(&records, "unreadable").enabled);
    }

    #[test]
    fn list_reaps_stale_removal_folders_and_state() {
        let root = tempfile::tempdir().unwrap();
        let tombstone = write_skill(
            root.path(),
            ".skill-remove-0000000000000001-draft",
            &valid_skill("Draft", "Review a draft.", "Review the draft."),
        );
        let mut state = SkillsState::default();
        state.enabled.insert("draft".into());
        write_state(root.path(), &state).unwrap();

        let records = list(root.path()).unwrap();

        assert!(!tombstone.exists());
        assert!(!records.iter().any(|skill| skill.id.starts_with('.')));
        assert!(!read_state(root.path()).unwrap().enabled.contains("draft"));
    }

    #[test]
    fn enable_state_round_trips_and_invalid_skills_cannot_be_enabled() {
        let root = tempfile::tempdir().unwrap();
        write_skill(
            root.path(),
            "proof-review",
            &valid_skill(
                "proof-review",
                "Review a proof for logical gaps.",
                "Read each claim.",
            ),
        );
        write_skill(
            root.path(),
            "broken",
            "---\nname: broken\n---\n\nRead each claim.\n",
        );

        set_enabled(root.path(), None, None, "proof-review", true).unwrap();
        assert!(record(&list(root.path()).unwrap(), "proof-review").enabled);
        assert!(set_enabled(root.path(), None, None, "broken", true).is_err());
        assert!(!record(&list(root.path()).unwrap(), "broken").enabled);

        set_enabled(root.path(), None, None, "proof-review", false).unwrap();
        assert!(!record(&list(root.path()).unwrap(), "proof-review").enabled);
    }

    #[test]
    fn any_number_of_skills_can_be_enabled_at_once() {
        let root = tempfile::tempdir().unwrap();
        for index in 1..=40 {
            let id = format!("skill-{index:02}");
            write_skill(
                root.path(),
                &id,
                &valid_skill(&id, "Exercise the enable state.", "Follow the steps."),
            );
        }

        let discovered = list(root.path()).unwrap();

        assert_eq!(discovered.len(), 40);
        assert_eq!(discovered.iter().filter(|skill| skill.enabled).count(), 40);
        assert_eq!(read_state(root.path()).unwrap().enabled.len(), 40);
        assert!(set_enabled(root.path(), None, None, "skill-40", true).is_ok());
    }

    #[test]
    fn a_version_one_state_file_is_upgraded_in_place() {
        let root = tempfile::tempdir().unwrap();
        write_skill(
            root.path(),
            "draft",
            &valid_skill("Draft", "Review a draft.", "Review the draft."),
        );
        std::fs::create_dir_all(root.path()).unwrap();
        std::fs::write(
            state_path(root.path()),
            r#"{ "version": 1, "enabled": ["draft"], "seen": ["draft"] }"#,
        )
        .unwrap();

        let records = list(root.path()).unwrap();

        assert!(record(&records, "draft").enabled);
        let raw = std::fs::read_to_string(state_path(root.path())).unwrap();
        let stored: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(stored["version"], 2);
        assert!(stored["projectEnabled"].is_object());
        assert_eq!(read_state(root.path()).unwrap().version, 2);
    }

    #[test]
    fn project_enablement_is_tracked_next_to_the_device_setting() {
        let root = tempfile::tempdir().unwrap();
        write_skill(
            root.path(),
            "draft",
            &valid_skill("Draft", "Review a draft.", "Review the draft."),
        );
        set_enabled(root.path(), None, None, "draft", false).unwrap();

        let scoped =
            set_project_enabled(root.path(), None, "swift-violet-fox", "draft", true).unwrap();
        assert!(scoped.project_enabled);
        assert!(!scoped.enabled);

        let for_project = list_with(root.path(), None, Some("swift-violet-fox")).unwrap();
        assert!(record(&for_project, "draft").project_enabled);
        assert!(!record(&for_project, "draft").enabled);

        let for_other = list_with(root.path(), None, Some("other-project")).unwrap();
        assert!(!record(&for_other, "draft").project_enabled);

        set_project_enabled(root.path(), None, "swift-violet-fox", "draft", false).unwrap();
        let cleared = list_with(root.path(), None, Some("swift-violet-fox")).unwrap();
        assert!(!record(&cleared, "draft").project_enabled);
        assert!(read_state(root.path()).unwrap().project_enabled.is_empty());
    }

    #[test]
    fn project_enablement_rejects_an_unsafe_project_id() {
        let root = tempfile::tempdir().unwrap();
        write_skill(
            root.path(),
            "draft",
            &valid_skill("Draft", "Review a draft.", "Review the draft."),
        );

        assert!(set_project_enabled(root.path(), None, "../escape", "draft", true).is_err());
        assert!(set_project_enabled(root.path(), None, "", "draft", true).is_err());
    }

    #[test]
    fn seeding_installs_the_bundled_pack_with_provenance() {
        let root = tempfile::tempdir().unwrap();
        let pack = Pack::new("2026.09.04", &["oleafly-research-loop", "paper-lookup"]);
        pack.write_file("paper-lookup", "references/checklist.md", "Check it.\n");

        seed_from_pack(root.path(), pack.path()).unwrap();
        let records = list_with(root.path(), Some(pack.path()), None).unwrap();

        let seeded = record(&records, "paper-lookup");
        assert_eq!(seeded.source, SkillSource::Bundled);
        assert!(!seeded.removable);
        assert!(seeded.enabled);
        assert!(!seeded.update_available);
        assert_eq!(seeded.pack_version.as_deref(), Some("2026.09.04"));
        assert_eq!(
            seeded.files,
            vec![SkillFile {
                path: "references/checklist.md".into(),
                bytes: 10,
            }]
        );
        assert!(seeded.dir.ends_with("paper-lookup"));

        let directory = skills_root(root.path()).join("paper-lookup");
        assert!(directory.join(MANAGED_MANIFEST_FILE).is_file());
        assert!(has_first_party_marker(&directory));
        let manifest = read_managed_manifest(&directory).unwrap();
        assert_eq!(manifest.pack.as_deref(), Some("research-core"));
        assert_eq!(manifest.tree_sha256, tree_sha256(&directory).unwrap());
    }

    #[test]
    fn an_unmodified_bundled_skill_is_replaced_by_a_newer_pack() {
        let root = tempfile::tempdir().unwrap();
        let pack = Pack::new("2026.09.04", &["paper-lookup"]);
        seed_from_pack(root.path(), pack.path()).unwrap();

        pack.write_skill(
            "paper-lookup",
            &valid_skill("paper-lookup", "A bundled research skill.", "Do it better."),
        );
        pack.write_manifest("2026.10.01", &["paper-lookup"]);
        seed_from_pack(root.path(), pack.path()).unwrap();

        let records = list_with(root.path(), Some(pack.path()), None).unwrap();
        let updated = record(&records, "paper-lookup");
        assert_eq!(updated.instructions, "Do it better.");
        assert!(!updated.update_available);
        assert_eq!(updated.pack_version.as_deref(), Some("2026.10.01"));
    }

    #[test]
    fn a_modified_bundled_skill_is_flagged_instead_of_replaced() {
        let root = tempfile::tempdir().unwrap();
        let pack = Pack::new("2026.09.04", &["paper-lookup"]);
        seed_from_pack(root.path(), pack.path()).unwrap();
        let directory = skills_root(root.path()).join("paper-lookup");
        std::fs::write(
            directory.join("SKILL.md"),
            valid_skill("paper-lookup", "A bundled research skill.", "My own steps."),
        )
        .unwrap();

        pack.write_skill(
            "paper-lookup",
            &valid_skill("paper-lookup", "A bundled research skill.", "Do it better."),
        );
        pack.write_manifest("2026.10.01", &["paper-lookup"]);
        seed_from_pack(root.path(), pack.path()).unwrap();

        let records = list_with(root.path(), Some(pack.path()), None).unwrap();
        let kept = record(&records, "paper-lookup");
        assert_eq!(kept.instructions, "My own steps.");
        assert!(kept.update_available);
        assert_eq!(kept.pack_version.as_deref(), Some("2026.09.04"));
    }

    #[test]
    fn a_forced_update_replaces_a_modified_bundled_skill() {
        let root = tempfile::tempdir().unwrap();
        let pack = Pack::new("2026.09.04", &["paper-lookup"]);
        seed_from_pack(root.path(), pack.path()).unwrap();
        let directory = skills_root(root.path()).join("paper-lookup");
        std::fs::write(
            directory.join("SKILL.md"),
            valid_skill("paper-lookup", "A bundled research skill.", "My own steps."),
        )
        .unwrap();
        pack.write_skill(
            "paper-lookup",
            &valid_skill("paper-lookup", "A bundled research skill.", "Do it better."),
        );
        pack.write_manifest("2026.10.01", &["paper-lookup"]);

        let updated = update_builtin(root.path(), pack.path(), "paper-lookup").unwrap();

        assert_eq!(updated.instructions, "Do it better.");
        assert_eq!(updated.pack_version.as_deref(), Some("2026.10.01"));
        assert!(update_builtin(root.path(), pack.path(), "missing-skill").is_err());
    }

    fn seed_legacy(root: &Path, id: &str) -> PathBuf {
        let (_, manifest, skill_md) = legacy_default_skills()
            .iter()
            .find(|(default_id, _, _)| *default_id == id)
            .copied()
            .unwrap();
        let directory = skills_root(root).join(id);
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("manifest.json"), manifest).unwrap();
        std::fs::write(directory.join("SKILL.md"), skill_md).unwrap();
        std::fs::write(directory.join(FIRST_PARTY_MARKER_FILE), FIRST_PARTY_MARKER).unwrap();
        directory
    }

    #[test]
    fn unmodified_legacy_skills_are_removed_when_the_pack_seeds() {
        let root = tempfile::tempdir().unwrap();
        for (id, _, _) in legacy_default_skills() {
            seed_legacy(root.path(), id);
        }
        let pack = Pack::new("2026.09.04", &["openresearch"]);

        seed_from_pack(root.path(), pack.path()).unwrap();
        let records = list_with(root.path(), Some(pack.path()), None).unwrap();

        for (id, _, _) in legacy_default_skills() {
            if *id == "openresearch" {
                continue;
            }
            assert!(
                !skills_root(root.path()).join(id).exists(),
                "{id} should be gone"
            );
        }
        let reseeded = record(&records, "openresearch");
        assert_eq!(reseeded.source, SkillSource::Bundled);
        assert_eq!(reseeded.description, "A bundled research skill.");
    }

    #[test]
    fn a_modified_legacy_skill_becomes_a_removable_user_skill() {
        let root = tempfile::tempdir().unwrap();
        let directory = seed_legacy(root.path(), "research-review");
        std::fs::write(
            directory.join("SKILL.md"),
            valid_skill("research-review", "My own review.", "Follow my checklist."),
        )
        .unwrap();
        let pack = Pack::new("2026.09.04", &["paper-lookup"]);

        seed_from_pack(root.path(), pack.path()).unwrap();
        let records = list_with(root.path(), Some(pack.path()), None).unwrap();

        let demoted = record(&records, "research-review");
        assert_eq!(demoted.source, SkillSource::User);
        assert!(demoted.removable);
        assert!(!directory.join(FIRST_PARTY_MARKER_FILE).exists());
        remove(root.path(), "research-review").unwrap();
    }

    #[test]
    fn reading_a_skill_file_stays_inside_the_skill_folder() {
        let root = tempfile::tempdir().unwrap();
        let directory = write_skill(
            root.path(),
            "paper-lookup",
            &valid_skill("paper-lookup", "Find papers.", "Read the checklist."),
        );
        std::fs::create_dir_all(directory.join("references")).unwrap();
        std::fs::write(directory.join("references/checklist.md"), "Check it.\n").unwrap();
        std::fs::write(root.path().join("secret.txt"), "keep").unwrap();

        let read = read_skill_file(root.path(), "paper-lookup", "references/checklist.md").unwrap();
        assert_eq!(read.content, "Check it.\n");
        assert_eq!(read.path, "references/checklist.md");
        assert!(!read.truncated);

        for path in [
            "../secret.txt",
            "references/../../secret.txt",
            "/etc/hosts",
            "references",
            "",
            "missing.md",
        ] {
            assert!(
                read_skill_file(root.path(), "paper-lookup", path).is_err(),
                "read accepted {path}"
            );
        }
        assert!(read_skill_file(root.path(), "../outside", "SKILL.md").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn reading_a_linked_skill_file_is_refused() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().unwrap();
        let directory = write_skill(
            root.path(),
            "paper-lookup",
            &valid_skill("paper-lookup", "Find papers.", "Read the checklist."),
        );
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("private.txt"), "keep").unwrap();
        symlink(
            outside.path().join("private.txt"),
            directory.join("linked.txt"),
        )
        .unwrap();

        let error = read_skill_file(root.path(), "paper-lookup", "linked.txt").unwrap_err();

        assert!(error.contains("link"), "{error}");
    }

    #[test]
    fn reading_a_binary_skill_file_is_refused() {
        let root = tempfile::tempdir().unwrap();
        let directory = write_skill(
            root.path(),
            "paper-lookup",
            &valid_skill("paper-lookup", "Find papers.", "Read the checklist."),
        );
        std::fs::write(directory.join("logo.png"), [0x89, 0x50, 0x4e, 0x00, 0x0d]).unwrap();

        let error = read_skill_file(root.path(), "paper-lookup", "logo.png").unwrap_err();

        assert!(error.contains("not a text file"), "{error}");
    }

    #[test]
    fn the_file_listing_hides_internal_skill_files() {
        let root = tempfile::tempdir().unwrap();
        let pack = Pack::new("2026.09.04", &["paper-lookup"]);
        pack.write_file("paper-lookup", "scripts/run.py", "print('hi')\n");
        pack.write_file("paper-lookup", "references/a.md", "a\n");
        seed_from_pack(root.path(), pack.path()).unwrap();

        let records = list_with(root.path(), Some(pack.path()), None).unwrap();
        let paths: Vec<_> = record(&records, "paper-lookup")
            .files
            .iter()
            .map(|file| file.path.as_str())
            .collect();

        assert_eq!(paths, vec!["references/a.md", "scripts/run.py"]);
    }

    #[test]
    fn a_created_draft_stays_disabled_after_the_next_listing() {
        let root = tempfile::tempdir().unwrap();
        let created = create(
            root.path(),
            None,
            CreateSkillInput {
                name: "Methods Coach".into(),
                description: "Check a methods section for reproducibility.".into(),
                instructions: None,
            },
        )
        .unwrap();

        assert_eq!(created.id, "methods-coach");
        assert!(!created.enabled);
        assert!(read_state(root.path())
            .unwrap()
            .seen
            .contains("methods-coach"));
        assert!(!record(&list(root.path()).unwrap(), "methods-coach").enabled);
    }

    #[test]
    fn add_copies_a_valid_skill_folder_and_nested_resources() {
        let root = tempfile::tempdir().unwrap();
        let source_parent = tempfile::tempdir().unwrap();
        let source = source_parent.path().join("review-pack");
        std::fs::create_dir_all(source.join("references")).unwrap();
        std::fs::write(
            source.join("SKILL.md"),
            valid_skill(
                "Imported Review",
                "Review a manuscript with a saved checklist.",
                "Open references/checklist.md and follow each item.",
            ),
        )
        .unwrap();
        std::fs::write(
            source.join("references/checklist.md"),
            "Check the claims.\n",
        )
        .unwrap();

        let added = add(root.path(), None, &source).unwrap();

        assert_eq!(added.id, "imported-review");
        assert!(matches!(added.validation, SkillValidation::Valid));
        assert!(!added.enabled);
        assert_eq!(added.source, SkillSource::User);
        assert_eq!(added.tier, SkillTier::User);
        assert_eq!(
            std::fs::read_to_string(
                skills_root(root.path()).join("imported-review/references/checklist.md")
            )
            .unwrap(),
            "Check the claims.\n"
        );
        assert!(source.join("SKILL.md").exists());
    }

    #[test]
    fn add_rejects_sources_that_contain_the_managed_skills_directory() {
        let root = tempfile::tempdir().unwrap();

        let error = add(root.path(), None, root.path()).unwrap_err();

        assert_eq!(
            error,
            "Choose a skill folder outside the Oleafly data directory."
        );
    }

    #[test]
    fn add_rejects_a_skill_folder_over_the_entry_budget() {
        let root = tempfile::tempdir().unwrap();
        let source_parent = tempfile::tempdir().unwrap();
        let source = source_parent.path().join("wide-pack");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(
            source.join("SKILL.md"),
            valid_skill(
                "Wide Pack",
                "Exercise the skill folder entry limit.",
                "Read the bundled resources.",
            ),
        )
        .unwrap();
        let mut budget = CopyBudget {
            entries: MAX_PACK_ENTRIES,
            bytes: 0,
        };
        let resolved = source.canonicalize().unwrap();
        let staging = source_parent.path().join("staging");

        let error = copy_tree(&resolved, &resolved, &staging, 0, &mut budget).unwrap_err();

        assert!(error.contains("exceeds the limit"));
        assert!(!skills_root(root.path()).join("wide-pack").exists());
    }

    #[test]
    fn add_rejects_a_skill_folder_over_the_depth_budget() {
        let root = tempfile::tempdir().unwrap();
        let source_parent = tempfile::tempdir().unwrap();
        let source = source_parent.path().join("deep-pack");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(
            source.join("SKILL.md"),
            valid_skill(
                "Deep Pack",
                "Exercise the skill folder depth limit.",
                "Read the bundled resources.",
            ),
        )
        .unwrap();
        let mut current = source.clone();
        for index in 0..=MAX_PACK_DEPTH {
            current = current.join(format!("level-{index}"));
            std::fs::create_dir(&current).unwrap();
        }

        let error = add(root.path(), None, &source).unwrap_err();

        assert!(error.contains("maximum depth"));
        assert!(!skills_root(root.path()).join("deep-pack").exists());
    }

    #[cfg(unix)]
    #[test]
    fn add_rejects_linked_entries_in_a_skill_folder() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().unwrap();
        let source_parent = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let source = source_parent.path().join("linked-pack");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(
            source.join("SKILL.md"),
            valid_skill(
                "Linked Pack",
                "Exercise linked resource rejection.",
                "Read the bundled resources.",
            ),
        )
        .unwrap();
        std::fs::write(outside.path().join("private.txt"), "keep").unwrap();
        symlink(
            outside.path().join("private.txt"),
            source.join("resource.txt"),
        )
        .unwrap();

        let error = add(root.path(), None, &source).unwrap_err();

        assert!(error.contains("linked entry"));
        assert!(!skills_root(root.path()).join("linked-pack").exists());
    }

    #[test]
    fn oversized_enable_state_is_rejected() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(
            state_path(root.path()),
            vec![b' '; (MAX_STATE_BYTES + 1) as usize],
        )
        .unwrap();

        let error = list(root.path()).unwrap_err();

        assert_eq!(
            error,
            "Skill settings are not stored in a readable regular file."
        );
    }

    #[test]
    fn create_writes_a_valid_disabled_scaffold_and_remove_deletes_it() {
        let root = tempfile::tempdir().unwrap();
        let created = create(
            root.path(),
            None,
            CreateSkillInput {
                name: "Methods Coach".into(),
                description: "Check a methods section for reproducibility.".into(),
                instructions: None,
            },
        )
        .unwrap();

        assert_eq!(created.id, "methods-coach");
        assert!(matches!(created.validation, SkillValidation::Valid));
        assert!(!created.enabled);
        assert!(skills_root(root.path())
            .join("methods-coach/SKILL.md")
            .is_file());

        remove(root.path(), "methods-coach").unwrap();
        assert!(!skills_root(root.path()).join("methods-coach").exists());
    }

    #[test]
    fn removing_an_enabled_skill_clears_its_saved_state() {
        let root = tempfile::tempdir().unwrap();
        create(
            root.path(),
            None,
            CreateSkillInput {
                name: "Methods Coach".into(),
                description: "Check a methods section for reproducibility.".into(),
                instructions: None,
            },
        )
        .unwrap();
        set_enabled(root.path(), None, None, "methods-coach", true).unwrap();
        set_project_enabled(root.path(), None, "swift-violet-fox", "methods-coach", true).unwrap();

        remove(root.path(), "methods-coach").unwrap();

        let state = read_state(root.path()).unwrap();
        assert!(!state.enabled.contains("methods-coach"));
        assert!(state.project_enabled.is_empty());
    }

    #[test]
    fn update_revalidates_an_invalid_skill_in_place() {
        let root = tempfile::tempdir().unwrap();
        write_skill(
            root.path(),
            "draft",
            "---\nname: draft\n---\n\nAdd the missing description.\n",
        );

        let updated = update(
            root.path(),
            "draft",
            UpdateSkillInput {
                name: "Draft Reviewer".into(),
                description: "Review a draft one section at a time.".into(),
                instructions: "Read one section, report issues, then continue.".into(),
            },
        )
        .unwrap();

        assert_eq!(updated.id, "draft");
        assert!(matches!(updated.validation, SkillValidation::Valid));
        assert_eq!(updated.name, "Draft Reviewer");
    }

    #[test]
    fn update_preserves_optional_frontmatter_fields() {
        let root = tempfile::tempdir().unwrap();
        let directory = write_skill(
            root.path(),
            "draft",
            "---\nname: Draft\ndescription: Review a draft.\nlicense: MIT\nmetadata:\n  owner: user\n  oleafly:\n    tier: vendored\n---\n\nReview the draft.\n",
        );

        let updated = update(
            root.path(),
            "draft",
            UpdateSkillInput {
                name: "Draft Reviewer".into(),
                description: "Review a draft one section at a time.".into(),
                instructions: "Read one section, report issues, then continue.".into(),
            },
        )
        .unwrap();

        assert_eq!(updated.license.as_deref(), Some("MIT"));
        assert_eq!(updated.tier, SkillTier::Vendored);
        let markdown = std::fs::read_to_string(directory.join("SKILL.md")).unwrap();
        let (frontmatter, _) = split_frontmatter(&markdown).unwrap();
        let value: serde_yaml::Value = serde_yaml::from_str(&frontmatter).unwrap();
        let mapping = value.as_mapping().unwrap();
        assert_eq!(
            yaml_field(mapping, "license").and_then(serde_yaml::Value::as_str),
            Some("MIT")
        );
        assert_eq!(
            yaml_field(mapping, "metadata")
                .and_then(serde_yaml::Value::as_mapping)
                .and_then(|metadata| yaml_field(metadata, "owner"))
                .and_then(serde_yaml::Value::as_str),
            Some("user")
        );
    }

    #[test]
    fn update_does_not_mutate_when_enable_state_is_corrupt() {
        let root = tempfile::tempdir().unwrap();
        let directory = write_skill(
            root.path(),
            "draft",
            &valid_skill("Draft", "Review a draft.", "Review the draft."),
        );
        let before = std::fs::read_to_string(directory.join("SKILL.md")).unwrap();
        std::fs::write(state_path(root.path()), "not json").unwrap();

        let error = update(
            root.path(),
            "draft",
            UpdateSkillInput {
                name: "Changed".into(),
                description: "This change must not land.".into(),
                instructions: "Do not write these instructions.".into(),
            },
        )
        .unwrap_err();

        assert!(error.contains("Skill settings are invalid"));
        assert_eq!(
            std::fs::read_to_string(directory.join("SKILL.md")).unwrap(),
            before
        );
    }

    #[test]
    fn remove_does_not_mutate_when_enable_state_is_corrupt() {
        let root = tempfile::tempdir().unwrap();
        let directory = write_skill(
            root.path(),
            "draft",
            &valid_skill("Draft", "Review a draft.", "Review the draft."),
        );
        std::fs::write(state_path(root.path()), "not json").unwrap();

        let error = remove(root.path(), "draft").unwrap_err();

        assert!(error.contains("Skill settings are invalid"));
        assert!(directory.join("SKILL.md").is_file());
    }

    #[test]
    fn remove_restores_the_folder_when_the_state_write_fails() {
        let root = tempfile::tempdir().unwrap();
        let directory = write_skill(
            root.path(),
            "draft",
            &valid_skill("Draft", "Review a draft.", "Review the draft."),
        );
        set_enabled(root.path(), None, None, "draft", true).unwrap();

        let error = remove_unlocked_with_writer(root.path(), "draft", |_, _| {
            Err("Injected state write failure.".into())
        })
        .unwrap_err();

        assert_eq!(error, "Injected state write failure.");
        assert!(directory.join("SKILL.md").is_file());
        assert!(read_state(root.path()).unwrap().enabled.contains("draft"));
        assert!(!std::fs::read_dir(skills_root(root.path()))
            .unwrap()
            .flatten()
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with(".skill-remove-")));
    }

    #[test]
    fn rejects_internal_paths_that_can_escape_the_skills_directory() {
        let root = tempfile::tempdir().unwrap();
        let outside = root.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("sentinel"), "keep").unwrap();

        for id in ["../outside", "/tmp/outside", "a/b", "a\\b", "C:\\outside"] {
            assert!(validate(root.path(), id).is_err(), "validate accepted {id}");
            assert!(
                update(
                    root.path(),
                    id,
                    UpdateSkillInput {
                        name: "Outside".into(),
                        description: "Must stay outside.".into(),
                        instructions: "Do not write this file.".into(),
                    },
                )
                .is_err(),
                "update accepted {id}"
            );
            assert!(
                set_enabled(root.path(), None, None, id, true).is_err(),
                "enable accepted {id}"
            );
            assert!(
                set_project_enabled(root.path(), None, "swift-violet-fox", id, true).is_err(),
                "project enable accepted {id}"
            );
            assert!(remove(root.path(), id).is_err(), "remove accepted {id}");
        }

        assert_eq!(
            std::fs::read_to_string(outside.join("sentinel")).unwrap(),
            "keep"
        );
    }

    #[test]
    fn bundled_skills_cannot_be_removed() {
        let root = tempfile::tempdir().unwrap();
        let pack = Pack::new("2026.09.04", &["paper-lookup"]);
        seed_from_pack(root.path(), pack.path()).unwrap();

        assert!(remove(root.path(), "paper-lookup").is_err());
        assert!(skills_root(root.path())
            .join("paper-lookup/SKILL.md")
            .is_file());
    }

    #[test]
    fn a_hand_made_folder_cannot_claim_bundled_provenance() {
        let root = tempfile::tempdir().unwrap();
        let directory = write_skill(
            root.path(),
            "paper-lookup",
            &valid_skill("paper-lookup", "My own lookup.", "Follow my steps."),
        );
        write_managed_manifest(
            &directory,
            &ManagedManifest {
                schema_version: 1,
                id: "paper-lookup".into(),
                source: SkillSource::Bundled,
                pack: Some("research-core".into()),
                pack_version: Some("2026.09.04".into()),
                tree_sha256: String::new(),
                license: None,
                tier: None,
                phase: None,
                origin: None,
            },
        )
        .unwrap();

        let records = list(root.path()).unwrap();

        assert_eq!(record(&records, "paper-lookup").source, SkillSource::User);
        assert!(record(&records, "paper-lookup").removable);
    }

    #[cfg(unix)]
    #[test]
    fn linked_skill_directories_cannot_escape_the_skills_root() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("sentinel"), "keep").unwrap();
        std::fs::create_dir_all(skills_root(root.path())).unwrap();
        symlink(outside.path(), skills_root(root.path()).join("linked")).unwrap();

        assert!(validate(root.path(), "linked").is_err());
        assert!(set_enabled(root.path(), None, None, "linked", true).is_err());
        assert!(remove(root.path(), "linked").is_err());
        assert_eq!(
            std::fs::read_to_string(outside.path().join("sentinel")).unwrap(),
            "keep"
        );
    }

    #[test]
    fn the_tree_hash_covers_paths_and_contents_in_sorted_order() {
        let root = tempfile::tempdir().unwrap();
        let directory = write_skill(
            root.path(),
            "paper-lookup",
            &valid_skill("paper-lookup", "Find papers.", "Follow the steps."),
        );
        let before = tree_sha256(&directory).unwrap();

        std::fs::write(directory.join(FIRST_PARTY_MARKER_FILE), FIRST_PARTY_MARKER).unwrap();
        assert_eq!(tree_sha256(&directory).unwrap(), before);

        std::fs::write(directory.join("notes.md"), "note\n").unwrap();
        assert_ne!(tree_sha256(&directory).unwrap(), before);
    }

    #[test]
    fn an_added_folder_cannot_smuggle_built_in_provenance() {
        let root = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        std::fs::write(
            source.path().join("SKILL.md"),
            valid_skill("paper helper", "Help with papers.", "Follow my steps."),
        )
        .unwrap();
        std::fs::write(
            source.path().join(FIRST_PARTY_MARKER_FILE),
            FIRST_PARTY_MARKER,
        )
        .unwrap();
        std::fs::write(
            source.path().join(MANAGED_MANIFEST_FILE),
            r#"{ "schemaVersion": 1, "id": "paper-helper", "source": "bundled",
                 "treeSha256": "", "tier": "native" }"#,
        )
        .unwrap();

        let added = add(root.path(), None, source.path()).unwrap();

        assert_eq!(added.id, "paper-helper");
        assert_eq!(added.source, SkillSource::User);
        assert_eq!(added.tier, SkillTier::User);
        assert!(added.removable);
        let directory = skills_root(root.path()).join(&added.id);
        assert!(!directory.join(MANAGED_MANIFEST_FILE).exists());
        assert!(!has_first_party_marker(&directory));
        assert!(remove(root.path(), &added.id).is_ok());
    }

    #[test]
    fn a_leftover_upgrade_folder_is_reaped_without_disabling_the_skill() {
        assert_ne!(STALE_STAGING_PREFIX, REMOVAL_STAGING_PREFIX);
        assert!(staged_removal_skill_id(".skill-stale-0000000000000001-peer-review").is_none());

        let root = tempfile::tempdir().unwrap();
        write_skill(
            root.path(),
            "peer-review",
            &valid_skill("peer-review", "Review a paper.", "Read every claim."),
        );
        let leftover = write_skill(
            root.path(),
            ".skill-stale-0000000000000001-peer-review",
            &valid_skill("peer-review", "Review a paper.", "Read every claim."),
        );
        let mut state = SkillsState::default();
        state.enabled.insert("peer-review".into());
        state.seen.insert("peer-review".into());
        write_state(root.path(), &state).unwrap();

        let records = list(root.path()).unwrap();

        assert!(!leftover.exists());
        assert!(!records.iter().any(|skill| skill.id.starts_with('.')));
        assert!(record(&records, "peer-review").enabled);
        assert!(read_state(root.path())
            .unwrap()
            .enabled
            .contains("peer-review"));
    }

    #[test]
    fn an_invalid_built_in_skill_can_still_be_restored_from_the_pack() {
        let root = tempfile::tempdir().unwrap();
        let pack = Pack::new("2026.09.04", &["oleafly-research-loop"]);
        seed_from_pack(root.path(), pack.path()).unwrap();
        std::fs::write(
            skills_root(root.path())
                .join("oleafly-research-loop")
                .join("SKILL.md"),
            "---\nname: oleafly-research-loop\n---\n\nFollow the steps.\n",
        )
        .unwrap();

        let records = list_with(root.path(), Some(pack.path()), None).unwrap();
        let broken = record(&records, "oleafly-research-loop");

        assert!(matches!(
            broken.validation,
            SkillValidation::Invalid {
                code: SkillValidationCode::MissingDescription,
                ..
            }
        ));
        assert!(broken.update_available);
        assert!(!broken.removable);

        let repaired = update_builtin(root.path(), pack.path(), "oleafly-research-loop").unwrap();

        assert_eq!(repaired.validation, SkillValidation::Valid);
    }

    #[test]
    fn an_unsafe_skill_path_is_never_offered_a_pack_update() {
        let root = tempfile::tempdir().unwrap();
        let unsafe_record = invalid_record(
            "..",
            None,
            SkillSource::User,
            false,
            None,
            validation_error(SkillValidationCode::UnsafePath, "unsafe path"),
        );

        assert!(!unsafe_record.update_available);
        let _ = root;
    }

    #[test]
    fn toggling_a_skill_returns_the_record_the_listing_would() {
        let root = tempfile::tempdir().unwrap();
        let pack = Pack::new("2026.09.04", &["paper-lookup"]);
        seed_from_pack(root.path(), pack.path()).unwrap();
        std::fs::write(
            skills_root(root.path())
                .join("paper-lookup")
                .join("SKILL.md"),
            valid_skill("paper-lookup", "A bundled research skill.", "My own steps."),
        )
        .unwrap();
        pack.write_manifest("2026.10.01", &["paper-lookup"]);

        set_project_enabled(
            root.path(),
            Some(pack.path()),
            "swift-violet-fox",
            "paper-lookup",
            true,
        )
        .unwrap();
        let device_off = set_enabled(
            root.path(),
            Some(pack.path()),
            Some("swift-violet-fox"),
            "paper-lookup",
            false,
        )
        .unwrap();

        assert!(!device_off.enabled);
        assert!(device_off.project_enabled);
        assert!(device_off.update_available);

        let scoped_off = set_project_enabled(
            root.path(),
            Some(pack.path()),
            "swift-violet-fox",
            "paper-lookup",
            false,
        )
        .unwrap();

        assert!(!scoped_off.project_enabled);
        assert!(scoped_off.update_available);
    }
}
