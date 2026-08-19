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
static RESTART_PENDING: AtomicBool = AtomicBool::new(false);

/// True when the pending quit is a restart, not an exit. Retained while
/// another gate (the TinyTeX install confirm) defers the teardown, so the
/// eventual pass-through does what the user asked for.
pub fn restart_pending() -> bool {
    RESTART_PENDING.load(Ordering::SeqCst)
}

pub fn mark_restart_pending() {
    RESTART_PENDING.store(true, Ordering::SeqCst);
}

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
/// the next quit attempt flushes again (new edits may exist by then), and
/// drop any pending restart intent with it.
pub fn clear_flush_confirmed() {
    FLUSH_CONFIRMED.store(false, Ordering::SeqCst);
    RESTART_PENDING.store(false, Ordering::SeqCst);
}

/// What a confirmed quit does next. Deferral outranks intent: a pending
/// install gate takes over the teardown (keeping the recorded intent), and
/// only then does restart-vs-exit apply.
#[derive(Debug, PartialEq, Eq)]
pub enum QuitAction {
    Exit,
    Restart,
    DeferToInstallGate,
}

pub fn resolve_quit_action(install_gate_pending: bool) -> QuitAction {
    if install_gate_pending {
        QuitAction::DeferToInstallGate
    } else if restart_pending() {
        QuitAction::Restart
    } else {
        QuitAction::Exit
    }
}

/// The frontend finished (or overrode) the quit flush. Passes the quit
/// through, deferring to the TinyTeX install dialog when one is still
/// required; `restart` relaunches instead of exiting.
#[tauri::command]
pub fn confirm_quit_flush(app: tauri::AppHandle, restart: Option<bool>) {
    mark_flush_confirmed();
    if restart.unwrap_or(false) {
        mark_restart_pending();
    }
    let install_gate_pending =
        crate::latex_engine::install_in_progress() && !crate::latex_engine::quit_confirmed();
    match resolve_quit_action(install_gate_pending) {
        QuitAction::DeferToInstallGate => {
            use tauri::Emitter;
            let _ = app.emit("tinytex-quit-blocked", ());
        }
        QuitAction::Restart => app.request_restart(),
        QuitAction::Exit => app.exit(0),
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
    fn confirmed_quits_resolve_to_defer_restart_or_exit() {
        clear_flush_confirmed();
        assert_eq!(
            resolve_quit_action(true),
            QuitAction::DeferToInstallGate,
            "a pending install gate always defers, whatever the intent"
        );
        assert_eq!(resolve_quit_action(false), QuitAction::Exit);

        mark_restart_pending();
        assert_eq!(resolve_quit_action(false), QuitAction::Restart);
        assert_eq!(resolve_quit_action(true), QuitAction::DeferToInstallGate);
        clear_flush_confirmed();
    }

    #[test]
    fn restart_intent_survives_a_deferred_confirm_and_cancel_clears_it() {
        clear_flush_confirmed();
        assert!(!restart_pending(), "no restart intent by default");

        mark_flush_confirmed();
        mark_restart_pending();
        assert!(
            restart_pending(),
            "a restart-flavored quit must keep its intent while another gate defers it"
        );

        clear_flush_confirmed();
        assert!(
            !restart_pending(),
            "staying in the app must clear the restart intent with the flush confirmation"
        );
    }

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
