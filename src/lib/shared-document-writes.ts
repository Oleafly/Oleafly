import { i18n } from "@/i18n";
import { useCollabEditorGate } from "@/lib/collab-live-bridge";

export function sharedDocumentLive(projectId: string | null): boolean {
  const gate = useCollabEditorGate.getState();
  return projectId !== null && gate.projectId === projectId && !gate.connecting;
}

function lf(text: string): string {
  return text.replace(/\r\n?/gu, "\n");
}

export class SharedReadOnlyError extends Error {
  constructor() {
    super(i18n.t(($) => $.collab.access.viewOnly));
    this.name = "SharedReadOnlyError";
  }
}

export function sharedViewOnly(projectId: string | null): boolean {
  const gate = useCollabEditorGate.getState();
  return projectId !== null && gate.projectId === projectId && gate.viewer;
}

export class SharedConnectingError extends Error {
  constructor() {
    super(i18n.t(($) => $.collab.access.connecting));
    this.name = "SharedConnectingError";
  }
}

export function sharedConnecting(projectId: string | null): boolean {
  const gate = useCollabEditorGate.getState();
  return projectId !== null && gate.projectId === projectId && gate.connecting;
}

export function sharedWriteRefusal(projectId: string | null): SharedReadOnlyError | SharedConnectingError | null {
  if (sharedViewOnly(projectId)) return new SharedReadOnlyError();
  if (sharedConnecting(projectId)) return new SharedConnectingError();
  return null;
}

export async function writeSharedText(
  projectId: string,
  path: string,
  text: string,
  base?: string | null,
): Promise<boolean> {
  if (!sharedDocumentLive(projectId)) return false;
  if (useCollabEditorGate.getState().viewer) throw new SharedReadOnlyError();
  let handled: boolean;
  try {
    const { collabWriteText } = await import("@/lib/tauri-collab");
    const outcome = await collabWriteText(projectId, path, base == null ? null : lf(base), lf(text));
    if (!outcome.handled && outcome.reason === "read_only") throw new SharedReadOnlyError();
    handled = outcome.handled;
  } catch (error) {
    throw sharedWriteError(error);
  }
  return handled;
}

function errorText(message: unknown, code: unknown): string {
  if (typeof message === "string" && message) return message;
  return typeof code === "string" ? code : "";
}

function sharedWriteError(error: unknown): unknown {
  if (error instanceof Error || typeof error !== "object" || error === null) return error;
  const { message, code } = error as { message?: unknown; code?: unknown };
  const text = errorText(message, code);
  return text ? new Error(text) : error;
}

export function sharedBaseOption(
  projectId: string | null,
  base: string | undefined,
): [] | [{ base: string }] {
  return base !== undefined && sharedDocumentLive(projectId) ? [{ base }] : [];
}
