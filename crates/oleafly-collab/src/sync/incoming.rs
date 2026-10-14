use std::collections::BTreeSet;

use futures_util::FutureExt;
use oleafly_collab_protocol::envelope::{Envelope, EnvelopeMode};
use oleafly_collab_protocol::frames::ServerFrame;
use oleafly_collab_protocol::ids::AccountId;
use tokio::sync::mpsc::UnboundedSender;

use super::trust::{trust, Refreshed, Trust};
use super::wire::Wire;
use super::{lock, LiveEvent, LiveLink, SharedLive};
use crate::live::Arrival;
use crate::CollabError;

const BACKLOG_BATCH: usize = 256;

pub(super) type Incoming = (u64, Option<AccountId>, Envelope);

pub(super) async fn next_frame(
    held: &mut Option<ServerFrame>,
    wire: &mut Wire,
) -> Result<ServerFrame, CollabError> {
    match held.take() {
        Some(frame) => Ok(frame),
        None => wire.next().await,
    }
}

pub(super) fn ready_updates(
    wire: &mut Wire,
    held: &mut Option<ServerFrame>,
    first: Incoming,
) -> (Vec<Incoming>, bool) {
    let mut backlog = vec![first];
    while backlog.len() < BACKLOG_BATCH {
        match wire.next().now_or_never() {
            Some(Ok(ServerFrame::Update {
                seq,
                account_id,
                envelope,
                ..
            })) => backlog.push((seq, account_id, envelope)),
            Some(Ok(other)) => {
                *held = Some(other);
                break;
            }
            Some(Err(_)) => return (backlog, true),
            None => break,
        }
    }
    (backlog, false)
}

fn import(
    project: &SharedLive,
    events: &UnboundedSender<LiveEvent>,
    batch: Vec<Arrival>,
) -> Result<usize, CollabError> {
    let (imported, unreadable) = {
        let mut live = lock(project);
        let imported = live.import_arrivals(batch);
        (imported, live.take_unreadable())
    };
    for (seq, device_id) in unreadable {
        let _ = events.send(LiveEvent::Unreadable { seq, device_id });
    }
    imported
}

pub(super) async fn take_in(
    link: &LiveLink,
    project: &SharedLive,
    events: &UnboundedSender<LiveEvent>,
    refreshed: &mut Refreshed,
    backlog: Vec<Incoming>,
) -> (usize, bool) {
    let mut batch: Vec<Arrival> = Vec::new();
    let mut unbound: BTreeSet<u64> = BTreeSet::new();
    let mut imported = 0;
    for (seq, account_id, envelope) in backlog {
        if envelope.mode == EnvelopeMode::Unknown {
            {
                let mut live = lock(project);
                live.note_batch(seq, envelope.batch_id);
                live.skip_update(seq);
            }
            let _ = events.send(LiveEvent::Unreadable {
                seq,
                device_id: Some(envelope.device_id),
            });
            continue;
        }
        let first_seen: Vec<u64> = {
            let live = lock(project);
            live.doc()
                .introduced_peers(&envelope.payload)
                .unwrap_or_default()
                .into_iter()
                .filter(|peer| live.devices().device_of_peer(*peer).is_none())
                .collect()
        };
        if first_seen.iter().any(|peer| unbound.contains(peer)) {
            match import(project, events, std::mem::take(&mut batch)) {
                Ok(count) => imported += count,
                Err(_) => return (imported, false),
            }
            unbound.clear();
        }
        lock(project).note_batch(seq, envelope.batch_id);
        match trust(link, project, events, refreshed, &envelope, account_id).await {
            Trust::Signed(author) => {
                unbound.extend(first_seen);
                batch.push(Arrival {
                    seq,
                    payload: envelope.payload,
                    device: Some(envelope.device_id),
                    author,
                });
            }
            Trust::Refused => {
                lock(project).skip_update(seq);
                let _ = events.send(LiveEvent::Untrusted {
                    device_id: envelope.device_id,
                    seq,
                });
            }
            Trust::Unreachable => {
                let count = import(project, events, batch).unwrap_or(0);
                return (imported + count, false);
            }
        }
    }
    match import(project, events, batch) {
        Ok(count) => (imported + count, true),
        Err(_) => (imported, false),
    }
}
