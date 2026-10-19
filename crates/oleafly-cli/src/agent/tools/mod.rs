//! The headless agent's tools. Names match the app's assistant and research
//! tasks, so skills read the same. What a run is offered follows `--allow`:
//! reading always, writing and building with `write`, shell commands with
//! `commands`, literature, citations and the web with `network`.
//!
//! Some pieces are ports the background helper shares: [`CliSkills`],
//! [`StoreSecrets`] and [`CliWorkspaceTools`].
pub mod build;
pub mod cite;
pub mod command;
pub mod context;
pub mod files;
pub mod skills;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use oleafly_agent::tools::web::{
    web_fetch_schema, web_search_schema, WEB_FETCH_TOOL, WEB_SEARCH_TOOL,
};
use oleafly_agent::{
    native_web, CancellationToken, CompletionRequest, Resolved, ToolCall, ToolOutput, ToolRunner,
    ToolSchema,
};
use serde_json::{json, Value};

pub use build::CliWorkspaceTools;
pub use cite::StoreSecrets;
pub(crate) use command::command_env;
pub use skills::{skill_prompt, CliSkills, SkillAudience};

use super::desktop_config::DesktopConfig;
use super::events::RunEvent;
use super::mcp::{McpHub, McpToolSpec};
use super::policy::{Allow, RunPolicy};
use super::workspace::AgentWorkspace;

pub type EventSink = Arc<dyn Fn(RunEvent) + Send + Sync>;

/// One native tool and what it needs.
pub struct ToolSpec {
    pub name: &'static str,
    pub needs: Allow,
    /// Changes files (refused in a read-only run).
    pub writes: bool,
    pub schema: ToolSchema,
}

/// What a build in the run left, for `get_build_log`.
#[derive(Clone, Debug, Default)]
pub struct LastBuild {
    pub ok: bool,
    pub log: String,
}

/// Everything a tool call of one run uses.
pub struct ToolContext {
    pub workspace: Arc<AgentWorkspace>,
    pub policy: RunPolicy,
    pub config: Arc<DesktopConfig>,
    pub data_root: Option<PathBuf>,
    /// The app's id of the project, when the app knows it.
    pub project_id: Option<String>,
    pub run_id: String,
    pub mcp: Option<Arc<McpHub>>,
    pub cancel: CancellationToken,
    pub events: EventSink,
    pub last_build: Mutex<Option<LastBuild>>,
    pub warned_unsandboxed: AtomicBool,
    pub skills: Arc<CliSkills>,
    /// Folders commands may read besides the run's folder (selected skills).
    pub read_paths: Vec<PathBuf>,
    pub secrets: Arc<StoreSecrets>,
    /// Tool calls so far.
    pub calls: AtomicU32,
    /// Warnings for the result (`code`, message), taken by the driver.
    pub warnings: Mutex<Vec<(&'static str, String)>>,
}

impl ToolContext {
    pub(crate) fn warn_once(&self, flag: &AtomicBool, code: &'static str, message: &str) {
        if !flag.swap(true, Ordering::AcqRel) {
            lock(&self.warnings).push((code, message.to_string()));
        }
    }

    /// The warnings recorded since the last call.
    pub fn take_warnings(&self) -> Vec<(&'static str, String)> {
        std::mem::take(&mut *lock(&self.warnings))
    }
}

pub(crate) fn lock<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    value
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub(crate) fn schema(
    name: &str,
    description: &str,
    properties: Value,
    required: &[&str],
) -> ToolSchema {
    ToolSchema {
        name: name.to_string(),
        description: description.to_string(),
        input_schema: json!({
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": false,
        }),
    }
}

/// The native tools a run with `policy` is offered, sorted by name.
pub fn native_tools(policy: &RunPolicy) -> Vec<ToolSpec> {
    let mut tools: Vec<ToolSpec> = files::specs()
        .into_iter()
        .chain(build::specs())
        .chain(context::specs())
        .chain(skills::specs())
        .chain(command::specs())
        .chain(cite::specs())
        .filter(|tool| policy.allow.allows(tool.needs))
        .filter(|tool| !tool.writes || policy.allow.write)
        .collect();
    tools.sort_by(|left, right| left.name.cmp(right.name));
    tools
}

/// The text a tool result carries.
fn tool_output(result: Result<Value, String>) -> ToolOutput {
    ToolOutput::text(match result {
        Ok(value) => value.to_string(),
        Err(error) => json!({"error": error}).to_string(),
    })
}

/// Runs one call of a native tool.
async fn dispatch(ctx: &Arc<ToolContext>, name: &str, arguments: Value) -> Result<Value, String> {
    if ctx.cancel.is_cancelled() {
        return Err("The run was stopped.".into());
    }
    match name {
        "list_files" | "read_file" | "search_project" | "write_file" | "edit_file"
        | "delete_file" => files::call(ctx.clone(), name.to_string(), arguments).await,
        "compile" => build::compile(ctx).await,
        "get_build_log" => build::build_log(ctx.clone(), arguments).await,
        "project_context" => context::project_context(ctx.clone()).await,
        "list_skills" | "load_skill" | "read_skill_file" => {
            skills::call(ctx.clone(), name.to_string(), arguments).await
        }
        "run_command" => command::call(ctx, arguments).await,
        _ if cite::handles(name) => cite::call(ctx, name, arguments).await,
        _ => Err(format!("The tool {name} is not available in this run.")),
    }
}

/// The run's tool runner: native tools, then the user's MCP tools. A tool
/// the run was not offered is refused.
pub fn runner(
    ctx: Arc<ToolContext>,
    tools: Arc<Vec<ToolSpec>>,
    mcp_tools: Arc<Vec<McpToolSpec>>,
) -> ToolRunner {
    Arc::new(move |call: ToolCall| {
        let ctx = ctx.clone();
        let tools = tools.clone();
        let mcp_tools = mcp_tools.clone();
        Box::pin(async move {
            ctx.calls.fetch_add(1, Ordering::AcqRel);
            (ctx.events)(RunEvent::ToolCall {
                id: call.id.clone(),
                name: call.name.clone(),
                arguments: call.arguments.clone(),
            });
            let arguments = if call.arguments.trim().is_empty() {
                Ok(json!({}))
            } else {
                serde_json::from_str::<Value>(&call.arguments)
            };
            let output = match arguments {
                Err(_) => ToolOutput::text(
                    json!({"error": "Tool arguments must be valid JSON."}).to_string(),
                ),
                Ok(arguments) if tools.iter().any(|tool| tool.name == call.name) => {
                    tool_output(dispatch(&ctx, &call.name, arguments).await)
                }
                Ok(arguments) if mcp_tools.iter().any(|tool| tool.agent_name == call.name) => {
                    match &ctx.mcp {
                        Some(hub) => tool_output(
                            hub.call(&call.name, arguments, &ctx.cancel)
                                .await
                                .map(Value::String),
                        ),
                        None => tool_output(Err(format!(
                            "The tool {} is not available in this run.",
                            call.name
                        ))),
                    }
                }
                Ok(_) => tool_output(Err(format!(
                    "The tool {} is not available in this run.",
                    call.name
                ))),
            };
            let output = oleafly_agent::bound_tool_output(output);
            let failed = output.output.starts_with("{\"error\"");
            (ctx.events)(RunEvent::ToolResult {
                id: call.id.clone(),
                status: if failed { "error" } else { "ok" },
                bytes: output.output.len(),
            });
            output
        })
    })
}

/// The app's `User-Agent` for web reads, with this CLI's version.
pub(crate) fn web_user_agent() -> String {
    format!(
        "Oleafly/{} (+https://oleafly.com)",
        crate::version::APP_VERSION
    )
}

/// The local web tools a run needs on this model (those its provider does
/// not run itself), the app's rule: fetch always, search only with a key.
/// Returns whether web search is unavailable.
pub fn add_local_web_tools(
    request: &mut CompletionRequest,
    resolved: &Resolved,
    has_search_key: bool,
) -> bool {
    let Some(web) = request.web.filter(|web| web.any()) else {
        return false;
    };
    let native = native_web(
        &resolved.provider_id,
        &resolved.wire,
        &resolved.model_id,
        Some(web),
    );
    let has = |request: &CompletionRequest, name: &str| {
        request.tools.iter().any(|tool| tool.name == name)
    };
    let mut search_unavailable = false;
    if web.search && !native.search {
        if has_search_key {
            if !has(request, WEB_SEARCH_TOOL) {
                request.tools.push(web_search_schema());
            }
        } else {
            search_unavailable = true;
        }
    }
    if web.fetch && !native.fetch && !has(request, WEB_FETCH_TOOL) {
        request.tools.push(web_fetch_schema());
    }
    search_unavailable
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use crate::agent::policy::{AllowSet, WriteMode};
    use crate::agent::workspace::STAGE_LIMITS;

    pub fn policy(mode: WriteMode, allow: AllowSet, question: bool) -> RunPolicy {
        RunPolicy {
            allow,
            mode,
            question,
        }
    }

    pub fn ask_policy() -> RunPolicy {
        policy(WriteMode::ReadOnly, AllowSet::default(), true)
    }

    /// A tool context over `project` with `policy` and no MCP servers.
    pub fn context(project: &std::path::Path, policy: RunPolicy) -> Arc<ToolContext> {
        let workspace =
            AgentWorkspace::open(project, &policy, &STAGE_LIMITS, &CancellationToken::new())
                .unwrap();
        Arc::new(ToolContext {
            workspace: Arc::new(workspace),
            policy,
            config: Arc::new(DesktopConfig::empty()),
            data_root: None,
            project_id: None,
            run_id: "1792000000000-00ab".into(),
            mcp: None,
            cancel: CancellationToken::new(),
            events: Arc::new(|_| {}),
            last_build: Mutex::new(None),
            warned_unsandboxed: AtomicBool::new(false),
            skills: Arc::new(CliSkills::empty()),
            read_paths: Vec::new(),
            secrets: Arc::new(StoreSecrets::default()),
            calls: AtomicU32::new(0),
            warnings: Mutex::new(Vec::new()),
        })
    }

    /// Tests that change the process environment hold this.
    pub static ENV_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    /// Variables set for a test and put back when it ends.
    pub struct Environment {
        saved: Vec<(String, Option<std::ffi::OsString>)>,
        _lock: tokio::sync::MutexGuard<'static, ()>,
    }

    impl Environment {
        pub async fn set(values: &[(&str, Option<&std::ffi::OsStr>)]) -> Self {
            let lock = ENV_LOCK.lock().await;
            let mut saved = Vec::new();
            for (name, value) in values {
                saved.push((name.to_string(), std::env::var_os(name)));
                match value {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
            Self { saved, _lock: lock }
        }
    }

    impl Drop for Environment {
        fn drop(&mut self) {
            for (name, value) in self.saved.drain(..) {
                match value {
                    Some(value) => std::env::set_var(&name, value),
                    None => std::env::remove_var(&name),
                }
            }
        }
    }

    pub fn call(name: &str, arguments: &str) -> ToolCall {
        ToolCall {
            id: "call-1".into(),
            name: name.into(),
            arguments: arguments.into(),
            thought_signature: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;
    use crate::agent::policy::{AllowSet, WriteMode};

    fn names(tools: Vec<ToolSpec>) -> Vec<&'static str> {
        let mut names: Vec<&'static str> = tools.iter().map(|tool| tool.name).collect();
        names.sort_unstable();
        names
    }

    #[test]
    fn read_only_runs_offer_only_read_tools() {
        assert_eq!(
            names(native_tools(&ask_policy())),
            [
                "get_build_log",
                "list_files",
                "list_skills",
                "load_skill",
                "project_context",
                "read_file",
                "read_skill_file",
                "search_project"
            ]
        );
    }

    #[test]
    fn write_adds_the_file_and_build_tools() {
        let write = policy(
            WriteMode::Apply,
            AllowSet {
                write: true,
                ..AllowSet::default()
            },
            false,
        );
        let tools = names(native_tools(&write));
        for name in ["write_file", "edit_file", "delete_file", "compile"] {
            assert!(tools.contains(&name), "{name}");
        }
        assert!(!tools.contains(&"run_command") && !tools.contains(&"crossref_search"));
    }

    #[test]
    fn network_adds_the_citation_tools() {
        let network = policy(
            WriteMode::ReadOnly,
            AllowSet {
                network: true,
                ..AllowSet::default()
            },
            true,
        );
        let tools = names(native_tools(&network));
        for name in [
            "crossref_search",
            "literature_search",
            "fetch_doi_bibtex",
            "fetch_arxiv",
            "literature_arxiv_lookup",
        ] {
            assert!(tools.contains(&name), "{name}");
        }
        assert!(!tools.contains(&"write_file"));
    }

    #[test]
    fn commands_add_run_command() {
        let commands = policy(
            WriteMode::Apply,
            AllowSet {
                write: true,
                commands: true,
                ..AllowSet::default()
            },
            false,
        );
        assert!(names(native_tools(&commands)).contains(&"run_command"));
    }

    #[tokio::test]
    async fn the_runner_refuses_a_tool_that_was_not_offered() {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("main.tex"), "x").unwrap();
        let ctx = context(project.path(), ask_policy());
        let tools = Arc::new(native_tools(&ctx.policy));
        let run = runner(ctx.clone(), tools, Arc::new(Vec::new()));
        let output = run(call("write_file", r#"{"path":"a","content":"b"}"#)).await;
        assert!(
            output.output.contains("not available in this run"),
            "{}",
            output.output
        );
        assert!(!project.path().join("a").exists());
        let output = run(call("read_file", "{not json")).await;
        assert!(output.output.contains("valid JSON"));
        let output = run(call("read_file", r#"{"path":"main.tex"}"#)).await;
        assert!(
            output.output.contains("\"content\":\"x\""),
            "{}",
            output.output
        );
        assert_eq!(ctx.calls.load(Ordering::Acquire), 3);
    }

    #[test]
    fn hosted_web_tools_replace_local_schemas() {
        use oleafly_agent::provider::{resolve_for_probe, ProviderConfig};
        let mut config = ProviderConfig::default();
        config.keys.insert("anthropic".into(), "test-key".into());
        let mut native = CompletionRequest {
            web: Some(oleafly_agent::WebTools {
                search: true,
                fetch: true,
            }),
            ..CompletionRequest::default()
        };
        let anthropic = resolve_for_probe(&config, "anthropic", "claude-fable-5").unwrap();
        add_local_web_tools(&mut native, &anthropic, false);
        assert!(
            native.tools.is_empty(),
            "{:?}",
            native
                .tools
                .iter()
                .map(|tool| &tool.name)
                .collect::<Vec<_>>()
        );

        let custom = Resolved {
            provider_id: "mock".into(),
            model_id: "mock-model".into(),
            credential: String::new(),
            auth: None,
            wire: oleafly_agent::Wire::OpenAiChat {
                base_url: "http://127.0.0.1:9/v1".into(),
                reasoning_content: false,
            },
            caps: oleafly_agent::ModelCaps::default(),
        };
        let mut local = CompletionRequest {
            web: Some(oleafly_agent::WebTools {
                search: true,
                fetch: true,
            }),
            ..CompletionRequest::default()
        };
        assert!(add_local_web_tools(&mut local, &custom, false));
        assert_eq!(
            local
                .tools
                .iter()
                .map(|tool| tool.name.as_str())
                .collect::<Vec<_>>(),
            ["web_fetch"]
        );
        let mut keyed = CompletionRequest {
            web: Some(oleafly_agent::WebTools {
                search: true,
                fetch: true,
            }),
            ..CompletionRequest::default()
        };
        assert!(!add_local_web_tools(&mut keyed, &custom, true));
        assert_eq!(keyed.tools.len(), 2);
    }

    #[test]
    fn the_user_agent_names_oleafly_and_its_version() {
        let agent = web_user_agent();
        assert!(agent.starts_with("Oleafly/") && agent.ends_with("(+https://oleafly.com)"));
    }
}
