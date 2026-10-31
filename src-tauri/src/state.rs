use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use tauri::async_runtime::Mutex;

pub struct AppState {
    pub compile_lock: Mutex<()>,
    pub figure_compile_lock: Mutex<()>,
    pub pandoc_install_lock: Mutex<()>,
    pub compile_ticket: AtomicU64,
    pub compile_output_revision: AtomicU64,
    pub project_state_revision: AtomicU64,
    pub latest_compile: Mutex<HashMap<String, u64>>,
    pub reveal_allowlist: Mutex<VecDeque<PathBuf>>,
    pub table_import_allowlist: Mutex<VecDeque<PathBuf>>,
    pub compile_cancel: CompileCancel,
}

#[derive(Clone, Default)]
pub struct CompileCancel {
    state: std::sync::Arc<std::sync::Mutex<CompileCancelState>>,
}

#[derive(Default)]
struct CompileCancelState {
    active_scopes: usize,
    requested: bool,
    pid: Option<u32>,
    publication_cutoff_crossed: bool,
}

impl CompileCancel {
    pub fn begin(&self) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.active_scopes == 0 {
            *state = CompileCancelState::default();
        }
        state.active_scopes = state.active_scopes.saturating_add(1);
    }

    pub fn request(&self) -> Option<u32> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.active_scopes == 0 || state.publication_cutoff_crossed {
            return None;
        }
        state.requested = true;
        state.pid
    }

    pub fn attach(&self, pid: u32) -> bool {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.active_scopes == 0 || state.publication_cutoff_crossed {
            return false;
        }
        state.pid = Some(pid);
        !state.requested
    }

    pub fn unregister(&self, pid: u32) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.pid == Some(pid) {
            state.pid = None;
        }
    }

    pub fn is_requested(&self) -> bool {
        let state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.active_scopes > 0 && state.requested && !state.publication_cutoff_crossed
    }

    pub fn detach(&self) -> bool {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.active_scopes == 0 {
            return false;
        }
        let requested = state.requested && !state.publication_cutoff_crossed;
        state.pid = None;
        state.active_scopes -= 1;
        if state.active_scopes == 0 {
            *state = CompileCancelState::default();
        }
        requested
    }
}

impl oleafly_history::PublicationGate for CompileCancel {
    fn is_cancelled(&self) -> bool {
        self.is_requested()
    }

    fn commit_visibility(
        &self,
        commit: &mut dyn FnMut() -> oleafly_history::Result<()>,
    ) -> oleafly_history::Result<bool> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.active_scopes > 0 && state.requested {
            return Ok(false);
        }

        commit()?;
        state.publication_cutoff_crossed = true;
        Ok(true)
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
            table_import_allowlist: Mutex::new(VecDeque::new()),
            compile_cancel: CompileCancel::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use oleafly_history::{HistoryError, PublicationGate};

    use super::CompileCancel;

    #[test]
    fn failed_visibility_callback_keeps_the_stop_lane_open() {
        let cancel = CompileCancel::default();
        cancel.begin();
        let mut fail = || {
            Err(HistoryError::Io(std::io::Error::other(
                "injected visibility failure",
            )))
        };

        assert!(cancel.commit_visibility(&mut fail).is_err());
        assert_eq!(cancel.request(), None);
        assert!(
            cancel.detach(),
            "a failed visibility operation must not suppress a later stop"
        );
    }
}
