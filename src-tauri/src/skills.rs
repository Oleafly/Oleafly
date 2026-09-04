use std::collections::BTreeSet;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

const MAX_SKILL_FILE_BYTES: u64 = 10_000;
const MAX_PACK_BYTES: u64 = 16 * 1024 * 1024;
const MAX_PACK_ENTRIES: usize = 256;
const MAX_PACK_DEPTH: usize = 16;
const MAX_STATE_BYTES: u64 = 64 * 1024;
const MAX_ENABLED_SKILLS: usize = 32;
const FIRST_PARTY_MARKER_FILE: &str = ".oleafly-first-party";
const FIRST_PARTY_MARKER: &str = "oleafly-first-party-v1\n";
const DEFAULT_INSTRUCTIONS: &str =
    "Describe when this skill should be used and list the steps the assistant should follow.";

static SKILLS_WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SkillSource {
    FirstParty,
    User,
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub instructions: String,
    pub source: SkillSource,
    pub enabled: bool,
    pub removable: bool,
    pub validation: SkillValidation,
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

#[derive(Clone, Debug, PartialEq, Eq)]
struct SkillDocument {
    name: String,
    description: String,
    instructions: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SkillValidationError {
    code: SkillValidationCode,
    message: String,
}

#[derive(Deserialize, Serialize)]
struct SkillsState {
    version: u8,
    #[serde(default)]
    enabled: BTreeSet<String>,
    #[serde(default)]
    seen: BTreeSet<String>,
}

impl Default for SkillsState {
    fn default() -> Self {
        Self {
            version: 1,
            enabled: BTreeSet::new(),
            seen: BTreeSet::new(),
        }
    }
}

#[derive(Default)]
struct CopyBudget {
    entries: usize,
    bytes: u64,
}

#[cfg(test)]
fn skills_root(root: &Path) -> PathBuf {
    root.join("skills")
}

const DEFAULT_SKILLS: [(&str, &str, &str); 10] = [
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
        "---\nname: research-publish\ndescription: Prepare the manuscript for submission to a venue.\n---\n\nRun a submission pass: confirm the venue's format and page limits, check the abstract and title, verify anonymization where required, resolve every remaining compile warning, and produce a final clean PDF. List anything that still needs a human decision before upload.\n",
    ),
    (
        "conduct-research",
        r#"{ "name": "conduct-research", "version": "1.0.0", "description": "Run a literature investigation for the current project." }"#,
        "---\nname: conduct-research\ndescription: Run a literature investigation for the current project.\n---\n\nInvestigate the research question I give you. Search the literature tools for relevant work, read what the connectors return, and build an annotated map: the key papers, how they relate, and where the open gap is. Save the findings as notes in the project so authoring can build on them.\n",
    ),
    (
        "openresearch",
        r#"{ "name": "openresearch", "version": "1.0.0", "description": "Ground research in literature and run or inspect experiments with the local orx CLI." }"#,
        r#"---
name: OpenResearch (orx)
description: Ground research in literature and run or inspect experiments with the local orx CLI.
---

Use `orx` when a task needs literature evidence, paper metadata, or access to experiments in a local OpenResearch project.

Before using it, check whether `orx` is available on PATH. Run every command through the normal `run_command` tool. Commands follow the current approval mode.

Commands:

- `orx discover keyword <query>` searches the literature by keyword.
- `orx paper <arxiv-id-or-doi>` shows metadata for an arXiv paper or DOI.
- `orx projects` lists local OpenResearch projects.
- `orx project view <id>` shows one project.
- `orx runs <project-id>` lists experiment runs for a project.
- `orx logs <run-id>` shows the logs for a run.
- `orx exp run <experiment-id>` executes an experiment.

Run `orx --help` for the full interface.

If `orx` is not installed, do not install it automatically. Tell the user to run:

```sh
curl -LsSf https://openresearch.sh/install.sh | sh
```
"#,
    ),
    (
        "import-refine",
        r#"{ "name": "import-refine", "version": "1.0.0", "description": "Clean up an imported document so it compiles and reads well." }"#,
        "---\nname: import-refine\ndescription: Clean up an imported document so it compiles and reads well.\n---\n\nReview the imported sources in this project. Fix compile errors first, then normalize the preamble, tidy section structure, and flag any content that did not survive the import. Compile after each change and stop when the document builds cleanly.\n",
    ),
    (
        "pdf-to-latex",
        r#"{ "name": "pdf-to-latex", "version": "1.0.0", "description": "Reconstruct an attached PDF as an editable LaTeX project." }"#,
        "---\nname: pdf-to-latex\ndescription: Reconstruct an attached PDF as an editable LaTeX project.\n---\n\nRead the attached PDF page by page and rebuild it as LaTeX in this project. Match the section structure, environments, math, and citations. After each section, compile and use the PDF text tools to compare the output against the original.\n",
    ),
    (
        "template-generate",
        r#"{ "name": "template-generate", "version": "1.0.0", "description": "Turn the current document into a reusable template." }"#,
        "---\nname: template-generate\ndescription: Turn the current document into a reusable template.\n---\n\nGeneralize the current document into a reusable template: replace concrete content with placeholder commands, keep the preamble and styling, and document each placeholder at the top of the file. Compile to confirm the skeleton still builds.\n",
    ),
    (
        "ai-figure",
        r#"{ "name": "ai-figure", "version": "1.0.0", "description": "Draw a publication-quality TikZ figure from a description." }"#,
        "---\nname: ai-figure\ndescription: Draw a publication-quality TikZ figure from a description.\n---\n\nDraw the figure I describe as TikZ. Preview it with the figure tools, iterate until the layout is clean and labels do not overlap, then insert it at my cursor with a caption and label.\n",
    ),
];

fn validation_error(code: SkillValidationCode, message: impl Into<String>) -> SkillValidationError {
    SkillValidationError {
        code,
        message: message.into(),
    }
}

#[cfg(windows)]
fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &std::fs::Metadata) -> bool {
    false
}

fn open_nofollow(path: &Path) -> std::io::Result<std::fs::File> {
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

fn managed_skills_root(root: &Path) -> Result<PathBuf, String> {
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

fn validate_skill_id(id: &str) -> Result<(), String> {
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

fn required_frontmatter_field(
    mapping: &serde_yaml::Mapping,
    field: &str,
    missing_code: SkillValidationCode,
    invalid_code: SkillValidationCode,
    max_chars: usize,
) -> Result<String, SkillValidationError> {
    let key = serde_yaml::Value::String(field.to_string());
    let Some(value) = mapping.get(&key) else {
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
        100,
    )?;
    let description = required_frontmatter_field(
        &mapping,
        "description",
        SkillValidationCode::MissingDescription,
        SkillValidationCode::InvalidDescription,
        500,
    )?;
    let instructions = instructions.trim().to_string();
    if instructions.is_empty() {
        return Err(validation_error(
            SkillValidationCode::MissingInstructions,
            "SKILL.md must include instructions after its front matter.",
        ));
    }
    Ok(SkillDocument {
        name,
        description,
        instructions,
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
            .and_then(|mapping| mapping.get(serde_yaml::Value::String(field.to_string())))
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

fn regular_file_matches(path: &Path, expected: &[u8]) -> bool {
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

fn source_for(directory: &Path, id: &str) -> SkillSource {
    if DEFAULT_SKILLS
        .iter()
        .any(|(default_id, _, _)| *default_id == id)
        && regular_file_matches(
            &directory.join(FIRST_PARTY_MARKER_FILE),
            FIRST_PARTY_MARKER.as_bytes(),
        )
    {
        SkillSource::FirstParty
    } else {
        SkillSource::User
    }
}

fn invalid_record(
    id: &str,
    source: SkillSource,
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
        source,
        enabled: false,
        removable: source == SkillSource::User,
        validation: SkillValidation::Invalid {
            code: error.code,
            message: error.message,
        },
    }
}

fn inspect_real_skill(directory: &Path, id: &str, state: &SkillsState) -> SkillRecord {
    let source = source_for(directory, id);
    let markdown = match read_skill_markdown(directory) {
        Ok(markdown) => markdown,
        Err(error) => return invalid_record(id, source, None, error),
    };
    match parse_skill_markdown(&markdown) {
        Ok(document) => SkillRecord {
            id: id.to_string(),
            name: document.name,
            description: document.description,
            instructions: document.instructions,
            source,
            enabled: state.enabled.contains(id),
            removable: source == SkillSource::User,
            validation: SkillValidation::Valid,
        },
        Err(error) => invalid_record(id, source, Some(&markdown), error),
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
    if state.version != 1 {
        return Err(format!(
            "Skill settings use unsupported version {}.",
            state.version
        ));
    }
    Ok(state)
}

fn write_state(root: &Path, state: &SkillsState) -> Result<(), String> {
    let raw = serde_json::to_vec_pretty(state)
        .map_err(|error| format!("Could not encode skill settings: {error}"))?;
    crate::sandbox::atomic_write(&state_path(root), &raw)
        .map_err(|error| format!("Could not save skill settings: {error}"))
}

fn seed_defaults_in(skills: &Path) -> Result<(), String> {
    for (id, manifest, skill_md) in DEFAULT_SKILLS {
        let directory = skills.join(id);
        match std::fs::symlink_metadata(&directory) {
            Ok(metadata) => {
                if metadata.is_dir()
                    && !metadata.file_type().is_symlink()
                    && !is_reparse_point(&metadata)
                {
                    let marker = directory.join(FIRST_PARTY_MARKER_FILE);
                    match std::fs::symlink_metadata(&marker) {
                        Ok(_) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                            if regular_file_matches(
                                &directory.join("manifest.json"),
                                manifest.as_bytes(),
                            ) {
                                crate::sandbox::atomic_write(
                                    &marker,
                                    FIRST_PARTY_MARKER.as_bytes(),
                                )
                                .map_err(|error| {
                                    format!("Could not write built-in skill provenance: {error}")
                                })?;
                            }
                        }
                        Err(error) => {
                            return Err(format!(
                                "Could not inspect built-in skill provenance: {error}"
                            ));
                        }
                    }
                }
                continue;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "Could not inspect built-in skill \"{id}\": {error}"
                ));
            }
        }
        std::fs::create_dir(&directory)
            .map_err(|error| format!("Could not create built-in skill \"{id}\": {error}"))?;
        crate::sandbox::atomic_write(&directory.join("manifest.json"), manifest.as_bytes())
            .map_err(|error| format!("Could not write built-in skill manifest: {error}"))?;
        crate::sandbox::atomic_write(&directory.join("SKILL.md"), skill_md.as_bytes())
            .map_err(|error| format!("Could not write built-in SKILL.md: {error}"))?;
        crate::sandbox::atomic_write(
            &directory.join(FIRST_PARTY_MARKER_FILE),
            FIRST_PARTY_MARKER.as_bytes(),
        )
        .map_err(|error| format!("Could not write built-in skill provenance: {error}"))?;
    }
    Ok(())
}

fn staged_removal_skill_id(id: &str) -> Option<&str> {
    let suffix = id.strip_prefix(".skill-remove-")?;
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

fn list_unlocked(root: &Path) -> Result<Vec<SkillRecord>, String> {
    let skills = managed_skills_root(root)?;
    seed_defaults_in(&skills)?;
    let mut state = read_state(root)?;
    let mut records = Vec::new();
    for entry in std::fs::read_dir(&skills)
        .map_err(|error| format!("Could not read the skills directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Could not read a skill entry: {error}"))?;
        let id = entry.file_name().to_string_lossy().to_string();
        if id.starts_with(".skill-import-") {
            continue;
        }
        if id.starts_with(".skill-remove-") {
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
        match secure_skill_directory(&skills, &id) {
            Ok(directory) => records.push(inspect_real_skill(&directory, &id, &state)),
            Err(message) => records.push(invalid_record(
                &id,
                SkillSource::User,
                None,
                validation_error(SkillValidationCode::UnsafePath, message),
            )),
        }
    }
    records.sort_by(|left, right| left.id.cmp(&right.id));
    let mut normalized_enabled: BTreeSet<String> = BTreeSet::new();
    let mut normalized_seen: BTreeSet<String> = BTreeSet::new();
    for record in records.iter() {
        if !matches!(&record.validation, SkillValidation::Valid) {
            continue;
        }
        normalized_seen.insert(record.id.clone());
        let wanted = if state.seen.contains(&record.id) {
            state.enabled.contains(&record.id)
        } else {
            true
        };
        if wanted && normalized_enabled.len() < MAX_ENABLED_SKILLS {
            normalized_enabled.insert(record.id.clone());
        }
    }
    if normalized_enabled != state.enabled || normalized_seen != state.seen {
        state.enabled = normalized_enabled;
        state.seen = normalized_seen;
        write_state(root, &state)?;
    }
    for record in &mut records {
        record.enabled = matches!(&record.validation, SkillValidation::Valid)
            && state.enabled.contains(&record.id);
    }
    Ok(records)
}

pub fn list(root: &Path) -> Result<Vec<SkillRecord>, String> {
    let _guard = SKILLS_WRITE_LOCK
        .lock()
        .map_err(|_| "Skill storage is busy.".to_string())?;
    list_unlocked(root)
}

fn validate_unlocked(root: &Path, id: &str) -> Result<SkillRecord, String> {
    let skills = managed_skills_root(root)?;
    validate_skill_id(id)?;
    let directory = secure_skill_directory(&skills, id)?;
    let state = read_state(root)?;
    Ok(inspect_real_skill(&directory, id, &state))
}

pub fn validate(root: &Path, id: &str) -> Result<SkillRecord, String> {
    let _guard = SKILLS_WRITE_LOCK
        .lock()
        .map_err(|_| "Skill storage is busy.".to_string())?;
    validate_unlocked(root, id)
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

fn copy_tree(
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

fn disable_id(root: &Path, id: &str) -> Result<(), String> {
    let mut state = read_state(root)?;
    if state.enabled.remove(id) {
        write_state(root, &state)?;
    }
    Ok(())
}

pub fn add(root: &Path, source: &Path) -> Result<SkillRecord, String> {
    let _guard = SKILLS_WRITE_LOCK
        .lock()
        .map_err(|_| "Skill storage is busy.".to_string())?;
    if !source.is_absolute() {
        return Err("Choose an absolute skill folder path.".into());
    }
    let skills = managed_skills_root(root)?;
    seed_defaults_in(&skills)?;
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
    let staging = loop {
        let candidate = skills.join(format!(".skill-import-{:016x}", rand::random::<u64>()));
        if std::fs::symlink_metadata(&candidate).is_err() {
            break candidate;
        }
    };
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
    let state = read_state(root)?;
    Ok(inspect_real_skill(&skills.join(&id), &id, &state))
}

pub fn create(root: &Path, input: CreateSkillInput) -> Result<SkillRecord, String> {
    let _guard = SKILLS_WRITE_LOCK
        .lock()
        .map_err(|_| "Skill storage is busy.".to_string())?;
    let skills = managed_skills_root(root)?;
    seed_defaults_in(&skills)?;
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
            .and_then(|_| disable_id(root, &id))
    {
        let _ = std::fs::remove_dir_all(&directory);
        return Err(error);
    }
    let state = read_state(root)?;
    Ok(inspect_real_skill(&directory, &id, &state))
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
    let state = read_state(root)?;
    crate::sandbox::atomic_write(&directory.join("SKILL.md"), markdown.as_bytes())
        .map_err(|error| format!("Could not update SKILL.md: {error}"))?;
    Ok(inspect_real_skill(&directory, id, &state))
}

pub fn set_enabled(root: &Path, id: &str, enabled: bool) -> Result<SkillRecord, String> {
    let _guard = SKILLS_WRITE_LOCK
        .lock()
        .map_err(|_| "Skill storage is busy.".to_string())?;
    let _ = list_unlocked(root)?;
    let skills = managed_skills_root(root)?;
    let directory = secure_skill_directory(&skills, id)?;
    let mut state = read_state(root)?;
    let current = inspect_real_skill(&directory, id, &state);
    if enabled {
        if let SkillValidation::Invalid { message, .. } = &current.validation {
            return Err(message.clone());
        }
        if !state.enabled.contains(id) && state.enabled.len() >= MAX_ENABLED_SKILLS {
            return Err(format!("You can enable up to {MAX_ENABLED_SKILLS} skills."));
        }
        state.enabled.insert(id.to_string());
    } else {
        state.enabled.remove(id);
    }
    state.seen.insert(id.to_string());
    write_state(root, &state)?;
    Ok(inspect_real_skill(&directory, id, &state))
}

fn remove_unlocked_with_writer(
    root: &Path,
    id: &str,
    state_writer: impl FnOnce(&Path, &SkillsState) -> Result<(), String>,
) -> Result<(), String> {
    let skills = managed_skills_root(root)?;
    let directory = secure_skill_directory(&skills, id)?;
    if source_for(&directory, id) == SkillSource::FirstParty {
        return Err("Built-in skills can be disabled but cannot be removed.".into());
    }
    let mut state = read_state(root)?;
    let staging = loop {
        let candidate = skills.join(format!(".skill-remove-{:016x}-{id}", rand::random::<u64>()));
        if std::fs::symlink_metadata(&candidate).is_err() {
            break candidate;
        }
    };
    std::fs::rename(&directory, &staging)
        .map_err(|error| format!("Could not unregister skill \"{id}\": {error}"))?;
    if state.enabled.remove(id) {
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

#[tauri::command]
pub fn skills_list() -> Result<Vec<SkillRecord>, String> {
    list(&crate::paths::oleafly_root()?)
}

#[tauri::command]
pub fn skills_add(source_path: String) -> Result<SkillRecord, String> {
    add(&crate::paths::oleafly_root()?, Path::new(&source_path))
}

#[tauri::command]
pub fn skills_create(input: CreateSkillInput) -> Result<SkillRecord, String> {
    create(&crate::paths::oleafly_root()?, input)
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
pub fn skills_set_enabled(id: String, enabled: bool) -> Result<SkillRecord, String> {
    set_enabled(&crate::paths::oleafly_root()?, &id, enabled)
}

#[tauri::command]
pub fn skills_remove(id: String) -> Result<(), String> {
    remove(&crate::paths::oleafly_root()?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("oleafly-skills-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn first_list_seeds_the_default_workflow_skills() {
        let root = temp_root("seed");
        let packs = list(&root).unwrap();
        let ids: Vec<_> = packs.iter().map(|p| p.id.as_str()).collect();
        assert!(ids.contains(&"import-refine"));
        assert!(ids.contains(&"pdf-to-latex"));
        assert!(ids.contains(&"template-generate"));
        assert!(ids.contains(&"ai-figure"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn bundled_openresearch_skill_is_valid_first_party_and_on_by_default() {
        let root = tempfile::tempdir().unwrap();

        let skill = list(root.path())
            .unwrap()
            .into_iter()
            .find(|skill| skill.id == "openresearch")
            .expect("the bundled OpenResearch skill should be discovered");

        assert_eq!(skill.name, "OpenResearch (orx)");
        assert_eq!(
            skill.description,
            "Ground research in literature and run or inspect experiments with the local orx CLI."
        );
        assert!(!skill.instructions.trim().is_empty());
        assert_eq!(skill.source, SkillSource::FirstParty);
        assert!(skill.enabled);
        assert!(!skill.removable);
        assert_eq!(skill.validation, SkillValidation::Valid);

        let disabled = set_enabled(root.path(), "openresearch", false).unwrap();
        assert!(!disabled.enabled);
        let after_relist = list(root.path())
            .unwrap()
            .into_iter()
            .find(|skill| skill.id == "openresearch")
            .expect("the bundled OpenResearch skill should still be discovered");
        assert!(!after_relist.enabled);

        let enabled = set_enabled(root.path(), "openresearch", true).unwrap();
        assert!(enabled.enabled);
        assert!(enabled
            .instructions
            .contains("orx discover keyword <query>"));
    }

    #[test]
    fn user_edits_survive_reseeding() {
        let root = temp_root("edits");
        list(&root).unwrap();
        let skill = skills_root(&root).join("ai-figure").join("SKILL.md");
        std::fs::write(&skill, "customized").unwrap();

        let packs = list(&root).unwrap();
        let figure = packs.iter().find(|p| p.id == "ai-figure").unwrap();
        assert_eq!(std::fs::read_to_string(skill).unwrap(), "customized");
        assert!(matches!(
            figure.validation,
            SkillValidation::Invalid {
                code: SkillValidationCode::InvalidFrontmatter,
                ..
            }
        ));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn extra_user_skills_are_listed_sorted() {
        let root = temp_root("extra");
        let dir = skills_root(&root).join("zz-custom");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("SKILL.md"), "---\nname: zz-custom\n---\nbody").unwrap();

        let packs = list(&root).unwrap();
        assert_eq!(packs.last().unwrap().id, "zz-custom");
        std::fs::remove_dir_all(&root).ok();
    }

    fn valid_skill(name: &str, description: &str, instructions: &str) -> String {
        format!("---\nname: {name}\ndescription: {description}\n---\n\n{instructions}\n")
    }

    fn write_skill(root: &Path, id: &str, markdown: &str) -> PathBuf {
        let directory = skills_root(root).join(id);
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("SKILL.md"), markdown).unwrap();
        directory
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
    fn lists_an_unreadable_skill_as_invalid() {
        let root = tempfile::tempdir().unwrap();
        let directory = skills_root(root.path()).join("unreadable");
        std::fs::create_dir_all(directory.join("SKILL.md")).unwrap();

        let records = list(root.path()).unwrap();
        let record = records
            .iter()
            .find(|skill| skill.id == "unreadable")
            .unwrap();

        assert!(matches!(
            record.validation,
            SkillValidation::Invalid {
                code: SkillValidationCode::UnreadableSkillFile,
                ..
            }
        ));
        assert!(!record.enabled);
    }

    #[test]
    fn reserved_id_requires_first_party_provenance() {
        let root = tempfile::tempdir().unwrap();
        write_skill(
            root.path(),
            "research-review",
            &valid_skill(
                "Personal Review",
                "Review with a personal checklist.",
                "Apply the personal checklist.",
            ),
        );

        let record = list(root.path())
            .unwrap()
            .into_iter()
            .find(|skill| skill.id == "research-review")
            .unwrap();

        assert_eq!(record.source, SkillSource::User);
        assert!(record.removable);
        remove(root.path(), "research-review").unwrap();
        assert!(!skills_root(root.path()).join("research-review").exists());

        let seeded_root = tempfile::tempdir().unwrap();
        let seeded = list(seeded_root.path())
            .unwrap()
            .into_iter()
            .find(|skill| skill.id == "research-review")
            .unwrap();
        assert_eq!(seeded.source, SkillSource::FirstParty);
        assert!(!seeded.removable);

        std::fs::write(
            skills_root(seeded_root.path())
                .join("research-review")
                .join("manifest.json"),
            r#"{ "name": "research-review", "version": "2.0.0" }"#,
        )
        .unwrap();
        let upgraded = list(seeded_root.path())
            .unwrap()
            .into_iter()
            .find(|skill| skill.id == "research-review")
            .unwrap();
        assert_eq!(upgraded.source, SkillSource::FirstParty);
        assert!(!upgraded.removable);
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

        set_enabled(root.path(), "proof-review", true).unwrap();
        assert!(
            list(root.path())
                .unwrap()
                .iter()
                .find(|skill| skill.id == "proof-review")
                .unwrap()
                .enabled
        );
        assert!(set_enabled(root.path(), "broken", true).is_err());
        assert!(
            !list(root.path())
                .unwrap()
                .iter()
                .find(|skill| skill.id == "broken")
                .unwrap()
                .enabled
        );

        set_enabled(root.path(), "proof-review", false).unwrap();
        assert!(
            !list(root.path())
                .unwrap()
                .iter()
                .find(|skill| skill.id == "proof-review")
                .unwrap()
                .enabled
        );
    }

    #[test]
    fn enable_state_rejects_more_than_thirty_two_skills() {
        let root = tempfile::tempdir().unwrap();
        for index in 1..=33 {
            let id = format!("skill-{index}");
            write_skill(
                root.path(),
                &id,
                &valid_skill(
                    &id,
                    "Exercise the enabled skill limit.",
                    "Follow the steps.",
                ),
            );
        }
        let discovered = list(root.path()).unwrap();
        let enabled_ids: Vec<_> = discovered
            .iter()
            .filter(|skill| skill.enabled)
            .map(|skill| skill.id.clone())
            .collect();
        assert_eq!(enabled_ids.len(), MAX_ENABLED_SKILLS);

        let leftover = discovered
            .iter()
            .find(|skill| !skill.enabled)
            .expect("the cap should leave one skill off")
            .id
            .clone();

        let error = set_enabled(root.path(), &leftover, true).unwrap_err();

        assert_eq!(error, "You can enable up to 32 skills.");
        assert!(!validate(root.path(), &leftover).unwrap().enabled);
    }

    #[test]
    fn list_prunes_an_enabled_skill_deleted_outside_the_app() {
        let root = tempfile::tempdir().unwrap();
        let directory = write_skill(
            root.path(),
            "draft",
            &valid_skill("Draft", "Review a draft.", "Review the draft."),
        );
        set_enabled(root.path(), "draft", true).unwrap();
        std::fs::remove_dir_all(directory).unwrap();

        list(root.path()).unwrap();

        assert!(!read_state(root.path()).unwrap().enabled.contains("draft"));
    }

    #[test]
    fn list_prunes_an_enabled_skill_made_invalid_outside_the_app() {
        let root = tempfile::tempdir().unwrap();
        let directory = write_skill(
            root.path(),
            "draft",
            &valid_skill("Draft", "Review a draft.", "Review the draft."),
        );
        set_enabled(root.path(), "draft", true).unwrap();
        std::fs::write(
            directory.join("SKILL.md"),
            "---\nname: Draft\n---\n\nReview the draft.\n",
        )
        .unwrap();

        let record = list(root.path())
            .unwrap()
            .into_iter()
            .find(|skill| skill.id == "draft")
            .unwrap();

        assert!(matches!(record.validation, SkillValidation::Invalid { .. }));
        assert!(!record.enabled);
        assert!(!read_state(root.path()).unwrap().enabled.contains("draft"));
    }

    #[test]
    fn list_caps_an_oversized_enabled_state_to_valid_installed_skills() {
        let root = tempfile::tempdir().unwrap();
        let mut state = SkillsState::default();
        for index in 1..=33 {
            let id = format!("skill-{index:02}");
            write_skill(
                root.path(),
                &id,
                &valid_skill(
                    &id,
                    "Exercise enable state normalization.",
                    "Follow the steps.",
                ),
            );
            state.enabled.insert(id);
        }
        write_state(root.path(), &state).unwrap();

        let records = list(root.path()).unwrap();
        let stored = read_state(root.path()).unwrap();

        assert_eq!(records.iter().filter(|skill| skill.enabled).count(), 32);
        assert_eq!(stored.enabled.len(), 32);
        assert!(!stored.enabled.contains("skill-33"));
        assert!(
            !records
                .iter()
                .find(|skill| skill.id == "skill-33")
                .unwrap()
                .enabled
        );
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

        let added = add(root.path(), &source).unwrap();

        assert_eq!(added.id, "imported-review");
        assert!(matches!(added.validation, SkillValidation::Valid));
        assert!(!added.enabled);
        assert_eq!(added.source, SkillSource::User);
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

        let error = add(root.path(), root.path()).unwrap_err();

        assert_eq!(
            error,
            "Choose a skill folder outside the Oleafly data directory."
        );
        assert!(std::fs::read_dir(skills_root(root.path()))
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".skill-import-")));
    }

    #[test]
    fn add_rejects_a_skill_folder_over_the_copy_budget() {
        let root = tempfile::tempdir().unwrap();
        let source_parent = tempfile::tempdir().unwrap();
        let source = source_parent.path().join("large-pack");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(
            source.join("SKILL.md"),
            valid_skill(
                "Large Pack",
                "Exercise the skill folder copy limit.",
                "Read the bundled resources.",
            ),
        )
        .unwrap();
        std::fs::File::create(source.join("resource.bin"))
            .unwrap()
            .set_len(MAX_PACK_BYTES + 1)
            .unwrap();

        let error = add(root.path(), &source).unwrap_err();

        assert!(error.contains("exceeds the limit"));
        assert!(!skills_root(root.path()).join("large-pack").exists());
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
        for index in 0..MAX_PACK_ENTRIES {
            std::fs::create_dir(source.join(format!("resource-{index}"))).unwrap();
        }

        let error = add(root.path(), &source).unwrap_err();

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

        let error = add(root.path(), &source).unwrap_err();

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

        let error = add(root.path(), &source).unwrap_err();

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
            CreateSkillInput {
                name: "Methods Coach".into(),
                description: "Check a methods section for reproducibility.".into(),
                instructions: None,
            },
        )
        .unwrap();
        set_enabled(root.path(), "methods-coach", true).unwrap();

        remove(root.path(), "methods-coach").unwrap();

        assert!(!read_state(root.path())
            .unwrap()
            .enabled
            .contains("methods-coach"));
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
            "---\nname: Draft\ndescription: Review a draft.\nlicense: MIT\nmetadata:\n  owner: user\n---\n\nReview the draft.\n",
        );

        update(
            root.path(),
            "draft",
            UpdateSkillInput {
                name: "Draft Reviewer".into(),
                description: "Review a draft one section at a time.".into(),
                instructions: "Read one section, report issues, then continue.".into(),
            },
        )
        .unwrap();

        let markdown = std::fs::read_to_string(directory.join("SKILL.md")).unwrap();
        let (frontmatter, _) = split_frontmatter(&markdown).unwrap();
        let value: serde_yaml::Value = serde_yaml::from_str(&frontmatter).unwrap();
        let mapping = value.as_mapping().unwrap();
        assert_eq!(
            mapping
                .get(serde_yaml::Value::String("license".into()))
                .and_then(serde_yaml::Value::as_str),
            Some("MIT")
        );
        assert_eq!(
            mapping
                .get(serde_yaml::Value::String("metadata".into()))
                .and_then(serde_yaml::Value::as_mapping)
                .and_then(|metadata| metadata.get(serde_yaml::Value::String("owner".into())))
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
        set_enabled(root.path(), "draft", true).unwrap();

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
                set_enabled(root.path(), id, true).is_err(),
                "enable accepted {id}"
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
        list(root.path()).unwrap();

        assert!(remove(root.path(), "research-review").is_err());
        assert!(skills_root(root.path())
            .join("research-review/SKILL.md")
            .is_file());
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
        assert!(set_enabled(root.path(), "linked", true).is_err());
        assert!(remove(root.path(), "linked").is_err());
        assert_eq!(
            std::fs::read_to_string(outside.path().join("sentinel")).unwrap(),
            "keep"
        );
    }
}
