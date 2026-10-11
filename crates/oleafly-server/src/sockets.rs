use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};

use oleafly_collab_protocol::ids::DeviceId;
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SocketControl {
    Revoked,
}

pub struct SocketTicket {
    pub id: u64,
    pub device: DeviceId,
    pub control: UnboundedReceiver<SocketControl>,
}

type Senders = Vec<(u64, UnboundedSender<SocketControl>)>;

#[derive(Default)]
pub struct SocketRegistry {
    next: AtomicU64,
    sockets: Mutex<HashMap<DeviceId, Senders>>,
}

impl SocketRegistry {
    pub fn new() -> SocketRegistry {
        SocketRegistry::default()
    }

    pub fn register(&self, device: DeviceId) -> SocketTicket {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (sender, control) = mpsc::unbounded_channel();
        self.lock().entry(device).or_default().push((id, sender));
        SocketTicket {
            id,
            device,
            control,
        }
    }

    pub fn unregister(&self, device: DeviceId, id: u64) {
        let mut sockets = self.lock();
        if let Some(list) = sockets.get_mut(&device) {
            list.retain(|(entry, _)| *entry != id);
            if list.is_empty() {
                sockets.remove(&device);
            }
        }
    }

    pub fn revoke(&self, device: DeviceId) -> usize {
        let removed = self.lock().remove(&device).unwrap_or_default();
        removed
            .iter()
            .filter(|(_, sender)| sender.send(SocketControl::Revoked).is_ok())
            .count()
    }

    pub fn count(&self, device: DeviceId) -> usize {
        self.lock().get(&device).map_or(0, Vec::len)
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<DeviceId, Senders>> {
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
        assert_eq!(registry.revoke(device), 2);
        assert_eq!(first.control.recv().await, Some(SocketControl::Revoked));
        assert_eq!(second.control.recv().await, Some(SocketControl::Revoked));
        assert_eq!(first.control.recv().await, None);
        assert_eq!(registry.count(device), 0);
        assert_eq!(registry.count(other), 1);
        assert!(unrelated.control.try_recv().is_err());
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
        assert_eq!(registry.revoke(device), 1);
    }
}
