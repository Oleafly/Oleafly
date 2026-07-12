use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use tauri::async_runtime::Mutex;

/// Process-wide app state.
pub struct AppState {
    /// Serializes compiles so only one Tectonic run is active at a time.
    pub compile_lock: Mutex<()>,
    /// Monotonic ticket for compile requests; used to skip queued compiles
    /// that a newer request for the same project has superseded.
    pub compile_ticket: AtomicU64,
    /// Latest compile ticket per project id.
    pub latest_compile: Mutex<HashMap<String, u64>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            compile_lock: Mutex::new(()),
            compile_ticket: AtomicU64::new(0),
            latest_compile: Mutex::new(HashMap::new()),
        }
    }
}
