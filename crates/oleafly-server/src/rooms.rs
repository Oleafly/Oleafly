use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};

use axum::extract::ws::Utf8Bytes;
use oleafly_collab_protocol::frames::ServerFrame;
use oleafly_collab_protocol::ids::{AccountId, DeviceId, SharedProjectId};
use tokio::sync::mpsc::error::{TryRecvError, TrySendError};
use tokio::sync::mpsc::{self, Receiver, Sender, UnboundedSender};

use crate::sockets::SocketControl;

pub const MAX_QUEUED_BYTES: usize = 24 * 1024 * 1024;

pub struct Queued {
    frame: ServerFrame,
    size: usize,
    text: OnceLock<Option<Utf8Bytes>>,
}

impl Queued {
    pub fn new(frame: ServerFrame) -> Arc<Queued> {
        Arc::new(Queued {
            size: frame_size(&frame),
            frame,
            text: OnceLock::new(),
        })
    }

    pub fn frame(&self) -> &ServerFrame {
        &self.frame
    }

    pub fn size(&self) -> usize {
        self.size
    }

    pub fn text(&self) -> Option<Utf8Bytes> {
        self.text
            .get_or_init(|| serde_json::to_string(&self.frame).ok().map(Utf8Bytes::from))
            .clone()
    }

    fn into_frame(self: Arc<Queued>) -> ServerFrame {
        Arc::try_unwrap(self).map_or_else(|shared| shared.frame.clone(), |queued| queued.frame)
    }
}

pub fn frame_size(frame: &ServerFrame) -> usize {
    match frame {
        ServerFrame::Update { envelope, .. } => envelope.payload.len() * 4 / 3 + 256,
        _ => 256,
    }
}

#[derive(Clone)]
pub struct Outbox {
    frames: Sender<Arc<Queued>>,
    queued: Arc<AtomicUsize>,
}

pub struct Outbound {
    frames: Receiver<Arc<Queued>>,
    queued: Arc<AtomicUsize>,
}

pub fn outbox(capacity: usize) -> (Outbox, Outbound) {
    let (frames, received) = mpsc::channel(capacity);
    let queued = Arc::new(AtomicUsize::new(0));
    (
        Outbox {
            frames,
            queued: Arc::clone(&queued),
        },
        Outbound {
            frames: received,
            queued,
        },
    )
}

enum Offered {
    Taken,
    Full,
    Gone,
}

impl Outbox {
    fn offer(&self, item: Arc<Queued>) -> Offered {
        let size = item.size();
        let reserved = self
            .queued
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |held| {
                let after = held.saturating_add(size);
                (held == 0 || after <= MAX_QUEUED_BYTES).then_some(after)
            });
        if reserved.is_err() {
            return Offered::Full;
        }
        match self.frames.try_send(item) {
            Ok(()) => Offered::Taken,
            Err(error) => {
                self.queued.fetch_sub(size, Ordering::SeqCst);
                match error {
                    TrySendError::Full(_) => Offered::Full,
                    TrySendError::Closed(_) => Offered::Gone,
                }
            }
        }
    }

    pub fn queued_bytes(&self) -> usize {
        self.queued.load(Ordering::SeqCst)
    }
}

impl Outbound {
    pub async fn recv_shared(&mut self) -> Option<Arc<Queued>> {
        let item = self.frames.recv().await?;
        self.release(&item);
        Some(item)
    }

    pub fn try_recv_shared(&mut self) -> Result<Arc<Queued>, TryRecvError> {
        let item = self.frames.try_recv()?;
        self.release(&item);
        Ok(item)
    }

    pub async fn recv(&mut self) -> Option<ServerFrame> {
        self.recv_shared().await.map(Queued::into_frame)
    }

    pub fn try_recv(&mut self) -> Result<ServerFrame, TryRecvError> {
        self.try_recv_shared().map(Queued::into_frame)
    }

    fn release(&self, item: &Queued) {
        self.queued.fetch_sub(item.size(), Ordering::SeqCst);
    }
}

#[derive(Clone)]
pub struct RoomMember {
    pub connection: u64,
    pub device: DeviceId,
    pub account: AccountId,
    pub frames: Outbox,
    pub control: UnboundedSender<SocketControl>,
}

#[derive(Default)]
pub struct Rooms {
    rooms: Mutex<HashMap<SharedProjectId, Vec<RoomMember>>>,
}

impl Rooms {
    pub fn new() -> Rooms {
        Rooms::default()
    }

    pub fn join(&self, project: SharedProjectId, member: RoomMember) {
        let mut rooms = self.lock();
        let room = rooms.entry(project).or_default();
        room.retain(|entry| entry.connection != member.connection);
        room.push(member);
    }

    pub fn leave(&self, project: SharedProjectId, connection: u64) -> Option<RoomMember> {
        let mut rooms = self.lock();
        let room = rooms.get_mut(&project)?;
        let position = room
            .iter()
            .position(|entry| entry.connection == connection)?;
        let member = room.remove(position);
        if room.is_empty() {
            rooms.remove(&project);
        }
        Some(member)
    }

    pub fn leave_all(&self, connection: u64) -> Vec<(SharedProjectId, RoomMember)> {
        let mut rooms = self.lock();
        let mut left = Vec::new();
        for (project, room) in rooms.iter_mut() {
            if let Some(position) = room.iter().position(|entry| entry.connection == connection) {
                left.push((*project, room.remove(position)));
            }
        }
        rooms.retain(|_, room| !room.is_empty());
        left
    }

    pub fn is_member(&self, project: SharedProjectId, connection: u64) -> bool {
        self.lock()
            .get(&project)
            .is_some_and(|room| room.iter().any(|entry| entry.connection == connection))
    }

    pub fn broadcast(&self, project: SharedProjectId, except: Option<u64>, frame: &ServerFrame) {
        self.publish(project, except, frame.clone());
    }

    pub fn publish(&self, project: SharedProjectId, except: Option<u64>, frame: ServerFrame) {
        let members: Vec<RoomMember> = self
            .lock()
            .get(&project)
            .map(|room| {
                room.iter()
                    .filter(|entry| Some(entry.connection) != except)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        if members.is_empty() {
            return;
        }
        let shared = Queued::new(frame);
        for member in members {
            offer(&member, Arc::clone(&shared));
        }
    }

    pub fn notify_account(
        &self,
        project: SharedProjectId,
        account: AccountId,
        frame: &ServerFrame,
    ) {
        let members: Vec<RoomMember> = self
            .lock()
            .get(&project)
            .map(|room| {
                room.iter()
                    .filter(|entry| entry.account == account)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        if members.is_empty() {
            return;
        }
        let shared = Queued::new(frame.clone());
        for member in members {
            offer(&member, Arc::clone(&shared));
        }
    }

    pub fn accounts(&self, project: SharedProjectId) -> Vec<AccountId> {
        let mut accounts: Vec<AccountId> = Vec::new();
        if let Some(room) = self.lock().get(&project) {
            for entry in room {
                if !accounts.contains(&entry.account) {
                    accounts.push(entry.account);
                }
            }
        }
        accounts
    }

    pub fn remove_account(&self, project: SharedProjectId, account: AccountId) -> Vec<RoomMember> {
        let mut rooms = self.lock();
        let Some(room) = rooms.get_mut(&project) else {
            return Vec::new();
        };
        let (removed, kept): (Vec<RoomMember>, Vec<RoomMember>) =
            room.drain(..).partition(|entry| entry.account == account);
        *room = kept;
        if room.is_empty() {
            rooms.remove(&project);
        }
        removed
    }

    pub fn close_room(&self, project: SharedProjectId) -> Vec<RoomMember> {
        self.lock().remove(&project).unwrap_or_default()
    }

    pub fn size(&self, project: SharedProjectId) -> usize {
        self.lock().get(&project).map_or(0, Vec::len)
    }

    pub fn occupancy(&self) -> (usize, usize) {
        let rooms = self.lock();
        let people: HashSet<AccountId> = rooms
            .values()
            .flat_map(|room| room.iter().map(|entry| entry.account))
            .collect();
        (rooms.len(), people.len())
    }

    pub fn queued_bytes(&self) -> usize {
        let rooms = self.lock();
        let held: HashMap<u64, usize> = rooms
            .values()
            .flatten()
            .map(|entry| (entry.connection, entry.frames.queued_bytes()))
            .collect();
        held.values().sum()
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<SharedProjectId, Vec<RoomMember>>> {
        self.rooms.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

pub fn deliver(member: &RoomMember, frame: ServerFrame) {
    offer(member, Queued::new(frame));
}

fn offer(member: &RoomMember, item: Arc<Queued>) {
    let presence = matches!(item.frame(), ServerFrame::Presence { .. });
    match member.frames.offer(item) {
        Offered::Taken | Offered::Gone => {}
        Offered::Full if presence => {}
        Offered::Full => {
            let _ = member.control.send(SocketControl::Overloaded);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;

    fn member(
        connection: u64,
        account: AccountId,
        capacity: usize,
    ) -> (RoomMember, Outbound, mpsc::UnboundedReceiver<SocketControl>) {
        let (frames, received) = outbox(capacity);
        let (control, controls) = mpsc::unbounded_channel();
        (
            RoomMember {
                connection,
                device: DeviceId::new_v7(),
                account,
                frames,
                control,
            },
            received,
            controls,
        )
    }

    fn archived(project: SharedProjectId) -> ServerFrame {
        ServerFrame::ProjectArchived {
            project_id: project,
        }
    }

    #[test]
    fn broadcasts_skip_the_sender_and_reach_everyone_else() {
        let rooms = Rooms::new();
        let project = SharedProjectId::new_v7();
        let (alice, mut alice_frames, _a) = member(1, AccountId::new_v7(), 4);
        let (bob, mut bob_frames, _b) = member(2, AccountId::new_v7(), 4);
        rooms.join(project, alice);
        rooms.join(project, bob);
        rooms.broadcast(project, Some(1), &archived(project));
        assert!(alice_frames.try_recv().is_err());
        assert_eq!(bob_frames.try_recv().ok(), Some(archived(project)));
        assert_eq!(rooms.size(project), 2);
        assert!(rooms.leave(project, 1).is_some());
        assert_eq!(rooms.leave_all(2).len(), 1);
        assert_eq!(rooms.size(project), 0);
    }

    #[test]
    fn a_full_queue_asks_the_connection_to_close() {
        let rooms = Rooms::new();
        let project = SharedProjectId::new_v7();
        let (slow, _frames, mut controls) = member(1, AccountId::new_v7(), 1);
        rooms.join(project, slow);
        rooms.broadcast(project, None, &archived(project));
        rooms.broadcast(project, None, &archived(project));
        assert_eq!(controls.try_recv().ok(), Some(SocketControl::Overloaded));
    }

    fn update_of(project: SharedProjectId, bytes: usize) -> ServerFrame {
        ServerFrame::Update {
            project_id: project,
            seq: 1,
            account_id: None,
            envelope: oleafly_collab_protocol::envelope::Envelope {
                v: 1,
                project_id: project,
                batch_id: oleafly_collab_protocol::ids::BatchId::new_v7(),
                device_id: DeviceId::new_v7(),
                mode: oleafly_collab_protocol::envelope::EnvelopeMode::Plain,
                key_epoch: None,
                payload: vec![7; bytes],
                signature: Vec::new(),
            },
        }
    }

    #[test]
    fn a_queue_holding_too_many_bytes_asks_the_connection_to_close() {
        let rooms = Rooms::new();
        let project = SharedProjectId::new_v7();
        let (slow, _frames, mut controls) = member(1, AccountId::new_v7(), 512);
        rooms.join(project, slow);
        for _ in 0..4 {
            rooms.broadcast(project, None, &update_of(project, 8 * 1024 * 1024));
        }
        assert_eq!(controls.try_recv().ok(), Some(SocketControl::Overloaded));
    }

    #[test]
    fn everyone_in_a_room_shares_one_copy_of_a_change() {
        let rooms = Rooms::new();
        let project = SharedProjectId::new_v7();
        let mut queues = Vec::new();
        for connection in 1..=3 {
            let (entry, frames, controls) = member(connection, AccountId::new_v7(), 8);
            rooms.join(project, entry);
            queues.push((frames, controls));
        }
        rooms.broadcast(project, None, &update_of(project, 1024 * 1024));
        assert!(rooms.queued_bytes() > 3 * 1024 * 1024);
        let copies: Vec<Arc<Queued>> = queues
            .iter_mut()
            .map(|(frames, _)| frames.try_recv_shared().expect("a queued change"))
            .collect();
        assert!(Arc::ptr_eq(&copies[0], &copies[1]));
        assert!(Arc::ptr_eq(&copies[1], &copies[2]));
        assert_eq!(rooms.queued_bytes(), 0);
    }

    #[test]
    fn a_single_change_larger_than_the_limit_still_reaches_an_empty_queue() {
        let rooms = Rooms::new();
        let project = SharedProjectId::new_v7();
        let (entry, mut frames, mut controls) = member(1, AccountId::new_v7(), 8);
        rooms.join(project, entry);
        rooms.broadcast(project, None, &update_of(project, MAX_QUEUED_BYTES));
        assert!(controls.try_recv().is_err());
        assert!(frames.try_recv().is_ok());
        rooms.broadcast(project, None, &update_of(project, 1024));
        assert!(controls.try_recv().is_err());
    }

    #[test]
    fn a_full_queue_drops_cursor_updates_instead_of_closing() {
        let rooms = Rooms::new();
        let project = SharedProjectId::new_v7();
        let (slow, _frames, mut controls) = member(1, AccountId::new_v7(), 1);
        rooms.join(project, slow);
        let here = ServerFrame::Presence {
            project_id: project,
            device_id: oleafly_collab_protocol::ids::DeviceId::new_v7(),
            account_id: AccountId::new_v7(),
            state: oleafly_collab_protocol::projects::PresenceState {
                file_id: Some("main".to_owned()),
                cursor: Some(1),
                anchor: None,
            },
        };
        rooms.broadcast(project, None, &here);
        rooms.broadcast(project, None, &here);
        assert!(controls.try_recv().is_err());
    }

    #[test]
    fn occupancy_counts_open_rooms_and_distinct_people() {
        let rooms = Rooms::new();
        assert_eq!(rooms.occupancy(), (0, 0));
        let (first, second) = (SharedProjectId::new_v7(), SharedProjectId::new_v7());
        let alice = AccountId::new_v7();
        let (laptop, _a, _ac) = member(1, alice, 4);
        let (desktop, _b, _bc) = member(2, alice, 4);
        let (bob, _c, _cc) = member(3, AccountId::new_v7(), 4);
        rooms.join(first, laptop);
        rooms.join(first, bob);
        rooms.join(second, desktop);
        assert_eq!(rooms.occupancy(), (2, 2));
        rooms.close_room(first);
        assert_eq!(rooms.occupancy(), (1, 1));
    }

    #[test]
    fn a_room_lists_each_account_in_it_once() {
        let rooms = Rooms::new();
        let project = SharedProjectId::new_v7();
        assert!(rooms.accounts(project).is_empty());
        let alice = AccountId::new_v7();
        let bob = AccountId::new_v7();
        let (laptop, _a, _ac) = member(1, alice, 4);
        let (desktop, _b, _bc) = member(2, alice, 4);
        let (other, _c, _cc) = member(3, bob, 4);
        rooms.join(project, laptop);
        rooms.join(project, desktop);
        rooms.join(project, other);
        rooms.join(
            SharedProjectId::new_v7(),
            member(4, AccountId::new_v7(), 4).0,
        );
        assert_eq!(rooms.accounts(project), vec![alice, bob]);
    }

    #[test]
    fn an_account_is_notified_and_removed_on_its_own() {
        let rooms = Rooms::new();
        let project = SharedProjectId::new_v7();
        let leaving = AccountId::new_v7();
        let (alice, mut alice_frames, _a) = member(1, leaving, 4);
        let (bob, mut bob_frames, _b) = member(2, AccountId::new_v7(), 4);
        rooms.join(project, alice);
        rooms.join(project, bob);
        rooms.notify_account(project, leaving, &archived(project));
        assert!(alice_frames.try_recv().is_ok());
        assert!(bob_frames.try_recv().is_err());
        assert_eq!(rooms.remove_account(project, leaving).len(), 1);
        assert!(!rooms.is_member(project, 1));
        assert!(rooms.is_member(project, 2));
        assert_eq!(rooms.close_room(project).len(), 1);
    }
}
