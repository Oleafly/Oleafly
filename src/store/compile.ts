import { create, type StoreApi } from "zustand";
import {
  collabCompileBarrier,
  collabProjectShared,
  collabSettingsLocked,
  noteUnreviewedSuggestions,
} from "@/lib/collab-live-bridge";
import {
  cancelCompile,
  clearBuildDir,
  compileProject,
  latexEngineInfo,
  readCompiledPdf,
  readFileContent,
  tlmgrInstall,
  tlmgrInstallMissing,
  validateCompileFingerprint,
  withEventListener,
  type CompileError,
  type CompileResult,
  type DocumentEngineDescriptor,
  type EngineInfo,
  type LogDiagnostic,
  type MainDecision,
  type TexBlocker,
  type TexFlavor,
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
  offlineCacheMiss,
  type ImportCompatFinding,
} from "@oleafly/latex";
import { useProjectAnalysisStore } from "@/store/project-analysis";
import { useSettingsStore } from "@/store/settings";
import { duringPackageOperation, useEngineStore } from "@/store/engine";
import { lintLatexText } from "@oleafly/editor";
import { activeTypstVariant } from "@/store/typst-variant";
import { notifyError, toast } from "@/lib/toast";
import { logError } from "@/lib/log";
import { decodeAppError, describeError } from "@/lib/app-error";
import {
  describeTexBlocker,
  explainCodedCompileErrors,
  TEX_SETUP_CODES,
  texSetupReason,
} from "@/lib/compile-error-codes";
import {
  locationErrorAvailability,
  projectFolderAvailable,
  reportLocationError,
} from "@/store/project-availability";
import { SaveFlushError, codedSaveFailure } from "@/store/save-flush-error";
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
import { compiledHtmlOutput } from "@/lib/notebook-engines";
import type { NotebookTool } from "@/lib/notebook-commands";

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

export function compileLogCleared(state: Pick<CompileState, "clearedLog" | "log">): boolean {
  return state.clearedLog !== null && state.clearedLog === state.log;
}

export interface CompiledHtmlOutput {
  readonly projectId: string;
  readonly path: string;
  readonly builtAt: number;
}

export interface CompileState {
  status: CompileStatus;
  phase: CompilePhase;
  log: string;
  clearedLog: string | null;
  clearLog: () => void;
  errors: CompileError[];
  diagnostics: LogDiagnostic[] | null;
  pdfBytes: Uint8Array | null;
  lastAttemptIdentity: CompileRequestIdentity | null;
  failureReason: string | null;
  lastCompiledAt: number | null;
  lastCompileCheckpoint: CompileSuccessCheckpoint | null;
  compiledSources: CompileSourceSnapshot | null;
  compileTimeMs: number | null;
  htmlOutput: CompiledHtmlOutput | null;
  autoCompile: boolean;
  setAutoCompile: (v: boolean) => void;
  compileMode: CompileMode;
  setCompileMode: (mode: CompileMode) => void;
  checkSyntaxBeforeCompile: boolean;
  setCheckSyntaxBeforeCompile: (check: boolean) => void;
  stopOnFirstError: boolean;
  setStopOnFirstError: (stop: boolean) => void;
  stopCompile: () => Promise<void>;
  reset: () => void;
  recompile: (options?: RecompileOptions) => Promise<CompileResult | undefined>;
  offer: CompileOffer | null;
  dismissOffer: () => void;
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
      files.engine.id === "typst" &&
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
    files.engine.id === "typst"
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

async function mainDocumentSyntaxErrors(
  projectId: string,
  mainDoc: string,
): Promise<CompileError[]> {
  const source = await readFileContent(projectId, mainDoc);
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
    }
  | {
      readonly kind: "notebook-tool-missing";
      readonly projectId: string;
      readonly tool: NotebookTool;
    }
  | {
      readonly kind: "tex-missing";
      readonly projectId: string;
    }
  | {
      readonly kind: "tex-packages";
      readonly projectId: string;
      readonly packages: string[];
    }
  | {
      readonly kind: "switch-compiler";
      readonly projectId: string;
      readonly compiler: TexFlavor;
      readonly label: string;
    };

const TYPST_VERSION_MISSING = "typst_version_missing";
const UNICODE_ENGINE_CODE = "tex.needs_unicode_engine";
const INDEX_GAP_CODES: ReadonlySet<string> = new Set([
  "tex.index_needs_latexmk",
  "tex.glossary_needs_latexmk",
]);
const JAPANESE_COMPILER_INSTALLABLE = "tex.japanese_compiler_installable";
const T1_ENCODING_CODE = "tex.t1_fontenc_unicode_engine";
const BUNDLED_FONT_CODE = "tex.font_in_bundle";
const FONTSPEC_ERROR_PREFIX = "Package fontspec Error:";
const NOTEBOOK_CODE_NEEDED = "notebook.code_needed";
const NOTEBOOK_TOOL_MISSING: ReadonlyMap<string, NotebookTool> = new Map([
  ["notebook.quarto_missing", "quarto"],
  ["notebook.quarto_outdated", "quarto"],
  ["notebook.calepin_missing", "calepin"],
]);
const QUARTO_NEEDS_TEX = "notebook.quarto_needs_tex";

const offeredPackageSets = new Map<string, Set<string>>();
const packageInstallsRunning = new Set<string>();
const missingPackageToasts = new Map<string, number>();
const lostTextToasts = new Map<string, number>();
const bundleRetryToasts = new Map<string, number>();
let onlineRetry: { readonly projectId: string; readonly listener: () => void } | null = null;
let engineLoadWait: (() => void) | null = null;

const MUTATION_CONFLICT = "mutation conflict at generation";
const LOST_TEXT_CODE = "tex.missing_characters";
const LOST_TEXT_CJK_PACKAGE_CODE = "tex.missing_characters_cjk_package";
const LOST_TEXT_SIGNATURE = "lost-text";
const USER_TREE_NOTICE =
  /^The system TeX tree is not writable, so the packages went into your personal tree at (.+?)\.?$/;

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

function lostTextToastKey(projectId: string): string {
  return `lost-text:${projectId}`;
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

function offerForAttempt(
  ctx: CompileApplyContext,
  offer: CompileOffer,
  status: "error" | "success" = "error",
): boolean {
  let recorded = false;
  ctx.set((state) => {
    if (
      state.status !== status ||
      state.lastAttemptIdentity?.requestGeneration !== ctx.requestIdentity.requestGeneration
    ) {
      return state;
    }
    recorded = true;
    return { offer };
  });
  return recorded;
}

async function installMissingPackages(
  projectId: string,
  packages: string[],
  install: (names: string[]) => Promise<string>,
): Promise<void> {
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
    const outcome = await duringPackageOperation(() => install(packages));
    await useEngineStore.getState().refreshPackages();
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

export function installOfferedPackages(
  projectId: string,
  packages: string[],
  install: (names: string[]) => Promise<string> = tlmgrInstallMissing,
): void {
  if (packageInstallsRunning.has(projectId) || !isLatexmkProject(projectId)) return;
  packageInstallsRunning.add(projectId);
  clearOffer(projectId);
  void installMissingPackages(projectId, packages, install).finally(() => {
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

function systemPackagesHint(manager: string, packages: string[]): string {
  if (manager === "dnf") {
    const provides = packages.map((file) => `'tex(${file})'`).join(" ");
    return i18n.t(($) => $.core.missingPackages.systemHint.dnf, { command: `sudo dnf install ${provides}` });
  }
  return i18n.t(($) => $.core.missingPackages.systemHint.apt, { name: packages[0] });
}

function showSystemPackagesNotice(projectId: string, packages: string[], info: EngineInfo): void {
  const manager = info.system_package_manager;
  if (!manager) return;
  const message = i18n.t(($) => $.core.missingPackages.systemManaged, {
    count: packages.length,
    name: packages[0],
    names: formatList(packages),
    hint: systemPackagesHint(manager, packages),
  });
  const installTinytex = {
    label: i18n.t(($) => $.settings.engine.tinytex.download),
    onClick: () => void installMissingTex(projectId),
  };
  toast.infoUnique(missingPackagesToastKey(projectId), message, info.tex_complete ? undefined : installTinytex, true);
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
    const info = await latexEngineInfo().catch(() => null);
    if (!info || !isLatexmkProject(projectId)) return;
    if (!info.tlmgr) {
      if (ctx.origin === "explicit") showSystemPackagesNotice(projectId, packages, info);
      return;
    }
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

function reportOfflineCacheMiss(ctx: CompileApplyContext, missing: readonly string[]): void {
  const { projectId } = ctx;
  const message =
    missing.length > 0
      ? i18n.t(($) => $.core.compile.offlineNotCached, { files: formatList(missing) })
      : i18n.t(($) => $.core.compile.offlineNotCachedUnnamed);
  ctx.set((state) =>
    state.status === "error" &&
    state.lastAttemptIdentity?.requestGeneration === ctx.requestIdentity.requestGeneration
      ? { failureReason: message }
      : state,
  );
  if (ctx.origin !== "explicit") return;
  const id = toast.errorUnique(
    `compile-retry:${projectId}`,
    message,
    {
      label: i18n.t(($) => $.core.compile.goOnlineAndCompile),
      onClick: () => {
        if (useFilesStore.getState().projectId !== projectId) return;
        useSettingsStore.getState().setOffline(false);
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

function onlyBundledFontErrors(errors: readonly CompileError[]): boolean {
  const fontErrors = errors.filter((error) => error.message.startsWith(FONTSPEC_ERROR_PREFIX));
  return fontErrors.length > 0 && fontErrors.every((error) => error.code === BUNDLED_FONT_CODE);
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
  if (ctx.offline && offlineCacheMiss(log, classified)) {
    reportOfflineCacheMiss(ctx, missingLatexFiles(log));
    return;
  }
  const fetchFailed = classified.some((finding) => importCompatAction(finding.id) === "retry-compile");
  if (fetchFailed && projectCompatibilityFindings(ctx.projectId).length === 0) {
    reportBundleFetchFailure(ctx);
    return;
  }
  const bundledFontsOnly = onlyBundledFontErrors(errors);
  const engineFindings = classified.filter(
    (finding) =>
      importCompatAction(finding.id) !== "retry-compile" &&
      !(finding.id === "fontspec" && bundledFontsOnly),
  );
  const findings = engineGapFindings(ctx.projectId, engineFindings, errors);
  if (findings.length === 0 || engineHintDismissed(ctx.projectId, findings)) return;
  if (!offerForAttempt(ctx, { kind: "engine-gap", projectId: ctx.projectId, findings })) return;
  if (ctx.origin === "explicit" || opening) {
    useEnginePickerStore.getState().openPicker("compile-failure", findings);
  }
}

function offerIndexGap(ctx: CompileApplyContext, errors: readonly CompileError[]): void {
  const files = useFilesStore.getState();
  if (files.engine.id !== "latex" || files.projectId !== ctx.projectId) return;
  if (!errors.some((error) => error.code && INDEX_GAP_CODES.has(error.code))) return;
  const findings = [importCompatFinding("glossaries-index")];
  if (engineHintDismissed(ctx.projectId, findings)) return;
  offerForAttempt(ctx, { kind: "engine-gap", projectId: ctx.projectId, findings }, "success");
}

function pdflatexOfferForLostText(
  ctx: CompileApplyContext,
  code: string | null | undefined,
): CompileOffer | null {
  const files = useFilesStore.getState();
  if (code !== LOST_TEXT_CJK_PACKAGE_CODE) return null;
  if (files.engine.id !== "latex" || files.projectId !== ctx.projectId) return null;
  const findings = [importCompatFinding("cjk-pdftex-package")];
  return engineHintDismissed(ctx.projectId, findings)
    ? null
    : { kind: "engine-gap", projectId: ctx.projectId, findings };
}

// A successful compile can still drop text the fonts can't show, and the PDF
// gives no sign of it, so the warning has to come to the user once.
function reportLostText(ctx: CompileApplyContext, errors: CompileError[]): void {
  const warning = errors.find((error) => error.code?.startsWith(LOST_TEXT_CODE));
  if (!warning?.explanation) {
    dismissOwnedToast(lostTextToasts, ctx.projectId);
    forgetOffer(ctx.projectId, LOST_TEXT_SIGNATURE);
    return;
  }
  const offer = pdflatexOfferForLostText(ctx, warning.code);
  const offered = offer !== null && offerForAttempt(ctx, offer, "success");
  if (!rememberOffer(ctx.projectId, LOST_TEXT_SIGNATURE)) return;
  const action = offered
    ? {
        label: i18n.t(($) => $.preview.actions.chooseEngine),
        onClick: () => acceptCompileOffer(offer),
      }
    : undefined;
  lostTextToasts.set(
    ctx.projectId,
    toast.infoUnique(lostTextToastKey(ctx.projectId), warning.explanation, action, true),
  );
}

export function acceptCompileOffer(offer: CompileOffer): void {
  if (useFilesStore.getState().projectId !== offer.projectId) return;
  if (offer.kind === "engine-gap") {
    useEnginePickerStore.getState().openPicker("compile-failure", offer.findings);
  } else if (offer.kind === "typst-version-missing") {
    void downloadMissingTypst(offer.projectId, offer.version);
  } else if (offer.kind === "notebook-tool-missing") {
    void import("@/store/notebook-toolchain").then((module) => module.openNotebookToolSettings(offer.tool));
  } else if (offer.kind === "tex-missing") {
    void installMissingTex(offer.projectId);
  } else if (offer.kind === "tex-packages") {
    installOfferedPackages(offer.projectId, offer.packages, tlmgrInstall);
  } else if (offer.kind === "switch-compiler") {
    void switchEngineAndRecompile(offer.projectId, "latexmk", offer.compiler);
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

function notebookToolMissingMessage(tool: NotebookTool): string {
  return tool === "quarto"
    ? i18n.t(($) => $.errors.notebook.quarto_missing)
    : i18n.t(($) => $.errors.notebook.calepin_missing);
}

export async function installMissingNotebookTool(projectId: string, tool: NotebookTool): Promise<void> {
  if (useFilesStore.getState().projectId !== projectId) return;
  const { useNotebookToolchainStore } = await import("@/store/notebook-toolchain");
  const installed = await useNotebookToolchainStore.getState().install(tool);
  if (!installed || useFilesStore.getState().projectId !== projectId) return;
  clearOffer(projectId);
  void useCompileStore.getState().recompile();
}

export async function installMissingTex(projectId: string): Promise<void> {
  if (useFilesStore.getState().projectId !== projectId) return;
  const engine = useEngineStore.getState();
  engine.queueCompileAfterInstall("explicit");
  await engine.install();
}

export async function switchToTectonic(projectId: string): Promise<void> {
  await switchEngineAndRecompile(projectId, "xetex");
}

async function switchEngineAndRecompile(
  projectId: string,
  ...selection: Parameters<ReturnType<typeof useFilesStore.getState>["setEngine"]>
): Promise<void> {
  const files = useFilesStore.getState();
  if (files.projectId !== projectId) return;
  try {
    await files.setEngine(...selection);
  } catch (error) {
    void logError("switch compile engine", error);
    if (useFilesStore.getState().projectId !== projectId) return;
    toast.errorUnique(
      engineSwitchToastKey(projectId),
      decodeAppError(error) ? describeError(error) : i18n.t(($) => $.shell.enginePicker.switchFailed),
    );
    return;
  }
  if (useFilesStore.getState().projectId !== projectId) return;
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

async function saveAllDirtyRetryingConflicts(): Promise<void> {
  try {
    await useFilesStore.getState().saveAllDirty();
  } catch (error) {
    if (!String(error).includes(MUTATION_CONFLICT)) throw error;
    await useFilesStore.getState().saveAllDirty();
  }
}

function filesTheCompileReads(projectId: string | null, mainDoc: string): Set<string> | null {
  const graph = useIndexStore.getState().intelligenceState?.data;
  if (!graph || !projectId || graph.identity.projectId !== projectId) return null;
  const reads = new Set([mainDoc]);
  const pending = [mainDoc];
  for (let from = pending.pop(); from !== undefined; from = pending.pop()) {
    for (const edge of graph.hierarchy.edges) {
      if (edge.fromFile !== from) continue;
      for (const target of edge.targetFile ? [edge.targetFile] : edge.candidateFiles) {
        if (reads.has(target)) continue;
        reads.add(target);
        if (edge.kind === "include" || edge.kind === "import") pending.push(target);
      }
    }
  }
  return reads;
}

// The graph has no edge for files an engine finds by name: LaTeX packages,
// classes and bibliography styles, data that Typst code loads, Markdown
// filters and styles. A file with one of these extensions counts as read by
// the build even when the graph doesn't list it.
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "svg", "webp", "eps", "bmp", "tif", "tiff"];
const BUILD_READ_EXTENSIONS: Readonly<Record<"latex" | "typst" | "markdown", ReadonlySet<string>>> = {
  // latexmkrc stands for both latexmkrc and .latexmkrc, see fileExtension.
  // lua is for \directlua and luacode, ist for makeindex styles.
  latex: new Set([
    ...["tex", "ltx", "sty", "cls", "bst", "bbx", "cbx", "lbx", "def", "cfg", "clo", "fd", "bib"],
    ...["tikz", "pgf", "csv", "dat", "txt", "pdf", "latexmkrc", "lua", "ist", ...IMAGE_EXTENSIONS],
  ]),
  // csl is a citation style that #bibliography(style: ...) loads.
  typst: new Set([
    ...["typ", "bib", "yaml", "yml", "json", "toml", "csv", "xml", "cbor", "txt", "wasm", "pdf", "csl"],
    ...IMAGE_EXTENSIONS,
  ]),
  // sty, cls, css and html are templates and styles for PDF and HTML output.
  markdown: new Set([
    ...["md", "yaml", "yml", "json", "bib", "csl", "lua", "tex", "sty", "cls", "css", "html"],
    ...IMAGE_EXTENSIONS,
  ]),
};

// LaTeX reads .md files only through the markdown package. Without it, notes
// in Markdown that can't be saved don't stop a LaTeX compile.
const LATEX_WITH_MARKDOWN: ReadonlySet<string> = new Set([...BUILD_READ_EXTENSIONS.latex, "md"]);

function fileExtension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  return name.slice(name.lastIndexOf(".") + 1);
}

function projectLoadsMarkdownPackage(projectId: string | null): boolean {
  const graph = useIndexStore.getState().intelligenceState?.data;
  return !!graph && graph.identity.projectId === projectId && (graph.detectedPackages ?? []).includes("markdown");
}

function engineReadsExtensions(
  engine: DocumentEngineDescriptor | null,
  projectId: string | null,
): ReadonlySet<string> | null {
  const profile = engine?.capabilities.formatting_profile;
  if (profile === "latex" && projectLoadsMarkdownPackage(projectId)) return LATEX_WITH_MARKDOWN;
  return profile === "latex" || profile === "typst" || profile === "markdown"
    ? BUILD_READ_EXTENSIONS[profile]
    : null;
}

function saveFailureStopsCompile(
  error: unknown,
  projectId: string | null,
  mainDoc: string,
  engine: DocumentEngineDescriptor | null,
): boolean {
  if (!(error instanceof SaveFlushError)) return true;
  const reads = filesTheCompileReads(projectId, mainDoc);
  const readable = engineReadsExtensions(engine, projectId);
  if (reads === null || readable === null) return true;
  return error.failures.some(
    (failure) =>
      reads.has(failure.path) ||
      readable.has(fileExtension(failure.path)) ||
      locationErrorAvailability(failure.reason) !== null,
  );
}

export async function saveAllForCompile(
  options: { readonly mainDoc?: string; readonly explicit?: boolean } = {},
): Promise<void> {
  const files = useFilesStore.getState();
  try {
    await saveAllDirtyRetryingConflicts();
  } catch (error) {
    if (saveFailureStopsCompile(error, files.projectId, options.mainDoc ?? files.mainDoc, files.engine)) {
      throw error;
    }
    reportCompileSaveFailure("save before compile", useFilesStore.getState(), error, options.explicit);
  }
  await collabCompileBarrier(useFilesStore.getState().projectId);
}

export function compileSaveFailureReason(error: unknown): string {
  if (!(error instanceof SaveFlushError)) {
    return i18n.t(($) => $.core.compile.saveFailedOther, { reason: describeError(error) });
  }
  const path = error.failures[0].path;
  return error.failures.length > 1
    ? i18n.t(($) => $.core.compile.saveFailedSeveral, { path })
    : i18n.t(($) => $.core.compile.saveFailed, { path });
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
  const projectId = files.projectId;
  if (!projectId || !projectFolderAvailable(projectId)) {
    void logError(scope, error);
    return;
  }
  if (error instanceof SaveFlushError) {
    for (const failure of error.failures) {
      reportFileSaveFailure(scope, projectId, failure.path, failure.reason, explicit);
    }
    return;
  }
  if (files.activePath) reportFileSaveFailure(scope, projectId, files.activePath, error, explicit);
  else void logError(scope, error);
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

export function endTinytexWait(reason: string): void {
  const { status, failureReason } = useCompileStore.getState();
  if (status === "unavailable" && failureReason === i18n.t(($) => $.core.compile.tinytexDownloading)) {
    useCompileStore.setState({ failureReason: reason });
  }
}

export function compileIsBusy(): boolean {
  return activeCompileIntent !== null || rerunQueued || useCompileStore.getState().status === "compiling";
}

export function failureOutsideSource(): string | null {
  const { failureReason } = useCompileStore.getState();
  const inSource =
    failureReason === compileFailureMessage("") || failureReason === syntaxCheckFailureMessage();
  return inSource ? null : failureReason;
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
      if (!compileIdentityGate(ctx)) return false;
      setCompileUnavailable(ctx, i18n.t(($) => $.core.compile.pandocRequired));
      ctx.abortIntent();
      return false;
    }
  } catch (e) {
    void logError("Pandoc setup", e);
    if (!compileIdentityGate(ctx)) return false;
    const message = decodeAppError(e) ? describeError(e) : String(e);
    setCompileUnavailable(ctx, i18n.t(($) => $.core.compile.pandocSetupFailed, { message }));
    ctx.abortIntent();
    return false;
  }
  return compileIdentityGate(ctx);
}

function notebookPrerequisite(engine: DocumentEngineDescriptor): NotebookTool | null {
  const prerequisite: string | null = engine.capabilities.compiler_prerequisite;
  return prerequisite === "quarto" || prerequisite === "calepin" ? prerequisite : null;
}

async function notebookPrerequisiteGate(ctx: CompileGateContext, tool: NotebookTool): Promise<boolean> {
  const { NOTEBOOK_TOOL_LABELS, useNotebookToolchainStore } = await import("@/store/notebook-toolchain");
  const cached = useNotebookToolchainStore.getState().status;
  const status =
    cached && (cached[tool].active || ctx.origin !== "explicit")
      ? cached
      : await useNotebookToolchainStore.getState().refresh();
  if (!compileIdentityGate(ctx)) return false;
  if (!status || status[tool].active || !ctx.capturedProjectId) return true;
  const installing =
    status[tool].installing || useNotebookToolchainStore.getState().installs[tool] !== undefined;
  ctx.set({
    status: "unavailable",
    phase: "idle",
    failureReason: installing
      ? i18n.t(($) => $.errors.notebook.busy, { tool: NOTEBOOK_TOOL_LABELS[tool] })
      : notebookToolMissingMessage(tool),
    lastAttemptIdentity: gateAttemptIdentity(ctx),
    offer: { kind: "notebook-tool-missing", projectId: ctx.capturedProjectId, tool },
  });
  ctx.abortIntent();
  return false;
}

async function currentTexBlocker(origin: CompileOrigin): Promise<TexBlocker | null> {
  const engineStore = useEngineStore.getState();
  if (!engineStore.info?.latexmk_blocker) return null;
  await engineStore.refresh({ rescan: origin === "explicit" ? "full" : "login_probe" });
  return useEngineStore.getState().info?.latexmk_blocker ?? null;
}

function withSharedTexNote(projectId: string | null, message: string): string {
  if (collabSettingsLocked(projectId)) {
    return `${message} ${i18n.t(($) => $.core.compile.sharedTexViewer)}`;
  }
  if (collabProjectShared(projectId)) {
    return `${message} ${i18n.t(($) => $.core.compile.sharedTexEditor)}`;
  }
  return message;
}

async function systemTexPrerequisiteGate(ctx: CompileGateContext): Promise<boolean> {
  if (ctx.files.engine.capabilities.compiler_prerequisite !== "system_tex") return true;
  const engineStore = useEngineStore.getState();
  if (engineStore.installing) {
    engineStore.queueCompileAfterInstall(ctx.origin);
    setCompileUnavailable(ctx, i18n.t(($) => $.core.compile.tinytexDownloading));
    ctx.abortIntent();
    return false;
  }
  const blocker = await currentTexBlocker(ctx.origin);
  if (!compileIdentityGate(ctx)) return false;
  if (!blocker || !ctx.capturedProjectId) return true;
  ctx.set({
    status: "unavailable",
    phase: "idle",
    failureReason: withSharedTexNote(ctx.capturedProjectId, describeTexBlocker(blocker)),
    lastAttemptIdentity: gateAttemptIdentity(ctx),
    offer: { kind: "tex-missing", projectId: ctx.capturedProjectId },
  });
  ctx.abortIntent();
  return false;
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

function folderLostDuringSave(projectId: string, error: unknown): boolean {
  return reportLocationError(projectId, codedSaveFailure(error) ?? error) || !projectFolderAvailable(projectId);
}

async function saveBeforeCompileGate(ctx: CompileGateContext): Promise<boolean> {
  if (formatsBeforeCompileSave(ctx)) await formatActiveFileBeforeCompileSave();
  try {
    await saveAllForCompile({ mainDoc: ctx.mainDoc, explicit: ctx.origin === "explicit" });
  } catch (e) {
    if (ctx.capturedProjectId && folderLostDuringSave(ctx.capturedProjectId, e)) {
      setCompileUnavailable(ctx, i18n.t(($) => $.core.folderUnavailable.compile));
      ctx.abortIntent();
      return false;
    }
    const reason = compileSaveFailureReason(e);
    ctx.set({
      status: "error",
      phase: "idle",
      failureReason: reason,
      log: reason,
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

function syntaxCheckFailureMessage(): string {
  return i18n.t(($) => $.core.compile.syntaxCheckFailed, {
    setting: i18n.t(($) => $.shell.compile.syntax.check),
  });
}

async function syntaxCheckGate(ctx: CompileGateContext, projectId: string): Promise<boolean> {
  if (!ctx.get().checkSyntaxBeforeCompile) return true;
  const { engine } = ctx.files;
  if (!compileSettingsForEngine(engine).syntaxCheck || !pathUsesEngineSource(engine, ctx.mainDoc)) {
    return true;
  }
  let syntaxErrors: CompileError[] = [];
  try {
    syntaxErrors = await mainDocumentSyntaxErrors(projectId, ctx.mainDoc);
  } catch {
    syntaxErrors = [];
  }
  if (!compileIdentityGate(ctx)) return false;
  if (syntaxErrors.length === 0) return true;
  ctx.set({
    status: "error",
    phase: "idle",
    errors: syntaxErrors,
    failureReason: syntaxCheckFailureMessage(),
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
  const notebookTool = notebookPrerequisite(ctx.files.engine);
  if (notebookTool && !(await notebookPrerequisiteGate(ctx, notebookTool))) return null;
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
    clearedLog: null,
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
  readonly offline: boolean;
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

function compileFailureMessage(outputIdentityError: string): string {
  return outputIdentityError
    ? i18n.t(($) => $.core.compile.pdfChanged)
    : i18n.t(($) => $.preview.empty.compileFailed);
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
const NON_ASCII_TEXT = /[^\p{ASCII}]/u;

function withoutUnneededT1Warning(
  errors: CompileError[],
  snapshot: CompileSourceSnapshot | null,
): CompileError[] {
  if (!snapshot || !errors.some((error) => error.code === T1_ENCODING_CODE)) return errors;
  if (Object.values(snapshot.texts).some((text) => NON_ASCII_TEXT.test(text))) return errors;
  return errors.filter((error) => error.code !== T1_ENCODING_CODE);
}

async function explainedErrors(
  result: CompileResult,
  snapshot: CompileSourceSnapshot | null,
): Promise<CompileError[]> {
  const errors = withoutUnneededT1Warning(explainCodedCompileErrors(result.errors), snapshot);
  const engineId = useFilesStore.getState().engine.id;
  if (
    (engineId !== "typst" && engineId !== "calepin") ||
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
  const errors = withoutUnneededT1Warning(
    explainCodedCompileErrors(result.errors),
    ctx.compiledSourceSnapshot,
  );
  let settled = false;
  ctx.set((state) => {
    if (
      ctx.identityStale() ||
      state.status !== "compiling" ||
      state.lastAttemptIdentity?.requestGeneration !== ctx.requestIdentity.requestGeneration
    ) {
      return state;
    }
    settled = true;
    return {
      status: "success",
      phase: "idle",
      failureReason: null,
      errors,
      diagnostics: result.diagnostics ?? null,
      log: `${ctx.offlineNoticePrefix}${result.log}`,
      clearedLog: null,
      htmlOutput: null,
    };
  });
  if (settled) reportLostText(ctx, errors);
  return true;
}

async function applyHtmlCompileResult(
  ctx: CompileApplyContext,
  result: CompileResult,
  path: string,
): Promise<CompileResult> {
  const errors = await explainedErrors(result, ctx.compiledSourceSnapshot);
  if (ctx.identityStale()) return result;
  let applied = false;
  ctx.set((state) => {
    if (
      ctx.identityStale() ||
      hasCompileCheckpointAdvanced(ctx.checkpointAtStart, state.lastCompileCheckpoint)
    ) {
      return state;
    }
    applied = true;
    return {
      status: "success",
      phase: "idle",
      failureReason: null,
      errors,
      diagnostics: result.diagnostics ?? null,
      log: `${ctx.offlineNoticePrefix}${result.log}`,
      clearedLog: null,
      compileTimeMs: result.compile_time_ms ?? 0,
      htmlOutput: { projectId: ctx.projectId, path, builtAt: Date.now() },
    };
  });
  if (applied) settleCompileNotices(ctx.projectId);
  return result;
}

async function applyCompileResult(
  ctx: CompileApplyContext,
  result: CompileResult,
): Promise<CompileResult> {
  const htmlPath = result.ok ? compiledHtmlOutput(result) : null;
  if (htmlPath) return applyHtmlCompileResult(ctx, result, htmlPath);
  const currentCheckpoint = ctx.get().lastCompileCheckpoint;
  if (compileResultSuperseded(ctx, result, currentCheckpoint)) return result;
  if (settleAlreadyShownOutput(ctx, result, currentCheckpoint)) return result;
  // Wrap the IPC ArrayBuffer as a view (no copy of the payload bytes). Read
  // whenever a PDF exists, even on error: Tectonic's continue-on-errors mode
  // still produces a best-effort PDF, and we want to keep showing it.
  const buf = result.has_pdf ? await readCompiledPdf(ctx.projectId) : null;
  const bytes = buf ? new Uint8Array(buf) : null;
  const errors = await explainedErrors(result, ctx.compiledSourceSnapshot);
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
        : (texSetupReason(errors) ?? compileFailureMessage(verified.outputIdentityError)),
      errors,
      diagnostics: result.diagnostics ?? null,
      log: `${ctx.offlineNoticePrefix}${result.log}${verified.outputIdentityError}`,
      clearedLog: null,
      lastCompiledAt: checkpoint?.completedAt ?? state.lastCompiledAt,
      lastCompileCheckpoint: checkpoint ?? state.lastCompileCheckpoint,
      compiledSources: checkpoint ? ctx.compiledSourceSnapshot : state.compiledSources,
      compileTimeMs: checkpoint ? (result.compile_time_ms ?? 0) : state.compileTimeMs,
      htmlOutput: null,
    };
  });
  if (!applied) return result;
  const opening = takeEngineChoiceOnOpen(ctx.projectId);
  if (checkpoint) {
    settleCompileNotices(ctx.projectId);
    offerIndexGap(ctx, result.errors);
    reportLostText(ctx, errors);
  } else {
    maybeOfferEngineChoice(ctx, result.log, result.errors, opening);
    maybeOfferTexSetup(ctx, result.errors);
    maybeOfferCompilerSwitch(ctx, result.errors);
    maybeSuggestMissingPackages(ctx, result.log);
  }
  void import("@/lib/preview-window")
    .then((module) =>
      module.refreshPreviewWindow({
        identity: ctx.requestIdentity,
        status: checkpoint ? "success" : "error",
        checkpoint,
        message: checkpoint ? undefined : compileFailureMessage(verified.outputIdentityError),
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
      files.engine.id === "typst" &&
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
    offline: false,
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
  stale: () => boolean,
  oneShot: () => Promise<CompileResult>,
): Promise<CompileResult> {
  const module = await loadLivePreview();
  try {
    return await module.compileLive({ projectId, mainDoc, offline, typstVariant, fresh });
  } catch (error) {
    void logError("live preview", error);
    if (stale()) throw error;
    return oneShot();
  }
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
  void logError("compile", e);
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

function reportMissingNotebookTool(ctx: CompileApplyContext, tool: NotebookTool, e: unknown): void {
  const message = describeError(e);
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
      offer: { kind: "notebook-tool-missing", projectId: ctx.projectId, tool },
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
  void import("@/store/notebook-toolchain")
    .then((module) => module.useNotebookToolchainStore.getState().refresh())
    .catch(() => {});
}

function reportMissingTex(ctx: CompileApplyContext, e: unknown): void {
  const message = withSharedTexNote(ctx.projectId, describeError(e));
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
      log: `${ctx.offlineNoticePrefix}${message}`,
      failureReason: message,
      offer: { kind: "tex-missing", projectId: ctx.projectId },
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
  void useEngineStore.getState().refresh();
}

function maybeOfferTexSetup(ctx: CompileApplyContext, errors: readonly CompileError[]): void {
  const needsTex = (code: string) => TEX_SETUP_CODES.has(code) || code === QUARTO_NEEDS_TEX;
  if (errors.some((error) => error.code && needsTex(error.code))) {
    offerForAttempt(ctx, { kind: "tex-missing", projectId: ctx.projectId });
  }
}

function maybeOfferCompilerSwitch(ctx: CompileApplyContext, errors: readonly CompileError[]): void {
  const params = errors.find((error) => error.code === UNICODE_ENGINE_CODE)?.params;
  const compiler = params?.compiler;
  if (compiler === "xelatex" || compiler === "lualatex") {
    offerForAttempt(ctx, {
      kind: "switch-compiler",
      projectId: ctx.projectId,
      compiler,
      label: params?.label ?? compiler,
    });
  }
}

function codeNeededErrors(code: string | undefined, message: string): CompileError[] | null {
  if (code !== NOTEBOOK_CODE_NEEDED) return null;
  return [{ kind: "error", code, message, line: null, file: null, explanation: null }];
}

function maybeOfferJapaneseSupport(ctx: CompileApplyContext, code: string, names: string | undefined): void {
  if (code !== JAPANESE_COMPILER_INSTALLABLE || !isLatexmkProject(ctx.projectId)) return;
  const packages = (names ?? "").split(",").filter((name) => name.length > 0);
  if (packages.length > 0) {
    offerForAttempt(ctx, { kind: "tex-packages", projectId: ctx.projectId, packages });
  }
}

function handleCompileException(ctx: CompileApplyContext, e: unknown): void {
  const appError = decodeAppError(e);
  const missingTypst = appError?.code === TYPST_VERSION_MISSING ? appError.params.version : undefined;
  if (missingTypst) {
    reportMissingTypst(ctx, missingTypst, e);
    return;
  }
  const missingTool = appError ? NOTEBOOK_TOOL_MISSING.get(appError.code) : undefined;
  if (missingTool) {
    reportMissingNotebookTool(ctx, missingTool, e);
    return;
  }
  if (appError && TEX_SETUP_CODES.has(appError.code)) {
    reportMissingTex(ctx, e);
    return;
  }
  const message = appError ? describeError(e) : String(e);
  const codeNeeded = codeNeededErrors(appError?.code, message);
  const failedWithReason = i18n.t(($) => $.core.compile.failedWithReason, { message });
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
      failureReason: codeNeeded ? message : failedWithReason,
      ...(codeNeeded ? { errors: codeNeeded } : {}),
    };
  });
  if (appError) maybeOfferJapaneseSupport(ctx, appError.code, appError.params.packages);
  void import("@/lib/preview-window")
    .then((module) =>
      module.refreshPreviewWindow({
        identity: ctx.requestIdentity,
        status: "error",
        checkpoint: null,
        message: failedWithReason,
      }),
    )
    .catch(() => {});
  void logError("compile", e);
}

function clearOrphanedCompilingState(
  set: CompileSet,
  requestIdentity: CompileRequestIdentity,
  checkpointAtStart: CompileSuccessCheckpoint | null,
): void {
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
      failureReason: i18n.t(($) => $.core.compile.superseded),
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
  clearedLog: null,
  clearLog: () =>
    set((state) => (state.status === "compiling" || !state.log ? state : { clearedLog: state.log })),
  errors: [],
  diagnostics: null,
  pdfBytes: null,
  lastAttemptIdentity: null,
  failureReason: null,
  lastCompiledAt: null,
  lastCompileCheckpoint: null,
  compiledSources: null,
  compileTimeMs: null,
  htmlOutput: null,
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
    clearQueuedRerun();
    try {
      await cancelCompile();
    } catch (error) {
      notifyError("stop compile", error);
    }
    await interruptTypstLivePreview();
  },
  reset: () => {
    if (activeCompileIntent !== null || get().status === "compiling") {
      void cancelCompile().catch((error: unknown) => logError("stop compile", error));
    }
    compileSeq++;
    clearQueuedRerun();
    forgetOutdatedStops();
    activeCompileIntent = null;
    compileIntentGeneration++;
    set({
      status: "idle",
      phase: "idle",
      log: "",
      clearedLog: null,
      errors: [],
      diagnostics: null,
      pdfBytes: null,
      lastAttemptIdentity: null,
      failureReason: null,
      lastCompiledAt: null,
      lastCompileCheckpoint: null,
      compiledSources: null,
      compileTimeMs: null,
      htmlOutput: null,
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
    if (get().lastCompileCheckpoint || get().status !== "idle") return false;
    const validated = await validateCompileFingerprint(projectId, mainDoc).catch(() => null);
    if (!validated || validated.main_document !== mainDoc) return false;
    const buffer = await readCompiledPdf(projectId).catch(() => null);
    if (!buffer) return false;
    const bytes = new Uint8Array(buffer);
    if (fingerprintCompileOutput(bytes) !== validated.output_id) return false;
    if (!Number.isSafeInteger(validated.output_revision) || validated.output_revision <= 0) {
      return false;
    }
    const files = useFilesStore.getState();
    if (files.projectId !== projectId || get().lastCompileCheckpoint) return false;
    const checkpoint = createCompileSuccessCheckpoint({
      projectId,
      mainDocument: mainDoc,
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
      clearedLog: null,
      lastCompiledAt: checkpoint.completedAt,
      lastCompileCheckpoint: checkpoint,
      htmlOutput: null,
    });
    return true;
  },

  recompile: async (options) => {
    const origin = options?.origin ?? "explicit";
    if (activeCompileIntent !== null || get().status === "compiling") {
      queueRerun(origin);
      return undefined;
    }
    const intent = ++compileIntentGeneration;
    activeCompileIntent = intent;
    const files = useFilesStore.getState();
    const capturedProjectId = files.projectId;
    if (origin === "explicit") noteUnreviewedSuggestions(capturedProjectId, "compile");
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
      offline: offlinePolicy.offline,
      compiledSourceSnapshot: captured.snapshot,
      origin,
    };
    try {
      return await withEventListener("compile:log", (chunk: string) => logPump.push(chunk), async () => {
        if (identityStale() || checkpointAdvanced()) return undefined;
        const compileOnce = () =>
          compileProject(
            projectId,
            mainDoc,
            offlinePolicy.offline,
            get().compileMode === "fast",
            get().stopOnFirstError,
            activeTypstVariant(projectId, files.engine),
          );
        const result = livePreviewRoutes(get(), useFilesStore.getState(), projectId)
          ? await compileThroughLivePreview(
              projectId,
              mainDoc,
              offlinePolicy.offline,
              activeTypstVariant(projectId, files.engine),
              origin !== "automatic" || options?.fromScratch === true,
              identityStale,
              compileOnce,
            )
          : await compileOnce();
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
