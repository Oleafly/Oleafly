import { create, type StoreApi } from "zustand";
import {
  cancelCompile,
  clearBuildDir,
  compileProject,
  readCompiledPdf,
  readFileContent,
  validateCompileFingerprint,
  withEventListener,
  type CompileError,
  type CompileResult,
  type LogDiagnostic,
  type MainDecision,
} from "@/lib/tauri";
import {
  engineErrorMessage,
  engineSwitchToastKey,
  projectCompatibilityFindings,
  reportFileSaveFailure,
  texDistributionGapNotice,
  useFilesStore,
} from "@/store/files";
import {
  engineHintDismissed,
  takeEngineChoiceOnOpen,
  useEnginePickerStore,
} from "@/store/engine-picker";
import {
  classifyCompileFailure,
  importCompatAction,
  importCompatFinding,
  missingLatexFiles,
  type ImportCompatFinding,
} from "@oleafly/latex";
import { useProjectAnalysisStore } from "@/store/project-analysis";
import { useSettingsStore } from "@/store/settings";
import { activeTypstVariant } from "@/store/typst-variant";
import { notifyError, toast } from "@/lib/toast";
import { logError } from "@/lib/log";
import { decodeAppError, describeError } from "@/lib/app-error";
import { explainCodedCompileErrors } from "@/lib/compile-error-codes";
import { projectFolderAvailable, reportLocationError } from "@/store/project-availability";
import { i18n } from "@/i18n";
import { formatList } from "@/lib/intl";

import {
  compileOfflineForEngine,
  compileSettingsForEngine,
  pathUsesEngineSource,
} from "@/lib/document-engine";
import { agentCompileAllowed, automaticCompileAllowed } from "@/lib/open-compile";
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
import { mainDocumentMissing } from "@/lib/main-document";

// Bumped on every recompile so a compile that finishes after the project was
// switched (or a newer compile started) can detect it is stale and not overwrite
// the current preview.
let compileSeq = 0;
let rerunQueued = false;
let rerunOrigin: CompileOrigin = "automatic";
let compileIntentGeneration = 0;

function clearQueuedRerun(): void {
  rerunQueued = false;
  rerunOrigin = "automatic";
}

const COMPILE_ORIGIN_RANK: Readonly<Record<CompileOrigin, number>> = {
  automatic: 0,
  agent: 1,
  explicit: 2,
};

function queueRerun(origin: CompileOrigin): void {
  rerunQueued = true;
  if (COMPILE_ORIGIN_RANK[origin] > COMPILE_ORIGIN_RANK[rerunOrigin]) rerunOrigin = origin;
}

let activeCompileIntent: number | null = null;

const NEARLY_DONE_SHARE = 0.75;
let runningOrigin: CompileOrigin | null = null;
let runningSnapshotAt = 0;
let runningIsRestart = false;
let nextIsRestart = false;
let outdatedStopRequested = false;

function forgetOutdatedStops(): void {
  runningOrigin = null;
  nextIsRestart = false;
  outdatedStopRequested = false;
}

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

export function isCompileCheckpointApplicable(
  checkpoint: CompileSuccessCheckpoint | null,
): checkpoint is CompileSuccessCheckpoint {
  return (
    checkpoint !== null &&
    useFilesStore.getState().projectId === checkpoint.projectId &&
    resolveEffectiveMainDoc().mainDoc === checkpoint.mainDocument
  );
}

export function isCompileCheckpointCurrent(
  checkpoint: CompileSuccessCheckpoint | null,
): checkpoint is CompileSuccessCheckpoint {
  if (!isCompileCheckpointApplicable(checkpoint)) return false;
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
  diagnostics: LogDiagnostic[] | null;
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
  recompile: (options?: RecompileOptions) => Promise<CompileResult | undefined>;
  offer: CompileOffer | null;
  dismissOffer: () => void;
  /**
   * Seed the preview and success checkpoint from the persisted compile
   * fingerprint plus the already-built PDF on disk, skipping the on-open
   * compile entirely. Returns false (leaving the store untouched) whenever
   * the record is missing/stale, the store already holds a checkpoint, or
   * the on-disk PDF is not the fingerprinted output.
   */
  restoreFromDisk: (projectId: string, mainDoc: string) => Promise<boolean>;
  livePreview: LivePreviewState;
  setLivePreviewStatus: (projectId: string, status: LivePreviewStatus, message?: string | null) => void;
}

export type CompileMode = "normal" | "fast";

export type LivePreviewStatus = "off" | "starting" | "on" | "compiling" | "restarting" | "failed";

export interface LivePreviewState {
  readonly projectId: string | null;
  readonly enabled: boolean;
  readonly status: LivePreviewStatus;
  readonly message: string | null;
}

const AUTO_COMPILE_KEY = "oleafly:compile:auto";
const COMPILE_MODE_KEY = "oleafly:compile:mode";
const SYNTAX_CHECK_KEY = "oleafly:compile:syntax-check";
const STOP_ON_ERROR_KEY = "oleafly:compile:stop-on-first-error";
const LEGACY_LIVE_PREVIEW_KEY = "oleafly:compile:typst-live:";

function dropLegacyLivePreviewFlags(): void {
  try {
    const stale: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(LEGACY_LIVE_PREVIEW_KEY)) stale.push(key);
    }
    for (const key of stale) localStorage.removeItem(key);
  } catch {
    return;
  }
}

type FilesSnapshot = ReturnType<typeof useFilesStore.getState>;

export function typstLivePreviewWanted(
  files: FilesSnapshot = useFilesStore.getState(),
  autoCompile: boolean = useCompileStore.getState().autoCompile,
): boolean {
  return Boolean(
    autoCompile &&
      files.projectId &&
      files.engineLoaded &&
      files.engine.source_format === "typst" &&
      !files.engine.typst_missing,
  );
}

export function compileProjectRevision(projectId: string): number {
  return projectRevisionFor(projectId);
}

type LivePreviewModule = typeof import("@/features/typst-live-preview");
let livePreviewModule: Promise<LivePreviewModule> | null = null;

function loadLivePreview(): Promise<LivePreviewModule> {
  livePreviewModule ??= import("@/features/typst-live-preview");
  return livePreviewModule;
}

function livePreviewFlagFor(live: LivePreviewState, projectId: string | null, enabled: boolean): LivePreviewState {
  if (live.projectId === projectId && live.enabled === enabled) return live;
  return { projectId, enabled, status: enabled ? "starting" : "off", message: null };
}

export function syncTypstLivePreview(): void {
  dropLegacyLivePreviewFlags();
  const files = useFilesStore.getState();
  const wanted = typstLivePreviewWanted(files);
  const live = useCompileStore.getState().livePreview;
  const next = livePreviewFlagFor(live, files.projectId, wanted);
  if (next !== live) useCompileStore.setState({ livePreview: next });
  if (!livePreviewModule && !wanted) return;
  void loadLivePreview()
    .then((module) => module.syncLivePreview())
    .catch((error: unknown) => logError("live preview", error));
}

export function stopTypstLivePreview(): void {
  if (!livePreviewModule) return;
  void livePreviewModule
    .then((module) => module.stopLivePreview())
    .catch((error: unknown) => logError("live preview", error));
}

async function interruptTypstLivePreview(): Promise<void> {
  if (!livePreviewModule) return;
  try {
    const module = await livePreviewModule;
    await module.interruptLivePreview();
  } catch (error) {
    void logError("live preview", error);
  }
}

function livePreviewRoutes(state: CompileState, files: FilesSnapshot, projectId: string): boolean {
  const live = state.livePreview;
  return (
    live.enabled &&
    live.projectId === projectId &&
    live.status !== "failed" &&
    files.engine.source_format === "typst"
  );
}

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

export type CompileOrigin = "explicit" | "agent" | "automatic";

export interface RecompileOptions {
  readonly fromScratch?: boolean;
  readonly origin?: CompileOrigin;
}

export type CompileOffer =
  | {
      readonly kind: "engine-gap";
      readonly projectId: string;
      readonly findings: ImportCompatFinding[];
    }
  | {
      readonly kind: "missing-packages";
      readonly projectId: string;
      readonly packages: string[];
    }
  | {
      readonly kind: "typst-version-missing";
      readonly projectId: string;
      readonly version: string;
    };

const TYPST_VERSION_MISSING = "typst_version_missing";

const offeredPackageSets = new Map<string, Set<string>>();
const packageInstallsRunning = new Set<string>();
const missingPackageToasts = new Map<string, number>();
const bundleRetryToasts = new Map<string, number>();
let onlineRetry: { readonly projectId: string; readonly listener: () => void } | null = null;
let engineLoadWait: (() => void) | null = null;

const MUTATION_CONFLICT = "mutation conflict at generation";
const USER_TREE_NOTICE =
  /^The system TeX tree is not writable, so the packages went into your personal tree at (.+?)\.?$/;

// Identifies a set of missing packages independently of the order the log
// happened to mention them in, so the same gap is only ever offered once.
export function packageSuggestionSignature(
  packages: readonly string[],
): string {
  return [...new Set(packages)]
    .sort((a, b) => Number(a > b) - Number(a < b))
    .join(",");
}

function rememberOffer(projectId: string, signature: string): boolean {
  const seen = offeredPackageSets.get(projectId) ?? new Set<string>();
  if (seen.has(signature)) return false;
  seen.add(signature);
  offeredPackageSets.set(projectId, seen);
  return true;
}

function forgetOffer(projectId: string, signature: string): void {
  offeredPackageSets.get(projectId)?.delete(signature);
}

function dismissOwnedToast(toasts: Map<string, number>, projectId: string): void {
  const id = toasts.get(projectId);
  if (id === undefined) return;
  toasts.delete(projectId);
  toast.dismiss(id);
}

function isLatexmkProject(projectId: string): boolean {
  const files = useFilesStore.getState();
  return files.projectId === projectId && files.engine.id === "latexmk";
}

function missingPackagesToastKey(projectId: string): string {
  return `missing-packages:${projectId}`;
}

function userTreeNotice(outcome: string): string | null {
  let path: string | null = null;
  for (const notice of installerNotices(outcome)) {
    const match = USER_TREE_NOTICE.exec(notice);
    if (match && path === null) path = match[1];
    else void logError("install missing packages", notice);
  }
  return path;
}

function clearOffer(projectId: string): void {
  useCompileStore.setState((state) =>
    state.offer?.projectId === projectId ? { offer: null } : state,
  );
}

function offerForAttempt(ctx: CompileApplyContext, offer: CompileOffer): boolean {
  let recorded = false;
  ctx.set((state) => {
    if (
      state.status !== "error" ||
      state.lastAttemptIdentity?.requestGeneration !== ctx.requestIdentity.requestGeneration
    ) {
      return state;
    }
    recorded = true;
    return { offer };
  });
  return recorded;
}

async function installMissingPackages(projectId: string, packages: string[]): Promise<void> {
  const key = missingPackagesToastKey(projectId);
  const id = toast.infoUnique(
    key,
    i18n.t(($) => $.core.missingPackages.installing, {
      count: packages.length,
      name: packages[0],
    }),
    undefined,
    true,
  );
  missingPackageToasts.set(projectId, id);
  try {
    const tauri = await import("@/lib/tauri");
    const outcome = await tauri.tlmgrInstallMissing(packages);
    const engineStore = await import("@/store/engine");
    await engineStore.useEngineStore.getState().refreshPackages();
    const path = userTreeNotice(outcome);
    missingPackageToasts.delete(projectId);
    if (path === null) toast.dismiss(id);
    else toast.infoUnique(key, i18n.t(($) => $.core.missingPackages.userTree, { path }));
    if (isLatexmkProject(projectId)) void useCompileStore.getState().recompile();
  } catch (error) {
    void logError("install missing packages", error);
    const message = i18n.t(($) => $.settings.engine.packages.error.withDetail, {
      message: i18n.t(($) => $.settings.engine.packages.error.install, {
        name: formatList(packages),
      }),
      detail: describeError(error),
    });
    missingPackageToasts.set(projectId, toast.errorUnique(key, message));
  } finally {
    forgetOffer(projectId, packageSuggestionSignature(packages));
  }
}

export function installOfferedPackages(projectId: string, packages: string[]): void {
  if (packageInstallsRunning.has(projectId) || !isLatexmkProject(projectId)) return;
  packageInstallsRunning.add(projectId);
  clearOffer(projectId);
  void installMissingPackages(projectId, packages).finally(() => {
    packageInstallsRunning.delete(projectId);
  });
}

function showMissingPackagesOffer(projectId: string, packages: string[]): void {
  if (!rememberOffer(projectId, packageSuggestionSignature(packages))) return;
  const id = toast.infoUnique(
    missingPackagesToastKey(projectId),
    i18n.t(($) => $.core.missingPackages.summary, {
      count: packages.length,
      name: packages[0],
      names: formatList(packages),
    }),
    {
      label: i18n.t(($) => $.core.missingPackages.action, {
        count: packages.length,
        name: packages[0],
      }),
      onClick: () => installOfferedPackages(projectId, packages),
    },
    true,
  );
  missingPackageToasts.set(projectId, id);
}

function maybeSuggestMissingPackages(ctx: CompileApplyContext, log: string): void {
  const { projectId } = ctx;
  if (!isLatexmkProject(projectId) || packageInstallsRunning.has(projectId)) return;
  const packages = missingLatexFiles(log);
  if (packages.length === 0) return;
  const gap = texDistributionGapNotice(projectId);
  if (gap !== null) {
    if (ctx.origin === "explicit") toast.infoUnique(missingPackagesToastKey(projectId), gap);
    return;
  }
  void (async () => {
    const tauri = await import("@/lib/tauri");
    const info = await tauri.latexEngineInfo().catch(() => null);
    if (!info?.tlmgr || !isLatexmkProject(projectId)) return;
    if (packageInstallsRunning.has(projectId)) return;
    if (!offerForAttempt(ctx, { kind: "missing-packages", projectId, packages })) return;
    if (ctx.origin === "explicit") showMissingPackagesOffer(projectId, packages);
  })();
}

const INSTALLER_NOTICE_PREFIX = "[Oleafly] ";

export function installerNotices(outcome: string): string[] {
  return outcome
    .split("\n")
    .filter((line) => line.startsWith(INSTALLER_NOTICE_PREFIX))
    .map((line) => line.slice(INSTALLER_NOTICE_PREFIX.length).trim())
    .filter((line) => line.length > 0 && line.length <= 400)
    .slice(0, 2);
}

function disarmOnlineRetry(): void {
  if (!onlineRetry) return;
  window.removeEventListener("online", onlineRetry.listener);
  onlineRetry = null;
}

function armOnlineRetry(projectId: string): void {
  if (typeof window === "undefined" || onlineRetry?.projectId === projectId) return;
  disarmOnlineRetry();
  const listener = () => {
    disarmOnlineRetry();
    if (useFilesStore.getState().projectId === projectId) {
      void useCompileStore.getState().recompile({ origin: "automatic" });
    }
  };
  window.addEventListener("online", listener);
  onlineRetry = { projectId, listener };
}

function reportBundleFetchFailure(ctx: CompileApplyContext): void {
  const { projectId } = ctx;
  const message = i18n.t(($) => $.core.compile.bundleFetchFailed);
  ctx.set((state) =>
    state.status === "error" &&
    state.lastAttemptIdentity?.requestGeneration === ctx.requestIdentity.requestGeneration
      ? { failureReason: message }
      : state,
  );
  armOnlineRetry(projectId);
  if (ctx.origin !== "explicit") return;
  const id = toast.errorUnique(
    `compile-retry:${projectId}`,
    message,
    {
      label: i18n.t(($) => $.core.compile.retry),
      onClick: () => {
        if (useFilesStore.getState().projectId !== projectId) return;
        void useCompileStore.getState().recompile();
      },
    },
    true,
  );
  bundleRetryToasts.set(projectId, id);
}

function engineGapFindings(
  projectId: string,
  classified: ImportCompatFinding[],
  errors: CompileError[],
): ImportCompatFinding[] {
  if (classified.length > 0) return classified;
  const scanned = projectCompatibilityFindings(projectId);
  if (scanned.length > 0) return scanned;
  const classFileError = errors.some(
    (error) =>
      error.kind === "error" && /\.(cls|sty|bbx|cbx|def|ldf)$/i.test(error.file ?? ""),
  );
  return classFileError ? [importCompatFinding("class-compat")] : [];
}

function maybeOfferEngineChoice(
  ctx: CompileApplyContext,
  log: string,
  errors: CompileError[],
  opening: boolean,
): void {
  const files = useFilesStore.getState();
  if (files.engine.id !== "latex" || files.projectId !== ctx.projectId) return;
  const classified = classifyCompileFailure(log, { bundledEngine: true });
  const fetchFailed = classified.some((finding) => importCompatAction(finding.id) === "retry-compile");
  if (fetchFailed && projectCompatibilityFindings(ctx.projectId).length === 0) {
    reportBundleFetchFailure(ctx);
    return;
  }
  const engineFindings = classified.filter(
    (finding) => importCompatAction(finding.id) !== "retry-compile",
  );
  const findings = engineGapFindings(ctx.projectId, engineFindings, errors);
  if (findings.length === 0 || engineHintDismissed(ctx.projectId, findings)) return;
  if (!offerForAttempt(ctx, { kind: "engine-gap", projectId: ctx.projectId, findings })) return;
  if (ctx.origin === "explicit" || opening) {
    useEnginePickerStore.getState().openPicker("compile-failure", findings);
  }
}

export function acceptCompileOffer(offer: CompileOffer): void {
  if (useFilesStore.getState().projectId !== offer.projectId) return;
  if (offer.kind === "engine-gap") {
    useEnginePickerStore.getState().openPicker("compile-failure", offer.findings);
  } else if (offer.kind === "typst-version-missing") {
    void downloadMissingTypst(offer.projectId, offer.version);
  } else {
    installOfferedPackages(offer.projectId, offer.packages);
  }
}

function typstMissingMessage(version: string): string {
  return i18n.t(($) => $.core.compile.typstMissing, { version });
}

export async function downloadMissingTypst(projectId: string, version: string): Promise<void> {
  if (useFilesStore.getState().projectId !== projectId) return;
  const { useTypstToolchainStore } = await import("@/store/typst-toolchain");
  const installed = await useTypstToolchainStore.getState().installVersion(version);
  if (!installed || useFilesStore.getState().projectId !== projectId) return;
  clearOffer(projectId);
  void useCompileStore.getState().recompile();
}

export async function switchToDefaultTypst(projectId: string): Promise<void> {
  const files = useFilesStore.getState();
  if (files.projectId !== projectId) return;
  try {
    await files.setTypstVersion(null);
  } catch (error) {
    void logError("use the default Typst version", error);
    if (useFilesStore.getState().projectId !== projectId) return;
    toast.errorUnique(
      engineSwitchToastKey(projectId),
      decodeAppError(error)
        ? describeError(error)
        : i18n.t(($) => $.shell.compile.typstVersion.switchFailed),
    );
    return;
  }
  if (useFilesStore.getState().projectId !== projectId) return;
  clearOffer(projectId);
  void useCompileStore.getState().recompile();
}

function settleCompileNotices(projectId: string): void {
  if (onlineRetry?.projectId === projectId) disarmOnlineRetry();
  dismissOwnedToast(bundleRetryToasts, projectId);
  if (!packageInstallsRunning.has(projectId)) dismissOwnedToast(missingPackageToasts, projectId);
}

export async function saveActiveForCompile(
  files: ReturnType<typeof useFilesStore.getState>,
): Promise<void> {
  try {
    await files.saveActive();
  } catch (error) {
    if (!String(error).includes(MUTATION_CONFLICT)) throw error;
    await useFilesStore.getState().saveActive();
  }
}

export function clearFolderPause(): void {
  const paused = i18n.t(($) => $.core.folderUnavailable.compile);
  useCompileStore.setState((state) =>
    state.status === "unavailable" && state.failureReason === paused
      ? { status: "idle", phase: "idle", failureReason: null }
      : state,
  );
}

export function reportCompileSaveFailure(
  scope: string,
  files: ReturnType<typeof useFilesStore.getState>,
  error: unknown,
  explicit = false,
): void {
  if (files.projectId && files.activePath) {
    reportFileSaveFailure(scope, files.projectId, files.activePath, error, explicit);
  } else {
    void logError(scope, error);
  }
}

export function stopOutdatedAutomaticCompile(editedAt: number, now = Date.now()): boolean {
  const { status, phase, compileTimeMs } = useCompileStore.getState();
  if (status !== "compiling" || phase !== "building") return false;
  if (runningOrigin !== "automatic" || runningIsRestart || outdatedStopRequested) return false;
  if (runningSnapshotAt >= editedAt) return false;
  if (compileTimeMs && now - runningSnapshotAt >= compileTimeMs * NEARLY_DONE_SHARE) return false;
  outdatedStopRequested = true;
  nextIsRestart = true;
  clearQueuedRerun();
  void cancelCompile().catch((error: unknown) => logError("stop compile", error));
  return true;
}

export function stopRunningCompileQuietly(): boolean {
  if (useCompileStore.getState().status !== "compiling") return false;
  clearQueuedRerun();
  void cancelCompile().catch((error: unknown) => logError("stop compile", error));
  return true;
}

function compileWhenEngineLoads(projectId: string, origin: CompileOrigin): void {
  engineLoadWait?.();
  let unsubscribe = () => {};
  const finish = () => {
    unsubscribe();
    if (engineLoadWait === finish) engineLoadWait = null;
  };
  unsubscribe = useFilesStore.subscribe((state) => {
    if (state.projectId !== projectId || state.engineError) {
      finish();
      return;
    }
    if (!state.engineLoaded) return;
    finish();
    if (activeCompileIntent === null && useCompileStore.getState().status !== "compiling") {
      void useCompileStore.getState().recompile({ origin });
    }
  });
  engineLoadWait = finish;
}

type CompileSet = StoreApi<CompileState>["setState"];
type CompileGet = StoreApi<CompileState>["getState"];
type CheckpointAdvanced = (current?: CompileSuccessCheckpoint | null) => boolean;

interface CompileGateContext {
  readonly set: CompileSet;
  readonly get: CompileGet;
  readonly files: ReturnType<typeof useFilesStore.getState>;
  readonly capturedProjectId: string | null;
  readonly mainDoc: string;
  readonly intent: number;
  readonly origin: CompileOrigin;
  readonly matchesProjectAndMain: () => boolean;
  readonly checkpointAdvanced: CheckpointAdvanced;
  readonly abortIntent: () => void;
}

function gateAttemptIdentity(ctx: CompileGateContext): CompileRequestIdentity | null {
  return ctx.capturedProjectId
    ? identityForGeneration(ctx.capturedProjectId, ctx.mainDoc, ctx.intent)
    : null;
}

function setCompileUnavailable(ctx: CompileGateContext, failureReason: string): void {
  ctx.set({
    status: "unavailable",
    phase: "idle",
    failureReason,
    lastAttemptIdentity: gateAttemptIdentity(ctx),
  });
}

function mainDecisionAllows(origin: CompileOrigin, decision: MainDecision): boolean {
  if (origin === "explicit") return true;
  if (origin === "agent") return agentCompileAllowed(decision);
  return automaticCompileAllowed(decision);
}

function mainDecisionGate(ctx: CompileGateContext): boolean {
  if (mainDecisionAllows(ctx.origin, ctx.files.mainDecision)) return true;
  ctx.abortIntent();
  return false;
}

function folderAvailableGate(ctx: CompileGateContext): boolean {
  if (projectFolderAvailable(ctx.capturedProjectId)) return true;
  setCompileUnavailable(ctx, i18n.t(($) => $.core.folderUnavailable.compile));
  ctx.abortIntent();
  return false;
}

function mainDocumentGate(ctx: CompileGateContext): boolean {
  if (!mainDocumentMissing(ctx.files)) return true;
  setCompileUnavailable(ctx, i18n.t(($) => $.shell.openedFolder.noMain));
  ctx.abortIntent();
  return false;
}

function compileIdentityGate(ctx: CompileGateContext): boolean {
  if (ctx.matchesProjectAndMain() && !ctx.checkpointAdvanced()) return true;
  ctx.abortIntent();
  return false;
}

function engineLoadedGate(ctx: CompileGateContext): boolean {
  if (ctx.files.engineLoaded) return true;
  const reason = ctx.files.engineError
    ? engineErrorMessage(ctx.files.engineError)
    : i18n.t(($) => $.core.engine.error.stillLoading);
  setCompileUnavailable(ctx, reason);
  if (ctx.files.engineError) void logError("compile", reason);
  else if (ctx.capturedProjectId) compileWhenEngineLoads(ctx.capturedProjectId, ctx.origin);
  ctx.abortIntent();
  return false;
}

function typstVersionGate(ctx: CompileGateContext): boolean {
  const missing = ctx.files.engine.typst_missing;
  if (!missing || !ctx.capturedProjectId) return true;
  ctx.set({
    status: "unavailable",
    phase: "idle",
    failureReason: typstMissingMessage(missing),
    lastAttemptIdentity: gateAttemptIdentity(ctx),
    offer: { kind: "typst-version-missing", projectId: ctx.capturedProjectId, version: missing },
  });
  ctx.abortIntent();
  return false;
}

async function pandocPrerequisiteGate(ctx: CompileGateContext): Promise<boolean> {
  if (ctx.files.engine.capabilities.compiler_prerequisite !== "pandoc") return true;
  try {
    if (!(await ensurePandoc({ notify: ctx.origin === "explicit" }))) {
      setCompileUnavailable(
        ctx,
        "Pandoc is required for this document engine and is not available.",
      );
      ctx.abortIntent();
      return false;
    }
  } catch (e) {
    setCompileUnavailable(ctx, `Pandoc setup failed: ${String(e)}`);
    void logError("Pandoc setup", e);
    ctx.abortIntent();
    return false;
  }
  return compileIdentityGate(ctx);
}

async function systemTexPrerequisiteGate(ctx: CompileGateContext): Promise<boolean> {
  if (ctx.files.engine.capabilities.compiler_prerequisite !== "system_tex") return true;
  // A TinyTeX install may be in flight: queue this compile behind it
  // instead of failing with "latexmk not found". The engine store runs
  // the queued compile the moment the install lands.
  const engineModule = await import("@/store/engine");
  const engineStore = engineModule.useEngineStore.getState();
  if (engineStore.installing) {
    engineStore.queueCompileAfterInstall(ctx.origin);
    setCompileUnavailable(
      ctx,
      "TinyTeX is still downloading. This compile starts automatically when it finishes.",
    );
    ctx.abortIntent();
    return false;
  }
  return compileIdentityGate(ctx);
}

const TYPST_SOURCE_PATH = /\.typ$/i;

function formatsBeforeCompileSave(ctx: CompileGateContext): boolean {
  const path = useFilesStore.getState().activePath;
  return Boolean(
    ctx.origin === "explicit" &&
      path &&
      TYPST_SOURCE_PATH.test(path) &&
      useSettingsStore.getState().typstFormatOnSave,
  );
}

async function formatActiveFileBeforeCompileSave(): Promise<void> {
  try {
    const { formatActiveBeforeSave } = await import(
      "@/components/editor/cm/language-service-format"
    );
    await formatActiveBeforeSave();
  } catch (error) {
    void logError("format before save", error);
  }
}

async function saveBeforeCompileGate(ctx: CompileGateContext): Promise<boolean> {
  if (formatsBeforeCompileSave(ctx)) await formatActiveFileBeforeCompileSave();
  try {
    await saveActiveForCompile(ctx.files);
  } catch (e) {
    if (ctx.capturedProjectId && reportLocationError(ctx.capturedProjectId, e)) {
      setCompileUnavailable(ctx, i18n.t(($) => $.core.folderUnavailable.compile));
      ctx.abortIntent();
      return false;
    }
    ctx.set({
      status: "error",
      phase: "idle",
      failureReason: `The document could not be saved before compiling: ${String(e)}`,
      lastAttemptIdentity: gateAttemptIdentity(ctx),
    });
    ctx.abortIntent();
    reportCompileSaveFailure("save before compile", ctx.files, e, ctx.origin === "explicit");
    return false;
  }
  return compileIdentityGate(ctx);
}

function syntaxCheckLog(mainDoc: string, syntaxErrors: readonly CompileError[]): string {
  return `Syntax check found ${syntaxErrors.length} error${
    syntaxErrors.length === 1 ? "" : "s"
  } in ${mainDoc}; the compiler was not run.\n${syntaxErrors
    .map((error) => `${mainDoc}:${error.line ?? 0}: ${error.message}`)
    .join("\n")}\n`;
}

async function syntaxCheckGate(ctx: CompileGateContext, projectId: string): Promise<boolean> {
  if (!ctx.get().checkSyntaxBeforeCompile) return true;
  const { engine } = ctx.files;
  if (!compileSettingsForEngine(engine).syntaxCheck || !pathUsesEngineSource(engine, ctx.mainDoc)) {
    return true;
  }
  // Runs after the save so it reads exactly the source the compiler would.
  let syntaxErrors: CompileError[] = [];
  try {
    syntaxErrors = await mainDocumentSyntaxErrors(projectId, ctx.mainDoc);
  } catch {
    // The checker is an optimization, never a gate of its own: if the
    // source cannot be read here, let the compiler report the real problem.
    syntaxErrors = [];
  }
  if (!compileIdentityGate(ctx)) return false;
  if (syntaxErrors.length === 0) return true;
  ctx.set({
    status: "error",
    phase: "idle",
    errors: syntaxErrors,
    failureReason:
      "Syntax check found errors. Fix them, or turn off “Check syntax before compile”.",
    log: syntaxCheckLog(ctx.mainDoc, syntaxErrors),
    lastAttemptIdentity: identityForGeneration(projectId, ctx.mainDoc, ctx.intent),
  });
  ctx.abortIntent();
  return false;
}

async function clearBuildDirGate(
  ctx: CompileGateContext,
  projectId: string,
  fromScratch: boolean | undefined,
): Promise<boolean> {
  if (!fromScratch) return true;
  try {
    await clearBuildDir(projectId);
  } catch (error) {
    notifyError("clear build directory", error);
    ctx.abortIntent();
    return false;
  }
  return compileIdentityGate(ctx);
}

async function runCompileGates(
  ctx: CompileGateContext,
  options: RecompileOptions | undefined,
): Promise<string | null> {
  if (!mainDecisionGate(ctx)) return null;
  if (!folderAvailableGate(ctx)) return null;
  if (!mainDocumentGate(ctx)) return null;
  if (!engineLoadedGate(ctx)) return null;
  if (!typstVersionGate(ctx)) return null;
  if (!(await pandocPrerequisiteGate(ctx))) return null;
  if (!(await systemTexPrerequisiteGate(ctx))) return null;
  if (!compileIdentityGate(ctx)) return null;
  const projectId = ctx.capturedProjectId;
  if (!projectId) {
    ctx.abortIntent();
    return null;
  }
  ctx.set({
    status: "compiling",
    phase: "saving",
    errors: [],
    diagnostics: null,
    failureReason: null,
    offer: null,
    lastAttemptIdentity: identityForGeneration(projectId, ctx.mainDoc, ctx.intent),
  });
  if (!(await saveBeforeCompileGate(ctx))) return null;
  if (!(await syntaxCheckGate(ctx, projectId))) return null;
  if (!(await clearBuildDirGate(ctx, projectId, options?.fromScratch))) return null;
  return projectId;
}

async function captureSnapshotIfCurrent(
  projectId: string,
  requestIdentity: CompileRequestIdentity,
): Promise<{ snapshot: CompileSourceSnapshot | null } | null> {
  if (!isCompileRequestIdentityCurrent(requestIdentity)) return null;
  const snapshot = await captureCompileSourceSnapshot(projectId);
  if (!isCompileRequestIdentityCurrent(requestIdentity)) return null;
  return { snapshot };
}

function beginBuildingPhase(
  set: CompileSet,
  args: {
    readonly identityStale: () => boolean;
    readonly checkpointAtStart: CompileSuccessCheckpoint | null;
    readonly requestIdentity: CompileRequestIdentity;
    readonly notice: string | null | undefined;
  },
): boolean {
  let started = false;
  set((state) => {
    if (
      args.identityStale() ||
      hasCompileCheckpointAdvanced(args.checkpointAtStart, state.lastCompileCheckpoint)
    ) {
      return state;
    }
    started = true;
    return {
      status: "compiling",
      phase: "building",
      log: args.notice ? `${args.notice}\n` : "",
      errors: [],
      diagnostics: null,
      lastAttemptIdentity: args.requestIdentity,
      failureReason: null,
    };
  });
  return started;
}

interface CompileLogPump {
  readonly push: (chunk: string) => void;
  readonly flush: () => void;
  readonly dispose: () => void;
}

function createCompileLogPump(
  set: CompileSet,
  get: CompileGet,
  gates: {
    readonly identityStale: () => boolean;
    readonly checkpointAdvanced: CheckpointAdvanced;
    readonly checkpointAtStart: CompileSuccessCheckpoint | null;
  },
): CompileLogPump {
  let pendingLog = "";
  let pendingPhase: CompilePhase | null = null;
  let logFrame: number | null = null;
  const flush = (): void => {
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
        gates.identityStale() ||
        hasCompileCheckpointAdvanced(gates.checkpointAtStart, state.lastCompileCheckpoint)
      ) {
        return state;
      }
      return {
        log: state.log + chunk,
        phase: phase ?? state.phase,
      };
    });
  };
  return {
    push: (chunk) => {
      if (gates.identityStale() || gates.checkpointAdvanced()) return;
      pendingLog += chunk;
      pendingPhase = phaseFromLogChunk(chunk, pendingPhase ?? get().phase);
      logFrame ??= requestAnimationFrame(() => {
        logFrame = null;
        flush();
      });
    },
    flush,
    dispose: () => {
      if (logFrame !== null) cancelAnimationFrame(logFrame);
      pendingLog = "";
      pendingPhase = null;
    },
  };
}

function applyStoppedCompile(set: CompileSet, identityStale: () => boolean): void {
  // A stop is not a failed document: keep the preview and the previous
  // log rather than reporting an error the source did not cause.
  clearQueuedRerun();
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
}

interface CompileApplyContext {
  readonly set: CompileSet;
  readonly get: CompileGet;
  readonly projectId: string;
  readonly mainDoc: string;
  readonly requestIdentity: CompileRequestIdentity;
  readonly checkpointAtStart: CompileSuccessCheckpoint | null;
  readonly identityStale: () => boolean;
  readonly checkpointAdvanced: CheckpointAdvanced;
  readonly offlineNoticePrefix: string;
  readonly compiledSourceSnapshot: CompileSourceSnapshot | null;
  readonly origin: CompileOrigin;
}

function successfulOutputRevision(result: CompileResult): number | null {
  return result.ok &&
    Number.isSafeInteger(result.output_revision) &&
    (result.output_revision ?? 0) > 0
    ? result.output_revision
    : null;
}

function compileResultSuperseded(
  ctx: CompileApplyContext,
  result: CompileResult,
  currentCheckpoint: CompileSuccessCheckpoint | null,
): boolean {
  if (ctx.identityStale()) return true;
  if (!ctx.checkpointAdvanced(currentCheckpoint)) return false;
  const resultRevision = successfulOutputRevision(result);
  if (resultRevision === null) return true;
  return currentCheckpoint !== null && resultRevision <= currentCheckpoint.outputRevision;
}

function verifiedCompileOutput(
  result: CompileResult,
  bytes: Uint8Array | null,
): {
  verifiedBytes: Uint8Array | null;
  verifiedOutputId: string | null;
  outputIdentityError: string;
} {
  const verifiedOutputId =
    bytes && result.output_id && fingerprintCompileOutput(bytes) === result.output_id
      ? result.output_id
      : null;
  const verifiedBytes = verifiedOutputId ? bytes : null;
  const outputIdentityError =
    result.has_pdf && !verifiedBytes
      ? "\nCompiled PDF changed before it could be verified. Keeping the prior preview."
      : "";
  return { verifiedBytes, verifiedOutputId, outputIdentityError };
}

function compileSuccessCheckpointFor(
  ctx: CompileApplyContext,
  result: CompileResult,
  verified: {
    readonly verifiedBytes: Uint8Array | null;
    readonly verifiedOutputId: string | null;
  },
): CompileSuccessCheckpoint | null {
  const successfulRevision = verified.verifiedBytes ? successfulOutputRevision(result) : null;
  if (successfulRevision === null || !verified.verifiedOutputId) return null;
  return createCompileSuccessCheckpoint({
    projectId: ctx.projectId,
    mainDocument: ctx.mainDoc,
    projectRevision: ctx.requestIdentity.projectRevision,
    requestGeneration: ctx.requestIdentity.requestGeneration,
    outputKind: "standard",
    producerId: currentCompileProducerId(),
    outputRevision: successfulRevision,
    outputId: verified.verifiedOutputId,
    previousCompletedAt: ctx.get().lastCompiledAt,
  });
}

const TYPST_PACKAGE_ERROR = /\bpackage\b/;

async function explainedErrors(result: CompileResult): Promise<CompileError[]> {
  const errors = explainCodedCompileErrors(result.errors);
  if (
    useFilesStore.getState().engine.id !== "typst" ||
    !errors.some((error) => TYPST_PACKAGE_ERROR.test(error.message))
  ) {
    return errors;
  }
  try {
    const { explainTypstPackageErrors } = await import("@/lib/typst-package-errors");
    const offline =
      useSettingsStore.getState().offline ||
      (typeof navigator !== "undefined" && navigator.onLine === false);
    return explainTypstPackageErrors(errors, offline);
  } catch {
    return errors;
  }
}

function settleAlreadyShownOutput(
  ctx: CompileApplyContext,
  result: CompileResult,
  currentCheckpoint: CompileSuccessCheckpoint | null,
): boolean {
  if (!result.ok || !currentCheckpoint) return false;
  if (
    result.output_revision !== currentCheckpoint.outputRevision ||
    result.output_id !== currentCheckpoint.outputId
  ) {
    return false;
  }
  ctx.set((state) =>
    ctx.identityStale() ||
    state.status !== "compiling" ||
    state.lastAttemptIdentity?.requestGeneration !== ctx.requestIdentity.requestGeneration
      ? state
      : {
          status: "success",
          phase: "idle",
          failureReason: null,
          errors: result.errors,
          diagnostics: result.diagnostics ?? null,
          log: `${ctx.offlineNoticePrefix}${result.log}`,
        },
  );
  return true;
}

async function applyCompileResult(
  ctx: CompileApplyContext,
  result: CompileResult,
): Promise<CompileResult> {
  const currentCheckpoint = ctx.get().lastCompileCheckpoint;
  if (compileResultSuperseded(ctx, result, currentCheckpoint)) return result;
  if (settleAlreadyShownOutput(ctx, result, currentCheckpoint)) return result;
  // Wrap the IPC ArrayBuffer as a view (no copy of the payload bytes). Read
  // whenever a PDF exists, even on error: Tectonic's continue-on-errors mode
  // still produces a best-effort PDF, and we want to keep showing it.
  const buf = result.has_pdf ? await readCompiledPdf(ctx.projectId) : null;
  const bytes = buf ? new Uint8Array(buf) : null;
  const errors = await explainedErrors(result);
  if (ctx.identityStale()) return result;
  const verified = verifiedCompileOutput(result, bytes);
  const checkpoint = compileSuccessCheckpointFor(ctx, result, verified);
  let applied = false;
  ctx.set((state) => {
    if (
      ctx.identityStale() ||
      !canApplyLocalCompileOutcome(
        checkpoint,
        state.lastCompileCheckpoint,
        ctx.checkpointAtStart,
      )
    ) {
      return state;
    }
    applied = true;
    return {
      status: checkpoint ? "success" : "error",
      phase: "idle",
      pdfBytes: verified.verifiedBytes ?? state.pdfBytes,
      failureReason: checkpoint
        ? null
        : verified.outputIdentityError.trim() ||
          "Compilation did not produce a valid current PDF.",
      errors,
      diagnostics: result.diagnostics ?? null,
      log: `${ctx.offlineNoticePrefix}${result.log}${verified.outputIdentityError}`,
      lastCompiledAt: checkpoint?.completedAt ?? state.lastCompiledAt,
      lastCompileCheckpoint: checkpoint ?? state.lastCompileCheckpoint,
      compiledSources: checkpoint ? ctx.compiledSourceSnapshot : state.compiledSources,
      compileTimeMs: checkpoint ? (result.compile_time_ms ?? 0) : state.compileTimeMs,
    };
  });
  if (!applied) return result;
  const opening = takeEngineChoiceOnOpen(ctx.projectId);
  if (checkpoint) {
    settleCompileNotices(ctx.projectId);
  } else {
    maybeOfferEngineChoice(ctx, result.log, result.errors, opening);
    maybeSuggestMissingPackages(ctx, result.log);
  }
  // Tell detached windows (PDF preview, other OS windows) to reload.
  void import("@/lib/preview-window")
    .then((module) =>
      module.refreshPreviewWindow({
        identity: ctx.requestIdentity,
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
  }
  return result;
}

export interface TypstLiveResult {
  readonly projectId: string;
  readonly mainDocument: string;
  readonly projectRevision: number;
  readonly result: CompileResult;
}

export async function applyTypstLiveResult(live: TypstLiveResult): Promise<boolean> {
  const { projectId, mainDocument, result } = live;
  const stillWanted = () => {
    const files = useFilesStore.getState();
    return (
      files.projectId === projectId &&
      files.engine.source_format === "typst" &&
      resolveEffectiveMainDoc().mainDoc === mainDocument
    );
  };
  if (!stillWanted()) return false;
  if (!result.ok && activeCompileIntent !== null) return false;
  const checkpointAtStart = useCompileStore.getState().lastCompileCheckpoint;
  const ctx: CompileApplyContext = {
    set: useCompileStore.setState,
    get: useCompileStore.getState,
    projectId,
    mainDoc: mainDocument,
    requestIdentity: {
      projectId,
      mainDocument,
      projectRevision: live.projectRevision,
      requestGeneration: compileIntentGeneration,
    },
    checkpointAtStart,
    identityStale: () => !stillWanted(),
    checkpointAdvanced: (current = useCompileStore.getState().lastCompileCheckpoint) =>
      hasCompileCheckpointAdvanced(checkpointAtStart, current),
    offlineNoticePrefix: "",
    compiledSourceSnapshot: null,
    origin: "automatic",
  };
  await applyCompileResult(ctx, result);
  return true;
}

async function compileThroughLivePreview(
  projectId: string,
  mainDoc: string,
  offline: boolean,
  typstVariant: string | null,
  fresh: boolean,
): Promise<CompileResult> {
  const module = await loadLivePreview();
  return module.compileLive({ projectId, mainDoc, offline, typstVariant, fresh });
}

function pauseCompileForMissingFolder(ctx: CompileApplyContext, e: unknown): void {
  const paused = i18n.t(($) => $.core.folderUnavailable.compile);
  ctx.set((state) =>
    ctx.identityStale() ||
    hasCompileCheckpointAdvanced(ctx.checkpointAtStart, state.lastCompileCheckpoint)
      ? state
      : { status: "unavailable", phase: "idle", failureReason: paused },
  );
  void import("@/lib/preview-window")
    .then((module) =>
      module.refreshPreviewWindow({
        identity: ctx.requestIdentity,
        status: "unavailable",
        checkpoint: null,
        message: paused,
      }),
    )
    .catch(() => {});
  void import("@/lib/log").then(({ logError }) => logError("compile", e));
}

function reportMissingTypst(ctx: CompileApplyContext, version: string, e: unknown): void {
  const message = typstMissingMessage(version);
  ctx.set((state) => {
    if (
      ctx.identityStale() ||
      hasCompileCheckpointAdvanced(ctx.checkpointAtStart, state.lastCompileCheckpoint)
    ) {
      return state;
    }
    return {
      status: "unavailable",
      phase: "idle",
      failureReason: message,
      offer: { kind: "typst-version-missing", projectId: ctx.projectId, version },
    };
  });
  void import("@/lib/preview-window")
    .then((module) =>
      module.refreshPreviewWindow({
        identity: ctx.requestIdentity,
        status: "unavailable",
        checkpoint: null,
        message,
      }),
    )
    .catch(() => {});
  void logError("compile", e);
  if (useFilesStore.getState().projectId === ctx.projectId) {
    void useFilesStore.getState().refreshEngine();
  }
}

function handleCompileException(ctx: CompileApplyContext, e: unknown): void {
  const appError = decodeAppError(e);
  const missingTypst = appError?.code === TYPST_VERSION_MISSING ? appError.params.version : undefined;
  if (missingTypst) {
    reportMissingTypst(ctx, missingTypst, e);
    return;
  }
  const message = appError ? describeError(e) : String(e);
  ctx.set((state) => {
    if (
      ctx.identityStale() ||
      hasCompileCheckpointAdvanced(ctx.checkpointAtStart, state.lastCompileCheckpoint)
    ) {
      return state;
    }
    return {
      status: "error",
      phase: "idle",
      log: `${ctx.offlineNoticePrefix}Compile failed: ${message}`,
      failureReason: `Compile failed: ${message}`,
    };
  });
  void import("@/lib/preview-window")
    .then((module) =>
      module.refreshPreviewWindow({
        identity: ctx.requestIdentity,
        status: "error",
        checkpoint: null,
        message: `Compile failed: ${message}`,
      }),
    )
    .catch(() => {});
  void import("@/lib/log").then(({ logError }) => logError("compile", e));
}

function clearOrphanedCompilingState(
  set: CompileSet,
  requestIdentity: CompileRequestIdentity,
  checkpointAtStart: CompileSuccessCheckpoint | null,
): void {
  // A same-project main-document switch does not run the project-reset
  // effect. Clear only this attempt's orphaned "compiling" indicator;
  // never replace a success checkpoint that arrived while it was active.
  set((state) => {
    if (
      state.status !== "compiling" ||
      state.lastAttemptIdentity?.requestGeneration !== requestIdentity.requestGeneration ||
      hasCompileCheckpointAdvanced(checkpointAtStart, state.lastCompileCheckpoint)
    ) {
      return state;
    }
    return {
      status: "idle",
      phase: "idle",
      failureReason: "The compile was superseded by a newer project revision.",
    };
  });
}

function finishCompileAttempt(args: {
  readonly set: CompileSet;
  readonly get: CompileGet;
  readonly intent: number;
  readonly requestIdentity: CompileRequestIdentity;
  readonly checkpointAtStart: CompileSuccessCheckpoint | null;
  readonly identityStale: () => boolean;
  readonly releaseIntent: () => void;
}): void {
  const ownsIntent = activeCompileIntent === args.intent;
  if (ownsIntent && args.identityStale()) {
    clearOrphanedCompilingState(args.set, args.requestIdentity, args.checkpointAtStart);
  }
  args.releaseIntent();
  if (ownsIntent && rerunQueued) {
    const origin = rerunOrigin;
    clearQueuedRerun();
    if (!args.identityStale()) void args.get().recompile({ origin });
  }
}

export const useCompileStore = create<CompileState>((set, get) => ({
  status: "idle",
  phase: "idle",
  log: "",
  errors: [],
  diagnostics: null,
  pdfBytes: null,
  lastAttemptIdentity: null,
  failureReason: null,
  lastCompiledAt: null,
  lastCompileCheckpoint: null,
  compiledSources: null,
  compileTimeMs: null,
  offer: null,
  autoCompile: readStoredFlag(AUTO_COMPILE_KEY, false),
  setAutoCompile: (v) => {
    storeFlag(AUTO_COMPILE_KEY, v);
    set({ autoCompile: v });
    syncTypstLivePreview();
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
    clearQueuedRerun();
    try {
      await cancelCompile();
    } catch (error) {
      notifyError("stop compile", error);
    }
    await interruptTypstLivePreview();
  },
  reset: () => {
    compileSeq++;
    clearQueuedRerun();
    forgetOutdatedStops();
    activeCompileIntent = null;
    compileIntentGeneration++;
    set({
      status: "idle",
      phase: "idle",
      log: "",
      errors: [],
      diagnostics: null,
      pdfBytes: null,
      lastAttemptIdentity: null,
      failureReason: null,
      lastCompiledAt: null,
      lastCompileCheckpoint: null,
      compiledSources: null,
      compileTimeMs: null,
      offer: null,
    });
  },
  dismissOffer: () => set({ offer: null }),
  livePreview: { projectId: null, enabled: false, status: "off", message: null },
  setLivePreviewStatus: (projectId, status, message = null) => {
    set((state) =>
      state.livePreview.projectId === projectId && state.livePreview.enabled
        ? { livePreview: { ...state.livePreview, status, message } }
        : state,
    );
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
      diagnostics: null,
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
    const origin = options?.origin ?? "explicit";
    if (activeCompileIntent !== null || get().status === "compiling") {
      queueRerun(origin);
      return undefined;
    }
    const intent = ++compileIntentGeneration;
    activeCompileIntent = intent;
    const files = useFilesStore.getState();
    const capturedProjectId = files.projectId;
    const releaseIntent = () => {
      if (activeCompileIntent === intent) activeCompileIntent = null;
    };
    const abortIntent = () => {
      const ownsIntent = activeCompileIntent === intent;
      releaseIntent();
      if (!ownsIntent) return;
      const waitingOrigin = rerunQueued ? rerunOrigin : null;
      clearQueuedRerun();
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
      if (waitingOrigin !== null && useFilesStore.getState().projectId === capturedProjectId) {
        queueMicrotask(() => void get().recompile({ origin: waitingOrigin }));
      }
    };

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

    const projectId = await runCompileGates(
      {
        set,
        get,
        files,
        capturedProjectId,
        mainDoc,
        intent,
        origin,
        matchesProjectAndMain,
        checkpointAdvanced,
        abortIntent,
      },
      options,
    );
    if (projectId === null) return undefined;

    const requestIdentity = identityForGeneration(
      projectId,
      mainDoc,
      intent,
    );
    const captured = await captureSnapshotIfCurrent(projectId, requestIdentity);
    if (captured === null) {
      abortIntent();
      return undefined;
    }
    runningOrigin = origin;
    runningSnapshotAt = Date.now();
    runningIsRestart = nextIsRestart;
    nextIsRestart = false;
    outdatedStopRequested = false;
    const offlinePolicy = compileOfflineForEngine(
      files.engine,
      useSettingsStore.getState().offline,
    );
    const offlineNoticePrefix = offlinePolicy.notice ? `${offlinePolicy.notice}\n` : "";
    const seq = ++compileSeq;
    // True once this compile's result is no longer the one the UI should show
    // (project switched, or a newer compile started).
    const identityStale = () => {
      return seq !== compileSeq || !isCompileOutputStillWanted(requestIdentity);
    };

    const started = beginBuildingPhase(set, {
      identityStale,
      checkpointAtStart,
      requestIdentity,
      notice: offlinePolicy.notice,
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
    const logPump = createCompileLogPump(set, get, {
      identityStale,
      checkpointAdvanced,
      checkpointAtStart,
    });
    const applyContext: CompileApplyContext = {
      set,
      get,
      projectId,
      mainDoc,
      requestIdentity,
      checkpointAtStart,
      identityStale,
      checkpointAdvanced,
      offlineNoticePrefix,
      compiledSourceSnapshot: captured.snapshot,
      origin,
    };
    try {
      return await withEventListener("compile:log", (chunk: string) => logPump.push(chunk), async () => {
        if (identityStale() || checkpointAdvanced()) return undefined;
        const result = livePreviewRoutes(get(), useFilesStore.getState(), projectId)
          ? await compileThroughLivePreview(
              projectId,
              mainDoc,
              offlinePolicy.offline,
              activeTypstVariant(projectId, files.engine),
              origin !== "automatic" || options?.fromScratch === true,
            )
          : await compileProject(
              projectId,
              mainDoc,
              offlinePolicy.offline,
              get().compileMode === "fast",
              get().stopOnFirstError,
              activeTypstVariant(projectId, files.engine),
            );
        logPump.flush();
        if (result.stopped) {
          applyStoppedCompile(set, identityStale);
          return result;
        }
        return await applyCompileResult(applyContext, result);
      });
    } catch (e) {
      if (reportLocationError(projectId, e)) pauseCompileForMissingFolder(applyContext, e);
      else handleCompileException(applyContext, e);
      return undefined;
    } finally {
      logPump.dispose();
      finishCompileAttempt({
        set,
        get,
        intent,
        requestIdentity,
        checkpointAtStart,
        identityStale,
        releaseIntent,
      });
    }
  },
}));
