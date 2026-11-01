use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use oleafly_research::mcp::SkillSource;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{schema, ToolContext, ToolSpec};
use crate::agent::policy::Allow;
use crate::skills_read::{parse_frontmatter, read_skills, valid_skill_id, SkillEntry};

const STATE_FILE: &str = "skills-state.json";
const MAX_STATE_BYTES: u64 = 16 * 1024 * 1024;
const STATE_VERSION: u8 = 2;
const MAX_SKILL_FILE_BYTES: u64 = 4 * 1024 * 1024;
pub const MAX_SKILL_PROMPT_BYTES: usize = 192 * 1024;
const MAX_DEPTH: usize = 8;
const MAX_ENTRIES: usize = 2_000;
const MANAGED_MANIFEST_FILE: &str = ".oleafly-skill.json";
const FIRST_PARTY_MARKER_FILE: &str = ".oleafly-first-party";
const SCRIPT_PROGRAM_DIRECTORIES: [&str; 4] =
    ["/usr/bin", "/bin", "/usr/local/bin", "/opt/homebrew/bin"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SkillAudience {
    Task,
    Agent,
}

#[derive(Clone, Debug, Default)]
pub struct CliSkills {
    pub root: PathBuf,
    pub pack: Option<PathBuf>,
    pub disabled: BTreeSet<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct SkillsState {
    version: u8,
    enabled: BTreeSet<String>,
    seen: BTreeSet<String>,
    project_enabled: BTreeMap<String, BTreeSet<String>>,
    project_disabled: BTreeMap<String, BTreeSet<String>>,
}

impl SkillsState {
    fn available(&self, project_id: Option<&str>, id: &str) -> bool {
        let scoped = |map: &BTreeMap<String, BTreeSet<String>>| {
            project_id
                .and_then(|project| map.get(project))
                .is_some_and(|ids| ids.contains(id))
        };
        if scoped(&self.project_disabled) {
            return false;
        }
        if scoped(&self.project_enabled) {
            return true;
        }
        !self.seen.contains(id) || self.enabled.contains(id)
    }
}

fn read_state(data_root: &Path) -> SkillsState {
    let path = data_root.join(STATE_FILE);
    let Some(bytes) = read_regular_file(&path, MAX_STATE_BYTES) else {
        return SkillsState::default();
    };
    serde_json::from_slice::<SkillsState>(&bytes)
        .ok()
        .filter(|state| state.version >= 1 && state.version <= STATE_VERSION)
        .unwrap_or_default()
}

fn read_regular_file(path: &Path, limit: u64) -> Option<Vec<u8>> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > limit {
        return None;
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    (bytes.len() as u64 <= limit).then_some(bytes)
}

#[derive(Clone, Debug)]
struct Skill {
    id: String,
    name: String,
    description: String,
    dir: PathBuf,
    instructions: String,
    files: Vec<(String, u64)>,
}

fn instructions_of(markdown: &str) -> String {
    let normalized = markdown.replace("\r\n", "\n");
    let mut lines = normalized.lines();
    if lines.next().map(str::trim_end) != Some("---") {
        return normalized.trim().to_string();
    }
    let mut body = Vec::new();
    let mut closed = false;
    for line in lines {
        if !closed {
            closed = line.trim_end() == "---";
            continue;
        }
        body.push(line);
    }
    if !closed {
        return normalized.trim().to_string();
    }
    body.join("\n").trim().to_string()
}

fn walk_files(
    directory: &Path,
    prefix: &str,
    depth: usize,
    files: &mut Vec<(String, u64)>,
    entries: &mut usize,
) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(read) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in read.flatten() {
        *entries += 1;
        if *entries > MAX_ENTRIES {
            return;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if depth == 0 && (name == MANAGED_MANIFEST_FILE || name == FIRST_PARTY_MARKER_FILE) {
            continue;
        }
        let Ok(metadata) = std::fs::symlink_metadata(entry.path()) else {
            continue;
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        let relative = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        if metadata.is_dir() {
            walk_files(&entry.path(), &relative, depth + 1, files, entries);
        } else if metadata.is_file() {
            files.push((relative, metadata.len()));
        }
    }
}

fn load(entry: &SkillEntry) -> Result<Skill, String> {
    let markdown = read_regular_file(&entry.path.join("SKILL.md"), MAX_SKILL_FILE_BYTES)
        .ok_or_else(|| format!("The skill {} has no readable SKILL.md.", entry.id))?;
    let markdown = String::from_utf8_lossy(&markdown).into_owned();
    let dir = dunce::canonicalize(&entry.path).unwrap_or_else(|_| entry.path.clone());
    let mut files = Vec::new();
    walk_files(&dir, "", 0, &mut files, &mut 0);
    files.retain(|(path, _)| path != "SKILL.md");
    files.sort();
    let fields = parse_frontmatter(&markdown);
    Ok(Skill {
        id: entry.id.clone(),
        name: fields
            .get("name")
            .filter(|name| !name.is_empty())
            .cloned()
            .unwrap_or_else(|| entry.id.clone()),
        description: fields.get("description").cloned().unwrap_or_default(),
        dir,
        instructions: instructions_of(&markdown),
        files,
    })
}

fn script_program(relative: &str) -> Option<&'static str> {
    match Path::new(relative)
        .extension()
        .and_then(std::ffi::OsStr::to_str)
    {
        Some("py") => Some("python3"),
        Some("sh" | "bash") => Some("bash"),
        Some("mjs" | "js") => Some("node"),
        Some("R" | "r") => Some("Rscript"),
        _ => None,
    }
}

fn resolved_program(name: &str) -> String {
    SCRIPT_PROGRAM_DIRECTORIES
        .iter()
        .map(|directory| Path::new(directory).join(name))
        .find(|candidate| candidate.is_file())
        .map(|candidate| candidate.to_string_lossy().into_owned())
        .unwrap_or_else(|| name.to_string())
}

fn quoted(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\\\""))
}

fn scripts(skill: &Skill) -> Vec<(String, String)> {
    skill
        .files
        .iter()
        .filter(|(path, _)| path.starts_with("scripts/"))
        .map(|(path, _)| {
            let absolute = skill.dir.join(path).to_string_lossy().into_owned();
            let command = match script_program(path) {
                Some(program) => format!("{} {}", resolved_program(program), quoted(&absolute)),
                None => quoted(&absolute),
            };
            (path.clone(), command)
        })
        .collect()
}

fn resolve_skill_file(directory: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.trim().is_empty() {
        return Err("Name a file inside the skill folder.".into());
    }
    if relative.chars().any(char::is_control) {
        return Err("That skill file path is not allowed.".into());
    }
    if Path::new(relative).is_absolute() || relative.starts_with('/') || relative.starts_with('\\')
    {
        return Err("Use a path relative to the skill folder.".into());
    }
    let parts: Vec<&str> = relative
        .split(['/', '\\'])
        .filter(|part| !part.is_empty() && *part != ".")
        .collect();
    if parts.is_empty() {
        return Err("Name a file inside the skill folder.".into());
    }
    if parts.len() > MAX_DEPTH {
        return Err("That skill file path is too deeply nested.".into());
    }
    let mut current = directory.to_path_buf();
    for (index, part) in parts.iter().enumerate() {
        if *part == ".." || part.contains(':') {
            return Err("That skill file path is not allowed.".into());
        }
        current.push(part);
        let metadata = std::fs::symlink_metadata(&current)
            .map_err(|_| format!("The skill does not contain \"{relative}\"."))?;
        if metadata.file_type().is_symlink() {
            return Err("That skill file is a link and cannot be read.".into());
        }
        let last = index + 1 == parts.len();
        if last && !metadata.is_file() {
            return Err(format!("\"{relative}\" is not a file in this skill."));
        }
        if !last && !metadata.is_dir() {
            return Err(format!("The skill does not contain \"{relative}\"."));
        }
    }
    let resolved = dunce::canonicalize(&current)
        .map_err(|_| format!("The skill does not contain \"{relative}\"."))?;
    if !resolved.starts_with(directory) {
        return Err("That skill file path is not allowed.".into());
    }
    Ok(resolved)
}

impl CliSkills {
    pub fn empty() -> Self {
        Self::default()
    }

    pub fn from_app(data_root: &Path, pack: Option<PathBuf>, project_id: Option<&str>) -> Self {
        let state = read_state(data_root);
        let root = data_root.join("skills");
        let mut skills = Self {
            root,
            pack,
            disabled: BTreeSet::new(),
        };
        let disabled = skills
            .entries()
            .into_iter()
            .filter(|entry| !state.available(project_id, &entry.id))
            .map(|entry| entry.id)
            .collect();
        skills.disabled = disabled;
        skills
    }

    fn entries(&self) -> Vec<SkillEntry> {
        let mut entries = if self.root.as_os_str().is_empty() {
            Vec::new()
        } else {
            read_skills(&self.root)
        };
        if let Some(pack) = &self.pack {
            for entry in read_skills(pack) {
                if !entries.iter().any(|known| known.id == entry.id) {
                    entries.push(entry);
                }
            }
        }
        entries.sort_by(|left, right| left.id.cmp(&right.id));
        entries
    }

    fn is_enabled(&self, id: &str) -> bool {
        !self.disabled.contains(id)
    }

    fn enabled(&self, id: &str) -> Result<Skill, String> {
        if !valid_skill_id(id) {
            return Err(format!("There is no skill named {id}."));
        }
        let entry = self
            .entries()
            .into_iter()
            .find(|entry| entry.id == id)
            .ok_or_else(|| format!("There is no skill named {id}."))?;
        if !self.is_enabled(id) {
            return Err(format!(
                "The skill {id} is turned off. Enable it in Settings, AI, Skills."
            ));
        }
        load(&entry)
    }

    pub fn read_paths(&self, ids: &[String]) -> Vec<PathBuf> {
        let mut paths: Vec<PathBuf> = ids
            .iter()
            .filter_map(|id| self.enabled(id).ok())
            .map(|skill| skill.dir)
            .filter(|dir| dir.is_dir())
            .collect();
        paths.sort();
        paths.dedup();
        paths
    }
}

fn payload(skill: &Skill) -> Value {
    json!({
        "id": skill.id,
        "name": skill.name,
        "description": skill.description,
        "dir": skill.dir.to_string_lossy(),
        "files": skill.files.iter().map(|(path, bytes)| json!({"path": path, "bytes": bytes})).collect::<Vec<_>>(),
        "scripts": scripts(skill).into_iter().map(|(path, command)| json!({"path": path, "command": command})).collect::<Vec<_>>(),
        "instructions": skill.instructions,
    })
}

impl SkillSource for CliSkills {
    fn list(&self, _project_id: &str) -> Result<Vec<Value>, String> {
        Ok(self
            .entries()
            .into_iter()
            .map(|entry| {
                json!({
                    "id": entry.id,
                    "name": entry.name,
                    "description": entry.description,
                    "phase": Value::Null,
                    "tier": Value::Null,
                    "enabled": self.is_enabled(&entry.id),
                })
            })
            .collect())
    }

    fn load(&self, _project_id: &str, id: &str) -> Result<Value, String> {
        Ok(payload(&self.enabled(id)?))
    }

    fn read_file(&self, _project_id: &str, id: &str, path: &str) -> Result<Value, String> {
        let skill = self.enabled(id)?;
        let resolved = resolve_skill_file(&skill.dir, path)?;
        let mut bytes = Vec::new();
        std::fs::File::open(&resolved)
            .and_then(|file| file.take(MAX_SKILL_FILE_BYTES + 1).read_to_end(&mut bytes))
            .map_err(|error| format!("Could not read that skill file: {error}"))?;
        let truncated = bytes.len() as u64 > MAX_SKILL_FILE_BYTES;
        bytes.truncate(MAX_SKILL_FILE_BYTES as usize);
        if bytes.contains(&0) {
            return Err(format!("\"{path}\" is not a text file."));
        }
        let content = match std::str::from_utf8(&bytes) {
            Ok(text) => text.to_string(),
            Err(error) if truncated && error.error_len().is_none() => {
                String::from_utf8_lossy(&bytes[..error.valid_up_to()]).into_owned()
            }
            Err(_) => return Err(format!("\"{path}\" is not a text file.")),
        };
        Ok(json!({"path": path.replace('\\', "/"), "content": content, "truncated": truncated}))
    }
}

fn section(skill: &Skill, audience: SkillAudience) -> String {
    let mut section = format!("\n\nSelected skill: {}\n", skill.name);
    section.push_str(&format!(
        "Skill folder: {}\nEvery relative path in the instructions below is inside that folder, which is readable from run_command.\n",
        skill.dir.display()
    ));
    let scripts = scripts(skill);
    if !scripts.is_empty() {
        section.push_str("Bundled scripts, run one with run_command:\n");
        for (path, command) in scripts {
            section.push_str(&format!("- {path}: {command}\n"));
        }
    }
    let references: Vec<&str> = skill
        .files
        .iter()
        .filter(|(path, _)| !path.starts_with("scripts/"))
        .map(|(path, _)| path.as_str())
        .collect();
    if !references.is_empty() {
        section.push_str(&format!(
            "Supporting files, read one with read_skill_file: {}\n",
            references.join(", ")
        ));
    }
    section.push_str(&skill.instructions);
    let alias = match audience {
        SkillAudience::Task => oleafly_research::aliases::AliasAudience::Task {
            alphaxiv_tools: None,
        },
        SkillAudience::Agent => oleafly_research::aliases::AliasAudience::CliAgent,
    };
    section.push_str(&oleafly_research::aliases::tool_alias_note(
        &skill.instructions,
        &alias,
    ));
    section
}

pub fn skill_prompt(
    skills: &CliSkills,
    _project_id: Option<&str>,
    ids: &[String],
    audience: SkillAudience,
) -> Result<String, String> {
    let mut prompt = String::new();
    for id in ids {
        let skill = skills.enabled(id)?;
        prompt.push_str(&section(&skill, audience));
        if prompt.len() > MAX_SKILL_PROMPT_BYTES {
            return Err("The selected skills are too long for one run. Pick fewer skills.".into());
        }
    }
    Ok(prompt)
}

pub(super) fn specs() -> Vec<ToolSpec> {
    let id = json!({"type": "string", "minLength": 1, "maxLength": 256});
    vec![
        ToolSpec {
            name: "list_skills",
            needs: Allow::Read,
            writes: false,
            schema: schema("list_skills", "List the skills installed in Oleafly and whether each is turned on.", json!({}), &[]),
        },
        ToolSpec {
            name: "load_skill",
            needs: Allow::Read,
            writes: false,
            schema: schema(
                "load_skill",
                "Load one skill: its full instructions, its folder, its supporting files and a command for each bundled script.",
                json!({"id": id}),
                &["id"],
            ),
        },
        ToolSpec {
            name: "read_skill_file",
            needs: Allow::Read,
            writes: false,
            schema: schema(
                "read_skill_file",
                "Read a supporting file of a skill that is turned on, by the skill's id and the file's path in its folder.",
                json!({"id": id, "path": {"type": "string", "maxLength": 4096}}),
                &["id", "path"],
            ),
        },
    ]
}

pub(super) async fn call(
    ctx: Arc<ToolContext>,
    name: String,
    arguments: Value,
) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        let project = ctx.project_id.clone().unwrap_or_default();
        let text = |key: &str| arguments[key].as_str().unwrap_or("").to_string();
        match name.as_str() {
            "list_skills" => Ok(json!({"skills": ctx.skills.list(&project)?})),
            "load_skill" => ctx.skills.load(&project, &text("id")),
            "read_skill_file" => ctx.skills.read_file(&project, &text("id"), &text("path")),
            _ => Err(format!("The tool {name} is not available in this run.")),
        }
    })
    .await
    .map_err(|_| "The tool stopped before it returned a result.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_skill(root: &Path, id: &str, name: &str) {
        let folder = root.join(id);
        std::fs::create_dir_all(folder.join("scripts")).unwrap();
        std::fs::create_dir_all(folder.join("references")).unwrap();
        std::fs::write(
            folder.join("SKILL.md"),
            format!(
                "---\nname: {name}\ndescription: Does {id}\n---\n\n# {name}\nFollow the steps.\n"
            ),
        )
        .unwrap();
        std::fs::write(folder.join("scripts/run.py"), "print(1)\n").unwrap();
        std::fs::write(folder.join("references/guide.md"), "Guide\n").unwrap();
        std::fs::write(folder.join(MANAGED_MANIFEST_FILE), "{}").unwrap();
    }

    fn data_with_skills() -> tempfile::TempDir {
        let data = tempfile::tempdir().unwrap();
        write_skill(
            &data.path().join("skills"),
            "literature-review",
            "Literature review",
        );
        write_skill(&data.path().join("skills"), "x", "X");
        data
    }

    #[test]
    fn skills_payloads_match_the_app_shape() {
        let data = data_with_skills();
        let skills = CliSkills::from_app(data.path(), None, None);
        let payload = skills.load("p", "literature-review").unwrap();
        for key in [
            "id",
            "name",
            "description",
            "dir",
            "files",
            "scripts",
            "instructions",
        ] {
            assert!(payload.get(key).is_some(), "{key}");
        }
        assert_eq!(payload["name"], "Literature review");
        assert!(payload["instructions"]
            .as_str()
            .unwrap()
            .starts_with("# Literature review"));
        let files: Vec<&str> = payload["files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|file| file["path"].as_str().unwrap())
            .collect();
        assert_eq!(files, ["references/guide.md", "scripts/run.py"]);
        assert!(payload["scripts"][0]["command"]
            .as_str()
            .unwrap()
            .contains("run.py"));
        let listed = skills.list("p").unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed
            .iter()
            .all(|row| row.get("enabled").is_some() && row.get("phase").is_some()));
    }

    #[test]
    fn disabled_skills_are_refused() {
        let data = data_with_skills();
        let skills = CliSkills {
            disabled: BTreeSet::from(["x".to_string()]),
            ..CliSkills::from_app(data.path(), None, None)
        };
        assert!(skills.load("p", "x").unwrap_err().contains("is turned off"));
        assert!(skills
            .read_file("p", "x", "references/guide.md")
            .unwrap_err()
            .contains("is turned off"));
        assert!(
            skill_prompt(&skills, None, &["x".into()], SkillAudience::Agent)
                .unwrap_err()
                .contains("is turned off")
        );
    }

    #[test]
    fn the_app_state_turns_skills_off_globally_and_per_project() {
        let data = data_with_skills();
        std::fs::write(
            data.path().join(STATE_FILE),
            r#"{"version":2,"enabled":["literature-review"],"seen":["literature-review","x"],"projectEnabled":{"p1":["x"]},"projectDisabled":{"p2":["literature-review"]}}"#,
        )
        .unwrap();
        let global = CliSkills::from_app(data.path(), None, None);
        assert_eq!(global.disabled, BTreeSet::from(["x".to_string()]));
        let p1 = CliSkills::from_app(data.path(), None, Some("p1"));
        assert!(p1.disabled.is_empty());
        let p2 = CliSkills::from_app(data.path(), None, Some("p2"));
        assert_eq!(
            p2.disabled,
            BTreeSet::from(["literature-review".to_string(), "x".to_string()])
        );
    }

    #[test]
    fn skill_files_stay_inside_the_skill_folder() {
        let data = data_with_skills();
        let skills = CliSkills::from_app(data.path(), None, None);
        assert_eq!(
            skills.read_file("p", "x", "references/guide.md").unwrap()["content"],
            "Guide\n"
        );
        for bad in [
            "../literature-review/SKILL.md",
            "/etc/passwd",
            "C:\\x",
            "a:b",
            "",
        ] {
            assert!(skills.read_file("p", "x", bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_prompt_has_the_apps_sections_and_a_size_limit() {
        let data = data_with_skills();
        let skills = CliSkills::from_app(data.path(), None, None);
        let prompt = skill_prompt(
            &skills,
            None,
            &["literature-review".into()],
            SkillAudience::Task,
        )
        .unwrap();
        assert!(prompt.contains("Selected skill: Literature review"));
        assert!(prompt.contains("Bundled scripts, run one with run_command:"));
        assert!(
            prompt.contains("Supporting files, read one with read_skill_file: references/guide.md")
        );
        let big = data.path().join("skills").join("big");
        std::fs::create_dir_all(&big).unwrap();
        std::fs::write(
            big.join("SKILL.md"),
            format!("---\nname: Big\n---\n{}", "x".repeat(200 * 1024)),
        )
        .unwrap();
        let skills = CliSkills::from_app(data.path(), None, None);
        assert!(
            skill_prompt(&skills, None, &["big".into()], SkillAudience::Agent)
                .unwrap_err()
                .contains("too long")
        );
    }

    #[test]
    fn pack_skills_fill_in_what_the_skills_folder_lacks() {
        let data = tempfile::tempdir().unwrap();
        let pack = tempfile::tempdir().unwrap();
        write_skill(pack.path(), "bundled", "Bundled");
        let skills = CliSkills::from_app(data.path(), Some(pack.path().to_path_buf()), None);
        assert_eq!(skills.load("p", "bundled").unwrap()["name"], "Bundled");
    }
}
