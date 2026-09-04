import type { CheckpointPublicationOutcome } from "@oleafly/backend-port";
import { getConfig } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

export const CHECKPOINT_PUBLICATION_EVENT = "checkpoint:publication";

const SKIPPED_TOAST_KEY = "checkpoint-publication-skipped";

const notifiedSkipReasons = new Map<string, string>();

export type CheckpointPublicationEvent =
  | { project_id: string; main_document: string; phase: "started" }
  | {
      project_id: string;
      main_document: string;
      phase: "finished";
      outcome: CheckpointPublicationOutcome;
    };

type CheckpointPublicationSkipped = Extract<CheckpointPublicationOutcome, { status: "skipped" }>;

async function notifySkipped(
  projectId: string,
  outcome: CheckpointPublicationSkipped,
): Promise<void> {
  if (notifiedSkipReasons.get(projectId) === outcome.reason) return;
  try {
    const config = await getConfig();
    if (config.checkpoint_notifications === false) return;
  } catch {
    return;
  }
  notifiedSkipReasons.set(projectId, outcome.reason);
  toast.errorUnique(SKIPPED_TOAST_KEY, `${outcome.message} ${outcome.suggestion}`, undefined, true);
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
  if (payload.outcome.status !== "skipped") {
    notifiedSkipReasons.delete(payload.project_id);
    if (
      isActiveProject &&
      (payload.outcome.status === "published" ||
        payload.outcome.status === "published_durability_uncertain")
    ) {
      settings.bumpCheckpointsRevision();
    }
    return;
  }
  if (!isActiveProject) return;
  void notifySkipped(payload.project_id, payload.outcome);
}
