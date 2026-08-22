type Transition<State extends string, Event extends string> = Readonly<{
  from: State;
  event: Event;
  to: State;
}>;

function transition<State extends string, Event extends string>(
  machine: readonly Transition<State, Event>[],
  state: State,
  event: Event,
): State | null {
  return machine.find((candidate) =>
    candidate.from === state && candidate.event === event
  )?.to ?? null;
}

export const LOCAL_PROJECT_TRANSITIONS = [
  { from: "local", event: "begin_share", to: "sharing_staging" },
  { from: "sharing_staging", event: "staging_ready", to: "sharing_cutover" },
  { from: "sharing_staging", event: "share_failed", to: "local" },
  { from: "sharing_cutover", event: "share_failed", to: "local" },
  { from: "sharing_cutover", event: "cutover_committed", to: "shared_active" },
  { from: "local", event: "begin_join", to: "joining_bootstrap" },
  { from: "joining_bootstrap", event: "bootstrap_durable", to: "shared_active" },
  { from: "joining_bootstrap", event: "join_failed", to: "local" },
  { from: "shared_active", event: "authorization_revoked", to: "revocation_recovery" },
  { from: "shared_active", event: "leave_confirmed", to: "shared_closed" },
  { from: "revocation_recovery", event: "recovery_detached", to: "shared_closed" },
  { from: "revocation_recovery", event: "recovery_exported", to: "shared_closed" },
  { from: "revocation_recovery", event: "recovery_discarded", to: "shared_closed" },
] as const;

export type LocalProjectState =
  (typeof LOCAL_PROJECT_TRANSITIONS)[number]["from" | "to"];
export type LocalProjectEvent =
  (typeof LOCAL_PROJECT_TRANSITIONS)[number]["event"];

export function transitionLocalProject(
  state: LocalProjectState,
  event: LocalProjectEvent,
): LocalProjectState | null {
  return transition(LOCAL_PROJECT_TRANSITIONS, state, event);
}

export const SYNC_STATUS_TRANSITIONS = [
  { from: "saved_to_team", event: "local_mutation", to: "saved_locally" },
  { from: "saved_locally", event: "local_mutation", to: "saved_locally" },
  { from: "syncing", event: "local_mutation", to: "syncing" },
  { from: "offline", event: "local_mutation", to: "offline" },
  { from: "saved_locally", event: "sync_started", to: "syncing" },
  { from: "offline", event: "sync_started", to: "syncing" },
  { from: "syncing", event: "durable_receipt_pending", to: "syncing" },
  { from: "syncing", event: "durable_receipt_complete", to: "saved_to_team" },
  { from: "syncing", event: "reconciliation_complete_no_pending", to: "saved_to_team" },
  { from: "saved_to_team", event: "connection_lost", to: "offline" },
  { from: "saved_locally", event: "connection_lost", to: "offline" },
  { from: "syncing", event: "connection_lost", to: "offline" },
  { from: "saved_locally", event: "authorization_rejected", to: "recovery_required" },
  { from: "syncing", event: "authorization_rejected", to: "recovery_required" },
  { from: "offline", event: "authorization_rejected", to: "recovery_required" },
] as const;

export type SyncStatus =
  (typeof SYNC_STATUS_TRANSITIONS)[number]["from" | "to"];
export type SyncStatusEvent =
  (typeof SYNC_STATUS_TRANSITIONS)[number]["event"];

export function transitionSyncStatus(
  state: SyncStatus,
  event: SyncStatusEvent,
): SyncStatus | null {
  return transition(SYNC_STATUS_TRANSITIONS, state, event);
}

export const SERVER_PROJECT_TRANSITIONS = [
  { from: "staging", event: "activate", to: "active" },
  { from: "staging", event: "staging_expired", to: "purged" },
  { from: "active", event: "archive", to: "archived_read_only" },
  { from: "active", event: "schedule_delete", to: "delete_pending" },
  { from: "archived_read_only", event: "schedule_delete", to: "delete_pending" },
  { from: "delete_pending", event: "cancel_delete", to: "active" },
  { from: "delete_pending", event: "grace_elapsed", to: "purged" },
] as const;

export type ServerProjectState =
  (typeof SERVER_PROJECT_TRANSITIONS)[number]["from" | "to"];
export type ServerProjectEvent =
  (typeof SERVER_PROJECT_TRANSITIONS)[number]["event"];

export function transitionServerProject(
  state: ServerProjectState,
  event: ServerProjectEvent,
): ServerProjectState | null {
  return transition(SERVER_PROJECT_TRANSITIONS, state, event);
}
