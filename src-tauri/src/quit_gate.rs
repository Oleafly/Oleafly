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
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

static FLUSH_CONFIRMED: AtomicBool = AtomicBool::new(false);
static RESTART_PENDING: AtomicBool = AtomicBool::new(false);
static UNANSWERED_SINCE: Mutex<Option<Instant>> = Mutex::new(None);

pub const ANSWER_GRACE: Duration = Duration::from_secs(8);
pub const REQUEST_EXPIRY: Duration = Duration::from_secs(60);

fn unanswered_since() -> MutexGuard<'static, Option<Instant>> {
    UNANSWERED_SINCE
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

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
    *unanswered_since() = None;
    FLUSH_CONFIRMED.store(true, Ordering::SeqCst);
}

/// The user chose to stay after a blocked quit: forget the confirmation so
/// the next quit attempt flushes again (new edits may exist by then), and
/// drop any pending restart intent with it.
pub fn clear_flush_confirmed() {
    *unanswered_since() = None;
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

#[derive(Debug, PartialEq, Eq)]
pub enum CloseDecision {
    Allow,
    AskPageToFlush,
    AskInstallGate,
    QuitUnanswered,
}

pub fn decide_main_window_close(now: Instant, install_gate_pending: bool) -> CloseDecision {
    if flush_confirmed() {
        return if install_gate_pending {
            CloseDecision::AskInstallGate
        } else {
            CloseDecision::Allow
        };
    }
    let mut since = unanswered_since();
    let waited = since.map(|asked| now.saturating_duration_since(asked));
    match waited {
        Some(waited) if waited >= ANSWER_GRACE && waited < REQUEST_EXPIRY => {
            drop(since);
            mark_flush_confirmed();
            CloseDecision::QuitUnanswered
        }
        Some(waited) if waited < ANSWER_GRACE => CloseDecision::AskPageToFlush,
        _ => {
            *since = Some(now);
            CloseDecision::AskPageToFlush
        }
    }
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
    use tauri::Manager;
    if app
        .try_state::<crate::updater::UpdateState>()
        .is_some_and(|state| state.installing())
    {
        return;
    }
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

pub const BACKGROUND_DOWNLOAD_GRACE: Duration = Duration::from_secs(2);

pub fn on_app_exit() {
    crate::toolchain_download::abandon_background_installs(BACKGROUND_DOWNLOAD_GRACE);
}

#[cfg(test)]
pub(crate) fn test_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    &LOCK
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_gate() -> Instant {
        clear_flush_confirmed();
        Instant::now()
    }

    #[test]
    fn the_first_close_asks_the_page_to_flush() {
        let _lock = test_lock().blocking_lock();
        let start = fresh_gate();

        assert_eq!(
            decide_main_window_close(start, false),
            CloseDecision::AskPageToFlush
        );
        assert!(!flush_confirmed());
    }

    #[test]
    fn a_healthy_confirm_lets_the_close_through() {
        let _lock = test_lock().blocking_lock();
        let start = fresh_gate();
        assert_eq!(
            decide_main_window_close(start, false),
            CloseDecision::AskPageToFlush
        );

        mark_flush_confirmed();

        assert_eq!(
            decide_main_window_close(start + Duration::from_millis(300), false),
            CloseDecision::Allow
        );
        clear_flush_confirmed();
    }

    #[test]
    fn a_second_close_before_the_grace_still_waits_for_the_page() {
        let _lock = test_lock().blocking_lock();
        let start = fresh_gate();
        decide_main_window_close(start, false);

        assert_eq!(
            decide_main_window_close(start + ANSWER_GRACE - Duration::from_millis(1), false),
            CloseDecision::AskPageToFlush
        );
        assert!(!flush_confirmed());
        clear_flush_confirmed();
    }

    #[test]
    fn a_second_close_after_the_grace_quits_when_the_page_never_answered() {
        let _lock = test_lock().blocking_lock();
        let start = fresh_gate();
        decide_main_window_close(start, false);

        assert_eq!(
            decide_main_window_close(start + ANSWER_GRACE, false),
            CloseDecision::QuitUnanswered
        );
        assert!(
            flush_confirmed(),
            "the forced quit must run the same shutdown as a confirmed one"
        );
        clear_flush_confirmed();
    }

    #[test]
    fn repeated_closes_do_not_push_the_grace_back() {
        let _lock = test_lock().blocking_lock();
        let start = fresh_gate();
        decide_main_window_close(start, false);
        decide_main_window_close(start + Duration::from_secs(3), false);
        decide_main_window_close(start + Duration::from_secs(6), false);

        assert_eq!(
            decide_main_window_close(start + ANSWER_GRACE, false),
            CloseDecision::QuitUnanswered
        );
        clear_flush_confirmed();
    }

    #[test]
    fn a_page_that_answered_is_asked_again_instead_of_forced() {
        let _lock = test_lock().blocking_lock();
        let start = fresh_gate();
        decide_main_window_close(start, false);

        cancel_quit_flush();

        assert_eq!(
            decide_main_window_close(start + ANSWER_GRACE * 2, false),
            CloseDecision::AskPageToFlush
        );
        assert_eq!(
            decide_main_window_close(start + ANSWER_GRACE * 2 + Duration::from_secs(1), false),
            CloseDecision::AskPageToFlush
        );
        clear_flush_confirmed();
    }

    #[test]
    fn a_stale_request_is_asked_again_instead_of_forced() {
        let _lock = test_lock().blocking_lock();
        let start = fresh_gate();
        decide_main_window_close(start, false);
        let later = start + REQUEST_EXPIRY;

        assert_eq!(
            decide_main_window_close(later, false),
            CloseDecision::AskPageToFlush
        );
        assert_eq!(
            decide_main_window_close(later + ANSWER_GRACE, false),
            CloseDecision::QuitUnanswered
        );
        clear_flush_confirmed();
    }

    #[test]
    fn the_install_gate_is_unchanged_once_the_flush_is_confirmed() {
        let _lock = test_lock().blocking_lock();
        let start = fresh_gate();
        assert_eq!(
            decide_main_window_close(start, true),
            CloseDecision::AskPageToFlush,
            "the flush still runs before the install gate"
        );

        mark_flush_confirmed();

        assert_eq!(
            decide_main_window_close(start + Duration::from_secs(1), true),
            CloseDecision::AskInstallGate
        );
        assert_eq!(
            decide_main_window_close(start + REQUEST_EXPIRY * 5, true),
            CloseDecision::AskInstallGate,
            "waiting on the install dialog never turns into a forced quit"
        );
        clear_flush_confirmed();
    }

    #[test]
    fn an_unanswered_page_cannot_hold_the_window_behind_the_install_gate() {
        let _lock = test_lock().blocking_lock();
        let start = fresh_gate();
        decide_main_window_close(start, true);

        assert_eq!(
            decide_main_window_close(start + ANSWER_GRACE, true),
            CloseDecision::QuitUnanswered
        );
        clear_flush_confirmed();
    }

    #[test]
    fn the_cancel_command_re_arms_both_flags() {
        let _lock = test_lock().blocking_lock();
        mark_flush_confirmed();
        mark_restart_pending();

        cancel_quit_flush();

        assert!(!flush_confirmed());
        assert!(!restart_pending());
    }

    #[test]
    fn confirmed_quits_resolve_to_defer_restart_or_exit() {
        let _lock = test_lock().blocking_lock();
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
        let _lock = test_lock().blocking_lock();
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
        let _lock = test_lock().blocking_lock();
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
