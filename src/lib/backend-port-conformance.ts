import type { BackendPort } from "@oleafly/backend-port";
import * as tauri from "@/lib/tauri";
import * as tauriCollab from "@/lib/tauri-collab";

type StartupCollabKey = "collabPendingLinks" | "onCollabOpenLink";
type CollabKey = Exclude<Extract<keyof BackendPort, `collab${string}` | `onCollab${string}`>, StartupCollabKey>;

export const desktopBackendPort: Omit<BackendPort, CollabKey> = tauri;
export const desktopCollabPort: Pick<BackendPort, CollabKey> = tauriCollab;
