import type { AppConfig } from "@oleafly/backend-port";
import { appQueryClient } from "@/lib/query";
import { projectsKey } from "@/lib/queries/projects";
import { logError } from "@/lib/log";
import { initialState, seedStarterPersonas } from "@/lib/tauri";
import { starterPersonasForInstall } from "@/lib/starter-personas";
import { useFilesStore } from "@/store/files";

let snapshotConfig: AppConfig | null = null;

/** The config the backend handed over at boot; null before hydration or when
 * the snapshot failed. Consumers needing freshness still call getConfig(). */
export function getSnapshotConfig(): AppConfig | null {
  return snapshotConfig;
}

export async function hydrateFromSnapshot(): Promise<void> {
  try {
    const snapshot = await initialState();
    snapshotConfig = snapshot.config;
    appQueryClient().setQueryData(projectsKey, snapshot.projects);
    const projects = [...snapshot.projects];
    projects.sort((a, b) => b.updated_at - a.updated_at);
    useFilesStore.setState({ projects, projectsLoaded: true });
    if (!snapshot.config?.ai_starter_personas_seeded) {
      try {
        snapshotConfig = await seedStarterPersonas(starterPersonasForInstall());
      } catch (error) {
        logError("starter persona seed", error);
      }
    }
  } catch (error) {
    logError("initial-state hydration", error);
  }
}
