//! Skill instructions sent inline with a prompt.
//!
//! Some bridges (Pi) never pass Oleafly's MCP tools on to the agent, so a
//! skill picked in the composer travels as a text block after the user's
//! message instead of relying on `load_skill`.

use crate::agent::task_runtime::{skill_section, SkillAudience, MAX_SKILL_BYTES};
use std::path::{Path, PathBuf};

/// A skill attached to one prompt.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PromptSkill {
    pub id: String,
    pub name: String,
    /// The text block sent to the agent after the user's message.
    pub block: String,
    /// The skill's installed folder, spelled as the block names it. The agent
    /// may read inside it during this turn, since the block points it there.
    pub folder: Option<PathBuf>,
}

pub(super) fn prompt_skill(
    app: &tauri::AppHandle,
    project_id: &str,
    skill_id: &str,
) -> Result<PromptSkill, String> {
    let root = crate::paths::oleafly_root()?;
    let pack = crate::skills_pack::pack_root(app);
    prompt_skill_in(&root, pack.as_deref(), project_id, skill_id)
}

pub(super) fn prompt_skill_in(
    root: &Path,
    pack: Option<&Path>,
    project_id: &str,
    skill_id: &str,
) -> Result<PromptSkill, String> {
    let record = crate::skills::list_with(root, pack, Some(project_id))?
        .into_iter()
        .find(|skill| skill.id == skill_id)
        .ok_or("This skill is not installed.")?;
    if !record.is_available() {
        return Err("This skill is turned off. Turn it on in Settings, AI, Skills.".into());
    }
    let block = skill_section(&record, SkillAudience::CliAgent);
    if block.len() > MAX_SKILL_BYTES {
        return Err("This skill is too long to send with a message.".into());
    }
    let folder = Some(record.dir.as_str())
        .filter(|dir| !dir.is_empty())
        .map(|dir| oleafly_core::plain_path(Path::new(dir)));
    Ok(PromptSkill {
        id: record.id,
        name: record.name,
        block,
        folder,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn skill_root() -> tempfile::TempDir {
        let data = tempfile::tempdir().unwrap();
        let directory = data.path().join("skills").join("claim-audit");
        std::fs::create_dir_all(directory.join("scripts")).unwrap();
        std::fs::write(
            directory.join("SKILL.md"),
            "---\nname: Claim audit\ndescription: Check every claim against its source.\n---\n\nRead references.md before you start.\n",
        )
        .unwrap();
        std::fs::write(directory.join("scripts").join("verify.py"), "print('ok')\n").unwrap();
        std::fs::write(directory.join("references.md"), "# References\n").unwrap();
        data
    }

    #[test]
    fn a_cli_agent_gets_the_folder_and_files_but_no_scripts_or_tool_names() {
        let data = skill_root();
        let skill = prompt_skill_in(data.path(), None, "project", "claim-audit").unwrap();
        assert_eq!(skill.id, "claim-audit");
        assert_eq!(skill.name, "Claim audit");
        let named = skill.folder.clone().unwrap();
        assert!(skill
            .block
            .contains(&format!("Skill folder: {}\n", named.display())));
        assert_eq!(
            named.canonicalize().unwrap(),
            data.path()
                .join("skills")
                .join("claim-audit")
                .canonicalize()
                .unwrap()
        );
        let folder = oleafly_core::plain_path(
            &data
                .path()
                .join("skills")
                .join("claim-audit")
                .canonicalize()
                .unwrap(),
        );
        assert!(skill.block.starts_with("Selected skill: Claim audit\n"));
        assert!(
            skill
                .block
                .contains(&format!("Skill folder: {}", folder.display()))
                || skill.block.contains(&format!(
                    "Skill folder: {}",
                    data.path().join("skills").join("claim-audit").display()
                ))
        );
        assert!(skill
            .block
            .contains("Supporting files in that folder: references.md"));
        assert!(skill.block.contains("Read references.md before you start."));
        for hidden in [
            "scripts/",
            "verify.py",
            "run_command",
            "read_skill_file",
            "\\\\?\\",
        ] {
            assert!(!skill.block.contains(hidden), "{hidden}");
        }
    }

    #[test]
    fn unknown_and_disabled_skills_are_refused() {
        let data = skill_root();
        assert!(prompt_skill_in(data.path(), None, "project", "missing")
            .unwrap_err()
            .contains("not installed"));
        crate::skills::set_project_enabled(
            data.path(),
            None,
            "project",
            "claim-audit",
            Some(false),
        )
        .unwrap();
        assert!(prompt_skill_in(data.path(), None, "project", "claim-audit")
            .unwrap_err()
            .contains("turned off"));
    }
}
