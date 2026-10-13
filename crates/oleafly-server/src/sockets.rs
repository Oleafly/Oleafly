use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use oleafly_collab_protocol::auth::SessionEndReason;
use oleafly_collab_protocol::ids::DeviceId;
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};

pub const MAX_SOCKETS_PER_DEVICE: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SocketControl {
    Revoked(Option<SessionEndReason>),
    Overloaded,
    Replaced,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LinkTiming {
    pub send_grace: Duration,
    pub min_send_rate: u64,
    pub ping_every: Duration,
    pub idle_after: Duration,
}

impl Default for LinkTiming {
    fn default() -> LinkTiming {
        LinkTiming {
            send_grace: Duration::from_secs(15),
            min_send_rate: 128 * 1024,
            ping_every: Duration::from_secs(30),
            idle_after: Duration::from_secs(90),
        }
    }
}

impl LinkTiming {
    pub fn send_limit(&self, bytes: usize) -> Duration {
        let bytes = u128::try_from(bytes).unwrap_or(u128::MAX);
        let rate = u128::from(self.min_send_rate.max(1));
        let millis = bytes.saturating_mul(1_000) / rate;
        self.send_grace.saturating_add(Duration::from_millis(
            u64::try_from(millis).unwrap_or(u64::MAX),
        ))
    }
}

pub struct SocketTicket {
    pub id: u64,
    pub device: DeviceId,
    pub control: UnboundedReceiver<SocketControl>,
    pub signal: UnboundedSender<SocketControl>,
}

struct Entry {
    id: u64,
    sender: UnboundedSender<SocketControl>,
    admitted: bool,
}

#[derive(Default)]
pub struct SocketRegistry {
    next: AtomicU64,
    sockets: Mutex<HashMap<DeviceId, Vec<Entry>>>,
    timing: Mutex<LinkTiming>,
}

impl SocketRegistry {
    pub fn new() -> SocketRegistry {
        SocketRegistry::default()
    }

    pub fn set_timing(&self, timing: LinkTiming) {
        *self.timing.lock().unwrap_or_else(PoisonError::into_inner) = timing;
    }

    pub fn timing(&self) -> LinkTiming {
        *self.timing.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn register(&self, device: DeviceId) -> SocketTicket {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (sender, control) = mpsc::unbounded_channel();
        self.lock().entry(device).or_default().push(Entry {
            id,
            sender: sender.clone(),
            admitted: false,
        });
        SocketTicket {
            id,
            device,
            control,
            signal: sender,
        }
    }

    pub fn admit(&self, device: DeviceId, id: u64) -> usize {
        let replaced: Vec<UnboundedSender<SocketControl>> = {
            let mut sockets = self.lock();
            let Some(list) = sockets.get_mut(&device) else {
                return 0;
            };
            let Some(entry) = list.iter_mut().find(|entry| entry.id == id) else {
                return 0;
            };
            entry.admitted = true;
            let admitted = list.iter().filter(|entry| entry.admitted).count();
            let mut excess = admitted.saturating_sub(MAX_SOCKETS_PER_DEVICE);
            let mut replaced = Vec::new();
            list.retain(|entry| {
                if excess > 0 && entry.admitted && entry.id != id {
                    excess -= 1;
                    replaced.push(entry.sender.clone());
                    false
                } else {
                    true
                }
            });
            replaced
        };
        for sender in &replaced {
            let _ = sender.send(SocketControl::Replaced);
        }
        replaced.len()
    }

    pub fn unregister(&self, device: DeviceId, id: u64) {
        let mut sockets = self.lock();
        if let Some(list) = sockets.get_mut(&device) {
            list.retain(|entry| entry.id != id);
            if list.is_empty() {
                sockets.remove(&device);
            }
        }
    }

    pub fn revoke(&self, device: DeviceId, reason: Option<SessionEndReason>) -> usize {
        let removed = self.lock().remove(&device).unwrap_or_default();
        removed
            .iter()
            .filter(|entry| entry.sender.send(SocketControl::Revoked(reason)).is_ok())
            .count()
    }

    pub fn count(&self, device: DeviceId) -> usize {
        self.lock().get(&device).map_or(0, Vec::len)
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<DeviceId, Vec<Entry>>> {
        self.sockets.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn revoking_a_device_signals_each_of_its_sockets_once() {
        let registry = SocketRegistry::new();
        let device = DeviceId::new_v7();
        let other = DeviceId::new_v7();
        let mut first = registry.register(device);
        let mut second = registry.register(device);
        let mut unrelated = registry.register(other);
        assert_eq!(registry.count(device), 2);
        assert_eq!(registry.revoke(device, None), 2);
        assert_eq!(
            first.control.recv().await,
            Some(SocketControl::Revoked(None))
        );
        assert_eq!(
            second.control.recv().await,
            Some(SocketControl::Revoked(None))
        );
        assert!(first.control.try_recv().is_err());
        assert_eq!(registry.count(device), 0);
        assert_eq!(registry.count(other), 1);
        assert!(unrelated.control.try_recv().is_err());
    }

    #[tokio::test]
    async fn a_revocation_carries_why_the_session_ended() {
        let registry = SocketRegistry::new();
        let device = DeviceId::new_v7();
        let mut ticket = registry.register(device);
        assert_eq!(
            registry.revoke(device, Some(SessionEndReason::AccountSuspended)),
            1
        );
        assert_eq!(
            ticket.control.recv().await,
            Some(SocketControl::Revoked(Some(
                SessionEndReason::AccountSuspended
            )))
        );
    }

    #[test]
    fn only_admitted_sockets_count_toward_the_device_allowance() {
        let registry = SocketRegistry::new();
        let device = DeviceId::new_v7();
        let mut admitted = Vec::new();
        for _ in 0..MAX_SOCKETS_PER_DEVICE {
            let ticket = registry.register(device);
            assert_eq!(registry.admit(device, ticket.id), 0);
            admitted.push(ticket);
        }
        let mut waiting = registry.register(device);
        let newest = registry.register(device);
        assert_eq!(registry.admit(device, newest.id), 1);
        assert_eq!(
            admitted[0].control.try_recv().ok(),
            Some(SocketControl::Replaced)
        );
        assert!(admitted[1].control.try_recv().is_err());
        assert!(waiting.control.try_recv().is_err());
        assert_eq!(registry.count(device), MAX_SOCKETS_PER_DEVICE + 1);
        assert_eq!(registry.revoke(device, None), MAX_SOCKETS_PER_DEVICE + 1);
    }

    #[test]
    fn a_send_may_take_longer_for_a_bigger_frame() {
        let timing = LinkTiming {
            send_grace: Duration::from_secs(15),
            min_send_rate: 1_000,
            ..LinkTiming::default()
        };
        assert_eq!(timing.send_limit(0), Duration::from_secs(15));
        assert_eq!(timing.send_limit(5_000), Duration::from_secs(20));
        let unlimited = LinkTiming {
            min_send_rate: 0,
            ..timing
        };
        assert!(unlimited.send_limit(usize::MAX) >= Duration::from_secs(15));
    }

    #[test]
    fn unregistering_removes_only_that_socket() {
        let registry = SocketRegistry::new();
        let device = DeviceId::new_v7();
        let first = registry.register(device);
        let _second = registry.register(device);
        assert_eq!(first.device, device);
        registry.unregister(device, first.id);
        assert_eq!(registry.count(device), 1);
        assert_eq!(registry.revoke(device, None), 1);
    }
}
