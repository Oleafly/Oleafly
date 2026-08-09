import { describe, expect, it, vi } from "vitest";
import {
  isJsonRpcRequest,
  LanguageServiceClient,
  getLanguageServiceRuntimeProfile,
  StaleLanguageServiceResultError,
  type JsonRpcMessage,
  type JsonValue,
  type LanguageServiceEventSink,
  type LanguageServiceSession,
  type LanguageServiceRuntimeSession,
  type LanguageServiceStartOptions,
  type LanguageServiceTransport,
  type LanguageServiceTransportStatus,
} from "@/lib/language-service";
import { createProjectAnalysisStore } from "@/store/project-analysis";
import {
  ProjectAnalysisCoordinator,
} from "./coordinator";

interface Sent {
  session: LanguageServiceSession;
  message: JsonRpcMessage;
}

class CoordinatorTransport implements LanguageServiceTransport {
  readonly sent: Sent[] = [];
  private sink: LanguageServiceEventSink | null = null;
  private active: LanguageServiceRuntimeSession | null = null;
  private generation = 0;

  status(): LanguageServiceTransportStatus {
    return {
      state: this.active ? "running" : "stopped",
      session: this.active,
    };
  }

  async start(
    options: LanguageServiceStartOptions,
    sink: LanguageServiceEventSink,
  ): Promise<LanguageServiceRuntimeSession> {
    const session = {
      session: `coordinator-session-${this.generation + 1}`,
      kind: options.kind,
      generation: ++this.generation,
      projectId: options.projectId,
      workspaceRoot: "/project",
    };
    this.active = session;
    this.sink = sink;
    return session;
  }

  async send(
    session: LanguageServiceSession,
    message: JsonRpcMessage,
  ): Promise<void> {
    this.sent.push({ session, message });
  }

  async stop(session: LanguageServiceSession): Promise<void> {
    if (this.active?.session === session.session) this.active = null;
  }

  async cleanup(): Promise<void> {}

  async refreshStatus(
    session: LanguageServiceSession,
  ): Promise<LanguageServiceTransportStatus> {
    if (this.active?.session !== session.session) {
      throw new Error("stale session");
    }
    return this.status();
  }

  requests(method: string): Sent[] {
    return this.sent.filter(
      ({ message }) =>
        isJsonRpcRequest(message) && message.method === method,
    );
  }

  respond(sent: Sent, result: JsonValue): void {
    if (!isJsonRpcRequest(sent.message)) {
      throw new Error("Expected request");
    }
    this.emit(sent.session, {
      jsonrpc: "2.0",
      id: sent.message.id,
      result,
    });
  }

  emit(session: LanguageServiceSession, message: unknown): void {
    if (!this.sink) throw new Error("Transport has not started");
    this.sink({
      type: "message",
      ...session,
      sequence: 1,
      message,
    });
  }
}

async function requestAt(
  transport: CoordinatorTransport,
  method: string,
  index = 0,
): Promise<Sent> {
  let request: Sent | undefined;
  await vi.waitFor(() => {
    request = transport.requests(method)[index];
    expect(request).toBeDefined();
  });
  if (!request) throw new Error(`Missing ${method}`);
  return request;
}

async function readyClient(transport: CoordinatorTransport) {
  const client = new LanguageServiceClient({
    transport,
    kind: "texlab",
    projectId: "project-a",
    requestTimeoutMs: 1_000,
  });
  const starting = client.start({
    runtimeProfile: getLanguageServiceRuntimeProfile("texlab"),
  });
  const initialize = await requestAt(transport, "initialize");
  transport.respond(initialize, {
    capabilities: {
      hoverProvider: true,
      workspaceSymbolProvider: true,
      diagnosticProvider: { workspaceDiagnostics: true },
      textDocumentSync: { openClose: true, change: 2 },
    },
  });
  await starting;
  return client;
}

async function openDocument(client: LanguageServiceClient) {
  await client.openDocument({
    uri: "file:///project/main.tex",
    languageId: "latex",
    version: 1,
    text: "\\ref{missing}",
  });
}

describe("ProjectAnalysisCoordinator", () => {
  it("normalizes diagnostics and exposes advertised/unsupported placeholders", async () => {
    const transport = new CoordinatorTransport();
    const client = await readyClient(transport);
    const store = createProjectAnalysisStore();
    const coordinator = new ProjectAnalysisCoordinator(client, store);
    coordinator.activateProject({
      projectId: "project-a",
      projectRevision: 1,
    });
    await openDocument(client);

    expect(store.getState().snapshot.features.hover.status).toBe(
      "not_run",
    );
    expect(store.getState().snapshot.features.completion.status).toBe(
      "unsupported",
    );

    const analysis = coordinator.requestDocumentDiagnostics({
      textDocument: { uri: "file:///project/main.tex" },
    });
    const request = await requestAt(
      transport,
      "textDocument/diagnostic",
    );
    transport.respond(request, {
      kind: "full",
      items: [
        {
          range: {
            start: { line: 0, character: 5 },
            end: { line: 0, character: 12 },
          },
          severity: 2,
          code: "unresolved-reference",
          source: "texlab",
          message: "Reference is unresolved",
        },
      ],
    });

    await expect(analysis).resolves.toMatchObject([
      {
        uri: "file:///project/main.tex",
        severity: "warning",
        source: "texlab",
        code: "unresolved-reference",
        documentVersion: 1,
        projectRevision: 1,
      },
    ]);
    expect(store.getState().snapshot.features.diagnostics.status).toBe(
      "success",
    );

    coordinator.dispose();
  });

  it("rejects an older same-feature result after a newer request starts", async () => {
    const transport = new CoordinatorTransport();
    const client = await readyClient(transport);
    const store = createProjectAnalysisStore();
    const coordinator = new ProjectAnalysisCoordinator(client, store);
    coordinator.activateProject({
      projectId: "project-a",
      projectRevision: 1,
    });
    await openDocument(client);

    const params = {
      textDocument: { uri: "file:///project/main.tex" },
      position: { line: 0, character: 1 },
    };
    const first = coordinator.requestHover(params);
    const second = coordinator.requestHover({
      ...params,
      position: { line: 0, character: 2 },
    });
    const firstExpectation = expect(first).rejects.toBeInstanceOf(
      StaleLanguageServiceResultError,
    );
    const firstRequest = await requestAt(
      transport,
      "textDocument/hover",
      0,
    );
    const secondRequest = await requestAt(
      transport,
      "textDocument/hover",
      1,
    );
    transport.respond(firstRequest, { contents: "old" });
    transport.respond(secondRequest, { contents: "new" });

    await firstExpectation;
    await expect(second).resolves.toEqual({ contents: "new" });
    expect(store.getState().snapshot.features.hover).toMatchObject({
      status: "success",
      data: { contents: "new" },
    });
    coordinator.dispose();
  });

  it("rejects project-scoped responses after the project revision advances", async () => {
    const transport = new CoordinatorTransport();
    const client = await readyClient(transport);
    const store = createProjectAnalysisStore();
    const coordinator = new ProjectAnalysisCoordinator(client, store);
    coordinator.activateProject({
      projectId: "project-a",
      projectRevision: 1,
    });

    const pending = coordinator.requestWorkspaceSymbols({ query: "" });
    const expectation = expect(pending).rejects.toBeInstanceOf(
      StaleLanguageServiceResultError,
    );
    coordinator.updateProjectRevision(2);
    await expectation;
    expect(
      store.getState().snapshot.features.workspaceSymbols.status,
    ).toBe("not_run");
    coordinator.dispose();
  });

  it("does not let a stale unsupported rejection overwrite a newer project revision", async () => {
    const transport = new CoordinatorTransport();
    const client = await readyClient(transport);
    const store = createProjectAnalysisStore();
    const coordinator = new ProjectAnalysisCoordinator(client, store);
    coordinator.activateProject({
      projectId: "project-a",
      projectRevision: 1,
    });
    await openDocument(client);

    const pending = coordinator.requestCompletion({
      textDocument: { uri: "file:///project/main.tex" },
      position: { line: 0, character: 1 },
    });
    const expectation = expect(pending).rejects.toMatchObject({
      name: "UnsupportedLanguageServiceCapabilityError",
    });
    coordinator.updateProjectRevision(2);

    await expectation;
    expect(
      store.getState().snapshot.features.completion,
    ).toMatchObject({
      status: "not_run",
      reason: "Project content changed. Analysis has not run.",
    });
    coordinator.dispose();
  });

  it("commits only current-version push diagnostics", async () => {
    const transport = new CoordinatorTransport();
    const client = await readyClient(transport);
    const store = createProjectAnalysisStore();
    const coordinator = new ProjectAnalysisCoordinator(client, store);
    coordinator.activateProject({
      projectId: "project-a",
      projectRevision: 3,
    });
    coordinator.trackDocument("file:///project/main.tex", 1);
    await openDocument(client);
    const session = client.session;
    if (!session) throw new Error("Expected active client");

    transport.emit(session, {
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri: "file:///project/main.tex",
        version: 0,
        diagnostics: [],
      },
    });
    expect(store.getState().snapshot.features.diagnostics.status).toBe(
      "partial",
    );

    transport.emit(session, {
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri: "file:///project/main.tex",
        version: 1,
        diagnostics: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 4 },
            },
            severity: 1,
            message: "Current diagnostic",
          },
        ],
      },
    });
    expect(store.getState().snapshot.features.diagnostics).toMatchObject(
      {
        status: "success",
        data: [
          {
            message: "Current diagnostic",
            documentVersion: 1,
            projectRevision: 3,
          },
        ],
      },
    );
    coordinator.dispose();
  });
});
