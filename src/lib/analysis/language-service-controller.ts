import {
  createTauriLanguageServiceTransport,
  getLanguageServiceRuntimeProfile,
  isLanguageServiceSetupRequiredError,
  isTauriLanguageServiceAvailable,
  LanguageServiceClient,
  type JsonValue,
  type LanguageServiceClientStartOptions,
  type LanguageServiceClientEvent,
  type LanguageServiceClientListener,
  type LanguageServiceClientState,
  type LanguageServiceFeature,
  type LanguageServiceKind,
  type LanguageServiceInstallResult,
  type LanguageServiceInstallStatus,
  type LanguageServiceRequestOptions,
  type PositionEncoding,
  type TextDocumentItem,
  type WorkspaceSymbolParams,
} from "@/lib/language-service";
import type { ProjectIndex } from "@/lib/index/types";
import {
  normalizeAnalysisFailure,
  PROJECT_ANALYSIS_FEATURES,
  type AnalysisFailure,
  type ProjectAnalysisFeature,
} from "@/lib/analysis/project-snapshot";
import {
  ProjectAnalysisCoordinator,
  ProjectIndexShadowCoordinator,
} from "@/lib/analysis/coordinator";
import { LANGUAGE_SERVICE_SETUP_FAILURE_REASON } from "@/lib/analysis/language-service-actions";
import { activateInteractiveLanguageService } from "@/lib/analysis/interactive-language-service";
import { languageServiceContribution } from "@/lib/project-intelligence/language-service-contribution";
import type { ProjectIntelligenceIdentity } from "@/lib/project-intelligence/types";
import {
  useProjectAnalysisStore,
  type ProjectAnalysisStoreApi,
} from "@/store/project-analysis";
import { useIndexStore } from "@/store/project-index";

export type LanguageServiceEngineId =
  | "latex"
  | "typst"
  | "markdown"
  | "unknown";

export interface LanguageServiceProjectFile {
  content: string;
  dirty?: boolean;
}

export interface LanguageServiceProjectTreeEntry {
  path: string;
  is_dir: boolean;
}

export interface LanguageServiceProjectSnapshot {
  projectId: string | null;
  engineId: LanguageServiceEngineId;
  engineLoaded: boolean;
  mainDoc: string;
  tree: readonly LanguageServiceProjectTreeEntry[];
  files: Readonly<Record<string, LanguageServiceProjectFile>>;
  indexTexts: Readonly<Record<string, string>>;
  index: ProjectIndex | null;
  indexBuilding?: boolean;
}

export interface LifecycleLanguageServiceClient {
  readonly state: LanguageServiceClientState;
  readonly generation: number;
  readonly workspaceRoot: string | null;
  readonly rootUri: string | null;
  readonly positionEncoding?: PositionEncoding;
  subscribe(listener: LanguageServiceClientListener): () => void;
  supports(feature: LanguageServiceFeature): boolean;
  setProjectRevision(revision: number): void;
  start(options: LanguageServiceClientStartOptions): Promise<void>;
  stop(): Promise<void>;
  openDocument(
    textDocument: TextDocumentItem,
    projectRevision?: number,
  ): Promise<void>;
  replaceDocument(
    uri: string,
    text: string,
    projectRevision?: number,
  ): Promise<number>;
  acknowledgeDocumentRevision(
    uri: string,
    projectRevision?: number,
  ): void;
  closeDocument(uri: string): Promise<void>;
  requestWorkspaceSymbols?(
    params: WorkspaceSymbolParams,
    options?: LanguageServiceRequestOptions,
  ): Promise<JsonValue>;
}

export interface LanguageServiceProvisioner {
  installStatus(
    kind: LanguageServiceKind,
  ): Promise<LanguageServiceInstallStatus>;
  install(
    kind: LanguageServiceKind,
  ): Promise<LanguageServiceInstallResult>;
}

export interface LifecycleAnalysisCoordinator {
  activateProject(project: {
    projectId: string;
    projectRevision: number;
  }): void;
  updateProjectRevision(revision: number): boolean;
  trackDocument(uri: string, version: number): boolean;
  untrackDocument(uri: string): void;
  dispose(): void;
}

export interface LanguageServiceRestartScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface LanguageServiceControllerOptions {
  store?: ProjectAnalysisStoreApi;
  isAvailable?: () => boolean;
  createClient?: (
    kind: LanguageServiceKind,
    projectId: string,
  ) => LifecycleLanguageServiceClient;
  provisioner?: LanguageServiceProvisioner;
  createCoordinator?: (
    client: LifecycleLanguageServiceClient,
    store: ProjectAnalysisStoreApi,
  ) => LifecycleAnalysisCoordinator;
  scheduler?: LanguageServiceRestartScheduler;
  restartBaseDelayMs?: number;
  restartMaxDelayMs?: number;
  maxRestartAttempts?: number;
  restartStableWindowMs?: number;
}

interface TrackedDocument {
  path: string;
  uri: string;
  text: string;
  version: number;
}

interface DesiredProject {
  snapshot: LanguageServiceProjectSnapshot;
  projectId: string;
  revision: number;
  effectiveTexts: ReadonlyMap<string, string>;
}

interface ActiveRuntime {
  token: number;
  key: string;
  projectId: string;
  projectRevision: number;
  kind: LanguageServiceKind;
  root: string | null;
  rootUri: string | null;
  client: LifecycleLanguageServiceClient;
  coordinator: LifecycleAnalysisCoordinator | null;
  unsubscribe: () => void;
  documents: Map<string, TrackedDocument>;
  expectedStop: boolean;
  ready: boolean;
  protocolReady: boolean;
  failed: boolean;
  cleanupFailed: boolean;
  restartHandle: unknown | null;
  stableHandle: unknown | null;
  intelligenceHandle: unknown | null;
  intelligenceIdentityKey: string | null;
  deactivateInteractive: (() => void) | null;
}

interface LastObservedProject {
  projectId: string;
  engineId: LanguageServiceEngineId;
  engineLoaded: boolean;
  mainDoc: string;
  tree: readonly LanguageServiceProjectTreeEntry[];
  files: LanguageServiceProjectSnapshot["files"];
  indexTexts: LanguageServiceProjectSnapshot["indexTexts"];
  effectiveTexts: ReadonlyMap<string, string>;
}

const DEFAULT_RESTART_BASE_DELAY_MS = 250;
const DEFAULT_RESTART_MAX_DELAY_MS = 4_000;
const DEFAULT_MAX_RESTART_ATTEMPTS = 4;
const DEFAULT_RESTART_STABLE_WINDOW_MS = 30_000;
const LANGUAGE_SERVICE_INTELLIGENCE_DELAY_MS = 400;
const LANGUAGE_SERVICE_INTELLIGENCE_TIMEOUT_MS = 8_000;

class LanguageServiceSetupActionError extends Error {
  constructor() {
    super(LANGUAGE_SERVICE_SETUP_FAILURE_REASON);
    this.name = "LanguageServiceSetupActionError";
  }
}

function safeSetupFailure(): AnalysisFailure {
  return {
    name: "LanguageServiceSetupError",
    message: LANGUAGE_SERVICE_SETUP_FAILURE_REASON,
    retryable: true,
  };
}

function safeCleanupFailure(): AnalysisFailure {
  return {
    name: "LanguageServiceCleanupError",
    message: LANGUAGE_SERVICE_DISPOSE_FAILURE_REASON,
    retryable: true,
  };
}

function safeLanguageServiceFailure(
  error: unknown,
  retryable = true,
): AnalysisFailure {
  const normalized = normalizeAnalysisFailure(error, retryable);
  const code =
    typeof normalized.code === "string" ? normalized.code : undefined;
  const messageByCode: Readonly<Record<string, string>> = {
    duplicate_session:
      "A previous language-service session is still closing. Retry to reclaim it.",
    invalid_workspace:
      "Oleafly could not validate this project workspace. Close and reopen the project, then retry.",
    sidecar_unavailable:
      "The pinned language-service executable could not be started.",
    sidecar_setup_required:
      "The pinned language service is not installed yet.",
    manifest_invalid:
      "The packaged language-service configuration is invalid.",
    download_failed:
      "The pinned language-service download could not be completed. Check your connection and try again.",
    integrity_failure:
      "The installed language service failed integrity verification and must be set up again.",
    install_failed:
      "The language-service installation could not be prepared.",
    session_limit:
      "The native language-service session limit was reached. Retry after the previous session closes.",
    session_not_found:
      "The native language-service session expired. Retry to start a new session.",
    session_not_running:
      "The native language-service process is no longer running. Retry to restart it.",
    generation_mismatch:
      "The language-service session was superseded. Retry to synchronize the current project.",
    backpressure:
      "The language service was temporarily busy. Retry to resume project analysis.",
    transport_closed:
      "The language-service connection closed unexpectedly. Retry to reconnect.",
    stop_timeout:
      "The previous language-service process did not stop in time. Retry to recover it.",
    app_shutting_down:
      "The language service stopped because Oleafly is closing.",
    internal:
      "The native language-service worker could not complete.",
  };
  const timeoutMessage =
    normalized.name === "LanguageServiceTimeoutError"
      ? "The language server did not respond during initialization. Retry to restart it."
      : undefined;
  return {
    ...normalized,
    message:
      (code ? messageByCode[code] : undefined) ??
      timeoutMessage ??
      "The project language service could not be started. Retry to recover it.",
  };
}

export const MARKDOWN_LOCAL_ONLY_REASON =
  "Markdown analysis is provided by Oleafly's local project index. No language server is configured.";
export const BIBTEX_LOCAL_ONLY_REASON =
  "BibTeX analysis is provided by Oleafly's local project index. The file is not opened in the document language server.";
export const LANGUAGE_SERVICE_DISPOSE_FAILURE_REASON =
  "Language-service native session cleanup could not be completed.";

const LATEX_DOCUMENT = /\.(?:tex|ltx|latex|sty|cls)$/i;
const TYPST_DOCUMENT = /\.typ$/i;
const MARKDOWN_DOCUMENT = /\.(?:md|markdown)$/i;
const BIBTEX_DOCUMENT = /\.bib$/i;

export function languageServiceKindForEngine(
  engineId: LanguageServiceEngineId,
): LanguageServiceKind | null {
  if (engineId === "latex") return "texlab";
  if (engineId === "typst") return "tinymist";
  return null;
}

export function languageServiceLanguageIdForPath(
  kind: LanguageServiceKind,
  path: string,
): "latex" | "typst" | null {
  if (kind === "texlab" && LATEX_DOCUMENT.test(path)) return "latex";
  if (kind === "tinymist" && TYPST_DOCUMENT.test(path)) return "typst";
  return null;
}

function localOnlyReason(
  engineId: LanguageServiceEngineId,
  path: string,
): string | null {
  if (BIBTEX_DOCUMENT.test(path)) return BIBTEX_LOCAL_ONLY_REASON;
  if (engineId === "markdown" && MARKDOWN_DOCUMENT.test(path)) {
    return MARKDOWN_LOCAL_ONLY_REASON;
  }
  return null;
}

function effectiveProjectTexts(
  snapshot: LanguageServiceProjectSnapshot,
): Map<string, string> {
  const paths =
    snapshot.tree.length === 0
      ? null
      : new Set(
          snapshot.tree
            .filter((entry) => !entry.is_dir)
            .map((entry) => entry.path),
        );
  const texts = new Map<string, string>();
  for (const [path, text] of Object.entries(snapshot.indexTexts)) {
    if (!paths || paths.has(path)) texts.set(path, text);
  }
  for (const [path, file] of Object.entries(snapshot.files)) {
    if (!paths || paths.has(path)) texts.set(path, file.content);
  }
  return texts;
}

function sameTexts(
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [path, text] of left) {
    if (right.get(path) !== text) return false;
  }
  return true;
}

function sameProjectTree(
  left: readonly LanguageServiceProjectTreeEntry[],
  right: readonly LanguageServiceProjectTreeEntry[],
): boolean {
  if (left.length !== right.length) return false;
  const remaining = new Map<string, number>();
  for (const entry of left) {
    const key = `${entry.is_dir ? "directory" : "file"}\0${entry.path}`;
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  for (const entry of right) {
    const key = `${entry.is_dir ? "directory" : "file"}\0${entry.path}`;
    const count = remaining.get(key);
    if (!count) return false;
    if (count === 1) {
      remaining.delete(key);
    } else {
      remaining.set(key, count - 1);
    }
  }
  return remaining.size === 0;
}

function encodePathSegments(path: string): string {
  return path
    .split("/")
    .map((segment, index) =>
      index === 0 && /^[A-Za-z]:$/.test(segment)
        ? segment
        : encodeURIComponent(segment),
    )
    .join("/");
}

export function fileUriForProjectPath(
  workspaceRoot: string,
  path = "",
): string {
  const normalizedRoot = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const absolute = normalizedPath
    ? `${normalizedRoot}/${normalizedPath}`
    : normalizedRoot;
  const encoded = encodePathSegments(absolute);
  return `file://${encoded.startsWith("/") ? "" : "/"}${encoded}`;
}

function localDocumentUri(projectId: string, path: string): string {
  return `oleafly-project://${encodeURIComponent(projectId)}/${encodePathSegments(path)}`;
}

function capabilitiesFor(
  client: LifecycleLanguageServiceClient,
): Record<ProjectAnalysisFeature, boolean> {
  return {
    completion: client.supports("completion"),
    hover: client.supports("hover"),
    definition: client.supports("definition"),
    references: client.supports("references"),
    documentSymbols: client.supports("documentSymbols"),
    workspaceSymbols: client.supports("workspaceSymbols"),
    diagnostics:
      client.supports("documentDiagnostics") ||
      client.supports("workspaceDiagnostics"),
    semanticTokens:
      client.supports("semanticTokensFull") ||
      client.supports("semanticTokensRange"),
  };
}

const defaultScheduler: LanguageServiceRestartScheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function defaultCreateClient(
  kind: LanguageServiceKind,
  projectId: string,
): LifecycleLanguageServiceClient {
  return new LanguageServiceClient({
    transport: createTauriLanguageServiceTransport(),
    kind,
    projectId,
  });
}

function defaultProvisioner(): LanguageServiceProvisioner {
  const transport = createTauriLanguageServiceTransport();
  return {
    installStatus: async (kind) => {
      if (!transport.installStatus) {
        throw new Error(
          "Language-service install status is unavailable",
        );
      }
      return transport.installStatus(kind);
    },
    install: async (kind) => {
      if (!transport.install) {
        throw new Error("Language-service setup is unavailable");
      }
      return transport.install(kind);
    },
  };
}

function defaultCreateCoordinator(
  client: LifecycleLanguageServiceClient,
  store: ProjectAnalysisStoreApi,
): LifecycleAnalysisCoordinator {
  if (!(client instanceof LanguageServiceClient)) {
    throw new TypeError(
      "The default analysis coordinator requires a LanguageServiceClient",
    );
  }
  return new ProjectAnalysisCoordinator(client, store);
}

export class LanguageServiceController {
  private readonly store: ProjectAnalysisStoreApi;
  private readonly isAvailable: () => boolean;
  private readonly createClient: (
    kind: LanguageServiceKind,
    projectId: string,
  ) => LifecycleLanguageServiceClient;
  private readonly provisioner: LanguageServiceProvisioner;
  private readonly createCoordinator: (
    client: LifecycleLanguageServiceClient,
    store: ProjectAnalysisStoreApi,
  ) => LifecycleAnalysisCoordinator;
  private readonly scheduler: LanguageServiceRestartScheduler;
  private readonly restartBaseDelayMs: number;
  private readonly restartMaxDelayMs: number;
  private readonly maxRestartAttempts: number;
  private readonly restartStableWindowMs: number;
  private readonly indexShadow: ProjectIndexShadowCoordinator;

  private desired: DesiredProject | null = null;
  private lastObserved: LastObservedProject | null = null;
  private hasObservedSnapshot = false;
  private runtime: ActiveRuntime | null = null;
  private work: Promise<void> = Promise.resolve();
  private disposed = false;
  private projectRevision = 0;
  private runtimeToken = 0;
  private operationToken = 0;
  private scheduledReconcileOperation: number | null = null;
  private restartAttempts = 0;
  private forcedRestartToken: number | null = null;
  private lastIndex:
    | {
        index: ProjectIndex;
        revision: number;
        generation: number;
        building: boolean;
      }
    | null = null;
  private localDocuments = new Map<
    string,
    { uri: string; text: string; version: number }
  >();

  constructor(options: LanguageServiceControllerOptions = {}) {
    this.store = options.store ?? useProjectAnalysisStore;
    this.isAvailable =
      options.isAvailable ?? isTauriLanguageServiceAvailable;
    this.createClient = options.createClient ?? defaultCreateClient;
    this.provisioner = options.provisioner ?? defaultProvisioner();
    this.createCoordinator =
      options.createCoordinator ?? defaultCreateCoordinator;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.restartBaseDelayMs =
      options.restartBaseDelayMs ?? DEFAULT_RESTART_BASE_DELAY_MS;
    this.restartMaxDelayMs =
      options.restartMaxDelayMs ?? DEFAULT_RESTART_MAX_DELAY_MS;
    this.maxRestartAttempts =
      options.maxRestartAttempts ?? DEFAULT_MAX_RESTART_ATTEMPTS;
    this.restartStableWindowMs =
      options.restartStableWindowMs ??
      DEFAULT_RESTART_STABLE_WINDOW_MS;
    if (
      this.restartBaseDelayMs < 0 ||
      this.restartMaxDelayMs < this.restartBaseDelayMs ||
      !Number.isInteger(this.maxRestartAttempts) ||
      this.maxRestartAttempts < 0 ||
      !Number.isFinite(this.restartStableWindowMs) ||
      this.restartStableWindowMs < 0
    ) {
      throw new RangeError("Invalid language-service restart policy");
    }
    this.indexShadow = new ProjectIndexShadowCoordinator(this.store);
  }

  update(snapshot: LanguageServiceProjectSnapshot): void {
    if (this.disposed) return;

    if (!snapshot.projectId) {
      if (
        this.hasObservedSnapshot &&
        this.lastObserved === null &&
        this.desired === null &&
        this.runtime === null
      ) {
        return;
      }
      const operation = ++this.operationToken;
      this.detachRuntime(this.runtime);
      this.cancelRestart();
      this.desired = null;
      this.lastObserved = null;
      this.hasObservedSnapshot = true;
      this.projectRevision = 0;
      this.restartAttempts = 0;
      this.localDocuments.clear();
      this.lastIndex = null;
      this.store.getState().reset();
      this.enqueueReconcile(operation);
      return;
    }

    const previous = this.lastObserved;
    const projectChanged =
      previous?.projectId !== snapshot.projectId;
    const treeChanged =
      projectChanged ||
      !previous ||
      (previous.tree !== snapshot.tree &&
        !sameProjectTree(previous.tree, snapshot.tree));
    const textInputsChanged =
      projectChanged ||
      previous.tree !== snapshot.tree ||
      previous.files !== snapshot.files ||
      previous.indexTexts !== snapshot.indexTexts;
    const computedEffectiveTexts =
      !textInputsChanged && previous
        ? previous.effectiveTexts
        : effectiveProjectTexts(snapshot);
    const contentsChanged =
      projectChanged ||
      !previous ||
      !sameTexts(previous.effectiveTexts, computedEffectiveTexts);
    const effectiveTexts =
      previous && !contentsChanged
        ? previous.effectiveTexts
        : computedEffectiveTexts;
    const revisionChanged =
      projectChanged ||
      !previous ||
      previous.engineId !== snapshot.engineId ||
      previous.mainDoc !== snapshot.mainDoc ||
      treeChanged ||
      contentsChanged;
    const lifecycleChanged =
      revisionChanged ||
      previous?.engineLoaded !== snapshot.engineLoaded;
    const engineBecameUnloaded =
      !projectChanged &&
      previous?.engineLoaded === true &&
      !snapshot.engineLoaded;

    if (projectChanged) {
      this.detachRuntime(this.runtime);
      this.cancelRestart();
      this.projectRevision = 1;
      this.restartAttempts = 0;
      this.lastIndex = null;
      this.localDocuments.clear();
      this.store.getState().activateProject({
        projectId: snapshot.projectId,
        projectRevision: this.projectRevision,
        languageServiceGeneration: 0,
      });
    } else if (revisionChanged) {
      this.projectRevision += 1;
      this.store.getState().setProjectRevision(this.projectRevision);
      if (
        languageServiceKindForEngine(previous?.engineId ?? "unknown") !==
        languageServiceKindForEngine(snapshot.engineId)
      ) {
        this.detachRuntime(this.runtime);
        this.cancelRestart();
        this.restartAttempts = 0;
      }
    }
    if (engineBecameUnloaded) {
      this.detachRuntime(this.runtime);
      this.cancelRestart();
      this.restartAttempts = 0;
    }

    this.lastObserved = {
      projectId: snapshot.projectId,
      engineId: snapshot.engineId,
      engineLoaded: snapshot.engineLoaded,
      mainDoc: snapshot.mainDoc,
      tree: snapshot.tree,
      files: snapshot.files,
      indexTexts: snapshot.indexTexts,
      effectiveTexts,
    };
    this.hasObservedSnapshot = true;
    const canCoalesceLifecycle =
      revisionChanged &&
      previous?.engineLoaded === true &&
      snapshot.engineLoaded &&
      this.desired?.projectId === snapshot.projectId &&
      languageServiceKindForEngine(
        this.desired.snapshot.engineId,
      ) === languageServiceKindForEngine(snapshot.engineId);
    if (canCoalesceLifecycle && this.desired) {
      // Same-project/same-server edits update the in-flight target in place.
      // Its object identity remains the cancellation boundary, so initial
      // startup and large document syncs converge on the newest revision
      // without killing and respawning the native process.
      this.desired.snapshot = snapshot;
      this.desired.revision = this.projectRevision;
      this.desired.effectiveTexts = effectiveTexts;
      this.publishLocalDocuments(this.desired);
      this.publishIndex(this.desired);
      this.enqueueReconcile(this.operationToken);
      return;
    }
    if (
      !lifecycleChanged &&
      this.desired?.projectId === snapshot.projectId
    ) {
      // Keep non-lifecycle publication inputs current without replacing the
      // desired object: in-flight start/sync work uses its identity as the
      // cancellation token. Dirty flags and index rebuild metadata must not
      // supersede valid language-service work.
      this.desired.snapshot = snapshot;
      this.desired.effectiveTexts = effectiveTexts;
      this.publishLocalDocuments(this.desired);
      this.publishIndex(this.desired);
      if (this.runtime?.ready) {
        this.scheduleLanguageServiceIntelligence(this.runtime);
      }
      return;
    }

    const operation = ++this.operationToken;
    const desired: DesiredProject = {
      snapshot,
      projectId: snapshot.projectId,
      revision: this.projectRevision,
      effectiveTexts,
    };
    this.desired = desired;
    this.publishLocalDocuments(desired);
    this.publishIndex(desired);
    if (engineBecameUnloaded) {
      this.publishNotRun(
        "Document engine details are still loading. Language analysis has not run.",
      );
    }
    this.enqueueReconcile(operation);
  }

  whenIdle(): Promise<void> {
    return this.work;
  }

  dispose(): Promise<void> {
    if (this.disposed) return this.work;
    this.disposed = true;
    const operation = ++this.operationToken;
    this.cancelRestart();
    this.desired = null;
    this.enqueueReconcile(operation, true);
    return this.work;
  }

  retry(): void {
    if (this.disposed || !this.desired) return;
    const operation = ++this.operationToken;
    this.restartAttempts = 0;
    this.cancelRestart();
    const runtime = this.runtime;
    this.detachRuntime(runtime);
    if (runtime) this.forcedRestartToken = runtime.token;
    this.enqueueReconcile(operation);
  }

  setup(): Promise<void> {
    if (this.disposed || !this.desired) return this.work;
    const desired = this.desired;
    const kind = languageServiceKindForEngine(
      desired.snapshot.engineId,
    );
    if (!kind) return this.work;
    const operation = ++this.operationToken;
    this.cancelRestart();
    this.detachRuntime(this.runtime);
    this.store.getState().setLanguageService({
      kind,
      readiness: "installing",
      capabilities: null,
      failure: null,
      reason: `Installing the pinned ${kind} language service.`,
      restartAttempt: 0,
    });
    const setupOperation = this.work.then(async () => {
      if (!this.operationIsCurrent(operation, desired)) return;
      await this.teardownRuntime(this.runtime);
      if (!this.operationIsCurrent(operation, desired)) return;
      try {
        await this.provisioner.install(kind);
      } catch {
        if (!this.operationIsCurrent(operation, desired)) return;
        this.publishSetupRequired(
          kind,
          safeSetupFailure(),
          LANGUAGE_SERVICE_SETUP_FAILURE_REASON,
        );
        throw new LanguageServiceSetupActionError();
      }
      if (!this.operationIsCurrent(operation, desired)) return;
      await this.reconcile(operation);
    });
    this.work = setupOperation.catch((error) => {
      if (
        this.operationIsCurrent(operation, desired) &&
        !(error instanceof LanguageServiceSetupActionError)
      ) {
        this.publishUnavailable(
          safeSetupFailure(),
          "Language-service setup could not be synchronized.",
        );
      }
    });
    return setupOperation.catch(() => {
      throw new Error(LANGUAGE_SERVICE_SETUP_FAILURE_REASON);
    });
  }

  private enqueueReconcile(
    operation: number,
    propagateDisposeFailure = false,
  ): void {
    if (this.scheduledReconcileOperation === operation) return;
    this.scheduledReconcileOperation = operation;
    this.work = this.work
      .then(() => {
        if (this.scheduledReconcileOperation === operation) {
          this.scheduledReconcileOperation = null;
        }
        return this.reconcile(operation);
      })
      .catch(async (error) => {
        if (
          propagateDisposeFailure &&
          this.disposed &&
          operation === this.operationToken
        ) {
          throw new Error(LANGUAGE_SERVICE_DISPOSE_FAILURE_REASON);
        }
        if (
          !this.disposed &&
          this.desired &&
          operation === this.operationToken
        ) {
          const failedRuntime = this.runtime;
          if (failedRuntime && !failedRuntime.cleanupFailed) {
            try {
              await this.teardownRuntime(failedRuntime);
            } catch {
              // The retained runtime owns the only identity that can retry its
              // native cleanup; publish that recovery path below.
            }
          }
          if (
            this.disposed ||
            !this.desired ||
            operation !== this.operationToken
          ) {
            return;
          }
          if (this.runtime?.cleanupFailed) {
            this.publishUnavailable(
              safeCleanupFailure(),
              LANGUAGE_SERVICE_DISPOSE_FAILURE_REASON,
            );
          } else {
            this.publishUnavailable(
              safeLanguageServiceFailure(error),
              "Language service could not be synchronized",
            );
          }
        }
      });
  }

  private async reconcile(operation: number): Promise<void> {
    const desired = this.desired;
    if (operation !== this.operationToken) return;
    if (this.disposed || !desired) {
      await this.teardownRuntime(this.runtime);
      if (operation !== this.operationToken) return;
      if (this.disposed) {
        this.store.getState().setLanguageService({
          kind: null,
          readiness: "stopped",
          capabilities: null,
          failure: null,
          reason: "Language-service lifecycle owner was unmounted.",
          restartAttempt: 0,
        });
      }
      return;
    }
    if (
      this.runtime?.cleanupFailed &&
      this.forcedRestartToken !== this.runtime.token
    ) {
      // The failed runtime retains the only client that can retry its native
      // session cleanup. Ordinary snapshot updates must not spin on teardown
      // or start a replacement; explicit retry authorizes one new attempt.
      this.publishUnavailable(
        safeCleanupFailure(),
        LANGUAGE_SERVICE_DISPOSE_FAILURE_REASON,
      );
      return;
    }

    const kind = languageServiceKindForEngine(
      desired.snapshot.engineId,
    );
    if (!desired.snapshot.engineLoaded) {
      await this.teardownRuntime(this.runtime);
      if (!this.operationIsCurrent(operation, desired)) return;
      this.publishNotRun(
        "Document engine details are still loading. Language analysis has not run.",
      );
      this.publishLocalDocuments(desired);
      this.publishIndex(desired);
      return;
    }
    if (!kind) {
      await this.teardownRuntime(this.runtime);
      if (!this.operationIsCurrent(operation, desired)) return;
      if (desired.snapshot.engineId === "markdown") {
        this.publishLocalOnly(MARKDOWN_LOCAL_ONLY_REASON);
      } else {
        this.publishNotRun(
          "The active document engine has no language-server mapping.",
        );
      }
      this.publishLocalDocuments(desired);
      this.publishIndex(desired);
      return;
    }
    if (!this.isAvailable()) {
      await this.teardownRuntime(this.runtime);
      if (!this.operationIsCurrent(operation, desired)) return;
      this.publishUnavailable(
        {
          name: "LanguageServiceUnavailableError",
          message:
            "Native language-service IPC is unavailable in this browser or test runtime.",
          retryable: false,
        },
        "Native language-service IPC is unavailable in this browser or test runtime.",
      );
      this.publishLocalDocuments(desired);
      this.publishIndex(desired);
      return;
    }

    if (
      this.runtime &&
      (this.runtime.projectId !== desired.projectId ||
        this.runtime.kind !== kind)
    ) {
      await this.teardownRuntime(this.runtime);
      if (!this.operationIsCurrent(operation, desired)) return;
    }
    const key = `${desired.projectId}\0${kind}`;
    if (
      this.runtime &&
      (this.runtime.key !== key ||
        this.forcedRestartToken === this.runtime.token)
    ) {
      this.forcedRestartToken = null;
      await this.teardownRuntime(this.runtime);
      if (!this.operationIsCurrent(operation, desired)) return;
    }
    const startingNewRuntime = !this.runtime;
    if (startingNewRuntime) {
      let profile: ReturnType<
        typeof getLanguageServiceRuntimeProfile
      >;
      try {
        profile = getLanguageServiceRuntimeProfile(kind);
      } catch (error) {
        if (!this.operationIsCurrent(operation, desired)) return;
        this.publishUnavailable(
          normalizeAnalysisFailure(error, false),
          "The packaged language-service runtime profile is invalid.",
        );
        return;
      }
      let installStatus: LanguageServiceInstallStatus;
      try {
        installStatus = await this.provisioner.installStatus(kind);
      } catch (error) {
        if (!this.operationIsCurrent(operation, desired)) return;
        this.publishUnavailable(
          safeLanguageServiceFailure(error),
          "Language-service setup status could not be checked.",
        );
        return;
      }
      if (!this.operationIsCurrent(operation, desired)) return;
      if (installStatus.version !== profile.version) {
        this.publishSetupRequired(
          kind,
          {
            name: "LanguageServiceVersionMismatchError",
            message: `Expected ${kind} ${profile.version}, but setup reported ${installStatus.version}.`,
            retryable: true,
          },
          "The pinned language-service version must be installed.",
        );
        return;
      }
      if (installStatus.state === "installing") {
        this.publishInstalling(kind, installStatus.message);
        return;
      }
      if (installStatus.state !== "installed") {
        this.publishSetupRequired(
          kind,
          {
            name: "LanguageServiceSetupRequiredError",
            message:
              installStatus.message ??
              `${kind} ${installStatus.version} is not installed.`,
            code: "sidecar_setup_required",
            retryable: true,
          },
          "Language-service setup is required before project analysis can run.",
        );
        return;
      }
      await this.startRuntime(
        desired,
        kind,
        key,
        profile,
        operation,
      );
      if (!this.operationIsCurrent(operation, desired)) return;
      if (this.runtime?.ready) {
        this.publishLocalDocuments(desired);
        this.publishIndex(desired);
      }
      return;
    }
    const current = this.runtime;
    const latest = this.desired;
    if (
      !current ||
      !latest ||
      current.key !== key ||
      current.failed ||
      !current.protocolReady
    ) {
      this.publishLocalDocuments(latest ?? desired);
      this.publishIndex(latest ?? desired);
      return;
    }
    current.coordinator?.updateProjectRevision(latest.revision);
    if (
      current.ready &&
      current.projectRevision === latest.revision
    ) {
      this.publishLocalDocuments(latest);
      this.publishIndex(latest);
      return;
    }
    if (current.ready) {
      current.ready = false;
      if (current.stableHandle !== null) {
        this.scheduler.clearTimeout(current.stableHandle);
        current.stableHandle = null;
      }
      this.publishSyncing(current);
    }
    const synchronized = await this.syncDocuments(
      current,
      latest,
      operation,
    );
    if (
      !synchronized ||
      !this.operationIsCurrent(operation, latest) ||
      this.runtime !== current
    ) {
      if (
        !this.runtimeOperationIsCurrent(
          current,
          operation,
          latest,
        ) &&
        !current.failed &&
        this.runtime === current
      ) {
        await this.teardownRuntime(current);
      }
      return;
    }
    this.markRuntimeReady(current);
    this.publishLocalDocuments(latest);
    this.publishIndex(latest);
  }

  private async startRuntime(
    desired: DesiredProject,
    kind: LanguageServiceKind,
    key: string,
    runtimeProfile: ReturnType<
      typeof getLanguageServiceRuntimeProfile
    >,
    operation: number,
  ): Promise<void> {
    const token = ++this.runtimeToken;
    const client = this.createClient(kind, desired.projectId);
    const runtime: ActiveRuntime = {
      token,
      key,
      projectId: desired.projectId,
      projectRevision: desired.revision,
      kind,
      root: null,
      rootUri: null,
      client,
      coordinator: null,
      unsubscribe: () => {},
      documents: new Map(),
      expectedStop: false,
      ready: false,
      protocolReady: false,
      failed: false,
      cleanupFailed: false,
      restartHandle: null,
      stableHandle: null,
      intelligenceHandle: null,
      intelligenceIdentityKey: null,
      deactivateInteractive: null,
    };
    runtime.unsubscribe = client.subscribe((event) =>
      this.handleClientEvent(runtime, event),
    );
    this.runtime = runtime;
    this.store.getState().setLanguageService({
      kind,
      readiness: this.restartAttempts > 0 ? "restarting" : "starting",
      capabilities: null,
      failure: null,
      reason: "Starting and initializing the project language service.",
      restartAttempt: this.restartAttempts,
    });
    for (const feature of PROJECT_ANALYSIS_FEATURES) {
      this.store
        .getState()
        .markFeatureNotRun(feature, "Language service is starting.");
    }

    try {
      await client.start({
        runtimeProfile,
        clientInfo: { name: "Oleafly" },
      });
    } catch (error) {
      if (
        this.operationIsCurrent(operation, desired) &&
        this.runtime === runtime &&
        !runtime.expectedStop
      ) {
        runtime.failed = true;
        if (isLanguageServiceSetupRequiredError(error)) {
          this.publishSetupRequired(
            kind,
            safeLanguageServiceFailure(error),
            "Language-service setup is required before project analysis can run.",
          );
        } else {
          this.publishUnavailable(
            safeLanguageServiceFailure(error),
            "The project language service could not be started.",
          );
        }
      }
      await this.teardownRuntime(runtime);
      return;
    }

    if (
      !this.operationIsCurrent(operation, desired) ||
      this.runtime !== runtime ||
      !client.workspaceRoot ||
      !client.rootUri
    ) {
      await this.teardownRuntime(runtime);
      return;
    }

    runtime.root = client.workspaceRoot;
    runtime.rootUri = client.rootUri;
    runtime.protocolReady = true;
    runtime.coordinator = this.createCoordinator(client, this.store);
    runtime.coordinator.activateProject({
      projectId: runtime.projectId,
      projectRevision: desired.revision,
    });
    this.lastIndex = null;
    this.publishLocalDocuments(desired);
    this.publishIndex(desired);
    this.publishSyncing(runtime);
    const synchronized = await this.syncDocuments(
      runtime,
      desired,
      operation,
    );
    if (
      !synchronized ||
      !this.operationIsCurrent(operation, desired) ||
      this.runtime !== runtime
    ) {
      if (
        !this.runtimeOperationIsCurrent(
          runtime,
          operation,
          desired,
        ) &&
        !runtime.failed
      ) {
        await this.teardownRuntime(runtime);
      }
      return;
    }
    this.markRuntimeReady(runtime);
  }

  private async syncDocuments(
    runtime: ActiveRuntime,
    desired: DesiredProject,
    operation: number,
  ): Promise<boolean> {
    const targetRevision = desired.revision;
    const targetTexts = desired.effectiveTexts;
    if (
      !runtime.root ||
      !this.synchronizationTargetIsCurrent(
        runtime,
        operation,
        desired,
        targetRevision,
        targetTexts,
      )
    ) {
      return false;
    }
    const wanted = new Map<
      string,
      { path: string; uri: string; text: string; languageId: "latex" | "typst" }
    >();
    const synchronizedUris = new Set<string>();
    for (const [path, text] of targetTexts) {
      const languageId = languageServiceLanguageIdForPath(
        runtime.kind,
        path,
      );
      if (!languageId) continue;
      const uri = fileUriForProjectPath(runtime.root, path);
      wanted.set(uri, { path, uri, text, languageId });
    }

    for (const uri of runtime.documents.keys()) {
      if (wanted.has(uri)) continue;
      if (runtime.client.state === "ready") {
        await runtime.client.closeDocument(uri);
      }
      runtime.documents.delete(uri);
      runtime.coordinator?.untrackDocument(uri);
      if (
        !this.synchronizationTargetIsCurrent(
          runtime,
          operation,
          desired,
          targetRevision,
          targetTexts,
        )
      ) {
        return false;
      }
    }

    for (const document of wanted.values()) {
      const tracked = runtime.documents.get(document.uri);
      if (!tracked) {
        const version = 1;
        runtime.coordinator?.trackDocument(document.uri, version);
        await runtime.client.openDocument(
          {
            uri: document.uri,
            languageId: document.languageId,
            version,
            text: document.text,
          },
          targetRevision,
        );
        runtime.documents.set(document.uri, {
          path: document.path,
          uri: document.uri,
          text: document.text,
          version,
        });
        synchronizedUris.add(document.uri);
        if (
          !this.synchronizationTargetIsCurrent(
            runtime,
            operation,
            desired,
            targetRevision,
            targetTexts,
          )
        ) {
          return false;
        }
        continue;
      }
      if (tracked.text === document.text) continue;
      const expectedVersion = tracked.version + 1;
      runtime.coordinator?.trackDocument(
        document.uri,
        expectedVersion,
      );
      const version = await runtime.client.replaceDocument(
        document.uri,
        document.text,
        targetRevision,
      );
      if (version !== expectedVersion) {
        throw new Error(
          "Language-service document version did not advance as expected",
        );
      }
      runtime.documents.set(document.uri, {
        ...tracked,
        text: document.text,
        version,
      });
      synchronizedUris.add(document.uri);
      if (
        !this.synchronizationTargetIsCurrent(
          runtime,
          operation,
          desired,
          targetRevision,
          targetTexts,
        )
      ) {
        return false;
      }
    }
    if (runtime.projectRevision !== targetRevision) {
      for (const uri of wanted.keys()) {
        if (synchronizedUris.has(uri)) continue;
        runtime.client.acknowledgeDocumentRevision(
          uri,
          targetRevision,
        );
      }
    }
    runtime.projectRevision = targetRevision;
    return this.synchronizationTargetIsCurrent(
      runtime,
      operation,
      desired,
      targetRevision,
      targetTexts,
    );
  }

  private publishLocalDocuments(desired: DesiredProject): void {
    const wanted = new Set<string>();
    for (const [path, text] of desired.effectiveTexts) {
      const reason = localOnlyReason(desired.snapshot.engineId, path);
      if (!reason) continue;
      wanted.add(path);
      const prior = this.localDocuments.get(path);
      const next = {
        uri: localDocumentUri(desired.projectId, path),
        text,
        version:
          prior && prior.text !== text ? prior.version + 1 : prior?.version ?? 1,
      };
      this.localDocuments.set(path, next);
      this.store
        .getState()
        .setLocalDocument(next.uri, next.version, reason);
    }
    for (const [path, document] of [...this.localDocuments]) {
      if (wanted.has(path)) continue;
      this.localDocuments.delete(path);
      this.store.getState().removeDocument(document.uri);
    }
  }

  private publishIndex(desired: DesiredProject): void {
    const index = desired.snapshot.index;
    if (!index) return;
    const identity = this.store.getState().snapshot.identity;
    if (
      identity.projectId !== desired.projectId ||
      identity.projectRevision !== desired.revision
    ) {
      return;
    }
    const building = desired.snapshot.indexBuilding === true;
    if (
      this.lastIndex?.index === index &&
      this.lastIndex.revision === desired.revision &&
      this.lastIndex.generation ===
        identity.languageServiceGeneration &&
      this.lastIndex.building === building
    ) {
      return;
    }
    if (
      this.indexShadow.sync(index, {
        ...(building
          ? {
              partialReason:
                "The local project index is still rebuilding.",
            }
          : {}),
      })
    ) {
      this.lastIndex = {
        index,
        revision: desired.revision,
        generation: identity.languageServiceGeneration,
        building,
      };
    }
  }

  private operationIsCurrent(
    operation: number,
    desired: DesiredProject,
  ): boolean {
    return (
      !this.disposed &&
      operation === this.operationToken &&
      this.desired === desired
    );
  }

  private runtimeOperationIsCurrent(
    runtime: ActiveRuntime,
    operation: number,
    desired: DesiredProject,
  ): boolean {
    return (
      this.operationIsCurrent(operation, desired) &&
      this.runtime === runtime &&
      !runtime.expectedStop &&
      !runtime.failed &&
      runtime.client.state === "ready"
    );
  }

  private synchronizationTargetIsCurrent(
    runtime: ActiveRuntime,
    operation: number,
    desired: DesiredProject,
    targetRevision: number,
    targetTexts: ReadonlyMap<string, string>,
  ): boolean {
    return (
      this.runtimeOperationIsCurrent(runtime, operation, desired) &&
      desired.revision === targetRevision &&
      desired.effectiveTexts === targetTexts
    );
  }

  private publishSyncing(runtime: ActiveRuntime): void {
    runtime.deactivateInteractive?.();
    runtime.deactivateInteractive = null;
    this.store.getState().setLanguageService({
      kind: runtime.kind,
      readiness: "syncing",
      capabilities: capabilitiesFor(runtime.client),
      failure: null,
      reason:
        "Language service is initialized and synchronizing project documents.",
      restartAttempt: this.restartAttempts,
    });
  }

  private markRuntimeReady(runtime: ActiveRuntime): void {
    if (runtime !== this.runtime || runtime.expectedStop) return;
    runtime.ready = true;
    runtime.failed = false;
    runtime.deactivateInteractive?.();
    runtime.deactivateInteractive = null;
    if (runtime.client instanceof LanguageServiceClient) {
      runtime.deactivateInteractive =
        activateInteractiveLanguageService({
          owner: runtime,
          projectId: runtime.projectId,
          projectRevision: runtime.projectRevision,
          kind: runtime.kind,
          positionEncoding: runtime.client.positionEncoding,
          client: runtime.client,
          documentForPath: (path) => {
            const normalizedPath = path.replace(/\\/g, "/");
            for (const document of runtime.documents.values()) {
              if (
                document.path.replace(/\\/g, "/") === normalizedPath
              ) {
                return { ...document };
              }
            }
            return null;
          },
        });
    }
    this.store.getState().setLanguageService({
      kind: runtime.kind,
      readiness: "ready",
      capabilities: capabilitiesFor(runtime.client),
      failure: null,
      reason: "Language service is synchronized and ready.",
      restartAttempt: this.restartAttempts,
    });
    this.scheduleLanguageServiceIntelligence(runtime);
    if (runtime.stableHandle !== null) {
      this.scheduler.clearTimeout(runtime.stableHandle);
    }
    runtime.stableHandle = this.scheduler.setTimeout(() => {
      if (
        runtime !== this.runtime ||
        runtime.expectedStop ||
        runtime.failed ||
        !runtime.ready
      ) {
        return;
      }
      runtime.stableHandle = null;
      this.restartAttempts = 0;
      this.store.getState().setLanguageService({
        restartAttempt: 0,
      });
    }, this.restartStableWindowMs);
  }

  private scheduleLanguageServiceIntelligence(
    runtime: ActiveRuntime,
  ): void {
    const desired = this.desired;
    const requestWorkspaceSymbols =
      runtime.client.requestWorkspaceSymbols;
    if (
      runtime !== this.runtime ||
      runtime.expectedStop ||
      !runtime.ready ||
      !desired ||
      desired.projectId !== runtime.projectId ||
      desired.revision !== runtime.projectRevision ||
      !runtime.root ||
      !requestWorkspaceSymbols ||
      !runtime.client.supports("workspaceSymbols")
    ) {
      return;
    }
    const identity =
      useIndexStore.getState().intelligenceState.identity;
    if (!identity || identity.projectId !== runtime.projectId) {
      return;
    }
    const identityKey = [
      identity.projectId,
      identity.projectRevision,
      identity.requestGeneration,
      runtime.projectRevision,
      runtime.client.generation,
    ].join("\0");
    if (runtime.intelligenceIdentityKey === identityKey) return;
    runtime.intelligenceIdentityKey = identityKey;
    if (runtime.intelligenceHandle !== null) {
      this.scheduler.clearTimeout(runtime.intelligenceHandle);
    }
    runtime.intelligenceHandle = this.scheduler.setTimeout(() => {
      runtime.intelligenceHandle = null;
      void this.mergeLanguageServiceIntelligence(
        runtime,
        desired,
        identity,
        identityKey,
      );
    }, LANGUAGE_SERVICE_INTELLIGENCE_DELAY_MS);
  }

  private async mergeLanguageServiceIntelligence(
    runtime: ActiveRuntime,
    desired: DesiredProject,
    identity: ProjectIntelligenceIdentity,
    identityKey: string,
  ): Promise<void> {
    const requestWorkspaceSymbols =
      runtime.client.requestWorkspaceSymbols;
    if (
      !requestWorkspaceSymbols ||
      runtime !== this.runtime ||
      runtime.expectedStop ||
      !runtime.ready ||
      this.desired !== desired ||
      desired.revision !== runtime.projectRevision ||
      !runtime.root
    ) {
      return;
    }
    try {
      const symbols = await requestWorkspaceSymbols.call(
        runtime.client,
        { query: "" },
        {
          projectRevision: runtime.projectRevision,
          timeoutMs: LANGUAGE_SERVICE_INTELLIGENCE_TIMEOUT_MS,
        },
      );
      const latestIdentity =
        useIndexStore.getState().intelligenceState.identity;
      if (
        runtime !== this.runtime ||
        runtime.expectedStop ||
        !runtime.ready ||
        this.desired !== desired ||
        desired.revision !== runtime.projectRevision ||
        !latestIdentity ||
        latestIdentity.projectId !== identity.projectId ||
        latestIdentity.projectRevision !==
          identity.projectRevision ||
        latestIdentity.requestGeneration !==
          identity.requestGeneration
      ) {
        return;
      }
      useIndexStore.getState().mergeLanguageService(
        languageServiceContribution({
          identity,
          provider: runtime.kind,
          workspaceRoot: runtime.root,
          texts: desired.effectiveTexts,
          positionEncoding: runtime.client.positionEncoding,
          symbols,
        }),
      );
    } catch {
      // Local project intelligence stays authoritative and available. Clear
      // this attempt so a later current-revision index publication can retry
      // without turning an optional server enrichment into a restart loop.
      if (runtime.intelligenceIdentityKey === identityKey) {
        runtime.intelligenceIdentityKey = null;
      }
    }
  }

  private handleClientEvent(
    runtime: ActiveRuntime,
    event: LanguageServiceClientEvent,
  ): void {
    if (
      event.type !== "status" ||
      runtime !== this.runtime ||
      runtime.expectedStop ||
      event.generation !== runtime.client.generation ||
      !runtime.protocolReady
    ) {
      return;
    }
    if (event.state !== "exited" && event.state !== "error") return;
    if (runtime.failed || runtime.restartHandle !== null) return;
    runtime.failed = true;
    runtime.ready = false;
    runtime.deactivateInteractive?.();
    runtime.deactivateInteractive = null;
    if (runtime.stableHandle !== null) {
      this.scheduler.clearTimeout(runtime.stableHandle);
      runtime.stableHandle = null;
    }
    if (runtime.intelligenceHandle !== null) {
      this.scheduler.clearTimeout(runtime.intelligenceHandle);
      runtime.intelligenceHandle = null;
    }
    const failure = normalizeAnalysisFailure(
      event.error ??
        new Error("The language-service process exited unexpectedly."),
    );
    if (this.restartAttempts >= this.maxRestartAttempts) {
      this.publishUnavailable(
        { ...failure, retryable: false },
        "The language service repeatedly exited and automatic restart was stopped.",
      );
      return;
    }

    const attempt = ++this.restartAttempts;
    const delay = Math.min(
      this.restartMaxDelayMs,
      this.restartBaseDelayMs * 2 ** (attempt - 1),
    );
    this.store.getState().setLanguageService({
      kind: runtime.kind,
      readiness: "restarting",
      capabilities: null,
      failure,
      reason: `Language service exited unexpectedly. Restart ${attempt} is scheduled.`,
      restartAttempt: attempt,
    });
    runtime.restartHandle = this.scheduler.setTimeout(() => {
      if (
        runtime !== this.runtime ||
        runtime.expectedStop ||
        this.disposed
      ) {
        return;
      }
      runtime.restartHandle = null;
      this.forcedRestartToken = runtime.token;
      const operation = ++this.operationToken;
      this.enqueueReconcile(operation);
    }, delay);
  }

  private async teardownRuntime(
    runtime: ActiveRuntime | null,
  ): Promise<void> {
    if (!runtime) return;
    runtime.cleanupFailed = false;
    runtime.expectedStop = true;
    if (runtime.restartHandle !== null) {
      this.scheduler.clearTimeout(runtime.restartHandle);
      runtime.restartHandle = null;
    }
    if (runtime.stableHandle !== null) {
      this.scheduler.clearTimeout(runtime.stableHandle);
      runtime.stableHandle = null;
    }
    if (runtime.intelligenceHandle !== null) {
      this.scheduler.clearTimeout(runtime.intelligenceHandle);
      runtime.intelligenceHandle = null;
    }
    runtime.unsubscribe();
    runtime.deactivateInteractive?.();
    runtime.deactivateInteractive = null;
    runtime.coordinator?.dispose();
    runtime.coordinator = null;
    if (runtime.client.state === "ready") {
      for (const uri of runtime.documents.keys()) {
        try {
          await runtime.client.closeDocument(uri);
        } catch {
          // Continue closing the remaining documents and stop the process.
        }
      }
    }
    runtime.documents.clear();
    let stopFailure: unknown = null;
    try {
      await runtime.client.stop();
    } catch {
      try {
        // LanguageServiceClient retains a failed transport cleanup identity,
        // so one bounded retry can finish teardown without losing ownership.
        await runtime.client.stop();
      } catch (error) {
        stopFailure = error;
      }
    }
    if (stopFailure) {
      runtime.cleanupFailed = true;
      throw stopFailure;
    }
    if (this.runtime === runtime) this.runtime = null;
  }

  private detachRuntime(runtime: ActiveRuntime | null): void {
    if (!runtime || runtime.expectedStop) return;
    runtime.expectedStop = true;
    if (runtime.restartHandle !== null) {
      this.scheduler.clearTimeout(runtime.restartHandle);
      runtime.restartHandle = null;
    }
    if (runtime.stableHandle !== null) {
      this.scheduler.clearTimeout(runtime.stableHandle);
      runtime.stableHandle = null;
    }
    if (runtime.intelligenceHandle !== null) {
      this.scheduler.clearTimeout(runtime.intelligenceHandle);
      runtime.intelligenceHandle = null;
    }
    runtime.unsubscribe();
    runtime.deactivateInteractive?.();
    runtime.deactivateInteractive = null;
    runtime.coordinator?.dispose();
    runtime.coordinator = null;
  }

  private cancelRestart(): void {
    const runtime = this.runtime;
    if (runtime?.restartHandle !== null && runtime?.restartHandle !== undefined) {
      this.scheduler.clearTimeout(runtime.restartHandle);
      runtime.restartHandle = null;
    }
    this.forcedRestartToken = null;
  }

  private publishLocalOnly(reason: string): void {
    this.store.getState().setLanguageService({
      kind: null,
      readiness: "local_only",
      capabilities: null,
      failure: null,
      reason,
      restartAttempt: 0,
    });
    for (const feature of PROJECT_ANALYSIS_FEATURES) {
      this.store.getState().markFeatureUnsupported(feature, reason);
    }
  }

  private publishInstalling(
    kind: LanguageServiceKind,
    reason?: string,
  ): void {
    this.store.getState().setLanguageService({
      kind,
      readiness: "installing",
      capabilities: null,
      failure: null,
      reason:
        reason ?? "The pinned language service is being installed.",
      restartAttempt: 0,
    });
    for (const feature of PROJECT_ANALYSIS_FEATURES) {
      this.store
        .getState()
        .markFeatureNotRun(feature, "Language-service setup is running.");
    }
  }

  private publishSetupRequired(
    kind: LanguageServiceKind,
    failure: AnalysisFailure,
    reason: string,
  ): void {
    this.store.getState().setLanguageService({
      kind,
      readiness: "setup_required",
      capabilities: null,
      failure,
      reason,
      restartAttempt: 0,
    });
    for (const feature of PROJECT_ANALYSIS_FEATURES) {
      this.store
        .getState()
        .markFeatureUnavailable(feature, failure.message, true);
    }
  }

  private publishNotRun(reason: string): void {
    this.store.getState().setLanguageService({
      kind: null,
      readiness: "not_run",
      capabilities: null,
      failure: null,
      reason,
      restartAttempt: 0,
    });
    for (const feature of PROJECT_ANALYSIS_FEATURES) {
      this.store.getState().markFeatureNotRun(feature, reason);
    }
  }

  private publishUnavailable(
    failure: AnalysisFailure,
    reason: string,
  ): void {
    this.store.getState().setLanguageService({
      kind: this.runtime?.kind ?? null,
      readiness: "unavailable",
      capabilities: null,
      failure,
      reason,
      restartAttempt: this.restartAttempts,
    });
    for (const feature of PROJECT_ANALYSIS_FEATURES) {
      this.store
        .getState()
        .markFeatureUnavailable(feature, failure.message, failure.retryable);
    }
  }
}
