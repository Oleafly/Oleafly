//! Reads the app's skills folder (`<data>/skills/<id>/SKILL.md`) without
//! changing it: `oleafly skills`, the headless agent and the helper list
//! skills the way the app does.
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use serde::Deserialize;

/// The provenance file the app writes into a skill it installed.
const MANAGED_MANIFEST_FILE: &str = ".oleafly-skill.json";
const MANAGED_MANIFEST_SCHEMA_VERSION: u8 = 1;
/// A bundled skill also carries this marker with exactly this content.
const FIRST_PARTY_MARKER_FILE: &str = ".oleafly-first-party";
const FIRST_PARTY_MARKER: &[u8] = b"oleafly-first-party-v1\n";
const MAX_SKILLS: usize = 1_000;
const MAX_SKILL_BYTES: u64 = 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;

/// One installed skill.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SkillEntry {
    /// The folder name.
    pub id: String,
    pub name: String,
    pub description: String,
    /// The skill's folder.
    pub path: PathBuf,
    /// `bundled`, `catalog` or `user`.
    pub source: &'static str,
}

#[derive(Deserialize)]
struct ManagedManifest {
    schema_version: u8,
    source: String,
}

/// A skill id is one plain folder name.
pub fn valid_skill_id(id: &str) -> bool {
    let components: Vec<_> = Path::new(id).components().collect();
    !id.is_empty()
        && matches!(components.as_slice(), [Component::Normal(_)])
        && !id.contains(['/', '\\', ':', '\0'])
        && !id.chars().any(char::is_control)
        && !id.starts_with('.')
}

/// A real file (not a link), at most `limit` bytes.
fn read_small_file(path: &Path, limit: u64) -> Option<Vec<u8>> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > limit {
        return None;
    }
    let file = std::fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes).ok()?;
    (bytes.len() as u64 <= limit).then_some(bytes)
}

fn source_of(directory: &Path) -> &'static str {
    let manifest = read_small_file(&directory.join(MANAGED_MANIFEST_FILE), MAX_MANIFEST_BYTES)
        .and_then(|bytes| serde_json::from_slice::<ManagedManifest>(&bytes).ok())
        .filter(|manifest| manifest.schema_version == MANAGED_MANIFEST_SCHEMA_VERSION);
    let marked = read_small_file(
        &directory.join(FIRST_PARTY_MARKER_FILE),
        FIRST_PARTY_MARKER.len() as u64,
    )
    .is_some_and(|bytes| bytes == FIRST_PARTY_MARKER);
    match manifest.as_ref().map(|manifest| manifest.source.as_str()) {
        Some("bundled") if marked => "bundled",
        Some("catalog") => "catalog",
        _ => "user",
    }
}

fn unquote(value: &str) -> String {
    let value = value.trim();
    let quoted = value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')));
    if !quoted {
        return value.to_string();
    }
    let inner = &value[1..value.len() - 1];
    if value.starts_with('\'') {
        inner.replace("''", "'")
    } else {
        inner.replace("\\\"", "\"").replace("\\\\", "\\")
    }
}

/// The top-level `key: value` pairs between the first two `---` lines.
/// Quoted values are unquoted; `>` and `|` blocks are joined (folded with
/// spaces, literal with newlines).
pub fn parse_frontmatter(text: &str) -> BTreeMap<String, String> {
    let normalized = text.replace("\r\n", "\n");
    let mut lines = normalized.lines();
    let mut fields = BTreeMap::new();
    if lines.next().map(str::trim_end) != Some("---") {
        return fields;
    }
    let body: Vec<&str> = lines.take_while(|line| line.trim_end() != "---").collect();
    let mut index = 0;
    while index < body.len() {
        let line = body[index];
        index += 1;
        if line.starts_with([' ', '\t']) || line.trim_start().starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() || key.contains(' ') {
            continue;
        }
        let value = value.trim();
        let block = value
            .chars()
            .next()
            .filter(|first| matches!(first, '>' | '|'));
        if let Some(style) = block {
            let mut parts = Vec::new();
            while index < body.len()
                && (body[index].starts_with([' ', '\t']) || body[index].trim().is_empty())
            {
                parts.push(body[index].trim());
                index += 1;
            }
            while parts.last().is_some_and(|part| part.is_empty()) {
                parts.pop();
            }
            let joined = if style == '>' {
                parts
                    .split(|part| part.is_empty())
                    .map(|paragraph| paragraph.join(" "))
                    .collect::<Vec<_>>()
                    .join("\n")
            } else {
                parts.join("\n")
            };
            fields.insert(key.to_string(), joined);
        } else {
            fields.insert(key.to_string(), unquote(value));
        }
    }
    fields
}

/// Every skill in `root` (the skills folder), sorted by id. Folders that are
/// links, hidden or without a readable `SKILL.md` are skipped.
pub fn read_skills(root: &Path) -> Vec<SkillEntry> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut skills = Vec::new();
    for entry in entries.flatten().take(MAX_SKILLS * 4) {
        let Ok(id) = entry.file_name().into_string() else {
            continue;
        };
        if !valid_skill_id(&id) {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let directory = entry.path();
        let Some(bytes) = read_small_file(&directory.join("SKILL.md"), MAX_SKILL_BYTES) else {
            continue;
        };
        let fields = parse_frontmatter(&String::from_utf8_lossy(&bytes));
        skills.push(SkillEntry {
            name: fields
                .get("name")
                .filter(|name| !name.is_empty())
                .cloned()
                .unwrap_or_else(|| id.clone()),
            description: fields.get("description").cloned().unwrap_or_default(),
            source: source_of(&directory),
            path: directory,
            id,
        });
        if skills.len() >= MAX_SKILLS {
            break;
        }
    }
    skills.sort_by(|left, right| left.id.cmp(&right.id));
    skills
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_frontmatter_reads_plain_quoted_and_folded_values() {
        let real = include_str!("../../../src-tauri/resources/skills/oleafly-latex-build/SKILL.md");
        let fields = parse_frontmatter(real);
        assert!(fields.get("name").is_some_and(|name| !name.is_empty()));
        assert!(fields
            .get("description")
            .is_some_and(|description| !description.is_empty()));

        let sample = "---\r\nname: \"Quoted: name\"\r\ndescription: >\r\n  Folded over\r\n  two lines.\r\n\r\n  Second paragraph.\r\nlicense: 'it''s fine'\r\nnotes: |\r\n  one\r\n  two\r\n---\r\nBody";
        let fields = parse_frontmatter(sample);
        assert_eq!(fields["name"], "Quoted: name");
        assert_eq!(
            fields["description"],
            "Folded over two lines.\nSecond paragraph."
        );
        assert_eq!(fields["license"], "it's fine");
        assert_eq!(fields["notes"], "one\ntwo");
        assert!(parse_frontmatter("no front matter").is_empty());
    }

    #[test]
    fn skills_are_read_with_their_source() {
        let root = tempfile::tempdir().unwrap();
        let bundled = root.path().join("latex-build");
        std::fs::create_dir(&bundled).unwrap();
        std::fs::write(
            bundled.join("SKILL.md"),
            "---\nname: LaTeX build\ndescription: Fix builds.\n---\n",
        )
        .unwrap();
        std::fs::write(
            bundled.join(MANAGED_MANIFEST_FILE),
            r#"{"schema_version":1,"id":"latex-build","source":"bundled"}"#,
        )
        .unwrap();
        std::fs::write(bundled.join(FIRST_PARTY_MARKER_FILE), FIRST_PARTY_MARKER).unwrap();
        let mine = root.path().join("mine");
        std::fs::create_dir(&mine).unwrap();
        std::fs::write(mine.join("SKILL.md"), "---\ndescription: Mine.\n---\n").unwrap();
        std::fs::create_dir(root.path().join("empty")).unwrap();
        std::fs::create_dir(root.path().join(".hidden")).unwrap();
        let skills = read_skills(root.path());
        assert_eq!(
            skills
                .iter()
                .map(|skill| skill.id.as_str())
                .collect::<Vec<_>>(),
            ["latex-build", "mine"]
        );
        assert_eq!(
            (skills[0].name.as_str(), skills[0].source),
            ("LaTeX build", "bundled")
        );
        assert_eq!(
            (skills[1].name.as_str(), skills[1].source),
            ("mine", "user")
        );
    }

    #[test]
    fn a_marker_without_the_manifest_is_not_bundled() {
        let root = tempfile::tempdir().unwrap();
        let skill = root.path().join("fake");
        std::fs::create_dir(&skill).unwrap();
        std::fs::write(skill.join("SKILL.md"), "---\nname: Fake\n---\n").unwrap();
        std::fs::write(skill.join(FIRST_PARTY_MARKER_FILE), FIRST_PARTY_MARKER).unwrap();
        assert_eq!(read_skills(root.path())[0].source, "user");
    }

    #[test]
    fn skill_ids_are_single_plain_names() {
        assert!(valid_skill_id("literature-review"));
        for id in ["", "../x", "a/b", "a\\b", "C:x", ".git", "a\u{7}"] {
            assert!(!valid_skill_id(id), "{id:?}");
        }
    }
}
