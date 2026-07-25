import { compileTagged, readCompiledPdf } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useCompileStore } from "@/store/compile";
import { usePreflightStore } from "@/store/preflight";
import { useEngineStore } from "@/store/engine";
import { notifyError, toast } from "@/lib/toast";
import {
  canApplyLocalCompileOutcome,
  createCompileSuccessCheckpoint,
  fingerprintCompileOutput,
  hasCompileCheckpointAdvanced,
} from "@/lib/compile-checkpoint";
import {
  currentCompileProducerId,
  notifyCompileSucceeded,
} from "@/lib/cross-window";
import { refreshPreviewWindow } from "@/lib/preview-window";

export async function compileTaggedAndVerify(): Promise<void> {
  const engine = useEngineStore.getState().info;
  if (!engine || engine.kind === "none") {
    toast.info("Enable a tagging engine in Settings, LaTeX Engine, first.");
    return;
  }

  const files = useFilesStore.getState();
  const capturedProjectId = files.projectId;
  const projectId = files.projectId ?? "default";
  const main = files.mainDoc || "main.tex";
  const checkpointAtStart =
    useCompileStore.getState().lastCompileCheckpoint;
  const matchesAttemptIdentity = () => {
    const currentFiles = useFilesStore.getState();
    return (
      currentFiles.projectId === capturedProjectId &&
      (currentFiles.mainDoc || "main.tex") === main
    );
  };
  const canContinueAfterBackendResult = (
    outputRevision: number | null,
  ) => {
    if (!matchesAttemptIdentity()) return false;
    const current = useCompileStore.getState().lastCompileCheckpoint;
    if (!hasCompileCheckpointAdvanced(checkpointAtStart, current)) return true;
    return (
      outputRevision !== null &&
      current !== null &&
      outputRevision > current.outputRevision
    );
  };

  let id: number | null = null;
  try {
    await files.saveActive();
    if (
      !matchesAttemptIdentity() ||
      hasCompileCheckpointAdvanced(
        checkpointAtStart,
        useCompileStore.getState().lastCompileCheckpoint,
      )
    ) {
      return;
    }

    id = toast.info("Compiling a tagged PDF with LuaLaTeX…", undefined, true);
    const res = await compileTagged(projectId, main);
    // The tagged compile can take minutes; don't paint its result into a
    // different project/main document the user may have switched to meanwhile.
    const resultRevision =
      res.success &&
      Number.isSafeInteger(res.output_revision) &&
      (res.output_revision ?? 0) > 0
        ? res.output_revision
        : null;
    if (!canContinueAfterBackendResult(resultRevision)) {
      toast.dismiss(id);
      id = null;
      return;
    }
    let acceptedSuccess = false;
    let outcomeApplied = false;
    if (res.has_pdf) {
      const bytes = new Uint8Array(await readCompiledPdf(projectId));
      if (matchesAttemptIdentity()) {
        const verifiedOutputId =
          res.output_id !== null &&
          fingerprintCompileOutput(bytes) === res.output_id
            ? res.output_id
            : null;
        const verified = verifiedOutputId !== null;
        const successfulRevision =
          res.success &&
          verified &&
          Number.isSafeInteger(res.output_revision) &&
          (res.output_revision ?? 0) > 0
            ? res.output_revision
            : null;
        const compile = useCompileStore.getState();
        const checkpoint =
          successfulRevision !== null && verifiedOutputId
            ? createCompileSuccessCheckpoint({
                projectId,
                mainDocument: main,
                outputKind: "tagged",
                producerId: currentCompileProducerId(),
                outputRevision: successfulRevision,
                outputId: verifiedOutputId,
                previousCompletedAt: compile.lastCompiledAt,
              })
            : null;
        useCompileStore.setState((state) => {
          if (
            !matchesAttemptIdentity() ||
            !canApplyLocalCompileOutcome(
              checkpoint,
              state.lastCompileCheckpoint,
              checkpointAtStart,
            )
          ) {
            return state;
          }
          outcomeApplied = true;
          return {
            pdfBytes: verified ? bytes : state.pdfBytes,
            status: checkpoint ? "success" : "error",
            phase: "idle",
            log: verified
              ? res.log
              : `${res.log}\nTagged PDF changed before it could be verified. Keeping the prior preview.`,
            lastCompiledAt:
              checkpoint?.completedAt ?? state.lastCompiledAt,
            lastCompileCheckpoint:
              checkpoint ?? state.lastCompileCheckpoint,
          };
        });
        if (outcomeApplied && checkpoint) {
          acceptedSuccess = true;
          refreshPreviewWindow();
          notifyCompileSucceeded(checkpoint);
          await usePreflightStore.getState().run();
        }
      }
    } else {
      useCompileStore.setState((state) => {
        if (
          !matchesAttemptIdentity() ||
          !canApplyLocalCompileOutcome(
            null,
            state.lastCompileCheckpoint,
            checkpointAtStart,
          )
        ) {
          return state;
        }
        outcomeApplied = true;
        return {
          status: "error",
          phase: "idle",
          log: res.log,
        };
      });
    }
    if (!outcomeApplied) {
      toast.dismiss(id);
      id = null;
      return;
    }
    toast.dismiss(id);
    id = null;
    if (acceptedSuccess) {
      toast.success("Tagged PDF compiled. See the accessibility verdict below.");
    } else {
      toast.error("Tagged compile finished with errors. Check the log.");
    }
  } catch (e) {
    if (id !== null) toast.dismiss(id);
    notifyError(
      "compile tagged",
      e,
      "Tagged compile failed. Check the engine and try again.",
    );
  }
}
