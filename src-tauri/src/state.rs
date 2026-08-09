use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use tauri::async_runtime::Mutex;

/// Process-wide app state.
pub struct AppState {
    /// Serializes main-document compiles (shared build dir + LuaLaTeX) and
    /// persisted main-document selection changes.
    pub compile_lock: Mutex<()>,
    /// Serializes isolated figure compiles separately so AI figure previews
    /// never block the main document compile (and vice versa). Figure builds
    /// write to `.oleafly/figbuild/`, not the main build dir.
    pub figure_compile_lock: Mutex<()>,
    pub pandoc_install_lock: Mutex<()>,
    /// Monotonic ticket for compile requests; used to skip queued compiles
    /// that a newer request for the same project has superseded.
    pub compile_ticket: AtomicU64,
    /// Monotonic identity for successful main-document outputs. Allocated while
    /// `compile_lock` is held so every window observes one total output order.
    pub compile_output_revision: AtomicU64,
    pub project_state_revision: AtomicU64,
    /// Latest compile ticket per project id.
    pub latest_compile: Mutex<HashMap<String, u64>>,
    /// Absolute paths the user has just written via a native save/export dialog.
    /// `reveal_in_dir` may open these even when they sit outside `~/.oleafly`.
    pub reveal_allowlist: Mutex<VecDeque<PathBuf>>,
    /// Reaches the running main-document compiler process so "Stop compilation"
    /// can end it. Figure compiles use their own lane and are never stopped by it.
    pub compile_cancel: CompileCancel,
}

/// A stop request and the process it targets.
///
/// The flag is tracked separately from the pid because a stop can land between
/// the spawn request and the child actually existing; that stop must still take
/// effect rather than being silently dropped.
#[derive(Default)]
pub struct CompileCancel {
    state: std::sync::Mutex<CompileCancelState>,
}

#[derive(Default)]
struct CompileCancelState {
    active: bool,
    requested: bool,
    pid: Option<u32>,
}

impl CompileCancel {
    pub fn begin(&self) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        *state = CompileCancelState {
            active: true,
            ..CompileCancelState::default()
        };
    }

    /// Records a stop request and returns the pid to terminate, if one is running.
    pub fn request(&self) -> Option<u32> {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if !state.active {
            return None;
        }
        state.requested = true;
        state.pid
    }

    /// Registers a freshly spawned compiler. Returns `false` when a stop already
    /// landed, meaning the caller must terminate the child it just started.
    pub fn attach(&self, pid: u32) -> bool {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if !state.active {
            return false;
        }
        state.pid = Some(pid);
        !state.requested
    }

    pub fn unregister(&self, pid: u32) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if state.pid == Some(pid) {
            state.pid = None;
        }
    }

    /// Unregisters the compiler and reports whether it was stopped on request.
    pub fn detach(&self) -> bool {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let requested = state.active && state.requested;
        *state = CompileCancelState::default();
        requested
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            compile_lock: Mutex::new(()),
            figure_compile_lock: Mutex::new(()),
            pandoc_install_lock: Mutex::new(()),
            compile_ticket: AtomicU64::new(0),
            compile_output_revision: AtomicU64::new(0),
            project_state_revision: AtomicU64::new(0),
            latest_compile: Mutex::new(HashMap::new()),
            reveal_allowlist: Mutex::new(VecDeque::new()),
            compile_cancel: CompileCancel::default(),
        }
    }
}
