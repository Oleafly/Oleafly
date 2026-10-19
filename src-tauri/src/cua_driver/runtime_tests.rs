//! Runtimes, the dispatcher, the bridge and the task decorator against a
//! fake Cua Driver: a small Node MCP server that logs every `tools/call`
//! (with its runtime kind) as JSON lines and behaves as configured:
//!
//! - `FAKE_STANDARD=1`: `get_screen_size` succeeds (an unbounded driver);
//! - `FAKE_EXPIRE_ON=n`: the n-th counted call is refused as expired, once;
//! - `FAKE_HANG=<tool>`: that tool never answers;
//! - `FAKE_FAIL=<tool>`: that tool runs and fails;
//! - `FAKE_DELAY_MS=<ms>`: counted calls take that long.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use oleafly_research::builtin::TaskBridge;
use oleafly_research::scheduler::TaskRuntimeFuture;
use serde_json::{json, Value};

use super::config::{AllowedApp, AllowedSite, CuaDriverConfig};
use super::detect::DriverInstall;
use super::dispatch::{call_desktop_apps, turn_ended_in};
use super::gate::testing::ScriptedApprover;
use super::gate::Answer;
use super::policy::{self, session_label};
use super::runtime::{DaemonHandle, DaemonLaunch, Launcher, RuntimePaths, IDLE_STOP, TIMEOUT_TEXT};
use super::{lock, BoxFuture, CuaDriverState, CuaScope, RuntimeKind, Surface, TurnEndGuard};
use crate::mcp::client::{McpSessionLimits, McpStdioSession};

const FAKE_DRIVER: &str = r#"
const fs = require('node:fs');
const readline = require('node:readline');
const log = process.env.FAKE_LOG;
const kind = process.env.FAKE_KIND || 'desktop';
const standard = process.env.FAKE_STANDARD === '1';
const expireOn = Number(process.env.FAKE_EXPIRE_ON || '0');
const hang = process.env.FAKE_HANG || '';
const fail = process.env.FAKE_FAIL || '';
const delay = Number(process.env.FAKE_DELAY_MS || '0');
const marker = log + '.expired';
const started = new Set();
let counted = 0;
const names = ['start_session','end_session','list_apps','list_windows','get_window_state','get_browser_state','launch_app','click','double_click','right_click','type_text','press_key','hotkey','scroll','set_value','run_steps','run_script','browser_prepare','browser_navigate','browser_click','browser_type','browser_select','health_report'];
const tools = names.map((name) => ({
  name,
  description: name + ' does a thing. More detail here.',
  inputSchema: {type: 'object', properties: {pid: {type: 'integer'}, session: {type: 'string'}}, required: name === 'click' ? ['pid'] : []},
}));
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const append = (entry) => fs.appendFileSync(log, JSON.stringify(entry) + '\n');
const refused = (code, message) => ({content: [{type: 'text', text: message}], isError: true, structuredContent: {status: 'refused', refusal: {code, message}}});
const lines = readline.createInterface({input: process.stdin});
lines.on('line', async (line) => {
  const m = JSON.parse(line);
  if (m.method === 'server/discover') { send({jsonrpc: '2.0', id: m.id, error: {code: -32601, message: 'Method not found'}}); return; }
  if (m.method === 'initialize') { send({jsonrpc: '2.0', id: m.id, result: {protocolVersion: '2025-06-18', capabilities: {tools: {}}, serverInfo: {name: 'fake-cua', version: '0.36.0'}}}); return; }
  if (m.id === undefined) return;
  if (m.method === 'tools/list') { send({jsonrpc: '2.0', id: m.id, result: {tools}}); return; }
  if (m.method !== 'tools/call') { send({jsonrpc: '2.0', id: m.id, error: {code: -32601, message: 'Method not found'}}); return; }
  const name = m.params.name;
  const args = m.params.arguments || {};
  append({kind, tool: name, args, phase: 'start', at: Date.now()});
  const answer = (result) => { append({kind, tool: name, phase: 'end', at: Date.now()}); send({jsonrpc: '2.0', id: m.id, result}); };
  if (name === 'get_screen_size') { answer(standard ? {content: [{type: 'text', text: '1920x1080'}]} : refused('permission_denied', 'not in the capability manifest')); return; }
  if (name === hang) return;
  if (name === 'start_session') { started.add(args.session); answer({content: [{type: 'text', text: 'started'}]}); return; }
  if (name === 'end_session') { started.delete(args.session); answer({content: [{type: 'text', text: 'ended'}]}); return; }
  counted += 1;
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  if (expireOn > 0 && counted === expireOn && !fs.existsSync(marker)) { fs.writeFileSync(marker, '1'); answer(refused('permission_denied', 'capability manifest idle timeout exceeded')); return; }
  if (args.session !== undefined && !started.has(args.session)) { answer(refused('session_ended', 'that session ended')); return; }
  if (name === fail) { answer({content: [{type: 'text', text: 'it failed'}], isError: true, structuredContent: {code: 'tool_invocation_failed'}}); return; }
  if (name === 'get_window_state') { answer({content: [{type: 'text', text: 'window tree'}, {type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo='}]}); return; }
  answer({content: [{type: 'text', text: name + ' ok'}]});
});
"#;

struct FakeLauncher {
    log: PathBuf,
    env: BTreeMap<String, String>,
    opened: Mutex<HashMap<RuntimeKind, usize>>,
}

impl FakeLauncher {
    fn new(dir: &Path, settings: &[(&str, &str)]) -> Arc<Self> {
        let log = dir.join("fake-cua.jsonl");
        let mut env: BTreeMap<String, String> = settings
            .iter()
            .map(|(name, value)| ((*name).to_string(), (*value).to_string()))
            .collect();
        env.insert("FAKE_LOG".into(), log.to_string_lossy().into_owned());
        Arc::new(Self {
            log,
            env,
            opened: Mutex::new(HashMap::new()),
        })
    }

    fn opened(&self, kind: RuntimeKind) -> usize {
        lock(&self.opened).get(&kind).copied().unwrap_or(0)
    }

    /// Every call that started, in order.
    fn calls(&self) -> Vec<Value> {
        std::fs::read_to_string(&self.log)
            .unwrap_or_default()
            .lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .filter(|entry| entry["phase"] == "start")
            .collect()
    }

    /// Tool names called, without the bounded self-check.
    fn tools(&self) -> Vec<String> {
        self.calls()
            .iter()
            .map(|entry| entry["tool"].as_str().unwrap_or_default().to_string())
            .filter(|tool| tool != policy::SELF_CHECK_TOOL)
            .collect()
    }

    fn entries(&self) -> Vec<Value> {
        std::fs::read_to_string(&self.log)
            .unwrap_or_default()
            .lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .collect()
    }

    async fn wait_for(&self, found: impl Fn(&[Value]) -> bool) -> bool {
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if found(&self.calls()) {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        false
    }
}

fn kind_of(paths: &RuntimePaths) -> RuntimeKind {
    match paths
        .pid_file
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .as_deref()
    {
        Some("desktop") => RuntimeKind::Desktop,
        Some("browser") => RuntimeKind::Browser,
        _ => RuntimeKind::SignedInBrowser,
    }
}

impl Launcher for FakeLauncher {
    fn locate(&self) -> BoxFuture<'_, Result<DriverInstall, String>> {
        Box::pin(async {
            Ok(DriverInstall {
                binary: PathBuf::from("node"),
                app_bundle: Some(PathBuf::from("/Applications/CuaDriver.app")),
                version: Some((0, 36, 0)),
            })
        })
    }

    fn start_daemon<'a>(
        &'a self,
        _launch: &'a DaemonLaunch,
        _paths: &'a RuntimePaths,
    ) -> BoxFuture<'a, Result<DaemonHandle, String>> {
        Box::pin(async { Ok(DaemonHandle::None) })
    }

    fn wait_ready<'a>(
        &'a self,
        _install: &'a DriverInstall,
        _paths: &'a RuntimePaths,
        _handle: &'a mut DaemonHandle,
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async { Ok(()) })
    }

    fn open_session<'a>(
        &'a self,
        _install: &'a DriverInstall,
        paths: &'a RuntimePaths,
        _env: &'a BTreeMap<String, String>,
    ) -> BoxFuture<'a, Result<McpStdioSession, String>> {
        Box::pin(async move {
            let kind = kind_of(paths);
            *lock(&self.opened).entry(kind).or_default() += 1;
            let mut env = self.env.clone();
            env.insert("FAKE_KIND".into(), kind.as_str().into());
            McpStdioSession::open(
                "node",
                &["-e".into(), FAKE_DRIVER.into()],
                &env,
                McpSessionLimits {
                    max_message_bytes: 16 * 1024 * 1024,
                    probe_timeout: Duration::from_millis(500),
                    open_timeout: Duration::from_secs(20),
                },
            )
            .await
        })
    }

    fn stop_daemon<'a>(
        &'a self,
        _install: &'a DriverInstall,
        _paths: &'a RuntimePaths,
        _handle: DaemonHandle,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async {})
    }
}

fn zotero() -> AllowedApp {
    AllowedApp {
        name: "Zotero".into(),
        bundle_id: Some("org.zotero.zotero".into()),
        executable: None,
    }
}

fn settings(sites: &[(&str, bool)]) -> CuaDriverConfig {
    CuaDriverConfig {
        enabled: true,
        apps: vec![zotero()],
        sites: sites
            .iter()
            .map(|(origin, signed_in)| AllowedSite {
                origin: (*origin).into(),
                signed_in: *signed_in,
            })
            .collect(),
        scripted_control: false,
    }
}

/// Fields drop in order: the state (and its processes) before the folder.
struct Fixture {
    state: Arc<CuaDriverState>,
    launcher: Arc<FakeLauncher>,
    approver: Arc<ScriptedApprover>,
    dir: tempfile::TempDir,
}

fn fixture(config: CuaDriverConfig, fake: &[(&str, &str)], approver: ScriptedApprover) -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let launcher = FakeLauncher::new(dir.path(), fake);
    let approver = Arc::new(approver);
    let state = Arc::new(CuaDriverState::for_test(
        config,
        launcher.clone(),
        approver.clone(),
        dir.path().to_path_buf(),
    ));
    Fixture {
        dir,
        launcher,
        approver,
        state,
    }
}

fn chat(session_key: &str) -> CuaScope {
    CuaScope {
        grant_key: "chat:A".into(),
        session_key: session_key.into(),
        project_id: None,
        agent_label: "Assistant".into(),
        surface: Surface::Chat,
    }
}

const WAIT: Duration = Duration::from_secs(10);

// --- Runtimes -------------------------------------------------------------

#[tokio::test]
async fn a_standard_mode_driver_is_stopped_before_any_call() {
    let f = fixture(
        settings(&[]),
        &[("FAKE_STANDARD", "1")],
        ScriptedApprover::default(),
    );
    let error = f
        .state
        .runtimes
        .call(
            RuntimeKind::Desktop,
            "L",
            "click",
            json!({"session": "L", "pid": 1}),
            WAIT,
        )
        .await
        .unwrap_err();
    assert!(error.contains("desktop_apps.not_bounded"), "{error}");
    let calls = f.launcher.calls();
    assert_eq!(calls.len(), 1, "{calls:?}");
    assert_eq!(calls[0]["tool"], "get_screen_size");
    assert!(f.state.runtimes.running().is_empty());
}

#[tokio::test]
async fn every_call_carries_the_session_label_and_starts_it_once() {
    let f = fixture(settings(&[]), &[], ScriptedApprover::default());
    for _ in 0..2 {
        let result = f
            .state
            .runtimes
            .call(
                RuntimeKind::Desktop,
                "L",
                "click",
                json!({"session": "L", "pid": 1}),
                WAIT,
            )
            .await
            .unwrap();
        assert!(!result["isError"].as_bool().unwrap_or(false), "{result}");
    }
    let calls: Vec<Value> = f
        .launcher
        .calls()
        .into_iter()
        .filter(|entry| entry["tool"] != policy::SELF_CHECK_TOOL)
        .collect();
    assert_eq!(f.launcher.tools(), vec!["start_session", "click", "click"]);
    assert!(
        calls.iter().all(|entry| entry["args"]["session"] == "L"),
        "{calls:?}"
    );
    assert_eq!(f.state.runtimes.running(), vec![RuntimeKind::Desktop]);
}

#[tokio::test]
async fn an_expired_manifest_restarts_the_runtime_and_retries_the_refused_call_once() {
    let f = fixture(
        settings(&[]),
        &[("FAKE_EXPIRE_ON", "1")],
        ScriptedApprover::default(),
    );
    let result = f
        .state
        .runtimes
        .call(
            RuntimeKind::Desktop,
            "L",
            "click",
            json!({"session": "L", "pid": 1}),
            WAIT,
        )
        .await
        .unwrap();
    assert!(!result["isError"].as_bool().unwrap_or(false), "{result}");
    assert_eq!(f.launcher.opened(RuntimeKind::Desktop), 2);
    let clicks = f
        .launcher
        .tools()
        .iter()
        .filter(|tool| *tool == "click")
        .count();
    assert_eq!(clicks, 2);
}

#[tokio::test]
async fn an_executed_call_is_never_retried() {
    let f = fixture(
        settings(&[]),
        &[("FAKE_FAIL", "click")],
        ScriptedApprover::default(),
    );
    let result = f
        .state
        .runtimes
        .call(
            RuntimeKind::Desktop,
            "L",
            "click",
            json!({"session": "L", "pid": 1}),
            WAIT,
        )
        .await
        .unwrap();
    assert_eq!(result["isError"], true);
    assert_eq!(
        result["structuredContent"]["code"],
        "tool_invocation_failed"
    );
    assert_eq!(f.launcher.tools(), vec!["start_session", "click"]);
    assert_eq!(f.launcher.opened(RuntimeKind::Desktop), 1);
}

#[tokio::test]
async fn a_hung_call_times_out_and_the_next_call_respawns() {
    let f = fixture(
        settings(&[]),
        &[("FAKE_HANG", "click")],
        ScriptedApprover::default(),
    );
    let error = f
        .state
        .runtimes
        .call(
            RuntimeKind::Desktop,
            "L",
            "click",
            json!({"session": "L", "pid": 1}),
            Duration::from_millis(300),
        )
        .await
        .unwrap_err();
    assert_eq!(error, TIMEOUT_TEXT);
    assert!(f.state.runtimes.running().is_empty());
    let result = f
        .state
        .runtimes
        .call(
            RuntimeKind::Desktop,
            "L",
            "list_apps",
            json!({"session": "L"}),
            WAIT,
        )
        .await
        .unwrap();
    assert!(!result["isError"].as_bool().unwrap_or(false), "{result}");
    assert_eq!(f.launcher.opened(RuntimeKind::Desktop), 2);
}

#[tokio::test]
async fn a_cancelled_call_drops_the_session() {
    let f = fixture(
        settings(&[]),
        &[("FAKE_HANG", "click")],
        ScriptedApprover::default(),
    );
    let state = f.state.clone();
    let call = tokio::spawn(async move {
        state
            .runtimes
            .call(
                RuntimeKind::Desktop,
                "L",
                "click",
                json!({"session": "L", "pid": 1}),
                WAIT,
            )
            .await
    });
    assert!(
        f.launcher
            .wait_for(|calls| calls.iter().any(|entry| entry["tool"] == "click"))
            .await
    );
    call.abort();
    let _ = call.await;
    let result = f
        .state
        .runtimes
        .call(
            RuntimeKind::Desktop,
            "L",
            "list_apps",
            json!({"session": "L"}),
            WAIT,
        )
        .await
        .unwrap();
    assert!(!result["isError"].as_bool().unwrap_or(false), "{result}");
    assert_eq!(f.launcher.opened(RuntimeKind::Desktop), 2);
    // The cancelled click was never sent again.
    assert_eq!(
        f.launcher
            .tools()
            .iter()
            .filter(|tool| *tool == "click")
            .count(),
        1
    );
}

#[tokio::test]
async fn end_session_reaches_every_runtime_that_used_the_label() {
    let f = fixture(
        settings(&[("https://a.org", false)]),
        &[],
        ScriptedApprover::default(),
    );
    f.state
        .runtimes
        .call(
            RuntimeKind::Desktop,
            "L",
            "click",
            json!({"session": "L", "pid": 1}),
            WAIT,
        )
        .await
        .unwrap();
    f.state
        .runtimes
        .call(
            RuntimeKind::Browser,
            "L",
            "browser_navigate",
            json!({"session": "L", "url": "https://a.org/x"}),
            WAIT,
        )
        .await
        .unwrap();
    f.state.runtimes.end_session("L").await;
    let ended: Vec<String> = f
        .launcher
        .calls()
        .iter()
        .filter(|entry| entry["tool"] == "end_session" && entry["args"]["session"] == "L")
        .map(|entry| entry["kind"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(ended, vec!["desktop".to_string(), "browser".to_string()]);
    assert_eq!(f.launcher.opened(RuntimeKind::SignedInBrowser), 0);
}

#[tokio::test]
async fn idle_runtimes_stop() {
    let f = fixture(settings(&[]), &[], ScriptedApprover::default());
    f.state
        .runtimes
        .call(RuntimeKind::Desktop, "", "list_apps", json!({}), WAIT)
        .await
        .unwrap();
    assert_eq!(f.state.runtimes.running(), vec![RuntimeKind::Desktop]);
    f.state.runtimes.stop_idle(Instant::now()).await;
    assert_eq!(f.state.runtimes.running(), vec![RuntimeKind::Desktop]);
    f.state
        .runtimes
        .stop_idle(Instant::now() + IDLE_STOP + Duration::from_secs(1))
        .await;
    assert!(f.state.runtimes.running().is_empty());
}

fn interval(entries: &[Value], kind: &str, tool: &str, nth: usize) -> (u64, u64) {
    let pick = |phase: &str| {
        entries
            .iter()
            .filter(|entry| {
                entry["kind"] == kind && entry["tool"] == tool && entry["phase"] == phase
            })
            .nth(nth)
            .and_then(|entry| entry["at"].as_u64())
            .unwrap()
    };
    (pick("start"), pick("end"))
}

#[tokio::test]
async fn calls_on_one_runtime_are_serialized_but_kinds_run_in_parallel() {
    let f = fixture(
        settings(&[("https://a.org", false)]),
        &[("FAKE_DELAY_MS", "300")],
        ScriptedApprover::default(),
    );
    // Warm both runtimes so start-up time doesn't count.
    f.state
        .runtimes
        .call(RuntimeKind::Desktop, "", "list_apps", json!({}), WAIT)
        .await
        .unwrap();
    f.state
        .runtimes
        .call(
            RuntimeKind::Browser,
            "",
            "get_browser_state",
            json!({}),
            WAIT,
        )
        .await
        .unwrap();
    let runtimes = &f.state.runtimes;
    let (first, second, browser) = tokio::join!(
        runtimes.call(RuntimeKind::Desktop, "", "click", json!({"pid": 1}), WAIT),
        runtimes.call(RuntimeKind::Desktop, "", "click", json!({"pid": 2}), WAIT),
        runtimes.call(
            RuntimeKind::Browser,
            "",
            "browser_click",
            json!({"ref": "e1"}),
            WAIT
        ),
    );
    first.unwrap();
    second.unwrap();
    browser.unwrap();
    let entries = f.launcher.entries();
    let one = interval(&entries, "desktop", "click", 0);
    let two = interval(&entries, "desktop", "click", 1);
    assert!(one.1 <= two.0 || two.1 <= one.0, "{one:?} {two:?}");
    let web = interval(&entries, "browser", "browser_click", 0);
    let overlaps = |a: (u64, u64), b: (u64, u64)| a.0 < b.1 && b.0 < a.1;
    assert!(
        overlaps(one, web) || overlaps(two, web),
        "{one:?} {two:?} {web:?}"
    );
}

#[tokio::test]
async fn a_settings_change_restarts_only_runtimes_whose_manifest_changed() {
    let f = fixture(
        settings(&[("https://a.org", false)]),
        &[],
        ScriptedApprover::default(),
    );
    let warm = |kind, tool: &'static str| {
        let state = f.state.clone();
        async move {
            state
                .runtimes
                .call(kind, "", tool, json!({}), WAIT)
                .await
                .unwrap()
        }
    };
    warm(RuntimeKind::Desktop, "list_apps").await;
    warm(RuntimeKind::Browser, "get_browser_state").await;
    f.state.set_settings(settings(&[
        ("https://a.org", false),
        ("https://b.org", false),
    ]));
    warm(RuntimeKind::Desktop, "list_apps").await;
    warm(RuntimeKind::Browser, "get_browser_state").await;
    assert_eq!(f.launcher.opened(RuntimeKind::Desktop), 1);
    assert_eq!(f.launcher.opened(RuntimeKind::Browser), 2);
}

// --- Dispatcher ------------------------------------------------------------

async fn dispatch(
    f: &Fixture,
    scope: &CuaScope,
    arguments: Value,
) -> super::dispatch::DesktopAppsOutcome {
    call_desktop_apps(&f.state, scope, arguments).await
}

#[tokio::test]
async fn full_access_and_allow_rules_never_skip_a_desktop_prompt() {
    let f = fixture(settings(&[]), &[], ScriptedApprover::with(&[Answer::Once]));
    let root = f.dir.path();
    crate::approvals::set_mode(root, "p1", crate::approvals::ApprovalMode::FullAccess).unwrap();
    crate::approvals::set_decision(
        root,
        "p1",
        "desktop_apps",
        Some(crate::approvals::ToolDecision::Allow),
    )
    .unwrap();
    let scope = CuaScope {
        project_id: Some("p1".into()),
        ..chat("run:a")
    };
    let outcome = dispatch(&f, &scope, json!({"tool": "click", "args": {"pid": 1}})).await;
    assert!(!outcome.is_error, "{}", outcome.text);
    assert_eq!(f.approver.asked().len(), 1);
}

#[tokio::test]
async fn a_deny_rule_refuses_before_the_driver() {
    let f = fixture(settings(&[]), &[], ScriptedApprover::default());
    crate::approvals::set_decision(
        f.dir.path(),
        "p1",
        "desktop_apps",
        Some(crate::approvals::ToolDecision::Deny),
    )
    .unwrap();
    let scope = CuaScope {
        project_id: Some("p1".into()),
        ..chat("run:a")
    };
    let outcome = dispatch(&f, &scope, json!({"tool": "list_windows"})).await;
    assert!(outcome.is_error);
    assert_eq!(outcome.text, super::gate::DENIED_TEXT);
    assert!(f.launcher.calls().is_empty());
}

#[tokio::test]
async fn the_session_option_grants_only_that_tool_for_that_key() {
    let f = fixture(
        settings(&[]),
        &[],
        ScriptedApprover::with(&[Answer::Session, Answer::Once, Answer::Once]),
    );
    let click = json!({"tool": "click", "args": {"pid": 1}});
    assert!(!dispatch(&f, &chat("run:a"), click.clone()).await.is_error);
    assert!(!dispatch(&f, &chat("run:a"), click.clone()).await.is_error);
    assert_eq!(f.approver.asked().len(), 1);
    assert!(
        !dispatch(
            &f,
            &chat("run:a"),
            json!({"tool": "type_text", "args": {"text": "hi"}})
        )
        .await
        .is_error
    );
    assert_eq!(f.approver.asked().len(), 2);
    let other = CuaScope {
        grant_key: "chat:B".into(),
        ..chat("run:b")
    };
    assert!(!dispatch(&f, &other, click).await.is_error);
    assert_eq!(f.approver.asked().len(), 3);
}

#[tokio::test]
async fn a_batch_asks_once_and_runs_as_one_call() {
    let f = fixture(settings(&[]), &[], ScriptedApprover::with(&[Answer::Once]));
    let outcome = dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "run_steps", "args": {"steps": [
            {"tool": "click", "args": {"pid": 1}},
            {"type_text": {"text": "hi"}},
            {"tool": "press_key", "args": {"key": "return"}}
        ]}}),
    )
    .await;
    assert!(!outcome.is_error, "{}", outcome.text);
    let asked = f.approver.asked();
    assert_eq!(asked.len(), 1);
    assert!(
        asked[0].contains("1. click") && asked[0].contains("3. press_key"),
        "{}",
        asked[0]
    );
    assert_eq!(
        f.launcher
            .tools()
            .iter()
            .filter(|tool| *tool == "run_steps")
            .count(),
        1
    );
    let bad = dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "run_steps", "args": {"steps": [{"tool": "drag", "args": {}}]}}),
    )
    .await;
    assert!(bad.is_error);
    assert_eq!(f.approver.asked().len(), 1);
}

#[tokio::test]
async fn typed_text_shows_in_the_dialog_but_never_in_the_log() {
    let secret = "words only the dialog may show 4711";
    let f = fixture(settings(&[]), &[], ScriptedApprover::with(&[Answer::Once]));
    let outcome = dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "type_text", "args": {"text": secret}}),
    )
    .await;
    assert!(!outcome.is_error, "{}", outcome.text);
    assert!(f.approver.asked()[0].contains(secret));
    let log = lock(&super::TEST_LOG).clone();
    assert!(
        log.iter()
            .any(|line| line.starts_with("desktop apps: type_text")),
        "{log:?}"
    );
    assert!(!log.iter().any(|line| line.contains(secret)));
}

#[tokio::test]
async fn a_declined_action_never_reaches_the_driver() {
    let f = fixture(settings(&[]), &[], ScriptedApprover::with(&[Answer::Deny]));
    let outcome = dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "click", "args": {"pid": 1}}),
    )
    .await;
    assert!(outcome.is_error);
    assert_eq!(outcome.text, "The user didn't allow this action.");
    assert!(!f.launcher.tools().contains(&"click".to_string()));
}

#[tokio::test]
async fn an_answer_after_the_wait_is_ignored() {
    let approver = ScriptedApprover {
        delay: Duration::from_secs(3 * 60 * 60),
        ..ScriptedApprover::with(&[Answer::Once])
    };
    let f = fixture(settings(&[]), &[], approver);
    let outcome = dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "click", "args": {"pid": 1}}),
    )
    .await;
    assert!(outcome.is_error);
    assert!(f.launcher.calls().is_empty());
}

#[tokio::test]
async fn private_keys_cannot_steer_the_dispatcher() {
    let f = fixture(settings(&[]), &[], ScriptedApprover::with(&[Answer::Once]));
    let outcome = dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "click", "__cuaSession": "other", "args": {"pid": 1, "session": "evil", "__cuaSession": "other"}}),
    )
    .await;
    assert!(!outcome.is_error, "{}", outcome.text);
    let expected = session_label("Assistant", "run:a");
    let clicks: Vec<Value> = f
        .launcher
        .calls()
        .into_iter()
        .filter(|entry| entry["tool"] == "click")
        .collect();
    assert_eq!(clicks.len(), 1);
    assert_eq!(clicks[0]["args"]["session"], expected.as_str());
    assert!(clicks[0]["args"].get("__cuaSession").is_none());
}

#[tokio::test]
async fn browser_tools_route_by_profile() {
    let f = fixture(
        settings(&[("https://a.org", true), ("https://b.org", false)]),
        &[],
        ScriptedApprover::with(&[Answer::Once, Answer::Once]),
    );
    let navigate = |browser: Option<&str>| {
        let mut arguments = json!({"tool": "browser_navigate", "args": {"url": "https://a.org/x"}});
        if let Some(browser) = browser {
            arguments["browser"] = json!(browser);
        }
        arguments
    };
    assert!(
        !dispatch(&f, &chat("run:a"), navigate(Some("signed_in")))
            .await
            .is_error
    );
    assert!(!dispatch(&f, &chat("run:a"), navigate(None)).await.is_error);
    let kinds: Vec<String> = f
        .launcher
        .calls()
        .iter()
        .filter(|entry| entry["tool"] == "browser_navigate")
        .map(|entry| entry["kind"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        kinds,
        vec!["signed-in-browser".to_string(), "browser".to_string()]
    );

    let g = fixture(
        settings(&[("https://b.org", false)]),
        &[],
        ScriptedApprover::default(),
    );
    let outcome = dispatch(&g, &chat("run:a"), navigate(Some("signed_in"))).await;
    assert!(outcome.is_error);
    assert!(
        outcome.text.contains("signed-in browser"),
        "{}",
        outcome.text
    );
    assert!(g.approver.asked().is_empty());
}

#[tokio::test]
async fn start_session_returns_the_rules_and_the_reference() {
    let f = fixture(settings(&[]), &[], ScriptedApprover::default());
    let outcome = dispatch(&f, &chat("run:a"), json!({"tool": "start_session"})).await;
    assert!(!outcome.is_error, "{}", outcome.text);
    for line in policy::POLICY_LINES {
        assert!(outcome.text.contains(line), "{line}");
    }
    assert!(outcome.text.contains("Allowed apps: Zotero"));
    assert!(outcome.text.contains("- click {pid"), "{}", outcome.text);
    assert!(!outcome.text.contains("health_report"));
    assert!(f.approver.asked().is_empty());
}

#[tokio::test]
async fn images_reach_the_agent_as_data_urls() {
    let f = fixture(settings(&[]), &[], ScriptedApprover::default());
    let outcome = dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "get_window_state", "args": {"pid": 1}}),
    )
    .await;
    assert!(!outcome.is_error, "{}", outcome.text);
    assert!(outcome.images[0].starts_with("data:image/png;base64,"));
    assert_eq!(outcome.text, "window tree");
}

#[tokio::test]
async fn turn_end_ends_the_label_and_a_new_turn_starts_fresh() {
    let f = fixture(settings(&[]), &[], ScriptedApprover::default());
    dispatch(&f, &chat("run:A"), json!({"tool": "list_windows"})).await;
    let first = session_label("Assistant", "run:A");
    turn_ended_in(&f.state, "run:A");
    assert!(
        f.launcher
            .wait_for(|calls| calls.iter().any(|entry| {
                entry["tool"] == "end_session" && entry["args"]["session"] == first.as_str()
            }))
            .await
    );
    dispatch(&f, &chat("run:B"), json!({"tool": "list_windows"})).await;
    let second = session_label("Assistant", "run:B");
    assert!(f.launcher.calls().iter().any(|entry| {
        entry["tool"] == "start_session" && entry["args"]["session"] == second.as_str()
    }));
}

#[tokio::test]
async fn dropping_the_turn_guard_ends_the_session() {
    let f = fixture(settings(&[]), &[], ScriptedApprover::default());
    dispatch(&f, &chat("run:a"), json!({"tool": "list_windows"})).await;
    let label = session_label("Assistant", "run:a");
    drop(TurnEndGuard::with_state(f.state.clone(), "run:a".into()));
    assert!(
        f.launcher
            .wait_for(|calls| calls.iter().any(|entry| {
                entry["tool"] == "end_session" && entry["args"]["session"] == label.as_str()
            }))
            .await
    );
}

// --- Bridge and task decorator ----------------------------------------------

#[tokio::test]
async fn a_closed_bridge_answers_gone_and_ends_its_session() {
    let f = fixture(settings(&[]), &[], ScriptedApprover::default());
    let scope = CuaScope {
        grant_key: "acp:x".into(),
        session_key: "acp:x".into(),
        project_id: None,
        agent_label: "Agent".into(),
        surface: Surface::Acp,
    };
    let bridge = super::CuaBridge::start_with(scope, f.state.clone())
        .await
        .unwrap();
    let server = bridge.mcp_server();
    let url = server["url"].as_str().unwrap().to_string();
    let auth = server["headers"][0]["value"].as_str().unwrap().to_string();
    let post = |body: Value| {
        let url = url.clone();
        let auth = auth.clone();
        async move {
            reqwest::Client::new()
                .post(url)
                .header("authorization", auth)
                .json(&body)
                .send()
                .await
                .unwrap()
        }
    };
    let called: Value = post(json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": "desktop_apps", "arguments": {"tool": "get_window_state", "args": {"pid": 1}}}}))
    .await
    .json()
    .await
    .unwrap();
    assert_eq!(called["result"]["content"][1]["type"], "image", "{called}");
    bridge.close();
    let gone = post(json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})).await;
    assert_eq!(gone.status(), 410);
    let label = session_label("Agent", "acp:x");
    assert!(
        f.launcher
            .wait_for(|calls| calls.iter().any(|entry| {
                entry["tool"] == "end_session" && entry["args"]["session"] == label.as_str()
            }))
            .await
    );
    bridge.shutdown().await;
}

struct InnerBridge {
    shut: AtomicBool,
}

impl TaskBridge for InnerBridge {
    fn mcp_server(&self) -> Value {
        json!({"type": "http", "name": "oleafly-research", "url": "http://127.0.0.1:9/mcp", "headers": []})
    }

    fn call_tool(self: Arc<Self>, name: String, _args: Value) -> TaskRuntimeFuture<Value> {
        Box::pin(async move { Ok(json!({"inner": name})) })
    }

    fn shutdown(
        self: Arc<Self>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
        Box::pin(async move { self.shut.store(true, Ordering::SeqCst) })
    }
}

#[tokio::test]
async fn tasks_get_desktop_apps_only_when_the_brief_allows_it_and_someone_is_there() {
    let off = fixture(CuaDriverConfig::default(), &[], ScriptedApprover::default());
    let inner: Arc<dyn TaskBridge> = Arc::new(InnerBridge {
        shut: AtomicBool::new(false),
    });
    let plain = super::task::DesktopAppsTaskBridge::wrap_with(
        inner.clone(),
        off.state.clone(),
        "t1",
        1,
        "p1",
    )
    .await
    .unwrap();
    assert!(!plain
        .tool_definitions()
        .iter()
        .any(|tool| tool.name == "desktop_apps"));
    assert_eq!(plain.mcp_servers().len(), 1);

    let on = fixture(settings(&[]), &[], ScriptedApprover::default());
    let wrapped =
        super::task::DesktopAppsTaskBridge::wrap_with(inner, on.state.clone(), "t1", 1, "p1")
            .await
            .unwrap();
    assert!(wrapped
        .tool_definitions()
        .iter()
        .any(|tool| tool.name == "desktop_apps"));
    let servers = wrapped.mcp_servers();
    assert_eq!(servers.len(), 2);
    assert_eq!(servers[1]["name"], super::bridge::BRIDGE_SERVER_NAME);
    wrapped.shutdown().await;
}

#[tokio::test]
async fn task_desktop_calls_use_task_grants_and_end_at_shutdown() {
    let f = fixture(
        settings(&[]),
        &[],
        ScriptedApprover::with(&[Answer::Session]),
    );
    let inner = Arc::new(InnerBridge {
        shut: AtomicBool::new(false),
    });
    let wrapped = super::task::DesktopAppsTaskBridge::wrap_with(
        inner.clone() as Arc<dyn TaskBridge>,
        f.state.clone(),
        "t1",
        1,
        "p1",
    )
    .await
    .unwrap();
    let click = json!({"tool": "click", "args": {"pid": 1}});
    for _ in 0..2 {
        let result = wrapped
            .clone()
            .call_tool("desktop_apps".into(), click.clone())
            .await
            .unwrap();
        assert_eq!(result["isError"], false, "{result}");
    }
    assert_eq!(f.approver.asked().len(), 1);
    assert_eq!(
        wrapped
            .clone()
            .call_tool("read_file".into(), json!({}))
            .await
            .unwrap(),
        json!({"inner": "read_file"})
    );
    wrapped.shutdown().await;
    assert!(inner.shut.load(Ordering::SeqCst));
    let label = session_label("Research task", "task:t1:1");
    assert!(
        f.launcher
            .wait_for(|calls| calls.iter().any(|entry| {
                entry["tool"] == "end_session" && entry["args"]["session"] == label.as_str()
            }))
            .await
    );
}
