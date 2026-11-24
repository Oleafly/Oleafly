import { Channel, invoke } from "@tauri-apps/api/core";
import type { CollabUnsentProject } from "@oleafly/backend-port";

export const DEFAULT_OVERLEAF_SERVER = "https://www.overleaf.com";

export interface OverleafAccount {
  userId: string;
  email: string | null;
}

export interface OverleafStatus {
  server: string;
  signedIn: boolean;
  email: string | null;
  userId?: string | null;
  accounts?: OverleafAccount[];
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

export interface OverleafInvite {
  id: string;
  projectId: string;
  projectName: string;
  inviter: string | null;
  expires: string | null;
}

export interface OverleafProjects {
  status: OverleafStatus;
  projects: OverleafProject[];
  invites?: OverleafInvite[];
}

export interface OverleafOpenedLive {
  projectId: string;
  reused: boolean;
}

export interface OverleafCreated {
  server: string;
  remoteId: string;
  name: string;
}

export type OverleafLinkGrants = "edit" | "view" | "already" | "invite";

export interface OverleafLinkPreview {
  server: string;
  projectName: string | null;
  grants: OverleafLinkGrants;
  projectId: string | null;
}

export interface OverleafLinkJoined {
  server: string;
  projectId: string;
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
const accountArg = (account: string | null | undefined) => account || null;

export function overleafStatus(server?: string | null): Promise<OverleafStatus> {
  return invoke<OverleafStatus>("overleaf_status", { server: serverArg(server) });
}

export function overleafSignIn(server: string | null | undefined, title: string): Promise<OverleafStatus> {
  return invoke<OverleafStatus>("overleaf_sign_in", { server: serverArg(server), title });
}

export function overleafSignInWithAppCookies(server: string | null | undefined): Promise<OverleafStatus> {
  return invoke<OverleafStatus>("overleaf_sign_in_with_app_cookies", { server: serverArg(server) });
}

export interface OverleafSignInBrowser {
  key: string;
  name: string;
}

export function overleafUseAccount(server: string | null | undefined, account: string): Promise<OverleafStatus> {
  return invoke<OverleafStatus>("overleaf_use_account", { server: serverArg(server), account });
}

export function overleafSignInBrowsers(): Promise<OverleafSignInBrowser[]> {
  return invoke<OverleafSignInBrowser[]>("overleaf_sign_in_browsers");
}

export function overleafSignInWithBrowser(server: string | null | undefined, browser: string): Promise<OverleafStatus> {
  return invoke<OverleafStatus>("overleaf_sign_in_with_browser", { server: serverArg(server), browser });
}

interface OverleafSignOut extends OverleafStatus {
  unsent?: CollabUnsentProject[];
}

export function overleafSignOut(
  server?: string | null,
  keepLocalCopy = false,
  account?: string | null,
): Promise<OverleafSignOut> {
  return invoke<OverleafSignOut>("overleaf_sign_out", {
    server: serverArg(server),
    account: accountArg(account),
    keepLocalCopy,
  });
}

export function overleafListProjects(server?: string | null, account?: string | null): Promise<OverleafProjects> {
  return invoke<OverleafProjects>("overleaf_list_projects", { server: serverArg(server), account: accountArg(account) });
}

export async function overleafImportProjects(
  server: string | null | undefined,
  ids: readonly string[],
  onEvent: (event: OverleafImportEvent) => void,
  account?: string | null,
): Promise<OverleafImportOutcome[]> {
  const channel = new Channel<OverleafImportEvent>();
  channel.onmessage = onEvent;
  try {
    return await invoke<OverleafImportOutcome[]>("overleaf_import_projects", {
      server: serverArg(server),
      account: accountArg(account),
      ids: [...ids],
      onEvent: channel,
    });
  } finally {
    channel.onmessage = () => {};
  }
}

export function overleafOpenLive(
  server: string | null | undefined,
  remoteId: string,
  account?: string | null,
): Promise<OverleafOpenedLive> {
  return invoke<OverleafOpenedLive>("overleaf_open_live", {
    server: serverArg(server),
    account: accountArg(account),
    remoteId,
  });
}

export function overleafCreateFromLocal(
  projectId: string,
  server: string | null | undefined,
  account?: string | null,
  name?: string | null,
): Promise<OverleafCreated> {
  return invoke<OverleafCreated>("overleaf_create_from_local", {
    projectId,
    server: serverArg(server),
    account: accountArg(account),
    name: name?.trim() || null,
  });
}

export function overleafLinkPreview(
  server: string | null | undefined,
  link: string,
  account?: string | null,
): Promise<OverleafLinkPreview> {
  return invoke<OverleafLinkPreview>("overleaf_link_preview", {
    server: serverArg(server),
    account: accountArg(account),
    link,
  });
}

export function overleafLinkJoin(
  server: string | null | undefined,
  link: string,
  account?: string | null,
): Promise<OverleafLinkJoined> {
  return invoke<OverleafLinkJoined>("overleaf_link_join", {
    server: serverArg(server),
    account: accountArg(account),
    link,
  });
}

export function overleafInviteAccept(
  server: string | null | undefined,
  invite: string,
  account?: string | null,
): Promise<OverleafLinkJoined> {
  return invoke<OverleafLinkJoined>("overleaf_invite_accept", {
    server: serverArg(server),
    account: accountArg(account),
    invite,
  });
}

const LINK_PATH = /\/(?:read\/[a-z]{12}|\d+[a-z]{6,12}|project\/[0-9a-f]{24})(?:[/?#]|$)/;

export function looksLikeOverleafLink(text: string): boolean {
  const trimmed = text.trim();
  return !/\s/.test(trimmed) && LINK_PATH.test(trimmed);
}

export function isOverleafError(error: unknown, code: string): boolean {
  let text = "";
  if (typeof error === "string") text = error;
  else if (error instanceof Error) text = error.message;
  return text.includes(`"overleaf.${code}"`);
}

export interface OverleafTemplateDetails {
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

export function overleafTemplatePdf(
  server: string | null | undefined,
  link: string,
): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("overleaf_template_pdf", { server: serverArg(server), link });
}

export function overleafImportTemplate(
  server: string | null | undefined,
  link: string,
  name: string,
  previewPngBase64: string | null,
  account?: string | null,
): Promise<string> {
  return invoke<string>("overleaf_import_template", {
    server: serverArg(server),
    account: accountArg(account),
    link,
    name,
    previewPngBase64,
  });
}

export function overleafSaveProjectAsTemplate(
  server: string | null | undefined,
  projectId: string,
  name: string,
  account?: string | null,
): Promise<string> {
  return invoke<string>("overleaf_save_project_as_template", {
    server: serverArg(server),
    account: accountArg(account),
    projectId,
    name,
  });
}
