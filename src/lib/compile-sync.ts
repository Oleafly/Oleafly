import { readCompiledPdf } from "@/lib/tauri";
import {
  fingerprintCompileOutput,
  isCompileSucceededEvent,
  isNewerCompileCheckpoint,
  nextSuccessfulCompileTimestamp,
} from "@/lib/compile-checkpoint";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useProjectAnalysisStore } from "@/store/project-analysis";
import { currentProjectStateRevision } from "@/lib/project-state-revision";

/**
 * Apply a successful compile produced by another window only when the event
 * still names the current project/main document and the PDF on disk has the
 * exact identity allocated under the backend compile lock.
 */
export async function applyRemoteCompileSuccess(
  payload: unknown,
  selfProducerId: string,
): Promise<boolean> {
  if (!isCompileSucceededEvent(payload)) return false;
  if (
    payload.projectStateRevision !== currentProjectStateRevision() ||
    payload.checkpoint.producerId === selfProducerId
  ) {
    return false;
  }
  const checkpoint = payload.checkpoint;

  const files = useFilesStore.getState();
  if (
    files.projectId !== checkpoint.projectId ||
    files.mainDoc !== checkpoint.mainDocument ||
    useProjectAnalysisStore.getState().snapshot.identity.projectId !==
      checkpoint.projectId ||
    useProjectAnalysisStore.getState().snapshot.identity.projectRevision !==
      checkpoint.projectRevision
  ) {
    return false;
  }
  if (
    !isNewerCompileCheckpoint(
      checkpoint,
      useCompileStore.getState().lastCompileCheckpoint,
    )
  ) {
    return false;
  }

  try {
    const bytes = new Uint8Array(await readCompiledPdf(checkpoint.projectId));
    const currentFiles = useFilesStore.getState();
    if (
      payload.projectStateRevision !== currentProjectStateRevision() ||
      currentFiles.projectId !== checkpoint.projectId ||
      currentFiles.mainDoc !== checkpoint.mainDocument ||
      useProjectAnalysisStore.getState().snapshot.identity.projectId !==
        checkpoint.projectId ||
      useProjectAnalysisStore.getState().snapshot.identity.projectRevision !==
        checkpoint.projectRevision ||
      fingerprintCompileOutput(bytes) !== checkpoint.outputId
    ) {
      return false;
    }

    const compile = useCompileStore.getState();
    if (!isNewerCompileCheckpoint(checkpoint, compile.lastCompileCheckpoint)) {
      return false;
    }
    useCompileStore.setState({
      status: "success",
      phase: "idle",
      pdfBytes: bytes,
      lastAttemptIdentity: {
        projectId: checkpoint.projectId,
        mainDocument: checkpoint.mainDocument,
        projectRevision: checkpoint.projectRevision,
        requestGeneration: checkpoint.requestGeneration,
      },
      failureReason: null,
      errors: [],
      log:
        checkpoint.outputKind === "tagged"
          ? "Tagged PDF compiled successfully in another window."
          : "PDF compiled successfully in another window.",
      lastCompiledAt: nextSuccessfulCompileTimestamp(
        compile.lastCompiledAt,
        checkpoint.completedAt,
      ),
      lastCompileCheckpoint: checkpoint,
      // Source contents are intentionally runtime-local and are not sent over
      // the cross-window event. Keep remote output revision-gated until this
      // window performs its own compile.
      compiledSources: null,
    });
    void import("@/lib/preview-window")
      .then((module) =>
        module.refreshPreviewWindow({
          identity: {
            projectId: checkpoint.projectId,
            mainDocument: checkpoint.mainDocument,
            projectRevision: checkpoint.projectRevision,
            requestGeneration: checkpoint.requestGeneration,
          },
          status: "success",
          checkpoint,
        }),
      )
      .catch(() => {});
    return true;
  } catch {
    return false;
  }
}
