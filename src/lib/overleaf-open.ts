import type { OverleafImportOutcome } from "@/lib/overleaf";
import { useFilesStore } from "@/store/files";
import { useOverleafImportStore } from "@/store/overleaf-import";

export async function importAndRefresh(ids?: readonly string[]): Promise<OverleafImportOutcome[]> {
  const outcomes = await useOverleafImportStore.getState().importSelected(ids);
  if (outcomes.some((outcome) => outcome.projectId)) {
    await useFilesStore.getState().refreshProjects();
  }
  return outcomes;
}

export async function openLiveAndRefresh(
  remoteId: string,
  onOpened?: (projectId: string) => void,
): Promise<string | null> {
  const projectId = await useOverleafImportStore.getState().openLive(remoteId);
  if (!projectId) return null;
  await useFilesStore.getState().refreshProjects();
  onOpened?.(projectId);
  return projectId;
}
