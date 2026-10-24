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

/** Signs in with the sign-in cookies a browser copy put in Oleafly, without a window. */
export function overleafSignInWithAppCookies(server: string | null | undefined): Promise<OverleafStatus> {
  return invoke<OverleafStatus>("overleaf_sign_in_with_app_cookies", { server: serverArg(server) });
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
  let text = "";
  if (typeof error === "string") text = error;
  else if (error instanceof Error) text = error.message;
  return text.includes(`"overleaf.${code}"`);
}

/** What a gallery template page shows, read before anything is imported. */
export interface OverleafTemplateDetails {
  /** The server whose sign-in the import needs. */
  server: string;
  link: string;
  title: string;
  author: string | null;
  license: string | null;
  description: string | null;
  compiler: string | null;
  mainFile: string | null;
  hasPdf: boolean;
}

export function overleafTemplateDetails(
  server: string | null | undefined,
  link: string,
): Promise<OverleafTemplateDetails> {
  return invoke<OverleafTemplateDetails>("overleaf_template_details", {
    server: serverArg(server),
    link,
  });
}

/** The PDF the gallery shows for a template. */
export function overleafTemplatePdf(
  server: string | null | undefined,
  link: string,
): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("overleaf_template_pdf", { server: serverArg(server), link });
}

/**
 * Copy a gallery template into the signed-in account, as Open as Template
 * does there, and save the copy as a custom template. Resolves to its id.
 */
export function overleafImportTemplate(
  server: string | null | undefined,
  link: string,
  name: string,
  previewPngBase64: string | null,
): Promise<string> {
  return invoke<string>("overleaf_import_template", {
    server: serverArg(server),
    link,
    name,
    previewPngBase64,
  });
}

/** Save one of the account's projects as a custom template. Resolves to its id. */
export function overleafSaveProjectAsTemplate(
  server: string | null | undefined,
  projectId: string,
  name: string,
): Promise<string> {
  return invoke<string>("overleaf_save_project_as_template", {
    server: serverArg(server),
    projectId,
    name,
  });
}
