//! A headless run from the command line to one result: the prompt, the
//! policy, the provider, the workspace, the user's MCP servers and skills,
//! the agent loop, then the changes, the usage record and the report.
//!
//! Every string a run prints (text, tool lines, events, errors, the result)
//! passes through the redactor first: provider keys, MCP values and
//! connector keys never reach the terminal.
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use aho_corasick::{AhoCorasick, AhoCorasickBuilder, MatchKind};
use oleafly_agent::tools::web::{web_tool_runner, WebToolContext, WEB_FETCH_TOOL, WEB_SEARCH_TOOL};
use oleafly_agent::{
    AgentError, AgentEvent, CancellationToken, CompletionRequest, Effort, Message, RunConfig,
    RunOutcome, ToolPipeline, Usage, WebTools,
};
use serde::Serialize;
use serde_json::{json, Value};

use super::desktop_config::{self, search_key_from, secret_values, DesktopConfig};
use super::events::RunEvent;
use super::mcp::{McpHub, McpSelection};
use super::policy::{policy, AllowSet, PolicyRequest, RunPolicy, WriteMode};
use super::prompt::{system_prompt, PromptContext};
use super::provider::{
    all_key_variables, effort_from_arg, resolve, ProviderChoice, ResolvedProvider,
};
use super::tools::command::OwnerRelease;
use super::tools::{
    add_local_web_tools, native_tools, runner, skill_prompt, web_user_agent, CliSkills, EventSink,
    SkillAudience, StoreSecrets, ToolContext,
};
use super::usage_spool::{self, UsageSpoolEvent};
use super::workspace::{apply_review, AgentWorkspace, FileChange, STAGE_LIMITS};
use super::{AgentApplyArgs, AgentRunArgs, AskArgs, ModelArgs};
use crate::contract::{CliError, Context, ErrorKind, Exit, Outcome};
use crate::engine::{open_project, ProjectOrigin};

/// A prompt read from stdin or a file, at most.
const MAX_PROMPT_BYTES: usize = 1 << 20;
/// How long the end of a run waits for a tool that is still running.
const FINISH_WAIT: Duration = Duration::from_secs(10);
/// Streamed text is held back until a space (so a key split across two
/// pieces is still found), but never more than this.
const MAX_HELD_TEXT: usize = 8 * 1024;
const HELD_TAIL: usize = 512;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StopKind {
    EndTurn,
    StepLimit,
    Timeout,
    Interrupted,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cached_read_tokens: Option<u64>,
    pub cached_write_tokens: Option<u64>,
    pub cost_usd: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunReport {
    pub run_id: String,
    /// `read`, `review` or `apply`.
    pub mode: &'static str,
    pub review_dir: Option<PathBuf>,
    pub provider: String,
    pub model: String,
    /// `store`, `env:<VARIABLE>` or `none`.
    pub credential_source: String,
    pub stop_reason: StopKind,
    pub steps: u32,
    pub tool_calls: u32,
    pub text: String,
    pub changes: Vec<FileChange>,
    pub usage: UsageSummary,
}

/// Everything a run was asked for.
pub struct AgentRunRequest {
    pub prompt: String,
    pub allow: AllowSet,
    pub apply: bool,
    pub review_dir: Option<PathBuf>,
    /// `oleafly ask`.
    pub question: bool,
    pub choice: ProviderChoice,
    pub max_steps: u32,
    pub timeout: Duration,
    pub skills: Vec<String>,
    pub mcp: McpSelection,
    pub keep_workspace: bool,
    pub run_id: String,
}

/// Replaces every occurrence of a secret with `[redacted]`.
pub struct Redactor {
    matcher: Option<AhoCorasick>,
}

impl Redactor {
    pub fn new(secrets: &[String]) -> Self {
        let mut values: Vec<&str> = secrets
            .iter()
            .map(String::as_str)
            .filter(|value| !value.is_empty())
            .collect();
        values.sort_unstable();
        values.dedup();
        let matcher = (!values.is_empty())
            .then(|| {
                AhoCorasickBuilder::new()
                    .match_kind(MatchKind::LeftmostLongest)
                    .build(&values)
                    .ok()
            })
            .flatten();
        Self { matcher }
    }

    pub fn text(&self, text: &str) -> String {
        let Some(matcher) = &self.matcher else {
            return text.to_string();
        };
        let mut redacted = String::with_capacity(text.len());
        let mut copied = 0;
        for found in matcher.find_iter(text) {
            redacted.push_str(&text[copied..found.start()]);
            redacted.push_str("[redacted]");
            copied = found.end();
        }
        redacted.push_str(&text[copied..]);
        redacted
    }

    fn value(&self, value: Value) -> Value {
        match value {
            Value::String(text) => Value::String(self.text(&text)),
            Value::Array(values) => {
                Value::Array(values.into_iter().map(|value| self.value(value)).collect())
            }
            Value::Object(values) => Value::Object(
                values
                    .into_iter()
                    .map(|(key, value)| (key, self.value(value)))
                    .collect(),
            ),
            other => other,
        }
    }
}

/// `text` with every secret in `secrets` replaced by `[redacted]`.
pub fn redact(text: &str, secrets: &[String]) -> String {
    Redactor::new(secrets).text(text)
}

fn now_ms() -> i64 {
    i64::try_from(crate::record::now_ms()).unwrap_or(i64::MAX)
}

/// `<epoch ms>-<4 hex>`.
pub fn new_run_id() -> String {
    format!("{}-{:04x}", crate::record::now_ms(), rand::random::<u16>())
}

fn prompt_error() -> CliError {
    CliError::usage("Give a prompt, or pass - to read it from stdin.")
}

fn bounded_read(mut reader: impl Read, what: &str) -> Result<String, CliError> {
    let mut bytes = Vec::new();
    reader
        .by_ref()
        .take(MAX_PROMPT_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            CliError::new(
                ErrorKind::InvalidInput,
                "agent.prompt_unreadable",
                format!("The prompt could not be read from {what}: {error}"),
            )
        })?;
    if bytes.len() > MAX_PROMPT_BYTES {
        return Err(CliError::new(
            ErrorKind::InvalidInput,
            "agent.prompt_too_large",
            "The prompt is larger than 1 MiB.",
        ));
    }
    String::from_utf8(bytes).map_err(|_| {
        CliError::new(
            ErrorKind::InvalidInput,
            "agent.prompt_unreadable",
            format!("The prompt in {what} isn't UTF-8 text."),
        )
    })
}

/// The prompt from the argument, stdin (`-`) or a file.
async fn read_prompt(inline: Option<String>, file: Option<PathBuf>) -> Result<String, CliError> {
    let prompt = match (inline, file) {
        (Some(dash), _) if dash == "-" => {
            tokio::task::spawn_blocking(|| bounded_read(std::io::stdin().lock(), "stdin"))
                .await
                .map_err(|_| prompt_error())??
        }
        (Some(text), _) => text,
        (None, Some(path)) => {
            let what = path.display().to_string();
            tokio::task::spawn_blocking(move || {
                let file = std::fs::File::open(&path).map_err(|error| {
                    CliError::new(
                        ErrorKind::InvalidInput,
                        "agent.prompt_unreadable",
                        format!("{what} could not be opened: {error}"),
                    )
                })?;
                bounded_read(file, &what)
            })
            .await
            .map_err(|_| prompt_error())??
        }
        (None, None) => return Err(prompt_error()),
    };
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        return Err(prompt_error());
    }
    Ok(prompt)
}

fn choice(model: &ModelArgs) -> ProviderChoice {
    ProviderChoice {
        provider: model.provider.clone(),
        model: model.model.clone(),
        effort: effort_from_arg(model.effort),
    }
}

fn env_lookup(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

/// `oleafly agent run`.
pub async fn agent_run(ctx: &Context, args: AgentRunArgs) -> Result<Outcome, CliError> {
    let prompt = read_prompt(args.prompt, args.prompt_file).await?;
    let mcp = if args.no_mcp {
        McpSelection::None
    } else if args.mcp.is_empty() {
        McpSelection::All
    } else {
        McpSelection::Named(args.mcp)
    };
    let request = AgentRunRequest {
        prompt,
        allow: AllowSet::parse(&args.allow),
        apply: args.apply,
        review_dir: args.review_dir,
        question: false,
        choice: choice(&args.model),
        max_steps: args.max_steps,
        timeout: Duration::from_secs(args.timeout_seconds),
        skills: args.skills,
        mcp,
        keep_workspace: args.keep_workspace,
        run_id: new_run_id(),
    };
    execute(ctx, request, &env_lookup).await
}

/// `oleafly ask`.
pub async fn ask(ctx: &Context, args: AskArgs) -> Result<Outcome, CliError> {
    let prompt = read_prompt(args.question, None).await?;
    let request = AgentRunRequest {
        prompt,
        allow: AllowSet::parse(&args.allow),
        apply: false,
        review_dir: None,
        question: true,
        choice: choice(&args.model),
        max_steps: args.max_steps,
        timeout: Duration::from_secs(args.timeout_seconds),
        skills: Vec::new(),
        mcp: if args.no_mcp {
            McpSelection::None
        } else {
            McpSelection::All
        },
        keep_workspace: false,
        run_id: new_run_id(),
    };
    execute(ctx, request, &env_lookup).await
}

fn project_folder(ctx: &Context) -> Result<PathBuf, CliError> {
    let path = ctx.project();
    match dunce::canonicalize(path) {
        Ok(real) if real.is_dir() => Ok(real),
        _ => Err(CliError::new(
            ErrorKind::InvalidInput,
            "project.not_found",
            format!("{} isn't a folder.", path.display()),
        )
        .hint("Run this in your project folder, or point -C at it.")),
    }
}

/// `oleafly agent apply`.
pub async fn agent_apply(ctx: &Context, args: AgentApplyArgs) -> Result<Outcome, CliError> {
    let project = project_folder(ctx)?;
    let review = args.review_dir.clone();
    let dry_run = args.dry_run;
    let changes = tokio::task::spawn_blocking(move || apply_review(&review, &project, dry_run))
        .await
        .map_err(|_| CliError::internal("The review could not be applied."))??;
    if !ctx.quiet() {
        let count = changes.len();
        let noun = if count == 1 { "change" } else { "changes" };
        if dry_run {
            ctx.say(format!("Would apply {count} {noun}:"));
            for change in &changes {
                ctx.say(format!("  {:?} {}", change.kind, change.path).to_lowercase());
            }
        } else {
            ctx.say(format!("Applied {count} {noun}."));
        }
    }
    Ok(Outcome::success(
        json!({"apply": {"changes": changes, "dryRun": dry_run}}),
    ))
}

/// What the agent's events said so far (the run's `Err` paths carry no
/// outcome).
#[derive(Clone, Debug, Default)]
struct Tracker {
    steps: u32,
    current_text: String,
    last_text: String,
    usage: Usage,
    usage_seen: bool,
}

impl Tracker {
    fn text(&self) -> String {
        if self.current_text.trim().is_empty() {
            self.last_text.clone()
        } else {
            self.current_text.clone()
        }
    }
}

/// Holds streamed text until a whitespace, so a secret is never split
/// between two printed pieces.
#[derive(Default)]
struct TextHold {
    pending: String,
}

impl TextHold {
    fn push(&mut self, text: &str) -> Option<String> {
        self.pending.push_str(text);
        let cut = match self.pending.rfind(char::is_whitespace) {
            Some(index) => {
                index
                    + self.pending[index..]
                        .chars()
                        .next()
                        .map_or(1, char::len_utf8)
            }
            None if self.pending.len() > MAX_HELD_TEXT => {
                let mut cut = self.pending.len() - HELD_TAIL;
                while !self.pending.is_char_boundary(cut) {
                    cut -= 1;
                }
                cut
            }
            None => return None,
        };
        let ready: String = self.pending.drain(..cut).collect();
        (!ready.is_empty()).then_some(ready)
    }

    fn flush(&mut self) -> Option<String> {
        let rest = std::mem::take(&mut self.pending);
        (!rest.is_empty()).then_some(rest)
    }
}

/// Prints a run's events: event lines with `--events`, text and tool lines
/// for people, nothing with `--json` alone.
struct Printer<'a> {
    ctx: &'a Context,
    redactor: &'a Redactor,
    text: TextHold,
    reasoning: TextHold,
    printed_text: bool,
    last_usage: (Option<u32>, Option<u32>),
}

fn tool_line(name: &str, arguments: &str) -> String {
    let parsed: Value = serde_json::from_str(arguments).unwrap_or(Value::Null);
    let detail = ["path", "command", "query", "id", "url", "doi"]
        .iter()
        .find_map(|key| parsed[*key].as_str())
        .map(|value| {
            let value: String = value
                .chars()
                .filter(|character| !character.is_control())
                .take(120)
                .collect();
            format!(" {value}")
        })
        .unwrap_or_default();
    format!("→ {name}{detail}")
}

impl<'a> Printer<'a> {
    fn new(ctx: &'a Context, redactor: &'a Redactor) -> Self {
        Self {
            ctx,
            redactor,
            text: TextHold::default(),
            reasoning: TextHold::default(),
            printed_text: false,
            last_usage: (None, None),
        }
    }

    fn event(&self, event: &RunEvent) {
        let _ = self
            .ctx
            .event(event.name(), self.redactor.value(event.fields()));
    }

    fn print_text(&mut self, text: &str) {
        let text = self.redactor.text(text);
        let mut stdout = std::io::stdout().lock();
        let _ = stdout.write_all(text.as_bytes());
        let _ = stdout.flush();
        self.printed_text = true;
    }

    fn end_text_line(&mut self) {
        if self.printed_text {
            let mut stdout = std::io::stdout().lock();
            let _ = stdout.write_all(b"\n");
            let _ = stdout.flush();
            self.printed_text = false;
        }
    }

    fn emit(&mut self, event: RunEvent) {
        match event {
            RunEvent::Text { text } => {
                if let Some(ready) = self.text.push(&text) {
                    if self.ctx.events() {
                        self.event(&RunEvent::Text { text: ready });
                    } else if !self.ctx.json() {
                        self.print_text(&ready);
                    }
                }
            }
            RunEvent::Reasoning { text } => {
                if self.ctx.events() {
                    if let Some(ready) = self.reasoning.push(&text) {
                        self.event(&RunEvent::Reasoning { text: ready });
                    }
                }
            }
            RunEvent::ToolCall {
                id,
                name,
                arguments,
            } => {
                self.flush_text();
                if self.ctx.events() {
                    self.event(&RunEvent::ToolCall {
                        id,
                        name,
                        arguments,
                    });
                } else {
                    self.end_text_line();
                    self.ctx
                        .note(self.redactor.text(&tool_line(&name, &arguments)));
                }
            }
            RunEvent::Usage {
                input_tokens,
                output_tokens,
            } => {
                if self.last_usage != (input_tokens, output_tokens) {
                    self.last_usage = (input_tokens, output_tokens);
                    self.event(&RunEvent::Usage {
                        input_tokens,
                        output_tokens,
                    });
                }
            }
            RunEvent::Step { step } => {
                self.flush_text();
                self.event(&RunEvent::Step { step });
            }
            other => self.event(&other),
        }
    }

    fn flush_text(&mut self) {
        if let Some(rest) = self.text.flush() {
            if self.ctx.events() {
                self.event(&RunEvent::Text { text: rest });
            } else if !self.ctx.json() {
                self.print_text(&rest);
            }
        }
        if let Some(rest) = self.reasoning.flush() {
            if self.ctx.events() {
                self.event(&RunEvent::Reasoning { text: rest });
            }
        }
    }

    fn finish(&mut self) {
        self.flush_text();
        self.end_text_line();
    }
}

fn usage_summary(usage: &Usage, seen: bool, cost: Option<f64>) -> UsageSummary {
    if !seen {
        return UsageSummary {
            cost_usd: cost,
            ..UsageSummary::default()
        };
    }
    UsageSummary {
        input_tokens: (usage.input_known != Some(false)).then_some(u64::from(usage.input)),
        output_tokens: (usage.output_known != Some(false)).then_some(u64::from(usage.output)),
        cached_read_tokens: usage.cache_read.map(u64::from),
        cached_write_tokens: usage.cache_write.map(u64::from),
        cost_usd: cost,
    }
}

/// The completion request a run starts with.
pub(crate) fn build_request(
    system: String,
    prompt: String,
    effort: Option<Effort>,
    network: bool,
) -> CompletionRequest {
    CompletionRequest {
        system: Some(system),
        messages: vec![Message::user(prompt)],
        effort,
        web: network.then_some(WebTools {
            search: true,
            fetch: true,
        }),
        ..CompletionRequest::default()
    }
}

/// How the run ended, or the error it ends with.
fn classify(
    result: &Result<RunOutcome, AgentError>,
    cancelled: bool,
    steps: u32,
    provider: &str,
    redactor: &Redactor,
) -> Result<StopKind, CliError> {
    let rejected = || {
        CliError::new(
            ErrorKind::Auth,
            "agent.provider_rejected_key",
            format!("{provider} rejected the API key."),
        )
        .hint("Check the key in Oleafly's settings.")
    };
    let unreachable = || {
        CliError::new(
            ErrorKind::Network,
            "agent.provider_unreachable",
            format!("Oleafly couldn't reach {provider}."),
        )
        .hint("Check your connection and try again.")
        .retryable()
    };
    let failed = |message: &str| {
        CliError::new(
            ErrorKind::Internal,
            "agent.provider_error",
            redactor.text(message),
        )
    };
    match result {
        Ok(outcome) => match outcome.error_kind.as_deref() {
            None if outcome.stopped_at_cap => Ok(StopKind::StepLimit),
            None => Ok(StopKind::EndTurn),
            Some("cancelled") => Ok(StopKind::Interrupted),
            Some(_) if cancelled => Ok(StopKind::Interrupted),
            Some("auth") => Err(rejected()),
            Some("transport" | "timeout") if outcome.steps == 0 => Err(unreachable()),
            Some(_) => Err(failed(
                outcome
                    .error
                    .as_deref()
                    .unwrap_or("The provider stopped the run."),
            )),
        },
        Err(AgentError::Cancelled) => Ok(StopKind::Interrupted),
        Err(_) if cancelled => Ok(StopKind::Interrupted),
        Err(AgentError::Timeout) => Ok(StopKind::Timeout),
        Err(error) => match error.kind() {
            "auth" => Err(rejected()),
            "transport" if steps <= 1 => Err(unreachable()),
            _ => Err(failed(&error.to_string())),
        },
    }
}

fn spool_status(stop: Option<StopKind>) -> &'static str {
    match stop {
        Some(StopKind::EndTurn) => "completed",
        Some(StopKind::StepLimit | StopKind::Timeout) => "interrupted",
        Some(StopKind::Interrupted) => "cancelled",
        None => "failed",
    }
}

/// A path for people: relative to the working folder when inside it.
fn shown(path: &Path) -> String {
    std::env::current_dir()
        .ok()
        .and_then(|current| dunce::canonicalize(current).ok())
        .and_then(|current| path.strip_prefix(&current).ok().map(Path::to_path_buf))
        .filter(|relative| !relative.as_os_str().is_empty())
        .unwrap_or_else(|| path.to_path_buf())
        .display()
        .to_string()
}

/// A review folder with nothing in it is removed.
fn drop_empty_review(dir: &Path) {
    let _ = std::fs::remove_dir_all(dir);
}

/// Runs the agent for `request` and reports.
pub async fn execute(
    ctx: &Context,
    request: AgentRunRequest,
    env: &(dyn Fn(&str) -> Option<String> + Sync),
) -> Result<Outcome, CliError> {
    let project = project_folder(ctx)?;
    let data_root = ctx.data_root().map(Path::to_path_buf);
    let opened = open_project(&project, None, None).ok();
    let linked_id = opened.as_ref().and_then(|opened| match &opened.origin {
        ProjectOrigin::Linked { id } => Some(id.clone()),
        _ => None,
    });
    let main_document = opened
        .as_ref()
        .map(|opened| opened.workspace.manifest().main_doc.clone())
        .filter(|main| !main.is_empty());
    let project_id = data_root
        .as_deref()
        .and_then(|root| crate::app_paths::project_identity(&project, root))
        .map(|identity| identity.id().to_string())
        .or_else(|| linked_id.clone());
    let fallback_data = std::env::temp_dir().join("oleafly-no-data-folder");
    let policy_data = data_root.clone().unwrap_or_else(|| fallback_data.clone());
    let run_policy: RunPolicy = policy(&PolicyRequest {
        project: &project,
        linked_id: linked_id.as_deref(),
        data_root: &policy_data,
        allow: request.allow,
        apply: request.apply,
        review_dir: request.review_dir.as_deref(),
        question: request.question,
        run_id: &request.run_id,
    })?;

    // The run's commands run for an owner of their own (on Windows a
    // profile of their own); it is released when the run ends, however it
    // ends (an error, Ctrl+C, a finished report).
    let _sandbox_owner = run_policy
        .allow
        .commands
        .then(|| OwnerRelease::new(&request.run_id));

    let config = match data_root.clone() {
        Some(root) => tokio::task::spawn_blocking(move || desktop_config::load(&root))
            .await
            .map_err(|_| CliError::internal("Oleafly's settings could not be read."))??,
        None => DesktopConfig::empty(),
    };
    let resolved: ResolvedProvider = resolve(&policy_data, &config, &request.choice, env)?;
    for warning in &resolved.warnings {
        ctx.warn("agent.model_not_enabled", warning.clone());
    }
    let mut secrets = secret_values(&config);
    if resolved.resolved.credential.trim().len() >= 8 {
        secrets.push(resolved.resolved.credential.trim().to_string());
    }
    for name in all_key_variables() {
        if let Some(value) = env(name).filter(|value| value.trim().len() >= 8) {
            secrets.push(value.trim().to_string());
        }
    }
    let redactor = Arc::new(Redactor::new(&secrets));
    let provider = resolved.resolved.provider_id.clone();
    let model = resolved.resolved.model_id.clone();
    let credential_source = resolved.source.label();

    let cancel = CancellationToken::new();
    let interrupt = {
        let cancel = cancel.clone();
        let quiet = ctx.json() || ctx.quiet();
        tokio::spawn(async move {
            // Ctrl+C, and on Unix a closed terminal (SIGHUP) or a stop from
            // a supervisor (SIGTERM): the commands the run started die with it.
            crate::daemon::serve::termination().await;
            cancel.cancel();
            if !quiet {
                crate::human::note("Stopping. Press Ctrl+C again to quit at once.");
            }
            crate::daemon::serve::termination().await;
            std::process::exit(Exit::Interrupted as i32);
        })
    };
    let result = run_with(
        ctx,
        &request,
        &run_policy,
        &project,
        data_root.as_deref(),
        project_id.as_deref(),
        main_document.as_deref(),
        config,
        resolved,
        &redactor,
        &cancel,
    )
    .await;
    interrupt.abort();
    let RunEnd {
        result,
        tracker,
        workspace,
        hub,
        tool_calls,
        tool_warnings,
        price,
    } = match result {
        Ok(end) => end,
        Err(error) => return Err(error),
    };
    // Ctrl+C before the run ended; then stop whatever a tool still runs.
    let interrupted = cancel.is_cancelled();
    cancel.cancel();
    for (code, message) in tool_warnings {
        ctx.warn(code, message);
    }
    if let Some(hub) = &hub {
        hub.shutdown().await;
    }
    drop(hub);
    let keep = request.keep_workspace;
    let set = tokio::task::spawn_blocking(move || {
        AgentWorkspace::finish_shared(workspace, keep, FINISH_WAIT)
    })
    .await
    .map_err(|_| CliError::internal("The run's changes could not be collected."))??;
    for warning in &set.warnings {
        let code = if warning.contains("names a run can't use") {
            "agent.skipped_names"
        } else if warning.contains("link") {
            "agent.skipped_links"
        } else if warning.contains("cloud") {
            "agent.skipped_cloud"
        } else {
            "agent.workspace"
        };
        ctx.warn(code, warning.clone());
    }
    let mut review_dir = set.review_dir.clone();
    if set.changes.is_empty() && !request.keep_workspace {
        if let Some(dir) = review_dir.take() {
            drop_empty_review(&dir);
        }
    }

    let stop = classify(&result, interrupted, tracker.steps, &provider, &redactor);
    let cost = price.map(|price| price.cost(&tracker.usage));
    if tracker.usage_seen {
        if let Some(root) = &data_root {
            let event = UsageSpoolEvent {
                id: usage_spool::event_id("cli-agent"),
                source: "cli-agent".into(),
                task_id: None,
                project_id: project_id.clone(),
                project_path: Some(project.to_string_lossy().into_owned()),
                provider: provider.clone(),
                model: model.clone(),
                input_tokens: (tracker.usage.input_known != Some(false))
                    .then_some(tracker.usage.input),
                output_tokens: (tracker.usage.output_known != Some(false))
                    .then_some(tracker.usage.output),
                cache_read_tokens: tracker.usage.cache_read,
                cache_write_tokens: tracker.usage.cache_write,
                cost_usd: cost,
                status: spool_status(stop.as_ref().ok().copied()).into(),
                at: now_ms(),
            };
            let root = root.clone();
            let appended =
                tokio::task::spawn_blocking(move || usage_spool::append(&root, &event)).await;
            if !matches!(appended, Ok(Ok(()))) {
                ctx.warn(
                    "agent.usage_not_saved",
                    "This run's usage could not be recorded for Oleafly's usage view.",
                );
            }
        }
    }
    let stop = stop?;
    let text = match &result {
        Ok(outcome) if !outcome.text.trim().is_empty() => outcome.text.clone(),
        _ => tracker.text(),
    };
    let report = AgentRunReport {
        run_id: request.run_id.clone(),
        mode: set.mode,
        review_dir: review_dir.clone(),
        provider,
        model,
        credential_source,
        stop_reason: stop,
        steps: tracker.steps,
        tool_calls,
        text: redactor.text(&text),
        changes: set.changes.clone(),
        usage: usage_summary(&tracker.usage, tracker.usage_seen, cost),
    };
    match stop {
        StopKind::StepLimit => ctx.warn(
            "agent.step_limit",
            format!("The agent stopped after {} steps.", tracker.steps),
        ),
        StopKind::Timeout => ctx.warn(
            "agent.timeout",
            format!(
                "The agent stopped after {} seconds.",
                request.timeout.as_secs()
            ),
        ),
        _ => {}
    }
    if !ctx.json() && !ctx.quiet() {
        let count = set.changes.len();
        let noun = if count == 1 { "change" } else { "changes" };
        match (&review_dir, run_policy.mode.clone()) {
            (Some(dir), WriteMode::Review { .. }) => {
                let dir = shown(dir);
                ctx.say(format!("Saved {count} {noun} for review in {dir}. Apply them with: oleafly agent apply {dir}"));
            }
            (_, WriteMode::Apply) if count > 0 => {
                ctx.say(format!("Made {count} {noun} in the project."))
            }
            _ => {}
        }
    }
    let value =
        json!({ "run": redactor.value(serde_json::to_value(&report).unwrap_or(Value::Null)) });
    Ok(match stop {
        StopKind::EndTurn => Outcome::success(value),
        StopKind::StepLimit | StopKind::Timeout => Outcome::failure(Exit::Internal, value),
        StopKind::Interrupted => Outcome::failure(Exit::Interrupted, value),
    })
}

/// What the run left for the report.
struct RunEnd {
    result: Result<RunOutcome, AgentError>,
    tracker: Tracker,
    workspace: Arc<AgentWorkspace>,
    hub: Option<Arc<McpHub>>,
    tool_calls: u32,
    tool_warnings: Vec<(&'static str, String)>,
    price: Option<super::provider::Price>,
}

#[allow(clippy::too_many_arguments)]
async fn run_with(
    ctx: &Context,
    request: &AgentRunRequest,
    run_policy: &RunPolicy,
    project: &Path,
    data_root: Option<&Path>,
    project_id: Option<&str>,
    main_document: Option<&str>,
    config: DesktopConfig,
    resolved: ResolvedProvider,
    redactor: &Arc<Redactor>,
    cancel: &CancellationToken,
) -> Result<RunEnd, CliError> {
    let config = Arc::new(config);
    // Skills and the HTTP client first: nothing after the workspace opens
    // may fail, so a review folder is never left half made.
    let pack = crate::app_paths::installed_app()
        .and_then(|app| app.resources_dir)
        .map(|resources| resources.join("skills"));
    let skills = match data_root {
        Some(root) => CliSkills::from_app(root, pack, project_id),
        None => CliSkills {
            pack,
            ..CliSkills::empty()
        },
    };
    let skill_text = skill_prompt(&skills, project_id, &request.skills, SkillAudience::Agent)
        .map_err(|message| {
            CliError::new(ErrorKind::InvalidInput, "agent.skill_unavailable", message)
        })?;
    let read_paths = skills.read_paths(&request.skills);
    let client =
        oleafly_agent::build_client().map_err(|error| CliError::internal(error.to_string()))?;

    // The copy (review mode) or the project itself.
    let workspace = {
        let project = project.to_path_buf();
        let policy = run_policy.clone();
        let cancel = cancel.clone();
        tokio::task::spawn_blocking(move || {
            AgentWorkspace::open(&project, &policy, &STAGE_LIMITS, &cancel)
        })
        .await
        .map_err(|_| CliError::internal("The project could not be prepared."))??
    };
    let workspace = Arc::new(workspace);

    // The user's MCP servers. A server that fails is a warning.
    let hub = if request.mcp != McpSelection::None && !config.mcp_servers.is_empty() {
        let secrets = secret_values(&config);
        let (hub, warnings) = McpHub::connect(
            &config.mcp_servers,
            run_policy,
            &request.mcp,
            &secrets,
            cancel,
        )
        .await;
        for warning in warnings {
            ctx.warn("agent.mcp", redactor.text(&warning));
        }
        Some(Arc::new(hub))
    } else {
        None
    };

    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel::<RunEvent>();
    let sink: EventSink = {
        let sender = sender.clone();
        Arc::new(move |event| {
            let _ = sender.send(event);
        })
    };
    let tool_ctx = Arc::new(ToolContext {
        workspace: workspace.clone(),
        policy: run_policy.clone(),
        config: config.clone(),
        data_root: data_root.map(Path::to_path_buf),
        project_id: project_id.map(str::to_owned),
        run_id: request.run_id.clone(),
        mcp: hub.clone(),
        cancel: cancel.clone(),
        events: sink,
        last_build: Mutex::new(None),
        warned_unsandboxed: AtomicBool::new(false),
        skills: Arc::new(skills),
        read_paths,
        secrets: Arc::new(StoreSecrets::from_config(&config)),
        calls: AtomicU32::new(0),
        warnings: Mutex::new(Vec::new()),
    });
    let tools = Arc::new(native_tools(run_policy));
    let mcp_tools = Arc::new(
        hub.as_ref()
            .map(|hub| hub.tools().to_vec())
            .unwrap_or_default(),
    );
    let project_name = project
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| project.display().to_string());
    let servers = hub
        .as_ref()
        .map(|hub| hub.server_names())
        .unwrap_or_default();
    let system = system_prompt(&PromptContext {
        project_name: &project_name,
        policy: run_policy,
        main_document,
        mcp_servers: &servers,
        skills: &skill_text,
        left_out: workspace.left_out(),
    });
    let mut completion = build_request(
        system,
        request.prompt.clone(),
        request.choice.effort,
        run_policy.allow.network,
    );
    completion
        .tools
        .extend(tools.iter().map(|tool| tool.schema.clone()));
    completion
        .tools
        .extend(mcp_tools.iter().map(|tool| tool.schema.clone()));
    let mut run_tools = runner(tool_ctx.clone(), tools, mcp_tools);
    if run_policy.allow.network {
        let key = search_key_from(&config.connector);
        let has_key = key.is_some();
        if add_local_web_tools(&mut completion, &resolved.resolved, has_key) {
            ctx.warn(
                "agent.web_search_unavailable",
                "Web search needs a Brave, Tavily or Serper key in Oleafly's settings, so this run only reads pages.",
            );
        }
        match WebToolContext::new(key, &web_user_agent()) {
            Ok(web) => {
                web.observe_messages(&completion.messages);
                run_tools = web_tool_runner(Arc::new(web), run_tools);
            }
            Err(_) => {
                completion
                    .tools
                    .retain(|tool| tool.name != WEB_FETCH_TOOL && tool.name != WEB_SEARCH_TOOL);
                ctx.warn(
                    "agent.web_unavailable",
                    "Web pages can't be read in this run.",
                );
            }
        }
    }

    let config_run = RunConfig {
        max_steps: request.max_steps,
        allow_long_runs: request.max_steps > 50,
        max_duration_ms: Some(u64::try_from(request.timeout.as_millis()).unwrap_or(u64::MAX)),
        ..RunConfig::default()
    };
    let pipeline = ToolPipeline {
        token: cancel.clone(),
        ..ToolPipeline::default()
    };
    let tracker = Arc::new(Mutex::new(Tracker::default()));
    let on_event = {
        let sender = sender.clone();
        let tracker = tracker.clone();
        move |event: AgentEvent| {
            let mut state = tracker
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let forwarded = match event {
                AgentEvent::StepStart { step } => {
                    state.steps = step.saturating_add(1);
                    if !state.current_text.trim().is_empty() {
                        state.last_text = std::mem::take(&mut state.current_text);
                    } else {
                        state.current_text.clear();
                    }
                    Some(RunEvent::Step {
                        step: step.saturating_add(1),
                    })
                }
                AgentEvent::TextDelta { text } => {
                    state.current_text.push_str(&text);
                    Some(RunEvent::Text { text })
                }
                AgentEvent::ReasoningDelta { text } => Some(RunEvent::Reasoning { text }),
                AgentEvent::Usage { usage, .. } => {
                    state.usage = usage;
                    state.usage_seen = true;
                    Some(RunEvent::Usage {
                        input_tokens: (usage.input_known != Some(false)).then_some(usage.input),
                        output_tokens: (usage.output_known != Some(false)).then_some(usage.output),
                    })
                }
                _ => None,
            };
            drop(state);
            if let Some(event) = forwarded {
                let _ = sender.send(event);
            }
        }
    };
    let mut printer = Printer::new(ctx, redactor);
    printer.emit(RunEvent::Started {
        run_id: request.run_id.clone(),
        provider: resolved.resolved.provider_id.clone(),
        model: resolved.resolved.model_id.clone(),
        mode: run_policy.mode.label(),
        review_dir: match &run_policy.mode {
            WriteMode::Review { dir } => Some(dir.to_string_lossy().into_owned()),
            _ => None,
        },
    });
    if !ctx.json() {
        let mode = match &run_policy.mode {
            WriteMode::Review { .. } => "Changes go to a review copy.",
            WriteMode::Apply => "Changes go straight into the project.",
            WriteMode::ReadOnly => "Nothing is changed.",
        };
        ctx.note(format!(
            "Using {} {}. {mode}",
            resolved.resolved.provider_id, resolved.resolved.model_id
        ));
    }
    let price = resolved.price;
    let run = oleafly_agent::run_agent_with_pipeline(
        &client,
        &resolved.resolved,
        completion,
        &config_run,
        pipeline,
        None,
        run_tools,
        on_event,
    );
    tokio::pin!(run);
    let result = loop {
        tokio::select! {
            result = &mut run => break result,
            Some(event) = receiver.recv() => {
                printer.emit(event);
                for (code, message) in tool_ctx.take_warnings() {
                    ctx.warn(code, message);
                }
            }
        }
    };
    drop(sender);
    while let Ok(event) = receiver.try_recv() {
        printer.emit(event);
    }
    printer.finish();
    let tracker = tracker
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    let tool_calls = tool_ctx.calls.load(Ordering::Acquire);
    let tool_warnings = tool_ctx.take_warnings();
    drop(tool_ctx);
    Ok(RunEnd {
        result,
        tracker,
        workspace,
        hub,
        tool_calls,
        tool_warnings,
        price,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effort_reaches_the_completion_request() {
        use crate::agent::EffortArg;
        let high = build_request(
            "s".into(),
            "p".into(),
            effort_from_arg(EffortArg::High),
            false,
        );
        assert_eq!(high.effort, Some(Effort::High));
        let auto = build_request(
            "s".into(),
            "p".into(),
            effort_from_arg(EffortArg::Auto),
            false,
        );
        assert_eq!(auto.effort, None);
        let off = build_request(
            "s".into(),
            "p".into(),
            effort_from_arg(EffortArg::None),
            true,
        );
        assert_eq!(off.effort, Some(Effort::Off));
        assert_eq!(
            off.web,
            Some(WebTools {
                search: true,
                fetch: true
            })
        );
        assert!(auto.web.is_none());
        assert_eq!(auto.system.as_deref(), Some("s"));
    }

    #[test]
    fn redact_removes_every_occurrence() {
        assert_eq!(
            redact("k=sk-1 and sk-1", &["sk-1".into()]),
            "k=[redacted] and [redacted]"
        );
        assert_eq!(redact("nothing", &[]), "nothing");
        assert_eq!(redact("abc", &[String::new()]), "abc");
        assert_eq!(
            redact(
                "long-secret-1 long-secret",
                &["long-secret".into(), "long-secret-1".into()]
            ),
            "[redacted] [redacted]"
        );
    }

    #[test]
    fn streamed_text_is_held_until_a_space() {
        let mut hold = TextHold::default();
        assert_eq!(hold.push("sk-li"), None);
        assert_eq!(hold.push("ve-1 is"), Some("sk-live-1 ".into()));
        assert_eq!(hold.flush(), Some("is".into()));
        let mut long = TextHold::default();
        let ready = long.push(&"x".repeat(MAX_HELD_TEXT + 10)).unwrap();
        assert_eq!(ready.len(), MAX_HELD_TEXT + 10 - HELD_TAIL);
    }

    #[test]
    fn run_ids_are_time_and_random() {
        let id = new_run_id();
        let (time, random) = id.split_once('-').unwrap();
        assert!(time.parse::<u64>().is_ok() && random.len() == 4);
    }

    #[test]
    fn errors_map_to_the_exit_kinds() {
        let redactor = Redactor::new(&["sk-live-ABCDEF".into()]);
        let auth = Ok(RunOutcome {
            error: Some("The provider returned 401. bad key sk-live-ABCDEF".into()),
            error_kind: Some("auth".into()),
            ..RunOutcome::default()
        });
        let error = classify(&auth, false, 1, "openai", &redactor).unwrap_err();
        assert_eq!(
            (error.exit() as u8, error.code.as_ref()),
            (6, "agent.provider_rejected_key")
        );
        assert!(!error.message.contains("sk-live"));
        let offline = Ok(RunOutcome {
            error_kind: Some("transport".into()),
            ..RunOutcome::default()
        });
        assert_eq!(
            classify(&offline, false, 1, "openai", &redactor)
                .unwrap_err()
                .exit() as u8,
            7
        );
        let other = Ok(RunOutcome {
            error: Some("The provider returned 500. sk-live-ABCDEF".into()),
            error_kind: Some("provider".into()),
            steps: 2,
            ..RunOutcome::default()
        });
        let error = classify(&other, false, 2, "openai", &redactor).unwrap_err();
        assert!(!error.message.contains("sk-live") && error.message.contains("[redacted]"));
        assert_eq!(
            classify(&Err(AgentError::Timeout), false, 3, "openai", &redactor).unwrap(),
            StopKind::Timeout
        );
        assert_eq!(
            classify(&Err(AgentError::Cancelled), true, 3, "openai", &redactor).unwrap(),
            StopKind::Interrupted
        );
        let capped = Ok(RunOutcome {
            stopped_at_cap: true,
            ..RunOutcome::default()
        });
        assert_eq!(
            classify(&capped, false, 50, "openai", &redactor).unwrap(),
            StopKind::StepLimit
        );
        assert_eq!(
            classify(&Ok(RunOutcome::default()), false, 1, "openai", &redactor).unwrap(),
            StopKind::EndTurn
        );
    }

    #[test]
    fn tool_lines_name_the_path_or_command() {
        assert_eq!(
            tool_line("read_file", r#"{"path":"main.tex"}"#),
            "→ read_file main.tex"
        );
        assert_eq!(tool_line("compile", "{}"), "→ compile");
        assert_eq!(
            tool_line("run_command", r#"{"command":"make\nall"}"#),
            "→ run_command makeall"
        );
    }

    #[test]
    fn usage_reports_only_what_was_seen() {
        let usage = Usage {
            input: 10,
            output: 3,
            cache_read: Some(4),
            ..Usage::default()
        };
        let summary = usage_summary(&usage, true, Some(0.5));
        assert_eq!(
            (
                summary.input_tokens,
                summary.output_tokens,
                summary.cached_read_tokens
            ),
            (Some(10), Some(3), Some(4))
        );
        assert_eq!(usage_summary(&usage, false, None), UsageSummary::default());
        assert_eq!(spool_status(Some(StopKind::EndTurn)), "completed");
        assert_eq!(spool_status(None), "failed");
    }
}
