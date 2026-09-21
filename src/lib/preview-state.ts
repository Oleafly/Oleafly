import type { CompileState } from "@/store/compile";
import type { CompileSuccessCheckpoint } from "@/lib/compile-checkpoint";
import type { PreviewWindowStateInput } from "@/lib/preview-window";

export function previewWindowState(
  status: CompileState["status"],
  identity: CompileState["lastAttemptIdentity"],
  checkpoint: CompileSuccessCheckpoint | null,
  message: string | null,
): PreviewWindowStateInput | undefined {
  const resolvedIdentity =
    identity ??
    (checkpoint
      ? {
          projectId: checkpoint.projectId,
          mainDocument: checkpoint.mainDocument,
          projectRevision: checkpoint.projectRevision,
          requestGeneration: checkpoint.requestGeneration,
        }
      : null);
  if (!resolvedIdentity) return undefined;
  const statusValue =
    status === "idle"
      ? "not_run"
      : status;
  const exactCheckpoint =
    checkpoint?.projectId === resolvedIdentity.projectId &&
    checkpoint.mainDocument === resolvedIdentity.mainDocument &&
    checkpoint.projectRevision ===
      resolvedIdentity.projectRevision &&
    checkpoint.requestGeneration ===
      resolvedIdentity.requestGeneration
      ? checkpoint
      : null;
  return {
    identity: resolvedIdentity,
    status: statusValue,
    checkpoint:
      statusValue === "success" ? exactCheckpoint : null,
    ...(message ? { message } : {}),
  };
}
