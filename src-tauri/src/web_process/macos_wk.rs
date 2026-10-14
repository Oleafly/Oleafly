use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::{Duration, Instant};

use objc2::runtime::AnyObject;
use objc2::{msg_send, sel};
use tauri::webview::{PageLoadEvent, PlatformWebview};
use tauri::{AppHandle, Manager, Runtime, Webview};

use super::watchdog::{
    self, CpuSamples, Observation, UiPulse, Verdict, CPU_WINDOW, PROBE_INTERVAL, TICK,
};
use super::{KillBudget, KillPlan, ReloadBudget, RestoreAfterReload, MAX_WATCHDOG_KILLS};

const WEB_CONTENT_PROCESS: &str = "com.apple.WebKit.WebContent";

#[derive(Default)]
pub(crate) struct Watchdogs {
    watches: Mutex<HashMap<String, Arc<Mutex<Watch>>>>,
    budgets: Mutex<HashMap<String, ReloadBudget>>,
    kills: Mutex<HashMap<String, KillBudget>>,
}

impl Watchdogs {
    fn start(&self, label: &str) -> Arc<Mutex<Watch>> {
        let watch = Arc::new(Mutex::new(Watch::default()));
        lock(&self.watches).insert(label.to_owned(), Arc::clone(&watch));
        watch
    }

    fn current(&self, label: &str) -> Option<Arc<Mutex<Watch>>> {
        lock(&self.watches).get(label).cloned()
    }

    fn is_current(&self, label: &str, watch: &Arc<Mutex<Watch>>) -> bool {
        self.current(label)
            .is_some_and(|current| Arc::ptr_eq(&current, watch))
    }

    fn kill_room(&self, label: &str, now: Instant) -> bool {
        lock(&self.kills)
            .entry(label.to_owned())
            .or_default()
            .has_room(now)
    }

    fn spend_kill(&self, label: &str, now: Instant) -> KillPlan {
        lock(&self.kills)
            .entry(label.to_owned())
            .or_default()
            .spend(now)
    }

    fn spend(&self, label: &str, now: Instant) -> bool {
        lock(&self.budgets)
            .entry(label.to_owned())
            .or_default()
            .spend(now)
    }
}

#[derive(Default)]
struct Watch {
    loaded_at: Option<Instant>,
    probe: Option<Probe>,
    next_probe: u64,
    last_probe_at: Option<Instant>,
    pid: Option<i32>,
    ui: UiPulse,
    cpu: CpuSamples,
}

struct Probe {
    id: u64,
    pid: i32,
    sent_at: Instant,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

pub(crate) fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("oleafly-web-process")
        .setup(|app, _api| {
            app.manage(Watchdogs::default());
            Ok(())
        })
        .on_webview_ready(|webview| watch(&webview))
        .on_page_load(|webview, payload| page_load(webview, payload.event()))
        .build()
}

fn watch<R: Runtime>(webview: &Webview<R>) {
    if webview.label() != webview.window().label() {
        return;
    }
    if !watchdog::enabled(
        cfg!(debug_assertions) && !cfg!(feature = "e2e-testing"),
        std::env::var_os("OLEAFLY_WEB_WATCHDOG").is_some(),
    ) {
        return;
    }
    let Some(watchdogs) = webview.try_state::<Watchdogs>() else {
        return;
    };
    let label = webview.label().to_owned();
    let watch = watchdogs.start(&label);
    let app = webview.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(TICK);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            ticker.tick().await;
            if !tick(&app, &label, &watch) {
                break;
            }
        }
    });
}

fn page_load<R: Runtime>(webview: &Webview<R>, event: PageLoadEvent) {
    let Some(watch) = webview
        .try_state::<Watchdogs>()
        .and_then(|watchdogs| watchdogs.current(webview.label()))
    else {
        return;
    };
    let mut watch = lock(&watch);
    watch.probe = None;
    watch.cpu.clear();
    watch.last_probe_at = None;
    watch.loaded_at = match event {
        PageLoadEvent::Started => None,
        PageLoadEvent::Finished => Some(Instant::now()),
    };
}

fn tick<R: Runtime>(app: &AppHandle<R>, label: &str, watch: &Arc<Mutex<Watch>>) -> bool {
    let Some(webview) = app.get_webview(label) else {
        return false;
    };
    let Some(watchdogs) = app.try_state::<Watchdogs>() else {
        return false;
    };
    if !watchdogs.is_current(label, watch) {
        return false;
    }
    let pulse = Arc::clone(watch);
    let _ = webview.with_webview(move |platform| {
        let pid = web_content_pid(&platform);
        let mut watch = lock(&pulse);
        watch.ui.beat(Instant::now());
        watch.pid = pid;
    });

    let now = Instant::now();
    let mut state = lock(watch);
    let Some(loaded_at) = state.loaded_at else {
        return true;
    };
    let Some(probe) = state.probe.as_ref() else {
        let due = state.last_probe_at.unwrap_or(loaded_at);
        if now.saturating_duration_since(due) >= PROBE_INTERVAL {
            if let Some(pid) = state.pid.filter(|pid| *pid > 0) {
                let id = state.next_probe;
                state.next_probe += 1;
                state.last_probe_at = Some(now);
                state.probe = Some(Probe {
                    id,
                    pid,
                    sent_at: now,
                });
                state.cpu.clear();
                drop(state);
                send_probe(&webview, watch, id);
            }
        }
        return true;
    };
    let (id, pid, sent_at) = (probe.id, probe.pid, probe.sent_at);
    state.cpu.record(pid, now, cpu_time(pid));
    let unanswered = now.saturating_duration_since(sent_at);
    let observation = Observation {
        unanswered: Some(unanswered),
        ui_alive: state.ui.alive_for(now),
        cpu_in_window: state.cpu.used_over(now, CPU_WINDOW),
        same_process: state.pid == Some(pid) && is_web_content_process(pid),
        budget_left: watchdogs.kill_room(label, now),
    };
    match watchdog::verdict(observation) {
        Verdict::Healthy | Verdict::Wait => true,
        Verdict::Reset => {
            if state.probe.as_ref().is_some_and(|probe| probe.id == id) {
                state.probe = None;
                state.cpu.clear();
            }
            true
        }
        Verdict::Kill => {
            let plan = watchdogs.spend_kill(label, now);
            if plan == KillPlan::GiveUp {
                drop(state);
                give_up(label);
                return false;
            }
            state.probe = None;
            state.loaded_at = None;
            state.cpu.clear();
            drop(state);
            let into = if plan == KillPlan::Library {
                " into the library"
            } else {
                ""
            };
            log(format!(
                "webview: the {label} window stopped answering {} s ago and its web content process (pid {pid}) is idle; killing that process so the window reloads{into}",
                unanswered.as_secs()
            ));
            if let Some(restore) = app.try_state::<RestoreAfterReload>() {
                restore.arm(label, plan);
            }
            unsafe {
                libc::kill(pid, libc::SIGKILL);
            }
            true
        }
        Verdict::GiveUp => {
            drop(state);
            give_up(label);
            false
        }
    }
}

fn give_up(label: &str) {
    log(format!(
        "webview: the {label} window stopped answering again after {MAX_WATCHDOG_KILLS} reloads in ten minutes; leaving it as it is"
    ));
}

fn send_probe<R: Runtime>(webview: &Webview<R>, watch: &Arc<Mutex<Watch>>, id: u64) {
    let answered = Arc::clone(watch);
    let sent = webview.eval_with_callback("0", move |_| {
        let mut watch = lock(&answered);
        if watch.probe.as_ref().is_some_and(|probe| probe.id == id) {
            watch.probe = None;
            watch.cpu.clear();
        }
    });
    if sent.is_err() {
        let mut watch = lock(watch);
        if watch.probe.as_ref().is_some_and(|probe| probe.id == id) {
            watch.probe = None;
        }
    }
}

pub(crate) fn on_web_content_process_terminate(webview: &Webview) {
    let label = webview.label();
    let reload = webview
        .try_state::<Watchdogs>()
        .is_none_or(|watchdogs| watchdogs.spend(label, Instant::now()));
    if reload {
        log(format!(
            "webview: the {label} web content process ended; reloading the page"
        ));
        let _ = webview.reload();
    } else {
        log(format!(
            "webview: the {label} web content process ended again; not reloading"
        ));
    }
}

fn web_content_pid(platform: &PlatformWebview) -> Option<i32> {
    let view = platform.inner().cast::<AnyObject>();
    if view.is_null() {
        return None;
    }
    unsafe {
        let view = &*view;
        let responds: bool = msg_send![view, respondsToSelector: sel!(_webProcessIdentifier)];
        if !responds {
            return None;
        }
        let pid: libc::pid_t = msg_send![view, _webProcessIdentifier];
        (pid > 0).then_some(pid)
    }
}

fn is_web_content_process(pid: i32) -> bool {
    let mut name = [0u8; 64];
    let written = unsafe { libc::proc_name(pid, name.as_mut_ptr().cast(), name.len() as u32) };
    usize::try_from(written)
        .ok()
        .and_then(|length| name.get(..length))
        .is_some_and(|found| found == WEB_CONTENT_PROCESS.as_bytes())
}

#[repr(C)]
struct MachTimebase {
    numer: u32,
    denom: u32,
}

unsafe extern "C" {
    fn mach_timebase_info(info: *mut MachTimebase) -> libc::c_int;
}

fn ticks_to_duration(ticks: u64) -> Duration {
    static TIMEBASE: OnceLock<(u64, u64)> = OnceLock::new();
    let (numer, denom) = *TIMEBASE.get_or_init(|| {
        let mut info = MachTimebase { numer: 0, denom: 0 };
        let status = unsafe { mach_timebase_info(&mut info) };
        if status == 0 && info.numer > 0 && info.denom > 0 {
            (u64::from(info.numer), u64::from(info.denom))
        } else {
            (1, 1)
        }
    });
    let nanos = u128::from(ticks) * u128::from(numer) / u128::from(denom);
    Duration::from_nanos(u64::try_from(nanos).unwrap_or(u64::MAX))
}

fn cpu_time(pid: i32) -> Option<Duration> {
    let mut info: libc::rusage_info_v2 = unsafe { std::mem::zeroed() };
    let status = unsafe {
        libc::proc_pid_rusage(
            pid,
            libc::RUSAGE_INFO_V2,
            (&mut info as *mut libc::rusage_info_v2).cast(),
        )
    };
    (status == 0).then(|| ticks_to_duration(info.ri_user_time.saturating_add(info.ri_system_time)))
}

fn log(line: String) {
    eprintln!("{line}");
    tauri::async_runtime::spawn_blocking(move || {
        let _ = crate::project::append_app_log(line);
    });
}

#[cfg(feature = "e2e-testing")]
const FREEZE_SCRIPT: &str = r#"(() => {
  const yieldTask = () => new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });
  let garbage = [];
  const round = async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(64)); controller.close(); } });
    const reader = stream.getReader();
    while (!(await reader.read()).done) {
      for (let i = 0; i < 40; i++) garbage.push({ a: new Array(32).fill(i), s: "x" + i });
      if (garbage.length > 20000) garbage = [];
    }
    reader.releaseLock();
  };
  (async () => {
    for (let count = 1; ; count++) {
      await round();
      if (count % 2000 === 0) await yieldTask();
    }
  })();
})();"#;

#[cfg(feature = "e2e-testing")]
#[tauri::command]
pub async fn debug_freeze_webview(webview: tauri::Webview) -> Result<(), String> {
    webview
        .eval(FREEZE_SCRIPT)
        .map_err(|error| error.to_string())
}
