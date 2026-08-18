//! Transactional app-quit gate.
//!
//! Closing the window, Cmd+Q, and Restart must not tear down the webview
//! while dirty editor buffers exist: their saves travel over async IPC and a
//! mid-flight teardown loses the last edits. The Rust side blocks the first
//! close attempt and emits `quit-flush-requested`; the frontend runs the same
//! transactional flush used by project close/switch and then calls
//! `confirm_quit_flush`, which lets the quit (or restart) through — unless a
//! TinyTeX install still needs its own confirmation, which keeps its existing
//! dialog and runs strictly *after* the flush so confirming it can no longer
//! discard unsaved work.

use std::sync::atomic::{AtomicBool, Ordering};

static FLUSH_CONFIRMED: AtomicBool = AtomicBool::new(false);

/// True once the frontend reported that every dirty buffer is durably saved
/// (or the user explicitly chose to quit anyway).
pub fn flush_confirmed() -> bool {
    FLUSH_CONFIRMED.load(Ordering::SeqCst)
}

/// Record that the quit flush finished (or was explicitly overridden).
pub fn mark_flush_confirmed() {
    FLUSH_CONFIRMED.store(true, Ordering::SeqCst);
}

/// The user chose to stay after a blocked quit: forget the confirmation so
/// the next quit attempt flushes again (new edits may exist by then).
pub fn clear_flush_confirmed() {
    FLUSH_CONFIRMED.store(false, Ordering::SeqCst);
}

/// The frontend finished (or overrode) the quit flush. Passes the quit
/// through, deferring to the TinyTeX install dialog when one is still
/// required; `restart` relaunches instead of exiting.
#[tauri::command]
pub fn confirm_quit_flush(app: tauri::AppHandle, restart: Option<bool>) {
    mark_flush_confirmed();
    if crate::latex_engine::install_in_progress() && !crate::latex_engine::quit_confirmed() {
        use tauri::Emitter;
        let _ = app.emit("tinytex-quit-blocked", ());
        return;
    }
    if restart.unwrap_or(false) {
        app.request_restart();
    } else {
        app.exit(0);
    }
}

/// The user canceled a blocked quit ("Stay"): future quits must flush again.
#[tauri::command]
pub fn cancel_quit_flush() {
    clear_flush_confirmed();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flush_gate_starts_closed_then_follows_confirm_and_cancel() {
        clear_flush_confirmed();
        assert!(!flush_confirmed(), "gate must start closed");

        mark_flush_confirmed();
        assert!(flush_confirmed(), "confirm must open the gate");

        clear_flush_confirmed();
        assert!(
            !flush_confirmed(),
            "cancel must close the gate so the next quit flushes again"
        );
    }
}
