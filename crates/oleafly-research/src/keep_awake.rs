use std::sync::{Arc, Mutex};

use crate::scheduler::lock;

pub trait AwakeBackend: Send + Sync {
    fn start(&self, reason: &str) -> Option<Box<dyn Send>>;
}

struct Shared {
    holders: usize,
    active: Option<Box<dyn Send>>,
}

#[derive(Clone)]
pub struct KeepAwake {
    backend: Arc<dyn AwakeBackend>,
    shared: Arc<Mutex<Shared>>,
}

pub struct KeepAwakeGuard {
    shared: Arc<Mutex<Shared>>,
}

impl Drop for KeepAwakeGuard {
    fn drop(&mut self) {
        let mut shared = lock(&self.shared);
        shared.holders = shared.holders.saturating_sub(1);
        if shared.holders == 0 {
            shared.active = None;
        }
    }
}

impl Default for KeepAwake {
    fn default() -> Self {
        Self::new()
    }
}

impl KeepAwake {
    pub fn new() -> Self {
        Self::with_backend(Arc::new(SystemBackend))
    }

    pub fn with_backend(backend: Arc<dyn AwakeBackend>) -> Self {
        Self {
            backend,
            shared: Arc::new(Mutex::new(Shared {
                holders: 0,
                active: None,
            })),
        }
    }

    pub fn acquire(&self, reason: &str) -> KeepAwakeGuard {
        let mut shared = lock(&self.shared);
        shared.holders += 1;
        if shared.holders == 1 {
            shared.active = self.backend.start(reason);
        }
        KeepAwakeGuard {
            shared: self.shared.clone(),
        }
    }
}

pub struct SystemBackend;

#[cfg(not(windows))]
struct Inhibitor(std::process::Child);

#[cfg(not(windows))]
impl Drop for Inhibitor {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[cfg(not(windows))]
fn spawn_inhibitor(program: &str, args: &[String]) -> Option<Box<dyn Send>> {
    let mut command = std::process::Command::new(program);
    command
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    for name in [
        "APPDIR",
        "APPIMAGE",
        "LD_LIBRARY_PATH",
        "GIO_MODULE_DIR",
        "GTK_PATH",
    ] {
        command.env_remove(name);
    }
    match command.spawn() {
        Ok(child) => Some(Box::new(Inhibitor(child))),
        Err(_) => None,
    }
}

pub fn systemd_inhibit_args(pid: u32, reason: &str) -> Vec<String> {
    vec![
        "--what=idle:sleep".into(),
        "--who=Oleafly".into(),
        format!("--why={reason}"),
        "--mode=block".into(),
        "/bin/sh".into(),
        "-c".into(),
        format!("while kill -0 {pid} 2>/dev/null; do sleep 15; done"),
    ]
}

#[cfg(windows)]
pub const fn execution_state_flags() -> u32 {
    windows_sys::Win32::System::Power::ES_CONTINUOUS
        | windows_sys::Win32::System::Power::ES_SYSTEM_REQUIRED
}

#[cfg(windows)]
struct AwakeThread(Option<std::sync::mpsc::Sender<()>>);

#[cfg(windows)]
impl Drop for AwakeThread {
    fn drop(&mut self) {
        self.0.take();
    }
}

impl AwakeBackend for SystemBackend {
    fn start(&self, reason: &str) -> Option<Box<dyn Send>> {
        #[cfg(target_os = "macos")]
        {
            let _ = reason;
            spawn_inhibitor(
                "/usr/bin/caffeinate",
                &["-i".into(), "-w".into(), std::process::id().to_string()],
            )
        }
        #[cfg(target_os = "linux")]
        {
            static MISSING: std::sync::Once = std::sync::Once::new();
            let Some(program) = ["/usr/bin/systemd-inhibit", "/bin/systemd-inhibit"]
                .into_iter()
                .find(|path| std::path::Path::new(path).is_file())
            else {
                MISSING.call_once(|| {
                    eprintln!(
                        "systemd-inhibit is missing; the computer may sleep during research tasks."
                    )
                });
                return None;
            };
            spawn_inhibitor(program, &systemd_inhibit_args(std::process::id(), reason))
        }
        #[cfg(windows)]
        {
            let _ = reason;
            let (sender, receiver) = std::sync::mpsc::channel::<()>();
            std::thread::spawn(move || unsafe {
                windows_sys::Win32::System::Power::SetThreadExecutionState(execution_state_flags());
                let _ = receiver.recv();
                windows_sys::Win32::System::Power::SetThreadExecutionState(
                    windows_sys::Win32::System::Power::ES_CONTINUOUS,
                );
            });
            Some(Box::new(AwakeThread(Some(sender))))
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
        {
            let _ = reason;
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Default)]
    struct FakeBackend {
        starts: AtomicUsize,
        stops: Arc<AtomicUsize>,
    }

    struct Stopper(Arc<AtomicUsize>);

    impl Drop for Stopper {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }

    impl AwakeBackend for FakeBackend {
        fn start(&self, _reason: &str) -> Option<Box<dyn Send>> {
            self.starts.fetch_add(1, Ordering::SeqCst);
            Some(Box::new(Stopper(self.stops.clone())))
        }
    }

    #[test]
    fn keep_awake_is_reference_counted() {
        let backend = Arc::new(FakeBackend::default());
        let awake = KeepAwake::with_backend(backend.clone());
        let first = awake.acquire("task");
        let second = awake.acquire("run");
        assert_eq!(backend.starts.load(Ordering::SeqCst), 1);
        drop(first);
        assert_eq!(backend.stops.load(Ordering::SeqCst), 0);
        drop(second);
        assert_eq!(backend.stops.load(Ordering::SeqCst), 1);
        let _again = awake.acquire("task");
        assert_eq!(backend.starts.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn the_linux_backend_watches_our_process_id() {
        let args = systemd_inhibit_args(4242, "Research task running");
        assert!(args.ends_with(&[
            "/bin/sh".to_owned(),
            "-c".to_owned(),
            "while kill -0 4242 2>/dev/null; do sleep 15; done".to_owned()
        ]));
        assert!(args.contains(&"--why=Research task running".to_owned()));
    }

    #[cfg(windows)]
    #[test]
    fn the_windows_backend_requests_system_required_without_display() {
        use windows_sys::Win32::System::Power::{
            ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
        };
        assert_eq!(execution_state_flags(), ES_CONTINUOUS | ES_SYSTEM_REQUIRED);
        assert_eq!(execution_state_flags() & ES_DISPLAY_REQUIRED, 0);
    }
}
