import type {
  JsonRpcMessage,
  JsonValue,
  LanguageServiceEventSink,
  LanguageServiceRuntimeSession,
  LanguageServiceSession,
  LanguageServiceStartOptions,
  LanguageServiceTransport,
  LanguageServiceTransportStatus,
} from "@/lib/language-service";

export const TINYMIST_TEST_CAPABILITIES = {
  positionEncoding: "utf-16",
  colorProvider: true,
  completionProvider: {
    triggerCharacters: ["#", "(", "<", ",", ".", ":", "/", "\"", "@"],
  },
  definitionProvider: true,
  referencesProvider: true,
  hoverProvider: true,
  documentSymbolProvider: true,
  workspaceSymbolProvider: true,
  documentFormattingProvider: true,
  documentLinkProvider: {},
  documentRangeFormattingProvider: true,
  executeCommandProvider: {
    commands: ["tinymist.pinMain", "tinymist.focusMain"],
  },
  inlayHintProvider: true,
  renameProvider: { prepareProvider: true },
  signatureHelpProvider: { triggerCharacters: ["(", ",", ":"] },
  semanticTokensProvider: {
    full: { delta: true },
    legend: {
      tokenTypes: [
        "comment", "string", "keyword", "operator", "number", "function",
        "decorator", "type", "namespace", "bool", "punct", "escape", "link",
        "raw", "label", "ref", "heading", "marker", "term", "delim", "pol",
        "error", "text",
      ],
      tokenModifiers: [
        "strong", "emph", "math", "readonly", "static", "defaultLibrary",
      ],
    },
  },
  textDocumentSync: { change: 2, openClose: true, save: true },
} as const;

export interface FakeServerMessage {
  method: string;
  params: unknown;
  id?: number | string;
}

type Handler = (params: unknown) => JsonValue;

export class FakeTinymistTransport implements LanguageServiceTransport {
  readonly messages: FakeServerMessage[] = [];
  readonly handlers = new Map<string, Handler>();
  capabilities: Record<string, unknown> = { ...TINYMIST_TEST_CAPABILITIES };
  workspaceRoot = "/project";
  private sinks = new Map<string, LanguageServiceEventSink>();
  private generation = 0;
  private current: LanguageServiceRuntimeSession | null = null;

  status(): LanguageServiceTransportStatus {
    return this.current
      ? { state: "running", session: this.current }
      : { state: "stopped", session: null };
  }

  async start(
    options: LanguageServiceStartOptions,
    sink: LanguageServiceEventSink,
  ): Promise<LanguageServiceRuntimeSession> {
    this.generation += 1;
    const session: LanguageServiceRuntimeSession = {
      session: `fake-${this.generation}`,
      kind: options.kind,
      generation: this.generation,
      projectId: options.projectId,
      workspaceRoot: this.workspaceRoot,
    };
    this.sinks.set(session.session, sink);
    this.current = session;
    return session;
  }

  async send(
    session: LanguageServiceSession,
    message: JsonRpcMessage,
  ): Promise<void> {
    if (!("method" in message)) return;
    const id = "id" in message ? (message.id as number | string) : undefined;
    this.messages.push({
      method: message.method,
      params: "params" in message ? message.params : undefined,
      ...(id === undefined ? {} : { id }),
    });
    if (id === undefined) return;
    const result = this.resultFor(message.method, "params" in message ? message.params : undefined);
    queueMicrotask(() => {
      this.sinks.get(session.session)?.({
        type: "message",
        ...session,
        sequence: 1,
        message: { jsonrpc: "2.0", id, result },
      });
    });
  }

  async refreshStatus(): Promise<LanguageServiceTransportStatus> {
    return this.status();
  }

  async stop(session: LanguageServiceSession): Promise<void> {
    this.sinks.delete(session.session);
    if (this.current?.session === session.session) this.current = null;
  }

  async cleanup(): Promise<void> {}

  methods(method: string): FakeServerMessage[] {
    return this.messages.filter((message) => message.method === method);
  }

  private resultFor(method: string, params: unknown): JsonValue {
    const handler = this.handlers.get(method);
    if (handler) return handler(params);
    if (method === "initialize") {
      return {
        capabilities: this.capabilities,
        serverInfo: { name: "tinymist", version: "0.15.8" },
      } as unknown as JsonValue;
    }
    if (method === "textDocument/documentSymbol") return [];
    if (method === "workspace/symbol") return [];
    return null;
  }
}
