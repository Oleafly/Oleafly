use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};

use oleafly_collab_protocol::frames::ServerFrame;
use oleafly_collab_protocol::ids::{AccountId, DeviceId, SharedProjectId};
use tokio::sync::mpsc::error::TrySendError;
use tokio::sync::mpsc::{Sender, UnboundedSender};

use crate::sockets::SocketControl;

#[derive(Clone)]
pub struct RoomMember {
    pub connection: u64,
    pub device: DeviceId,
    pub account: AccountId,
    pub frames: Sender<ServerFrame>,
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
        let members: Vec<RoomMember> = self.lock().get(&project).cloned().unwrap_or_default();
        for member in members {
            if Some(member.connection) == except {
                continue;
            }
            deliver(&member, frame.clone());
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
        for member in members {
            deliver(&member, frame.clone());
        }
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

    fn lock(&self) -> MutexGuard<'_, HashMap<SharedProjectId, Vec<RoomMember>>> {
        self.rooms.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

pub fn deliver(member: &RoomMember, frame: ServerFrame) {
    match member.frames.try_send(frame) {
        Ok(()) | Err(TrySendError::Closed(_)) => {}
        Err(TrySendError::Full(ServerFrame::Presence { .. })) => {}
        Err(TrySendError::Full(_)) => {
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
    ) -> (
        RoomMember,
        mpsc::Receiver<ServerFrame>,
        mpsc::UnboundedReceiver<SocketControl>,
    ) {
        let (frames, received) = mpsc::channel(capacity);
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
