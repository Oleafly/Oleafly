#[cfg(debug_assertions)]
mod enabled {
    use std::collections::BTreeMap;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Mutex, OnceLock};
    use std::time::{Duration, Instant};

    const REPORT_AFTER: Duration = Duration::from_secs(5);
    const SWEEP_EVERY: Duration = Duration::from_secs(5);
    const SLOW_ON_EXIT: Duration = Duration::from_secs(1);

    static NEXT_ID: AtomicU64 = AtomicU64::new(0);
    static UI_THREAD: OnceLock<std::thread::ThreadId> = OnceLock::new();

    struct Entry {
        label: String,
        thread: String,
        started: Instant,
        reported: bool,
    }

    fn ledger() -> &'static Mutex<BTreeMap<u64, Entry>> {
        static LEDGER: OnceLock<Mutex<BTreeMap<u64, Entry>>> = OnceLock::new();
        LEDGER.get_or_init(|| Mutex::new(BTreeMap::new()))
    }

    fn thread_label() -> String {
        let current = std::thread::current();
        if UI_THREAD.get() == Some(&current.id()) {
            return "ui".to_string();
        }
        match current.name() {
            Some(name) => name.to_string(),
            None => format!("{:?}", current.id()),
        }
    }

    fn emit(message: String) {
        eprintln!("stall: {message}");
        let _ = crate::project::append_app_log(format!("stall: {message}"));
    }

    pub(crate) fn mark_ui_thread() {
        let _ = UI_THREAD.set(std::thread::current().id());
    }

    #[derive(Debug)]
    pub(crate) struct Guard {
        id: u64,
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            let Ok(mut entries) = ledger().lock() else {
                return;
            };
            if let Some(entry) = entries.remove(&self.id) {
                let waited = entry.started.elapsed();
                if entry.reported || waited >= SLOW_ON_EXIT {
                    emit(format!(
                        "{} finished on {} after {}ms",
                        entry.label,
                        entry.thread,
                        waited.as_millis()
                    ));
                }
            }
        }
    }

    pub(crate) fn watch<F>(label: F) -> Guard
    where
        F: FnOnce() -> String,
    {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut entries) = ledger().lock() {
            entries.insert(
                id,
                Entry {
                    label: label(),
                    thread: thread_label(),
                    started: Instant::now(),
                    reported: false,
                },
            );
        }
        Guard { id }
    }

    pub(crate) fn start_watchdog() {
        static STARTED: OnceLock<()> = OnceLock::new();
        if STARTED.set(()).is_err() {
            return;
        }
        std::thread::Builder::new()
            .name("stall-watchdog".into())
            .spawn(|| loop {
                std::thread::sleep(SWEEP_EVERY);
                let mut stuck = Vec::new();
                if let Ok(mut entries) = ledger().lock() {
                    for entry in entries.values_mut() {
                        let waited = entry.started.elapsed();
                        if waited < REPORT_AFTER {
                            continue;
                        }
                        entry.reported = true;
                        stuck.push(format!(
                            "{} still running on {} after {}ms",
                            entry.label,
                            entry.thread,
                            waited.as_millis()
                        ));
                    }
                }
                for line in stuck {
                    emit(line);
                }
            })
            .ok();
    }
}

#[cfg(not(debug_assertions))]
mod disabled {
    #[derive(Debug)]
    pub(crate) struct Guard;

    pub(crate) fn mark_ui_thread() {}

    pub(crate) fn start_watchdog() {}

    pub(crate) fn watch<F>(_label: F) -> Guard
    where
        F: FnOnce() -> String,
    {
        Guard
    }
}

#[cfg(debug_assertions)]
pub(crate) use enabled::{mark_ui_thread, start_watchdog, watch, Guard};

#[cfg(not(debug_assertions))]
pub(crate) use disabled::{mark_ui_thread, start_watchdog, watch, Guard};
