import type { BackendPort } from "@oleafly/backend-port";
import * as tauri from "@/lib/tauri";

/**
 * Compile-time proof that the desktop Tauri bridge implements the shared
 * backend-port contract. If a signature in tauri.ts drifts from
 * packages/backend-port, `tsc` (and therefore `pnpm build`) fails here.
 *
 * The web shell will provide its own `BackendPort` implementation over
 * HTTP/WS against the same contract.
 */
export const desktopBackendPort: BackendPort = tauri;
