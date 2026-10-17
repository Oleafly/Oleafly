import { describe, expect, it, vi } from "vitest";
import { buildIndex } from "@/lib/index/build";
import {
  JsonRpcProtocolError,
  UnsupportedLanguageServiceCapabilityError,
  type JsonValue,
  type LanguageServiceClient,
  type LanguageServiceClientEvent,
  type LanguageServiceClientListener,
  type LanguageServiceClientState,
  type LanguageServiceFeature,
  type OpenDocumentSnapshot,
} from "@/lib/language-service";
import { createProjectAnalysisStore } from "@/store/project-analysis";
import {
  ProjectAnalysisCoordinator,
  ProjectIndexShadowCoordinator,
  StaleProjectAnalysisResultError,
} from "./coordinator";

const URI = "file:///project/main.tex";

const ALL_FEATURES: LanguageServiceFeature[] = [
  "completion",
  "hover",
  "definition",
  "references",
  "documentSymbols",
  "workspaceSymbols",
  "documentDiagnostics",
  "workspaceDiagnostics",
  "semanticTokensFull",
  "semanticTokensRange",
];

const diagnostic = (message: string) => ({
  range: {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 3 },
  },
  severity: 2 as const,
  message,
});

class StubClient {
  state: LanguageServiceClientState = "ready";
  generation = 0;
  projectRevision = 0;
  supported = new Set<LanguageServiceFeature>(ALL_FEATURES);
  documents = new Map<string, OpenDocumentSnapshot>();
  unsubscribes = 0;
  private readonly listeners = new Set<LanguageServiceClientListener>();
  readonly requestCompletion = vi.fn(async (_params: unknown, _options?: unknown): Promise<JsonValue> => null);
  readonly requestHover = vi.fn(async (_params: unknown, _options?: unknown): Promise<JsonValue> => null);
  readonly requestDefinition = vi.fn(
    async (_params: unknown, _options?: unknown): Promise<JsonValue> => [{ uri: URI }],
  );
  readonly requestReferences = vi.fn(
    async (_params: unknown, _options?: unknown): Promise<JsonValue> => [{ uri: URI }, { uri: URI }],
  );
  readonly requestDocumentSymbols = vi.fn(
    async (_params: unknown, _options?: unknown): Promise<JsonValue> => [{ name: "intro" }],
  );
  readonly requestWorkspaceSymbols = vi.fn(
    async (_params: unknown, _options?: unknown): Promise<JsonValue> => [{ name: "global" }],
  );
  readonly requestDocumentDiagnostics = vi.fn(
    async (_params: unknown, _options?: unknown): Promise<JsonValue> => ({
      kind: "full",
      items: [diagnostic("document")],
    }),
  );
  readonly requestWorkspaceDiagnostics = vi.fn(
    async (_params: unknown, _options?: unknown): Promise<JsonValue> => ({ items: [] }),
  );
  readonly requestSemanticTokensFull = vi.fn(
    async (_params: unknown, _options?: unknown): Promise<JsonValue> => ({ data: [0, 0, 1, 0, 0] }),
  );
  readonly requestSemanticTokensRange = vi.fn(
    async (_params: unknown, _options?: unknown): Promise<JsonValue> => ({ data: [1, 0, 2, 0, 0] }),
  );

  subscribe(listener: LanguageServiceClientListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.unsubscribes += 1;
      this.listeners.delete(listener);
    };
  }

  supports(feature: LanguageServiceFeature): boolean {
    return this.supported.has(feature);
  }

  setProjectRevision(revision: number): void {
    this.projectRevision = revision;
  }

  getDocument(uri: string): OpenDocumentSnapshot | null {
    return this.documents.get(uri) ?? null;
  }

  emit(event: LanguageServiceClientEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  asClient(): LanguageServiceClient {
    return this as unknown as LanguageServiceClient;
  }
}

function setup(
  options: {
    state?: LanguageServiceClientState;
    supported?: LanguageServiceFeature[];
  } = {},
) {
  const client = new StubClient();
  if (options.state) client.state = options.state;
  if (options.supported) client.supported = new Set(options.supported);
  const store = createProjectAnalysisStore();
  const coordinator = new ProjectAnalysisCoordinator(client.asClient(), store);
  coordinator.activateProject({ projectId: "project-a", projectRevision: 1 });
  coordinator.trackDocument(URI, 1);
  return { client, store, coordinator };
}

describe("ProjectIndexShadowCoordinator", () => {
  it("does nothing until a project is active", () => {
    const store = createProjectAnalysisStore();
    const before = store.getState().snapshot;
    const shadow = new ProjectIndexShadowCoordinator(store);
    expect(shadow.sync(buildIndex({ "main.tex": "\\section{A}" }))).toBe(
      false,
    );
    expect(store.getState().snapshot).toBe(before);
  });

  it("publishes complete and partial index snapshots with advancing request generations", () => {
    const store = createProjectAnalysisStore();
    store.getState().activateProject({
      projectId: "project-a",
      projectRevision: 4,
      languageServiceGeneration: 2,
    });
    const shadow = new ProjectIndexShadowCoordinator(store);
    const index = buildIndex({ "main.tex": "\\section{Intro}\\label{sec:intro}" });

    expect(shadow.sync(index)).toBe(true);
    const first = store.getState().snapshot.projectIndex;
    expect(first).toMatchObject({
      status: "success",
      request: {
        projectId: "project-a",
        projectRevision: 4,
        languageServiceGeneration: 2,
        requestGeneration: 1,
      },
    });

    expect(
      shadow.sync(index, { partialReason: { key: "indexRebuilding" } }),
    ).toBe(true);
    expect(store.getState().snapshot.projectIndex).toMatchObject({
      status: "partial",
      reason: { key: "indexRebuilding" },
      request: { requestGeneration: 2 },
    });
  });
});

describe("ProjectAnalysisCoordinator lifecycle", () => {
  it("keeps the store untouched when the client generation already matches and the client is not ready", () => {
    const client = new StubClient();
    client.state = "starting";
    const store = createProjectAnalysisStore();
    const before = store.getState().snapshot;
    const coordinator = new ProjectAnalysisCoordinator(
      client.asClient(),
      store,
    );
    expect(store.getState().snapshot).toBe(before);

    coordinator.activateProject({ projectId: "project-a", projectRevision: 2 });
    expect(client.projectRevision).toBe(2);
    expect(store.getState().snapshot.identity).toMatchObject({
      projectId: "project-a",
      projectRevision: 2,
      languageServiceGeneration: 0,
    });
    expect(store.getState().snapshot.features.hover.status).toBe("not_run");
    expect(store.getState().snapshot.features.hover.status).not.toBe(
      "unsupported",
    );

    coordinator.dispose();
    coordinator.dispose();
    expect(client.unsubscribes).toBe(1);
  });

  it("invalidates the store generation when a newer client attaches", () => {
    const client = new StubClient();
    client.generation = 3;
    client.supported = new Set(["hover"]);
    const store = createProjectAnalysisStore();
    new ProjectAnalysisCoordinator(client.asClient(), store);
    expect(
      store.getState().snapshot.identity.languageServiceGeneration,
    ).toBe(3);
    expect(store.getState().snapshot.features.completion).toMatchObject({
      status: "unsupported",
      reason: { key: "featureNotAdvertised", params: { feature: "completion" } },
    });
  });

  it("untracks documents and publishes project index results and failures", () => {
    const { store, coordinator } = setup();
    expect(store.getState().snapshot.documents[URI]).toBeDefined();
    coordinator.untrackDocument(URI);
    expect(store.getState().snapshot.documents[URI]).toBeUndefined();

    const index = buildIndex({ "main.tex": "\\cite{knuth}" });
    expect(coordinator.syncIndex(index)).toBe(true);
    expect(store.getState().snapshot.projectIndex.status).toBe("success");
    expect(
      coordinator.syncIndex(index, {
        partialReason: { key: "indexRebuilding" },
      }),
    ).toBe(true);
    expect(store.getState().snapshot.projectIndex).toMatchObject({
      status: "partial",
      reason: { key: "indexRebuilding" },
    });

    const request = coordinator.beginIndex();
    expect(coordinator.failIndex(request, new Error("index exploded"))).toBe(
      true,
    );
    expect(store.getState().snapshot.projectIndex).toMatchObject({
      status: "error",
      failure: { message: "index exploded" },
    });
    expect(coordinator.failIndex(request, new Error("again"))).toBe(false);
  });
});

describe("ProjectAnalysisCoordinator feature requests", () => {
  it("forwards document-scoped requests with their options and records results", async () => {
    const { client, store, coordinator } = setup();
    const position = { line: 0, character: 1 };
    const options = { timeoutMs: 123 };

    await expect(
      coordinator.requestDefinition(
        { textDocument: { uri: URI }, position },
        options,
      ),
    ).resolves.toEqual([{ uri: URI }]);
    await expect(
      coordinator.requestReferences(
        {
          textDocument: { uri: URI },
          position,
          context: { includeDeclaration: true },
        },
        options,
      ),
    ).resolves.toHaveLength(2);
    await expect(
      coordinator.requestDocumentSymbols({ textDocument: { uri: URI } }, options),
    ).resolves.toEqual([{ name: "intro" }]);
    await expect(
      coordinator.requestSemanticTokensFull({ textDocument: { uri: URI } }),
    ).resolves.toEqual({ data: [0, 0, 1, 0, 0] });
    await expect(
      coordinator.requestSemanticTokensRange({
        textDocument: { uri: URI },
        range: { start: position, end: position },
      }),
    ).resolves.toEqual({ data: [1, 0, 2, 0, 0] });

    expect(client.requestDefinition).toHaveBeenCalledWith(
      { textDocument: { uri: URI }, position },
      options,
    );
    expect(client.requestReferences.mock.calls[0]?.[1]).toBe(options);
    expect(client.requestDocumentSymbols.mock.calls[0]?.[1]).toBe(options);
    expect(client.requestSemanticTokensFull.mock.calls[0]?.[1]).toEqual({});
    const features = store.getState().snapshot.features;
    expect(features.definition).toMatchObject({
      status: "success",
      request: { documentUri: URI, documentVersion: 1 },
    });
    expect(features.references.status).toBe("success");
    expect(features.documentSymbols.status).toBe("success");
    expect(features.semanticTokens).toMatchObject({
      status: "success",
      data: { data: [1, 0, 2, 0, 0] },
    });
  });

  it("adopts the client's newer document version before building a request", async () => {
    const { client, store, coordinator } = setup();
    client.documents.set(URI, {
      uri: URI,
      languageId: "latex",
      version: 4,
      text: "x",
    });
    await coordinator.requestHover({
      textDocument: { uri: URI },
      position: { line: 0, character: 0 },
    });
    expect(store.getState().snapshot.documents[URI]?.version).toBe(4);
    expect(store.getState().snapshot.features.hover).toMatchObject({
      status: "success",
      request: { documentVersion: 4 },
    });
  });

  it("normalizes workspace diagnostic reports and skips unchanged ones", async () => {
    const { client, store, coordinator } = setup();
    client.requestWorkspaceDiagnostics.mockResolvedValueOnce({
      items: [
        { kind: "unchanged", uri: "file:///project/old.tex", resultId: "1" },
        {
          kind: "full",
          uri: "file:///project/a.tex",
          version: 7,
          items: [diagnostic("versioned")],
        },
        {
          kind: "full",
          uri: "file:///project/b.tex",
          version: 1.5,
          items: [diagnostic("unversioned")],
        },
      ],
    });

    const result = await coordinator.requestWorkspaceDiagnostics(
      { previousResultIds: [] },
      { timeoutMs: 50 },
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      uri: "file:///project/a.tex",
      message: "versioned",
      severity: "warning",
      documentVersion: 7,
      projectRevision: 1,
    });
    expect(result[1]).toMatchObject({
      uri: "file:///project/b.tex",
      message: "unversioned",
    });
    expect(result[1]).not.toHaveProperty("documentVersion");
    expect(client.requestWorkspaceDiagnostics).toHaveBeenCalledWith(
      { previousResultIds: [] },
      { timeoutMs: 50 },
    );
    expect(store.getState().snapshot.features.diagnostics.status).toBe(
      "success",
    );
  });

  it.each([
    ["a non-object result", ["not a report"] as JsonValue],
    ["a non-object report", { items: ["not a report"] }],
    ["a report without a uri", { items: [{ kind: "full", items: [] }] }],
    [
      "a report with an unknown kind",
      { items: [{ kind: "partial", uri: URI, items: [] }] },
    ],
    [
      "a full report with malformed items",
      { items: [{ kind: "full", uri: URI, items: [{ message: 1 }] }] },
    ],
    ["a report without items", { kind: "full" }],
  ])("fails workspace diagnostics on %s", async (_label, payload) => {
    const { client, store, coordinator } = setup();
    client.requestWorkspaceDiagnostics.mockResolvedValueOnce(payload);
    await expect(
      coordinator.requestWorkspaceDiagnostics({ previousResultIds: [] }),
    ).rejects.toBeInstanceOf(JsonRpcProtocolError);
    expect(store.getState().snapshot.features.diagnostics).toMatchObject({
      status: "error",
      failure: { name: "JsonRpcProtocolError" },
    });
  });

  it("rejects a document diagnostic report that is not a full report", async () => {
    const { client, store, coordinator } = setup();
    client.requestDocumentDiagnostics.mockResolvedValueOnce({
      kind: "unchanged",
      resultId: "1",
    });
    await expect(
      coordinator.requestDocumentDiagnostics({ textDocument: { uri: URI } }),
    ).rejects.toThrow("Malformed full document diagnostic report");
    expect(store.getState().snapshot.features.diagnostics.status).toBe(
      "error",
    );
  });

  it("marks a feature unsupported when the server rejects it as not advertised", async () => {
    const { client, store, coordinator } = setup();
    client.requestDefinition.mockRejectedValueOnce(
      new UnsupportedLanguageServiceCapabilityError("definition"),
    );
    await expect(
      coordinator.requestDefinition({
        textDocument: { uri: URI },
        position: { line: 0, character: 0 },
      }),
    ).rejects.toBeInstanceOf(UnsupportedLanguageServiceCapabilityError);
    expect(store.getState().snapshot.features.definition).toMatchObject({
      status: "unsupported",
      reason: {
        key: "featureNotAdvertised",
        params: { feature: "definition" },
      },
    });
  });

  it("records ordinary request failures on the feature slot", async () => {
    const { client, store, coordinator } = setup();
    client.requestReferences.mockRejectedValueOnce(new Error("server crashed"));
    await expect(
      coordinator.requestReferences({
        textDocument: { uri: URI },
        position: { line: 0, character: 0 },
        context: { includeDeclaration: false },
      }),
    ).rejects.toThrow("server crashed");
    expect(store.getState().snapshot.features.references).toMatchObject({
      status: "error",
      failure: { message: "server crashed" },
    });
  });

  it("rethrows a failure that lands after disposal without touching the store", async () => {
    const { client, store, coordinator } = setup();
    let reject: (error: Error) => void = () => {};
    client.requestDocumentSymbols.mockReturnValueOnce(
      new Promise<JsonValue>((_resolve, fail) => {
        reject = fail;
      }),
    );
    const pending = coordinator.requestDocumentSymbols({
      textDocument: { uri: URI },
    });
    coordinator.dispose();
    const after = store.getState().snapshot;
    reject(new Error("late failure"));
    await expect(pending).rejects.toThrow("late failure");
    expect(store.getState().snapshot).toBe(after);
  });

  it("discards a result whose project was replaced while the request was in flight", async () => {
    const { client, store, coordinator } = setup();
    let resolve: (value: JsonValue) => void = () => {};
    client.requestWorkspaceSymbols.mockReturnValueOnce(
      new Promise<JsonValue>((done) => {
        resolve = done;
      }),
    );
    const pending = coordinator.requestWorkspaceSymbols({ query: "" });
    store.getState().activateProject({
      projectId: "project-b",
      projectRevision: 1,
      languageServiceGeneration: 0,
    });
    resolve([{ name: "stale" }]);
    await expect(pending).rejects.toBeInstanceOf(
      StaleProjectAnalysisResultError,
    );
    expect(
      store.getState().snapshot.features.workspaceSymbols.status,
    ).not.toBe("success");
  });

  it("refuses to build requests without a project or for untracked documents", async () => {
    const client = new StubClient();
    const store = createProjectAnalysisStore();
    const coordinator = new ProjectAnalysisCoordinator(
      client.asClient(),
      store,
    );
    await expect(
      coordinator.requestWorkspaceSymbols({ query: "" }),
    ).rejects.toMatchObject({
      name: "StaleProjectAnalysisResultError",
      analysisReason: { key: "noProject" },
    });

    coordinator.activateProject({ projectId: "project-a", projectRevision: 1 });
    await expect(
      coordinator.requestHover({
        textDocument: { uri: "file:///project/unknown.tex" },
        position: { line: 0, character: 0 },
      }),
    ).rejects.toMatchObject({
      analysisReason: { key: "documentVersionNotTracked" },
      request: { documentUri: "file:///project/unknown.tex" },
    });
    expect(client.requestHover).not.toHaveBeenCalled();
  });
});

describe("ProjectAnalysisCoordinator batch analysis", () => {
  it("runs every advertised document analysis and skips disabled ones", async () => {
    const { client, coordinator } = setup();
    const settled = await coordinator.analyzeDocument(URI);
    expect(settled.map((result) => result.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);

    const none = await coordinator.analyzeDocument(URI, {
      diagnostics: false,
      symbols: false,
      semanticTokens: false,
    });
    expect(none).toEqual([]);
    expect(client.requestDocumentDiagnostics).toHaveBeenCalledTimes(1);
    expect(client.requestDocumentSymbols).toHaveBeenCalledTimes(1);
    expect(client.requestSemanticTokensFull).toHaveBeenCalledTimes(1);
  });

  it("skips document analyses the server does not advertise", async () => {
    const { client, coordinator } = setup({ supported: ["hover"] });
    expect(await coordinator.analyzeDocument(URI)).toEqual([]);
    expect(await coordinator.analyzeProject()).toEqual([]);
    expect(client.requestDocumentDiagnostics).not.toHaveBeenCalled();
    expect(client.requestWorkspaceSymbols).not.toHaveBeenCalled();
  });

  it("runs project analyses with the requested symbol query", async () => {
    const { client, coordinator } = setup();
    const settled = await coordinator.analyzeProject({ symbolQuery: "intro" });
    expect(settled).toHaveLength(2);
    expect(client.requestWorkspaceSymbols).toHaveBeenCalledWith(
      { query: "intro" },
      { symbolQuery: "intro" },
    );

    await coordinator.analyzeProject({ diagnostics: false });
    expect(client.requestWorkspaceDiagnostics).toHaveBeenCalledTimes(1);
    expect(client.requestWorkspaceSymbols).toHaveBeenLastCalledWith(
      { query: "" },
      { diagnostics: false },
    );

    expect(
      await coordinator.analyzeProject({ diagnostics: false, symbols: false }),
    ).toEqual([]);
  });
});

describe("ProjectAnalysisCoordinator client events", () => {
  it("re-enables features the server starts advertising when it becomes ready again", () => {
    const { client, store } = setup({ supported: [] });
    expect(store.getState().snapshot.features.hover.status).toBe(
      "unsupported",
    );
    store.getState().markFeatureUnavailable("definition", { key: "starting" });

    client.supported = new Set(["hover", "definition"]);
    client.emit({ type: "status", state: "ready", generation: 0, session: "s" });

    const features = store.getState().snapshot.features;
    expect(features.hover).toMatchObject({
      status: "not_run",
      reason: { key: "supportedNotRun" },
    });
    expect(features.definition.status).toBe("not_run");
    expect(features.completion.status).toBe("unsupported");
  });

  it("invalidates on a generation change and reports exits as unavailable", () => {
    const { client, store } = setup();
    client.emit({
      type: "status",
      state: "starting",
      generation: 2,
      session: "s2",
    });
    expect(
      store.getState().snapshot.identity.languageServiceGeneration,
    ).toBe(2);
    expect(store.getState().snapshot.features.hover).toMatchObject({
      status: "not_run",
      reason: { key: "languageServiceRestarted" },
    });

    client.emit({
      type: "status",
      state: "exited",
      generation: 2,
      session: "s2",
      error: new Error("texlab crashed"),
    });
    expect(store.getState().snapshot.features.hover).toMatchObject({
      status: "unavailable",
      reason: { text: "texlab crashed" },
    });

    client.emit({
      type: "status",
      state: "stopped",
      generation: 2,
      session: null,
    });
    expect(store.getState().snapshot.features.references).toMatchObject({
      status: "unavailable",
      reason: { key: "languageServiceUnavailable" },
    });
  });

  it("ignores events that carry no analysis", () => {
    const { client, store } = setup();
    const before = store.getState().snapshot;
    client.emit({ type: "log", stream: "stderr", message: "noise", generation: 0 });
    client.emit({ type: "notification", method: "window/logMessage", generation: 0 });
    expect(store.getState().snapshot).toBe(before);
  });

  it("commits pushed diagnostics only for the epoch and identity that announced them", () => {
    const { client, store } = setup();
    const identity = {
      session: "s",
      generation: 0,
      requestGeneration: 1,
      projectRevision: 1,
      documentUri: URI,
      documentVersion: 1,
    };

    client.emit({
      type: "diagnostics",
      params: { uri: URI, diagnostics: [diagnostic("orphan")] },
      diagnostics: [diagnostic("orphan")],
      identity,
      diagnosticEpoch: 1,
      acknowledged: true,
    });
    expect(store.getState().snapshot.diagnosticsByUri[URI]).toBeUndefined();

    client.emit({
      type: "diagnosticsPending",
      uri: URI,
      identity: { ...identity, projectRevision: undefined },
      diagnosticEpoch: 1,
    });
    expect(store.getState().snapshot.diagnosticsByUri[URI]).toBeUndefined();

    client.emit({
      type: "diagnosticsPending",
      uri: URI,
      identity,
      diagnosticEpoch: 2,
    });
    expect(store.getState().snapshot.features.diagnostics.status).toBe(
      "partial",
    );

    client.emit({
      type: "diagnostics",
      params: { uri: URI, diagnostics: [diagnostic("wrong epoch")] },
      diagnostics: [diagnostic("wrong epoch")],
      identity,
      diagnosticEpoch: 1,
      acknowledged: true,
    });
    expect(store.getState().snapshot.features.diagnostics.status).toBe(
      "partial",
    );

    client.emit({
      type: "diagnostics",
      params: { uri: URI, diagnostics: [diagnostic("current")] },
      diagnostics: [diagnostic("current")],
      identity,
      diagnosticEpoch: 2,
      acknowledged: true,
    });
    expect(store.getState().snapshot.features.diagnostics).toMatchObject({
      status: "success",
      data: [{ message: "current", documentVersion: 1, projectRevision: 1 }],
    });

    client.emit({
      type: "diagnostics",
      params: { uri: URI, diagnostics: [] },
      diagnostics: [],
      identity,
      diagnosticEpoch: 2,
      acknowledged: true,
    });
    expect(store.getState().snapshot.features.diagnostics).toMatchObject({
      status: "success",
      data: [],
    });

    client.emit({
      type: "diagnostics",
      params: { uri: URI, diagnostics: [diagnostic("wrong epoch")] },
      diagnostics: [diagnostic("wrong epoch")],
      identity,
      diagnosticEpoch: 1,
      acknowledged: true,
    });
    expect(store.getState().snapshot.features.diagnostics).toMatchObject({
      data: [],
    });
  });

  it("ignores an older diagnostics epoch and results for diagnostics cleared elsewhere", () => {
    const { client, store } = setup();
    const identity = {
      session: "s",
      generation: 0,
      requestGeneration: 1,
      projectRevision: 1,
      documentUri: URI,
      documentVersion: 1,
    };
    client.emit({
      type: "diagnosticsPending",
      uri: URI,
      identity,
      diagnosticEpoch: 3,
    });
    client.emit({
      type: "diagnosticsPending",
      uri: URI,
      identity,
      diagnosticEpoch: 2,
    });
    expect(store.getState().snapshot.diagnosticsByUri[URI]).toMatchObject({
      diagnosticEpoch: 3,
      status: "pending",
    });

    client.emit({
      type: "diagnostics",
      params: { uri: URI, diagnostics: [] },
      diagnostics: [],
      identity,
      diagnosticEpoch: 2,
      acknowledged: true,
    });
    expect(store.getState().snapshot.diagnosticsByUri[URI]?.status).toBe(
      "pending",
    );

    store.getState().clearDocumentDiagnostics(URI);
    client.emit({
      type: "diagnostics",
      params: { uri: URI, diagnostics: [diagnostic("late")] },
      diagnostics: [diagnostic("late")],
      identity,
      diagnosticEpoch: 3,
      acknowledged: true,
    });
    expect(store.getState().snapshot.diagnosticsByUri[URI]).toBeUndefined();
    expect(store.getState().snapshot.features.diagnostics.status).toBe(
      "not_run",
    );
  });
});
