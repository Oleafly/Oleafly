mod incoming;
mod online;
mod reconnect;
mod snapshot_hint;
mod subscribe;
#[cfg(test)]
mod tests;
mod trust;
mod wire;
mod writers;

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use oleafly_collab_protocol::auth::SessionEndReason;
use oleafly_collab_protocol::frames::{CommentSwitches, FrameErrorCode, MemberChange};
use oleafly_collab_protocol::ids::{AccountId, DeviceId, ServerId, SharedProjectId};
use oleafly_collab_protocol::projects::{PresenceState, ProjectRole};
use serde::Serialize;
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio::task::JoinHandle;

use self::reconnect::run;
use crate::client::ServerClient;
use crate::live::{LiveProject, MergeReport};
use crate::{DeviceKey, SessionManager};

#[derive(Clone)]
pub struct LiveLink {
    pub client: Arc<ServerClient>,
    pub server_id: ServerId,
    pub project: SharedProjectId,
    pub device_id: DeviceId,
    pub key: Arc<DeviceKey>,
    pub sessions: Arc<SessionManager>,
}

impl LiveLink {
    fn signing_key(&self) -> Arc<DeviceKey> {
        self.sessions
            .device_key(self.server_id)
            .unwrap_or_else(|_| Arc::clone(&self.key))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EndReason {
    Removed,
    Archived,
    SignedOut,
    Stopped,
    AccountSuspended,
    AccessEnded,
    ClientTooOld,
    ServerTooOld,
    ServerChanged,
    // The session failed: the document engine panicked on a change, or the
    // session itself panicked. The project in memory is not saved; the next
    // start loads it from disk and skips the change at fault.
    Failed,
}

impl EndReason {
    pub fn of_session(reason: Option<SessionEndReason>) -> EndReason {
        match reason {
            Some(SessionEndReason::AccountSuspended) => EndReason::AccountSuspended,
            Some(SessionEndReason::AccessEnded) => EndReason::AccessEnded,
            Some(SessionEndReason::Unknown) | None => EndReason::SignedOut,
        }
    }

    pub fn session(self) -> Option<SessionEndReason> {
        match self {
            EndReason::AccountSuspended => Some(SessionEndReason::AccountSuspended),
            EndReason::AccessEnded => Some(SessionEndReason::AccessEnded),
            EndReason::Removed
            | EndReason::Archived
            | EndReason::SignedOut
            | EndReason::Stopped
            | EndReason::ClientTooOld
            | EndReason::ServerTooOld
            | EndReason::ServerChanged
            | EndReason::Failed => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum LiveStatus {
    Connecting,
    Online,
    Offline { retry_in_ms: u64 },
    Ended { reason: EndReason },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LiveEvent {
    Status(LiveStatus),
    Role(ProjectRole),
    Changed,
    Presence {
        device_id: DeviceId,
        account_id: AccountId,
        state: PresenceState,
    },
    PresenceLeft {
        device_id: DeviceId,
    },
    Members(MemberChange),
    Merged(MergeReport),
    Acknowledged,
    NewDevice {
        account_id: AccountId,
        device_id: DeviceId,
    },
    Untrusted {
        device_id: DeviceId,
        seq: u64,
    },
    Unreadable {
        seq: u64,
        device_id: Option<DeviceId>,
    },
    Unsendable,
    // The project reached the server's size limit, so changes stay on this
    // computer for now. Said once per session.
    ProjectFull,
    CommentsNotSent(Vec<crate::comments::UnsentComment>),
    Comments(CommentSwitches),
}

#[derive(Debug)]
enum LiveCommand {
    Flush,
    Presence(PresenceState),
    LeavePresence,
    Reconnect,
    Stop,
}

pub struct LiveHandle {
    commands: UnboundedSender<LiveCommand>,
    task: JoinHandle<()>,
}

impl LiveHandle {
    pub fn flush(&self) {
        let _ = self.commands.send(LiveCommand::Flush);
    }

    pub fn presence(&self, state: PresenceState) {
        let _ = self.commands.send(LiveCommand::Presence(state));
    }

    pub fn leave_presence(&self) {
        let _ = self.commands.send(LiveCommand::LeavePresence);
    }

    // For when the network changes or the machine wakes: a session waiting
    // to reconnect tries again now and starts its waits over.
    pub fn reconnect_now(&self) {
        let _ = self.commands.send(LiveCommand::Reconnect);
    }

    pub fn stop(&self) {
        let _ = self.commands.send(LiveCommand::Stop);
    }

    pub fn is_finished(&self) -> bool {
        self.task.is_finished()
    }

    pub async fn stopped(self) {
        let _ = self.commands.send(LiveCommand::Stop);
        let _ = self.task.await;
    }
}

pub type SharedLive = Arc<Mutex<LiveProject>>;

fn lock(project: &SharedLive) -> MutexGuard<'_, LiveProject> {
    project.lock().unwrap_or_else(PoisonError::into_inner)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TransportOptions {
    pub fallback_after: u32,
    pub retry_socket_every: Duration,
    pub ping_every: Duration,
    pub quiet_for: Duration,
}

impl Default for TransportOptions {
    fn default() -> TransportOptions {
        TransportOptions {
            fallback_after: 2,
            retry_socket_every: Duration::from_secs(60),
            ping_every: Duration::from_secs(20),
            quiet_for: Duration::from_secs(30),
        }
    }
}

pub fn spawn_live(
    link: LiveLink,
    project: SharedLive,
    events: UnboundedSender<LiveEvent>,
) -> LiveHandle {
    spawn_live_with(link, project, events, TransportOptions::default())
}

pub fn spawn_live_with(
    link: LiveLink,
    project: SharedLive,
    events: UnboundedSender<LiveEvent>,
    options: TransportOptions,
) -> LiveHandle {
    let (commands, receiver) = mpsc::unbounded_channel();
    let task = tokio::spawn(guarded(link, project, events, receiver, options));
    LiveHandle { commands, task }
}

// A panic anywhere in the session still ends it with a status the desktop
// can show. A panic while the project was locked leaves its state in
// doubt, so it is treated like a panic in the document engine.
async fn guarded(
    link: LiveLink,
    project: SharedLive,
    events: UnboundedSender<LiveEvent>,
    commands: mpsc::UnboundedReceiver<LiveCommand>,
    options: TransportOptions,
) {
    use futures_util::FutureExt;
    let watched = Arc::clone(&project);
    let reporting = events.clone();
    let finished = std::panic::AssertUnwindSafe(run(link, project, events, commands, options))
        .catch_unwind()
        .await;
    if finished.is_err() {
        if watched.is_poisoned() {
            lock(&watched).went_bad(true);
        }
        let _ = reporting.send(LiveEvent::Status(LiveStatus::Ended {
            reason: EndReason::Failed,
        }));
    }
}

pub const UNDERSTOOD_CODES: [FrameErrorCode; 2] =
    [FrameErrorCode::CommentsOff, FrameErrorCode::ProjectTooLarge];
