import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  assertJsonRpcError,
  createIncrementalContentChange,
  LanguageServiceAbortError,
  LanguageServiceClient,
  LanguageServiceExitedError,
  LanguageServiceStateError,
  LanguageServiceTimeoutError,
  StaleLanguageServiceResultError,
  UnsupportedLanguageServiceCapabilityError,
  type LanguageServiceClientEvent,
  type LanguageServiceClientStartOptions,
} from "./client";
import { getLanguageServiceRuntimeProfile } from "./runtime-profile";
import {
  isJsonRpcNotification,
  isJsonRpcRequest,
  JsonRpcProtocolError,
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
  workspaceRoot = "/project";
  sendFailure: ((message: JsonRpcMessage) => Error | null) | null = null;
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
      workspaceRoot: this.workspaceRoot,
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
    const failure = this.sendFailure?.(message);
    if (failure) throw failure;
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
  await vi.waitFor(
    () => {
      found = transport.requests(method)[index];
      expect(found).toBeDefined();
    },
    { interval: 2 },
  );
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

describe("LanguageServiceClient editing features", () => {
  const typstUri = "file:///project/main.typ";
  const tinymistOptions: LanguageServiceClientStartOptions = {
    runtimeProfile: getLanguageServiceRuntimeProfile("tinymist"),
    clientInfo: { name: "Oleafly test" },
  };

  async function startTinymist(
    capabilities: Record<string, JsonValue>,
  ): Promise<{ client: LanguageServiceClient; transport: FakeTransport }> {
    const transport = new FakeTransport();
    const client = createClient(transport, 1_000, "tinymist");
    await startClient(client, transport, capabilities, tinymistOptions);
    await client.openDocument({
      uri: typstUri,
      languageId: "typst",
      version: 1,
      text: "#let x = rgb(\"#ff0000\")\n#text(fill: x)[hi]",
    });
    return { client, transport };
  }

  it("sends each editing request the server advertises", async () => {
    const { client, transport } = await startTinymist({
      signatureHelpProvider: { triggerCharacters: ["(", ",", ":"] },
      inlayHintProvider: true,
      documentLinkProvider: {},
      colorProvider: true,
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      renameProvider: { prepareProvider: true },
    });
    const textDocument = { uri: typstUri };
    const position = { line: 1, character: 6 };
    const range = {
      start: { line: 0, character: 0 },
      end: { line: 1, character: 0 },
    };
    const options = { tabSize: 2, insertSpaces: true };
    const calls: Array<[string, () => Promise<JsonValue>]> = [
      [
        "textDocument/signatureHelp",
        () =>
          client.requestSignatureHelp({
            textDocument,
            position,
            context: {
              triggerKind: 2,
              triggerCharacter: "(",
              isRetrigger: false,
            },
          }),
      ],
      [
        "textDocument/inlayHint",
        () => client.requestInlayHints({ textDocument, range }),
      ],
      [
        "textDocument/documentLink",
        () => client.requestDocumentLinks({ textDocument }),
      ],
      [
        "textDocument/documentColor",
        () => client.requestDocumentColors({ textDocument }),
      ],
      [
        "textDocument/formatting",
        () => client.requestFormatting({ textDocument, options }),
      ],
      [
        "textDocument/rangeFormatting",
        () =>
          client.requestRangeFormatting({ textDocument, options, range }),
      ],
      [
        "textDocument/prepareRename",
        () => client.requestPrepareRename({ textDocument, position }),
      ],
      [
        "textDocument/rename",
        () =>
          client.requestRename({ textDocument, position, newName: "y" }),
      ],
    ];
    for (const [method, call] of calls) {
      const pending = call();
      const sent = await requestAt(transport, method);
      expect(sent.message).toMatchObject({
        method,
        params: { textDocument },
      });
      transport.respond(sent, [method]);
      await expect(pending).resolves.toEqual([method]);
    }
  });

  it("refuses editing requests the server did not advertise", async () => {
    const { client, transport } = await startTinymist({});
    const textDocument = { uri: typstUri };
    await expect(
      client.requestFormatting({
        textDocument,
        options: { tabSize: 2, insertSpaces: true },
      }),
    ).rejects.toBeInstanceOf(UnsupportedLanguageServiceCapabilityError);
    await expect(
      client.requestSignatureHelp({
        textDocument,
        position: { line: 0, character: 0 },
      }),
    ).rejects.toBeInstanceOf(UnsupportedLanguageServiceCapabilityError);
    await expect(
      client.executeCommand({ command: "tinymist.pinMain", arguments: [null] }),
    ).rejects.toBeInstanceOf(UnsupportedLanguageServiceCapabilityError);
    expect(transport.requests("textDocument/formatting")).toHaveLength(0);
    expect(transport.requests("workspace/executeCommand")).toHaveLength(0);
  });

  it("runs only the commands the server lists", async () => {
    const { client, transport } = await startTinymist({
      executeCommandProvider: { commands: ["tinymist.pinMain"] },
    });
    expect(client.supportsCommand("tinymist.pinMain")).toBe(true);
    expect(client.supportsCommand("tinymist.exportPdf")).toBe(false);
    const pinned = client.executeCommand({
      command: "tinymist.pinMain",
      arguments: ["/project/main.typ"],
    });
    const sent = await requestAt(transport, "workspace/executeCommand");
    expect(sent.message).toMatchObject({
      params: {
        command: "tinymist.pinMain",
        arguments: ["/project/main.typ"],
      },
    });
    transport.respond(sent, null);
    await expect(pinned).resolves.toBeNull();
    await expect(
      client.executeCommand({ command: "tinymist.exportPdf" }),
    ).rejects.toBeInstanceOf(UnsupportedLanguageServiceCapabilityError);
  });

  it("pushes configuration changes to a running server", async () => {
    const { client, transport } = await startTinymist({});
    await client.changeConfiguration({ formatterPrintWidth: 80 });
    expect(
      transport.notifications("workspace/didChangeConfiguration").at(-1)
        ?.message,
    ).toMatchObject({
      params: { settings: { formatterPrintWidth: 80 } },
    });
  });
});

const MAIN_URI = "file:///project/main.tex";
const OTHER_URI = "file:///project/other.tex";
const AT_START = { line: 0, character: 0 };

function recordEvents(client: LanguageServiceClient) {
  const events: LanguageServiceClientEvent[] = [];
  client.subscribe((event) => events.push(event));
  return events;
}

describe("LanguageServiceClient configuration and idle state", () => {
  it.each([
    [{ projectId: "  " }, "projectId is required"],
    [{ requestTimeoutMs: 0 }, "requestTimeoutMs must be positive"],
    [{ requestTimeoutMs: Number.NaN }, "requestTimeoutMs must be positive"],
    [
      { diagnosticQuietWindowMs: -1 },
      "diagnosticQuietWindowMs must be a non-negative number",
    ],
    [
      { positionEncodings: [] },
      "At least one position encoding must be offered",
    ],
  ])("rejects the options %o", (overrides, message) => {
    const create = () =>
      new LanguageServiceClient({
        transport: new FakeTransport(),
        kind: "texlab",
        projectId: "project",
        ...overrides,
      });
    expect(create).toThrow(RangeError);
    expect(create).toThrow(message);
  });

  it("reports an idle client and refuses work that needs a session", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);

    expect(client.workspaceRoot).toBeNull();
    expect(client.rootUri).toBeNull();
    expect(client.status()).toEqual({
      state: "stopped",
      session: null,
      generation: 0,
      projectRevision: 0,
      transport: { state: "stopped", session: null },
    });
    await expect(client.refreshTransportStatus()).rejects.toThrow(
      "Language service has no active session",
    );
    await expect(openMain(client)).rejects.toThrow(
      "Language service is not ready (stopped)",
    );
    expect(() => client.acknowledgeDocumentRevision(MAIN_URI)).toThrow(
      LanguageServiceStateError,
    );
    await expect(client.restart()).rejects.toThrow(
      "Cannot restart before initialization options are known",
    );
    await expect(client.exit()).resolves.toBeUndefined();
    expect(transport.sent).toEqual([]);
    expect(client.state).toBe("stopped");
  });

  it("encodes a Windows workspace root and hands out capability copies", async () => {
    const transport = new FakeTransport();
    transport.workspaceRoot = "C:\\Papers\\My Paper";
    const client = createClient(transport);
    await startClient(client, transport, {
      semanticTokensProvider: {
        legend: { tokenTypes: ["macro"], tokenModifiers: [] },
        full: true,
      },
      executeCommandProvider: { commands: ["texlab.build"] },
    });

    expect(client.workspaceRoot).toBe("C:\\Papers\\My Paper");
    expect(client.rootUri).toBe("file:///C:/Papers/My%20Paper");
    expect(transport.requests("initialize")[0]?.message).toMatchObject({
      params: { rootUri: "file:///C:/Papers/My%20Paper" },
    });
    const copy = client.capabilities;
    copy.semanticTokens.legend?.tokenTypes.push("mutated");
    copy.executeCommands.push("injected");
    expect(client.capabilities.semanticTokens.legend?.tokenTypes).toEqual([
      "macro",
    ]);
    expect(client.supportsCommand("injected")).toBe(false);
    expect(client.supports("executeCommand")).toBe(true);
    expect(client.status()).toMatchObject({
      state: "ready",
      generation: 1,
      session: { session: "opaque-test-session-1" },
      transport: { state: "running" },
    });
    await expect(client.refreshTransportStatus()).resolves.toMatchObject({
      state: "running",
    });
  });

  it("validates and advances the project revision, invalidating older requests", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport, { completionProvider: {} });
    expect(client.supports("executeCommand")).toBe(false);
    expect(() => client.setProjectRevision(-1)).toThrow(RangeError);
    expect(() => client.setProjectRevision(1.5)).toThrow(RangeError);
    await openMain(client);

    const pending = client.requestCompletion({
      textDocument: { uri: MAIN_URI },
      position: AT_START,
    });
    const stale = expect(pending).rejects.toBeInstanceOf(
      StaleLanguageServiceResultError,
    );
    expect(client.advanceProjectRevision()).toBe(1);
    expect(client.projectRevision).toBe(1);
    await stale;
  });
});

describe("LanguageServiceClient lifecycle edges", () => {
  it("refuses to start twice or with another server's profile", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport);
    await expect(client.start(initializeOptions)).rejects.toThrow(
      "Cannot start language service while ready",
    );

    const tinymist = createClient(new FakeTransport(), 1_000, "tinymist");
    await expect(tinymist.start(initializeOptions)).rejects.toThrow(
      "Runtime profile texlab does not match client tinymist",
    );
    expect(tinymist.state).toBe("stopped");
  });

  it("refuses to start while an earlier failed session still cannot be stopped", async () => {
    const transport = new FakeTransport();
    transport.stopFailures = 2;
    const client = createClient(transport);
    const starting = client.start(initializeOptions);
    const initialize = await requestAt(transport, "initialize");
    transport.respond(initialize, { malformed: true });
    await expect(starting).rejects.toThrow("capabilities");

    await expect(client.start(initializeOptions)).rejects.toThrow(
      "stop failed",
    );
    expect(client.state).toBe("error");
    expect(transport.requests("initialize")).toHaveLength(1);

    await startClient(client, transport);
    expect(client.state).toBe("ready");
    expect(transport.stopped).toHaveLength(3);
  });

  it("skips the shutdown request when stopping before initialization finishes", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    const starting = client.start(initializeOptions);
    const startFailed = expect(starting).rejects.toBeInstanceOf(
      LanguageServiceExitedError,
    );
    await requestAt(transport, "initialize");

    await client.stop();
    await startFailed;
    expect(transport.requests("shutdown")).toHaveLength(0);
    expect(transport.notifications("exit")).toHaveLength(1);
    expect(client.state).toBe("stopped");
    expect(client.session).toBeNull();
  });

  it("reports a failed shutdown request but still exits and stops", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport);
    const stopping = client.stop();
    const shutdown = await requestAt(transport, "shutdown");
    transport.respondError(shutdown, -32603, "shutdown failed");

    await expect(stopping).rejects.toThrow("shutdown failed");
    expect(transport.notifications("exit")).toHaveLength(1);
    expect(client.state).toBe("stopped");
  });

  it("does not send exit to a server that already exited during shutdown", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport);
    const session = client.session;
    if (!session) throw new Error("Expected active session");
    const stopping = client.stop();
    await requestAt(transport, "shutdown");
    transport.emitExit(session, 0);

    await expect(stopping).rejects.toBeInstanceOf(LanguageServiceExitedError);
    expect(transport.notifications("exit")).toHaveLength(0);
    expect(client.state).toBe("stopped");
  });

  it("reports a failed exit notification after a clean shutdown", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport);
    transport.sendFailure = (message) =>
      isJsonRpcNotification(message) && message.method === "exit"
        ? new Error("pipe closed")
        : null;
    const stopping = client.stop();
    transport.respond(await requestAt(transport, "shutdown"), null);

    await expect(stopping).rejects.toThrow("pipe closed");
    expect(client.state).toBe("stopped");
  });

  it("exits without the shutdown handshake and invalidates pending work", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport, { completionProvider: {} });
    await openMain(client);
    const session = client.session;
    const pending = client.requestCompletion({
      textDocument: { uri: MAIN_URI },
      position: AT_START,
    });
    const rejected = expect(pending).rejects.toBeInstanceOf(
      LanguageServiceExitedError,
    );

    await client.exit();
    await rejected;
    expect(transport.requests("shutdown")).toHaveLength(0);
    expect(transport.notifications("exit")).toHaveLength(1);
    expect(transport.stopped).toEqual([session]);
    expect(client.state).toBe("exited");
    expect(client.session).toBeNull();
    expect(client.getDocument(MAIN_URI)).toBeNull();
  });

  it("reports a failed exit notification and keeps the session for cleanup", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport);
    const session = client.session;
    const events = recordEvents(client);
    transport.sendFailure = (message) =>
      isJsonRpcNotification(message) && message.method === "exit"
        ? new Error("pipe closed")
        : null;

    await expect(client.exit()).rejects.toThrow("pipe closed");
    expect(client.state).toBe("exited");
    expect(client.session).toBeNull();
    expect(events.at(-1)).toMatchObject({
      type: "status",
      state: "exited",
      error: { message: "pipe closed" },
    });

    await client.stop();
    expect(transport.stopped).toEqual([session]);
    expect(client.state).toBe("stopped");
  });
});

describe("LanguageServiceClient document guards", () => {
  it("rejects invalid versions, duplicate opens and edits to closed documents", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport);
    await expect(
      client.openDocument({
        uri: MAIN_URI,
        languageId: "latex",
        version: -1,
        text: "",
      }),
    ).rejects.toThrow(RangeError);
    await openMain(client);
    await expect(openMain(client)).rejects.toThrow(
      `Document is already open: ${MAIN_URI}`,
    );
    await expect(
      client.didChange({
        textDocument: { uri: OTHER_URI, version: 2 },
        contentChanges: [{ text: "x" }],
      }),
    ).rejects.toThrow(`Document is not open: ${OTHER_URI}`);
    await expect(
      client.changeDocument(OTHER_URI, [{ text: "x" }]),
    ).rejects.toThrow(`Document is not open: ${OTHER_URI}`);
    await expect(client.saveDocument(OTHER_URI)).rejects.toThrow(
      `Document is not open: ${OTHER_URI}`,
    );
    expect(() => client.acknowledgeDocumentRevision(OTHER_URI)).toThrow(
      `Document is not open: ${OTHER_URI}`,
    );
    await expect(client.closeDocument(OTHER_URI)).resolves.toBeUndefined();
    expect(transport.notifications("textDocument/didClose")).toHaveLength(0);
  });

  it("applies ranged edits, including reversed ranges, and sends the smallest change", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport);
    await openMain(client);

    await client.changeDocument(MAIN_URI, [
      {
        range: {
          start: { line: 0, character: 9 },
          end: { line: 0, character: 14 },
        },
        text: "World",
      },
    ]);
    expect(client.getDocument(MAIN_URI)?.text).toBe("\\section{World}");

    await client.changeDocument(MAIN_URI, [
      {
        range: {
          start: { line: 0, character: 14 },
          end: { line: 0, character: 9 },
        },
        text: "Again",
      },
    ]);
    expect(client.getDocument(MAIN_URI)).toMatchObject({
      text: "\\section{Again}",
      version: 3,
    });
    expect(
      transport.notifications("textDocument/didChange").at(-1)?.message,
    ).toMatchObject({
      params: {
        textDocument: { uri: MAIN_URI, version: 3 },
        contentChanges: [
          {
            range: {
              start: { line: 0, character: 9 },
              end: { line: 0, character: 14 },
            },
            text: "Again",
          },
        ],
      },
    });
  });
});

describe("LanguageServiceClient analysis requests", () => {
  it("sends every analysis request the server advertises", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport, {
      definitionProvider: true,
      referencesProvider: true,
      documentSymbolProvider: true,
      diagnosticProvider: { workspaceDiagnostics: true },
      semanticTokensProvider: {
        legend: { tokenTypes: ["macro"], tokenModifiers: [] },
        full: true,
        range: true,
      },
    });
    await openMain(client);
    const textDocument = { uri: MAIN_URI };
    const calls: Array<[string, () => Promise<JsonValue>]> = [
      [
        "textDocument/definition",
        () => client.requestDefinition({ textDocument, position: AT_START }),
      ],
      [
        "textDocument/references",
        () =>
          client.requestReferences({
            textDocument,
            position: AT_START,
            context: { includeDeclaration: true },
          }),
      ],
      [
        "textDocument/documentSymbol",
        () => client.requestDocumentSymbols({ textDocument }),
      ],
      [
        "textDocument/diagnostic",
        () => client.requestDocumentDiagnostics({ textDocument }),
      ],
      [
        "workspace/diagnostic",
        () => client.requestWorkspaceDiagnostics({ previousResultIds: [] }),
      ],
      [
        "textDocument/semanticTokens/full",
        () => client.requestSemanticTokensFull({ textDocument }),
      ],
      [
        "textDocument/semanticTokens/range",
        () =>
          client.requestSemanticTokensRange({
            textDocument,
            range: { start: AT_START, end: { line: 0, character: 4 } },
          }),
      ],
    ];
    for (const [method, call] of calls) {
      const index = transport.requests(method).length;
      const result = call();
      transport.respond(await requestAt(transport, method, index), {
        answered: method,
      });
      await expect(result).resolves.toEqual({ answered: method });
    }
  });

  it("rejects requests with invalid options before sending them", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport, { completionProvider: {} });
    await openMain(client);
    const params = { textDocument: { uri: MAIN_URI }, position: AT_START };
    const aborted = new AbortController();
    aborted.abort();

    await expect(
      client.requestCompletion(params, { timeoutMs: 0 }),
    ).rejects.toThrow("Request timeout must be positive");
    await expect(
      client.requestCompletion(params, { signal: aborted.signal }),
    ).rejects.toBeInstanceOf(LanguageServiceAbortError);
    await expect(
      client.requestCompletion(params, { projectRevision: 5 }),
    ).rejects.toBeInstanceOf(StaleLanguageServiceResultError);
    await expect(
      client.requestCompletion({
        textDocument: { uri: OTHER_URI },
        position: AT_START,
      }),
    ).rejects.toThrow(`Document is not open: ${OTHER_URI}`);
    await expect(
      client.requestCompletion(params, { documentVersion: 0 }),
    ).rejects.toBeInstanceOf(StaleLanguageServiceResultError);
    expect(transport.requests("textDocument/completion")).toHaveLength(0);
  });

  it("rejects a request the transport could not deliver", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport, { completionProvider: {} });
    await openMain(client);
    transport.sendFailure = (message) =>
      isJsonRpcRequest(message) && message.method === "textDocument/completion"
        ? new Error("pipe closed")
        : null;
    await expect(
      client.requestCompletion({
        textDocument: { uri: MAIN_URI },
        position: AT_START,
      }),
    ).rejects.toThrow("pipe closed");
    expect(client.state).toBe("ready");
  });
});

describe("LanguageServiceClient transport events", () => {
  it("forwards logs and notifications and refuses server requests", async () => {
    const transport = new FakeTransport();
    transport.startEventCount = 1;
    const client = createClient(transport);
    const events = recordEvents(client);
    await startClient(client, transport);
    const session = client.session;
    if (!session) throw new Error("Expected active session");

    transport.emitMessage(session, {
      jsonrpc: "2.0",
      method: "window/logMessage",
      params: { type: 3, message: "indexing" },
    });
    transport.emitMessage(session, { jsonrpc: "2.0", method: "custom/ping" });
    transport.emitMessage(session, {
      jsonrpc: "2.0",
      id: 99,
      method: "window/workDoneProgress/create",
      params: { token: "t" },
    });
    transport.emitMessage(session, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "parse error" },
    });

    expect(events).toContainEqual({
      type: "log",
      stream: "stderr",
      message: "early event 1",
      generation: 1,
    });
    expect(events).toContainEqual({
      type: "notification",
      method: "window/logMessage",
      params: { type: 3, message: "indexing" },
      generation: 1,
    });
    expect(events).toContainEqual({
      type: "notification",
      method: "custom/ping",
      generation: 1,
    });
    expect(events).toContainEqual({
      type: "discarded",
      reason: "response had a null id",
      generation: 1,
    });
    await vi.waitFor(() => {
      expect(transport.sent.at(-1)?.message).toEqual({
        jsonrpc: "2.0",
        id: 99,
        error: {
          code: -32601,
          message: "Method not found: window/workDoneProgress/create",
        },
      });
    });
    expect(client.state).toBe("ready");
  });

  it("fails the session on a malformed message", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport, { completionProvider: {} });
    await openMain(client);
    const session = client.session;
    if (!session) throw new Error("Expected active session");
    const pending = client.requestCompletion({
      textDocument: { uri: MAIN_URI },
      position: AT_START,
    });
    const rejected = expect(pending).rejects.toBeInstanceOf(
      JsonRpcProtocolError,
    );

    transport.emitMessage(session, { jsonrpc: "1.0", method: "broken" });
    await rejected;
    expect(client.state).toBe("error");
    expect(client.session).toBeNull();
    await vi.waitFor(() => expect(transport.stopped).toEqual([session]));
  });

  it("reports an exit without a code", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport);
    const events = recordEvents(client);
    const session = client.session;
    if (!session) throw new Error("Expected active session");
    transport.emitExit(session, null);
    expect(client.state).toBe("exited");
    expect(events.at(-1)).toMatchObject({
      type: "status",
      state: "exited",
      error: { message: "Language service exited" },
    });
  });
});

describe("LanguageServiceClient pushed diagnostics", () => {
  const diagnostic = (message: string) => ({
    range: { start: AT_START, end: { line: 0, character: 1 } },
    severity: 1,
    message,
  });

  async function readyWithMain(
    sync: Record<string, JsonValue> = {
      openClose: true,
      change: 2,
    },
  ) {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    const client = createClient(transport);
    await startClient(client, transport, { textDocumentSync: sync });
    const events = recordEvents(client);
    await openMain(client);
    const session = client.session;
    if (!session) throw new Error("Expected active session");
    const publish = (
      params: Record<string, JsonValue>,
    ) =>
      transport.emitMessage(session, {
        jsonrpc: "2.0",
        method: "textDocument/publishDiagnostics",
        params,
      });
    const emitted = () =>
      events.flatMap((event) =>
        event.type === "diagnostics"
          ? [event.diagnostics.map((item) => item.message)]
          : [],
      );
    const discarded = () =>
      events.flatMap((event) =>
        event.type === "discarded" ? [event.reason] : [],
      );
    return { transport, client, events, publish, emitted, discarded };
  }

  it("discards malformed, unopened and unsynchronized publications", async () => {
    const { publish, discarded, emitted } = await readyWithMain({
      openClose: false,
      change: 1,
    });
    publish({ uri: 5 } as unknown as Record<string, JsonValue>);
    publish({ uri: OTHER_URI, diagnostics: [] });
    publish({ uri: MAIN_URI, diagnostics: [diagnostic("no epoch")] });
    await vi.advanceTimersByTimeAsync(100);
    expect(discarded()).toEqual([
      "publishDiagnostics payload is malformed",
      "diagnostics target is not an open document",
      "diagnostics have no current synchronization epoch",
    ]);
    expect(emitted()).toEqual([]);
  });

  it("treats an error answer to the barrier as acknowledgement", async () => {
    const { transport, publish, emitted } = await readyWithMain();
    const barrier = await requestAt(transport, "textDocument/documentSymbol");
    transport.respondError(barrier, -32601, "no symbols here");
    await vi.advanceTimersByTimeAsync(0);
    publish({ uri: MAIN_URI, diagnostics: [diagnostic("after error")] });
    await vi.advanceTimersByTimeAsync(76);
    expect(emitted()).toEqual([["after error"]]);
  });

  it("keeps only the latest unversioned publication after the barrier", async () => {
    const { transport, publish, emitted } = await readyWithMain();
    transport.respond(
      await requestAt(transport, "textDocument/documentSymbol"),
      [],
    );
    await vi.advanceTimersByTimeAsync(0);
    publish({ uri: MAIN_URI, diagnostics: [diagnostic("first")] });
    await vi.advanceTimersByTimeAsync(40);
    publish({ uri: MAIN_URI, diagnostics: [diagnostic("second")] });
    await vi.advanceTimersByTimeAsync(76);
    expect(emitted()).toEqual([["second"]]);
  });

  it("lets a versioned publication replace a waiting unversioned one", async () => {
    const { transport, publish, emitted } = await readyWithMain();
    transport.respond(
      await requestAt(transport, "textDocument/documentSymbol"),
      [],
    );
    await vi.advanceTimersByTimeAsync(0);
    publish({ uri: MAIN_URI, diagnostics: [diagnostic("unversioned")] });
    publish({
      uri: MAIN_URI,
      version: 1,
      diagnostics: [diagnostic("versioned")],
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(emitted()).toEqual([["versioned"]]);
  });

  it.each([
    [
      "the document closes",
      (client: LanguageServiceClient) => client.closeDocument(MAIN_URI),
    ],
    [
      "the document changes",
      (client: LanguageServiceClient) =>
        client.replaceDocument(MAIN_URI, "\\section{Edited}"),
    ],
  ])(
    "drops a waiting publication when %s",
    async (_label, act) => {
      const { transport, client, publish, emitted } = await readyWithMain();
      transport.respond(
        await requestAt(transport, "textDocument/documentSymbol"),
        [],
      );
      await vi.advanceTimersByTimeAsync(0);
      publish({ uri: MAIN_URI, diagnostics: [diagnostic("stale")] });
      await act(client);
      await vi.advanceTimersByTimeAsync(200);
      expect(emitted()).toEqual([]);
    },
  );
});

describe("createIncrementalContentChange", () => {
  it("never splits a surrogate pair at the start of the change", () => {
    expect(createIncrementalContentChange("😀", "😁", "utf-16")).toEqual({
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 2 },
      },
      text: "😁",
    });
  });

  it("never splits a surrogate pair at the end of the change", () => {
    expect(
      createIncrementalContentChange("x\uD83D\uDE00", "x\uD83C\uDE00", "utf-16"),
    ).toEqual({
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 3 },
      },
      text: "\uD83C\uDE00",
    });
  });
});

describe("assertJsonRpcError", () => {
  it("accepts errors and rejects anything else", () => {
    expect(() => assertJsonRpcError(new Error("boom"))).not.toThrow();
    expect(() => assertJsonRpcError("boom")).toThrow(JsonRpcProtocolError);
  });
});
