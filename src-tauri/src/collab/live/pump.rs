use std::sync::atomic::Ordering;
use std::sync::{Arc, Weak};

use oleafly_collab::live::MergeReport;
use oleafly_collab::materialize::{self, Layout};
use oleafly_collab::sync::{EndReason, LiveEvent, LiveStatus};
use oleafly_collab::{load_binding, save_binding};
use oleafly_collab_protocol::projects::ProjectRole;
use tokio::sync::mpsc::UnboundedReceiver;

use super::payloads::{
    ChangeSkippedPayload, MembersPayload, MergeMarks, MergedAuthor, MergedFile, MergedPayload,
    NewDevicePayload, PresenceLeftPayload, PresencePayload, ProjectFullPayload, RolePayload,
};
use super::session::{guard, lock, Active, ACTIVE};

fn placed_files(
    layout: &Layout,
    counts: std::collections::BTreeMap<String, u32>,
) -> Vec<MergedFile> {
    counts
        .into_iter()
        .filter_map(|(id, changes)| {
            layout.get(&id).map(|placed| MergedFile {
                path: placed.path.clone(),
                changes,
            })
        })
        .collect()
}

fn merged_payload(project_id: &str, layout: &Layout, report: MergeReport) -> Option<MergedPayload> {
    let files = placed_files(layout, report.files);
    if files.is_empty() {
        return None;
    }
    let authors = report
        .authors
        .into_iter()
        .map(|(account_id, counts)| MergedAuthor {
            account_id,
            files: placed_files(layout, counts),
        })
        .filter(|author| !author.files.is_empty())
        .collect();
    Some(MergedPayload {
        project_id: project_id.to_owned(),
        files,
        authors,
        review: MergeMarks {
            before: oleafly_collab::review::encode_mark(&report.before),
            after: oleafly_collab::review::encode_mark(&report.after),
        },
    })
}

pub(super) async fn pump(
    active: Weak<Active>,
    mut events: UnboundedReceiver<LiveEvent>,
    paths: oleafly_collab::CollabPaths,
) {
    while let Some(event) = events.recv().await {
        let Some(active) = active.upgrade() else {
            return;
        };
        match event {
            LiveEvent::Status(status) => on_status(&active, status, &paths).await,
            LiveEvent::Role(role) => on_role(&active, role, &paths),
            LiveEvent::Changed => on_changed(&active),
            LiveEvent::Acknowledged => active.refresh_pending(),
            LiveEvent::Presence {
                device_id,
                account_id,
                state,
            } => active.host.presence(PresencePayload {
                project_id: active.project_id.clone(),
                device_id,
                account_id,
                path: state.file_id,
                cursor: state.cursor,
                anchor: state.anchor,
            }),
            LiveEvent::PresenceLeft { device_id } => {
                active.host.presence_left(PresenceLeftPayload {
                    project_id: active.project_id.clone(),
                    device_id,
                })
            }
            LiveEvent::Members(change) => active.host.members(MembersPayload {
                project_id: active.project_id.clone(),
                account_id: change.account_id,
                by: change.by,
                kind: change.kind,
            }),
            LiveEvent::Merged(report) => on_merged(&active, report),
            LiveEvent::NewDevice {
                account_id,
                device_id,
            } => active.host.new_device(NewDevicePayload {
                project_id: active.project_id.clone(),
                account_id,
                device_id,
            }),
            LiveEvent::Untrusted { device_id, seq } => {
                let _ = crate::project::append_app_log(format!(
                    "Live collaboration skipped change {seq} in project {}: device {device_id} did not sign it with a key this app knows",
                    active.project_id
                ));
            }
            LiveEvent::Unreadable { seq, device_id } => {
                let from = device_id.map_or_else(
                    || "a device this app doesn't know".to_owned(),
                    |device| format!("device {device}"),
                );
                let _ = crate::project::append_app_log(format!(
                    "Live collaboration skipped change {seq} from {from} in project {}: this app could not read it",
                    active.project_id
                ));
                active.host.change_skipped(ChangeSkippedPayload {
                    project_id: active.project_id.clone(),
                    seq,
                    device_id,
                });
            }
            LiveEvent::Unsendable => {
                let _ = crate::project::append_app_log(format!(
                    "Live collaboration stopped sending changes in project {}: one edit is larger than the server accepts in a single change",
                    active.project_id
                ));
            }
            LiveEvent::CommentsNotSent(unsent) => {
                let _ = crate::project::append_app_log(format!(
                    "Live collaboration left {} comment change(s) out of project {}: comments are turned off there",
                    unsent.len(),
                    active.project_id
                ));
                crate::collab::comments::tell_not_sent(
                    &active.project_id,
                    &active.live,
                    unsent,
                    active.host.as_ref(),
                );
            }
            LiveEvent::Comments(switches) => {
                let role = lock(&active.live).role();
                crate::collab::comments::switched(
                    &paths,
                    &active.project_id,
                    switches,
                    role,
                    active.host.as_ref(),
                );
            }
        }
    }
}

// The pump calls this for the sync engine's LiveEvent::ProjectFull: the
// server refused a change because the project reached its size limit, so
// changes stay on this computer until the limit is raised.
#[allow(dead_code)]
pub(super) fn on_project_full(active: &Active) {
    let _ = crate::project::append_app_log(format!(
        "Live collaboration in project {} reached the server's size limit; changes stay on this computer for now",
        active.project_id
    ));
    active.host.project_full(ProjectFullPayload {
        project_id: active.project_id.clone(),
    });
}

async fn on_status(active: &Arc<Active>, status: LiveStatus, paths: &oleafly_collab::CollabPaths) {
    let ended = match &status {
        LiveStatus::Ended { reason } => Some(*reason),
        _ => None,
    };
    if let Some(reason) = ended {
        let _ = active.write_out().await;
        active.close_figures();
        active.save_now();
        if matches!(
            reason,
            EndReason::Removed | EndReason::Archived | EndReason::AccessEnded
        ) {
            active.detach(paths);
        }
        if let Some(session) = reason.session() {
            active.host.session_ended(active.link.server_id, session);
        }
        let mut slot = guard(&ACTIVE);
        if slot
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, active))
        {
            *slot = None;
        }
    }
    let online = status == LiveStatus::Online;
    active.emit_status(status);
    if online {
        active.reconnected();
    }
}

fn on_role(active: &Active, role: ProjectRole, paths: &oleafly_collab::CollabPaths) {
    if let Ok(Some(mut binding)) = load_binding(paths, &active.project_id) {
        if binding.role != role {
            binding.role = role;
            let _ = save_binding(paths, &active.project_id, &binding);
        }
    }
    active.host.role(RolePayload {
        project_id: active.project_id.clone(),
        role,
    });
}

fn on_changed(active: &Active) {
    let settled = crate::collab::tree::settle(&active.project_id, &active.live);
    if settled.merged {
        active.handle.flush();
    }
    for renamed in settled.renamed {
        active.host.renamed(renamed);
    }
    active.kick();
    crate::collab::comments::announce(
        &active.project_id,
        &active.live,
        active.account_id,
        active.host.as_ref(),
    );
}

fn on_merged(active: &Active, report: MergeReport) {
    if active.quiet_merge.swap(false, Ordering::SeqCst) {
        return;
    }
    let layout = materialize::layout(&lock(&active.live).doc().nodes().unwrap_or_default());
    if let Some(payload) = merged_payload(&active.project_id, &layout, report) {
        active.host.merged(payload);
    }
}
