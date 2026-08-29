import type { AppConfig } from "@oleafly/backend-port";
import { appQueryClient } from "@/lib/query";
import { projectsKey } from "@/lib/queries/projects";
import { logError } from "@/lib/log";
import { initialState } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";

let snapshotConfig: AppConfig | null = null;

/** The config the backend handed over at boot; null before hydration or when
 * the snapshot failed. Consumers needing freshness still call getConfig(). */
export function getSnapshotConfig(): AppConfig | null {
  return snapshotConfig;
}

// Runs before React renders: one IPC round-trip seeds what the stores used to
// fetch with separate async invokes after mount. Failure is non-fatal; the
// stores then hydrate themselves exactly as before.
export async function hydrateFromSnapshot(): Promise<void> {
  try {
    const snapshot = await initialState();
    snapshotConfig = snapshot.config;
    appQueryClient().setQueryData(projectsKey, snapshot.projects);
    const projects = [...snapshot.projects];
    projects.sort((a, b) => b.updated_at - a.updated_at);
    useFilesStore.setState({ projects, projectsLoaded: true });
  } catch (error) {
    logError("initial-state hydration", error);
  }
}
