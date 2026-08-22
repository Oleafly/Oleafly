use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalProjectState {
    Local,
    SharingStaging,
    SharingCutover,
    JoiningBootstrap,
    SharedActive,
    RevocationRecovery,
    SharedClosed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalProjectEvent {
    BeginShare,
    StagingReady,
    ShareFailed,
    CutoverCommitted,
    BeginJoin,
    BootstrapDurable,
    JoinFailed,
    AuthorizationRevoked,
    LeaveConfirmed,
    RecoveryDetached,
    RecoveryExported,
    RecoveryDiscarded,
}

pub const fn transition_local_project(
    state: LocalProjectState,
    event: LocalProjectEvent,
) -> Option<LocalProjectState> {
    use LocalProjectEvent as Event;
    use LocalProjectState as State;
    match (state, event) {
        (State::Local, Event::BeginShare) => Some(State::SharingStaging),
        (State::SharingStaging, Event::StagingReady) => Some(State::SharingCutover),
        (State::SharingStaging | State::SharingCutover, Event::ShareFailed) => Some(State::Local),
        (State::SharingCutover, Event::CutoverCommitted) => Some(State::SharedActive),
        (State::Local, Event::BeginJoin) => Some(State::JoiningBootstrap),
        (State::JoiningBootstrap, Event::BootstrapDurable) => Some(State::SharedActive),
        (State::JoiningBootstrap, Event::JoinFailed) => Some(State::Local),
        (State::SharedActive, Event::AuthorizationRevoked) => Some(State::RevocationRecovery),
        (State::SharedActive, Event::LeaveConfirmed) => Some(State::SharedClosed),
        (
            State::RevocationRecovery,
            Event::RecoveryDetached | Event::RecoveryExported | Event::RecoveryDiscarded,
        ) => Some(State::SharedClosed),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncStatus {
    SavedLocally,
    Syncing,
    SavedToTeam,
    Offline,
    RecoveryRequired,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncStatusEvent {
    LocalMutation,
    SyncStarted,
    DurableReceiptPending,
    DurableReceiptComplete,
    ReconciliationCompleteNoPending,
    ConnectionLost,
    AuthorizationRejected,
}

pub const fn transition_sync_status(
    state: SyncStatus,
    event: SyncStatusEvent,
) -> Option<SyncStatus> {
    use SyncStatus as State;
    use SyncStatusEvent as Event;
    match (state, event) {
        (State::SavedToTeam, Event::LocalMutation) => Some(State::SavedLocally),
        (State::SavedLocally, Event::LocalMutation) => Some(State::SavedLocally),
        (State::Syncing, Event::LocalMutation) => Some(State::Syncing),
        (State::Offline, Event::LocalMutation) => Some(State::Offline),
        (State::SavedLocally | State::Offline, Event::SyncStarted) => Some(State::Syncing),
        (State::Syncing, Event::DurableReceiptPending) => Some(State::Syncing),
        (State::Syncing, Event::DurableReceiptComplete) => Some(State::SavedToTeam),
        (State::Syncing, Event::ReconciliationCompleteNoPending) => Some(State::SavedToTeam),
        (State::SavedToTeam | State::SavedLocally | State::Syncing, Event::ConnectionLost) => {
            Some(State::Offline)
        }
        (State::SavedLocally | State::Syncing | State::Offline, Event::AuthorizationRejected) => {
            Some(State::RecoveryRequired)
        }
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ServerProjectState {
    Staging,
    Active,
    ArchivedReadOnly,
    DeletePending,
    Purged,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ServerProjectEvent {
    Activate,
    StagingExpired,
    Archive,
    ScheduleDelete,
    CancelDelete,
    GraceElapsed,
}

pub const fn transition_server_project(
    state: ServerProjectState,
    event: ServerProjectEvent,
) -> Option<ServerProjectState> {
    use ServerProjectEvent as Event;
    use ServerProjectState as State;
    match (state, event) {
        (State::Staging, Event::Activate) => Some(State::Active),
        (State::Staging, Event::StagingExpired) => Some(State::Purged),
        (State::Active, Event::Archive) => Some(State::ArchivedReadOnly),
        (State::Active | State::ArchivedReadOnly, Event::ScheduleDelete) => {
            Some(State::DeletePending)
        }
        (State::DeletePending, Event::CancelDelete) => Some(State::Active),
        (State::DeletePending, Event::GraceElapsed) => Some(State::Purged),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_share_never_promotes_the_local_project() {
        assert_eq!(
            transition_local_project(
                LocalProjectState::SharingCutover,
                LocalProjectEvent::ShareFailed
            ),
            Some(LocalProjectState::Local)
        );
    }

    #[test]
    fn leaving_closes_the_shared_project_instead_of_unsharing_in_place() {
        assert_eq!(
            transition_local_project(
                LocalProjectState::SharedActive,
                LocalProjectEvent::LeaveConfirmed
            ),
            Some(LocalProjectState::SharedClosed)
        );
    }

    #[test]
    fn durable_receipt_or_zero_pending_reconciliation_can_finish_sync() {
        assert_eq!(
            transition_sync_status(SyncStatus::Syncing, SyncStatusEvent::DurableReceiptComplete),
            Some(SyncStatus::SavedToTeam)
        );
        assert_eq!(
            transition_sync_status(
                SyncStatus::SavedLocally,
                SyncStatusEvent::DurableReceiptComplete
            ),
            None
        );
        assert_eq!(
            transition_sync_status(
                SyncStatus::Syncing,
                SyncStatusEvent::ReconciliationCompleteNoPending
            ),
            Some(SyncStatus::SavedToTeam)
        );
    }
}
