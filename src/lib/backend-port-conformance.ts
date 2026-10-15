import type { BackendPort } from "@oleafly/backend-port";
import * as tauri from "@/lib/tauri";
import * as tauriCollab from "@/lib/tauri-collab";

/**
 * Compile-time proof that the desktop Tauri bridge implements the shared
 * backend-port contract. If a signature in tauri.ts drifts from
 * packages/backend-port, `tsc` (and therefore `pnpm build`) fails here.
 *
 * The web shell will provide its own `BackendPort` implementation over
 * HTTP/WS against the same contract.
 */
// The collaboration wrappers live in their own module, which loads with
// collaboration. App links are heard from the start, so their pair stays in
// tauri.ts.
type StartupCollabKey = "collabPendingLinks" | "onCollabOpenLink";
type CollabKey = Exclude<Extract<keyof BackendPort, `collab${string}` | `onCollab${string}`>, StartupCollabKey>;

export const desktopBackendPort: Omit<BackendPort, CollabKey> = tauri;
export const desktopCollabPort: Pick<BackendPort, CollabKey> = tauriCollab;
