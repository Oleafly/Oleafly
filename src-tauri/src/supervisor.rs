use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;

// Generic long-running sidecar supervisor: one state machine for every child
// process the app keeps alive (language servers, future MCP transports).
// States and exit-handling policy mirror the audited reference manager:
// a clean exit with stop_on_clean_exit lands in Stopped, a crash schedules a
// delayed restart until the cap, and anything past the cap disables the
// sidecar until the user intervenes.

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SidecarState {
    Starting,
    Running,
    Restarting,
    Stopped,
    Disabled,
}

#[derive(Clone, Debug)]
pub struct SupervisorPolicy {
    pub restart_delay: Option<Duration>,
    pub max_restarts: u32,
    pub stop_on_clean_exit: bool,
}

impl Default for SupervisorPolicy {
    fn default() -> Self {
        SupervisorPolicy {
            restart_delay: Some(Duration::from_secs(5)),
            max_restarts: 5,
            stop_on_clean_exit: true,
        }
    }
}

/// Exit-policy decision, kept pure so it is exhaustively testable.
pub fn next_state_after_exit(
    policy: &SupervisorPolicy,
    clean_exit: bool,
    restarts_so_far: u32,
) -> SidecarState {
    if clean_exit && policy.stop_on_clean_exit {
        return SidecarState::Stopped;
    }
    match policy.restart_delay {
        None => SidecarState::Disabled,
        Some(_) if restarts_so_far >= policy.max_restarts => SidecarState::Disabled,
        Some(_) => SidecarState::Restarting,
    }
}

#[derive(Clone, Serialize)]
pub struct SidecarStatus {
    pub name: String,
    pub state: SidecarState,
    pub restarts: u32,
    pub pid: Option<u32>,
}

type SpawnFn = dyn Fn() -> std::io::Result<tokio::process::Child> + Send + Sync;
type StatusFn = dyn Fn(SidecarStatus) + Send + Sync;

pub struct Supervisor {
    name: String,
    policy: SupervisorPolicy,
    spawn: Arc<SpawnFn>,
    on_status: Arc<StatusFn>,
    state: Arc<Mutex<SidecarState>>,
    restarts: Arc<AtomicU32>,
    pid: Arc<AtomicU32>,
    disposed: Arc<AtomicBool>,
}

impl Supervisor {
    pub fn new(
        name: impl Into<String>,
        policy: SupervisorPolicy,
        spawn: impl Fn() -> std::io::Result<tokio::process::Child> + Send + Sync + 'static,
        on_status: impl Fn(SidecarStatus) + Send + Sync + 'static,
    ) -> Self {
        Supervisor {
            name: name.into(),
            policy,
            spawn: Arc::new(spawn),
            on_status: Arc::new(on_status),
            state: Arc::new(Mutex::new(SidecarState::Stopped)),
            restarts: Arc::new(AtomicU32::new(0)),
            pid: Arc::new(AtomicU32::new(0)),
            disposed: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn state(&self) -> SidecarState {
        *self.state.lock().expect("supervisor state poisoned")
    }

    pub fn status(&self) -> SidecarStatus {
        let pid = self.pid.load(Ordering::SeqCst);
        SidecarStatus {
            name: self.name.clone(),
            state: self.state(),
            restarts: self.restarts.load(Ordering::SeqCst),
            pid: (pid != 0).then_some(pid),
        }
    }

    fn set_state(&self, next: SidecarState) {
        *self.state.lock().expect("supervisor state poisoned") = next;
        (self.on_status)(self.status());
    }

    /// Stops supervising and kills the child on its next poll.
    pub fn dispose(&self) {
        self.disposed.store(true, Ordering::SeqCst);
        self.set_state(SidecarState::Disabled);
    }

    /// Runs the supervise loop until the sidecar stops, is disabled, or the
    /// supervisor is disposed.
    pub async fn run(&self) {
        loop {
            if self.disposed.load(Ordering::SeqCst) {
                return;
            }
            self.set_state(if self.restarts.load(Ordering::SeqCst) == 0 {
                SidecarState::Starting
            } else {
                SidecarState::Restarting
            });
            let mut child = match (self.spawn)() {
                Ok(child) => child,
                Err(_) => {
                    let restarts = self.restarts.fetch_add(1, Ordering::SeqCst) + 1;
                    let next = next_state_after_exit(&self.policy, false, restarts);
                    self.set_state(next);
                    if next != SidecarState::Restarting {
                        return;
                    }
                    if let Some(delay) = self.policy.restart_delay {
                        tokio::time::sleep(delay).await;
                    }
                    continue;
                }
            };
            self.pid.store(child.id().unwrap_or(0), Ordering::SeqCst);
            self.set_state(SidecarState::Running);

            let status = tokio::select! {
                status = child.wait() => status,
                () = wait_for_dispose(self.disposed.clone()) => {
                    let _ = child.kill().await;
                    self.pid.store(0, Ordering::SeqCst);
                    self.set_state(SidecarState::Disabled);
                    return;
                }
            };
            self.pid.store(0, Ordering::SeqCst);
            let clean = matches!(status, Ok(s) if s.success());
            let restarts = self.restarts.fetch_add(1, Ordering::SeqCst) + 1;
            let next = next_state_after_exit(&self.policy, clean, restarts);
            self.set_state(next);
            if next != SidecarState::Restarting {
                return;
            }
            if let Some(delay) = self.policy.restart_delay {
                tokio::time::sleep(delay).await;
            }
        }
    }
}

async fn wait_for_dispose(flag: Arc<AtomicBool>) {
    while !flag.load(Ordering::SeqCst) {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy(delay_ms: Option<u64>, cap: u32, stop_clean: bool) -> SupervisorPolicy {
        SupervisorPolicy {
            restart_delay: delay_ms.map(Duration::from_millis),
            max_restarts: cap,
            stop_on_clean_exit: stop_clean,
        }
    }

    #[test]
    fn clean_exit_stops_when_policy_says_so() {
        assert_eq!(
            next_state_after_exit(&policy(Some(10), 5, true), true, 0),
            SidecarState::Stopped
        );
    }

    #[test]
    fn clean_exit_restarts_when_clean_exits_are_not_terminal() {
        assert_eq!(
            next_state_after_exit(&policy(Some(10), 5, false), true, 1),
            SidecarState::Restarting
        );
    }

    #[test]
    fn crash_without_restart_policy_disables() {
        assert_eq!(
            next_state_after_exit(&policy(None, 5, true), false, 0),
            SidecarState::Disabled
        );
    }

    #[test]
    fn crash_past_the_cap_disables() {
        assert_eq!(
            next_state_after_exit(&policy(Some(10), 3, true), false, 3),
            SidecarState::Disabled
        );
        assert_eq!(
            next_state_after_exit(&policy(Some(10), 3, true), false, 2),
            SidecarState::Restarting
        );
    }

    #[tokio::test]
    async fn crashing_child_is_restarted_then_capped() {
        let states = Arc::new(Mutex::new(Vec::new()));
        let seen = states.clone();
        let supervisor = Supervisor::new(
            "crashy",
            policy(Some(1), 2, true),
            || {
                tokio::process::Command::new(if cfg!(windows) { "cmd" } else { "false" })
                    .args(if cfg!(windows) {
                        vec!["/C", "exit 1"]
                    } else {
                        vec![]
                    })
                    .spawn()
            },
            move |status| seen.lock().unwrap().push(status.state),
        );
        supervisor.run().await;
        let seen = states.lock().unwrap();
        assert_eq!(seen.last(), Some(&SidecarState::Disabled));
        assert!(seen.contains(&SidecarState::Restarting));
        assert_eq!(supervisor.status().restarts, 2);
    }

    #[tokio::test]
    async fn clean_exit_lands_in_stopped() {
        let supervisor = Supervisor::new(
            "clean",
            policy(Some(1), 2, true),
            || {
                tokio::process::Command::new(if cfg!(windows) { "cmd" } else { "true" })
                    .args(if cfg!(windows) {
                        vec!["/C", "exit 0"]
                    } else {
                        vec![]
                    })
                    .spawn()
            },
            |_| {},
        );
        supervisor.run().await;
        assert_eq!(supervisor.state(), SidecarState::Stopped);
    }
}
