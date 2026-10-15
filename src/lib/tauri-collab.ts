// The IPC wrappers for live collaboration. Only collaboration screens and
// the live session import this module, so it loads once collaboration is in
// use, not with the window. The app link pair that has to be heard from the
// start stays in tauri.ts.
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  CollabAccessLogPage,
  CollabAccessLogStatus,
  CollabAdminOverview,
  CollabAdminProject,
  CollabAdminProjectsPage,
  CollabAdminProjectsQuery,
  CollabAllowlistEntry,
  CollabCapabilities,
  CollabCommandError,
  CollabCommentCount,
  CollabCommentError,
  CollabCommentErrorCode,
  CollabCommentMember,
  CollabCommentMessage,
  CollabCommentThread,
  CollabCommentThreadList,
  CollabCommentsChanged,
  CollabCommentsNotSent,
  CollabCommentsStatus,
  CollabCommentsStatusChanged,
  CollabConnectionCheck,
  CollabDevice,
  CollabDocMessage,
  CollabDocOpened,
  CollabDomainRule,
  CollabEmailPreferences,
  CollabEmailPreferencesPatch,
  CollabEmailStatus,
  CollabEmailTestResult,
  CollabErrorCode,
  CollabGuestInvitation,
  CollabGuestInviteResult,
  CollabLiveInfo,
  CollabLiveMerged,
  CollabLiveNewDevice,
  CollabLiveRole,
  CollabLiveStatus,
  CollabMember,
  CollabMemberPatch,
  CollabMergeReviewFile,
  CollabNewAllowlistEntry,
  CollabNewDomainRule,
  CollabPage,
  CollabPerson,
  CollabPresence,
  CollabPresenceLeft,
  CollabProjectGuestInvitations,
  CollabProjectMember,
  CollabProjectRole,
  CollabProjectSummary,
  CollabRuntimeSettings,
  CollabRuntimeSettingsPatch,
  CollabSecurityEvent,
  CollabServer,
  CollabServerChanged,
  CollabShareCheck,
  CollabShareInfo,
  CollabShareProgress,
  CollabSharedWithMe,
  CollabSignInCode,
  CollabSyncDecision,
  CollabSyncPaused,
  CollabSyncResumed,
  CollabTextOperation,
} from "@oleafly/backend-port";

export const COLLAB_SERVER_CHANGED_EVENT = "collab-server-changed";

const COLLAB_ERROR_CODES = new Set<string>([
  "unreachable",
  "not_https",
  "client_too_old",
  "server_too_old",
  "not_admitted",
  "sign_in_cancelled",
  "sign_in_timed_out",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "setup_code_invalid",
  "server",
  "internal",
  "server_changed",
  "duplicate_server",
  "device_in_use",
  "server_unknown",
  "too_large",
  "invalid",
  "invalid_domain",
  "invalid_email",
  "invalid_login",
  "guests_off",
  "link_sharing_off",
  "access_log_off",
  "last_admin",
  "duplicate_entry",
  "already_member",
  "project_not_shared",
  "project_full",
  "not_a_link",
  "signed_out",
  "server_removed",
  "share_in_progress",
  "cancelled",
  "turned_off",
  "cloud_synced",
  "owner_away",
  "wrong_server",
] satisfies CollabErrorCode[]);

export function isCollabCommandError(value: unknown): value is CollabCommandError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { code?: unknown; message?: unknown };
  return (
    typeof candidate.code === "string" &&
    COLLAB_ERROR_CODES.has(candidate.code) &&
    typeof candidate.message === "string"
  );
}

export function onCollabServerChanged(
  handler: (payload: CollabServerChanged) => void,
): Promise<UnlistenFn> {
  return listen<CollabServerChanged>(COLLAB_SERVER_CHANGED_EVENT, ({ payload }) => handler(payload));
}

export const collabServersList = () => invoke<CollabServer[]>("collab_servers_list");
export const collabServerProbe = (url: string) =>
  invoke<CollabCapabilities>("collab_server_probe", { url });
export const collabServerSignIn = (url: string, providerId: string, setupCode?: string) =>
  invoke<CollabServer>("collab_server_sign_in", { url, providerId, setupCode: setupCode ?? null });
export const collabServerSignInCancel = () => invoke<void>("collab_server_sign_in_cancel");
export const collabServerSignOut = (serverId: string, keepLocalCopy = false) =>
  invoke<import("@oleafly/backend-port").CollabSignOut>("collab_server_sign_out", { serverId, keepLocalCopy });
export const collabServerRemove = (serverId: string, keepLocalCopy = false) =>
  invoke<import("@oleafly/backend-port").CollabSignOut>("collab_server_remove", { serverId, keepLocalCopy });
export const collabServerDevices = (serverId: string) =>
  invoke<CollabDevice[]>("collab_server_devices", { serverId });
export const collabServerSignOutDevice = (serverId: string, deviceId: string) =>
  invoke<void>("collab_server_sign_out_device", { serverId, deviceId });
export const collabServerTest = (url: string) =>
  invoke<CollabConnectionCheck[]>("collab_server_test", { url });
export const collabServerRefresh = (serverId: string) =>
  invoke<CollabServer>("collab_server_refresh", { serverId });
export const collabAdminMembers = (serverId: string) =>
  invoke<CollabMember[]>("collab_admin_members", { serverId });
export const collabAdminMemberDevices = (serverId: string, accountId: string) =>
  invoke<CollabDevice[]>("collab_admin_member_devices", { serverId, accountId });
export const collabAdminPatchMember = (serverId: string, accountId: string, patch: CollabMemberPatch) =>
  invoke<CollabMember>("collab_admin_patch_member", { serverId, accountId, patch });
export const collabAdminRemoveMember = (serverId: string, accountId: string) =>
  invoke<void>("collab_admin_remove_member", { serverId, accountId });
export const collabAdminSignOutDevice = (serverId: string, deviceId: string) =>
  invoke<void>("collab_admin_sign_out_device", { serverId, deviceId });
export const collabAdminAllowlist = (serverId: string) =>
  invoke<CollabAllowlistEntry[]>("collab_admin_allowlist", { serverId });
export const collabAdminAddAllowlist = (serverId: string, entry: CollabNewAllowlistEntry) =>
  invoke<CollabAllowlistEntry>("collab_admin_add_allowlist", { serverId, entry });
export const collabAdminRemoveAllowlist = (serverId: string, entryId: string) =>
  invoke<void>("collab_admin_remove_allowlist", { serverId, entryId });
export const collabAdminDomainRules = (serverId: string) =>
  invoke<CollabDomainRule[]>("collab_admin_domain_rules", { serverId });
export const collabAdminAddDomainRule = (serverId: string, rule: CollabNewDomainRule) =>
  invoke<CollabDomainRule>("collab_admin_add_domain_rule", { serverId, rule });
export const collabAdminRemoveDomainRule = (serverId: string, ruleId: string) =>
  invoke<void>("collab_admin_remove_domain_rule", { serverId, ruleId });
export const collabAdminSettings = (serverId: string) =>
  invoke<CollabRuntimeSettings>("collab_admin_settings", { serverId });
export const collabAdminPatchSettings = (serverId: string, patch: CollabRuntimeSettingsPatch) =>
  invoke<CollabRuntimeSettings>("collab_admin_patch_settings", { serverId, patch });
export const collabAdminSecurityLog = (serverId: string, cursor?: string) =>
  invoke<CollabPage<CollabSecurityEvent>>("collab_admin_security_log", {
    serverId,
    cursor: cursor ?? null,
  });

export const COLLAB_SHARE_PROGRESS_EVENT = "collab-share-progress";
export const COLLAB_LIVE_STATUS_EVENT = "collab-live-status";
export const COLLAB_LIVE_ROLE_EVENT = "collab-live-role";
export const COLLAB_PRESENCE_EVENT = "collab-presence";
export const COLLAB_PRESENCE_LEFT_EVENT = "collab-presence-left";
export const COLLAB_LIVE_MERGED_EVENT = "collab-live-merged";
export const COLLAB_LIVE_NEW_DEVICE_EVENT = "collab-live-new-device";
export const collabShareInfo = (projectId: string) =>
  invoke<CollabShareInfo | null>("collab_share_info", { projectId });
export const collabShareCheck = (projectId: string, serverId: string) =>
  invoke<CollabShareCheck>("collab_share_check", { projectId, serverId });
export const collabShareProject = (projectId: string, serverId: string) =>
  invoke<CollabShareInfo>("collab_share_project", { projectId, serverId });
export const collabProjectSummary = (projectId: string) =>
  invoke<CollabProjectSummary>("collab_project_summary", { projectId });
export const collabMembersList = (projectId: string) =>
  invoke<CollabProjectMember[]>("collab_members_list", { projectId });
export const collabMemberSet = (projectId: string, accountId: string, role: CollabProjectRole) =>
  invoke<CollabProjectMember>("collab_member_set", { projectId, accountId, role });
export const collabMemberRemove = (projectId: string, accountId: string) =>
  invoke<void>("collab_member_remove", { projectId, accountId });
export const collabPeopleSearch = (projectId: string, query: string) =>
  invoke<CollabPerson[]>("collab_people_search", { projectId, query });
export const collabLinkSharingSet = (projectId: string, enabled: boolean, role: CollabProjectRole) =>
  invoke<CollabProjectSummary>("collab_link_sharing_set", { projectId, enabled, role });
export const collabStopSharing = (projectId: string) =>
  invoke<void>("collab_stop_sharing", { projectId });
export const collabLeaveProject = (projectId: string) =>
  invoke<void>("collab_leave_project", { projectId });
export const collabSharedWithMe = () => invoke<CollabSharedWithMe[]>("collab_shared_with_me");
export const collabJoinProject = (serverId: string, sharedProjectId: string) =>
  invoke<string>("collab_join_project", { serverId, sharedProjectId });
// Stops a running join and removes what it downloaded. The join then fails
// with the code "cancelled".
export const collabJoinCancel = (serverId: string, sharedProjectId: string) =>
  invoke<void>("collab_join_cancel", { serverId, sharedProjectId });

export const COLLAB_JOIN_PROGRESS_EVENT = "collab-join-progress";

export function onCollabJoinProgress(
  handler: (payload: import("@oleafly/backend-port").CollabJoinProgress) => void,
): Promise<UnlistenFn> {
  return listen<import("@oleafly/backend-port").CollabJoinProgress>(COLLAB_JOIN_PROGRESS_EVENT, ({ payload }) =>
    handler(payload),
  );
}
export const collabOpenLink = (link: string) => invoke<string>("collab_open_link", { link });
export const collabLiveStart = (projectId: string) =>
  invoke<CollabLiveInfo>("collab_live_start", { projectId });
export const collabLiveStop = (projectId: string) =>
  invoke<void>("collab_live_stop", { projectId });
// Writes the live project's text to disk now. With `waitForFigures` it also
// waits a few seconds for figures still downloading, which only a compile
// needs.
export const collabLiveFlush = (projectId: string, options: { waitForFigures?: boolean } = {}) =>
  invoke<void>("collab_live_flush", { projectId, waitForFigures: options.waitForFigures ?? false });
// Asks a live session that waits between reconnect tries to try now. It
// answers even with nothing running, so callers can fire and forget.
export const collabLiveReconnectNow = () => invoke<void>("collab_live_reconnect_now");
export async function collabDocOpen(
  projectId: string,
  path: string,
  onMessage: (message: CollabDocMessage) => void,
): Promise<CollabDocOpened | null> {
  const channel = new Channel<CollabDocMessage>();
  channel.onmessage = onMessage;
  return await invoke<CollabDocOpened | null>("collab_doc_open", { projectId, path, channel });
}

export const collabDocChange = (
  projectId: string,
  fileId: string,
  rev: number,
  op: CollabTextOperation,
) => invoke<void>("collab_doc_change", { projectId, fileId, rev, op });
export const collabDocClose = (projectId: string, fileId: string, session: number) =>
  invoke<void>("collab_doc_close", { projectId, fileId, session });
export const collabPresenceSet = (
  projectId: string,
  path: string | null,
  cursor: number | null,
  anchor: number | null,
) => invoke<void>("collab_presence_set", { projectId, path, cursor, anchor });
export const collabPresenceLeave = (projectId: string) => invoke<void>("collab_presence_leave", { projectId });
export const collabMergeReview = (projectId: string, before: string, after: string) =>
  invoke<CollabMergeReviewFile[]>("collab_merge_review", { projectId, before, after });

export function onCollabShareProgress(
  handler: (payload: CollabShareProgress) => void,
): Promise<UnlistenFn> {
  return listen<CollabShareProgress>(COLLAB_SHARE_PROGRESS_EVENT, ({ payload }) => handler(payload));
}

export function onCollabLiveStatus(handler: (payload: CollabLiveStatus) => void): Promise<UnlistenFn> {
  return listen<CollabLiveStatus>(COLLAB_LIVE_STATUS_EVENT, ({ payload }) => handler(payload));
}

export function onCollabLiveMerged(handler: (payload: CollabLiveMerged) => void): Promise<UnlistenFn> {
  return listen<CollabLiveMerged>(COLLAB_LIVE_MERGED_EVENT, ({ payload }) => handler(payload));
}

export function onCollabLiveNewDevice(handler: (payload: CollabLiveNewDevice) => void): Promise<UnlistenFn> {
  return listen<CollabLiveNewDevice>(COLLAB_LIVE_NEW_DEVICE_EVENT, ({ payload }) => handler(payload));
}

export function onCollabLiveRole(handler: (payload: CollabLiveRole) => void): Promise<UnlistenFn> {
  return listen<CollabLiveRole>(COLLAB_LIVE_ROLE_EVENT, ({ payload }) => handler(payload));
}

export function onCollabPresence(handler: (payload: CollabPresence) => void): Promise<UnlistenFn> {
  return listen<CollabPresence>(COLLAB_PRESENCE_EVENT, ({ payload }) => handler(payload));
}

export function onCollabPresenceLeft(
  handler: (payload: CollabPresenceLeft) => void,
): Promise<UnlistenFn> {
  return listen<CollabPresenceLeft>(COLLAB_PRESENCE_LEFT_EVENT, ({ payload }) => handler(payload));
}

export const collabWriteText = (projectId: string, path: string, base: string | null, text: string) =>
  invoke<import("@oleafly/backend-port").CollabWriteOutcome>("collab_write_text", { projectId, path, base, text });

export const COLLAB_LIVE_RENAMED_EVENT = "collab-live-renamed";

export const collabTrashList = (projectId: string) =>
  invoke<import("@oleafly/backend-port").CollabTrashEntry[]>("collab_trash_list", { projectId });
export const collabTrashRestore = (projectId: string, id: string) =>
  invoke<void>("collab_trash_restore", { projectId, id });
export const collabTreeClashes = (projectId: string) =>
  invoke<import("@oleafly/backend-port").CollabTreeClash[]>("collab_tree_clashes", { projectId });

export function onCollabLiveRenamed(
  handler: (payload: import("@oleafly/backend-port").CollabLiveRenamed) => void,
): Promise<UnlistenFn> {
  return listen<import("@oleafly/backend-port").CollabLiveRenamed>(COLLAB_LIVE_RENAMED_EVENT, ({ payload }) =>
    handler(payload),
  );
}

export const COLLAB_CHANGE_SKIPPED_EVENT = "collab-change-skipped";
export const COLLAB_LIVE_UNWRITTEN_EVENT = "collab-live-unwritten";
export const COLLAB_LIVE_PROJECT_FULL_EVENT = "collab-live-project-full";
export const COLLAB_LIVE_WRITTEN_EVENT = "collab-live-written";
export const COLLAB_UPLOAD_PROGRESS_EVENT = "collab-upload-progress";

export function onCollabUploadProgress(
  handler: (payload: import("@oleafly/backend-port").CollabUploadProgress) => void,
): Promise<UnlistenFn> {
  return listen<import("@oleafly/backend-port").CollabUploadProgress>(COLLAB_UPLOAD_PROGRESS_EVENT, ({ payload }) =>
    handler(payload),
  );
}

export function onCollabLiveWritten(
  handler: (payload: import("@oleafly/backend-port").CollabLiveWritten) => void,
): Promise<UnlistenFn> {
  return listen<import("@oleafly/backend-port").CollabLiveWritten>(COLLAB_LIVE_WRITTEN_EVENT, ({ payload }) =>
    handler(payload),
  );
}

export function onCollabLiveProjectFull(
  handler: (payload: import("@oleafly/backend-port").CollabLiveProjectFull) => void,
): Promise<UnlistenFn> {
  return listen<import("@oleafly/backend-port").CollabLiveProjectFull>(COLLAB_LIVE_PROJECT_FULL_EVENT, ({ payload }) =>
    handler(payload),
  );
}

export function onCollabLiveUnwritten(
  handler: (payload: import("@oleafly/backend-port").CollabLiveUnwritten) => void,
): Promise<UnlistenFn> {
  return listen<import("@oleafly/backend-port").CollabLiveUnwritten>(COLLAB_LIVE_UNWRITTEN_EVENT, ({ payload }) =>
    handler(payload),
  );
}

export function onCollabChangeSkipped(
  handler: (payload: import("@oleafly/backend-port").CollabChangeSkipped) => void,
): Promise<UnlistenFn> {
  return listen<import("@oleafly/backend-port").CollabChangeSkipped>(COLLAB_CHANGE_SKIPPED_EVENT, ({ payload }) =>
    handler(payload),
  );
}

export const COLLAB_LIVE_SETTINGS_EVENT = "collab-live-settings";

export function onCollabLiveSettings(
  handler: (payload: import("@oleafly/backend-port").CollabLiveSettings) => void,
): Promise<UnlistenFn> {
  return listen<import("@oleafly/backend-port").CollabLiveSettings>(COLLAB_LIVE_SETTINGS_EVENT, ({ payload }) =>
    handler(payload),
  );
}

export const COLLAB_LIVE_REMOVED_EVENT = "collab-live-removed";

export const collabLiveRemovedList = (projectId: string) =>
  invoke<import("@oleafly/backend-port").CollabLiveRemovedFile[]>("collab_live_removed_list", { projectId });
export const collabLiveRemovedDismiss = (projectId: string, id: string) =>
  invoke<void>("collab_live_removed_dismiss", { projectId, id });

export function onCollabLiveRemoved(
  handler: (payload: import("@oleafly/backend-port").CollabLiveRemoved) => void,
): Promise<UnlistenFn> {
  return listen<import("@oleafly/backend-port").CollabLiveRemoved>(COLLAB_LIVE_REMOVED_EVENT, ({ payload }) =>
    handler(payload),
  );
}

export const COLLAB_LIVE_UPLOADS_EVENT = "collab-live-uploads";
export const COLLAB_LIVE_KEPT_EVENT = "collab-live-kept";

export const collabUploadList = (projectId: string) =>
  invoke<import("@oleafly/backend-port").CollabUploadFile[]>("collab_upload_list", { projectId });
export const collabUploadRetry = (projectId: string) => invoke<void>("collab_upload_retry", { projectId });
export const collabUploadDismiss = (projectId: string, path: string) =>
  invoke<void>("collab_upload_dismiss", { projectId, path });

export function onCollabLiveUploads(
  handler: (payload: import("@oleafly/backend-port").CollabLiveUploads) => void,
): Promise<UnlistenFn> {
  return listen<import("@oleafly/backend-port").CollabLiveUploads>(COLLAB_LIVE_UPLOADS_EVENT, ({ payload }) =>
    handler(payload),
  );
}

export function onCollabLiveKept(
  handler: (payload: import("@oleafly/backend-port").CollabLiveKept) => void,
): Promise<UnlistenFn> {
  return listen<import("@oleafly/backend-port").CollabLiveKept>(COLLAB_LIVE_KEPT_EVENT, ({ payload }) =>
    handler(payload),
  );
}

export const collabLocalCopyOffer = (projectId: string) =>
  invoke<import("@oleafly/backend-port").CollabLocalCopyOffer | null>("collab_local_copy_offer", { projectId });
export const collabLocalCopyBringIn = (projectId: string, copyId: string) =>
  invoke<void>("collab_local_copy_bring_in", { projectId, copyId });
export const collabLocalCopyDecline = (projectId: string, copyId: string) =>
  invoke<void>("collab_local_copy_decline", { projectId, copyId });

export const collabAdminOverview = (serverId: string) =>
  invoke<CollabAdminOverview>("collab_admin_overview", { serverId });
export const collabAdminProjects = (serverId: string, query: CollabAdminProjectsQuery) =>
  invoke<CollabAdminProjectsPage>("collab_admin_projects", { serverId, query });
export const collabAdminArchiveProject = (serverId: string, projectId: string) =>
  invoke<CollabAdminProject>("collab_admin_archive_project", { serverId, projectId });
export const collabAdminUnarchiveProject = (serverId: string, projectId: string) =>
  invoke<CollabAdminProject>("collab_admin_unarchive_project", { serverId, projectId });

export const collabAdminEmailStatus = (serverId: string) =>
  invoke<CollabEmailStatus>("collab_admin_email_status", { serverId });
export const collabAdminEmailTest = (serverId: string) =>
  invoke<CollabEmailTestResult>("collab_admin_email_test", { serverId });
export const collabEmailPreferences = (serverId: string) =>
  invoke<CollabEmailPreferences>("collab_email_preferences", { serverId });
export const collabSetEmailPreferences = (serverId: string, patch: CollabEmailPreferencesPatch) =>
  invoke<CollabEmailPreferences>("collab_set_email_preferences", { serverId, patch });
export const COLLAB_SYNC_PAUSED_EVENT = "collab-sync-paused";
export const COLLAB_SYNC_RESUMED_EVENT = "collab-sync-resumed";
export const collabSyncDecide = (projectId: string, decision: CollabSyncDecision) =>
  invoke<void>("collab_sync_resume", { projectId, decision });
export function onCollabSyncPaused(handler: (payload: CollabSyncPaused) => void): Promise<UnlistenFn> {
  return listen<CollabSyncPaused>(COLLAB_SYNC_PAUSED_EVENT, ({ payload }) => handler(payload));
}
export function onCollabSyncResumed(handler: (payload: CollabSyncResumed) => void): Promise<UnlistenFn> {
  return listen<CollabSyncResumed>(COLLAB_SYNC_RESUMED_EVENT, ({ payload }) => handler(payload));
}

export const COLLAB_COMMENTS_CHANGED_EVENT = "collab-comments-changed";
export const COLLAB_COMMENTS_STATUS_EVENT = "collab-comments-status";
export const COLLAB_COMMENTS_NOT_SENT_EVENT = "collab-comments-not-sent";

export const collabCommentsStatus = (projectId: string) =>
  invoke<CollabCommentsStatus>("collab_comments_status", { projectId });
export const collabCommentsSetEnabled = (projectId: string, enabled: boolean) =>
  invoke<CollabProjectSummary>("collab_comments_set_enabled", { projectId, enabled });
export const collabCommentReply = (
  projectId: string,
  fileId: string,
  threadId: string,
  body: string,
  members: CollabCommentMember[],
) => invoke<CollabCommentMessage>("collab_comment_reply", { projectId, fileId, threadId, body, members });
export const collabCommentEdit = (
  projectId: string,
  fileId: string,
  threadId: string,
  messageId: string,
  body: string,
  members: CollabCommentMember[],
) =>
  invoke<CollabCommentMessage>("collab_comment_edit", { projectId, fileId, threadId, messageId, body, members });
export const collabCommentDelete = (projectId: string, fileId: string, threadId: string, messageId: string) =>
  invoke<void>("collab_comment_delete", { projectId, fileId, threadId, messageId });
export const collabCommentResolve = (projectId: string, fileId: string, threadId: string) =>
  invoke<CollabCommentThread>("collab_comment_resolve", { projectId, fileId, threadId });
export const collabCommentReopen = (projectId: string, fileId: string, threadId: string) =>
  invoke<CollabCommentThread>("collab_comment_reopen", { projectId, fileId, threadId });
export const collabCommentThreadDelete = (projectId: string, fileId: string, threadId: string) =>
  invoke<void>("collab_comment_thread_delete", { projectId, fileId, threadId });

export function onCollabCommentsChanged(handler: (payload: CollabCommentsChanged) => void): Promise<UnlistenFn> {
  return listen<CollabCommentsChanged>(COLLAB_COMMENTS_CHANGED_EVENT, ({ payload }) => handler(payload));
}

export function onCollabCommentsStatus(
  handler: (payload: CollabCommentsStatusChanged) => void,
): Promise<UnlistenFn> {
  return listen<CollabCommentsStatusChanged>(COLLAB_COMMENTS_STATUS_EVENT, ({ payload }) => handler(payload));
}

export function onCollabCommentsNotSent(handler: (payload: CollabCommentsNotSent) => void): Promise<UnlistenFn> {
  return listen<CollabCommentsNotSent>(COLLAB_COMMENTS_NOT_SENT_EVENT, ({ payload }) => handler(payload));
}

export const collabAccessLogStatus = (projectId: string) =>
  invoke<CollabAccessLogStatus>("collab_access_log_status", { projectId });
export const collabAccessLogSetEnabled = (projectId: string, enabled: boolean) =>
  invoke<CollabProjectSummary>("collab_access_log_set_enabled", { projectId, enabled });
export const collabAccessLogPage = (projectId: string, cursor: string | null) =>
  invoke<CollabAccessLogPage>("collab_access_log_page", { projectId, cursor });

export const collabGuestInvitations = (projectId: string) =>
  invoke<CollabProjectGuestInvitations>("collab_guest_invitations", { projectId });
export const collabGuestInvite = (projectId: string, email: string, role: CollabProjectRole) =>
  invoke<CollabGuestInviteResult>("collab_guest_invite", { projectId, email, role });
export const collabGuestInvitationRevoke = (projectId: string, invitationId: string) =>
  invoke<void>("collab_guest_invitation_revoke", { projectId, invitationId });
export const collabAdminGuestInvitations = (serverId: string) =>
  invoke<CollabGuestInvitation[]>("collab_admin_guest_invitations", { serverId });
export const collabAdminGuestApprove = (serverId: string, invitationId: string) =>
  invoke<CollabGuestInvitation>("collab_admin_guest_approve", { serverId, invitationId });
export const collabAdminGuestDecline = (serverId: string, invitationId: string) =>
  invoke<CollabGuestInvitation>("collab_admin_guest_decline", { serverId, invitationId });
export const collabAdminGuestRevoke = (serverId: string, invitationId: string) =>
  invoke<void>("collab_admin_guest_revoke", { serverId, invitationId });

export async function collabServerCodeSignIn(
  url: string,
  setupCode: string | undefined,
  onCode: (code: CollabSignInCode) => void,
): Promise<CollabServer> {
  const channel = new Channel<CollabSignInCode>();
  channel.onmessage = onCode;
  return await invoke<CollabServer>("collab_server_code_sign_in", { url, setupCode: setupCode ?? null, onCode: channel });
}

export const collabCommentThreadList = (projectId: string, path: string) =>
  invoke<CollabCommentThreadList>("collab_comment_thread_list", { projectId, path });
export const collabCommentCounts = (projectId: string) =>
  invoke<CollabCommentCount[]>("collab_comment_counts", { projectId });
export const collabCommentFilePath = (projectId: string, fileId: string) =>
  invoke<string | null>("collab_comment_file_path", { projectId, fileId });
export const collabCommentCreate = (
  projectId: string,
  path: string,
  from: number,
  to: number,
  rev: number | null,
  body: string,
  members: CollabCommentMember[],
) => invoke<CollabCommentThread>("collab_comment_create", { projectId, path, from, to, rev, body, members });

const COLLAB_COMMENT_ERROR_CODES = new Set<string>([
  "comment_not_live",
  "comment_not_yours",
  "comment_off_server",
  "comment_off_project",
  "comment_viewer",
  "comment_someone_replied",
  "comment_message_deleted",
  "comment_selection_changed",
  "comment_too_long",
  "comment_empty",
] satisfies CollabCommentErrorCode[]);

export function isCollabCommentError(value: unknown): value is CollabCommentError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { code?: unknown; message?: unknown };
  return (
    typeof candidate.code === "string" &&
    COLLAB_COMMENT_ERROR_CODES.has(candidate.code) &&
    typeof candidate.message === "string"
  );
}

export const collabLinkPreview = (serverId: string, sharedProjectId: string) =>
  invoke<CollabProjectSummary>("collab_link_preview", { serverId, sharedProjectId });

export const COLLAB_LIVE_MEMBERS_EVENT = "collab-live-members";

export function onCollabLiveMembers(
  handler: (payload: import("@oleafly/backend-port").CollabLiveMembers) => void,
): Promise<UnlistenFn> {
  return listen<import("@oleafly/backend-port").CollabLiveMembers>(COLLAB_LIVE_MEMBERS_EVENT, ({ payload }) =>
    handler(payload),
  );
}

