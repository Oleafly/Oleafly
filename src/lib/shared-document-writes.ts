import { i18n } from "@/i18n";
import { useCollabEditorGate } from "@/lib/collab-live-bridge";
import { collabWriteText } from "@/lib/tauri";

export function sharedDocumentLive(projectId: string | null): boolean {
  const gate = useCollabEditorGate.getState();
  return projectId !== null && gate.projectId === projectId && !gate.connecting;
}

// The live document holds LF text only; the disk writer restores each file's
// CRLF endings. A carriage return sent into it would make the shared text and
// every open editor disagree about offsets.
function lf(text: string): string {
  return text.replace(/\r\n?/gu, "\n");
}

// A viewer's write is refused, never written to disk instead: a local file
// that differs from the shared text stops taking collaborators' changes.
export class SharedReadOnlyError extends Error {
  constructor() {
    super(i18n.t(($) => $.collab.access.viewOnly));
    this.name = "SharedReadOnlyError";
  }
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
