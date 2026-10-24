//! The task tools both runtimes share: supervised runs, the ledger and
//! results tables, notes and todos, compile, the project map, citation
//! checks, literature, papers and the web. The built-in runtime calls them
//! directly; CLI agents reach them through the task's research bridge.
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use oleafly_agent::{CancellationToken, ToolSchema};
use serde_json::{json, Value};

use super::TaskFiles;
use crate::approvals::{gate, GateContext};
use crate::builtin::TaskHost;
use crate::literature::paper::{read_paper, PaperRequest, DEFAULT_WINDOW_CHARS};
use crate::literature::{search_all, LiteratureQuery, LiteratureSourceId};
use crate::model::{
    now_ms, ApprovalKind, CommandPolicy, ResearchBrief, ResearchTask, TaskPhase, TaskRuntimeEvent,
    TodoItem,
};
use crate::record::{format_ledger_row, parse_ledger, LedgerRow, LEDGER_HEADER};
use crate::runs::{LogQuery, StartRun, WAIT_DEFAULT, WAIT_MAX};
use crate::scheduler::{TaskEventSink, TaskServices};
use crate::store::TaskStore;

pub const SPAWN_AGENT: &str = "spawn_agent";
/// What `start_run` answers while the user has not approved the plan.
pub const PLAN_NO_RUNS: &str = "Write plan.md first. Runs start after the user approves the plan.";
const MAX_TODOS: usize = 100;
const MAX_TODO_CHARS: usize = 300;
const MAX_NOTE_BYTES: usize = 4 * 1024;
const MAX_NOTES_FILE_BYTES: usize = 256 * 1024;
const MAX_TABLE_METRICS: usize = 12;
const TABLE_FORMATS: [&str; 3] = ["latex", "typst", "markdown"];
const LEDGER_VERDICTS: [&str; 3] = ["keep", "discard", "crash"];
const MAX_LOG_TAIL: usize = 2_000;
const MAX_LEDGER_COMMAND_CHARS: usize = 400;

/// What a task tool needs from the task it serves.
#[derive(Clone)]
pub struct TaskBinding {
    pub task_id: String,
    pub project_id: String,
    pub task_title: String,
    pub generation: u64,
    pub brief: ResearchBrief,
    pub record_dir: String,
    pub execution_root: PathBuf,
    pub allowed_paths: Vec<String>,
    /// Extra read grants for commands and runs (skill folders).
    pub read_paths: Vec<PathBuf>,
    /// The project's linked data folders (read-only for runs).
    pub linked_roots: Vec<oleafly_sandbox::profile::LinkedFolder>,
    /// Where interpreters are looked for.
    pub search_dirs: Vec<PathBuf>,
    /// The real project folder.
    pub project_root: Option<PathBuf>,
    pub services: TaskServices,
    pub host: Arc<dyn TaskHost>,
    pub events: Option<TaskEventSink>,
    pub cancel: CancellationToken,
}

impl TaskBinding {
    fn files(&self) -> Result<TaskFiles, String> {
        TaskFiles::open(&self.execution_root, &self.allowed_paths)
    }

    fn store(&self) -> Result<TaskStore, String> {
        TaskStore::new(self.services.tasks_root.clone())
    }

    fn task(&self) -> Result<ResearchTask, String> {
        self.store()?.require(&self.task_id)
    }

    pub fn gate_context(&self) -> GateContext {
        GateContext {
            task_id: self.task_id.clone(),
            project_id: self.project_id.clone(),
            task_title: self.task_title.clone(),
            generation: self.generation,
            policy: self.brief.permissions.commands,
            events: self.events.clone(),
        }
    }

    fn emit(&self, event: TaskRuntimeEvent) {
        if let Some(events) = &self.events {
            events(event);
        }
    }

    fn record_file(&self, name: &str) -> String {
        format!("{}/{name}", self.record_dir)
    }
}

fn tool(name: &str, description: &str, properties: Value, required: &[&str]) -> ToolSchema {
    ToolSchema {
        name: name.into(),
        description: description.into(),
        input_schema: json!({
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": false,
        }),
    }
}

/// The task tools a task offers. CLI agents get all but `spawn_agent`; web
/// tools appear only with network permission and a web host.
pub fn task_tool_schemas(brief: &ResearchBrief, has_web: bool) -> Vec<ToolSchema> {
    let run_id = json!({"type": "string", "minLength": 1, "maxLength": 16});
    let shell = if cfg!(windows) { "cmd.exe" } else { "sh" };
    let mut tools = vec![
        tool(
            "start_run",
            &format!(
                "Start a long command (training, a benchmark, an analysis) as a supervised run in the task workspace and return at once. The command runs through {shell}. Use wait_runs to be woken when it finishes; never poll in a tight loop. Print metrics as key=value or JSON lines to have them recorded. Each run stops after the task's run time limit ({} minutes).",
                brief.budget.run_timeout_minutes
            ),
            json!({
                "name": {"type": "string", "minLength": 1, "maxLength": 80},
                "command": {"type": "string", "minLength": 1, "maxLength": 16384},
                "timeout": {"type": "integer", "minimum": 1, "maximum": brief.budget.run_timeout_minutes, "description": "Minutes"},
                "env": {"type": "object", "additionalProperties": {"type": "string"}},
                "cwd": {"type": "string", "description": "A folder inside the workspace, with forward slashes"},
            }),
            &["name", "command"],
        ),
        tool(
            "wait_runs",
            "Wait until one of the task's runs finishes (or the timeout passes) and get its result. Runs that finished earlier are returned at once, each only once.",
            json!({
                "ids": {"type": "array", "items": run_id, "maxItems": 16},
                "timeout": {"type": "integer", "minimum": 1, "maximum": WAIT_MAX.as_secs(), "description": "Seconds"},
            }),
            &[],
        ),
        tool("run_status", "The state, exit code and metrics of one run, or of the latest 50.", json!({"id": run_id}), &[]),
        tool(
            "read_run_log",
            "Read a run's log: its last lines, or the lines that contain a phrase.",
            json!({
                "id": run_id,
                "tail": {"type": "integer", "minimum": 1, "maximum": MAX_LOG_TAIL},
                "grep": {"type": "string", "minLength": 1, "maxLength": 200},
                "max_matches": {"type": "integer", "minimum": 1, "maximum": 200},
            }),
            &["id"],
        ),
        tool("cancel_run", "Stop a run.", json!({"id": run_id}), &["id"]),
        tool("compile", "Build the task workspace with Oleafly's command-line tool and report errors and warnings.", json!({}), &[]),
        tool("project_map", "The project's outline, labels, references and citations, with any that do not resolve.", json!({}), &[]),
        tool(
            "verify_citation",
            "Check that a reference is real: its DOI resolves to the title, or Crossref has a record with that title.",
            json!({
                "doi": {"type": "string", "maxLength": 2048},
                "title": {"type": "string", "maxLength": 1000},
            }),
            &[],
        ),
        tool(
            "update_todos",
            "Replace the task's todo list (shown to the user). Statuses: pending, in_progress, completed, cancelled.",
            json!({"todos": {"type": "array", "maxItems": MAX_TODOS, "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "maxLength": 40},
                    "content": {"type": "string", "maxLength": MAX_TODO_CHARS},
                    "status": {"type": "string", "enum": ["pending", "in_progress", "completed", "cancelled"]},
                },
                "required": ["id", "content", "status"],
                "additionalProperties": false,
            }}}),
            &["todos"],
        ),
        tool("get_todos", "The task's todo list.", json!({}), &[]),
        tool("remember_note", "Add a dated note to the record's notes.md, to keep a fact for later.", json!({"text": {"type": "string", "minLength": 1, "maxLength": MAX_NOTE_BYTES}}), &["text"]),
        tool("list_notes", "Read the record's notes.md.", json!({}), &[]),
        tool(
            "ledger_append",
            "Record one result in the record's ledger.tsv. With run_id, the run's command and recorded metrics are filled in.",
            json!({
                "hypothesis": {"type": "string", "maxLength": 500},
                "change": {"type": "string", "maxLength": 500},
                "run_id": run_id,
                "metrics": {"type": "object", "additionalProperties": {"type": "number"}},
                "verdict": {"type": "string", "enum": LEDGER_VERDICTS},
                "notes": {"type": "string", "maxLength": 1000},
            }),
            &["hypothesis", "change", "verdict"],
        ),
        tool(
            "results_table",
            "A table of runs and metrics for the manuscript, one row per run, each row marked with its run id so the evidence check can verify it.",
            json!({
                "run_ids": {"type": "array", "items": run_id, "maxItems": 50},
                "metrics": {"type": "array", "items": {"type": "string", "maxLength": 64}, "minItems": 1, "maxItems": MAX_TABLE_METRICS},
                "format": {"type": "string", "enum": TABLE_FORMATS},
                "caption": {"type": "string", "maxLength": 300},
            }),
            &["metrics", "format"],
        ),
        tool(
            "literature_search",
            "Search scholarly indexes at once (OpenAlex, Semantic Scholar, Crossref, arXiv, PubMed, and alphaXiv when connected) and get merged results with abstracts. Name sources to search only those.",
            json!({
                "query": {"type": "string", "minLength": 1, "maxLength": 500},
                "source": {"type": "string", "enum": ["openalex", "semantic-scholar", "crossref", "pubmed", "arxiv", "google-scholar", "alphaxiv"]},
                "sources": {"type": "array", "items": {"type": "string"}, "maxItems": 7},
                "limit": {"type": "integer", "minimum": 1, "maximum": 25},
                "year_from": {"type": "integer", "minimum": 1800, "maximum": 2200},
                "year_to": {"type": "integer", "minimum": 1800, "maximum": 2200},
                "open_access_only": {"type": "boolean"},
            }),
            &["query"],
        ),
        tool(
            "read_paper",
            "Read a paper's full text, a window at a time, with [p. N] page anchors. Give a DOI (its open-access copy), an arXiv id, an https URL of a PDF, or a PDF path in the workspace. The PDF and its text are kept in the record's papers/ folder.",
            json!({
                "doi": {"type": "string", "maxLength": 300},
                "arxiv": {"type": "string", "maxLength": 40},
                "url": {"type": "string", "maxLength": 2000},
                "path": {"type": "string", "maxLength": 1000},
                "root_id": {"type": "string", "maxLength": 256},
                "offset": {"type": "integer", "minimum": 0},
                "max_chars": {"type": "integer", "minimum": 1000, "maximum": 48000},
            }),
            &[],
        ),
        tool(
            SPAWN_AGENT,
            "Hand a reading or summarizing job to a helper agent that works at the same time. It can read the project and papers and write only inside the research record. It cannot run commands or start runs.",
            json!({
                "brief": {"type": "string", "minLength": 1, "maxLength": 4000},
                "paths": {"type": "array", "items": {"type": "string", "maxLength": 1000}, "maxItems": 50},
                "max_minutes": {"type": "integer", "minimum": 1, "maximum": 20},
            }),
            &["brief"],
        ),
    ];
    if brief.permissions.network && has_web {
        tools.push(tool(
            "web_fetch",
            "Read a public web page as Markdown.",
            json!({"url": {"type": "string", "maxLength": 2000}}),
            &["url"],
        ));
        tools.push(tool(
            "web_search",
            "Search the web.",
            json!({"query": {"type": "string", "minLength": 1, "maxLength": 400}}),
            &["query"],
        ));
    }
    tools
}

/// Read-class task tools run in parallel; writers one at a time; waits
/// and helpers hold no gate.
pub fn task_tool_policy(name: &str) -> oleafly_agent::tools::registry::ParallelPolicy {
    use oleafly_agent::tools::registry::ParallelPolicy;
    match name {
        "start_run" | "ledger_append" | "remember_note" | "update_todos" | "cancel_run" => {
            ParallelPolicy::Exclusive
        }
        "wait_runs" | SPAWN_AGENT => ParallelPolicy::Unguarded,
        _ => ParallelPolicy::Parallel,
    }
}

fn text<'a>(args: &'a Value, name: &str) -> Option<&'a str> {
    args[name]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn required<'a>(args: &'a Value, name: &str) -> Result<&'a str, String> {
    text(args, name).ok_or_else(|| format!("Missing required argument: {name}."))
}

/// `YYYY-MM-DDTHH:MM:SSZ` for epoch milliseconds.
pub fn iso_utc(ms: i64) -> String {
    let seconds = ms.div_euclid(1000);
    let days = seconds.div_euclid(86_400);
    let time = seconds.rem_euclid(86_400);
    // Civil from days (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        time / 3600,
        (time % 3600) / 60,
        time % 60
    )
}

fn format_number(value: f64) -> String {
    // Shortest round-trip form: the precision it was recorded at.
    let text = format!("{value}");
    if text.contains('e') {
        format!("{value:.6}")
    } else {
        text
    }
}

/// A results table with one marked row per run.
pub fn render_results_table(
    rows: &[(String, String, BTreeMap<String, f64>)],
    metrics: &[String],
    format: &str,
    caption: Option<&str>,
) -> String {
    let cell = |value: Option<&f64>| {
        value
            .map(|value| format_number(*value))
            .unwrap_or_else(|| "–".into())
    };
    match format {
        "latex" => {
            let mut out = String::from("\\begin{table}[t]\n\\centering\n");
            out.push_str(&format!(
                "\\begin{{tabular}}{{l{}}}\n\\hline\n",
                "r".repeat(metrics.len())
            ));
            out.push_str(&format!(
                "Run & {} \\\\\n\\hline\n",
                metrics.join(" & ").replace('_', "\\_")
            ));
            for (run, name, values) in rows {
                let cells: Vec<String> = metrics
                    .iter()
                    .map(|metric| cell(values.get(metric)))
                    .collect();
                out.push_str(&format!(
                    "{} & {} \\\\ % run: {run}\n",
                    name.replace('_', "\\_"),
                    cells.join(" & ")
                ));
            }
            out.push_str("\\hline\n\\end{tabular}\n");
            if let Some(caption) = caption {
                out.push_str(&format!("\\caption{{{caption}}}\n"));
            }
            out.push_str("\\end{table}\n");
            out
        }
        "typst" => {
            let mut out = format!("#figure(\n  table(\n    columns: {},\n", metrics.len() + 1);
            out.push_str(&format!(
                "    [Run], {},\n",
                metrics
                    .iter()
                    .map(|metric| format!("[{metric}]"))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
            for (run, name, values) in rows {
                let cells: Vec<String> = metrics
                    .iter()
                    .map(|metric| format!("[{}]", cell(values.get(metric))))
                    .collect();
                out.push_str(&format!(
                    "    [{name}], {}, // run: {run}\n",
                    cells.join(", ")
                ));
            }
            out.push_str("  ),\n");
            if let Some(caption) = caption {
                out.push_str(&format!("  caption: [{caption}],\n"));
            }
            out.push_str(")\n");
            out
        }
        _ => {
            let mut out = String::new();
            if let Some(caption) = caption {
                out.push_str(&format!("{caption}\n\n"));
            }
            out.push_str(&format!("| Run | {} |\n", metrics.join(" | ")));
            out.push_str(&format!("|---|{}\n", "---:|".repeat(metrics.len())));
            for (run, name, values) in rows {
                let cells: Vec<String> = metrics
                    .iter()
                    .map(|metric| cell(values.get(metric)))
                    .collect();
                out.push_str(&format!(
                    "| {name} | {} | <!-- run: {run} -->\n",
                    cells.join(" | ")
                ));
            }
            out
        }
    }
}

fn todos_from(args: &Value) -> Result<Vec<TodoItem>, String> {
    let items = args["todos"]
        .as_array()
        .ok_or("Give the todos as a list.")?;
    if items.len() > MAX_TODOS {
        return Err("Keep at most 100 todos.".into());
    }
    items
        .iter()
        .map(|item| {
            let content = item["content"].as_str().unwrap_or_default().trim();
            let status = item["status"].as_str().unwrap_or_default();
            if content.is_empty() || content.chars().count() > MAX_TODO_CHARS {
                return Err("Each todo needs text of up to 300 characters.".to_string());
            }
            if !["pending", "in_progress", "completed", "cancelled"].contains(&status) {
                return Err(
                    "A todo's status must be pending, in_progress, completed or cancelled.".into(),
                );
            }
            Ok(TodoItem {
                id: item["id"]
                    .as_str()
                    .unwrap_or_default()
                    .chars()
                    .take(40)
                    .collect(),
                content: content.to_owned(),
                status: status.to_owned(),
            })
        })
        .collect()
}

/// The ledger so far. A ledger that is not there yet starts from its header;
/// one that cannot be read is an error, never replaced by a fresh one.
fn ledger_text(files: &TaskFiles, path: &str) -> Result<String, String> {
    if files.exists(path)? {
        files.read(path)
    } else {
        Ok(format!("{LEDGER_HEADER}\n"))
    }
}

/// The run's command as the ledger keeps it: the run record has the whole of
/// it, so a ledger of many results does not outgrow its file.
fn ledger_command(command: &str) -> String {
    let mut short: String = command.chars().take(MAX_LEDGER_COMMAND_CHARS).collect();
    if short.len() < command.len() {
        short.push('…');
    }
    short
}

async fn start_run(binding: &TaskBinding, args: &Value) -> Result<Value, String> {
    let name = required(args, "name")?;
    let command = required(args, "command")?;
    if binding.brief.permissions.commands == CommandPolicy::Off {
        return Err(crate::approvals::COMMANDS_OFF.into());
    }
    // "Review the plan first" holds for every agent, including a CLI agent
    // that reaches this tool through the bridge.
    let task = binding.task()?;
    if task.brief.review_plan_first && !task.plan_approved {
        return Err(PLAN_NO_RUNS.into());
    }
    let env: BTreeMap<String, String> = match &args["env"] {
        Value::Null => BTreeMap::new(),
        Value::Object(map) => map
            .iter()
            .map(|(key, value)| {
                value
                    .as_str()
                    .map(|value| (key.clone(), value.to_owned()))
                    .ok_or_else(|| format!("{key} must be text."))
            })
            .collect::<Result<_, _>>()?,
        _ => return Err("Give env as an object of names and text values.".into()),
    };
    crate::runs::validate_run_env(&env)?;
    let timeout_minutes = args["timeout"]
        .as_u64()
        .map(|minutes| minutes.min(u64::from(u32::MAX)) as u32);
    let detail = run_approval_detail(
        name,
        command,
        text(args, "cwd"),
        timeout_minutes.unwrap_or(task.brief.budget.run_timeout_minutes),
        &env,
    );
    gate(
        &binding.services,
        &binding.gate_context(),
        ApprovalKind::Run,
        &format!("Start run {name}"),
        &detail,
        &binding.cancel,
    )
    .await?;
    // An approval can arrive at the moment the task is cancelled.
    if binding.cancel.is_cancelled() {
        return Err("The task was cancelled.".into());
    }
    let record = binding
        .services
        .runs
        .start(StartRun {
            task,
            execution_root: binding.execution_root.clone(),
            allowed_paths: binding.allowed_paths.clone(),
            read_paths: binding.read_paths.clone(),
            linked: binding.linked_roots.clone(),
            search_dirs: binding.search_dirs.clone(),
            project_root: binding.project_root.clone(),
            name: name.to_owned(),
            command: command.to_owned(),
            cwd_rel: text(args, "cwd").map(str::to_owned),
            env,
            timeout_minutes,
        })
        .await?;
    Ok(json!({"id": record.run_id, "status": record.state.as_str()}))
}

/// What the user approves for a run: everything that decides what it does.
/// Environment values are shown in full, since `PYTHONSTARTUP`,
/// `NODE_OPTIONS` and the like change what an approved command runs.
fn run_approval_detail(
    name: &str,
    command: &str,
    cwd: Option<&str>,
    minutes: u32,
    env: &BTreeMap<String, String>,
) -> String {
    let mut detail = format!("{name}\n{command}");
    if let Some(cwd) = cwd.filter(|cwd| !cwd.trim().is_empty()) {
        detail.push_str(&format!("\nFolder: {cwd}"));
    }
    detail.push_str(&format!("\nTime limit: {minutes} minutes"));
    if !env.is_empty() {
        detail.push_str("\nEnvironment:");
        for (key, value) in env {
            detail.push_str(&format!("\n{key}={value}"));
        }
    }
    detail
}

async fn wait_runs(binding: &TaskBinding, args: &Value) -> Result<Value, String> {
    let ids = args["ids"].as_array().map(|ids| {
        ids.iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect::<Vec<_>>()
    });
    let timeout = args["timeout"]
        .as_u64()
        .map(Duration::from_secs)
        .unwrap_or(WAIT_DEFAULT)
        .min(WAIT_MAX);
    binding.emit(TaskRuntimeEvent::Phase {
        phase: TaskPhase::WaitingRuns,
    });
    // 0.4.8 L: a task moving to another process stops waiting (its runs keep
    // going) so the step can end. The wait itself sees the stop only while
    // it waits, so a result it already took is never lost.
    let suspend = binding.services.suspends.token(&binding.task_id);
    let stop = binding.cancel.child();
    let relay = {
        let (suspend, stop) = (suspend.clone(), stop.clone());
        tokio::spawn(async move {
            suspend.cancelled().await;
            stop.cancel();
        })
    };
    let outcome = binding
        .services
        .runs
        .wait(&binding.task_id, ids, timeout, &stop)
        .await;
    relay.abort();
    let outcome = match outcome {
        Err(_) if suspend.is_cancelled() && !binding.cancel.is_cancelled() => {
            Ok(crate::runs::WaitOutcome {
                finished: Vec::new(),
                still_running: binding
                    .services
                    .runs
                    .in_flight(&binding.task_id)
                    .map(|runs| runs.into_iter().map(|run| run.run_id).collect())
                    .unwrap_or_default(),
                timed_out: true,
                note: Some(
                    "The task is moving to another process. Wait again after it resumes.".into(),
                ),
            })
        }
        other => other,
    };
    binding.emit(TaskRuntimeEvent::Phase {
        phase: TaskPhase::Working,
    });
    serde_json::to_value(outcome?).map_err(|error| error.to_string())
}

async fn ledger_append(binding: &TaskBinding, args: &Value) -> Result<Value, String> {
    let verdict = required(args, "verdict")?;
    if !LEDGER_VERDICTS.contains(&verdict) {
        return Err("Use keep, discard or crash as the verdict.".into());
    }
    let files = binding.files()?;
    let path = binding.record_file("ledger.tsv");
    let existing = ledger_text(&files, &path)?;
    let rows = parse_ledger(&existing);
    let mut metrics: BTreeMap<String, f64> = args["metrics"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(name, value)| {
            value
                .as_f64()
                .filter(|value| value.is_finite())
                .map(|value| (name.clone(), value))
        })
        .collect();
    let (id, command) = match text(args, "run_id") {
        Some(run_id) => {
            let run = binding
                .services
                .runs
                .list(&binding.task_id)?
                .into_iter()
                .find(|run| run.run_id == run_id)
                .ok_or_else(|| format!("No run {run_id} in this task."))?;
            for (name, value) in run.metrics {
                metrics.entry(name).or_insert(value);
            }
            (run.run_id, ledger_command(&run.command))
        }
        None => {
            // After the highest note so far: the rows read may be only the
            // newest of a long ledger, so counting them would repeat an id.
            let last_note = rows
                .iter()
                .filter_map(|row| row.id.strip_prefix('n')?.parse::<usize>().ok())
                .max()
                .unwrap_or(0);
            (format!("n{:03}", last_note + 1), String::new())
        }
    };
    let row = LedgerRow {
        id: id.clone(),
        time: iso_utc(now_ms()),
        hypothesis: text(args, "hypothesis").unwrap_or_default().to_owned(),
        change: text(args, "change").unwrap_or_default().to_owned(),
        command,
        metrics,
        verdict: verdict.to_owned(),
        notes: text(args, "notes").unwrap_or_default().to_owned(),
    };
    let mut updated = existing;
    if !updated.ends_with('\n') && !updated.is_empty() {
        updated.push('\n');
    }
    updated.push_str(&format_ledger_row(&row));
    updated.push('\n');
    if updated.len() > super::MAX_FILE_BYTES {
        return Err("ledger.tsv is full (1 MiB). Move older rows into ledger-archive.tsv, keeping the header, then record this result again.".into());
    }
    files.write(&path, &updated)?;
    Ok(json!({"id": id, "path": path}))
}

fn results_table(binding: &TaskBinding, args: &Value) -> Result<Value, String> {
    let metrics: Vec<String> = args["metrics"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect();
    if metrics.is_empty() {
        return Err("Name at least one metric.".into());
    }
    if metrics.len() > MAX_TABLE_METRICS {
        return Err(format!("Name at most {MAX_TABLE_METRICS} metrics."));
    }
    let format = text(args, "format").unwrap_or("markdown");
    if !TABLE_FORMATS.contains(&format) {
        return Err("Use latex, typst or markdown as the format.".into());
    }
    let wanted: Option<Vec<String>> = args["run_ids"].as_array().map(|ids| {
        ids.iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect()
    });
    let runs = binding.services.runs.list(&binding.task_id)?;
    let rows: Vec<(String, String, BTreeMap<String, f64>)> = runs
        .into_iter()
        .filter(|run| run.state.is_terminal())
        .filter(|run| wanted.as_ref().is_none_or(|ids| ids.contains(&run.run_id)))
        .map(|run| (run.run_id, run.name, run.metrics))
        .collect();
    if rows.is_empty() {
        return Err("No finished runs match.".into());
    }
    Ok(json!({"table": render_results_table(&rows, &metrics, format, text(args, "caption"))}))
}

async fn literature(binding: &TaskBinding, args: &Value) -> Result<Value, String> {
    let mut sources: Vec<LiteratureSourceId> = args["sources"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter_map(LiteratureSourceId::parse)
        .collect();
    if let Some(source) = text(args, "source").and_then(LiteratureSourceId::parse) {
        sources.push(source);
    }
    let query = LiteratureQuery {
        query: required(args, "query")?.to_owned(),
        sources,
        limit: args["limit"]
            .as_u64()
            .map_or(10, |limit| limit.clamp(1, 25) as u8),
        year_from: args["year_from"].as_u64().map(|year| year as u16),
        year_to: args["year_to"].as_u64().map(|year| year as u16),
        open_access_only: args["open_access_only"].as_bool().unwrap_or(false),
    };
    let results = search_all(
        &binding.host.literature(),
        binding.host.secrets().as_ref(),
        query,
        &binding.host.literature_sources(),
    )
    .await?;
    serde_json::to_value(results).map_err(|error| error.to_string())
}

async fn paper(binding: &TaskBinding, args: &Value) -> Result<Value, String> {
    let request = if let Some(doi) = text(args, "doi") {
        PaperRequest::Doi {
            doi: doi.to_owned(),
        }
    } else if let Some(id) = text(args, "arxiv") {
        PaperRequest::Arxiv { id: id.to_owned() }
    } else if let Some(url) = text(args, "url") {
        PaperRequest::Url {
            url: url.to_owned(),
        }
    } else if let Some(path) = text(args, "path") {
        PaperRequest::Path {
            path: path.to_owned(),
            root_id: text(args, "root_id").map(str::to_owned),
        }
    } else {
        return Err("Give a doi, arxiv id, url or path.".into());
    };
    let linked_base = match &request {
        PaperRequest::Path {
            root_id: Some(root_id),
            ..
        } => binding.host.linked_root(&binding.project_id, root_id),
        _ => None,
    };
    let files = binding.files()?;
    let extractor = binding.host.pdf_extractor();
    let text = read_paper(
        &binding.host.literature(),
        request,
        &files,
        &binding.record_dir,
        linked_base,
        extractor.as_deref(),
        args["offset"].as_u64().unwrap_or(0) as usize,
        args["max_chars"]
            .as_u64()
            .map_or(DEFAULT_WINDOW_CHARS, |max| max as usize),
    )
    .await?;
    serde_json::to_value(text).map_err(|error| error.to_string())
}

/// Runs a task tool. `None` when `name` is not one (or `spawn_agent`,
/// which only the built-in runtime offers).
pub async fn call_task_tool(
    name: &str,
    args: Value,
    binding: &TaskBinding,
) -> Option<Result<Value, String>> {
    let result = match name {
        "start_run" => start_run(binding, &args).await,
        "wait_runs" => wait_runs(binding, &args).await,
        "run_status" => match text(&args, "id") {
            Some(id) => binding
                .services
                .runs
                .list(&binding.task_id)
                .and_then(|runs| runs.into_iter().find(|run| run.run_id == id).ok_or_else(|| format!("No run {id} in this task.")))
                .and_then(|run| serde_json::to_value(run).map_err(|error| error.to_string())),
            None => binding.services.runs.list(&binding.task_id).and_then(|runs| {
                let start = runs.len().saturating_sub(50);
                serde_json::to_value(&runs[start..]).map_err(|error| error.to_string())
            }),
        },
        "read_run_log" => match required(&args, "id") {
            Ok(id) => {
                let query = match text(&args, "grep") {
                    Some(pattern) => LogQuery::Grep {
                        pattern: pattern.to_owned(),
                        max_matches: args["max_matches"].as_u64().unwrap_or(50) as usize,
                    },
                    None => LogQuery::Tail {
                        lines: args["tail"].as_u64().unwrap_or(80).min(MAX_LOG_TAIL as u64) as usize,
                    },
                };
                binding.services.runs.read_log(&binding.task_id, id, query).await.map(|log| json!({"log": log}))
            }
            Err(error) => Err(error),
        },
        "cancel_run" => match required(&args, "id") {
            Ok(id) => binding.services.runs.cancel(&binding.task_id, id).await.map(|()| json!({"stopping": id})),
            Err(error) => Err(error),
        },
        "compile" => match &binding.services.workspace {
            Some(workspace) => workspace
                .compile(binding.execution_root.clone(), binding.project_root.clone())
                .await
                .and_then(|summary| serde_json::to_value(summary).map_err(|error| error.to_string())),
            None => Ok(json!({"ok": false, "skipped": "The command-line tool isn't available."})),
        },
        "project_map" => match &binding.services.workspace {
            Some(workspace) => workspace.project_map(binding.execution_root.clone()).await,
            None => Err("Project maps in tasks need a newer build.".into()),
        },
        "verify_citation" => crate::citation::verify_citation(text(&args, "doi"), text(&args, "title"))
            .await
            .and_then(|check| serde_json::to_value(check).map_err(|error| error.to_string())),
        "update_todos" => todos_from(&args).and_then(|todos| {
            binding.store()?.set_todos(&binding.task_id, binding.generation, &todos)?;
            Ok(json!({"saved": todos.len()}))
        }),
        "get_todos" => binding.task().map(|task| json!({"todos": task.todos})),
        "remember_note" => match required(&args, "text") {
            Ok(note) if note.len() > MAX_NOTE_BYTES => Err("A note can be up to 4 KB.".into()),
            Ok(note) => binding.files().and_then(|files| {
                let path = binding.record_file("notes.md");
                let mut notes = files.read(&path).unwrap_or_default();
                let line = format!("- {} {}\n", iso_utc(now_ms()), note.replace('\n', " "));
                if notes.len() + line.len() > MAX_NOTES_FILE_BYTES {
                    return Err("notes.md is full (256 KB). Move older notes into handoff.md or sources.md.".into());
                }
                notes.push_str(&line);
                files.write(&path, &notes)?;
                Ok(json!({"saved": true}))
            }),
            Err(error) => Err(error),
        },
        "list_notes" => binding
            .files()
            .map(|files| json!({"notes": files.read(&binding.record_file("notes.md")).unwrap_or_default()})),
        "ledger_append" => ledger_append(binding, &args).await,
        "results_table" => results_table(binding, &args),
        "literature_search" => literature(binding, &args).await,
        "read_paper" => paper(binding, &args).await,
        "web_fetch" | "web_search" => {
            let web = binding.host.web().filter(|_| binding.brief.permissions.network);
            match web {
                None => Err("Web access is off for this task.".into()),
                Some(web) if name == "web_fetch" => match required(&args, "url") {
                    Ok(url) => web.fetch(url).await,
                    Err(error) => Err(error),
                },
                Some(web) => match required(&args, "query") {
                    Ok(query) => web.search(query).await,
                    Err(error) => Err(error),
                },
            }
        }
        _ => return None,
    };
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn results_tables_cite_each_run() {
        let rows = vec![
            (
                "r001".to_owned(),
                "baseline".to_owned(),
                BTreeMap::from([("acc".to_owned(), 0.88)]),
            ),
            (
                "r002".to_owned(),
                "dropout".to_owned(),
                BTreeMap::from([("acc".to_owned(), 0.913)]),
            ),
        ];
        let latex = render_results_table(&rows, &["acc".to_owned()], "latex", Some("Accuracy"));
        assert!(
            latex.contains("dropout & 0.913 \\\\ % run: r002"),
            "{latex}"
        );
        assert!(latex.contains("\\caption{Accuracy}"));
        let typst = render_results_table(&rows, &["acc".to_owned()], "typst", None);
        assert!(
            typst.contains("[dropout], [0.913], // run: r002"),
            "{typst}"
        );
        let markdown = render_results_table(
            &rows,
            &["acc".to_owned(), "loss".to_owned()],
            "markdown",
            None,
        );
        assert!(
            markdown.contains("| dropout | 0.913 | – | <!-- run: r002 -->"),
            "{markdown}"
        );
        // What the evidence check reads back.
        let found = crate::evidence::numbers_with_run_markers(&latex);
        assert!(found
            .iter()
            .any(|(_, numbers, run)| run == "r002" && numbers == &vec!["0.913".to_owned()]));
    }

    #[test]
    fn iso_times_are_utc() {
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_utc(1_792_000_000_000), "2026-10-14T17:46:40Z");
    }

    #[test]
    fn web_tools_appear_only_with_network_permission() {
        let mut brief = ResearchBrief::default();
        let names = |brief: &ResearchBrief, web: bool| {
            task_tool_schemas(brief, web)
                .into_iter()
                .map(|tool| tool.name)
                .collect::<Vec<_>>()
        };
        assert!(!names(&brief, true).contains(&"web_fetch".to_owned()));
        brief.permissions.network = true;
        assert!(names(&brief, true).contains(&"web_fetch".to_owned()));
        assert!(!names(&brief, false).contains(&"web_search".to_owned()));
    }

    #[test]
    fn todos_are_validated() {
        assert!(todos_from(
            &json!({"todos": [{"id": "1", "content": "Run baseline", "status": "pending"}]})
        )
        .is_ok());
        assert!(
            todos_from(&json!({"todos": [{"id": "1", "content": "x", "status": "maybe"}]}))
                .is_err()
        );
        assert!(
            todos_from(&json!({"todos": [{"id": "1", "content": "", "status": "pending"}]}))
                .is_err()
        );
    }
}
