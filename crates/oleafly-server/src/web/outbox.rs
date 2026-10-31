use std::collections::{HashMap, VecDeque};

use oleafly_collab_protocol::envelope::Envelope;
use oleafly_collab_protocol::frames::FrameErrorCode;
use oleafly_collab_protocol::ids::{AccountId, DeviceId};
use tokio::sync::oneshot;

use crate::routes::ws::{CursorGate, Peer};
use crate::state::AppState;
use crate::web::Refusal;

pub(crate) type Reply = oneshot::Sender<Result<(), Refusal>>;

pub enum Answer {
    Done,
    Later(oneshot::Receiver<Result<(), Refusal>>),
}

pub(crate) struct Writer {
    pub(crate) device: DeviceId,
    pub(crate) account: AccountId,
    pub(crate) public_key: Vec<u8>,
    pub(crate) connection: u64,
    pub(crate) understands: Vec<FrameErrorCode>,
}

impl Writer {
    pub(crate) fn of(peer: &Peer<'_>) -> Writer {
        Writer {
            device: peer.device,
            account: peer.account,
            public_key: peer.public_key.to_vec(),
            connection: peer.connection,
            understands: peer.understands.to_vec(),
        }
    }

    pub(crate) fn peer<'a>(&'a self, state: &'a AppState, cursors: &'a CursorGate) -> Peer<'a> {
        Peer {
            state,
            device: self.device,
            account: self.account,
            public_key: &self.public_key,
            connection: self.connection,
            understands: &self.understands,
            cursors,
        }
    }
}

pub(crate) struct Queued {
    pub(crate) order: u64,
    pub(crate) session: u64,
    pub(crate) writer: Writer,
    pub(crate) envelope: Envelope,
    pub(crate) peer: u64,
    pub(crate) size: u64,
    pub(crate) change: Option<String>,
    pub(crate) reply: Option<Reply>,
}

#[derive(Default)]
pub(crate) struct Outbox {
    queue: VecDeque<Queued>,
    running: bool,
    last: u64,
    pending: HashMap<u64, usize>,
}

impl Outbox {
    pub(crate) fn next_order(&mut self) -> u64 {
        self.last += 1;
        self.last
    }

    pub(crate) fn push(&mut self, queued: Queued) -> bool {
        *self.pending.entry(queued.session).or_default() += 1;
        self.queue.push_back(queued);
        let start = !self.running;
        self.running = true;
        start
    }

    pub(crate) fn pop(&mut self) -> Option<Queued> {
        self.queue.pop_front()
    }

    pub(crate) fn busy(&self) -> bool {
        self.running
    }

    pub(crate) fn rest(&mut self) -> bool {
        if !self.queue.is_empty() {
            return false;
        }
        self.running = false;
        true
    }

    pub(crate) fn cancel(&mut self) -> Vec<Queued> {
        self.queue.drain(..).collect()
    }

    pub(crate) fn finish(&mut self, session: u64) {
        if let Some(count) = self.pending.get_mut(&session) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                self.pending.remove(&session);
            }
        }
    }

    pub(crate) fn pending(&self, session: u64) -> usize {
        self.pending.get(&session).copied().unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orders_count_up_and_a_worker_starts_once_until_the_queue_rests() {
        let mut outbox = Outbox::default();
        assert_eq!(outbox.next_order(), 1);
        assert_eq!(outbox.next_order(), 2);
        assert!(!outbox.busy());
        assert!(outbox.rest());
        assert_eq!(outbox.pending(7), 0);
        outbox.finish(7);
        assert_eq!(outbox.pending(7), 0);
    }
}
