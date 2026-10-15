use std::time::Duration;

use oleafly_collab_protocol::envelope::{Envelope, EnvelopeMode};
use oleafly_collab_protocol::frames::{ClientFrame, FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::BatchId;
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};

use super::incoming::{next_frame, ready_updates, take_in};
use super::reconnect::{busy, ending_for_version, refused_version, Exit, Reached};
use super::snapshot_hint::{hint_snapshot, should_snapshot};
use super::subscribe::subscribe;
use super::trust::Refreshed;
use super::wire::{probe_socket, Probe, Wire};
use super::writers::{seed_peers, WriterRetry};
use super::{lock, EndReason, LiveCommand, LiveEvent, LiveLink, LiveStatus, SharedLive};
use crate::client::upload_allowance;
use crate::live::Outgoing;
use crate::CollabError;

const READY_BURST: u32 = 64;

#[derive(Clone, Copy, Debug)]
pub(super) struct Pace {
    pub(super) probe: Option<Duration>,
    pub(super) ping_every: Duration,
    pub(super) quiet_for: Duration,
}

#[derive(Clone, Copy, Debug)]
struct InFlight {
    bytes: usize,
    sent: Duration,
    // The server answered a ping sent after the change went out.
    answered: bool,
}

// The server owes an answer within `quiet_for`. While a change is on its
// way up the link may carry nothing back, so the window grows by the time a
// slow but working link needs to carry the change, counted from when it
// went out. The server takes frames in order, so its answer to the change
// comes before its answer to any ping sent after it. Once that ping is
// answered the change's answer is overdue, however busy the connection is
// otherwise. Until then it is not, so a long backlog that keeps the server
// busy after a reconnect doesn't cut the connection. `heard` counts any
// bytes coming in, not only whole frames.
fn too_quiet(heard: Duration, in_flight: Option<InFlight>, quiet_for: Duration) -> bool {
    match in_flight {
        Some(flight) if flight.answered => true,
        Some(flight) => {
            heard.min(flight.sent)
                > quiet_for + upload_allowance(flight.bytes.saturating_mul(4) / 3)
        }
        None => heard > quiet_for,
    }
}

fn envelope(link: &LiveLink, outgoing: &Outgoing) -> Envelope {
    let mut envelope = Envelope {
        v: 1,
        project_id: link.project,
        batch_id: outgoing.batch,
        device_id: link.device_id,
        mode: EnvelopeMode::Plain,
        key_epoch: None,
        payload: outgoing.payload.clone(),
        signature: Vec::new(),
    };
    envelope.signature = link.signing_key().sign(&envelope.signing_bytes()).to_vec();
    envelope
}

async fn flush(
    link: &LiveLink,
    project: &SharedLive,
    events: &UnboundedSender<LiveEvent>,
    wire: &mut Wire,
) -> Result<(), CollabError> {
    let (outgoing, unsendable) = {
        let mut live = lock(project);
        let outgoing = live.next_outgoing()?;
        (outgoing, live.take_unsendable())
    };
    if unsendable {
        let _ = events.send(LiveEvent::Unsendable);
    }
    if let Some(outgoing) = outgoing {
        wire.send(&ClientFrame::Update {
            project_id: link.project,
            envelope: envelope(link, &outgoing),
        })
        .await?;
    }
    Ok(())
}

pub(super) fn refused_for(
    project: &SharedLive,
    code: FrameErrorCode,
) -> Option<Vec<crate::comments::UnsentComment>> {
    let mut live = lock(project);
    if code == FrameErrorCode::CommentsOff {
        if let Ok(Some(unsent)) = live.comments_refused() {
            return Some(unsent);
        }
    }
    live.refused();
    None
}

pub(super) async fn serve(
    link: &LiveLink,
    project: &SharedLive,
    events: &UnboundedSender<LiveEvent>,
    commands: &mut UnboundedReceiver<LiveCommand>,
    mut wire: Wire,
    pace: Pace,
    retry: &WriterRetry,
) -> Exit {
    let exit = serve_wire(link, project, events, commands, &mut wire, pace, retry).await;
    wire.close().await;
    exit
}

async fn serve_wire(
    link: &LiveLink,
    project: &SharedLive,
    events: &UnboundedSender<LiveEvent>,
    commands: &mut UnboundedReceiver<LiveCommand>,
    wire: &mut Wire,
    pace: Pace,
    retry: &WriterRetry,
) -> Exit {
    let (role, head) = match subscribe(link, project, events, wire, retry).await {
        Ok(Ok(subscribed)) => subscribed,
        Ok(Err(reason)) => return Exit::End(reason),
        Err(CollabError::Unauthorized) => return Exit::End(EndReason::SignedOut),
        Err(CollabError::ServerChanged { .. }) => return Exit::End(EndReason::ServerChanged),
        Err(CollabError::SessionEnded(reason)) => {
            return Exit::End(EndReason::of_session(Some(reason)))
        }
        Err(error) if refused_version(&error) => {
            return match ending_for_version(link).await {
                Some(reason) => Exit::End(reason),
                None => Exit::Retry(Reached::Never),
            }
        }
        Err(error) if busy(&error) => return Exit::Busy,
        Err(_) => return Exit::Retry(Reached::Never),
    };
    if !lock(project).peers_vouched() {
        seed_peers(link, project, events, retry).await;
    }
    let catching_up = {
        let mut live = lock(project);
        live.set_role(role);
        live.mark_connected();
        let behind = live.last_seq() < head;
        if behind && live.last_seq() > 0 {
            live.begin_catch_up();
        }
        behind.then_some(head)
    };
    if catching_up.is_none() {
        report_merged(project, events);
    }
    let _ = events.send(LiveEvent::Role(role));
    let _ = events.send(LiveEvent::Status(LiveStatus::Online));
    let started = tokio::time::Instant::now();
    match online(link, project, events, commands, wire, catching_up, pace).await {
        Exit::Retry(_) => Exit::Retry(Reached::after(started.elapsed())),
        other => other,
    }
}

fn report_merged(project: &SharedLive, events: &UnboundedSender<LiveEvent>) {
    if let Some(report) = lock(project).end_catch_up() {
        let _ = events.send(LiveEvent::Merged(report));
    }
}

async fn online(
    link: &LiveLink,
    project: &SharedLive,
    events: &UnboundedSender<LiveEvent>,
    commands: &mut UnboundedReceiver<LiveCommand>,
    wire: &mut Wire,
    mut catching_up: Option<u64>,
    pace: Pace,
) -> Exit {
    let retry = Exit::Retry(Reached::Briefly);
    if flush(link, project, events, wire).await.is_err() {
        return retry;
    }
    let (found_tx, mut found) = mpsc::channel::<()>(1);
    let _probe = pace.probe.map(|every| {
        Probe(tokio::spawn(probe_socket(
            link.clone(),
            every,
            found_tx.clone(),
        )))
    });
    let mut ping = tokio::time::interval(pace.ping_every);
    ping.tick().await;
    let mut ping_id = 0u64;
    let mut last_heard = tokio::time::Instant::now();
    let mut since_snapshot = 0u64;
    let mut refreshed = Refreshed::default();
    let mut burst = 0u32;
    let mut held: Option<ServerFrame> = None;
    let mut missing_since: Option<tokio::time::Instant> = None;
    // The change in flight, with the first ping sent after it went out, and
    // the last change the server answered such a ping for.
    let mut watched: Option<(BatchId, u64)> = None;
    let mut answered: Option<BatchId> = None;
    loop {
        tokio::select! {
            biased;
            frame = next_frame(&mut held, wire), if burst < READY_BURST => {
                burst += 1;
                let Ok(frame) = frame else { return retry };
                last_heard = tokio::time::Instant::now();
                match frame {
                    ServerFrame::Update { seq, account_id, envelope, .. } => {
                        let (backlog, broken) = ready_updates(wire, &mut held, (seq, account_id, envelope));
                        burst = burst.saturating_add(u32::try_from(backlog.len() - 1).unwrap_or(u32::MAX));
                        let seq = backlog.iter().map(|(seq, ..)| *seq).max().unwrap_or(seq);
                        let (imported, whole) = take_in(link, project, events, &mut refreshed, backlog).await;
                        if imported > 0 {
                            let _ = events.send(LiveEvent::Changed);
                            since_snapshot += imported as u64;
                        }
                        if broken || !whole {
                            return retry;
                        }
                        if catching_up.is_some_and(|head| seq >= head) {
                            catching_up = None;
                            report_merged(project, events);
                        }
                        let more = lock(project).sendable_now();
                        if more && flush(link, project, events, wire).await.is_err() {
                            return retry;
                        }
                    }
                    ServerFrame::Ack { batch_id, seq, .. } => {
                        {
                            let mut live = lock(project);
                            live.acknowledged(batch_id, seq);
                            live.bind_own_peer(link.device_id);
                        }
                        let _ = events.send(LiveEvent::Acknowledged);
                        since_snapshot += 1;
                        if should_snapshot(seq) {
                            since_snapshot = 0;
                            hint_snapshot(link, project);
                        }
                        if flush(link, project, events, wire).await.is_err() {
                            return retry;
                        }
                    }
                    ServerFrame::Presence { device_id, account_id, state, .. } => {
                        let _ = events.send(LiveEvent::Presence { device_id, account_id, state });
                    }
                    ServerFrame::PresenceLeft { device_id, .. } => {
                        let _ = events.send(LiveEvent::PresenceLeft { device_id });
                    }
                    ServerFrame::AccessChanged { role, change, comments, .. } => {
                        if let Some(change) = change {
                            let _ = events.send(LiveEvent::Members(change));
                        }
                        let Some(role) = role else {
                            return Exit::End(EndReason::Removed);
                        };
                        let more = {
                            let mut live = lock(project);
                            live.set_role(role);
                            live.sendable_now()
                        };
                        let _ = events.send(LiveEvent::Role(role));
                        if let Some(comments) = comments {
                            let _ = events.send(LiveEvent::Comments(comments));
                        }
                        if more && flush(link, project, events, wire).await.is_err() {
                            return retry;
                        }
                    }
                    ServerFrame::Pong { id } => {
                        if let Some((batch, _)) = watched.filter(|(_, first)| id >= *first) {
                            answered = Some(batch);
                        }
                    }
                    ServerFrame::ProjectArchived { .. } => return Exit::End(EndReason::Archived),
                    ServerFrame::SessionRevoked { reason } => return Exit::End(EndReason::of_session(reason)),
                    // The batch stays as it is, neither cut smaller nor given
                    // up, and goes out again after the next reconnect. Until
                    // then it waits for no answer, so it can't cut the
                    // connection as overdue.
                    ServerFrame::Error { code: FrameErrorCode::ProjectTooLarge, .. } => {
                        if lock(project).refused_as_full() {
                            let _ = events.send(LiveEvent::ProjectFull);
                        }
                    }
                    ServerFrame::Error { code: FrameErrorCode::TooLarge, .. } => {
                        lock(project).too_large();
                        if flush(link, project, events, wire).await.is_err() {
                            return retry;
                        }
                    }
                    ServerFrame::Error { code: code @ (FrameErrorCode::Forbidden | FrameErrorCode::CommentsOff), .. } => {
                        if let Some(unsent) = refused_for(project, code) {
                            let _ = events.send(LiveEvent::CommentsNotSent(unsent));
                            if flush(link, project, events, wire).await.is_err() {
                                return retry;
                            }
                        }
                    }
                    ServerFrame::Error { code: FrameErrorCode::RateLimited, .. } => return Exit::Busy,
                    ServerFrame::Error { .. } => return retry,
                    _ => {}
                }
            }
            command = commands.recv() => {
                burst = 0;
                // A desktop thread that panicked in the project marks it
                // damaged, and the session ends as failed.
                if lock(project).damaged() {
                    return retry;
                }
                match command {
                    Some(LiveCommand::Flush) => {
                        if flush(link, project, events, wire).await.is_err() {
                            return retry;
                        }
                    }
                    Some(LiveCommand::Presence(state)) => {
                        let frame = ClientFrame::Presence { project_id: link.project, state };
                        if wire.send(&frame).await.is_err() {
                            return retry;
                        }
                    }
                    Some(LiveCommand::LeavePresence) => {
                        let frame = ClientFrame::PresenceLeave { project_id: link.project };
                        if wire.send(&frame).await.is_err() {
                            return retry;
                        }
                    }
                    Some(LiveCommand::Reconnect) => {}
                    Some(LiveCommand::Stop) | None => {
                        if lock(project).can_edit() && since_snapshot > 0 {
                            hint_snapshot(link, project);
                        }
                        return Exit::End(EndReason::Stopped);
                    }
                }
            }
            Some(()) = found.recv() => return Exit::Switch,
            _ = ping.tick() => {
                burst = 0;
                if lock(project).damaged() {
                    return retry;
                }
                let flying = lock(project).in_flight();
                let in_flight = flying.map(|(batch, bytes, sent)| InFlight {
                    bytes,
                    sent: sent.elapsed(),
                    answered: answered == Some(batch),
                });
                let heard = wire
                    .silent_for()
                    .map_or(last_heard.elapsed(), |bytes| bytes.min(last_heard.elapsed()));
                if too_quiet(heard, in_flight, pace.quiet_for) {
                    return retry;
                }
                let missing = lock(project).missing_changes();
                missing_since = match (missing, missing_since) {
                    (false, _) => None,
                    (true, None) => Some(tokio::time::Instant::now()),
                    (true, Some(since)) if catching_up.is_none() && since.elapsed() > pace.quiet_for => {
                        let reload = lock(project).request_resync(std::time::Instant::now());
                        if reload {
                            return Exit::Resync;
                        }
                        Some(since)
                    }
                    (true, since) => since,
                };
                ping_id += 1;
                if let Some((batch, ..)) = flying {
                    if watched.is_none_or(|(watching, _)| watching != batch) {
                        watched = Some((batch, ping_id));
                    }
                }
                if wire.send(&ClientFrame::Ping { id: ping_id }).await.is_err() {
                    return retry;
                }
            }
            () = std::future::ready(()), if burst >= READY_BURST => burst = 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_change_on_its_way_up_extends_the_quiet_window_by_what_a_slow_link_needs() {
        let quiet = Duration::from_secs(30);
        assert!(!too_quiet(Duration::from_secs(29), None, quiet));
        assert!(too_quiet(Duration::from_secs(31), None, quiet));
        let half_a_megabyte = 512 * 1024;
        let carried = Duration::from_secs(30) + upload_allowance(half_a_megabyte * 4 / 3);
        assert!(carried > Duration::from_secs(70));
        let long_ago = Duration::from_secs(600);
        let sent = |ago: Duration| {
            Some(InFlight {
                bytes: half_a_megabyte,
                sent: ago,
                answered: false,
            })
        };
        assert!(!too_quiet(long_ago, sent(Duration::from_secs(60)), quiet));
        assert!(too_quiet(
            long_ago,
            sent(carried + Duration::from_secs(1)),
            quiet
        ));
    }

    #[test]
    fn an_answer_is_overdue_only_once_a_later_ping_is_answered() {
        let quiet = Duration::from_secs(30);
        let small = |answered| {
            Some(InFlight {
                bytes: 200,
                sent: Duration::from_secs(600),
                answered,
            })
        };
        assert!(!too_quiet(Duration::from_secs(5), small(false), quiet));
        assert!(too_quiet(Duration::from_secs(5), small(true), quiet));
        assert!(too_quiet(Duration::from_secs(31), small(false), quiet));
    }
}
