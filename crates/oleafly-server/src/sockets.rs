use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use oleafly_collab_protocol::auth::SessionEndReason;
use oleafly_collab_protocol::ids::{AccountId, DeviceId};
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};

use crate::routes::ws::{MAX_SOCKETS, MAX_SOCKETS_PER_ACCOUNT};

pub const MAX_SOCKETS_PER_DEVICE: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SocketControl {
    Revoked(Option<SessionEndReason>),
    Overloaded,
    Replaced,
    Restarting,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SocketLimits {
    pub per_account: usize,
    pub total: usize,
}

impl Default for SocketLimits {
    fn default() -> SocketLimits {
        SocketLimits {
            per_account: MAX_SOCKETS_PER_ACCOUNT,
            total: MAX_SOCKETS,
        }
    }
}

#[derive(Default)]
struct OpenSockets {
    total: usize,
    by_account: HashMap<AccountId, usize>,
}

pub struct SocketSlot {
    open: Arc<Mutex<OpenSockets>>,
    account: AccountId,
}

impl Drop for SocketSlot {
    fn drop(&mut self) {
        let mut open = self.open.lock().unwrap_or_else(PoisonError::into_inner);
        open.total = open.total.saturating_sub(1);
        if let Some(held) = open.by_account.get_mut(&self.account) {
            *held = held.saturating_sub(1);
            if *held == 0 {
                open.by_account.remove(&self.account);
            }
        }
    }
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
    limits: Mutex<SocketLimits>,
    open: Arc<Mutex<OpenSockets>>,
    restarting: AtomicBool,
    restart: tokio::sync::Notify,
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

    pub fn set_limits(&self, limits: SocketLimits) {
        *self.limits.lock().unwrap_or_else(PoisonError::into_inner) = limits;
    }

    pub fn limits(&self) -> SocketLimits {
        *self.limits.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn open_slot(&self, account: AccountId, device: DeviceId) -> Option<SocketSlot> {
        let limits = self.limits();
        let mut open = self.open.lock().unwrap_or_else(PoisonError::into_inner);
        let held = open.by_account.get(&account).copied().unwrap_or(0);
        if open.total >= limits.total {
            return None;
        }
        if held >= limits.per_account && !self.replace_oldest(device) {
            return None;
        }
        open.total += 1;
        *open.by_account.entry(account).or_insert(0) += 1;
        Some(SocketSlot {
            open: Arc::clone(&self.open),
            account,
        })
    }

    fn replace_oldest(&self, device: DeviceId) -> bool {
        let oldest = {
            let mut sockets = self.lock();
            let Some(list) = sockets.get_mut(&device) else {
                return false;
            };
            let Some(position) = list
                .iter()
                .enumerate()
                .filter(|(_, entry)| entry.admitted)
                .min_by_key(|(_, entry)| entry.id)
                .map(|(position, _)| position)
            else {
                return false;
            };
            list.remove(position)
        };
        let _ = oldest.sender.send(SocketControl::Replaced);
        true
    }

    pub fn open_sockets(&self) -> usize {
        self.open
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .total
    }

    pub fn restart_all(&self) -> usize {
        self.restarting.store(true, Ordering::SeqCst);
        self.restart.notify_waiters();
        self.lock()
            .values()
            .flatten()
            .filter(|entry| entry.sender.send(SocketControl::Restarting).is_ok())
            .count()
    }

    pub fn is_restarting(&self) -> bool {
        self.restarting.load(Ordering::SeqCst)
    }

    pub async fn restarted(&self) {
        let notified = self.restart.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        if self.is_restarting() {
            return;
        }
        notified.await;
    }

    pub fn register(&self, device: DeviceId) -> SocketTicket {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (sender, control) = mpsc::unbounded_channel();
        if self.is_restarting() {
            let _ = sender.send(SocketControl::Restarting);
        }
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
    fn open_sockets_are_capped_per_account_and_in_total_until_one_closes() {
        let registry = SocketRegistry::new();
        assert_eq!(registry.limits(), SocketLimits::default());
        registry.set_limits(SocketLimits {
            per_account: 2,
            total: 3,
        });
        let (ada, bo, cy) = (
            AccountId::new_v7(),
            AccountId::new_v7(),
            AccountId::new_v7(),
        );
        let device = DeviceId::new_v7();
        let first = registry.open_slot(ada, device).expect("a first socket");
        let _second = registry.open_slot(ada, device).expect("a second socket");
        assert!(registry.open_slot(ada, device).is_none());
        let _other = registry.open_slot(bo, device).expect("another account");
        assert!(registry.open_slot(cy, device).is_none());
        assert_eq!(registry.open_sockets(), 3);
        drop(first);
        assert_eq!(registry.open_sockets(), 2);
        assert!(registry.open_slot(cy, device).is_some());
        assert_eq!(registry.open_sockets(), 2);
    }

    #[tokio::test]
    async fn a_device_at_its_accounts_allowance_replaces_its_own_oldest_socket() {
        let registry = SocketRegistry::new();
        registry.set_limits(SocketLimits {
            per_account: 2,
            total: 10,
        });
        let (account, flapping, other) =
            (AccountId::new_v7(), DeviceId::new_v7(), DeviceId::new_v7());
        let mut tickets = Vec::new();
        let mut slots = Vec::new();
        for _ in 0..2 {
            slots.push(registry.open_slot(account, flapping).expect("room"));
            let ticket = registry.register(flapping);
            registry.admit(flapping, ticket.id);
            tickets.push(ticket);
        }
        assert!(
            registry.open_slot(account, other).is_none(),
            "a device with no socket to replace is refused"
        );
        let third = registry.open_slot(account, flapping);
        assert!(third.is_some(), "the device's oldest socket makes room");
        assert_eq!(
            tickets[0].control.recv().await,
            Some(SocketControl::Replaced)
        );
        assert!(tickets[1].control.try_recv().is_err());
        assert_eq!(registry.count(flapping), 1);
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
