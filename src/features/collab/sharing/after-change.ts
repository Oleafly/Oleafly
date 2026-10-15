import { logError } from "@/lib/log";
import { useFilesStore } from "@/store/files";
import { useCollabLiveStore } from "../live/live-store";

export async function syncShareChange(projectId: string): Promise<void> {
  await useFilesStore
    .getState()
    .refreshProjects()
    .catch((error: unknown) => logError("refresh projects after a sharing change", error));
  const live = useCollabLiveStore.getState();
  if (live.projectId === projectId) await live.refreshShare();
}

export function syncMembersChange(projectId: string): void {
  const live = useCollabLiveStore.getState();
  if (live.projectId === projectId) void live.refreshMembers();
}
