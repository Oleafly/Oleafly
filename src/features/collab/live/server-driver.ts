import type { CollabErrorCode, CollabLiveEndedReason } from "@/lib/tauri";
import { collabLiveStart, collabLiveStop } from "@/lib/tauri-collab";
import type { LiveBackendDriver } from "./live-store";

const RESUMABLE: ReadonlySet<CollabLiveEndedReason> = new Set(["signed_out", "server_removed", "account_suspended"]);

const REFUSALS: Readonly<Partial<Record<CollabErrorCode, CollabLiveEndedReason>>> = {
  signed_out: "signed_out",
  unauthorized: "signed_out",
  not_found: "signed_out",
  server_removed: "server_removed",
  server_unknown: "server_removed",
};

export function serverDriver(refreshShare: () => Promise<void>): LiveBackendDriver {
  return {
    kind: "server",
    wants: (state) => state.share !== null,
    start: (projectId) => collabLiveStart(projectId),
    stop: (projectId) => collabLiveStop(projectId),
    refresh: () => refreshShare(),
    resumable: (reason) => RESUMABLE.has(reason),
    refusal: (code) => REFUSALS[code] ?? null,
  };
}
