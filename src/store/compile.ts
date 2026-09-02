import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import {
  cancelCompile,
  clearBuildDir,
  compileProject,
  readCompiledPdf,
  readFileContent,
  validateCompileFingerprint,
  type CompileError,
  type CompileResult,
} from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { engineHintDismissed, useEnginePickerStore } from "@/store/engine-picker";
import {
  classifyCompileFailure,
  importCompatFinding,
  missingLatexPackages,
} from "@oleafly/latex";
import { useProjectAnalysisStore } from "@/store/project-analysis";
import { useSettingsStore } from "@/store/settings";
import { notifyError, toast } from "@/lib/toast";
import { notifyCheckpointPublicationSkipped } from "@/lib/checkpoint-publication";

import { compileOfflineForEngine } from "@/lib/document-engine";
import { ensurePandoc } from "@/features/pandoc";
import {
  canApplyLocalCompileOutcome,
  createCompileSuccessCheckpoint,
  fingerprintCompileOutput,
  hasCompileCheckpointAdvanced,
  sameCompileOutput,
  type CompileSuccessCheckpoint,
} from "@/lib/compile-checkpoint";
import {
  currentCompileProducerId,
  notifyCompileSucceeded,
} from "@/lib/cross-window";
import {
  currentProjectSourcePaths,
  projectFilesystemEpoch,
  readProjectSources,
  useIndexStore,
} from "@/store/project-index";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";

// Bumped on every recompile so a compile that finishes after the project was
// switched (or a newer compile started) can detect it is stale and not overwrite
// the current preview.
let compileSeq = 0;
let rerunQueued = false;
let compileIntentGeneration = 0;
let activeCompileIntent: number | null = null;

export interface CompileRequestIdentity {
  projectId: string;
  mainDocument: string;
  projectRevision: number;
  requestGeneration: number;
}

export interface CompileSourceSnapshot {
  readonly fsEpoch: number;
  readonly texts: Readonly<Record<string, string>>;
}

export type CompileStatus =
  | "idle"
  | "compiling"
  | "success"
  | "error"
  | "unavailable";

// User-facing phase while status === "compiling" (package download vs build).
export type CompilePhase = "idle" | "saving" | "downloading" | "building";

function phaseFromLogChunk(chunk: string, prev: CompilePhase): CompilePhase {
  // Tectonic talks about downloading/fetching packages on first use of a crate.
  if (/download|fetching|connecting to|resolving/i.test(chunk)) return "downloading";
  if (/running|xetex|lualatex|writing|synctex/i.test(chunk) && prev === "downloading") {
    return "building";
  }
  return prev === "idle" || prev === "saving" ? "building" : prev;
}

function projectRevisionFor(projectId: string): number {
  const identity =
    useProjectAnalysisStore.getState().snapshot.identity;
  return identity.projectId === projectId
    ? identity.projectRevision
    : 0;
}

function identityForGeneration(
  projectId: string,
  mainDocument: string,
  requestGeneration: number,
): CompileRequestIdentity {
  return {
    projectId,
    mainDocument,
    projectRevision: projectRevisionFor(projectId),
    requestGeneration,
  };
}

/**
 * Starts a compile identity lane for non-standard producers such as the
 * tagged-PDF pipeline. The main compile store uses the same monotonically
 * increasing generation, so either producer supersedes older async work.
 */
export function beginCompileRequestIdentity(
  projectId: string,
  mainDocument: string,
): CompileRequestIdentity {
  return identityForGeneration(
    projectId,
    mainDocument,
    ++compileIntentGeneration,
  );
}

export function isCompileRequestIdentityCurrent(
  identity: CompileRequestIdentity,
): boolean {
  const files = useFilesStore.getState();
  return (
    files.projectId === identity.projectId &&
    resolveEffectiveMainDoc().mainDoc === identity.mainDocument &&
    projectRevisionFor(identity.projectId) === identity.projectRevision &&
    compileIntentGeneration === identity.requestGeneration
  );
}

/**
 * Whether a finished compile's output still belongs to the surface that asked
 * for it.
 *
 * Deliberately ignores `projectRevision`. That counter advances on every edit
 * (`useIndexStore.updateFile`), so including it here discarded a completed
 * compile whenever the user typed while it ran - one keystroke during a long
 * book build threw the PDF away with nothing requeued. Editing during a
 * compile makes the result *stale*, not worthless: the checkpoint records the
 * revision it was built from, and the preview already labels a non-current PDF
 * as stale rather than hiding it.
 *
 * What genuinely invalidates an output is still checked: a different project, a
 * different main document, or a newer compile having superseded this one.
 */
export function isCompileOutputStillWanted(
  identity: CompileRequestIdentity,
): boolean {
  const files = useFilesStore.getState();
  return (
    files.projectId === identity.projectId &&
    resolveEffectiveMainDoc().mainDoc === identity.mainDocument &&
    compileIntentGeneration === identity.requestGeneration
  );
}

function currentSourcePaths(projectId: string): string[] | null {
  const files = useFilesStore.getState();
  if (files.projectId !== projectId || files.loading) return null;
  return currentProjectSourcePaths(resolveEffectiveMainDoc().mainDoc);
}

function samePaths(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((path, index) => path === right[index])
  );
}

/**
 * Captures the exact source inputs visible to the compiler. Clean buffers and
 * indexed unopened files are already disk-backed and retain their string
 * identity; only missing/dirty non-active inputs require an IPC read.
 */
export async function captureCompileSourceSnapshot(
  projectId: string,
): Promise<CompileSourceSnapshot | null> {
  const paths = currentSourcePaths(projectId);
  if (!paths) return null;
  const epoch = projectFilesystemEpoch();
  const loaded = await readProjectSources(projectId, paths, {
    diskForDirty: true,
  });
  if (loaded.unreadable.size > 0) return null;
  const currentPaths = currentSourcePaths(projectId);
  if (
    !currentPaths ||
    !samePaths(paths, currentPaths) ||
    projectFilesystemEpoch() !== epoch
  ) {
    return null;
  }
  return {
    fsEpoch: epoch,
    texts: loaded.texts,
  };
}

function sourceSnapshotMatchesCurrent(
  snapshot: CompileSourceSnapshot,
  projectId: string,
): boolean {
  const paths = currentSourcePaths(projectId);
  if (!paths) return false;
  const snapshotPaths = Object.keys(snapshot.texts).sort((a, b) => Number(a > b) - Number(a < b));
  if (!samePaths(paths, snapshotPaths)) return false;

  const indexed = useIndexStore.getState();
  if (projectFilesystemEpoch() !== snapshot.fsEpoch) {
    return false;
  }
  const files = useFilesStore.getState();
  return paths.every((path) => {
    const current =
      files.files[path]?.content ?? indexed.texts[path];
    return (
      current !== undefined &&
      current === snapshot.texts[path]
    );
  });
}

export function isCompileCheckpointCurrent(
  checkpoint: CompileSuccessCheckpoint | null,
): checkpoint is CompileSuccessCheckpoint {
  if (!checkpoint) return false;
  const files = useFilesStore.getState();
  if (
    files.projectId !== checkpoint.projectId ||
    resolveEffectiveMainDoc().mainDoc !== checkpoint.mainDocument
  ) {
    return false;
  }
  if (
    projectRevisionFor(checkpoint.projectId) ===
    checkpoint.projectRevision
  ) {
    return true;
  }

  // Revisions remain monotonic for async race rejection. Freshness may still
  // recover when edit + undo/backspace restores the byte-for-byte source set
  // that produced the currently displayed output.
  const compile = useCompileStore.getState();
  return (
    sameCompileOutput(checkpoint, compile.lastCompileCheckpoint) &&
    compile.compiledSources !== null &&
    sourceSnapshotMatchesCurrent(
      compile.compiledSources,
      checkpoint.projectId,
    )
  );
}

export interface CompileState {
  status: CompileStatus;
  phase: CompilePhase;
  log: string;
  errors: CompileError[];
  pdfBytes: Uint8Array | null;
  lastAttemptIdentity: CompileRequestIdentity | null;
  failureReason: string | null;
  lastCompiledAt: number | null;
  lastCompileCheckpoint: CompileSuccessCheckpoint | null;
  compiledSources: CompileSourceSnapshot | null;
  compileTimeMs: number | null;
  autoCompile: boolean;
  setAutoCompile: (v: boolean) => void;
  /// `fast` trades reference/TOC freshness for a single typesetting pass.
  compileMode: CompileMode;
  setCompileMode: (mode: CompileMode) => void;
  /// Refuse to compile a main document whose delimiters or environments are
  /// unbalanced, rather than handing TeX source it cannot make sense of.
  checkSyntaxBeforeCompile: boolean;
  setCheckSyntaxBeforeCompile: (check: boolean) => void;
  /// Stop at the first TeX error instead of pushing on to a best-effort PDF.
  stopOnFirstError: boolean;
  setStopOnFirstError: (stop: boolean) => void;
  /// Ends the running compile. Resolves once the compiler has been asked to stop.
  stopCompile: () => Promise<void>;
  reset: () => void;
  recompile: (
    options?: { fromScratch?: boolean },
  ) => Promise<CompileResult | undefined>;
  /**
   * Seed the preview and success checkpoint from the persisted compile
   * fingerprint plus the already-built PDF on disk, skipping the on-open
   * compile entirely. Returns false (leaving the store untouched) whenever
   * the record is missing/stale, the store already holds a checkpoint, or
   * the on-disk PDF is not the fingerprinted output.
   */
  restoreFromDisk: (projectId: string, mainDoc: string) => Promise<boolean>;
}

export type CompileMode = "normal" | "fast";

const AUTO_COMPILE_KEY = "oleafly:compile:auto";
const COMPILE_MODE_KEY = "oleafly:compile:mode";
const SYNTAX_CHECK_KEY = "oleafly:compile:syntax-check";
const STOP_ON_ERROR_KEY = "oleafly:compile:stop-on-first-error";

function readStoredFlag(key: string, fallback: boolean): boolean {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

function storeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* a storage-less runtime keeps the setting for this session only */
  }
}

function readStoredCompileMode(): CompileMode {
  try {
    return typeof localStorage !== "undefined" &&
      localStorage.getItem(COMPILE_MODE_KEY) === "fast"
      ? "fast"
      : "normal";
  } catch {
    return "normal";
  }
}

/// Reports the unbalanced-delimiter class of error the linter can prove without
/// running TeX. Offsets are resolved to 1-based lines for the log pane.
async function mainDocumentSyntaxErrors(
  projectId: string,
  mainDoc: string,
): Promise<CompileError[]> {
  const [source, { lintLatexText }] = await Promise.all([
    readFileContent(projectId, mainDoc),
    import("@oleafly/editor"),
  ]);
  const lineStarts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") lineStarts.push(index + 1);
  }
  const lineFor = (offset: number) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (lineStarts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
  return lintLatexText(source)
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => ({
      line: lineFor(diagnostic.from),
      file: mainDoc,
      message: diagnostic.message,
      kind: "error",
      explanation: null,
    }));
}

/**
 * Open the engine-picker modal when a failed Tectonic compile matches a known
 * engine gap. Skipped for latexmk projects (they have the full toolchain) and
 * for finding sets the user already dismissed with "Keep Tectonic".
 *
 * Catch-all: when no specific signature matches but the errors originate in a
 * class or style file rather than the user's own document, treat it as an
 * engine gap too. That is the "it works on Overleaf" long tail (publisher
 * classes relying on toolchain behavior Tectonic does not provide), and it
 * never fires for ordinary typos, which TeX attributes to the user's .tex.
 */
// Last missing-package suggestion per project, so auto-compile retries of the
// same failure do not stack identical toasts. Session-scoped on purpose: a
// fresh launch may as well offer the install again.
const suggestedPackagesByProject = new Map<string, string>();

/**
 * A latexmk compile that failed on a missing .sty/.cls gets a one-click
 * "install via tlmgr and recompile" toast. This closes the gap between a
 * minimal TinyTeX and what a journal template actually loads.
 */
// Identifies a set of missing packages independently of the order the log
// happened to mention them in, so the same gap is only ever offered once.
export function packageSuggestionSignature(
  packages: readonly string[],
): string {
  return [...new Set(packages)]
    .sort((a, b) => Number(a > b) - Number(a < b))
    .join(",");
}

function maybeSuggestMissingPackages(log: string): void {
  const files = useFilesStore.getState();
  const projectId = files.projectId;
  if (files.engine.id !== "latexmk" || !projectId) return;
  const packages = missingLatexPackages(log);
  if (packages.length === 0) return;
  const signature = packageSuggestionSignature(packages);
  if (suggestedPackagesByProject.get(projectId) === signature) return;
  suggestedPackagesByProject.set(projectId, signature);
  void (async () => {
    const tauri = await import("@/lib/tauri");
    const info = await tauri.latexEngineInfo().catch(() => null);
    if (!info?.tlmgr) return; // MiKTeX installs on the fly; nothing to offer
    const label = packages.length === 1 ? `Install ${packages[0]}` : `Install all ${packages.length}`;
    const summary =
      packages.length === 1
        ? `The compile needs the LaTeX package "${packages[0]}", which is not installed.`
        : `The compile needs ${packages.length} LaTeX packages that are not installed (${packages.join(", ")}).`;
    toast.info(
      summary,
      {
        label,
        onClick: () => {
          void (async () => {
            toast.info(
              packages.length === 1
                ? `Installing ${packages[0]}. The compile restarts when it finishes.`
                : `Installing ${packages.length} packages. The compile restarts when they finish.`,
            );
            try {
              await tauri.tlmgrInstall(packages);
              suggestedPackagesByProject.delete(projectId);
              void useCompileStore.getState().recompile();
            } catch (error) {
              notifyError(
                "install missing packages",
                error,
                "The packages could not be installed. See Settings, LaTeX Engine for details.",
              );
            }
          })();
        },
      },
      true,
    );
  })();
}

function maybePromptEngineGap(log: string, errors: CompileError[]): void {
  const files = useFilesStore.getState();
  if (files.engine.id !== "latex" || !files.projectId) return;
  let findings = classifyCompileFailure(log);
  if (findings.length === 0) {
    const classFileError = errors.some(
      (error) =>
        error.kind === "error" && /\.(cls|sty|bbx|cbx|def|ldf)$/i.test(error.file ?? ""),
    );
    if (classFileError) findings = [importCompatFinding("class-compat")];
  }
  if (findings.length === 0) return;
  if (engineHintDismissed(files.projectId, findings)) return;
  useEnginePickerStore.getState().openPicker("compile-failure", findings);
}

export const useCompileStore = create<CompileState>((set, get) => ({
  status: "idle",
  phase: "idle",
  log: "",
  errors: [],
  pdfBytes: null,
  lastAttemptIdentity: null,
  failureReason: null,
  lastCompiledAt: null,
  lastCompileCheckpoint: null,
  compiledSources: null,
  compileTimeMs: null,
  autoCompile: readStoredFlag(AUTO_COMPILE_KEY, false),
  setAutoCompile: (v) => {
    storeFlag(AUTO_COMPILE_KEY, v);
    set({ autoCompile: v });
  },
  compileMode: readStoredCompileMode(),
  setCompileMode: (mode) => {
    try {
      localStorage.setItem(COMPILE_MODE_KEY, mode);
    } catch {
      /* session-only */
    }
    set({ compileMode: mode });
  },
  checkSyntaxBeforeCompile: readStoredFlag(SYNTAX_CHECK_KEY, true),
  setCheckSyntaxBeforeCompile: (check) => {
    storeFlag(SYNTAX_CHECK_KEY, check);
    set({ checkSyntaxBeforeCompile: check });
  },
  stopOnFirstError: readStoredFlag(STOP_ON_ERROR_KEY, false),
  setStopOnFirstError: (stop) => {
    storeFlag(STOP_ON_ERROR_KEY, stop);
    set({ stopOnFirstError: stop });
  },
  stopCompile: async () => {
    // Drop any queued rerun too: the user asked for compilation to end, not to
    // be replaced by the next one in line.
    rerunQueued = false;
    try {
      await cancelCompile();
    } catch (error) {
      notifyError("stop compile", error);
    }
  },
  reset: () => {
    compileSeq++;
    rerunQueued = false;
    activeCompileIntent = null;
    compileIntentGeneration++;
    set({
      status: "idle",
      phase: "idle",
      log: "",
      errors: [],
      pdfBytes: null,
      lastAttemptIdentity: null,
      failureReason: null,
      lastCompiledAt: null,
      lastCompileCheckpoint: null,
      compiledSources: null,
      compileTimeMs: null,
    });
  },
  restoreFromDisk: async (projectId, mainDoc) => {
    // Only seed a fresh store: once any compile has produced a checkpoint in
    // this session, disk state is older by definition.
    if (get().lastCompileCheckpoint || get().status !== "idle") return false;
    const validated = await validateCompileFingerprint(projectId, mainDoc).catch(() => null);
    if (!validated || validated.main_document !== mainDoc) return false;
    const buffer = await readCompiledPdf(projectId).catch(() => null);
    if (!buffer) return false;
    const bytes = new Uint8Array(buffer);
    // The PDF on disk must be the exact output the fingerprint describes.
    if (fingerprintCompileOutput(bytes) !== validated.output_id) return false;
    if (!Number.isSafeInteger(validated.output_revision) || validated.output_revision <= 0) {
      return false;
    }
    const files = useFilesStore.getState();
    if (files.projectId !== projectId || get().lastCompileCheckpoint) return false;
    const checkpoint = createCompileSuccessCheckpoint({
      projectId,
      mainDocument: mainDoc,
      // The record was validated against the sources on disk, which are
      // exactly what this freshly opened project loaded.
      projectRevision: projectRevisionFor(projectId),
      outputKind: "standard",
      producerId: currentCompileProducerId(),
      outputRevision: validated.output_revision,
      outputId: validated.output_id,
      previousCompletedAt: get().lastCompiledAt,
    });
    set({
      status: "success",
      phase: "idle",
      pdfBytes: bytes,
      failureReason: null,
      errors: [],
      log: validated.log,
      lastCompiledAt: checkpoint.completedAt,
      lastCompileCheckpoint: checkpoint,
    });
    return true;
  },

  recompile: async (options) => {
    // Compiles share one build dir, so never run two at once. A request made
    // mid-compile queues exactly one rerun so a manual Cmd+Enter during the
    // on-open auto-compile still compiles the latest edits instead of being
    // silently dropped.
    if (activeCompileIntent !== null || get().status === "compiling") {
      rerunQueued = true;
      return undefined;
    }
    const intent = ++compileIntentGeneration;
    activeCompileIntent = intent;
    const releaseIntent = () => {
      if (activeCompileIntent === intent) activeCompileIntent = null;
    };
    const abortIntent = () => {
      const ownsIntent = activeCompileIntent === intent;
      releaseIntent();
      if (ownsIntent) {
        rerunQueued = false;
        set((state) => {
          if (
            state.status !== "compiling" ||
            state.lastAttemptIdentity?.requestGeneration !== intent
          ) {
            return state;
          }
          return {
            status: "idle",
            phase: "idle",
          };
        });
      }
    };

    const files = useFilesStore.getState();
    const capturedProjectId = files.projectId;
    // The effective main document honours an active `% !TEX root` override,
    // falling back to the stored main doc. Every identity check below must
    // agree with this resolution or the compile invalidates itself.
    const mainDoc = resolveEffectiveMainDoc().mainDoc;
    const checkpointAtStart = get().lastCompileCheckpoint;
    const matchesProjectAndMain = () => {
      const currentFiles = useFilesStore.getState();
      return (
        activeCompileIntent === intent &&
        currentFiles.projectId === capturedProjectId &&
        resolveEffectiveMainDoc().mainDoc === mainDoc
      );
    };
    const checkpointAdvanced = (
      current = get().lastCompileCheckpoint,
    ) => hasCompileCheckpointAdvanced(checkpointAtStart, current);
    if (!files.engineLoaded) {
      const reason =
        files.engineError ??
        "Document engine details are still loading.";
      set({
        status: "unavailable",
        phase: "idle",
        failureReason: reason,
        lastAttemptIdentity: capturedProjectId
          ? identityForGeneration(capturedProjectId, mainDoc, intent)
          : null,
      });
      notifyError(
        "compile",
        reason,
        "Compile is disabled until the document engine is loaded.",
      );
      abortIntent();
      return undefined;
    }
    if (files.engine.capabilities.compiler_prerequisite === "pandoc") {
      try {
        if (!(await ensurePandoc())) {
          set({
            status: "unavailable",
            phase: "idle",
            failureReason:
              "Pandoc is required for this document engine and is not available.",
            lastAttemptIdentity: capturedProjectId
              ? identityForGeneration(capturedProjectId, mainDoc, intent)
              : null,
          });
          abortIntent();
          return undefined;
        }
      } catch (e) {
        set({
          status: "unavailable",
          phase: "idle",
          failureReason: `Pandoc setup failed: ${String(e)}`,
          lastAttemptIdentity: capturedProjectId
            ? identityForGeneration(capturedProjectId, mainDoc, intent)
            : null,
        });
        notifyError("Pandoc setup", e);
        abortIntent();
        return undefined;
      }
      if (!matchesProjectAndMain() || checkpointAdvanced()) {
        abortIntent();
        return undefined;
      }
    }
    if (files.engine.capabilities.compiler_prerequisite === "system_tex") {
      // A TinyTeX install may be in flight: queue this compile behind it
      // instead of failing with "latexmk not found". The engine store runs
      // the queued compile the moment the install lands.
      const engineModule = await import("@/store/engine");
      const engineStore = engineModule.useEngineStore.getState();
      if (engineStore.installing) {
        engineStore.queueCompileAfterInstall();
        set({
          status: "unavailable",
          phase: "idle",
          failureReason:
            "TinyTeX is still downloading. This compile starts automatically when it finishes.",
          lastAttemptIdentity: capturedProjectId
            ? identityForGeneration(capturedProjectId, mainDoc, intent)
            : null,
        });
        abortIntent();
        return undefined;
      }
      if (!matchesProjectAndMain() || checkpointAdvanced()) {
        abortIntent();
        return undefined;
      }
    }
    if (!matchesProjectAndMain() || checkpointAdvanced()) {
      abortIntent();
      return undefined;
    }
    if (!capturedProjectId) {
      abortIntent();
      return undefined;
    }
    const savingIdentity = identityForGeneration(
      capturedProjectId,
      mainDoc,
      intent,
    );
    set({
      status: "compiling",
      phase: "saving",
      errors: [],
      failureReason: null,
      lastAttemptIdentity: savingIdentity,
    });
    try {
      await files.saveActive();
    } catch (e) {
      set({
        status: "error",
        phase: "idle",
        failureReason: `The document could not be saved before compiling: ${String(e)}`,
        lastAttemptIdentity: capturedProjectId
          ? identityForGeneration(capturedProjectId, mainDoc, intent)
          : null,
      });
      abortIntent();
      notifyError("save before compile", e);
      return undefined;
    }
    if (!matchesProjectAndMain() || checkpointAdvanced()) {
      abortIntent();
      return undefined;
    }

    if (get().checkSyntaxBeforeCompile) {
      // Runs after the save so it reads exactly the source the compiler would.
      let syntaxErrors: CompileError[] = [];
      try {
        syntaxErrors = await mainDocumentSyntaxErrors(
          capturedProjectId,
          mainDoc,
        );
      } catch {
        // The checker is an optimization, never a gate of its own: if the
        // source cannot be read here, let the compiler report the real problem.
        syntaxErrors = [];
      }
      if (!matchesProjectAndMain() || checkpointAdvanced()) {
        abortIntent();
        return undefined;
      }
      if (syntaxErrors.length > 0) {
        set({
          status: "error",
          phase: "idle",
          errors: syntaxErrors,
          failureReason:
            "Syntax check found errors. Fix them, or turn off “Check syntax before compile”.",
          log: `Syntax check found ${syntaxErrors.length} error${
            syntaxErrors.length === 1 ? "" : "s"
          } in ${mainDoc}; the compiler was not run.\n${syntaxErrors
            .map((error) => `${mainDoc}:${error.line ?? 0}: ${error.message}`)
            .join("\n")}\n`,
          lastAttemptIdentity: identityForGeneration(
            capturedProjectId,
            mainDoc,
            intent,
          ),
        });
        abortIntent();
        return undefined;
      }
    }

    if (options?.fromScratch) {
      try {
        await clearBuildDir(capturedProjectId);
      } catch (error) {
        notifyError("clear build directory", error);
        abortIntent();
        return undefined;
      }
      if (!matchesProjectAndMain() || checkpointAdvanced()) {
        abortIntent();
        return undefined;
      }
    }

    const projectId = capturedProjectId;
    const requestIdentity = identityForGeneration(
      projectId,
      mainDoc,
      intent,
    );
    if (
      !isCompileRequestIdentityCurrent(requestIdentity)
    ) {
      abortIntent();
      return undefined;
    }
    const compiledSourceSnapshot =
      await captureCompileSourceSnapshot(projectId);
    if (!isCompileRequestIdentityCurrent(requestIdentity)) {
      abortIntent();
      return undefined;
    }
    const offlinePolicy = compileOfflineForEngine(
      files.engine,
      useSettingsStore.getState().offline,
    );
    const seq = ++compileSeq;
    // True once this compile's result is no longer the one the UI should show
    // (project switched, or a newer compile started).
    const identityStale = () => {
      return seq !== compileSeq || !isCompileOutputStillWanted(requestIdentity);
    };

    let started = false;
    set((state) => {
      if (
        identityStale() ||
        hasCompileCheckpointAdvanced(
          checkpointAtStart,
          state.lastCompileCheckpoint,
        )
      ) {
        return state;
      }
      started = true;
      return {
        status: "compiling",
        phase: "building",
        log: offlinePolicy.notice ? `${offlinePolicy.notice}\n` : "",
        errors: [],
        lastAttemptIdentity: requestIdentity,
        failureReason: null,
      };
    });
    if (!started) {
      abortIntent();
      return undefined;
    }
    void import("@/lib/preview-window")
      .then((module) =>
        module.refreshPreviewWindow({
          identity: requestIdentity,
          status: "compiling",
          checkpoint: null,
        }),
      )
      .catch(() => {});
    let unlisten = () => {};
    let pendingLog = "";
    let pendingPhase: CompilePhase | null = null;
    let logFrame: number | null = null;
    const flushPendingLog = () => {
      if (logFrame !== null) {
        cancelAnimationFrame(logFrame);
        logFrame = null;
      }
      const chunk = pendingLog;
      const phase = pendingPhase;
      pendingLog = "";
      pendingPhase = null;
      if (!chunk) return;
      set((state) => {
        if (
          identityStale() ||
          hasCompileCheckpointAdvanced(
            checkpointAtStart,
            state.lastCompileCheckpoint,
          )
        ) {
          return state;
        }
        return {
          log: state.log + chunk,
          phase: phase ?? state.phase,
        };
      });
    };
    try {
      unlisten = await listen<string>("compile:log", (e) => {
        if (identityStale() || checkpointAdvanced()) return;
        pendingLog += e.payload;
        pendingPhase = phaseFromLogChunk(
          e.payload,
          pendingPhase ?? get().phase,
        );
        if (logFrame === null) {
          logFrame = requestAnimationFrame(() => {
            logFrame = null;
            flushPendingLog();
          });
        }
      });
      if (identityStale() || checkpointAdvanced()) return undefined;
      const result = await compileProject(
        projectId,
        mainDoc,
        offlinePolicy.offline,
        get().compileMode === "fast",
        get().stopOnFirstError,
      );
      flushPendingLog();
      if (result.stopped) {
        // A stop is not a failed document: keep the preview and the previous
        // log rather than reporting an error the source did not cause.
        rerunQueued = false;
        set((state) =>
          identityStale()
            ? state
            : {
                status: state.lastCompileCheckpoint ? "success" : "idle",
                phase: "idle",
                failureReason: null,
                log: `${state.log}\nCompile stopped.\n`,
              },
        );
        return result;
      }
      const resultRevision =
        result.ok &&
        Number.isSafeInteger(result.output_revision) &&
        (result.output_revision ?? 0) > 0
          ? result.output_revision
          : null;
      const currentCheckpoint = get().lastCompileCheckpoint;
      if (
        identityStale() ||
        (checkpointAdvanced(currentCheckpoint) &&
          (resultRevision === null ||
            (currentCheckpoint !== null &&
              resultRevision <= currentCheckpoint.outputRevision)))
      ) {
        return result;
      }
      // Wrap the IPC ArrayBuffer as a view (no copy of the payload bytes). Read
      // whenever a PDF exists, even on error: Tectonic's continue-on-errors mode
      // still produces a best-effort PDF, and we want to keep showing it.
      const buf = result.has_pdf ? await readCompiledPdf(projectId) : null;
      const bytes = buf ? new Uint8Array(buf) : null;
      if (identityStale()) return result;
      const verifiedOutputId =
        bytes &&
        result.output_id &&
        fingerprintCompileOutput(bytes) === result.output_id
          ? result.output_id
          : null;
      const verifiedBytes = verifiedOutputId ? bytes : null;
      const outputIdentityError =
        result.has_pdf && !verifiedBytes
          ? "\nCompiled PDF changed before it could be verified. Keeping the prior preview."
          : "";
      const successfulRevision =
        result.ok &&
        verifiedBytes &&
        Number.isSafeInteger(result.output_revision) &&
        (result.output_revision ?? 0) > 0
          ? result.output_revision
          : null;
      const checkpoint =
        successfulRevision !== null && verifiedOutputId
          ? createCompileSuccessCheckpoint({
              projectId,
              mainDocument: mainDoc,
              projectRevision: requestIdentity.projectRevision,
              requestGeneration: requestIdentity.requestGeneration,
              outputKind: "standard",
              producerId: currentCompileProducerId(),
              outputRevision: successfulRevision,
              outputId: verifiedOutputId,
              previousCompletedAt: get().lastCompiledAt,
            })
          : null;
      let applied = false;
      set((state) => {
        if (
          identityStale() ||
          !canApplyLocalCompileOutcome(
            checkpoint,
            state.lastCompileCheckpoint,
            checkpointAtStart,
          )
        ) {
          return state;
        }
        applied = true;
        return {
          status: checkpoint ? "success" : "error",
          phase: "idle",
          pdfBytes: verifiedBytes ?? state.pdfBytes,
          failureReason: checkpoint
            ? null
            : outputIdentityError.trim() ||
              "Compilation did not produce a valid current PDF.",
          errors: result.errors,
          log: `${offlinePolicy.notice ? `${offlinePolicy.notice}\n` : ""}${result.log}${outputIdentityError}`,
          lastCompiledAt: checkpoint?.completedAt ?? state.lastCompiledAt,
          lastCompileCheckpoint:
            checkpoint ?? state.lastCompileCheckpoint,
          compiledSources: checkpoint
            ? compiledSourceSnapshot
            : state.compiledSources,
          compileTimeMs: checkpoint
            ? (result.compile_time_ms ?? 0)
            : state.compileTimeMs,
        };
      });
      if (!applied) return result;
      // A failed Tectonic compile whose log matches a known engine gap
      // (minted, missing index run, shell-escape refusal, unresolved Biber)
      // gets the engine-picker modal instead of leaving the user to decode
      // the log. latexmk projects already have the full toolchain.
      if (!checkpoint) {
        maybePromptEngineGap(result.log, result.errors);
        maybeSuggestMissingPackages(result.log);
      }
      // Tell detached windows (PDF preview, other OS windows) to reload.
      void import("@/lib/preview-window")
        .then((module) =>
          module.refreshPreviewWindow({
            identity: requestIdentity,
            status: checkpoint ? "success" : "error",
            checkpoint,
            message: checkpoint
              ? undefined
              : "Compilation did not produce a valid current PDF.",
          }),
        )
        .catch(() => {});
      if (checkpoint) {
        notifyCompileSucceeded(checkpoint);
        notifyCheckpointPublicationSkipped(result.checkpoint_publication);
      }
      return result;

    } catch (e) {
      set((state) => {
        if (
          identityStale() ||
          hasCompileCheckpointAdvanced(
            checkpointAtStart,
            state.lastCompileCheckpoint,
          )
        ) {
          return state;
        }
        return {
          status: "error",
          phase: "idle",
          log: `${offlinePolicy.notice ? `${offlinePolicy.notice}\n` : ""}Compile failed: ${String(e)}`,
          failureReason: `Compile failed: ${String(e)}`,
        };
      });
      void import("@/lib/preview-window")
        .then((module) =>
          module.refreshPreviewWindow({
            identity: requestIdentity,
            status: "error",
            checkpoint: null,
            message: `Compile failed: ${String(e)}`,
          }),
        )
        .catch(() => {});
      void import("@/lib/log").then(({ logError }) => logError("compile", e));
      return undefined;
    } finally {
      if (logFrame !== null) cancelAnimationFrame(logFrame);
      pendingLog = "";
      pendingPhase = null;
      unlisten();
      const ownsIntent = activeCompileIntent === intent;
      if (ownsIntent && identityStale()) {
        // A same-project main-document switch does not run the project-reset
        // effect. Clear only this attempt's orphaned "compiling" indicator;
        // never replace a success checkpoint that arrived while it was active.
        set((state) => {
          if (
            state.status !== "compiling" ||
            state.lastAttemptIdentity?.requestGeneration !==
              requestIdentity.requestGeneration ||
            hasCompileCheckpointAdvanced(
              checkpointAtStart,
              state.lastCompileCheckpoint,
            )
          ) {
            return state;
          }
          return {
            status: "idle",
            phase: "idle",
            failureReason:
              "The compile was superseded by a newer project revision.",
          };
        });
      }
      releaseIntent();
      if (ownsIntent && rerunQueued) {
        rerunQueued = false;
        if (!identityStale()) void get().recompile();
      }
    }
  },
}));
