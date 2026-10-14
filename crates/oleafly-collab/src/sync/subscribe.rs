use std::time::Duration;

use oleafly_collab_protocol::frames::{ClientFrame, FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::projects::ProjectRole;
use tokio::sync::mpsc::UnboundedSender;

use super::wire::Wire;
use super::writers::{admit_writers, listed_peers, retry_writers, WriterRetry};
use super::{lock, EndReason, LiveEvent, LiveLink, SharedLive};
use crate::CollabError;

const SUBSCRIBE_WITHIN: Duration = Duration::from_secs(20);

pub(super) async fn subscribe(
    link: &LiveLink,
    project: &SharedLive,
    events: &UnboundedSender<LiveEvent>,
    wire: &mut Wire,
    retry: &WriterRetry,
) -> Result<Result<(ProjectRole, u64), EndReason>, CollabError> {
    let mut rebased = false;
    for _ in 0..4 {
        let since = lock(project).last_seq();
        wire.send(&ClientFrame::Subscribe {
            project_id: link.project,
            since_seq: since,
        })
        .await?;
        loop {
            let frame = tokio::time::timeout(SUBSCRIBE_WITHIN, wire.next())
                .await
                .map_err(|_| {
                    CollabError::Network("the server did not answer in time".to_owned())
                })??;
            match frame {
                ServerFrame::Subscribed {
                    role,
                    head_seq,
                    since_batch,
                    ..
                } => {
                    if !rebased && lock(project).diverged(head_seq, since_batch) {
                        rebased = true;
                        resync(link, project, events, retry).await?;
                        break;
                    }
                    return Ok(Ok((role, head_seq)));
                }
                ServerFrame::SnapshotRequired { .. } => {
                    let access = link
                        .sessions
                        .access_token(link.server_id, &link.client)
                        .await?;
                    let pinned = lock(project).devices().clone();
                    let verified = crate::snapshots::fetch_verified(
                        &link.client,
                        &access,
                        link.project,
                        &pinned,
                    )
                    .await?;
                    let writers = listed_peers(link).await;
                    let unlisted = {
                        let mut live = lock(project);
                        if let Some(listed) = verified.listed {
                            live.pin_devices(listed);
                        }
                        let unlisted = admit_writers(&mut live, writers);
                        if live.last_seq() > 0 {
                            live.begin_catch_up();
                        }
                        live.import_snapshot(verified.seq, &verified.bytes)?;
                        unlisted
                    };
                    if unlisted {
                        retry_writers(link, project, events, retry);
                    }
                    let _ = events.send(LiveEvent::Changed);
                    break;
                }
                ServerFrame::Error {
                    code: FrameErrorCode::NotFound,
                    ..
                } => return Ok(Err(EndReason::Removed)),
                ServerFrame::ProjectArchived { .. } => return Ok(Err(EndReason::Archived)),
                ServerFrame::SessionRevoked { reason } => {
                    return Ok(Err(EndReason::of_session(reason)))
                }
                ServerFrame::Error { message, .. } => return Err(CollabError::Network(message)),
                _ => {}
            }
        }
    }
    Err(CollabError::Network(
        "the server kept asking for a snapshot".to_owned(),
    ))
}

async fn resync(
    link: &LiveLink,
    project: &SharedLive,
    events: &UnboundedSender<LiveEvent>,
    retry: &WriterRetry,
) -> Result<(), CollabError> {
    let access = link
        .sessions
        .access_token(link.server_id, &link.client)
        .await?;
    let pinned = lock(project).devices().clone();
    let verified =
        crate::snapshots::fetch_verified(&link.client, &access, link.project, &pinned).await?;
    let writers = listed_peers(link).await;
    let unlisted = {
        let mut live = lock(project);
        if let Some(listed) = verified.listed {
            live.pin_devices(listed);
        }
        let unlisted = admit_writers(&mut live, writers);
        live.rebase(verified.seq, &verified.bytes)?;
        unlisted
    };
    if unlisted {
        retry_writers(link, project, events, retry);
    }
    let _ = events.send(LiveEvent::Changed);
    Ok(())
}
