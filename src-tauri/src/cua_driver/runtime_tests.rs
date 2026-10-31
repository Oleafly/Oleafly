use std::collections::{BTreeMap, HashMap, HashSet};
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
use super::runtime::{
    DaemonHandle, DaemonLaunch, Launcher, RuntimePaths, IDLE_STOP, STOPPED_TEXT, TIMEOUT_TEXT,
};
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
const selfCheck = process.env.FAKE_SELF_CHECK || '';
const structured = process.env.FAKE_STRUCTURED === '1';
const huge = process.env.FAKE_HUGE || '';
const marker = log + '.expired';
const started = new Set();
let counted = 0;
const names = ['start_session','end_session','list_apps','list_windows','get_window_state','get_browser_state','launch_app','click','double_click','right_click','type_text','press_key','hotkey','scroll','set_value','run_steps','run_script','browser_prepare','browser_navigate','browser_click','browser_type','browser_select','health_report'];
const properties = {pid: {type: 'integer'}, session: {type: 'string'}};
for (const key of ['window_id','element_index','element_token','snapshot_id','x','y','text','key','keys','url','ref','value','steps','stop_on_error','profile','note','bundle_id','include_screenshot','target_id','tab_id','allow_launch','strategy','snapshot_format']) properties[key] = {};
const tools = names.map((name) => ({
  name,
  description: name + ' does a thing. More detail here.',
  inputSchema: {type: 'object', properties, required: name === 'click' ? ['pid'] : []},
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
  if (name === 'get_screen_size') {
    if (standard) answer({content: [{type: 'text', text: '1920x1080'}]});
    else if (selfCheck === 'fails') answer({content: [{type: 'text', text: 'no display'}], isError: true, structuredContent: {code: 'tool_invocation_failed'}});
    else if (selfCheck === 'denied_other') answer(refused('permission_denied', 'screen recording is not granted'));
    else answer(refused('permission_denied', 'not in the capability manifest'));
    return;
  }
  if (name === hang) return;
  if (name === 'start_session') { started.add(args.session); answer({content: [{type: 'text', text: 'started'}]}); return; }
  if (name === 'end_session') { started.delete(args.session); answer({content: [{type: 'text', text: 'ended'}]}); return; }
  counted += 1;
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  if (expireOn > 0 && counted === expireOn && !fs.existsSync(marker)) { fs.writeFileSync(marker, '1'); answer(refused('permission_denied', 'capability manifest idle timeout exceeded')); return; }
  if (args.session !== undefined && !started.has(args.session)) { answer(refused('session_ended', 'that session ended')); return; }
  if (name === fail) { answer({content: [{type: 'text', text: 'it failed'}], isError: true, structuredContent: {code: 'tool_invocation_failed'}}); return; }
  if (name === huge) { answer({content: [{type: 'text', text: 'x'.repeat(40000)}]}); return; }
  if (name === 'browser_prepare' && structured) { answer({content: [{type: 'text', text: 'launched'}], structuredContent: {status: 'ok', prepared_pid: 777}}); return; }
  if (name === 'list_windows' && structured && args.pid === 777) { answer({content: [{type: 'text', text: '2 windows'}], structuredContent: {windows: [{pid: 777, window_id: 8, layer: 0, title: 'Restore pages?', bounds: {width: 320, height: 238}}, {pid: 777, window_id: 9, layer: 0, title: 'about:blank', bounds: {width: 1200, height: 900}}]}}); return; }
  if (name === 'get_browser_state' && structured) { answer(args.target_id ? {content: [{type: 'text', text: 'snapshot'}], structuredContent: {mode: 'snapshot', status: 'ok', target_id: args.target_id, tab_id: args.tab_id}} : {content: [{type: 'text', text: 'bound'}], structuredContent: {mode: 'bind', status: 'ok', target_id: 'bt-1', tabs: [{tab_id: 'tab-1', active: true}]}}); return; }
  if (name === 'list_windows' && structured) { answer({content: [{type: 'text', text: '1 window'}], structuredContent: {windows: [{pid: 4312, window_id: 88, app_name: 'Zotero', title: 'My Library'}]}}); return; }
  if (name === 'get_window_state' && structured) { answer({content: [{type: 'text', text: 'window tree'}, {type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo='}], structuredContent: {snapshot_id: 's1', pid: args.pid, window_id: args.window_id, elements: [{element_index: 0, element_token: 'el-0', role: 'AXButton', label: 'Export'}]}}); return; }
  if (name === 'get_window_state') { answer({content: [{type: 'text', text: 'window tree'}, {type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo='}]}); return; }
  answer({content: [{type: 'text', text: name + ' ok'}]});
});
"#;

struct FakeLauncher {
    log: PathBuf,
    env: BTreeMap<String, String>,
    opened: Mutex<HashMap<RuntimeKind, usize>>,
    failing: Mutex<HashSet<RuntimeKind>>,
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
            failing: Mutex::new(HashSet::new()),
        })
    }

    fn fail(&self, kind: RuntimeKind) {
        lock(&self.failing).insert(kind);
    }

    fn opened(&self, kind: RuntimeKind) -> usize {
        lock(&self.opened).get(&kind).copied().unwrap_or(0)
    }

    fn calls(&self) -> Vec<Value> {
        std::fs::read_to_string(&self.log)
            .unwrap_or_default()
            .lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .filter(|entry| entry["phase"] == "start")
            .collect()
    }

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
            if lock(&self.failing).contains(&kind) {
                return Err(super::runtime::start_failed("no browser on this computer"));
            }
            *lock(&self.opened).entry(kind).or_default() += 1;
            let mut env = self.env.clone();
            env.insert("FAKE_KIND".into(), kind.as_str().into());
            let max_message_bytes = self
                .env
                .get("FAKE_MAX_MESSAGE_BYTES")
                .and_then(|bytes| bytes.parse().ok())
                .unwrap_or(16 * 1024 * 1024);
            McpStdioSession::open(
                "node",
                &["-e".into(), FAKE_DRIVER.into()],
                &env,
                McpSessionLimits {
                    max_message_bytes,
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
        ask_before_actions: true,
    }
}

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
        task_title: None,
    }
}

const WAIT: Duration = Duration::from_secs(10);

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
async fn oleafly_answers_list_apps_from_the_allowed_apps() {
    // Cua Driver 0.38 refuses an unbounded list of apps or windows, so
    // neither reaches the driver; a list of one app's windows does.
    let mut config = settings(&[]);
    config.apps = vec![AllowedApp {
        name: "Nowhere".into(),
        bundle_id: Some("org.example.never-installed".into()),
        executable: Some("/nonexistent/oleafly-test-app".into()),
    }];
    let f = fixture(config, &[], ScriptedApprover::default());
    let apps = dispatch(&f, &chat("run:a"), json!({"tool": "list_apps"})).await;
    assert!(!apps.is_error, "{}", apps.text);
    assert!(apps.text.starts_with("Allowed apps:"), "{}", apps.text);
    assert!(apps.text.contains("Nowhere"), "{}", apps.text);
    let windows = dispatch(&f, &chat("run:a"), json!({"tool": "list_windows"})).await;
    assert!(!windows.is_error, "{}", windows.text);
    assert!(
        windows.text.contains("None of the allowed apps is running"),
        "{}",
        windows.text
    );
    assert!(!f
        .launcher
        .calls()
        .iter()
        .any(|entry| entry["tool"] == "list_apps" || entry["tool"] == "list_windows"));
}

#[tokio::test]
async fn a_call_that_leaves_out_its_pid_gets_the_one_the_driver_gave() {
    // Cua Driver 0.38 refuses a window call that names no pid ("window
    // resource did not attest a pid"), and agents pass the window_id or
    // element_token they were shown.
    let f = fixture(
        settings(&[]),
        &[("FAKE_STRUCTURED", "1")],
        ScriptedApprover::with(&[Answer::Once]),
    );
    let windows = dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "list_windows", "args": {"pid": 4312}}),
    )
    .await;
    assert!(!windows.is_error, "{}", windows.text);
    let state = dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "get_window_state", "args": {"window_id": 88}}),
    )
    .await;
    assert!(!state.is_error, "{}", state.text);
    // 0.38's element tokens are `<snapshot_id>:<row>`.
    let typed = dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "type_text", "args": {"element_token": "s1:0", "text": "hi"}}),
    )
    .await;
    assert!(!typed.is_error, "{}", typed.text);
    let pids: Vec<(String, Value)> = f
        .launcher
        .calls()
        .iter()
        .filter(|entry| entry["phase"] == "start")
        .filter(|entry| entry["tool"] == "get_window_state" || entry["tool"] == "type_text")
        .map(|entry| {
            (
                entry["tool"].as_str().unwrap().to_string(),
                entry["args"]["pid"].clone(),
            )
        })
        .collect();
    assert_eq!(
        pids,
        vec![
            ("get_window_state".to_string(), json!(4312)),
            ("type_text".to_string(), json!(4312)),
        ]
    );
    let unknown = dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "click", "args": {"window_id": 999}}),
    )
    .await;
    assert!(unknown.is_error);
    assert_eq!(unknown.text, super::policy::NEEDS_PID_TEXT);
    assert_eq!(f.approver.asked().len(), 1);
    assert!(!f
        .launcher
        .calls()
        .iter()
        .any(|entry| entry["tool"] == "click"));
    turn_ended_in(&f.state, "run:a");
    let carried = dispatch(
        &f,
        &chat("run:b"),
        json!({"tool": "type_text", "args": {"element_token": "s1:0", "text": "again"}}),
    )
    .await;
    assert!(carried.is_error);
    assert_eq!(carried.text, super::policy::EARLIER_TURN_TEXT);
    assert_eq!(f.approver.asked().len(), 1);
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
            json!({"tool": "type_text", "args": {"pid": 1, "text": "hi"}})
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
        json!({"tool": "type_text", "args": {"pid": 1, "text": secret}}),
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
    assert_eq!(
        outcome.text,
        "The user didn't answer the approval dialog in time, so nothing was done."
    );
    assert!(f.launcher.calls().is_empty());
    assert!(lock(&super::TEST_LOG)
        .iter()
        .any(|line| line == "desktop apps: click refused:no_answer"));
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
async fn a_website_runs_in_the_browser_oleafly_opened() {
    // 0.38 binds a tab through its browser's window and wants the target
    // and tab on every later call; agents pass none of them.
    let f = fixture(
        settings(&[("https://example.org", false)]),
        &[("FAKE_STRUCTURED", "1")],
        ScriptedApprover::with(&[Answer::Once, Answer::Once]),
    );
    let scope = chat("run:a");
    let call = |tool: &str, args: Value| json!({"tool": tool, "args": args});
    let early = dispatch(&f, &scope, call("get_browser_state", json!({}))).await;
    assert_eq!(early.text, super::browser::PREPARE_FIRST_TEXT);
    let prepared = dispatch(&f, &scope, call("browser_prepare", json!({}))).await;
    assert!(!prepared.is_error, "{}", prepared.text);
    let unbound = dispatch(
        &f,
        &scope,
        call("browser_navigate", json!({"url": "https://example.org"})),
    )
    .await;
    assert_eq!(unbound.text, super::browser::BIND_FIRST_TEXT);
    for (tool, args) in [
        ("get_browser_state", json!({})),
        ("browser_navigate", json!({"url": "https://example.org/a"})),
        ("get_browser_state", json!({})),
    ] {
        let outcome = dispatch(&f, &scope, call(tool, args)).await;
        assert!(!outcome.is_error, "{tool}: {}", outcome.text);
    }
    let away = dispatch(
        &f,
        &scope,
        call(
            "browser_navigate",
            json!({"url": "https://www.wikipedia.org"}),
        ),
    )
    .await;
    assert_eq!(away.text, super::policy::OUTSIDE_TEXT);
    let other = dispatch(&f, &scope, call("get_browser_state", json!({"pid": 1234}))).await;
    assert_eq!(other.text, super::browser::OWN_BROWSER_TEXT);
    assert_eq!(f.approver.asked().len(), 2);

    let sent: Vec<(String, Value)> = f
        .launcher
        .calls()
        .iter()
        .filter(|entry| entry["phase"] == "start" && entry["kind"] == "browser")
        .filter(|entry| entry["tool"] != "start_session" && entry["tool"] != "get_screen_size")
        .map(|entry| {
            let mut args = entry["args"].clone();
            args.as_object_mut().unwrap().remove("session");
            (entry["tool"].as_str().unwrap().to_string(), args)
        })
        .collect();
    let tab = json!({"target_id": "bt-1", "tab_id": "tab-1", "snapshot_format": "semantic_v2"});
    assert_eq!(
        sent,
        vec![
            (
                "browser_prepare".to_string(),
                json!({"allow_launch": true, "profile": {"mode": "isolated_named", "name": "oleafly"}})
            ),
            ("list_windows".to_string(), json!({"pid": 777})),
            (
                "get_browser_state".to_string(),
                json!({"pid": 777, "window_id": 9})
            ),
            (
                "browser_navigate".to_string(),
                json!({"target_id": "bt-1", "tab_id": "tab-1", "url": "https://example.org/a"})
            ),
            ("get_browser_state".to_string(), tab),
        ]
    );
}

#[tokio::test]
async fn browser_tools_route_by_profile() {
    let f = fixture(
        settings(&[("https://a.org", true), ("https://b.org", false)]),
        &[],
        ScriptedApprover::with(&[Answer::Once, Answer::Once]),
    );
    let navigate = |browser: Option<&str>| {
        let mut arguments = json!({"tool": "browser_navigate", "args": {"url": "https://a.org/x", "target_id": "bt-1", "tab_id": "tab-1"}});
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
async fn with_asking_off_actions_run_without_a_dialog() {
    let config = CuaDriverConfig {
        ask_before_actions: false,
        ..settings(&[("https://a.org", true)])
    };
    let f = fixture(config, &[], ScriptedApprover::default());
    let started = dispatch(&f, &chat("run:a"), json!({"tool": "start_session"})).await;
    assert!(
        started.text.contains("run without asking the user"),
        "{}",
        started.text
    );
    for request in [
        json!({"tool": "click", "args": {"pid": 1}}),
        json!({"tool": "browser_click", "browser": "signed_in",
            "args": {"ref": "e1", "target_id": "bt-1", "tab_id": "tab-1"}}),
    ] {
        let outcome = dispatch(&f, &chat("run:a"), request).await;
        assert!(!outcome.is_error, "{}", outcome.text);
    }
    assert!(f.approver.asked().is_empty());
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
    let denied = dispatch(&f, &scope, json!({"tool": "click", "args": {"pid": 1}})).await;
    assert_eq!(denied.text, super::gate::DENIED_TEXT);
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
    dispatch(
        &f,
        &chat("run:A"),
        json!({"tool": "list_windows", "args": {"pid": 1}}),
    )
    .await;
    let first = session_label("Assistant", "run:A");
    turn_ended_in(&f.state, "run:A");
    assert!(
        f.launcher
            .wait_for(|calls| calls.iter().any(|entry| {
                entry["tool"] == "end_session" && entry["args"]["session"] == first.as_str()
            }))
            .await
    );
    dispatch(
        &f,
        &chat("run:B"),
        json!({"tool": "list_windows", "args": {"pid": 1}}),
    )
    .await;
    let second = session_label("Assistant", "run:B");
    assert!(f.launcher.calls().iter().any(|entry| {
        entry["tool"] == "start_session" && entry["args"]["session"] == second.as_str()
    }));
}

#[tokio::test]
async fn dropping_the_turn_guard_ends_the_session() {
    let f = fixture(settings(&[]), &[], ScriptedApprover::default());
    dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "list_windows", "args": {"pid": 1}}),
    )
    .await;
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

#[tokio::test]
async fn a_closed_bridge_answers_gone_and_ends_its_session() {
    let f = fixture(settings(&[]), &[], ScriptedApprover::default());
    let scope = CuaScope {
        grant_key: "acp:x".into(),
        session_key: "acp:x".into(),
        project_id: None,
        agent_label: "Agent".into(),
        surface: Surface::Acp,
        task_title: None,
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
        "Survey",
    )
    .await
    .unwrap();
    assert!(!plain
        .tool_definitions()
        .iter()
        .any(|tool| tool.name == "desktop_apps"));
    assert_eq!(plain.mcp_servers().len(), 1);

    let on = fixture(settings(&[]), &[], ScriptedApprover::default());
    let wrapped = super::task::DesktopAppsTaskBridge::wrap_with(
        inner,
        on.state.clone(),
        "t1",
        1,
        "p1",
        "Survey",
    )
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
        "Export the survey data",
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
    assert!(
        f.approver.asked()[0].contains("Task: Export the survey data"),
        "{}",
        f.approver.asked()[0]
    );
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

#[tokio::test]
async fn a_signed_in_action_always_asks_and_never_shares_a_separate_profile_grant() {
    let f = fixture(
        settings(&[("https://a.org", true)]),
        &[],
        ScriptedApprover::with(&[Answer::Session, Answer::Session, Answer::Once]),
    );
    let click = |browser: &str| json!({"tool": "browser_click", "browser": browser, "args": {"ref": "e1", "target_id": "bt-1", "tab_id": "tab-1"}});
    for _ in 0..2 {
        let outcome = dispatch(&f, &chat("run:a"), click("separate")).await;
        assert!(!outcome.is_error, "{}", outcome.text);
    }
    assert_eq!(f.approver.asked().len(), 1);
    for expected in [2, 3] {
        assert!(
            !dispatch(&f, &chat("run:a"), click("signed_in"))
                .await
                .is_error
        );
        assert_eq!(f.approver.asked().len(), expected);
    }
    let asked = f.approver.asked();
    assert!(!asked[0].contains("signed-in browser"), "{}", asked[0]);
    assert!(
        asked[1].contains("This acts in your own signed-in browser."),
        "{}",
        asked[1]
    );
    assert_eq!(*lock(&f.approver.session_options), vec![true, false, false]);
    let kinds: Vec<String> = f
        .launcher
        .calls()
        .iter()
        .filter(|entry| entry["tool"] == "browser_click")
        .map(|entry| entry["kind"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        kinds,
        vec![
            "browser",
            "browser",
            "signed-in-browser",
            "signed-in-browser"
        ]
    );
}

#[tokio::test]
async fn the_signed_in_dialog_names_the_site_it_goes_to() {
    let f = fixture(
        settings(&[("https://journal.example.org", true)]),
        &[],
        ScriptedApprover::with(&[Answer::Once]),
    );
    let outcome = dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "browser_navigate", "browser": "signed_in",
            "args": {"url": "https://journal.example.org/submit", "target_id": "bt-1", "tab_id": "tab-1"}}),
    )
    .await;
    assert!(!outcome.is_error, "{}", outcome.text);
    assert!(
        f.approver.asked()[0]
            .contains("This acts in your own signed-in browser, on https://journal.example.org."),
        "{}",
        f.approver.asked()[0]
    );
}

fn batch(steps: Value) -> Value {
    json!({"tool": "run_steps", "args": {"steps": steps}})
}

#[tokio::test]
async fn allowing_a_batch_for_the_chat_allows_only_the_tools_it_listed() {
    let f = fixture(
        settings(&[]),
        &[],
        ScriptedApprover::with(&[Answer::Session, Answer::Once, Answer::Once]),
    );
    let clicks = batch(json!([
        {"tool": "click", "args": {"pid": 1}},
        {"tool": "double_click", "args": {"pid": 1}}
    ]));
    assert!(!dispatch(&f, &chat("run:a"), clicks.clone()).await.is_error);
    assert_eq!(f.approver.asked().len(), 1);
    assert!(!dispatch(&f, &chat("run:a"), clicks).await.is_error);
    assert_eq!(f.approver.asked().len(), 1);
    let typing = batch(json!([
        {"tool": "click", "args": {"pid": 1}},
        {"type_text": {"text": "anything at all"}}
    ]));
    assert!(!dispatch(&f, &chat("run:a"), typing).await.is_error);
    assert_eq!(f.approver.asked().len(), 2);
    assert!(
        f.approver.asked()[1].contains("2. type_text"),
        "{}",
        f.approver.asked()[1]
    );
    assert!(
        !dispatch(
            &f,
            &chat("run:a"),
            json!({"tool": "type_text", "args": {"pid": 1, "text": "hi"}})
        )
        .await
        .is_error
    );
    assert_eq!(f.approver.asked().len(), 3);
    assert!(
        !dispatch(
            &f,
            &chat("run:a"),
            json!({"tool": "click", "args": {"pid": 1}})
        )
        .await
        .is_error
    );
    assert_eq!(f.approver.asked().len(), 3);
}

#[tokio::test]
async fn steps_the_dialog_did_not_list_never_run_and_are_not_allowed_for_the_chat() {
    let f = fixture(
        settings(&[]),
        &[],
        ScriptedApprover::with(&[Answer::Session, Answer::Once]),
    );
    let mut steps: Vec<Value> = (0..60)
        .map(|index| json!({"tool": "click", "args": {"x": index, "note": "n".repeat(150)}}))
        .collect();
    steps.push(json!({"tool": "hotkey", "args": {"keys": ["cmd", "q"]}}));
    let outcome = dispatch(&f, &chat("run:a"), batch(Value::Array(steps))).await;
    assert!(!outcome.is_error, "{}", outcome.text);
    let message = f.approver.asked()[0].clone();
    let last = message.lines().last().unwrap();
    assert!(
        last.starts_with("Steps not shown and not run: "),
        "{message}"
    );
    assert!(!message.contains("hotkey"), "{message}");
    let shown = message
        .lines()
        .filter(|line| line.contains(". click"))
        .count();
    assert!(shown > 0 && shown < 61, "{shown}");
    let sent = f
        .launcher
        .calls()
        .into_iter()
        .find(|entry| entry["tool"] == "run_steps")
        .unwrap();
    let forwarded = sent["args"]["steps"].as_array().unwrap();
    assert_eq!(forwarded.len(), shown);
    assert!(
        forwarded.iter().all(|step| step["tool"] == "click"),
        "{sent}"
    );
    assert!(
        outcome
            .text
            .contains(&format!("Only the first {shown} of 61 steps ran")),
        "{}",
        outcome.text
    );
    assert!(
        !dispatch(
            &f,
            &chat("run:a"),
            json!({"tool": "hotkey", "args": {"pid": 1, "keys": ["cmd", "c"]}})
        )
        .await
        .is_error
    );
    assert_eq!(f.approver.asked().len(), 2);
}

#[tokio::test]
async fn the_driver_runs_the_steps_that_were_listed_and_nothing_else() {
    let f = fixture(settings(&[]), &[], ScriptedApprover::with(&[Answer::Once]));
    let outcome = dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "run_steps", "args": {
            "steps": [
                {"tool": "click", "args": {"pid": 1, "session": "other"}, "extra": true},
                {"type_text": {"text": "hi"}}
            ],
            "stop_on_error": false
        }}),
    )
    .await;
    assert!(!outcome.is_error, "{}", outcome.text);
    let sent = f
        .launcher
        .calls()
        .into_iter()
        .find(|entry| entry["tool"] == "run_steps")
        .unwrap();
    let label = session_label("Assistant", "run:a");
    assert_eq!(
        sent["args"],
        json!({
            "steps": [
                {"tool": "click", "args": {"pid": 1}},
                {"type_text": {"text": "hi"}}
            ],
            "session": label
        })
    );
}

#[tokio::test]
async fn a_deny_rule_refuses_start_session_before_any_daemon_starts() {
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
    let outcome = dispatch(&f, &scope, json!({"tool": "start_session"})).await;
    assert!(outcome.is_error);
    assert_eq!(outcome.text, super::gate::DENIED_TEXT);
    assert!(f.launcher.calls().is_empty());
    assert_eq!(f.launcher.opened(RuntimeKind::Desktop), 0);
    let other = CuaScope {
        project_id: Some("p2".into()),
        ..chat("run:b")
    };
    assert!(
        !dispatch(&f, &other, json!({"tool": "start_session"}))
            .await
            .is_error
    );
}

#[tokio::test]
async fn start_session_lists_a_runtime_that_could_not_start_and_keeps_the_rest() {
    let f = fixture(
        settings(&[("https://a.org", false)]),
        &[],
        ScriptedApprover::default(),
    );
    f.launcher.fail(RuntimeKind::Browser);
    let outcome = dispatch(&f, &chat("run:a"), json!({"tool": "start_session"})).await;
    assert!(!outcome.is_error, "{}", outcome.text);
    assert!(
        outcome.text.contains("Allowed apps: Zotero"),
        "{}",
        outcome.text
    );
    assert!(outcome.text.contains("- click {pid"), "{}", outcome.text);
    assert!(
        outcome.text.contains("Not available right now"),
        "{}",
        outcome.text
    );
    assert!(
        outcome
            .text
            .contains("- Websites in a separate profile: Cua Driver couldn't start: no browser on this computer"),
        "{}",
        outcome.text
    );
    let apps = dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "get_window_state", "args": {"pid": 1}}),
    )
    .await;
    assert!(!apps.is_error, "{}", apps.text);

    let g = fixture(
        settings(&[("https://a.org", false)]),
        &[],
        ScriptedApprover::default(),
    );
    g.launcher.fail(RuntimeKind::Desktop);
    g.launcher.fail(RuntimeKind::Browser);
    let none = dispatch(&g, &chat("run:a"), json!({"tool": "start_session"})).await;
    assert!(none.is_error);
    assert!(none.text.contains("- Apps: "), "{}", none.text);
    assert!(
        none.text.contains("- Websites in a separate profile: "),
        "{}",
        none.text
    );
}

#[tokio::test]
async fn a_turn_that_ends_while_a_dialog_is_open_stops_the_call() {
    let approver = ScriptedApprover {
        delay: Duration::from_secs(60),
        ..ScriptedApprover::with(&[Answer::Once])
    };
    let f = fixture(settings(&[]), &[], approver);
    let state = f.state.clone();
    let call = tokio::spawn(async move {
        call_desktop_apps(
            &state,
            &chat("run:a"),
            json!({"tool": "click", "args": {"pid": 1}}),
        )
        .await
    });
    assert!(eventually(|| f.approver.asked().len() == 1).await);
    let started = Instant::now();
    turn_ended_in(&f.state, "run:a");
    let outcome = tokio::time::timeout(Duration::from_secs(5), call)
        .await
        .expect("the call stops waiting")
        .unwrap();
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(outcome.is_error);
    assert!(outcome.text.contains("turn ended"), "{}", outcome.text);
    assert!(!f.launcher.tools().contains(&"click".to_string()));
}

async fn eventually(check: impl Fn() -> bool) -> bool {
    let deadline = Instant::now() + WAIT;
    while Instant::now() < deadline {
        if check() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    false
}

#[tokio::test]
async fn a_chat_result_keeps_no_second_copy_of_the_screenshot() {
    let f = fixture(settings(&[]), &[], ScriptedApprover::default());
    let chat_outcome = dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "get_window_state", "args": {"pid": 1}}),
    )
    .await;
    assert_eq!(chat_outcome.images.len(), 1);
    assert!(chat_outcome.mcp_result.is_null());
    let acp = CuaScope {
        surface: Surface::Acp,
        ..chat("acp:a")
    };
    let bridged = dispatch(
        &f,
        &acp,
        json!({"tool": "get_window_state", "args": {"pid": 1}}),
    )
    .await;
    assert_eq!(bridged.mcp_result["content"][1]["type"], "image");
}

#[tokio::test]
async fn cancelling_a_kind_stops_a_call_that_is_waiting_for_the_driver() {
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
    let started = Instant::now();
    f.state.runtimes.cancel(&[RuntimeKind::Desktop]);
    let result = tokio::time::timeout(Duration::from_secs(5), call)
        .await
        .expect("the call stops")
        .unwrap();
    assert_eq!(result.unwrap_err(), STOPPED_TEXT);
    assert!(started.elapsed() < Duration::from_secs(5));
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
async fn a_settings_change_marks_only_the_runtimes_whose_manifest_changed() {
    let f = fixture(
        settings(&[("https://a.org", false)]),
        &[],
        ScriptedApprover::default(),
    );
    for (kind, tool) in [
        (RuntimeKind::Desktop, "list_apps"),
        (RuntimeKind::Browser, "get_browser_state"),
    ] {
        f.state
            .runtimes
            .call(kind, "", tool, json!({}), WAIT)
            .await
            .unwrap();
    }
    assert!(f.state.runtimes.stale_kinds().is_empty());
    f.state.set_settings(settings(&[
        ("https://a.org", false),
        ("https://b.org", false),
    ]));
    assert_eq!(f.state.runtimes.stale_kinds(), vec![RuntimeKind::Browser]);
    f.state.runtimes.stop_changed().await;
    assert_eq!(f.state.runtimes.running(), vec![RuntimeKind::Desktop]);
}

#[tokio::test]
async fn a_driver_that_fails_the_self_check_for_another_reason_is_not_trusted() {
    for mode in ["fails", "denied_other"] {
        let f = fixture(
            settings(&[]),
            &[("FAKE_SELF_CHECK", mode)],
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
        assert!(
            error.contains("desktop_apps.not_bounded"),
            "{mode}: {error}"
        );
        assert!(f.state.runtimes.running().is_empty(), "{mode}");
    }
}

/// A launcher whose daemon is a real process (`sleep`) that never becomes
/// ready: a start that is stuck, as a slow first launch of the macOS app is.
#[cfg(unix)]
#[derive(Default)]
struct StuckStart {
    pid: Mutex<Option<u32>>,
    owner_file_when_waiting: Mutex<Option<bool>>,
}

#[cfg(unix)]
impl Launcher for StuckStart {
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
        Box::pin(async move {
            let mut child = std::process::Command::new("sleep")
                .arg("300")
                .spawn()
                .map_err(|error| error.to_string())?;
            let pid = child.id();
            let started = match crate::process_identity::probe(pid) {
                crate::process_identity::ProcessProbe::Running { started } => started,
                crate::process_identity::ProcessProbe::Gone => None,
            };
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            *lock(&self.pid) = Some(pid);
            Ok(DaemonHandle::Detached { pid, started })
        })
    }

    fn wait_ready<'a>(
        &'a self,
        _install: &'a DriverInstall,
        paths: &'a RuntimePaths,
        _handle: &'a mut DaemonHandle,
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            *lock(&self.owner_file_when_waiting) = Some(paths.owner_file.exists());
            std::future::pending::<()>().await;
            Ok(())
        })
    }

    fn open_session<'a>(
        &'a self,
        _install: &'a DriverInstall,
        _paths: &'a RuntimePaths,
        _env: &'a BTreeMap<String, String>,
    ) -> BoxFuture<'a, Result<McpStdioSession, String>> {
        Box::pin(async { Err(super::runtime::start_failed("never reached")) })
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

#[cfg(unix)]
#[tokio::test]
async fn a_daemon_that_is_still_starting_is_on_record_and_is_ended_at_quit() {
    let dir = tempfile::tempdir().unwrap();
    let launcher = Arc::new(StuckStart::default());
    let state = Arc::new(CuaDriverState::for_test(
        settings(&[]),
        launcher.clone(),
        Arc::new(ScriptedApprover::default()),
        dir.path().to_path_buf(),
    ));
    let starting = state.clone();
    let call = tokio::spawn(async move {
        starting
            .runtimes
            .call(RuntimeKind::Desktop, "", "list_apps", json!({}), WAIT)
            .await
    });
    assert!(eventually(|| lock(&launcher.owner_file_when_waiting).is_some()).await);
    assert_eq!(*lock(&launcher.owner_file_when_waiting), Some(true));
    assert!(state.runtimes.has_daemons());
    assert!(state.runtimes.running().is_empty());
    let pid = lock(&launcher.pid).expect("the daemon started");
    assert!(matches!(
        crate::process_identity::probe(pid),
        crate::process_identity::ProcessProbe::Running { .. }
    ));

    let began = Instant::now();
    super::stop_everything(&state, Duration::from_millis(600)).await;
    assert!(
        began.elapsed() < Duration::from_secs(5),
        "{:?}",
        began.elapsed()
    );
    assert!(
        eventually(|| matches!(
            crate::process_identity::probe(pid),
            crate::process_identity::ProcessProbe::Gone
        ))
        .await
    );
    assert!(!state.runtimes.has_owner_records());
    call.abort();
}

#[test]
fn a_daemon_is_found_by_the_socket_it_serves() {
    let listing = "\
  101 /sbin/launchd
  202 /Applications/CuaDriver.app/Contents/MacOS/cua-driver serve --socket /Users/a b/.oleafly/cua/desktop.sock --pid-file /Users/a b/.oleafly/cua/desktop.pid --permission-mode bounded
  303 /Applications/CuaDriver.app/Contents/MacOS/cua-driver mcp --socket /Users/a b/.oleafly/cua/desktop.sock
  404 /Applications/CuaDriver.app/Contents/MacOS/cua-driver serve --socket /Users/a b/.oleafly/cua/desktop.sock2 --pid-file x
  505 /Applications/CuaDriver.app/Contents/MacOS/cua-driver serve --socket /Users/a b/.oleafly/cua/browser.sock --pid-file y
 7777 cua-driver serve --socket /Users/a b/.oleafly/cua/desktop.sock
";
    let found =
        super::runtime::parse_serving_pids(listing, "/Users/a b/.oleafly/cua/desktop.sock", 7777);
    assert_eq!(found, vec![202]);
    assert!(super::runtime::parse_serving_pids("", "/x.sock", 1).is_empty());
    assert!(super::runtime::parse_serving_pids("not a listing\n 12", "/x.sock", 1).is_empty());
}

#[tokio::test]
async fn arguments_the_driver_does_not_take_never_reach_the_dialog_or_the_driver() {
    let f = fixture(settings(&[]), &[], ScriptedApprover::with(&[Answer::Once]));
    let started = dispatch(&f, &chat("run:a"), json!({"tool": "start_session"})).await;
    assert!(!started.is_error, "{}", started.text);
    let outcome = dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "launch_app", "args": {
            "bundle_id": "org.zotero.zotero",
            "webkit_inspector_port": 9222,
            "text": "Opening Zotero"
        }}),
    )
    .await;
    assert!(!outcome.is_error, "{}", outcome.text);
    let asked = f.approver.asked();
    assert!(
        asked[0].contains("org.zotero.zotero") && !asked[0].contains("webkit_inspector_port"),
        "{}",
        asked[0]
    );
    let sent = f
        .launcher
        .calls()
        .into_iter()
        .find(|entry| entry["tool"] == "launch_app")
        .unwrap();
    assert_eq!(sent["args"]["bundle_id"], "org.zotero.zotero");
    assert!(
        sent["args"].get("webkit_inspector_port").is_none(),
        "{sent}"
    );
}

#[tokio::test]
async fn a_chat_reads_the_element_tokens_the_driver_puts_in_structured_content() {
    let f = fixture(
        settings(&[]),
        &[("FAKE_STRUCTURED", "1")],
        ScriptedApprover::default(),
    );
    let outcome = dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "get_window_state", "args": {"pid": 4312, "window_id": 88}}),
    )
    .await;
    assert!(!outcome.is_error, "{}", outcome.text);
    assert!(outcome.text.starts_with("window tree"), "{}", outcome.text);
    for part in [
        "snapshot_id \"s1\"",
        "element_index 0",
        "element_token \"el-0\"",
        "role \"AXButton\"",
        "label \"Export\"",
    ] {
        assert!(outcome.text.contains(part), "{part}: {}", outcome.text);
    }
    assert_eq!(outcome.images.len(), 1);
}

#[tokio::test]
async fn the_dialog_names_the_app_window_and_element_the_driver_described() {
    let f = fixture(
        settings(&[]),
        &[("FAKE_STRUCTURED", "1")],
        ScriptedApprover::with(&[Answer::Once]),
    );
    dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "list_windows", "args": {"pid": 4312}}),
    )
    .await;
    dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "get_window_state", "args": {"pid": 4312, "window_id": 88}}),
    )
    .await;
    let outcome = dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "click", "args": {"pid": 4312, "element_token": "el-0"}}),
    )
    .await;
    assert!(!outcome.is_error, "{}", outcome.text);
    let asked = f.approver.asked()[0].clone();
    for line in [
        "App: Zotero",
        "Window: My Library",
        "Element: Button \"Export\"",
    ] {
        assert!(asked.lines().any(|shown| shown == line), "{line}: {asked}");
    }
    assert!(asked.contains("\"element_token\":\"el-0\""), "{asked}");
}

#[tokio::test]
async fn an_agent_turn_that_ends_during_a_call_stops_it() {
    let f = fixture(
        settings(&[]),
        &[("FAKE_HANG", "click")],
        ScriptedApprover::with(&[Answer::Once]),
    );
    let scope = CuaScope {
        grant_key: "acp:z".into(),
        surface: Surface::Acp,
        ..chat("acp:z")
    };
    let state = f.state.clone();
    let call = tokio::spawn(async move {
        call_desktop_apps(&state, &scope, json!({"tool": "click", "args": {"pid": 1}})).await
    });
    assert!(
        f.launcher
            .wait_for(|calls| calls.iter().any(|entry| entry["tool"] == "click"))
            .await
    );
    turn_ended_in(&f.state, "acp:z");
    let outcome = tokio::time::timeout(Duration::from_secs(5), call)
        .await
        .expect("the call stops with the turn")
        .unwrap();
    assert!(outcome.is_error);
    assert!(outcome.text.contains("The turn ended"), "{}", outcome.text);
}

#[tokio::test]
async fn turning_desktop_apps_off_while_a_dialog_is_open_says_they_are_off() {
    let approver = ScriptedApprover {
        delay: Duration::from_millis(400),
        ..ScriptedApprover::with(&[Answer::Once])
    };
    let f = fixture(settings(&[]), &[], approver);
    let state = f.state.clone();
    let call = tokio::spawn(async move {
        call_desktop_apps(
            &state,
            &chat("run:a"),
            json!({"tool": "click", "args": {"pid": 1}}),
        )
        .await
    });
    assert!(eventually(|| f.approver.asked().len() == 1).await);
    f.state.set_settings(CuaDriverConfig {
        enabled: false,
        ..settings(&[])
    });
    let outcome = call.await.unwrap();
    assert!(outcome.is_error);
    assert_eq!(
        outcome.text,
        "Computer Use is off. The user can turn it on in Settings > Integrations > Computer Use."
    );
    assert!(!f.launcher.tools().contains(&"click".to_string()));
}

#[tokio::test]
async fn an_answer_too_large_to_read_says_how_to_ask_for_less_and_keeps_the_daemon() {
    let f = fixture(
        settings(&[]),
        &[
            ("FAKE_HUGE", "get_window_state"),
            ("FAKE_MAX_MESSAGE_BYTES", "16384"),
        ],
        ScriptedApprover::default(),
    );
    let outcome = dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "get_window_state", "args": {"pid": 1}}),
    )
    .await;
    assert!(outcome.is_error);
    assert!(
        outcome.text.contains("include_screenshot: false"),
        "{}",
        outcome.text
    );
    assert_ne!(outcome.text, TIMEOUT_TEXT);
    assert_eq!(f.state.runtimes.running(), vec![RuntimeKind::Desktop]);
    let next = dispatch(
        &f,
        &chat("run:a"),
        json!({"tool": "list_windows", "args": {"pid": 1}}),
    )
    .await;
    assert!(!next.is_error, "{}", next.text);
    assert_eq!(f.launcher.opened(RuntimeKind::Desktop), 2);
    let self_checks = f
        .launcher
        .calls()
        .iter()
        .filter(|entry| entry["tool"] == policy::SELF_CHECK_TOOL)
        .count();
    assert_eq!(self_checks, 1);
}

struct LinkProbe;

impl super::config::ExecutableProbe for LinkProbe {
    fn check(&self, path: &str) -> Result<String, super::config::AppRejection> {
        if path == "/usr/local/bin/notes" {
            Ok("/bin/bash".into())
        } else {
            Ok(path.into())
        }
    }
}

#[tokio::test]
async fn startup_checks_the_programs_in_the_background_and_drops_what_a_save_would() {
    let program = |name: &str, path: &str| AllowedApp {
        name: name.into(),
        bundle_id: None,
        executable: Some(path.into()),
    };
    let stored = CuaDriverConfig {
        enabled: true,
        apps: vec![
            program("Notes", "/usr/local/bin/notes"),
            program("Zotero", "/opt/zotero/zotero"),
        ],
        ..Default::default()
    };
    let own = "/opt/oleafly/oleafly";
    let (quick, dropped) = super::config::sanitize_loaded(
        stored,
        super::Platform::Linux,
        &super::config::NameOnlyProbe,
        own,
    );
    assert_eq!(dropped, 0);
    assert_eq!(quick.apps.len(), 2);
    let f = fixture(quick, &[], ScriptedApprover::default());
    let dropped = super::resanitize(
        &f.state,
        super::Platform::Linux,
        Arc::new(LinkProbe),
        own.into(),
    )
    .await;
    assert_eq!(dropped, 1);
    let names: Vec<String> = f
        .state
        .settings()
        .apps
        .into_iter()
        .map(|app| app.name)
        .collect();
    assert_eq!(names, vec!["Zotero".to_string()]);
}
