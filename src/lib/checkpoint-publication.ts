import type {
  CheckpointPublicationOutcome,
  CheckpointSkipReason,
} from "@oleafly/backend-port";
import { i18n } from "@/i18n";
import { logError } from "@/lib/log";
import { getConfig } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

export const CHECKPOINT_PUBLICATION_EVENT = "checkpoint:publication";

export const INCOMPLETE_CAPTURE_NOTICE_AFTER = 3;

export function checkpointSkippedToastKey(projectId: string): string {
  return `checkpoint-publication-skipped:${projectId}`;
}

interface SkipNotices {
  notified: Set<CheckpointSkipReason>;
  pending: Set<CheckpointSkipReason>;
  incompleteStreak: number;
  toastId: number | null;
  published: number;
}

const skipNotices = new Map<string, SkipNotices>();

export type CheckpointPublicationEvent =
  | { project_id: string; main_document: string; phase: "started" }
  | {
      project_id: string;
      main_document: string;
      phase: "finished";
      outcome: CheckpointPublicationOutcome;
    };

type CheckpointPublicationSkipped = Extract<CheckpointPublicationOutcome, { status: "skipped" }>;

function noticesFor(projectId: string): SkipNotices {
  let notices = skipNotices.get(projectId);
  if (!notices) {
    notices = {
      notified: new Set(),
      pending: new Set(),
      incompleteStreak: 0,
      toastId: null,
      published: 0,
    };
    skipNotices.set(projectId, notices);
  }
  return notices;
}

function settleSkipNotices(projectId: string): void {
  const notices = skipNotices.get(projectId);
  if (!notices) return;
  notices.published += 1;
  notices.incompleteStreak = 0;
  if (notices.toastId !== null) toast.dismiss(notices.toastId);
  notices.toastId = null;
}

function skippedMessage(reason: CheckpointSkipReason): string {
  return reason === "storage_unavailable"
    ? i18n.t(($) => $.core.checkpoint.storageUnavailable)
    : i18n.t(($) => $.core.checkpoint.incompleteCapture);
}

function wantsNotice(notices: SkipNotices, reason: CheckpointSkipReason): boolean {
  if (reason === "incomplete_capture") notices.incompleteStreak += 1;
  if (notices.notified.has(reason) || notices.pending.has(reason)) return false;
  return reason !== "incomplete_capture" ||
    notices.incompleteStreak >= INCOMPLETE_CAPTURE_NOTICE_AFTER;
}

async function notificationsEnabled(): Promise<boolean> {
  try {
    const config = await getConfig();
    return config.checkpoint_notifications !== false;
  } catch {
    return false;
  }
}

async function notifySkipped(
  projectId: string,
  outcome: CheckpointPublicationSkipped,
): Promise<void> {
  void logError("checkpoint publication skipped", `${outcome.message} ${outcome.suggestion}`);
  const notices = noticesFor(projectId);
  if (!wantsNotice(notices, outcome.reason)) return;
  notices.pending.add(outcome.reason);
  const published = notices.published;
  const enabled = await notificationsEnabled();
  notices.pending.delete(outcome.reason);
  if (!enabled || notices.published !== published) return;
  notices.notified.add(outcome.reason);
  notices.toastId = toast.errorUnique(
    checkpointSkippedToastKey(projectId),
    skippedMessage(outcome.reason),
    undefined,
    true,
  );
}

function isPublicationEvent(payload: unknown): payload is CheckpointPublicationEvent {
  if (typeof payload !== "object" || payload === null) return false;
  const event = payload as Record<string, unknown>;
  if (typeof event.project_id !== "string") return false;
  if (event.phase === "started") return true;
  return event.phase === "finished" && typeof event.outcome === "object" && event.outcome !== null;
}

export function applyCheckpointPublicationEvent(payload: unknown): void {
  if (!isPublicationEvent(payload)) return;
  const settings = useSettingsStore.getState();
  const isActiveProject = useFilesStore.getState().projectId === payload.project_id;
  if (payload.phase === "started") {
    if (isActiveProject) settings.setCheckpointPublishingProjectId(payload.project_id);
    return;
  }
  if (settings.checkpointPublishingProjectId === payload.project_id) {
    settings.setCheckpointPublishingProjectId(null);
  }
  const { status } = payload.outcome;
  if (status === "published" || status === "published_durability_uncertain") {
    settleSkipNotices(payload.project_id);
    if (isActiveProject) settings.bumpCheckpointsRevision();
    return;
  }
  if (payload.outcome.status !== "skipped" || !isActiveProject) return;
  void notifySkipped(payload.project_id, payload.outcome);
}
