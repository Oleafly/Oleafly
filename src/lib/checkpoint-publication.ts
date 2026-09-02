import type { CheckpointPublicationOutcome } from "@oleafly/backend-port";
import { getConfig } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

export const CHECKPOINT_PUBLICATION_EVENT = "checkpoint:publication";

export type CheckpointPublicationEvent =
  | { project_id: string; main_document: string; phase: "started" }
  | {
      project_id: string;
      main_document: string;
      phase: "finished";
      outcome: CheckpointPublicationOutcome;
    };

export async function notifyCheckpointPublicationSkipped(
  outcome: CheckpointPublicationOutcome | undefined,
): Promise<void> {
  if (outcome?.status !== "skipped") return;
  try {
    const config = await getConfig();
    if (config.checkpoint_notifications === false) return;
  } catch {
    return;
  }
  toast.infoUnique(
    `checkpoint-publication-${outcome.reason}`,
    `${outcome.message} ${outcome.suggestion}`,
    {
      label: "View Checkpoints",
      onClick: () => useSettingsStore.getState().openVersioning("checkpoints"),
    },
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
  if (!isActiveProject) return;
  const status = payload.outcome.status;
  if (status === "unchanged") return;
  if (status === "published" || status === "published_durability_uncertain") {
    settings.bumpCheckpointsRevision();
    return;
  }
  void notifyCheckpointPublicationSkipped(payload.outcome);
}
