import { Channel, invoke } from "@tauri-apps/api/core";

export const DEFAULT_OVERLEAF_SERVER = "https://www.overleaf.com";

export interface OverleafStatus {
  server: string;
  signedIn: boolean;
  email: string | null;
}

export interface OverleafProject {
  id: string;
  name: string;
  ownerName: string | null;
  owned: boolean;
  access: string;
  lastUpdated: string | null;
  lastUpdatedBy: string | null;
  archived: boolean;
  importedAs: string | null;
}

export interface OverleafProjects {
  status: OverleafStatus;
  projects: OverleafProject[];
}

export type OverleafImportEvent =
  | { phase: "downloading"; remoteId: string; received: number; total: number | null }
  | { phase: "importing"; remoteId: string }
  | {
      phase: "done";
      remoteId: string;
      projectId: string;
      mainDoc: string | null;
      compiler: string | null;
    }
  | { phase: "failed"; remoteId: string; error: string };

export interface OverleafImportOutcome {
  remoteId: string;
  projectId: string | null;
  error: string | null;
}

const serverArg = (server: string | null | undefined) => server?.trim() || null;

export function overleafStatus(server?: string | null): Promise<OverleafStatus> {
  return invoke<OverleafStatus>("overleaf_status", { server: serverArg(server) });
}

export function overleafSignIn(server: string | null | undefined, title: string): Promise<OverleafStatus> {
  return invoke<OverleafStatus>("overleaf_sign_in", { server: serverArg(server), title });
}

export function overleafSignOut(server?: string | null): Promise<OverleafStatus> {
  return invoke<OverleafStatus>("overleaf_sign_out", { server: serverArg(server) });
}

export function overleafListProjects(server?: string | null): Promise<OverleafProjects> {
  return invoke<OverleafProjects>("overleaf_list_projects", { server: serverArg(server) });
}

export async function overleafImportProjects(
  server: string | null | undefined,
  ids: readonly string[],
  onEvent: (event: OverleafImportEvent) => void,
): Promise<OverleafImportOutcome[]> {
  const channel = new Channel<OverleafImportEvent>();
  channel.onmessage = onEvent;
  try {
    return await invoke<OverleafImportOutcome[]>("overleaf_import_projects", {
      server: serverArg(server),
      ids: [...ids],
      onEvent: channel,
    });
  } finally {
    channel.onmessage = () => {};
  }
}

export function isOverleafError(error: unknown, code: string): boolean {
  const text = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return text.includes(`"overleaf.${code}"`);
}
