use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use tauri::async_runtime::Mutex;

/// Process-wide app state.
pub struct AppState {
    /// Serializes main-document compiles (shared build dir + LuaLaTeX).
    pub compile_lock: Mutex<()>,
    /// Serializes isolated figure compiles separately so AI figure previews
    /// never block the main document compile (and vice versa). Figure builds
    /// write to `.openleaf/figbuild/`, not the main build dir.
    pub figure_compile_lock: Mutex<()>,
    pub pandoc_install_lock: Mutex<()>,
    /// Monotonic ticket for compile requests; used to skip queued compiles
    /// that a newer request for the same project has superseded.
    pub compile_ticket: AtomicU64,
    /// Latest compile ticket per project id.
    pub latest_compile: Mutex<HashMap<String, u64>>,
    /// Absolute paths the user has just written via a native save/export dialog.
    /// `reveal_in_dir` may open these even when they sit outside `~/.openleaf`.
    pub reveal_allowlist: Mutex<VecDeque<PathBuf>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            compile_lock: Mutex::new(()),
            figure_compile_lock: Mutex::new(()),
            pandoc_install_lock: Mutex::new(()),
            compile_ticket: AtomicU64::new(0),
            latest_compile: Mutex::new(HashMap::new()),
            reveal_allowlist: Mutex::new(VecDeque::new()),
        }
    }
}
