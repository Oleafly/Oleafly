import type { ProjectIndex } from "@/lib/index/types";
import {
  isDiagnostic,
  JsonRpcProtocolError,
  UnsupportedLanguageServiceCapabilityError,
  type LanguageServiceClient,
  type CompletionParams,
  type DefinitionParams,
  type Diagnostic,
  type DocumentDiagnosticParams,
  type DocumentSymbolParams,
  type HoverParams,
  type JsonValue,
  type LanguageServiceClientEvent,
  type LanguageServiceRequestOptions,
  type ReferenceParams,
  type SemanticTokensParams,
  type SemanticTokensRangeParams,
  type WorkspaceDiagnosticParams,
  type WorkspaceSymbolParams,
} from "@/lib/language-service";
import {
  isProjectAnalysisIdentityCurrent,
  normalizeAnalysisFailure,
  normalizeDiagnostics,
  PROJECT_ANALYSIS_FEATURES,
  sameAnalysisRequest,
  type NormalizedDiagnostic,
  type ProjectAnalysisFeature,
  type ProjectAnalysisRequestIdentity,
} from "./project-snapshot";
import type {
  ProjectAnalysisStoreApi,
} from "@/store/project-analysis";

export interface ProjectActivation {
  projectId: string;
  projectRevision: number;
}

export interface ProjectIndexSyncOptions {
  partialReason?: string;
}

/**
 * Publishes the existing in-memory ProjectIndex through the same identity
 * checks as transport-backed analysis. This seam is intentionally independent
 * of a language-server client so local indexing remains available when the
 * native transport or a server for the current engine is unavailable.
 */
export class ProjectIndexShadowCoordinator {
  private requestGeneration = 0;

  constructor(private readonly store: ProjectAnalysisStoreApi) {}

  sync(
    index: ProjectIndex,
    options: ProjectIndexSyncOptions = {},
  ): boolean {
    const identity = this.store.getState().snapshot.identity;
    if (!identity.projectId) return false;
    const projectIndex =
      this.store.getState().snapshot.projectIndex;
    if ("request" in projectIndex) {
      this.requestGeneration = Math.max(
        this.requestGeneration,
        projectIndex.request.requestGeneration,
      );
    }
    const request: ProjectAnalysisRequestIdentity = {
      ...identity,
      requestGeneration: ++this.requestGeneration,
    };
    if (!this.store.getState().beginProjectIndex(request)) return false;
    return this.store.getState().installProjectIndex({
      request,
      index,
      ...(options.partialReason
        ? { partialReason: options.partialReason }
        : {}),
    });
  }
}

export interface AnalyzeDocumentOptions
  extends LanguageServiceRequestOptions {
  diagnostics?: boolean;
  symbols?: boolean;
  semanticTokens?: boolean;
}

export interface AnalyzeProjectOptions
  extends LanguageServiceRequestOptions {
  diagnostics?: boolean;
  symbols?: boolean;
  symbolQuery?: string;
}

export class StaleProjectAnalysisResultError extends Error {
  readonly request: ProjectAnalysisRequestIdentity;

  constructor(
    request: ProjectAnalysisRequestIdentity,
    reason = "Project analysis identity no longer matches",
  ) {
    super(reason);
    this.name = "StaleProjectAnalysisResultError";
    this.request = request;
  }
}

const CLIENT_FEATURE_SUPPORT: Record<
  ProjectAnalysisFeature,
  (client: LanguageServiceClient) => boolean
> = {
  completion: (client) => client.supports("completion"),
  hover: (client) => client.supports("hover"),
  definition: (client) => client.supports("definition"),
  references: (client) => client.supports("references"),
  documentSymbols: (client) => client.supports("documentSymbols"),
  workspaceSymbols: (client) => client.supports("workspaceSymbols"),
  diagnostics: (client) =>
    client.supports("documentDiagnostics") ||
    client.supports("workspaceDiagnostics"),
  semanticTokens: (client) =>
    client.supports("semanticTokensFull") ||
    client.supports("semanticTokensRange"),
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isDiagnosticArray = (value: unknown): value is Diagnostic[] =>
  Array.isArray(value) && value.every(isDiagnostic);

function documentDiagnosticsFromResult(
  value: JsonValue,
  uri: string,
  request: ProjectAnalysisRequestIdentity,
): NormalizedDiagnostic[] {
  if (
    !isRecord(value) ||
    value.kind !== "full" ||
    !isDiagnosticArray(value.items)
  ) {
    throw new JsonRpcProtocolError(
      "Malformed full document diagnostic report",
    );
  }
  return normalizeDiagnostics(uri, value.items, request);
}

function workspaceDiagnosticsFromResult(
  value: JsonValue,
  request: ProjectAnalysisRequestIdentity,
): NormalizedDiagnostic[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new JsonRpcProtocolError(
      "Malformed workspace diagnostic report",
    );
  }
  const diagnostics: NormalizedDiagnostic[] = [];
  for (const report of value.items) {
    if (!isRecord(report) || typeof report.uri !== "string") {
      throw new JsonRpcProtocolError(
        "Malformed workspace document diagnostic report",
      );
    }
    if (report.kind === "unchanged") continue;
    if (
      report.kind !== "full" ||
      !isDiagnosticArray(report.items)
    ) {
      throw new JsonRpcProtocolError(
        "Malformed full workspace document diagnostic report",
      );
    }
    const version =
      typeof report.version === "number" &&
      Number.isInteger(report.version)
        ? report.version
        : undefined;
    diagnostics.push(
      ...normalizeDiagnostics(report.uri, report.items, {
        projectRevision: request.projectRevision,
        ...(version === undefined ? {} : { documentVersion: version }),
      }),
    );
  }
  return diagnostics;
}

/**
 * Coordinates transport-backed results with the serializable analysis store.
 * It deliberately has no dependency on Tauri, React components, or the
 * existing index store. Callers push ProjectIndex snapshots through syncIndex.
 */
export class ProjectAnalysisCoordinator {
  private requestGeneration = 0;
  private readonly unsubscribe: () => void;
  private readonly pendingDiagnostics = new Map<
    string,
    {
      diagnosticEpoch: number;
      request: ProjectAnalysisRequestIdentity;
    }
  >();

  constructor(
    private readonly client: LanguageServiceClient,
    private readonly store: ProjectAnalysisStoreApi,
  ) {
    this.unsubscribe = client.subscribe((event) =>
      this.handleClientEvent(event),
    );
    if (client.generation !== store.getState().snapshot.identity.languageServiceGeneration) {
      store.getState().invalidateLanguageService(client.generation);
    }
    if (client.state === "ready") this.syncCapabilities();
  }

  dispose(): void {
    this.unsubscribe();
  }

  activateProject(project: ProjectActivation): void {
    this.pendingDiagnostics.clear();
    this.client.setProjectRevision(project.projectRevision);
    this.store.getState().activateProject({
      projectId: project.projectId,
      projectRevision: project.projectRevision,
      languageServiceGeneration: this.client.generation,
    });
    if (this.client.state === "ready") this.syncCapabilities();
  }

  updateProjectRevision(revision: number): boolean {
    this.pendingDiagnostics.clear();
    this.client.setProjectRevision(revision);
    return this.store.getState().setProjectRevision(revision);
  }

  trackDocument(uri: string, version: number): boolean {
    return this.store.getState().setDocumentVersion(uri, version);
  }

  untrackDocument(uri: string): void {
    this.pendingDiagnostics.delete(uri);
    this.store.getState().removeDocument(uri);
  }

  beginIndex(): ProjectAnalysisRequestIdentity {
    const request = this.createRequest();
    if (!this.store.getState().beginProjectIndex(request)) {
      throw new StaleProjectAnalysisResultError(request);
    }
    return request;
  }

  syncIndex(
    index: ProjectIndex,
    options: ProjectIndexSyncOptions = {},
  ): boolean {
    const request = this.beginIndex();
    return this.store.getState().installProjectIndex({
      request,
      index,
      ...(options.partialReason
        ? { partialReason: options.partialReason }
        : {}),
    });
  }

  failIndex(
    request: ProjectAnalysisRequestIdentity,
    error: unknown,
  ): boolean {
    return this.store
      .getState()
      .failProjectIndex(request, normalizeAnalysisFailure(error));
  }

  requestCompletion(
    params: CompletionParams,
    options: LanguageServiceRequestOptions = {},
  ): Promise<JsonValue> {
    return this.runFeature(
      "completion",
      params.textDocument.uri,
      () => this.client.requestCompletion(params, options),
    );
  }

  requestHover(
    params: HoverParams,
    options: LanguageServiceRequestOptions = {},
  ): Promise<JsonValue> {
    return this.runFeature(
      "hover",
      params.textDocument.uri,
      () => this.client.requestHover(params, options),
    );
  }

  requestDefinition(
    params: DefinitionParams,
    options: LanguageServiceRequestOptions = {},
  ): Promise<JsonValue> {
    return this.runFeature(
      "definition",
      params.textDocument.uri,
      () => this.client.requestDefinition(params, options),
    );
  }

  requestReferences(
    params: ReferenceParams,
    options: LanguageServiceRequestOptions = {},
  ): Promise<JsonValue> {
    return this.runFeature(
      "references",
      params.textDocument.uri,
      () => this.client.requestReferences(params, options),
    );
  }

  requestDocumentSymbols(
    params: DocumentSymbolParams,
    options: LanguageServiceRequestOptions = {},
  ): Promise<JsonValue> {
    return this.runFeature(
      "documentSymbols",
      params.textDocument.uri,
      () => this.client.requestDocumentSymbols(params, options),
    );
  }

  requestWorkspaceSymbols(
    params: WorkspaceSymbolParams,
    options: LanguageServiceRequestOptions = {},
  ): Promise<JsonValue> {
    return this.runFeature(
      "workspaceSymbols",
      undefined,
      () => this.client.requestWorkspaceSymbols(params, options),
    );
  }

  requestDocumentDiagnostics(
    params: DocumentDiagnosticParams,
    options: LanguageServiceRequestOptions = {},
  ): Promise<NormalizedDiagnostic[]> {
    const uri = params.textDocument.uri;
    return this.runFeature(
      "diagnostics",
      uri,
      () => this.client.requestDocumentDiagnostics(params, options),
      (value, request) =>
        documentDiagnosticsFromResult(value, uri, request),
    );
  }

  requestWorkspaceDiagnostics(
    params: WorkspaceDiagnosticParams,
    options: LanguageServiceRequestOptions = {},
  ): Promise<NormalizedDiagnostic[]> {
    return this.runFeature(
      "diagnostics",
      undefined,
      () => this.client.requestWorkspaceDiagnostics(params, options),
      workspaceDiagnosticsFromResult,
    );
  }

  requestSemanticTokensFull(
    params: SemanticTokensParams,
    options: LanguageServiceRequestOptions = {},
  ): Promise<JsonValue> {
    return this.runFeature(
      "semanticTokens",
      params.textDocument.uri,
      () => this.client.requestSemanticTokensFull(params, options),
    );
  }

  requestSemanticTokensRange(
    params: SemanticTokensRangeParams,
    options: LanguageServiceRequestOptions = {},
  ): Promise<JsonValue> {
    return this.runFeature(
      "semanticTokens",
      params.textDocument.uri,
      () => this.client.requestSemanticTokensRange(params, options),
    );
  }

  async analyzeDocument(
    uri: string,
    options: AnalyzeDocumentOptions = {},
  ): Promise<PromiseSettledResult<unknown>[]> {
    const requests: Promise<unknown>[] = [];
    if (
      options.diagnostics !== false &&
      this.client.supports("documentDiagnostics")
    ) {
      requests.push(
        this.requestDocumentDiagnostics(
          { textDocument: { uri } },
          options,
        ),
      );
    }
    if (
      options.symbols !== false &&
      this.client.supports("documentSymbols")
    ) {
      requests.push(
        this.requestDocumentSymbols(
          { textDocument: { uri } },
          options,
        ),
      );
    }
    if (
      options.semanticTokens !== false &&
      this.client.supports("semanticTokensFull")
    ) {
      requests.push(
        this.requestSemanticTokensFull(
          { textDocument: { uri } },
          options,
        ),
      );
    }
    return Promise.allSettled(requests);
  }

  async analyzeProject(
    options: AnalyzeProjectOptions = {},
  ): Promise<PromiseSettledResult<unknown>[]> {
    const requests: Promise<unknown>[] = [];
    if (
      options.diagnostics !== false &&
      this.client.supports("workspaceDiagnostics")
    ) {
      requests.push(
        this.requestWorkspaceDiagnostics(
          { previousResultIds: [] },
          options,
        ),
      );
    }
    if (
      options.symbols !== false &&
      this.client.supports("workspaceSymbols")
    ) {
      requests.push(
        this.requestWorkspaceSymbols(
          { query: options.symbolQuery ?? "" },
          options,
        ),
      );
    }
    return Promise.allSettled(requests);
  }

  private async runFeature<T = JsonValue>(
    feature: ProjectAnalysisFeature,
    documentUri: string | undefined,
    operation: () => Promise<JsonValue>,
    transform: (
      value: JsonValue,
      request: ProjectAnalysisRequestIdentity,
    ) => T = (value) => value as T,
  ): Promise<T> {
    this.syncDocumentFromClient(documentUri);
    const request = this.createRequest(documentUri);
    if (!this.store.getState().beginFeature(feature, request)) {
      throw new StaleProjectAnalysisResultError(request);
    }
    try {
      const raw = await operation();
      const data = transform(raw, request);
      if (
        !this.store
          .getState()
          .resolveFeature(feature, request, data)
      ) {
        throw new StaleProjectAnalysisResultError(request);
      }
      return data;
    } catch (error) {
      if (
        error instanceof UnsupportedLanguageServiceCapabilityError
      ) {
        const actions = this.store.getState();
        const slot = actions.snapshot.features[feature];
        if (
          isProjectAnalysisIdentityCurrent(
            actions.snapshot,
            request,
          ) &&
          slot.status === "running" &&
          sameAnalysisRequest(slot.request, request)
        ) {
          actions.markFeatureUnsupported(feature, error.message);
        }
        throw error;
      }
      this.store
        .getState()
        .failFeature(
          feature,
          request,
          normalizeAnalysisFailure(error),
        );
      throw error;
    }
  }

  private createRequest(
    documentUri?: string,
  ): ProjectAnalysisRequestIdentity {
    const snapshot = this.store.getState().snapshot;
    if (!snapshot.identity.projectId) {
      throw new StaleProjectAnalysisResultError(
        {
          ...snapshot.identity,
          requestGeneration: this.nextRequestGeneration(),
        },
        "No project is active",
      );
    }
    const request: ProjectAnalysisRequestIdentity = {
      ...snapshot.identity,
      requestGeneration: this.nextRequestGeneration(),
    };
    if (documentUri !== undefined) {
      const document = snapshot.documents[documentUri];
      if (!document) {
        throw new StaleProjectAnalysisResultError(
          { ...request, documentUri },
          "Document version is not tracked",
        );
      }
      request.documentUri = documentUri;
      request.documentVersion = document.version;
    }
    return request;
  }

  private nextRequestGeneration(): number {
    const snapshot = this.store.getState().snapshot;
    let latest = this.requestGeneration;
    for (const slot of Object.values(snapshot.features)) {
      if ("request" in slot) {
        latest = Math.max(
          latest,
          slot.request.requestGeneration,
        );
      }
    }
    if ("request" in snapshot.projectIndex) {
      latest = Math.max(
        latest,
        snapshot.projectIndex.request.requestGeneration,
      );
    }
    for (const entry of Object.values(snapshot.diagnosticsByUri)) {
      latest = Math.max(
        latest,
        entry.request.requestGeneration,
      );
    }
    this.requestGeneration = latest + 1;
    return this.requestGeneration;
  }

  private syncDocumentFromClient(documentUri?: string): void {
    if (!documentUri) return;
    const document = this.client.getDocument(documentUri);
    if (document) {
      this.store
        .getState()
        .setDocumentVersion(documentUri, document.version);
    }
  }

  private syncCapabilities(): void {
    const actions = this.store.getState();
    for (const feature of PROJECT_ANALYSIS_FEATURES) {
      if (CLIENT_FEATURE_SUPPORT[feature](this.client)) {
        if (
          actions.snapshot.features[feature].status === "unsupported" ||
          actions.snapshot.features[feature].status === "unavailable"
        ) {
          actions.markFeatureNotRun(
            feature,
            "Supported and ready. Analysis has not run.",
          );
        }
      } else {
        actions.markFeatureUnsupported(
          feature,
          `Language server did not advertise ${feature}`,
        );
      }
    }
  }

  private handleClientEvent(event: LanguageServiceClientEvent): void {
    if (event.type === "status") {
      const actions = this.store.getState();
      if (
        actions.snapshot.identity.languageServiceGeneration !==
        event.generation
      ) {
        actions.invalidateLanguageService(event.generation);
      }
      if (event.state === "ready") {
        this.syncCapabilities();
      } else if (
        event.state === "error" ||
        event.state === "exited" ||
        event.state === "stopped"
      ) {
        for (const feature of PROJECT_ANALYSIS_FEATURES) {
          this.store
            .getState()
            .markFeatureUnavailable(
              feature,
              event.error?.message ?? "Language service is unavailable",
            );
        }
      }
      return;
    }

    if (
      event.type !== "diagnostics" &&
      event.type !== "diagnosticsPending"
    ) {
      return;
    }
    const snapshot = this.store.getState().snapshot;
    const request: ProjectAnalysisRequestIdentity = {
      projectId: snapshot.identity.projectId,
      projectRevision: event.identity.projectRevision ?? -1,
      languageServiceGeneration: event.identity.generation,
      requestGeneration: this.nextRequestGeneration(),
      documentUri: event.identity.documentUri,
      documentVersion: event.identity.documentVersion,
    };
    if (!isProjectAnalysisIdentityCurrent(snapshot, request)) return;
    if (event.type === "diagnosticsPending") {
      if (
        this.store
          .getState()
          .beginDocumentDiagnostics(
            event.uri,
            event.diagnosticEpoch,
            request,
          )
      ) {
        this.pendingDiagnostics.set(event.uri, {
          diagnosticEpoch: event.diagnosticEpoch,
          request,
        });
      }
      return;
    }
    const pending = this.pendingDiagnostics.get(event.params.uri);
    if (
      !pending ||
      pending.diagnosticEpoch !== event.diagnosticEpoch ||
      pending.request.projectRevision !== request.projectRevision ||
      pending.request.languageServiceGeneration !==
        request.languageServiceGeneration ||
      pending.request.documentVersion !== request.documentVersion
    ) {
      return;
    }
    if (
      this.store.getState().resolveDocumentDiagnostics(
        event.params.uri,
        event.diagnosticEpoch,
        pending.request,
        normalizeDiagnostics(
          event.params.uri,
          event.diagnostics,
          pending.request,
        ),
      )
    ) {
      this.pendingDiagnostics.delete(event.params.uri);
    }
  }
}
