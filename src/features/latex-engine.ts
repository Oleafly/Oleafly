import { compileTagged, readCompiledPdf } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import {
  beginCompileRequestIdentity,
  captureCompileSourceSnapshot,
  isCompileOutputStillWanted,
  useCompileStore,
} from "@/store/compile";
import { usePreflightStore } from "@/store/preflight";
import { useEngineStore } from "@/store/engine";
import { notifyError, toast } from "@/lib/toast";
import { i18n } from "@/i18n";
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
import { resolveEffectiveMainDoc } from "@/lib/tex-root";

type TaggedCompileResult = Awaited<ReturnType<typeof compileTagged>>;
type TaggedCompileIdentity = ReturnType<typeof beginCompileRequestIdentity>;
type TaggedCheckpoint = ReturnType<typeof createCompileSuccessCheckpoint> | null;
type TaggedSourceSnapshot = Awaited<ReturnType<typeof captureCompileSourceSnapshot>>;

interface TaggedOutcomeArgs {
  readonly res: TaggedCompileResult;
  readonly projectId: string;
  readonly main: string;
  readonly requestIdentity: TaggedCompileIdentity;
  readonly checkpointAtStart: TaggedCheckpoint;
  readonly matchesAttemptIdentity: () => boolean;
  readonly compiledSourceSnapshot: TaggedSourceSnapshot;
}

function taggedAttemptSuperseded(
  matchesAttemptIdentity: () => boolean,
  checkpointAtStart: TaggedCheckpoint,
): boolean {
  if (!matchesAttemptIdentity()) return true;
  return hasCompileCheckpointAdvanced(
    checkpointAtStart,
    useCompileStore.getState().lastCompileCheckpoint,
  );
}

function taggedOutputRevision(res: TaggedCompileResult): number | null {
  return res.success &&
    Number.isSafeInteger(res.output_revision) &&
    (res.output_revision ?? 0) > 0
    ? res.output_revision
    : null;
}

async function applyTaggedPdfOutcome(
  args: TaggedOutcomeArgs,
): Promise<{ acceptedSuccess: boolean; outcomeApplied: boolean }> {
  const { res, requestIdentity, matchesAttemptIdentity } = args;
  const bytes = new Uint8Array(await readCompiledPdf(args.projectId));
  if (!matchesAttemptIdentity()) return { acceptedSuccess: false, outcomeApplied: false };
  const verifiedOutputId =
    res.output_id !== null && fingerprintCompileOutput(bytes) === res.output_id
      ? res.output_id
      : null;
  const verified = verifiedOutputId !== null;
  const successfulRevision = verified ? taggedOutputRevision(res) : null;
  const compile = useCompileStore.getState();
  const checkpoint =
    successfulRevision !== null && verifiedOutputId
      ? createCompileSuccessCheckpoint({
          projectId: args.projectId,
          mainDocument: args.main,
          projectRevision: requestIdentity.projectRevision,
          requestGeneration: requestIdentity.requestGeneration,
          outputKind: "tagged",
          producerId: currentCompileProducerId(),
          outputRevision: successfulRevision,
          outputId: verifiedOutputId,
          previousCompletedAt: compile.lastCompiledAt,
        })
      : null;
  let outcomeApplied = false;
  useCompileStore.setState((state) => {
    if (
      !matchesAttemptIdentity() ||
      !canApplyLocalCompileOutcome(
        checkpoint,
        state.lastCompileCheckpoint,
        args.checkpointAtStart,
      )
    ) {
      return state;
    }
    outcomeApplied = true;
    return {
      pdfBytes: verified ? bytes : state.pdfBytes,
      status: checkpoint ? "success" : "error",
      phase: "idle",
      lastAttemptIdentity: requestIdentity,
      failureReason: checkpoint
        ? null
        : "The tagged PDF changed before it could be verified.",
      log: verified
        ? res.log
        : `${res.log}\nTagged PDF changed before it could be verified. Keeping the prior preview.`,
      lastCompiledAt: checkpoint?.completedAt ?? state.lastCompiledAt,
      lastCompileCheckpoint: checkpoint ?? state.lastCompileCheckpoint,
      compiledSources: checkpoint ? args.compiledSourceSnapshot : state.compiledSources,
    };
  });
  if (!outcomeApplied || !checkpoint) return { acceptedSuccess: false, outcomeApplied };
  refreshPreviewWindow({
    identity: requestIdentity,
    status: "success",
    checkpoint,
  });
  notifyCompileSucceeded(checkpoint);
  await usePreflightStore.getState().run();
  return { acceptedSuccess: true, outcomeApplied };
}

function applyTaggedMissingPdfOutcome(args: TaggedOutcomeArgs): boolean {
  const { res, requestIdentity, matchesAttemptIdentity } = args;
  let outcomeApplied = false;
  useCompileStore.setState((state) => {
    if (
      !matchesAttemptIdentity() ||
      !canApplyLocalCompileOutcome(
        null,
        state.lastCompileCheckpoint,
        args.checkpointAtStart,
      )
    ) {
      return state;
    }
    outcomeApplied = true;
    return {
      status: "error",
      phase: "idle",
      lastAttemptIdentity: requestIdentity,
      failureReason:
        "The tagged compile did not produce a valid PDF.",
      log: res.log,
    };
  });
  if (outcomeApplied) {
    refreshPreviewWindow({
      identity: requestIdentity,
      status: "error",
      checkpoint: null,
      message: "The tagged compile did not produce a valid PDF.",
    });
  }
  return outcomeApplied;
}

function reportTaggedCompileException(
  requestIdentity: TaggedCompileIdentity,
  e: unknown,
): void {
  if (isCompileOutputStillWanted(requestIdentity)) {
    useCompileStore.setState({
      status: "error",
      phase: "idle",
      failureReason: `Tagged compile failed: ${String(e)}`,
      lastAttemptIdentity: requestIdentity,
    });
    refreshPreviewWindow({
      identity: requestIdentity,
      status: "error",
      checkpoint: null,
      message: `Tagged compile failed: ${String(e)}`,
    });
  }
  notifyError(
    "compile tagged",
    e,
    i18n.t(($) => $.core.tagged.compileFailed),
  );
}

export async function compileTaggedAndVerify(): Promise<void> {
  const engine = useEngineStore.getState().info;
  if (!engine || engine.kind === "none") {
    toast.info(i18n.t(($) => $.core.tagged.engineRequired));
    return;
  }

  const files = useFilesStore.getState();
  const capturedProjectId = files.projectId;
  const projectId = files.projectId ?? "default";
  // Honour an active `% !TEX root` override, like the main compile lane.
  const main = resolveEffectiveMainDoc().mainDoc;
  const requestIdentity = beginCompileRequestIdentity(projectId, main);
  const checkpointAtStart =
    useCompileStore.getState().lastCompileCheckpoint;
  // Same rule as the main compile store: an edit during the build makes the
  // tagged output stale, not worthless, so it must not be discarded here.
  // The project and main-document checks stay local and explicit - they are
  // what this lane is actually guarding.
  const matchesAttemptIdentity = () => {
    const currentFiles = useFilesStore.getState();
    return (
      currentFiles.projectId === capturedProjectId &&
      resolveEffectiveMainDoc().mainDoc === main &&
      isCompileOutputStillWanted(requestIdentity)
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

  try {
    await files.saveActive();
    if (taggedAttemptSuperseded(matchesAttemptIdentity, checkpointAtStart)) {
      return;
    }
    const compiledSourceSnapshot =
      await captureCompileSourceSnapshot(projectId);
    if (taggedAttemptSuperseded(matchesAttemptIdentity, checkpointAtStart)) {
      return;
    }

    useCompileStore.setState({
      status: "compiling",
      phase: "building",
      errors: [],
      failureReason: null,
      lastAttemptIdentity: requestIdentity,
    });
    refreshPreviewWindow({
      identity: requestIdentity,
      status: "compiling",
      checkpoint: null,
    });
    const res = await compileTagged(projectId, main);
    // The tagged compile can take minutes; don't paint its result into a
    // different project/main document the user may have switched to meanwhile.
    if (!canContinueAfterBackendResult(taggedOutputRevision(res))) {
      return;
    }
    const outcomeArgs: TaggedOutcomeArgs = {
      res,
      projectId,
      main,
      requestIdentity,
      checkpointAtStart,
      matchesAttemptIdentity,
      compiledSourceSnapshot,
    };
    const outcome = res.has_pdf
      ? await applyTaggedPdfOutcome(outcomeArgs)
      : {
          acceptedSuccess: false,
          outcomeApplied: applyTaggedMissingPdfOutcome(outcomeArgs),
        };
    if (!outcome.outcomeApplied) {
      return;
    }
    if (outcome.acceptedSuccess) {
      toast.success(i18n.t(($) => $.core.tagged.compiled));
    } else {
      toast.error(i18n.t(($) => $.core.tagged.compiledWithErrors));
    }
  } catch (e) {
    reportTaggedCompileException(requestIdentity, e);
  }
}
