//! The app's side of the research MCP bridge. The server, its tools and the
//! stdio relay live in the research crate; this module admits the project
//! and supplies the app's skills, linked folders and connector keys.
use std::path::PathBuf;
use std::sync::Arc;

use oleafly_research::mcp::{BridgeServices, LinkedRootInfo, LinkedRoots, McpStart, SkillSource};
use oleafly_research::task_tools::extra::TaskBinding;
use serde_json::{json, Value};

pub use oleafly_research::mcp::{
    serve_stdio_bridge, stdio_bridge_requested, stdio_server, ScopedResearchMcp,
};

pub async fn start(
    app: tauri::AppHandle,
    project_id: String,
    execution_root: Option<PathBuf>,
) -> Result<ScopedResearchMcp, String> {
    let pack = crate::skills_pack::pack_root(&app);
    start_inner(pack, project_id, execution_root, None, None).await
}

pub async fn start_restricted(
    app: tauri::AppHandle,
    project_id: String,
    execution_root: PathBuf,
    allowed_paths: Vec<String>,
    task: Option<TaskBinding>,
) -> Result<ScopedResearchMcp, String> {
    let pack = crate::skills_pack::pack_root(&app);
    start_inner(
        pack,
        project_id,
        Some(execution_root),
        Some(allowed_paths),
        task,
    )
    .await
}

/// One linked folder's current path, through the research workspace's checks.
pub(crate) fn linked_root(project_id: &str, root_id: &str) -> Result<PathBuf, String> {
    AppLinkedRoots.resolve(project_id, root_id)
}

fn admit(project_id: &str) -> Result<PathBuf, String> {
    crate::paths::validate_project_id(project_id)?;
    crate::trust::require_trusted(project_id, crate::trust::Capability::McpExposure)?;
    let project_root = crate::paths::project_dir(project_id)?;
    if !project_root.is_dir() {
        return Err("The research project is no longer available.".into());
    }
    Ok(project_root)
}

async fn start_inner(
    skills_pack: Option<PathBuf>,
    project_id: String,
    execution_root: Option<PathBuf>,
    allowed_paths: Option<Vec<String>>,
    task: Option<TaskBinding>,
) -> Result<ScopedResearchMcp, String> {
    let project_root = admit(&project_id)?;
    let root = execution_root.unwrap_or(project_root);
    let linked_roots = match crate::research_workspace::get_research_workspace(project_id.clone()) {
        Ok(workspace) => workspace
            .roots
            .into_iter()
            .map(|root| LinkedRootInfo {
                role: serde_json::to_value(root.role)
                    .ok()
                    .and_then(|role| role.as_str().map(str::to_string))
                    .unwrap_or_default(),
                id: root.id,
                label: root.label,
                canonical_path: root.canonical_path,
            })
            .collect(),
        Err(error) => {
            let _ = crate::project::append_app_log(format!(
                "Research session started without linked folders: {error}"
            ));
            Vec::new()
        }
    };
    oleafly_research::mcp::serve(McpStart {
        project_id,
        root,
        allowed: allowed_paths,
        linked_roots,
        services: services(crate::paths::oleafly_root()?, skills_pack),
        task,
    })
    .await
}

fn services(skills_root: PathBuf, skills_pack: Option<PathBuf>) -> BridgeServices {
    BridgeServices {
        skills: Arc::new(AppSkills {
            root: skills_root,
            pack: skills_pack,
        }),
        linked: Arc::new(AppLinkedRoots),
        secrets: Arc::new(crate::literature::AppSecrets),
    }
}

/// Skills from Oleafly's library folder and the bundled pack.
struct AppSkills {
    root: PathBuf,
    pack: Option<PathBuf>,
}

impl AppSkills {
    fn records(&self, project_id: &str) -> Result<Vec<crate::skills::SkillRecord>, String> {
        Ok(
            crate::skills::list_with(&self.root, self.pack.as_deref(), Some(project_id))?
                .into_iter()
                .filter(crate::skills::SkillRecord::is_valid)
                .collect(),
        )
    }

    fn enabled(&self, project_id: &str, id: &str) -> Result<crate::skills::SkillRecord, String> {
        self.records(project_id)?
            .into_iter()
            .find(|skill| skill.id == id && skill.is_available())
            .ok_or_else(|| {
                format!("The skill {id} is turned off. Enable it in Settings, AI, Skills.")
            })
    }
}

impl SkillSource for AppSkills {
    fn list(&self, project_id: &str) -> Result<Vec<Value>, String> {
        Ok(self
            .records(project_id)?
            .iter()
            .map(crate::skills::skill_tool_summary)
            .collect())
    }

    fn load(&self, project_id: &str, id: &str) -> Result<Value, String> {
        let skill = self.enabled(project_id, id)?;
        Ok(crate::skills::skill_tool_payload(&skill))
    }

    fn read_file(&self, project_id: &str, id: &str, path: &str) -> Result<Value, String> {
        let skill = self.enabled(project_id, id)?;
        let file = crate::skills::read_skill_file(&self.root, &skill.id, path)?;
        Ok(json!({"path": file.path, "content": file.content, "truncated": file.truncated}))
    }
}

/// Linked folders resolved through the research workspace's checks.
struct AppLinkedRoots;

impl LinkedRoots for AppLinkedRoots {
    fn resolve(&self, project_id: &str, root_id: &str) -> Result<PathBuf, String> {
        crate::research_workspace::roots::resolve_root_path(
            project_id,
            root_id,
            "",
            crate::research_workspace::ResearchRootOperation::Read,
            crate::research_workspace::ResearchRootConsumer::Task,
            false,
        )
    }
}

#[cfg(test)]
mod tests;
