import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  LanguageServiceAbortError,
  LanguageServiceClient,
  LanguageServiceExitedError,
  LanguageServiceTimeoutError,
  StaleLanguageServiceResultError,
  UnsupportedLanguageServiceCapabilityError,
  type LanguageServiceClientStartOptions,
} from "./client";
import { getLanguageServiceRuntimeProfile } from "./runtime-profile";
import {
  isJsonRpcNotification,
  isJsonRpcRequest,
  type JsonRpcMessage,
  type JsonValue,
} from "./json-rpc";
import type {
  LanguageServiceEventSink,
  LanguageServiceRuntimeSession,
  LanguageServiceSession,
  LanguageServiceStartOptions,
  LanguageServiceTransport,
  LanguageServiceTransportStatus,
} from "./transport";

interface SentMessage {
  session: LanguageServiceSession;
  message: JsonRpcMessage;
}

class FakeTransport implements LanguageServiceTransport {
  readonly sent: SentMessage[] = [];
  readonly stopped: LanguageServiceSession[] = [];
  stopFailures = 0;
  startEventCount = 0;
  startGate: Promise<void> | null = null;
  private readonly sinks = new Map<string, LanguageServiceEventSink>();
  private transportStatus: LanguageServiceTransportStatus = {
    state: "stopped",
    session: null,
  };
  private generation = 0;

  status(): LanguageServiceTransportStatus {
    return this.transportStatus;
  }

  async start(
    options: LanguageServiceStartOptions,
    sink: LanguageServiceEventSink,
  ): Promise<LanguageServiceRuntimeSession> {
    const session = {
      session: `opaque-test-session-${this.generation + 1}`,
      kind: options.kind,
      generation: ++this.generation,
      projectId: options.projectId,
      workspaceRoot: "/project",
    };
    this.sinks.set(session.session, sink);
    this.transportStatus = { state: "running", session };
    for (
      let sequence = 1;
      sequence <= this.startEventCount;
      sequence += 1
    ) {
      sink({
        type: "log",
        ...session,
        sequence,
        stream: "stderr",
        message: `early event ${sequence}`,
      });
    }
    await this.startGate;
    return session;
  }

  async send(
    session: LanguageServiceSession,
    message: JsonRpcMessage,
  ): Promise<void> {
    this.sent.push({ session: { ...session }, message });
  }

  async stop(session: LanguageServiceSession): Promise<void> {
    this.stopped.push({ ...session });
    if (this.stopFailures > 0) {
      this.stopFailures -= 1;
      throw new Error("stop failed");
    }
    if (this.transportStatus.session?.session === session.session) {
      this.transportStatus = { state: "stopped", session: null };
    }
  }

  async cleanup(): Promise<void> {}

  async refreshStatus(
    session: LanguageServiceSession,
  ): Promise<LanguageServiceTransportStatus> {
    if (this.transportStatus.session?.session !== session.session) {
      throw new Error("stale session");
    }
    return this.status();
  }

  requests(method: string): SentMessage[] {
    return this.sent.filter(
      ({ message }) =>
        isJsonRpcRequest(message) && message.method === method,
    );
  }

  notifications(method: string): SentMessage[] {
    return this.sent.filter(
      ({ message }) =>
        isJsonRpcNotification(message) && message.method === method,
    );
  }

  respond(
    sent: SentMessage,
    result: JsonValue,
  ): void {
    if (!isJsonRpcRequest(sent.message)) {
      throw new Error("Cannot respond to a notification");
    }
    this.emitMessage(sent.session, {
      jsonrpc: "2.0",
      id: sent.message.id,
      result,
    });
  }

  respondError(
    sent: SentMessage,
    code: number,
    message: string,
  ): void {
    if (!isJsonRpcRequest(sent.message)) {
      throw new Error("Cannot respond to a notification");
    }
    this.emitMessage(sent.session, {
      jsonrpc: "2.0",
      id: sent.message.id,
      error: { code, message },
    });
  }

  emitMessage(
    session: LanguageServiceSession,
    message: unknown,
  ): void {
    this.sink(session)({
      type: "message",
      ...session,
      sequence: 1,
      message,
    });
  }

  emitExit(
    session: LanguageServiceSession,
    code: number | null = 0,
  ): void {
    this.sink(session)({
      type: "exit",
      ...session,
      sequence: 1,
      code,
      signal: null,
    });
  }

  emitError(session: LanguageServiceSession, error: string): void {
    this.sink(session)({
      type: "error",
      ...session,
      sequence: 1,
      error,
    });
  }

  private sink(session: LanguageServiceSession): LanguageServiceEventSink {
    const sink = this.sinks.get(session.session);
    if (!sink) throw new Error(`No sink for ${session.session}`);
    return sink;
  }
}

const initializeOptions = {
  runtimeProfile: getLanguageServiceRuntimeProfile("texlab"),
  clientInfo: { name: "Oleafly test" },
} as const;

async function requestAt(
  transport: FakeTransport,
  method: string,
  index = 0,
): Promise<SentMessage> {
  let found: SentMessage | undefined;
  await vi.waitFor(() => {
    found = transport.requests(method)[index];
    expect(found).toBeDefined();
  });
  if (!found) throw new Error(`Missing ${method} request`);
  return found;
}

async function startClient(
  client: LanguageServiceClient,
  transport: FakeTransport,
  capabilities: Record<string, JsonValue> = {},
  options: LanguageServiceClientStartOptions = initializeOptions,
): Promise<void> {
  const initializeIndex = transport.requests("initialize").length;
  const started = client.start(options);
  const initialize = await requestAt(
    transport,
    "initialize",
    initializeIndex,
  );
  transport.respond(initialize, {
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: 2,
        save: { includeText: true },
      },
      ...capabilities,
    },
  });
  await started;
}

function createClient(
  transport: FakeTransport,
  requestTimeoutMs = 1_000,
  kind: "texlab" | "tinymist" = "texlab",
): LanguageServiceClient {
  return new LanguageServiceClient({
    transport,
    kind,
    projectId: "project",
    requestTimeoutMs,
  });
}

async function openMain(client: LanguageServiceClient): Promise<void> {
  await client.openDocument({
    uri: "file:///project/main.tex",
    languageId: "latex",
    version: 1,
    text: "\\section{Hello}",
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("LanguageServiceClient", () => {
  it("handshakes, negotiates capabilities and encoding, gates calls, then shuts down", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport, {
      positionEncoding: "utf-8",
      completionProvider: { triggerCharacters: ["\\"] },
      hoverProvider: false,
      definitionProvider: true,
      referencesProvider: true,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      diagnosticProvider: { workspaceDiagnostics: true },
      semanticTokensProvider: {
        legend: {
          tokenTypes: ["macro"],
          tokenModifiers: ["definition"],
        },
        full: true,
        range: false,
      },
    });

    expect(client.state).toBe("ready");
    expect(client.positionEncoding).toBe("utf-8");
    expect(client.supports("completion")).toBe(true);
    expect(client.supports("hover")).toBe(false);
    expect(client.supports("definition")).toBe(true);
    expect(client.supports("workspaceDiagnostics")).toBe(true);
    expect(client.supports("semanticTokensFull")).toBe(true);
    expect(client.supports("semanticTokensRange")).toBe(false);
    expect(transport.notifications("initialized")).toHaveLength(1);
    expect(
      transport.notifications("workspace/didChangeConfiguration")[0]
        ?.message,
    ).toMatchObject({
      method: "workspace/didChangeConfiguration",
      params: initializeOptions.runtimeProfile.didChangeConfiguration,
    });
    const handshakeMethods = transport.sent.slice(0, 3).map(
      ({ message }) =>
        isJsonRpcRequest(message) ||
        isJsonRpcNotification(message)
          ? message.method
          : null,
    );
    expect(handshakeMethods).toEqual([
      "initialize",
      "initialized",
      "workspace/didChangeConfiguration",
    ]);
    const initialize = transport.requests("initialize")[0]?.message;
    expect(initialize).toMatchObject({
      method: "initialize",
      params: {
        rootUri: "file:///project",
        initializationOptions:
          initializeOptions.runtimeProfile.initializationOptions,
        capabilities: {
          textDocument: {
            publishDiagnostics: { versionSupport: true },
          },
        },
      },
    });
    expect(
      transport.notifications("textDocument/didOpen"),
    ).toHaveLength(0);

    await openMain(client);
    await expect(
      client.requestHover({
        textDocument: { uri: "file:///project/main.tex" },
        position: { line: 0, character: 0 },
      }),
    ).rejects.toBeInstanceOf(
      UnsupportedLanguageServiceCapabilityError,
    );
    expect(transport.requests("textDocument/hover")).toHaveLength(0);

    const completionPromise = client.requestCompletion({
      textDocument: { uri: "file:///project/main.tex" },
      position: { line: 0, character: 1 },
    });
    const completion = await requestAt(
      transport,
      "textDocument/completion",
    );
    transport.respond(completion, [{ label: "\\section" }]);
    await expect(completionPromise).resolves.toEqual([
      { label: "\\section" },
    ]);

    const stopping = client.stop();
    const shutdown = await requestAt(transport, "shutdown");
    transport.respond(shutdown, null);
    await stopping;
    expect(client.state).toBe("stopped");
    expect(transport.notifications("exit")).toHaveLength(1);

    const ids = transport.sent
      .map(({ message }) =>
        isJsonRpcRequest(message) ? message.id : null,
      )
      .filter((id): id is string | number => id !== null);
    expect(ids).toEqual([1, 2, 3, 4]);
  });

  it("sends the pinned Tinymist initialization profile before any document opens", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport, 1_000, "tinymist");
    const runtimeProfile =
      getLanguageServiceRuntimeProfile("tinymist");
    await startClient(
      client,
      transport,
      {},
      {
        runtimeProfile,
        clientInfo: { name: "Oleafly test" },
      },
    );

    expect(
      transport.sent.map(({ message }) =>
        isJsonRpcRequest(message) ||
        isJsonRpcNotification(message)
          ? message.method
          : null,
      ),
    ).toEqual(["initialize", "initialized"]);
    expect(transport.requests("initialize")[0]?.message).toMatchObject({
      params: {
        initializationOptions: runtimeProfile.initializationOptions,
      },
    });
    expect(
      transport.notifications("workspace/didChangeConfiguration"),
    ).toHaveLength(0);
    expect(
      transport.notifications("textDocument/didOpen"),
    ).toHaveLength(0);
  });

  it("obeys none/full/incremental sync and save negotiation", async () => {
    const noneTransport = new FakeTransport();
    const noneClient = createClient(noneTransport);
    await startClient(noneClient, noneTransport, {
      textDocumentSync: {
        openClose: false,
        change: 0,
        save: true,
      },
    });
    await openMain(noneClient);
    await noneClient.replaceDocument(
      "file:///project/main.tex",
      "changed",
    );
    await noneClient.saveDocument("file:///project/main.tex");
    await noneClient.closeDocument("file:///project/main.tex");
    expect(
      noneTransport.notifications("textDocument/didOpen"),
    ).toHaveLength(0);
    expect(
      noneTransport.notifications("textDocument/didChange"),
    ).toHaveLength(0);
    expect(
      noneTransport.notifications("textDocument/didSave")[0]?.message,
    ).toMatchObject({
      params: {
        textDocument: { uri: "file:///project/main.tex" },
      },
    });

    const fullTransport = new FakeTransport();
    const fullClient = createClient(fullTransport);
    await startClient(fullClient, fullTransport, {
      textDocumentSync: {
        openClose: true,
        change: 1,
        save: { includeText: true },
      },
    });
    await openMain(fullClient);
    await fullClient.replaceDocument(
      "file:///project/main.tex",
      "whole document",
    );
    await fullClient.saveDocument("file:///project/main.tex");
    expect(
      fullTransport.notifications("textDocument/didChange")[0]
        ?.message,
    ).toMatchObject({
      params: { contentChanges: [{ text: "whole document" }] },
    });
    expect(
      fullTransport.notifications("textDocument/didSave")[0]?.message,
    ).toMatchObject({
      params: { text: "whole document" },
    });

    const incrementalTransport = new FakeTransport();
    const incrementalClient = createClient(incrementalTransport);
    await startClient(incrementalClient, incrementalTransport, {
      positionEncoding: "utf-8",
      textDocumentSync: {
        openClose: true,
        change: 2,
        save: false,
      },
    });
    await incrementalClient.openDocument({
      uri: "file:///project/unicode.tex",
      languageId: "latex",
      version: 1,
      text: "α😀z",
    });
    await incrementalClient.replaceDocument(
      "file:///project/unicode.tex",
      "α😀Qz",
    );
    expect(
      incrementalTransport.notifications("textDocument/didChange")[0]
        ?.message,
    ).toMatchObject({
      params: {
        contentChanges: [
          {
            range: {
              start: { line: 0, character: 6 },
              end: { line: 0, character: 6 },
            },
            text: "Q",
          },
        ],
      },
    });
    await incrementalClient.saveDocument(
      "file:///project/unicode.tex",
    );
    expect(
      incrementalTransport.notifications("textDocument/didSave"),
    ).toHaveLength(0);
  });

  it("makes the newest same-revision request authoritative", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport, { completionProvider: {} });
    await openMain(client);

    const firstPromise = client.requestCompletion({
      textDocument: { uri: "file:///project/main.tex" },
      position: { line: 0, character: 1 },
    });
    const firstExpectation = expect(firstPromise).rejects.toBeInstanceOf(
      StaleLanguageServiceResultError,
    );
    const secondPromise = client.requestCompletion({
      textDocument: { uri: "file:///project/main.tex" },
      position: { line: 0, character: 2 },
    });
    const first = await requestAt(
      transport,
      "textDocument/completion",
      0,
    );
    const second = await requestAt(
      transport,
      "textDocument/completion",
      1,
    );
    transport.respond(second, { order: 2 });
    transport.respond(first, { order: 1 });

    await firstExpectation;
    await expect(secondPromise).resolves.toEqual({ order: 2 });
    if (
      !isJsonRpcRequest(first.message) ||
      !isJsonRpcRequest(second.message)
    ) {
      throw new Error("Expected requests");
    }
    expect(Number(second.message.id)).toBeGreaterThan(
      Number(first.message.id),
    );
  });

  it("cancels requests on AbortSignal and timeout", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport, { completionProvider: {} });
    await openMain(client);

    const controller = new AbortController();
    const aborted = client.requestCompletion(
      {
        textDocument: { uri: "file:///project/main.tex" },
        position: { line: 0, character: 1 },
      },
      { signal: controller.signal },
    );
    const abortExpectation = expect(aborted).rejects.toBeInstanceOf(
      LanguageServiceAbortError,
    );
    controller.abort();
    await abortExpectation;

    vi.useFakeTimers();
    const timedOut = client.requestCompletion(
      {
        textDocument: { uri: "file:///project/main.tex" },
        position: { line: 0, character: 2 },
      },
      { timeoutMs: 25 },
    );
    const timeoutExpectation = expect(timedOut).rejects.toBeInstanceOf(
      LanguageServiceTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(26);
    await timeoutExpectation;

    expect(transport.notifications("$/cancelRequest")).toHaveLength(2);
  });

  it("rejects results after document and project revisions change", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport, { completionProvider: {} });
    await openMain(client);

    const documentRequest = client.requestCompletion({
      textDocument: { uri: "file:///project/main.tex" },
      position: { line: 0, character: 1 },
    });
    const documentExpectation = expect(
      documentRequest,
    ).rejects.toBeInstanceOf(StaleLanguageServiceResultError);
    await client.changeDocument(
      "file:///project/main.tex",
      [{ text: "\\section{Changed}" }],
      1,
    );
    await documentExpectation;

    const projectRequest = client.requestCompletion({
      textDocument: { uri: "file:///project/main.tex" },
      position: { line: 0, character: 1 },
    });
    const projectExpectation = expect(
      projectRequest,
    ).rejects.toBeInstanceOf(StaleLanguageServiceResultError);
    client.setProjectRevision(2);
    await projectExpectation;
  });

  it("sends monotonic didOpen/didChange/didClose document versions", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport, {});
    const uri = "file:///project/versions.tex";
    await client.openDocument({
      uri,
      languageId: "latex",
      version: 4,
      text: "old",
    });
    expect(client.getDocument(uri)?.version).toBe(4);

    await expect(
      client.changeDocument(uri, [{ text: "new" }]),
    ).resolves.toBe(5);
    expect(client.getDocument(uri)).toMatchObject({
      version: 5,
      text: "new",
    });
    await expect(
      client.didChange({
        textDocument: { uri, version: 5 },
        contentChanges: [{ text: "invalid" }],
      }),
    ).rejects.toThrow("monotonically");

    await client.closeDocument(uri);
    expect(client.getDocument(uri)).toBeNull();
    expect(transport.notifications("textDocument/didOpen")).toHaveLength(
      1,
    );
    expect(
      transport.notifications("textDocument/didChange"),
    ).toHaveLength(1);
    expect(
      transport.notifications("textDocument/didClose"),
    ).toHaveLength(1);
  });

  it("invalidates pending work on restart and ignores old-generation events", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport, { completionProvider: {} });
    await openMain(client);
    const oldSession = client.session;
    if (!oldSession) throw new Error("Expected active session");

    const pending = client.requestCompletion({
      textDocument: { uri: "file:///project/main.tex" },
      position: { line: 0, character: 1 },
    });
    const pendingExpectation = expect(pending).rejects.toBeInstanceOf(
      LanguageServiceExitedError,
    );
    const restarted = client.restart();
    const shutdown = await requestAt(transport, "shutdown");
    transport.respond(shutdown, null);
    const secondInitialize = await requestAt(
      transport,
      "initialize",
      1,
    );
    transport.respond(secondInitialize, {
      capabilities: { completionProvider: {} },
    });
    await restarted;
    await pendingExpectation;

    expect(client.generation).toBe(2);
    expect(client.state).toBe("ready");
    transport.emitExit(oldSession, 9);
    expect(client.state).toBe("ready");

    if (!isJsonRpcRequest(secondInitialize.message)) {
      throw new Error("Expected initialize request");
    }
    expect(Number(secondInitialize.message.id)).toBeGreaterThan(3);
  });

  it("cannot revive a start operation after stop supersedes it", async () => {
    const transport = new FakeTransport();
    let releaseStart = () => {};
    transport.startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const client = createClient(transport);
    const starting = client.start(initializeOptions);
    const rejectedStart = expect(starting).rejects.toThrow(
      /start was superseded/u,
    );
    await vi.waitFor(() => {
      expect(transport.status().state).toBe("running");
    });

    await client.stop();
    expect(client.state).toBe("stopped");
    await expect(client.start(initializeOptions)).rejects.toThrow(
      /start operation is already pending/u,
    );

    releaseStart();
    await rejectedStart;
    expect(client.state).toBe("stopped");
    expect(client.session).toBeNull();
    expect(transport.stopped).toHaveLength(1);
    expect(transport.requests("initialize")).toHaveLength(0);
  });

  it("fails closed and retains cleanup identity when early client events exceed the bounded queue", async () => {
    const transport = new FakeTransport();
    transport.startEventCount = 257;
    const client = createClient(transport);

    await expect(client.start(initializeOptions)).rejects.toThrow(
      "256-event client queue limit",
    );

    expect(client.state).toBe("error");
    expect(client.session).toBeNull();
    expect(transport.requests("initialize")).toHaveLength(0);
    expect(transport.stopped).toEqual([
      expect.objectContaining({
        session: "opaque-test-session-1",
        generation: 1,
      }),
    ]);
  });

  it("rejects pending requests on transport errors and exits", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport, { completionProvider: {} });
    await openMain(client);
    const firstSession = client.session;
    if (!firstSession) throw new Error("Expected active session");

    const pending = client.requestCompletion({
      textDocument: { uri: "file:///project/main.tex" },
      position: { line: 0, character: 0 },
    });
    const rejected = expect(pending).rejects.toThrow("transport broke");
    transport.emitError(firstSession, "transport broke");
    await rejected;
    expect(client.state).toBe("error");

    await startClient(client, transport, { completionProvider: {} });
    await openMain(client);
    const secondSession = client.session;
    if (!secondSession) throw new Error("Expected restarted session");
    const afterRestart = client.requestCompletion({
      textDocument: { uri: "file:///project/main.tex" },
      position: { line: 0, character: 0 },
    });
    const exited = expect(afterRestart).rejects.toBeInstanceOf(
      LanguageServiceExitedError,
    );
    transport.emitExit(secondSession, 1);
    await exited;
    expect(client.state).toBe("exited");
  });

  it("retains a failed initialization session and retries best-effort cleanup", async () => {
    const transport = new FakeTransport();
    transport.stopFailures = 1;
    const client = createClient(transport);
    const starting = client.start(initializeOptions);
    const initialize = await requestAt(transport, "initialize");
    transport.respond(initialize, { malformed: true });

    await expect(starting).rejects.toThrow("capabilities");
    expect(client.state).toBe("error");
    expect(transport.stopped).toHaveLength(1);

    await client.stop();
    expect(transport.stopped).toHaveLength(2);
    expect(client.state).toBe("stopped");
  });

  it("quarantines unversioned diagnostics until the document epoch barrier and quiet window", async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport, {});
    const events: Array<{
      type: string;
      reason?: string;
      message?: string;
      epoch?: number;
    }> = [];
    client.subscribe((event) => {
      if (event.type === "discarded") {
        events.push({ type: event.type, reason: event.reason });
      } else if (event.type === "diagnostics") {
        events.push({
          type: event.type,
          message: event.diagnostics[0]?.message,
          epoch: event.diagnosticEpoch,
        });
      } else if (event.type === "diagnosticsPending") {
        events.push({
          type: event.type,
          epoch: event.diagnosticEpoch,
        });
      } else {
        events.push({ type: event.type });
      }
    });
    await openMain(client);
    const session = client.session;
    if (!session) throw new Error("Expected active session");
    const barrier = transport.requests(
      "textDocument/documentSymbol",
    )[0];
    if (!barrier) throw new Error("Expected diagnostic barrier");
    const diagnostic = {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      severity: 1,
      source: "texlab",
      message: "Older candidate",
    } as const;

    transport.emitMessage(session, {
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri: "file:///project/main.tex",
        diagnostics: [diagnostic],
      },
    });
    expect(
      events.filter((event) => event.type === "diagnostics"),
    ).toHaveLength(0);

    transport.respond(barrier, []);
    transport.emitMessage(session, {
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri: "file:///project/main.tex",
        diagnostics: [
          { ...diagnostic, message: "Current candidate" },
        ],
      },
    });
    await vi.advanceTimersByTimeAsync(76);
    expect(
      events.filter((event) => event.type === "diagnostics"),
    ).toEqual([
      {
        type: "diagnostics",
        message: "Current candidate",
        epoch: 1,
      },
    ]);

    await client.replaceDocument(
      "file:///project/main.tex",
      "\\section{Changed}",
      1,
    );
    const nextBarrier = transport.requests(
      "textDocument/documentSymbol",
    )[1];
    if (!nextBarrier) throw new Error("Expected next diagnostic barrier");
    transport.emitMessage(session, {
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri: "file:///project/main.tex",
        version: 1,
        diagnostics: [diagnostic],
      },
    });
    transport.emitMessage(session, {
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri: "file:///project/main.tex",
        diagnostics: [
          { ...diagnostic, message: "Newest revision" },
        ],
      },
    });
    transport.respond(nextBarrier, []);
    await vi.advanceTimersByTimeAsync(76);
    expect(
      events.filter((event) => event.type === "diagnostics"),
    ).toHaveLength(2);
    expect(
      events.filter((event) => event.type === "discarded"),
    ).toContainEqual({
      type: "discarded",
      reason: "diagnostics document version is stale",
    });
    expect(events.at(-1)).toEqual({
      type: "diagnostics",
      message: "Newest revision",
      epoch: 2,
    });
    expect(
      events.filter((event) => event.type === "diagnosticsPending"),
    ).toEqual(
      [
        { type: "diagnosticsPending", epoch: 1 },
        { type: "diagnosticsPending", epoch: 2 },
      ],
    );
  });

  it("surfaces JSON-RPC errors without confusing them with transport exits", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport, { completionProvider: {} });
    await openMain(client);
    const pending = client.requestCompletion({
      textDocument: { uri: "file:///project/main.tex" },
      position: { line: 0, character: 0 },
    });
    const request = await requestAt(
      transport,
      "textDocument/completion",
    );
    transport.respondError(request, -32001, "server rejected request");
    await expect(pending).rejects.toMatchObject({
      name: "JsonRpcRemoteError",
      code: -32001,
      message: "server rejected request",
    });
    expect(client.state).toBe("ready");
  });
});
