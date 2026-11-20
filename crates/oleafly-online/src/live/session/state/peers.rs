use std::collections::{BTreeMap, BTreeSet};
use std::time::{Duration, Instant};

use super::{Notice, Phase, State};
use crate::live::presence::{to_offset, to_row_column};
use crate::live::session::LivePeer;
use crate::live::DocId;
use crate::realtime::events::{PeerPosition, PublicId};

struct Known {
    at: Option<(u64, u64)>,
    shown: LivePeer,
}

#[derive(Default)]
pub(super) struct Peers {
    known: BTreeMap<PublicId, Known>,
    reemit_at: Option<Instant>,
    sent_at: Option<Instant>,
}

impl State {
    pub(in crate::live::session) fn peer(&mut self, peer: PeerPosition) {
        if self.own.contains(&peer.id) {
            return;
        }
        let at = peer.row.zip(peer.column);
        let shown = LivePeer {
            offset: self.offset_of(peer.doc.as_ref(), at),
            id: peer.id,
            user_id: peer.user_id,
            name: peer.name,
            email: peer.email,
            doc: peer.doc,
        };
        self.notices.push(Notice::Peer(shown.clone()));
        self.peers
            .known
            .insert(shown.id.clone(), Known { at, shown });
    }

    fn offset_of(&self, doc: Option<&DocId>, at: Option<(u64, u64)>) -> Option<usize> {
        let (row, column) = at?;
        self.with_text(doc?, |text| to_offset(text, row, column))
    }

    pub(in crate::live::session) fn peer_left(&mut self, id: PublicId) {
        if self.peers.known.remove(&id).is_some() {
            self.notices.push(Notice::PeerLeft(id));
        }
    }

    pub(in crate::live::session) fn connected_users(&mut self, users: Vec<PeerPosition>) {
        let listed: BTreeSet<PublicId> = users.iter().map(|user| user.id.clone()).collect();
        let gone: Vec<PublicId> = self
            .peers
            .known
            .keys()
            .filter(|id| !listed.contains(*id))
            .cloned()
            .collect();
        for id in gone {
            self.peer_left(id);
        }
        for user in users {
            self.peer(user);
        }
    }

    pub(super) fn forget_peers(&mut self) {
        let known: Vec<PublicId> = self.peers.known.keys().cloned().collect();
        for id in known {
            self.peer_left(id);
        }
        self.peers.reemit_at = None;
    }

    pub(in crate::live::session) fn reemit_peers(&mut self, now: Instant, every: Duration) {
        if self.peers.known.is_empty() {
            self.peers.reemit_at = None;
            return;
        }
        let due = *self.peers.reemit_at.get_or_insert(now + every);
        if now < due {
            return;
        }
        self.peers.reemit_at = Some(now + every);
        let unplaced: Vec<(PublicId, Option<usize>)> = self
            .peers
            .known
            .iter()
            .filter(|(_, known)| known.shown.offset.is_none())
            .map(|(id, known)| {
                (
                    id.clone(),
                    self.offset_of(known.shown.doc.as_ref(), known.at),
                )
            })
            .collect();
        for (id, offset) in unplaced {
            if let Some(known) = self.peers.known.get_mut(&id) {
                known.shown.offset = offset;
            }
        }
        for known in self.peers.known.values() {
            self.notices.push(Notice::Peer(known.shown.clone()));
        }
    }

    pub(in crate::live::session) fn set_presence(&mut self, at: Option<(DocId, usize)>) {
        self.presence = at;
        self.presence_due = true;
    }

    pub(in crate::live::session) fn presence_asked(&mut self) {
        self.presence_due = self.presence.is_some();
        self.peers.sent_at = None;
    }

    pub(in crate::live::session) fn take_presence(
        &mut self,
        now: Instant,
        with_peers: Duration,
        alone: Duration,
    ) -> Option<(DocId, u64, u64)> {
        if !self.presence_due || self.project.restricted {
            return None;
        }
        let every = if self.peers.known.is_empty() {
            alone
        } else {
            with_peers
        };
        if self.peers.sent_at.is_some_and(|sent| now < sent + every) {
            return None;
        }
        let Some((doc, offset)) = self.presence.clone() else {
            self.presence_due = false;
            return None;
        };
        let text = self
            .slots
            .get(&doc)
            .filter(|slot| slot.phase == Phase::Joined)
            .and_then(|slot| slot.doc.as_ref())?
            .text();
        let (row, column) = to_row_column(text, offset);
        self.presence_due = false;
        self.peers.sent_at = Some(now);
        Some((doc, row, column))
    }
}
