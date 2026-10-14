use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};

use tauri::ipc::Invoke;
use tauri::Runtime;

use super::commands::CollabCommandError;
use super::state::CollabState;
use crate::app_error::AppError;

pub const TURNED_OFF: &str = "collab.turned_off";
pub const TURNED_OFF_CODE: &str = "turned_off";
pub const SWITCH_COMMAND: &str = "collab_live_collaboration_set";
const COMMAND_PREFIX: &str = "collab_";
const ALWAYS_ANSWERED: [&str; 4] = [
    SWITCH_COMMAND,
    "collab_pending_links",
    "collab_live_stop",
    "collab_live_flush",
];
#[cfg(any(test, feature = "e2e-testing"))]
const SEED_KEY: &str = "oleafly.liveCollaboration";

static ENABLED: AtomicBool = AtomicBool::new(false);

pub fn enabled() -> bool {
    ENABLED.load(Ordering::SeqCst)
}

pub fn startup() {
    ENABLED.store(saved(), Ordering::SeqCst);
}

fn saved() -> bool {
    crate::config::config_path()
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|config| config.get("live_collaboration")?.as_bool())
        .unwrap_or(false)
}

#[cfg(any(test, feature = "e2e-testing"))]
pub fn adopt_seeds(
    every_load: Option<&serde_json::Value>,
    once_per_launch: Option<&serde_json::Value>,
) {
    if let Some(on) = seeded(once_per_launch).or_else(|| seeded(every_load)) {
        ENABLED.store(on, Ordering::SeqCst);
    }
}

#[cfg(any(test, feature = "e2e-testing"))]
fn seeded(seed: Option<&serde_json::Value>) -> Option<bool> {
    match seed?.get(SEED_KEY)? {
        serde_json::Value::String(value) => Some(value == "1"),
        serde_json::Value::Null => Some(false),
        _ => None,
    }
}

pub fn turned_off() -> CollabCommandError {
    CollabCommandError {
        code: TURNED_OFF_CODE,
        message: crate::app_error::english(&AppError::new(TURNED_OFF).to_string())
            .unwrap_or_default(),
    }
}

pub fn refusal(command: &str) -> Option<CollabCommandError> {
    let gated = command.starts_with(COMMAND_PREFIX) && !ALWAYS_ANSWERED.contains(&command);
    (gated && !enabled()).then(turned_off)
}

pub fn gated<R, F>(handler: F) -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static
where
    R: Runtime,
    F: Fn(Invoke<R>) -> bool + Send + Sync + 'static,
{
    move |invoke| match refusal(invoke.message.command()) {
        Some(error) => {
            invoke.resolver.reject(error);
            true
        }
        None => handler(invoke),
    }
}

pub(crate) fn switch_to(state: &CollabState, on: bool) {
    let was = ENABLED.swap(on, Ordering::SeqCst);
    if was && !on {
        state.cancel_sign_in();
        state.cancel_joins();
        super::live::stop_running_session();
    }
}

fn remember(on: bool) -> Result<(), String> {
    if saved() == on {
        return Ok(());
    }
    crate::config::update_config(|config| {
        config.live_collaboration = on;
        Ok(())
    })
}

fn remember_current() -> Result<(), String> {
    static SAVING: Mutex<()> = Mutex::new(());
    let _saving = SAVING.lock().unwrap_or_else(PoisonError::into_inner);
    remember(enabled())
}

#[tauri::command]
pub async fn collab_live_collaboration_set(
    state: tauri::State<'_, CollabState>,
    enabled: bool,
) -> Result<(), String> {
    switch_to(state.inner(), enabled);
    tauri::async_runtime::spawn_blocking(remember_current)
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::Ordering;
    use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
    use std::time::{Duration, Instant};

    use oleafly_collab::{CollabPaths, MemorySecrets, SecretPort, DEVICE_KEY_ACCOUNT};
    use serde_json::{json, Value};
    use tauri::test::MockRuntime;
    use tokio::sync::oneshot::error::TryRecvError;

    use super::{
        adopt_seeds, collab_live_collaboration_set, enabled, refusal, startup, switch_to,
        turned_off, ENABLED, SWITCH_COMMAND, TURNED_OFF_CODE,
    };
    use crate::collab::live::active_for;
    use crate::collab::live::write::rig::{live_turn, LiveRig};
    use crate::collab::state::CollabState;
    use crate::collab::testing::TempLibrary;
    use crate::config::{get_config_blocking, read_config, set_config, write_config, AppConfig};

    static TURN: Mutex<()> = Mutex::new(());

    fn turn() -> MutexGuard<'static, ()> {
        TURN.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn state_in(dir: &tempfile::TempDir) -> (Arc<MemorySecrets>, CollabState) {
        let secrets = Arc::new(MemorySecrets::default());
        let state = CollabState::new(CollabPaths::new(dir.path().join("collab")), secrets.clone());
        (secrets, state)
    }

    fn mock_app(
        state: CollabState,
    ) -> (tauri::App<MockRuntime>, tauri::WebviewWindow<MockRuntime>) {
        let app = tauri::test::mock_builder()
            .manage(state)
            .invoke_handler(crate::traced_commands(tauri::generate_handler![
                collab_live_collaboration_set,
                crate::collab::commands::collab_servers_list,
                crate::collab::commands::collab_server_probe,
                crate::collab::links::collab_pending_links,
                crate::collab::live::commands::collab_live_stop,
                crate::collab::live::commands::collab_live_flush,
            ]))
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        (app, window)
    }

    fn call(
        window: &tauri::WebviewWindow<MockRuntime>,
        command: &str,
        body: Value,
    ) -> Result<Value, Value> {
        tauri::test::get_ipc_response(
            window,
            tauri::webview::InvokeRequest {
                cmd: command.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: if cfg!(windows) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .unwrap(),
                body: body.into(),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .map(|body| body.deserialize::<Value>().unwrap())
    }

    fn refused_code(answer: &Result<Value, Value>) -> Option<String> {
        let Err(refused) = answer else {
            return None;
        };
        let code = refused.get("code")?.as_str()?;
        (code == TURNED_OFF_CODE).then(|| code.to_owned())
    }

    fn registered_collab_commands() -> Vec<&'static str> {
        include_str!("../lib.rs")
            .lines()
            .filter_map(|line| line.trim().strip_suffix(','))
            .filter_map(|path| {
                let name = path.rsplit("::").next()?;
                (path.starts_with("collab::") || name.starts_with("collab_")).then_some(name)
            })
            .collect()
    }

    #[test]
    fn startup_follows_the_saved_switch_and_is_off_without_one() {
        let _turn = turn();
        let _library = TempLibrary::new();
        ENABLED.store(true, Ordering::SeqCst);
        startup();
        assert!(!enabled(), "a first launch must start with the switch off");
        write_config(&AppConfig::default()).unwrap();
        ENABLED.store(true, Ordering::SeqCst);
        startup();
        assert!(!enabled(), "saved settings without the switch mean off");
        let config = AppConfig {
            live_collaboration: true,
            ..AppConfig::default()
        };
        write_config(&config).unwrap();
        startup();
        assert!(
            enabled(),
            "a launch must start with the switch the user left on"
        );
        let config = AppConfig {
            live_collaboration: false,
            ..AppConfig::default()
        };
        write_config(&config).unwrap();
        startup();
        assert!(!enabled());
    }

    #[test]
    fn every_registered_collab_command_is_refused_while_the_switch_is_off() {
        let _turn = turn();
        let commands = registered_collab_commands();
        assert!(commands.len() > 90, "{commands:?}");
        assert!(commands.contains(&SWITCH_COMMAND));
        ENABLED.store(false, Ordering::SeqCst);
        let mut answered: Vec<&str> = commands
            .iter()
            .copied()
            .filter(|command| refusal(command).is_none())
            .collect();
        answered.sort_unstable();
        assert_eq!(
            answered,
            [
                "collab_live_collaboration_set",
                "collab_live_flush",
                "collab_live_stop",
                "collab_pending_links",
            ]
        );
        for command in commands
            .iter()
            .filter(|command| !answered.contains(command))
        {
            let refused = refusal(command).map(|error| error.code);
            assert_eq!(
                refused,
                Some(TURNED_OFF_CODE),
                "{command} answers while off"
            );
        }
        assert!(refusal("read_file").is_none());
        assert!(refusal("get_config").is_none());
        ENABLED.store(true, Ordering::SeqCst);
        for command in &commands {
            assert!(refusal(command).is_none(), "{command} is refused while on");
        }
        ENABLED.store(false, Ordering::SeqCst);
    }

    #[test]
    fn the_app_wraps_every_command_in_the_switch() {
        let source = include_str!("../lib.rs");
        assert!(source.contains("let handler = collab::switch::gated(handler);"));
        assert!(source.contains(".invoke_handler(traced_commands(tauri::generate_handler!["));
        assert!(source.contains("collab::switch::startup();"));
    }

    #[test]
    fn collab_commands_refuse_while_off_and_run_once_the_switch_is_on() {
        let _turn = turn();
        let _library = TempLibrary::new();
        let _live = live_turn();
        let dir = tempfile::tempdir().unwrap();
        let (_secrets, state) = state_in(&dir);
        let (_app, window) = mock_app(state);
        ENABLED.store(false, Ordering::SeqCst);
        let listed = call(&window, "collab_servers_list", json!({}));
        assert_eq!(refused_code(&listed).as_deref(), Some(TURNED_OFF_CODE));
        let probed = call(
            &window,
            "collab_server_probe",
            json!({ "url": "http://127.0.0.1:9" }),
        );
        assert_eq!(refused_code(&probed).as_deref(), Some(TURNED_OFF_CODE));
        assert_eq!(
            listed.unwrap_err(),
            serde_json::to_value(turned_off()).unwrap()
        );

        let switched = call(&window, SWITCH_COMMAND, json!({ "enabled": true }));
        assert_eq!(switched, Ok(Value::Null));
        assert!(enabled());
        assert_eq!(
            call(&window, "collab_servers_list", json!({})),
            Ok(json!([]))
        );
        let probed = call(
            &window,
            "collab_server_probe",
            json!({ "url": "http://127.0.0.1:9" }),
        );
        assert_eq!(refused_code(&probed), None);
        let failed = probed.expect_err("nothing listens on the discard port");
        assert!(failed.get("code").is_some(), "{failed}");

        let switched = call(&window, SWITCH_COMMAND, json!({ "enabled": false }));
        assert_eq!(switched, Ok(Value::Null));
        let listed = call(&window, "collab_servers_list", json!({}));
        assert_eq!(refused_code(&listed).as_deref(), Some(TURNED_OFF_CODE));
    }

    #[test]
    fn stopping_and_flushing_answer_while_off_and_create_nothing_without_a_session() {
        let _turn = turn();
        let _library = TempLibrary::new();
        let _live = live_turn();
        let dir = tempfile::tempdir().unwrap();
        let (secrets, state) = state_in(&dir);
        let (_app, window) = mock_app(state);
        ENABLED.store(false, Ordering::SeqCst);
        let project = json!({ "projectId": "never-live" });
        let stopped = call(&window, "collab_live_stop", project.clone());
        assert_eq!(stopped, Ok(Value::Null));
        let flushed = call(&window, "collab_live_flush", project);
        assert_eq!(flushed, Ok(Value::Null));
        let data = std::env::var_os("OLEAFLY_DATA_DIR").unwrap();
        assert_eq!(std::fs::read_dir(data).unwrap().count(), 0);
        assert!(!dir.path().join("collab").exists());
        assert!(secrets.get(DEVICE_KEY_ACCOUNT).unwrap().is_none());
    }

    #[test]
    fn the_frontend_teardown_after_switching_off_meets_no_refusal() {
        let _turn = turn();
        let _library = TempLibrary::new();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("project");
        std::fs::create_dir_all(&root).unwrap();
        let rig = LiveRig::start("switch-teardown", &root, &[("main.tex", "abc")]);
        let _session = rig.go_live();
        let (_secrets, state) = state_in(&dir);
        let (_app, window) = mock_app(state);
        ENABLED.store(true, Ordering::SeqCst);
        rig.remote("main.tex", "from a peer");
        let switched = call(&window, SWITCH_COMMAND, json!({ "enabled": false }));
        assert_eq!(switched, Ok(Value::Null));
        let project = json!({ "projectId": "switch-teardown" });
        let flushed = call(&window, "collab_live_flush", project.clone());
        assert_eq!(flushed, Ok(Value::Null));
        let stopped = call(&window, "collab_live_stop", project);
        assert_eq!(stopped, Ok(Value::Null));
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            let written = std::fs::read_to_string(root.join("main.tex")).unwrap();
            if written == "from a peer" && active_for("switch-teardown").is_none() {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "the session did not stop cleanly: main.tex holds {written:?}"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn app_links_still_reach_the_turned_off_notice() {
        let _turn = turn();
        let _queue = crate::collab::links::QUEUE_TEST_LOCK
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let dir = tempfile::tempdir().unwrap();
        let (_secrets, state) = state_in(&dir);
        let (_app, window) = mock_app(state);
        ENABLED.store(false, Ordering::SeqCst);
        crate::collab::links::take();
        let link = "oleafly://open?server=https%3A%2F%2Funi.edu&project=x".to_owned();
        crate::collab::links::remember(vec![link.clone()]);
        let pending = call(&window, "collab_pending_links", json!({}));
        assert_eq!(pending, Ok(json!([link])));
    }

    #[test]
    fn the_switch_is_saved_and_a_settings_write_from_the_webview_keeps_it() {
        let _turn = turn();
        let _library = TempLibrary::new();
        let _live = live_turn();
        let dir = tempfile::tempdir().unwrap();
        let (_secrets, state) = state_in(&dir);
        let (_app, window) = mock_app(state);
        ENABLED.store(false, Ordering::SeqCst);
        call(&window, SWITCH_COMMAND, json!({ "enabled": true })).unwrap();
        assert!(read_config().unwrap().live_collaboration);
        let mut incoming = get_config_blocking().unwrap();
        incoming.live_collaboration = false;
        tauri::async_runtime::block_on(set_config(incoming)).unwrap();
        assert!(read_config().unwrap().live_collaboration);
        ENABLED.store(false, Ordering::SeqCst);
        startup();
        assert!(enabled(), "the next launch starts with the saved switch");
        call(&window, SWITCH_COMMAND, json!({ "enabled": false })).unwrap();
        assert!(!read_config().unwrap().live_collaboration);
        assert!(!enabled());
    }

    #[test]
    fn turning_the_switch_off_stops_the_live_session_after_writing_it_out() {
        let _turn = turn();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("project");
        std::fs::create_dir_all(&root).unwrap();
        let rig = LiveRig::start("switch-off", &root, &[("main.tex", "abc")]);
        let _live = rig.go_live();
        let (_secrets, state) = state_in(&dir);
        ENABLED.store(true, Ordering::SeqCst);
        assert!(active_for("switch-off").is_some());
        rig.remote("main.tex", "from a peer");
        switch_to(&state, false);
        assert!(!enabled());
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            let written = std::fs::read_to_string(root.join("main.tex")).unwrap();
            if written == "from a peer" && active_for("switch-off").is_none() {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "the live session was not stopped cleanly: main.tex holds {written:?}"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn turning_off_cancels_a_sign_in_and_turning_on_starts_nothing() {
        let _turn = turn();
        let _live = live_turn();
        let dir = tempfile::tempdir().unwrap();
        let (secrets, state) = state_in(&dir);
        ENABLED.store(false, Ordering::SeqCst);
        let mut waiting = state.begin_sign_in();
        switch_to(&state, true);
        assert!(enabled());
        assert!(matches!(waiting.try_recv(), Err(TryRecvError::Empty)));
        assert!(secrets.get(DEVICE_KEY_ACCOUNT).unwrap().is_none());
        assert!(!dir.path().join("collab").exists());
        switch_to(&state, true);
        assert!(matches!(waiting.try_recv(), Err(TryRecvError::Empty)));
        switch_to(&state, false);
        assert!(!enabled());
        assert!(
            waiting.try_recv().is_ok(),
            "a sign-in kept waiting after the switch went off"
        );
    }

    #[test]
    fn an_e2e_seed_sets_the_switch_before_the_page_loads() {
        let _turn = turn();
        ENABLED.store(false, Ordering::SeqCst);
        adopt_seeds(
            Some(&json!({ "oleafly.liveCollaboration": "0" })),
            Some(&json!({ "oleafly.liveCollaboration": "1" })),
        );
        assert!(enabled(), "the launch seed wins on the first page load");
        ENABLED.store(false, Ordering::SeqCst);
        adopt_seeds(Some(&json!({ "oleafly.liveCollaboration": "1" })), None);
        assert!(enabled());
        adopt_seeds(None, Some(&json!({ "oleafly.liveCollaboration": null })));
        assert!(!enabled(), "a removed key means the switch is off");
        ENABLED.store(true, Ordering::SeqCst);
        adopt_seeds(Some(&json!({ "oleafly.harper": "1" })), None);
        assert!(enabled(), "a seed without the key keeps the saved switch");
        ENABLED.store(false, Ordering::SeqCst);
    }

    #[test]
    fn the_refusal_is_a_collaboration_error_that_reads_as_a_sentence() {
        let refused = turned_off();
        assert_eq!(refused.code, "turned_off");
        assert!(
            refused
                .message
                .starts_with("Live collaboration is turned off."),
            "{}",
            refused.message
        );
    }

    #[test]
    fn the_switch_command_never_runs_on_the_main_thread() {
        let source = include_str!("switch.rs");
        let code = &source[..source.find("#[cfg(test)]\nmod tests").unwrap()];
        assert!(code.contains("pub async fn collab_live_collaboration_set("));
        assert!(code.contains("spawn_blocking(remember_current)"));
    }
}
