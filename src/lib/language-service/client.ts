import {
  isJsonRpcErrorResponse,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcSuccessResponse,
  JsonRpcProtocolError,
  JsonRpcRemoteError,
  parseJsonRpcMessage,
  toJsonValue,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonValue,
} from "./json-rpc";
import {
  createInitializeParams,
  EMPTY_SERVER_CAPABILITIES,
  isPublishDiagnosticsParams,
  negotiateServerCapabilities,
  type CompletionParams,
  type DefinitionParams,
  type Diagnostic,
  type DidChangeTextDocumentParams,
  type DidCloseTextDocumentParams,
  type DidOpenTextDocumentParams,
  type DidSaveTextDocumentParams,
  type DocumentDiagnosticParams,
  type DocumentSymbolParams,
  type HoverParams,
  type ClientInfo,
  type NegotiatedServerCapabilities,
  type PublishDiagnosticsParams,
  type ReferenceParams,
  type SemanticTokensParams,
  type SemanticTokensRangeParams,
  type TextDocumentContentChangeEvent,
  type TextDocumentItem,
  type WorkspaceDiagnosticParams,
  type WorkspaceSymbolParams,
} from "./protocol";
import type { LanguageServiceRuntimeProfile } from "./runtime-profile";
import {
  TextPositionIndex,
  type PositionEncoding,
} from "./position";
import type {
  LanguageServiceKind,
  LanguageServiceSession,
  LanguageServiceRuntimeSession,
  LanguageServiceTransport,
  LanguageServiceTransportEvent,
} from "./transport";

export type LanguageServiceClientState =
  | "stopped"
  | "starting"
  | "initializing"
  | "ready"
  | "stopping"
  | "exited"
  | "error";

export type LanguageServiceFeature =
  | "completion"
  | "hover"
  | "definition"
  | "references"
  | "documentSymbols"
  | "workspaceSymbols"
  | "documentDiagnostics"
  | "workspaceDiagnostics"
  | "semanticTokensFull"
  | "semanticTokensRange";

export interface LanguageServiceRequestIdentity {
  session: string;
  generation: number;
  requestGeneration: number;
  projectRevision?: number;
  documentUri?: string;
  documentVersion?: number;
}

export interface LanguageServiceRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  projectRevision?: number;
  documentUri?: string;
  documentVersion?: number;
}

export interface LanguageServiceClientOptions {
  transport: LanguageServiceTransport;
  kind: LanguageServiceKind;
  projectId: string;
  requestTimeoutMs?: number;
  positionEncodings?: PositionEncoding[];
  diagnosticQuietWindowMs?: number;
}

export interface LanguageServiceClientStartOptions {
  runtimeProfile: LanguageServiceRuntimeProfile;
  clientInfo?: ClientInfo;
  locale?: string;
}

export interface OpenDocumentSnapshot {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

export interface LanguageServiceDiagnosticsEvent {
  type: "diagnostics";
  params: PublishDiagnosticsParams;
  diagnostics: Diagnostic[];
  identity: LanguageServiceRequestIdentity;
  diagnosticEpoch: number;
  acknowledged: true;
}

export interface LanguageServiceDiagnosticsPendingEvent {
  type: "diagnosticsPending";
  uri: string;
  identity: LanguageServiceRequestIdentity;
  diagnosticEpoch: number;
}

export interface LanguageServiceStatusEvent {
  type: "status";
  state: LanguageServiceClientState;
  generation: number;
  session: string | null;
  error?: Error;
}

export interface LanguageServiceNotificationEvent {
  type: "notification";
  method: string;
  params?: JsonValue;
  generation: number;
}

export interface LanguageServiceDiscardedEvent {
  type: "discarded";
  reason: string;
  method?: string;
  generation: number;
}

export interface LanguageServiceClientLogEvent {
  type: "log";
  stream: "stdout" | "stderr";
  message: string;
  generation: number;
}

export type LanguageServiceClientEvent =
  | LanguageServiceDiagnosticsEvent
  | LanguageServiceDiagnosticsPendingEvent
  | LanguageServiceStatusEvent
  | LanguageServiceNotificationEvent
  | LanguageServiceDiscardedEvent
  | LanguageServiceClientLogEvent;

export type LanguageServiceClientListener = (
  event: LanguageServiceClientEvent,
) => void;

export class LanguageServiceStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LanguageServiceStateError";
  }
}

export class UnsupportedLanguageServiceCapabilityError extends Error {
  readonly feature: LanguageServiceFeature;

  constructor(feature: LanguageServiceFeature) {
    super(`Language server did not advertise ${feature}`);
    this.name = "UnsupportedLanguageServiceCapabilityError";
    this.feature = feature;
  }
}

export class LanguageServiceTimeoutError extends Error {
  readonly method: string;
  readonly timeoutMs: number;

  constructor(method: string, timeoutMs: number) {
    super(`Language service request ${method} timed out after ${timeoutMs} ms`);
    this.name = "LanguageServiceTimeoutError";
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

export class LanguageServiceAbortError extends Error {
  readonly method: string;

  constructor(method: string) {
    super(`Language service request ${method} was aborted`);
    this.name = "LanguageServiceAbortError";
    this.method = method;
  }
}

export class LanguageServiceExitedError extends Error {
  constructor(message = "Language service exited") {
    super(message);
    this.name = "LanguageServiceExitedError";
  }
}

export class StaleLanguageServiceResultError extends Error {
  readonly identity: LanguageServiceRequestIdentity;

  constructor(identity: LanguageServiceRequestIdentity, reason: string) {
    super(`Discarded stale language service result: ${reason}`);
    this.name = "StaleLanguageServiceResultError";
    this.identity = identity;
  }
}

interface PendingRequest {
  id: JsonRpcId;
  method: string;
  identity: LanguageServiceRequestIdentity;
  resolve: (value: JsonValue) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  signal?: AbortSignal;
  abortListener?: () => void;
  latestWinsKey?: string;
}

interface TrackedDocument {
  languageId: string;
  version: number;
  text: string;
}

interface DiagnosticCandidate {
  params: PublishDiagnosticsParams;
}

interface DiagnosticEpoch {
  epoch: number;
  session: string;
  generation: number;
  projectRevision: number;
  documentVersion: number;
  barrierAcknowledged: boolean;
  candidate: DiagnosticCandidate | null;
  quietTimer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_DIAGNOSTIC_QUIET_WINDOW_MS = 75;
const MAX_EARLY_TRANSPORT_EVENTS = 256;
const DEFAULT_ENCODINGS: PositionEncoding[] = [
  "utf-8",
  "utf-16",
  "utf-32",
];

function errorFromUnknown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function cloneCapabilities(
  capabilities: NegotiatedServerCapabilities,
): NegotiatedServerCapabilities {
  return {
    ...capabilities,
    diagnostics: { ...capabilities.diagnostics },
    textDocumentSync: {
      ...capabilities.textDocumentSync,
      save: { ...capabilities.textDocumentSync.save },
    },
    semanticTokens: {
      ...capabilities.semanticTokens,
      legend: capabilities.semanticTokens.legend
        ? {
            tokenTypes: [...capabilities.semanticTokens.legend.tokenTypes],
            tokenModifiers: [
              ...capabilities.semanticTokens.legend.tokenModifiers,
            ],
          }
        : null,
    },
  };
}

function fileUriForWorkspaceRoot(workspaceRoot: string): string {
  const normalized = workspaceRoot.replace(/\\/g, "/");
  const absolute = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${absolute
    .split("/")
    .map((segment) =>
      /^[A-Za-z]:$/.test(segment)
        ? segment
        : encodeURIComponent(segment),
    )
    .join("/")}`;
}

function safeCommonPrefixLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  let offset = 0;
  while (offset < max && left.charCodeAt(offset) === right.charCodeAt(offset)) {
    offset += 1;
  }
  if (
    offset > 0 &&
    offset < left.length &&
    left.charCodeAt(offset - 1) >= 0xd800 &&
    left.charCodeAt(offset - 1) <= 0xdbff
  ) {
    offset -= 1;
  }
  return offset;
}

function safeCommonSuffixLength(
  left: string,
  right: string,
  prefixLength: number,
): number {
  const max = Math.min(left.length, right.length) - prefixLength;
  let length = 0;
  while (
    length < max &&
    left.charCodeAt(left.length - length - 1) ===
      right.charCodeAt(right.length - length - 1)
  ) {
    length += 1;
  }
  const leftStart = left.length - length;
  if (
    length > 0 &&
    leftStart > 0 &&
    leftStart < left.length &&
    left.charCodeAt(leftStart) >= 0xdc00 &&
    left.charCodeAt(leftStart) <= 0xdfff
  ) {
    length -= 1;
  }
  return length;
}

/** Builds the one-range edit required by LSP incremental synchronization. */
export function createIncrementalContentChange(
  previousText: string,
  nextText: string,
  encoding: PositionEncoding,
): TextDocumentContentChangeEvent {
  const prefixLength = safeCommonPrefixLength(previousText, nextText);
  const suffixLength = safeCommonSuffixLength(
    previousText,
    nextText,
    prefixLength,
  );
  const previousEnd = previousText.length - suffixLength;
  const nextEnd = nextText.length - suffixLength;
  const index = new TextPositionIndex(previousText);
  return {
    range: {
      start: index.offsetToPosition(prefixLength, encoding),
      end: index.offsetToPosition(previousEnd, encoding),
    },
    text: nextText.slice(prefixLength, nextEnd),
  };
}

export class LanguageServiceClient {
  private readonly transport: LanguageServiceTransport;
  private readonly kind: LanguageServiceKind;
  private readonly projectId: string;
  private readonly defaultTimeoutMs: number;
  private readonly diagnosticQuietWindowMs: number;
  private readonly offeredPositionEncodings: PositionEncoding[];
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly latestRequestByKey = new Map<string, JsonRpcId>();
  private readonly documents = new Map<string, TrackedDocument>();
  private readonly diagnosticEpochs = new Map<string, DiagnosticEpoch>();
  private readonly listeners = new Set<LanguageServiceClientListener>();

  private clientState: LanguageServiceClientState = "stopped";
  private activeSession: LanguageServiceRuntimeSession | null = null;
  private readonly cleanupSessions = new Map<
    string,
    LanguageServiceRuntimeSession
  >();
  private generationValue = 0;
  private nextRequestId = 1;
  private nextRequestGeneration = 1;
  private projectRevisionValue = 0;
  private negotiated = cloneCapabilities(EMPTY_SERVER_CAPABILITIES);
  private lastStartOptions: LanguageServiceClientStartOptions | null = null;
  private lifecycleOperation = 0;
  private startPending = false;

  constructor(options: LanguageServiceClientOptions) {
    this.transport = options.transport;
    this.kind = options.kind;
    this.projectId = options.projectId;
    if (!this.projectId.trim()) {
      throw new RangeError("projectId is required");
    }
    this.defaultTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (
      !Number.isFinite(this.defaultTimeoutMs) ||
      this.defaultTimeoutMs <= 0
    ) {
      throw new RangeError("requestTimeoutMs must be positive");
    }
    this.diagnosticQuietWindowMs =
      options.diagnosticQuietWindowMs ??
      DEFAULT_DIAGNOSTIC_QUIET_WINDOW_MS;
    if (
      !Number.isFinite(this.diagnosticQuietWindowMs) ||
      this.diagnosticQuietWindowMs < 0
    ) {
      throw new RangeError(
        "diagnosticQuietWindowMs must be a non-negative number",
      );
    }
    const encodings = options.positionEncodings ?? DEFAULT_ENCODINGS;
    this.offeredPositionEncodings = [...new Set(encodings)];
    if (this.offeredPositionEncodings.length === 0) {
      throw new RangeError("At least one position encoding must be offered");
    }
  }

  get state(): LanguageServiceClientState {
    return this.clientState;
  }

  get generation(): number {
    return this.generationValue;
  }

  get session(): LanguageServiceRuntimeSession | null {
    return this.activeSession ? { ...this.activeSession } : null;
  }

  get workspaceRoot(): string | null {
    return this.activeSession?.workspaceRoot ?? null;
  }

  get rootUri(): string | null {
    return this.activeSession
      ? fileUriForWorkspaceRoot(this.activeSession.workspaceRoot)
      : null;
  }

  get projectRevision(): number {
    return this.projectRevisionValue;
  }

  get capabilities(): NegotiatedServerCapabilities {
    return cloneCapabilities(this.negotiated);
  }

  get positionEncoding(): PositionEncoding {
    return this.negotiated.positionEncoding;
  }

  subscribe(listener: LanguageServiceClientListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  status() {
    return {
      state: this.clientState,
      session: this.session,
      generation: this.generationValue,
      projectRevision: this.projectRevisionValue,
      transport: this.transport.status(),
    };
  }

  async refreshTransportStatus() {
    const session = this.requireSession();
    return this.transport.refreshStatus(session);
  }

  getDocument(uri: string): OpenDocumentSnapshot | null {
    const document = this.documents.get(uri);
    return document ? { uri, ...document } : null;
  }

  setProjectRevision(revision: number): void {
    if (!Number.isInteger(revision) || revision < 0) {
      throw new RangeError("projectRevision must be a non-negative integer");
    }
    if (revision === this.projectRevisionValue) return;
    this.projectRevisionValue = revision;
    this.rejectWhere(
      (pending) =>
        pending.identity.projectRevision !== undefined &&
        pending.identity.projectRevision !== revision,
      (pending) =>
        new StaleLanguageServiceResultError(
          pending.identity,
          "project revision changed",
        ),
    );
  }

  advanceProjectRevision(): number {
    this.setProjectRevision(this.projectRevisionValue + 1);
    return this.projectRevisionValue;
  }

  supports(feature: LanguageServiceFeature): boolean {
    switch (feature) {
      case "completion":
        return this.negotiated.completion;
      case "hover":
        return this.negotiated.hover;
      case "definition":
        return this.negotiated.definition;
      case "references":
        return this.negotiated.references;
      case "documentSymbols":
        return this.negotiated.documentSymbols;
      case "workspaceSymbols":
        return this.negotiated.workspaceSymbols;
      case "documentDiagnostics":
        return this.negotiated.diagnostics.document;
      case "workspaceDiagnostics":
        return this.negotiated.diagnostics.workspace;
      case "semanticTokensFull":
        return this.negotiated.semanticTokens.full;
      case "semanticTokensRange":
        return this.negotiated.semanticTokens.range;
    }
  }

  async start(options: LanguageServiceClientStartOptions): Promise<void> {
    if (this.startPending) {
      throw new LanguageServiceStateError(
        "A language-service start operation is already pending",
      );
    }
    this.startPending = true;
    try {
      await this.startOnce(options);
    } finally {
      this.startPending = false;
    }
  }

  private async startOnce(
    options: LanguageServiceClientStartOptions,
  ): Promise<void> {
    if (
      this.clientState !== "stopped" &&
      this.clientState !== "exited" &&
      this.clientState !== "error"
    ) {
      throw new LanguageServiceStateError(
        `Cannot start language service while ${this.clientState}`,
      );
    }
    if (options.runtimeProfile.kind !== this.kind) {
      throw new LanguageServiceStateError(
        `Runtime profile ${options.runtimeProfile.kind} does not match client ${this.kind}`,
      );
    }

    const operation = ++this.lifecycleOperation;
    const cleanupError = await this.stopCleanupSessions();
    this.ensureCurrentLifecycleOperation(operation);
    if (cleanupError) {
      this.setState("error", cleanupError);
      throw cleanupError;
    }
    this.documents.clear();
    this.clearDiagnosticEpochs();
    this.negotiated = cloneCapabilities(EMPTY_SERVER_CAPABILITIES);
    this.lastStartOptions = options;
    this.setState("starting");

    let session: LanguageServiceRuntimeSession | null = null;
    const earlyEvents: LanguageServiceTransportEvent[] = [];
    let earlyEventsOverflowed = false;
    let acceptingEvents = false;
    try {
      session = await this.transport.start(
        {
          kind: this.kind,
          projectId: this.projectId,
        },
        (event) => {
          if (!acceptingEvents) {
            if (earlyEvents.length >= MAX_EARLY_TRANSPORT_EVENTS) {
              earlyEventsOverflowed = true;
              return;
            }
            earlyEvents.push(event);
            return;
          }
          this.handleTransportEvent(event);
        },
      );
      if (earlyEventsOverflowed) {
        throw new LanguageServiceStateError(
          `Language-service startup exceeded the ${MAX_EARLY_TRANSPORT_EVENTS}-event client queue limit`,
        );
      }
      if (operation !== this.lifecycleOperation) {
        throw new LanguageServiceExitedError(
          "Language-service start was superseded",
        );
      }
      this.activeSession = session;
      this.generationValue = session.generation;
      acceptingEvents = true;
      for (const event of earlyEvents) this.handleTransportEvent(event);
      this.ensureCurrentSession(session);
      this.setState("initializing");
      const rootUri = fileUriForWorkspaceRoot(session.workspaceRoot);
      const initializeResult = await this.sendRequest(
        "initialize",
        createInitializeParams(
          {
            rootUri,
            clientInfo: options.clientInfo,
            locale: options.locale,
            initializationOptions:
              options.runtimeProfile.initializationOptions,
            workspaceFolders: [{ uri: rootUri, name: session.projectId }],
          },
          [...this.offeredPositionEncodings],
        ),
        { trackFreshness: false },
      );
      this.ensureCurrentLifecycleOperation(operation);
      this.ensureCurrentSession(session);
      this.negotiated = negotiateServerCapabilities(
        initializeResult,
        this.offeredPositionEncodings,
      );
      await this.sendNotification("initialized", {});
      this.ensureCurrentLifecycleOperation(operation);
      this.ensureCurrentSession(session);
      if (options.runtimeProfile.didChangeConfiguration) {
        await this.sendNotification(
          "workspace/didChangeConfiguration",
          options.runtimeProfile.didChangeConfiguration,
        );
        this.ensureCurrentLifecycleOperation(operation);
        this.ensureCurrentSession(session);
      }
      this.setState("ready");
    } catch (error) {
      const failure = errorFromUnknown(error);
      if (session) {
        this.cleanupSessions.set(session.session, session);
      }
      if (
        !session ||
        operation === this.lifecycleOperation ||
        this.activeSession?.session === session.session
      ) {
        this.rejectAll(failure);
        this.activeSession = null;
        this.negotiated = cloneCapabilities(EMPTY_SERVER_CAPABILITIES);
        this.documents.clear();
        this.clearDiagnosticEpochs();
        this.setState("error", failure);
      }
      await this.stopCleanupSessions();
      throw failure;
    }
  }

  async restart(
    options: LanguageServiceClientStartOptions | null = this.lastStartOptions,
  ): Promise<void> {
    if (!options) {
      throw new LanguageServiceStateError(
        "Cannot restart before initialization options are known",
      );
    }
    try {
      await this.stop();
    } catch {
      // Restart still invalidates the failed generation and attempts recovery.
    }
    await this.start(options);
  }

  async stop(): Promise<void> {
    this.lifecycleOperation += 1;
    const session = this.activeSession;
    if (!session && this.cleanupSessions.size === 0) {
      const cleanupError = await this.stopCleanupSessions();
      this.setState("stopped", cleanupError ?? undefined);
      if (cleanupError) throw cleanupError;
      return;
    }

    const wasReady = this.clientState === "ready";
    this.setState("stopping");
    this.rejectAll(
      new LanguageServiceExitedError(
        "Language service is stopping; pending results were invalidated",
      ),
    );
    let shutdownError: Error | null = null;
    if (session && wasReady) {
      try {
        await this.sendRequest("shutdown", null, {
          trackFreshness: false,
        });
      } catch (error) {
        shutdownError = errorFromUnknown(error);
      }
    }

    if (session && this.isCurrentSession(session)) {
      try {
        await this.sendNotification("exit");
      } catch (error) {
        shutdownError ??= errorFromUnknown(error);
      }
    }

    this.rejectAll(
      new LanguageServiceExitedError("Language service was stopped"),
    );
    if (session) {
      this.cleanupSessions.set(session.session, session);
      if (this.isCurrentSession(session)) this.activeSession = null;
    }
    const cleanupError = await this.stopCleanupSessions();
    shutdownError ??= cleanupError;
    this.documents.clear();
    this.clearDiagnosticEpochs();
    this.negotiated = cloneCapabilities(EMPTY_SERVER_CAPABILITIES);
    this.setState("stopped", shutdownError ?? undefined);
    if (shutdownError) throw shutdownError;
  }

  async exit(): Promise<void> {
    this.lifecycleOperation += 1;
    const session = this.activeSession;
    if (!session) {
      await this.stopCleanupSessions();
      return;
    }
    this.setState("stopping");
    let failure: Error | null = null;
    try {
      await this.sendNotification("exit");
    } catch (error) {
      failure = errorFromUnknown(error);
    } finally {
      this.rejectAll(new LanguageServiceExitedError());
      this.cleanupSessions.set(session.session, session);
      if (this.isCurrentSession(session)) this.activeSession = null;
      failure ??= await this.stopCleanupSessions();
      this.documents.clear();
      this.clearDiagnosticEpochs();
      this.negotiated = cloneCapabilities(EMPTY_SERVER_CAPABILITIES);
      this.setState("exited", failure ?? undefined);
    }
    if (failure) throw failure;
  }

  async didOpen(
    params: DidOpenTextDocumentParams,
    projectRevision = this.projectRevisionValue,
  ): Promise<void> {
    this.ensureReady();
    const item = params.textDocument;
    if (!Number.isInteger(item.version) || item.version < 0) {
      throw new RangeError(
        "Document version must be a non-negative integer",
      );
    }
    if (this.documents.has(item.uri)) {
      throw new LanguageServiceStateError(
        `Document is already open: ${item.uri}`,
      );
    }
    this.setProjectRevision(projectRevision);
    this.documents.set(item.uri, {
      languageId: item.languageId,
      version: item.version,
      text: item.text,
    });
    if (this.negotiated.textDocumentSync.openClose) {
      const epoch = this.beginDiagnosticEpoch(item.uri);
      await this.sendNotification("textDocument/didOpen", params);
      this.startDiagnosticBarrier(item.uri, epoch);
    }
  }

  async openDocument(
    textDocument: TextDocumentItem,
    projectRevision = this.projectRevisionValue,
  ): Promise<void> {
    await this.didOpen({ textDocument }, projectRevision);
  }

  async didChange(
    params: DidChangeTextDocumentParams,
    projectRevision = this.projectRevisionValue,
  ): Promise<void> {
    this.ensureReady();
    const current = this.documents.get(params.textDocument.uri);
    if (!current) {
      throw new LanguageServiceStateError(
        `Document is not open: ${params.textDocument.uri}`,
      );
    }
    if (
      !Number.isInteger(params.textDocument.version) ||
      params.textDocument.version <= current.version
    ) {
      throw new RangeError(
        "Document versions must increase monotonically",
      );
    }
    this.setProjectRevision(projectRevision);
    const text = this.applyContentChanges(
      current.text,
      params.contentChanges,
    );
    this.documents.set(params.textDocument.uri, {
      ...current,
      text,
      version: params.textDocument.version,
    });
    this.rejectDocumentVersion(
      params.textDocument.uri,
      params.textDocument.version,
    );
    const changeKind = this.negotiated.textDocumentSync.change;
    if (changeKind !== "none") {
      const contentChanges =
        changeKind === "full"
          ? [{ text }]
          : [
              createIncrementalContentChange(
                current.text,
                text,
                this.positionEncoding,
              ),
            ];
      const epoch = this.beginDiagnosticEpoch(params.textDocument.uri);
      await this.sendNotification("textDocument/didChange", {
        textDocument: params.textDocument,
        contentChanges,
      } satisfies DidChangeTextDocumentParams);
      this.startDiagnosticBarrier(params.textDocument.uri, epoch);
    }
  }

  async changeDocument(
    uri: string,
    contentChanges: TextDocumentContentChangeEvent[],
    projectRevision = this.projectRevisionValue,
  ): Promise<number> {
    const document = this.documents.get(uri);
    if (!document) {
      throw new LanguageServiceStateError(`Document is not open: ${uri}`);
    }
    const version = document.version + 1;
    await this.didChange(
      {
        textDocument: { uri, version },
        contentChanges,
      },
      projectRevision,
    );
    return version;
  }

  async replaceDocument(
    uri: string,
    text: string,
    projectRevision = this.projectRevisionValue,
  ): Promise<number> {
    return this.changeDocument(uri, [{ text }], projectRevision);
  }

  async didSave(params: DidSaveTextDocumentParams): Promise<void> {
    this.ensureReady();
    const document = this.documents.get(params.textDocument.uri);
    if (!document) {
      throw new LanguageServiceStateError(
        `Document is not open: ${params.textDocument.uri}`,
      );
    }
    const save = this.negotiated.textDocumentSync.save;
    if (!save.enabled) return;
    await this.sendNotification("textDocument/didSave", {
      textDocument: params.textDocument,
      ...(save.includeText ? { text: document.text } : {}),
    } satisfies DidSaveTextDocumentParams);
  }

  async saveDocument(uri: string): Promise<void> {
    await this.didSave({ textDocument: { uri } });
  }

  acknowledgeDocumentRevision(
    uri: string,
    projectRevision = this.projectRevisionValue,
  ): void {
    this.ensureReady();
    if (!this.documents.has(uri)) {
      throw new LanguageServiceStateError(
        `Document is not open: ${uri}`,
      );
    }
    this.setProjectRevision(projectRevision);
    const epoch = this.beginDiagnosticEpoch(uri);
    this.startDiagnosticBarrier(uri, epoch);
  }

  async didClose(params: DidCloseTextDocumentParams): Promise<void> {
    this.ensureReady();
    const uri = params.textDocument.uri;
    if (!this.documents.has(uri)) return;
    this.documents.delete(uri);
    this.clearDiagnosticEpoch(uri);
    this.rejectWhere(
      (pending) => pending.identity.documentUri === uri,
      (pending) =>
        new StaleLanguageServiceResultError(
          pending.identity,
          "document closed",
        ),
    );
    if (this.negotiated.textDocumentSync.openClose) {
      await this.sendNotification("textDocument/didClose", params);
    }
  }

  async closeDocument(uri: string): Promise<void> {
    await this.didClose({ textDocument: { uri } });
  }

  requestCompletion(
    params: CompletionParams,
    options: LanguageServiceRequestOptions = {},
  ): Promise<JsonValue> {
    return this.requestFeature(
      "completion",
      "textDocument/completion",
      params,
      params.textDocument.uri,
      options,
    );
  }

  requestHover(
    params: HoverParams,
    options: LanguageServiceRequestOptions = {},
  ): Promise<JsonValue> {
    return this.requestFeature(
      "hover",
      "textDocument/hover",
      params,
      params.textDocument.uri,
      options,
    );
  }

  requestDefinition(
    params: DefinitionParams,
    options: LanguageServiceRequestOptions = {},
  ): Promise<JsonValue> {
    return this.requestFeature(
      "definition",
      "textDocument/definition",
      params,
      params.textDocument.uri,
      options,
    );
  }

  requestReferences(
    params: ReferenceParams,
    options: LanguageServiceRequestOptions = {},
  ): Promise<JsonValue> {
    return this.requestFeature(
      "references",
      "textDocument/references",
      params,
      params.textDocument.uri,
      options,
    );
  }

  requestDocumentSymbols(
    params: DocumentSymbolParams,
    options: LanguageServiceRequestOptions = {},
  ): Promise<JsonValue> {
    return this.requestFeature(
      "documentSymbols",
      "textDocument/documentSymbol",
      params,
      params.textDocument.uri,
      options,
    );
  }

  requestWorkspaceSymbols(
    params: WorkspaceSymbolParams,
    options: LanguageServiceRequestOptions = {},
  ): Promise<JsonValue> {
    return this.requestFeature(
      "workspaceSymbols",
      "workspace/symbol",
      params,
      undefined,
      options,
    );
  }

  requestDocumentDiagnostics(
    params: DocumentDiagnosticParams,
    options: LanguageServiceRequestOptions = {},
  ): Promise<JsonValue> {
    return this.requestFeature(
      "documentDiagnostics",
      "textDocument/diagnostic",
      params,
      params.textDocument.uri,
      options,
    );
  }

  requestWorkspaceDiagnostics(
    params: WorkspaceDiagnosticParams,
    options: LanguageServiceRequestOptions = {},
  ): Promise<JsonValue> {
    return this.requestFeature(
      "workspaceDiagnostics",
      "workspace/diagnostic",
      params,
      undefined,
      options,
    );
  }

  requestSemanticTokensFull(
    params: SemanticTokensParams,
    options: LanguageServiceRequestOptions = {},
  ): Promise<JsonValue> {
    return this.requestFeature(
      "semanticTokensFull",
      "textDocument/semanticTokens/full",
      params,
      params.textDocument.uri,
      options,
    );
  }

  requestSemanticTokensRange(
    params: SemanticTokensRangeParams,
    options: LanguageServiceRequestOptions = {},
  ): Promise<JsonValue> {
    return this.requestFeature(
      "semanticTokensRange",
      "textDocument/semanticTokens/range",
      params,
      params.textDocument.uri,
      options,
    );
  }

  private requestFeature(
    feature: LanguageServiceFeature,
    method: string,
    params: unknown,
    documentUri: string | undefined,
    options: LanguageServiceRequestOptions,
  ): Promise<JsonValue> {
    this.ensureReady();
    if (!this.supports(feature)) {
      return Promise.reject(
        new UnsupportedLanguageServiceCapabilityError(feature),
      );
    }
    return this.sendRequest(method, params, {
      ...options,
      projectRevision:
        options.projectRevision ?? this.projectRevisionValue,
      documentUri: options.documentUri ?? documentUri,
      trackFreshness: true,
      latestWinsKey: `${feature}:${options.documentUri ?? documentUri ?? "workspace"}`,
    });
  }

  private sendRequest(
    method: string,
    params: unknown,
    options: LanguageServiceRequestOptions & {
      trackFreshness: boolean;
      latestWinsKey?: string;
    },
  ): Promise<JsonValue> {
    const session = this.requireSession();
    const id = this.nextRequestId++;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(
        new RangeError("Request timeout must be positive"),
      );
    }
    if (options.signal?.aborted) {
      return Promise.reject(new LanguageServiceAbortError(method));
    }

    let identity: LanguageServiceRequestIdentity;
    try {
      identity = this.captureIdentity(
        session,
        options.trackFreshness ? options : {},
      );
    } catch (error) {
      return Promise.reject(errorFromUnknown(error));
    }
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params: toJsonValue(params) }),
    };

    if (options.latestWinsKey) {
      const priorId = this.latestRequestByKey.get(options.latestWinsKey);
      const prior = priorId === undefined ? undefined : this.pending.get(priorId);
      if (prior) {
        this.cancelPending(
          prior.id,
          new StaleLanguageServiceResultError(
            prior.identity,
            "a newer request superseded this result",
          ),
        );
      }
    }

    return new Promise<JsonValue>((resolve, reject) => {
      const pending: PendingRequest = {
        id,
        method,
        identity,
        resolve,
        reject,
        timer: null,
        signal: options.signal,
        latestWinsKey: options.latestWinsKey,
      };
      pending.timer = setTimeout(() => {
        this.cancelPending(
          id,
          new LanguageServiceTimeoutError(method, timeoutMs),
        );
      }, timeoutMs);
      if (options.signal) {
        pending.abortListener = () =>
          this.cancelPending(id, new LanguageServiceAbortError(method));
        options.signal.addEventListener(
          "abort",
          pending.abortListener,
          { once: true },
        );
      }
      this.pending.set(id, pending);
      if (options.latestWinsKey) {
        this.latestRequestByKey.set(options.latestWinsKey, id);
      }

      void this.transport.send(session, request).catch((error) => {
        this.rejectPending(id, errorFromUnknown(error));
      });
    });
  }

  private async sendNotification(
    method: string,
    params?: unknown,
  ): Promise<void> {
    const session = this.requireSession();
    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params: toJsonValue(params) }),
    };
    await this.transport.send(session, notification);
  }

  private captureIdentity(
    session: LanguageServiceSession,
    options: LanguageServiceRequestOptions,
  ): LanguageServiceRequestIdentity {
    const projectRevision =
      options.projectRevision ?? this.projectRevisionValue;
    if (
      options.projectRevision !== undefined &&
      options.projectRevision !== this.projectRevisionValue
    ) {
      throw new StaleLanguageServiceResultError(
        {
          session: session.session,
          generation: session.generation,
          requestGeneration: this.nextRequestGeneration++,
          projectRevision,
        },
        "request was created for an old project revision",
      );
    }

    const identity: LanguageServiceRequestIdentity = {
      session: session.session,
      generation: session.generation,
      requestGeneration: this.nextRequestGeneration++,
      ...(options.projectRevision !== undefined ||
      options.documentUri !== undefined
        ? { projectRevision }
        : {}),
    };
    if (options.documentUri !== undefined) {
      const document = this.documents.get(options.documentUri);
      if (!document) {
        throw new LanguageServiceStateError(
          `Document is not open: ${options.documentUri}`,
        );
      }
      const version = options.documentVersion ?? document.version;
      if (version !== document.version) {
        throw new StaleLanguageServiceResultError(
          {
            ...identity,
            documentUri: options.documentUri,
            documentVersion: version,
          },
          "request was created for an old document version",
        );
      }
      identity.documentUri = options.documentUri;
      identity.documentVersion = version;
    }
    return identity;
  }

  private handleTransportEvent(event: LanguageServiceTransportEvent): void {
    if (!this.eventMatchesCurrentSession(event)) return;
    if (event.type === "log") {
      this.emit({
        type: "log",
        stream: event.stream,
        message: event.message,
        generation: event.generation,
      });
      return;
    }
    if (event.type === "error") {
      this.failCurrentSession(new Error(event.error));
      return;
    }
    if (event.type === "exit") {
      const suffix =
        event.code === null ? "" : ` with code ${event.code}`;
      this.failCurrentSession(
        new LanguageServiceExitedError(`Language service exited${suffix}`),
        "exited",
      );
      return;
    }

    let message: JsonRpcMessage;
    try {
      message = parseJsonRpcMessage(event.message);
    } catch (error) {
      this.failCurrentSession(errorFromUnknown(error));
      return;
    }
    if (
      isJsonRpcSuccessResponse(message) ||
      isJsonRpcErrorResponse(message)
    ) {
      if (message.id === null) {
        this.emit({
          type: "discarded",
          reason: "response had a null id",
          generation: event.generation,
        });
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) {
        this.emit({
          type: "discarded",
          reason: `response id ${String(message.id)} is not pending`,
          generation: event.generation,
        });
        return;
      }
      if (!this.identityIsCurrent(pending.identity)) {
        this.rejectPending(
          message.id,
          new StaleLanguageServiceResultError(
            pending.identity,
            "response identity no longer matches",
          ),
        );
        return;
      }
      if (isJsonRpcErrorResponse(message)) {
        this.rejectPending(
          message.id,
          new JsonRpcRemoteError(message.error),
        );
      } else {
        this.resolvePending(message.id, message.result);
      }
      return;
    }
    if (isJsonRpcRequest(message)) {
      this.rejectServerRequest(message);
      return;
    }
    if (isJsonRpcNotification(message)) {
      this.handleNotification(message);
    }
  }

  private handleNotification(notification: JsonRpcNotification): void {
    if (notification.method === "textDocument/publishDiagnostics") {
      if (!isPublishDiagnosticsParams(notification.params)) {
        this.emit({
          type: "discarded",
          reason: "publishDiagnostics payload is malformed",
          method: notification.method,
          generation: this.generationValue,
        });
        return;
      }
      const document = this.documents.get(notification.params.uri);
      if (!document) {
        this.emit({
          type: "discarded",
          reason: "diagnostics target is not an open document",
          method: notification.method,
          generation: this.generationValue,
        });
        return;
      }
      const epoch = this.diagnosticEpochs.get(notification.params.uri);
      if (
        !epoch ||
        !this.diagnosticEpochIsCurrent(notification.params.uri, epoch)
      ) {
        this.emit({
          type: "discarded",
          reason: "diagnostics have no current synchronization epoch",
          method: notification.method,
          generation: this.generationValue,
        });
        return;
      }
      if (notification.params.version !== undefined) {
        if (notification.params.version !== document.version) {
          this.emit({
            type: "discarded",
            reason: "diagnostics document version is stale",
            method: notification.method,
            generation: this.generationValue,
          });
          return;
        }
        epoch.candidate = null;
        if (epoch.quietTimer) {
          clearTimeout(epoch.quietTimer);
          epoch.quietTimer = null;
        }
        this.emitAcknowledgedDiagnostics(
          notification.params,
          document,
          epoch,
        );
      } else {
        // Both pinned servers publish unversioned diagnostics. Keep only the
        // latest candidate for this document epoch. A response to a request
        // serialized after didOpen/didChange acknowledges the epoch, and a
        // quiet window lets any older in-flight publication be replaced.
        epoch.candidate = { params: notification.params };
        if (epoch.barrierAcknowledged) {
          this.scheduleDiagnosticCandidate(notification.params.uri, epoch);
        }
      }
      return;
    }
    this.emit({
      type: "notification",
      method: notification.method,
      ...(notification.params === undefined
        ? {}
        : { params: notification.params }),
      generation: this.generationValue,
    });
  }

  private rejectServerRequest(request: JsonRpcRequest): void {
    const session = this.activeSession;
    if (!session) return;
    void this.transport
      .send(session, {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32601,
          message: `Method not found: ${request.method}`,
        },
      })
      .catch(() => {
        // A transport failure will be surfaced through its error/exit event.
      });
  }

  private beginDiagnosticEpoch(uri: string): DiagnosticEpoch {
    const session = this.requireSession();
    const document = this.documents.get(uri);
    if (!document) {
      throw new LanguageServiceStateError(`Document is not open: ${uri}`);
    }
    const previous = this.diagnosticEpochs.get(uri);
    if (previous?.quietTimer) clearTimeout(previous.quietTimer);
    const epoch: DiagnosticEpoch = {
      epoch: (previous?.epoch ?? 0) + 1,
      session: session.session,
      generation: session.generation,
      projectRevision: this.projectRevisionValue,
      documentVersion: document.version,
      barrierAcknowledged: false,
      candidate: null,
      quietTimer: null,
    };
    this.diagnosticEpochs.set(uri, epoch);
    this.emit({
      type: "diagnosticsPending",
      uri,
      diagnosticEpoch: epoch.epoch,
      identity: {
        session: session.session,
        generation: session.generation,
        requestGeneration: this.nextRequestGeneration++,
        projectRevision: epoch.projectRevision,
        documentUri: uri,
        documentVersion: epoch.documentVersion,
      },
    });
    return epoch;
  }

  private startDiagnosticBarrier(uri: string, epoch: DiagnosticEpoch): void {
    void this.sendRequest(
      "textDocument/documentSymbol",
      { textDocument: { uri } } satisfies DocumentSymbolParams,
      {
        trackFreshness: true,
        projectRevision: epoch.projectRevision,
        documentUri: uri,
        documentVersion: epoch.documentVersion,
        latestWinsKey: `diagnosticBarrier:${uri}`,
      },
    ).then(
      () => this.acknowledgeDiagnosticBarrier(uri, epoch),
      (error: unknown) => {
        if (error instanceof JsonRpcRemoteError) {
          // A JSON-RPC error is still a serialized server response and therefore
          // a valid barrier acknowledgement.
          this.acknowledgeDiagnosticBarrier(uri, epoch);
          return;
        }
        if (this.diagnosticEpochIsCurrent(uri, epoch)) {
          this.emit({
            type: "discarded",
            reason: `diagnostic barrier failed: ${errorFromUnknown(error).message}`,
            method: "textDocument/publishDiagnostics",
            generation: this.generationValue,
          });
        }
      },
    );
  }

  private acknowledgeDiagnosticBarrier(
    uri: string,
    epoch: DiagnosticEpoch,
  ): void {
    if (!this.diagnosticEpochIsCurrent(uri, epoch)) return;
    epoch.barrierAcknowledged = true;
    if (epoch.candidate) this.scheduleDiagnosticCandidate(uri, epoch);
  }

  private scheduleDiagnosticCandidate(
    uri: string,
    epoch: DiagnosticEpoch,
  ): void {
    if (epoch.quietTimer) clearTimeout(epoch.quietTimer);
    epoch.quietTimer = setTimeout(() => {
      epoch.quietTimer = null;
      if (
        !epoch.barrierAcknowledged ||
        !epoch.candidate ||
        !this.diagnosticEpochIsCurrent(uri, epoch)
      ) {
        return;
      }
      const document = this.documents.get(uri);
      if (!document) return;
      const candidate = epoch.candidate;
      epoch.candidate = null;
      this.emitAcknowledgedDiagnostics(candidate.params, document, epoch);
    }, this.diagnosticQuietWindowMs);
  }

  private emitAcknowledgedDiagnostics(
    params: PublishDiagnosticsParams,
    document: TrackedDocument,
    epoch: DiagnosticEpoch,
  ): void {
    if (!this.diagnosticEpochIsCurrent(params.uri, epoch)) return;
    this.emit({
      type: "diagnostics",
      params,
      diagnostics: params.diagnostics,
      diagnosticEpoch: epoch.epoch,
      acknowledged: true,
      identity: {
        session: epoch.session,
        generation: epoch.generation,
        requestGeneration: this.nextRequestGeneration++,
        projectRevision: epoch.projectRevision,
        documentUri: params.uri,
        documentVersion: document.version,
      },
    });
  }

  private diagnosticEpochIsCurrent(
    uri: string,
    epoch: DiagnosticEpoch,
  ): boolean {
    const document = this.documents.get(uri);
    return (
      this.diagnosticEpochs.get(uri) === epoch &&
      epoch.session === this.activeSession?.session &&
      epoch.generation === this.generationValue &&
      epoch.projectRevision === this.projectRevisionValue &&
      document?.version === epoch.documentVersion
    );
  }

  private clearDiagnosticEpoch(uri: string): void {
    const epoch = this.diagnosticEpochs.get(uri);
    if (epoch?.quietTimer) clearTimeout(epoch.quietTimer);
    this.diagnosticEpochs.delete(uri);
  }

  private clearDiagnosticEpochs(): void {
    for (const uri of [...this.diagnosticEpochs.keys()]) {
      this.clearDiagnosticEpoch(uri);
    }
  }

  private applyContentChanges(
    initialText: string,
    changes: TextDocumentContentChangeEvent[],
  ): string {
    let text = initialText;
    for (const change of changes) {
      if (!change.range) {
        text = change.text;
        continue;
      }
      const index = new TextPositionIndex(text);
      const from = index.positionToOffset(
        change.range.start,
        this.positionEncoding,
      );
      const to = index.positionToOffset(
        change.range.end,
        this.positionEncoding,
      );
      const start = Math.min(from, to);
      const end = Math.max(from, to);
      text = `${text.slice(0, start)}${change.text}${text.slice(end)}`;
    }
    return text;
  }

  private rejectDocumentVersion(uri: string, version: number): void {
    this.rejectWhere(
      (pending) =>
        pending.identity.documentUri === uri &&
        pending.identity.documentVersion !== version,
      (pending) =>
        new StaleLanguageServiceResultError(
          pending.identity,
          "document version changed",
        ),
    );
  }

  private cancelPending(id: JsonRpcId, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.cleanupPending(pending);
    this.pending.delete(id);
    pending.reject(error);
    const session = this.activeSession;
    if (!session || session.generation !== pending.identity.generation) {
      return;
    }
    void this.transport
      .send(session, {
        jsonrpc: "2.0",
        method: "$/cancelRequest",
        params: { id },
      })
      .catch(() => {
        // Cancellation is advisory; freshness checks remain authoritative.
      });
  }

  private resolvePending(id: JsonRpcId, value: JsonValue): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.cleanupPending(pending);
    this.pending.delete(id);
    pending.resolve(value);
  }

  private rejectPending(id: JsonRpcId, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.cleanupPending(pending);
    this.pending.delete(id);
    pending.reject(error);
  }

  private rejectAll(error: Error): void {
    for (const id of [...this.pending.keys()]) {
      this.rejectPending(id, error);
    }
  }

  private rejectWhere(
    predicate: (pending: PendingRequest) => boolean,
    createError: (pending: PendingRequest) => Error,
  ): void {
    for (const pending of [...this.pending.values()]) {
      if (predicate(pending)) {
        this.rejectPending(pending.id, createError(pending));
      }
    }
  }

  private cleanupPending(pending: PendingRequest): void {
    if (pending.timer) clearTimeout(pending.timer);
    if (
      pending.latestWinsKey &&
      this.latestRequestByKey.get(pending.latestWinsKey) === pending.id
    ) {
      this.latestRequestByKey.delete(pending.latestWinsKey);
    }
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener(
        "abort",
        pending.abortListener,
      );
    }
  }

  private identityIsCurrent(
    identity: LanguageServiceRequestIdentity,
  ): boolean {
    if (
      identity.generation !== this.generationValue ||
      identity.session !== this.activeSession?.session
    ) {
      return false;
    }
    if (
      identity.projectRevision !== undefined &&
      identity.projectRevision !== this.projectRevisionValue
    ) {
      return false;
    }
    if (identity.documentUri !== undefined) {
      const document = this.documents.get(identity.documentUri);
      if (
        !document ||
        document.version !== identity.documentVersion
      ) {
        return false;
      }
    }
    return true;
  }

  private eventMatchesCurrentSession(
    event: LanguageServiceTransportEvent,
  ): boolean {
    const session = this.activeSession;
    return Boolean(
      session &&
        event.session === session.session &&
        event.kind === session.kind &&
        event.generation === session.generation,
    );
  }

  private isCurrentSession(session: LanguageServiceSession): boolean {
    return (
      this.activeSession?.session === session.session &&
      this.activeSession.kind === session.kind &&
      this.activeSession.generation === session.generation
    );
  }

  private ensureCurrentSession(session: LanguageServiceSession): void {
    if (!this.isCurrentSession(session)) {
      throw new LanguageServiceExitedError(
        "Language service generation was invalidated",
      );
    }
  }

  private ensureCurrentLifecycleOperation(operation: number): void {
    if (operation !== this.lifecycleOperation) {
      throw new LanguageServiceExitedError(
        "Language-service lifecycle operation was superseded",
      );
    }
  }

  private requireSession(): LanguageServiceSession {
    if (!this.activeSession) {
      throw new LanguageServiceStateError(
        "Language service has no active session",
      );
    }
    return this.activeSession;
  }

  private ensureReady(): void {
    if (this.clientState !== "ready") {
      throw new LanguageServiceStateError(
        `Language service is not ready (${this.clientState})`,
      );
    }
  }

  private failCurrentSession(
    error: Error,
    state: LanguageServiceClientState = "error",
  ): void {
    this.lifecycleOperation += 1;
    this.rejectAll(error);
    if (this.activeSession) {
      this.cleanupSessions.set(
        this.activeSession.session,
        this.activeSession,
      );
    }
    this.activeSession = null;
    this.documents.clear();
    this.clearDiagnosticEpochs();
    this.negotiated = cloneCapabilities(EMPTY_SERVER_CAPABILITIES);
    this.setState(state, error);
    void this.stopCleanupSessions();
  }

  private async stopCleanupSessions(): Promise<Error | null> {
    let firstError: Error | null = null;
    for (const session of [...this.cleanupSessions.values()]) {
      try {
        await this.transport.stop(session);
        this.cleanupSessions.delete(session.session);
      } catch (error) {
        firstError ??= errorFromUnknown(error);
      }
    }
    try {
      await this.transport.cleanup();
    } catch (error) {
      firstError ??= errorFromUnknown(error);
    }
    return firstError;
  }

  private setState(
    state: LanguageServiceClientState,
    error?: Error,
  ): void {
    this.clientState = state;
    this.emit({
      type: "status",
      state,
      generation: this.generationValue,
      session: this.activeSession?.session ?? null,
      ...(error ? { error } : {}),
    });
  }

  private emit(event: LanguageServiceClientEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export function isLanguageServiceStaleError(
  error: unknown,
): error is StaleLanguageServiceResultError {
  return error instanceof StaleLanguageServiceResultError;
}

export function isLanguageServiceCancellation(
  error: unknown,
): error is LanguageServiceAbortError | LanguageServiceTimeoutError {
  return (
    error instanceof LanguageServiceAbortError ||
    error instanceof LanguageServiceTimeoutError
  );
}

export function assertJsonRpcError(error: unknown): asserts error is Error {
  if (!(error instanceof Error)) {
    throw new JsonRpcProtocolError("Language service failed without an Error");
  }
}
