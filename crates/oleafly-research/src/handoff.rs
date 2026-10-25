//! 0.4.8 L: moving a running research task between the app and the
//! background helper. A handoff re-queues the task for the other side
//! (E's `PendingStart::Resume { reason: Handoff }`) and records how the next
//! generation continues: the saved conversation, an interrupted turn, a CLI
//! agent's session and home, and (for the helper) a grant of the facts only
//! the app can compute.
//!
//! A record never holds credentials. The grant has no key fields, a CLI
//! agent's launch carries only its hand-off variables, and MCP values are
//! rebuilt by whoever runs the task from its own settings.
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::host::OwnerKind;
use crate::mcp::LinkedRootInfo;

/// The `handoff_json` schema this version writes and reads.
pub const HANDOFF_VERSION: u32 = 1;

/// Why a task changed owner.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HandoffReason {
    /// The app quit; the helper continues.
    Quit,
    /// The app restarts; the next launch continues.
    Restart,
    /// An update installs; the updated app continues.
    Update,
    /// Background tasks were turned off; the next launch continues.
    BackgroundOff,
    /// The helper was asked to stop; the app continues.
    Stop,
    /// The app opened and took its task back.
    Reclaim,
    /// The helper got a terminate signal; the next helper continues.
    Signal,
    /// The previous owner stopped without handing over (a crash).
    Recovered,
}

/// How the next owner of a task continues it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffRecord {
    pub version: u32,
    pub from: OwnerKind,
    pub to: OwnerKind,
    pub reason: HandoffReason,
    /// The generation that handed the task over.
    pub from_generation: u64,
    /// The saved conversation: a file name under
    /// `<tasks root>/workspaces/<task>/`.
    #[serde(default)]
    pub conversation: Option<String>,
    /// The previous owner stopped in the middle of a turn.
    #[serde(default)]
    pub turn_interrupted: bool,
    /// A CLI agent's own session and its home folder.
    #[serde(default)]
    pub acp: Option<AcpHandoff>,
    /// What the app checked for the helper (set when `to` is the helper).
    #[serde(default)]
    pub grant: Option<TaskGrant>,
    pub created_at: i64,
}

impl HandoffRecord {
    pub fn new(
        from: OwnerKind,
        to: OwnerKind,
        reason: HandoffReason,
        from_generation: u64,
    ) -> Self {
        Self {
            version: HANDOFF_VERSION,
            from,
            to,
            reason,
            from_generation,
            conversation: None,
            turn_interrupted: false,
            acp: None,
            grant: None,
            created_at: crate::model::now_ms(),
        }
    }
}

/// A linked research folder as a grant records it.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantedRoot {
    pub id: String,
    pub label: String,
    pub role: String,
    pub canonical_path: String,
}

impl From<&LinkedRootInfo> for GrantedRoot {
    fn from(root: &LinkedRootInfo) -> Self {
        Self {
            id: root.id.clone(),
            label: root.label.clone(),
            role: root.role.clone(),
            canonical_path: root.canonical_path.clone(),
        }
    }
}

impl From<&GrantedRoot> for LinkedRootInfo {
    fn from(root: &GrantedRoot) -> Self {
        Self {
            id: root.id.clone(),
            label: root.label.clone(),
            role: root.role.clone(),
            canonical_path: root.canonical_path.clone(),
        }
    }
}

/// Facts only the app can compute, checked when it hands a task to the
/// helper. The helper's hosts answer from them; a grant that no longer
/// matches the disk fails the task with a clear message.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TaskGrant {
    /// The project folder as the app located it.
    pub project_root: String,
    pub linked: bool,
    /// Trust codes the app checked: `trust.research_tasks`, `trust.agents`,
    /// `trust.mcp`.
    pub capabilities: Vec<String>,
    pub linked_roots: Vec<GrantedRoot>,
    /// The model's metadata entry (context window, prices).
    pub model_metadata: Option<Value>,
    /// What the task's model calls cost before the handoff.
    pub spent_usd: Option<f64>,
    /// The bundled skills folder of the app that handed over.
    pub skills_pack_root: Option<String>,
    /// Skill ids the user turned off.
    pub disabled_skills: Vec<String>,
    /// A CLI-agent task's sandboxed launch and permission rules.
    pub acp: Option<AcpGrant>,
}

/// The trust code a grant lists for research tasks.
pub const TRUST_RESEARCH_TASKS: &str = "trust.research_tasks";
/// The trust code a grant lists for CLI agents.
pub const TRUST_AGENTS: &str = "trust.agents";
/// The trust code a grant lists for MCP servers.
pub const TRUST_MCP: &str = "trust.mcp";

impl TaskGrant {
    pub fn allows(&self, capability: &str) -> bool {
        self.capabilities
            .iter()
            .any(|granted| granted == capability)
    }

    pub fn linked_root_infos(&self) -> Vec<LinkedRootInfo> {
        self.linked_roots.iter().map(LinkedRootInfo::from).collect()
    }
}

/// How the helper starts a task's CLI agent and answers its requests.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpGrant {
    pub agent_id: String,
    pub launch: AcpLaunch,
    /// Request kinds the project's rules refuse (`execute`, `edit`, …).
    #[serde(default)]
    pub refused_kinds: Vec<String>,
    /// Refuse kinds no rule covers (a deny rule exists, or the rules file
    /// could not be read).
    #[serde(default)]
    pub refuse_unlisted: bool,
}

/// The agent's sandboxed command as data. The sandbox clears the
/// environment, so the helper rebuilds the command from the spec itself.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpLaunch {
    /// `home` is the agent's retained home folder.
    pub sandbox: oleafly_sandbox::SandboxSpec,
    pub program: PathBuf,
    #[serde(default)]
    pub args: Vec<String>,
}

/// A CLI agent's session as the next owner resumes it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpHandoff {
    /// The agent's own session id (not Oleafly's record id).
    pub agent_session_id: String,
    /// The home folder the agent keeps its session history in.
    pub home: PathBuf,
}

/// `<tasks root>/workspaces/<task>/acp-home-<generation>`.
pub fn acp_home_path(tasks_root: &Path, task_id: &str, generation: u64) -> PathBuf {
    crate::isolation::task_workspace_root(tasks_root, task_id)
        .join(format!("acp-home-{generation}"))
}

/// Whether a name in a task's workspace folder is a conversation snapshot
/// or an agent home (never a generation's workspace).
pub fn is_handoff_file_name(name: &str) -> bool {
    name.ends_with("-conversation.json") || name.starts_with("acp-home-")
}

/// Removes every saved conversation and agent home of a task. Errors are
/// ignored: a later purge or the task's deletion tries again.
pub fn purge_files(tasks_root: &Path, task_id: &str) {
    let Ok(entries) = std::fs::read_dir(crate::isolation::task_workspace_root(tasks_root, task_id))
    else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !is_handoff_file_name(name) {
            continue;
        }
        let path = entry.path();
        match std::fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
                let _ = std::fs::remove_dir_all(&path);
            }
            Ok(_) => {
                let _ = std::fs::remove_file(&path);
            }
            Err(_) => {}
        }
    }
}

/// How much work a process owns.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnedWork {
    pub running: usize,
    pub queued: usize,
}

impl OwnedWork {
    pub fn is_empty(self) -> bool {
        self.running == 0 && self.queued == 0
    }
}

/// What the other process asked of the tasks this one runs.
#[derive(Debug, Default, PartialEq)]
pub struct ForeignRequests {
    /// Tasks the user cancelled in the app.
    pub cancel: Vec<String>,
    /// Tasks the app wants back, with the generation running now.
    pub reclaim: Vec<(String, u64)>,
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    fn grant() -> TaskGrant {
        let mut sandbox = oleafly_sandbox::SandboxSpec::new(
            "task:t1",
            PathBuf::from("/d/research-tasks/workspaces/t1/1"),
            PathBuf::from("/d/research-tasks/workspaces/t1/acp-home-1"),
        );
        sandbox.env = BTreeMap::from([(
            "CLAUDE_CODE_EXECUTABLE".to_string(),
            "/usr/local/bin/claude".to_string(),
        )]);
        TaskGrant {
            project_root: "/home/ada/paper".into(),
            linked: false,
            capabilities: vec![TRUST_RESEARCH_TASKS.into(), TRUST_AGENTS.into()],
            linked_roots: vec![GrantedRoot {
                id: "root-1".into(),
                label: "Data".into(),
                role: "data".into(),
                canonical_path: "/data/set".into(),
            }],
            model_metadata: Some(
                serde_json::json!({"contextWindow": 200000, "cost": {"input": 3.0, "output": 15.0}}),
            ),
            spent_usd: Some(1.5),
            skills_pack_root: Some(
                "/Applications/Oleafly.app/Contents/Resources/resources/skills".into(),
            ),
            disabled_skills: vec!["slides".into()],
            acp: Some(AcpGrant {
                agent_id: "claude".into(),
                launch: AcpLaunch {
                    sandbox,
                    program: PathBuf::from("/usr/local/bin/node"),
                    args: vec!["/opt/claude-agent-acp/dist/index.js".into()],
                },
                refused_kinds: vec!["execute".into()],
                refuse_unlisted: false,
            }),
        }
    }

    #[test]
    fn handoff_records_round_trip_and_hold_no_credentials() {
        let mut record =
            HandoffRecord::new(OwnerKind::App, OwnerKind::Daemon, HandoffReason::Quit, 4);
        record.conversation = Some("4-conversation.json".into());
        record.acp = Some(AcpHandoff {
            agent_session_id: "agent-session-9".into(),
            home: PathBuf::from("/d/research-tasks/workspaces/t1/acp-home-4"),
        });
        record.grant = Some(grant());
        let text = serde_json::to_string(&record).unwrap();
        assert_eq!(
            serde_json::from_str::<HandoffRecord>(&text).unwrap(),
            record
        );
        for secret in [
            "sk-",
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "Authorization",
            "Bearer",
        ] {
            assert!(!text.contains(secret), "{secret} in {text}");
        }
    }

    #[test]
    fn a_record_from_before_new_fields_reads_with_defaults() {
        let record: HandoffRecord = serde_json::from_str(
            r#"{"version":1,"from":"app","to":"daemon","reason":"quit","fromGeneration":2,"createdAt":5}"#,
        )
        .unwrap();
        assert_eq!(record.conversation, None);
        assert!(!record.turn_interrupted);
        assert!(record.grant.is_none());
    }

    #[test]
    fn acp_homes_and_snapshots_sit_beside_the_generations() {
        assert_eq!(
            acp_home_path(Path::new("/d/research-tasks"), "t1", 4),
            Path::new("/d/research-tasks/workspaces/t1/acp-home-4")
        );
        assert!(is_handoff_file_name("3-conversation.json"));
        assert!(is_handoff_file_name("acp-home-3"));
        assert!(!is_handoff_file_name("3"));
        assert!(!is_handoff_file_name("3-baseline"));
    }

    #[test]
    fn purging_removes_snapshots_and_homes_but_keeps_workspaces() {
        let temp = tempfile::tempdir().unwrap();
        let task_root = crate::isolation::task_workspace_root(temp.path(), "t1");
        std::fs::create_dir_all(task_root.join("2")).unwrap();
        std::fs::create_dir_all(task_root.join("2-baseline")).unwrap();
        std::fs::create_dir_all(task_root.join("acp-home-2/.claude/projects")).unwrap();
        std::fs::write(task_root.join("2-conversation.json"), "{}").unwrap();
        purge_files(temp.path(), "t1");
        assert!(task_root.join("2").is_dir());
        assert!(task_root.join("2-baseline").is_dir());
        assert!(!task_root.join("acp-home-2").exists());
        assert!(!task_root.join("2-conversation.json").exists());
        // A task without a folder is not an error.
        purge_files(temp.path(), "missing");
    }

    #[test]
    fn grants_answer_trust_by_code() {
        let grant = grant();
        assert!(grant.allows(TRUST_RESEARCH_TASKS));
        assert!(!grant.allows(TRUST_MCP));
        assert_eq!(grant.linked_root_infos()[0].canonical_path, "/data/set");
    }
}
