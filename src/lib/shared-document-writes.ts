import { useCollabEditorGate } from "@/lib/collab-live-bridge";
import { collabWriteText } from "@/lib/tauri";

export function sharedDocumentLive(projectId: string | null): boolean {
  const gate = useCollabEditorGate.getState();
  return projectId !== null && gate.projectId === projectId && !gate.connecting;
}

export async function writeSharedText(
  projectId: string,
  path: string,
  text: string,
  base?: string | null,
): Promise<boolean> {
  if (!sharedDocumentLive(projectId)) return false;
  try {
    const outcome = await collabWriteText(projectId, path, base ?? null, text);
    return outcome.handled;
  } catch (error) {
    throw sharedWriteError(error);
  }
}

function sharedWriteError(error: unknown): unknown {
  if (error instanceof Error || typeof error !== "object" || error === null) return error;
  const { message, code } = error as { message?: unknown; code?: unknown };
  const text = typeof message === "string" && message ? message : typeof code === "string" ? code : "";
  return text ? new Error(text) : error;
}

export function sharedBaseOption(
  projectId: string | null,
  base: string | undefined,
): [] | [{ base: string }] {
  return base !== undefined && sharedDocumentLive(projectId) ? [{ base }] : [];
}
