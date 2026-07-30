import { readCompiledPdf } from "@/lib/tauri";
import {
  fingerprintCompileOutput,
  isCompileSuccessCheckpoint,
  isNewerCompileCheckpoint,
  nextSuccessfulCompileTimestamp,
} from "@/lib/compile-checkpoint";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useProjectAnalysisStore } from "@/store/project-analysis";

/**
 * Apply a successful compile produced by another window only when the event
 * still names the current project/main document and the PDF on disk has the
 * exact identity allocated under the backend compile lock.
 */
export async function applyRemoteCompileSuccess(
  payload: unknown,
  selfProducerId: string,
): Promise<boolean> {
  if (!isCompileSuccessCheckpoint(payload)) return false;
  if (payload.producerId === selfProducerId) return false;

  const files = useFilesStore.getState();
  if (
    files.projectId !== payload.projectId ||
    files.mainDoc !== payload.mainDocument ||
    useProjectAnalysisStore.getState().snapshot.identity.projectId !==
      payload.projectId ||
    useProjectAnalysisStore.getState().snapshot.identity.projectRevision !==
      payload.projectRevision
  ) {
    return false;
  }
  if (
    !isNewerCompileCheckpoint(
      payload,
      useCompileStore.getState().lastCompileCheckpoint,
    )
  ) {
    return false;
  }

  try {
    const bytes = new Uint8Array(await readCompiledPdf(payload.projectId));
    const currentFiles = useFilesStore.getState();
    if (
      currentFiles.projectId !== payload.projectId ||
      currentFiles.mainDoc !== payload.mainDocument ||
      useProjectAnalysisStore.getState().snapshot.identity.projectId !==
        payload.projectId ||
      useProjectAnalysisStore.getState().snapshot.identity.projectRevision !==
        payload.projectRevision ||
      fingerprintCompileOutput(bytes) !== payload.outputId
    ) {
      return false;
    }

    const compile = useCompileStore.getState();
    if (!isNewerCompileCheckpoint(payload, compile.lastCompileCheckpoint)) {
      return false;
    }
    useCompileStore.setState({
      status: "success",
      phase: "idle",
      pdfBytes: bytes,
      lastAttemptIdentity: {
        projectId: payload.projectId,
        mainDocument: payload.mainDocument,
        projectRevision: payload.projectRevision,
        requestGeneration: payload.requestGeneration,
      },
      failureReason: null,
      errors: [],
      log:
        payload.outputKind === "tagged"
          ? "Tagged PDF compiled successfully in another window."
          : "PDF compiled successfully in another window.",
      lastCompiledAt: nextSuccessfulCompileTimestamp(
        compile.lastCompiledAt,
        payload.completedAt,
      ),
      lastCompileCheckpoint: payload,
      // Source contents are intentionally runtime-local and are not sent over
      // the cross-window event. Keep remote output revision-gated until this
      // window performs its own compile.
      compiledSources: null,
    });
    void import("@/lib/preview-window")
      .then((module) =>
        module.refreshPreviewWindow({
          identity: {
            projectId: payload.projectId,
            mainDocument: payload.mainDocument,
            projectRevision: payload.projectRevision,
            requestGeneration: payload.requestGeneration,
          },
          status: "success",
          checkpoint: payload,
        }),
      )
      .catch(() => {});
    return true;
  } catch {
    return false;
  }
}
