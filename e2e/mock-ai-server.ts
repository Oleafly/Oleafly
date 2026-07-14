import { createServer, type Server } from "node:http";

/**
 * A minimal OpenAI-compatible endpoint so e2e can drive a REAL AI conversation
 * (streaming, tool calls, usage) with no API key and no network. The app's
 * "Ollama (local)" provider builds its model with
 * `createOpenAI({ baseURL: <host>/v1, apiKey: "ollama" }).chat(model)`, so we
 * connect Ollama pointed at this server and every real streaming/usage/tool
 * code path runs against canned responses.
 *
 * The bundled app's CSP allows `connect-src http://127.0.0.1:*`, so the webview
 * can reach this loopback server.
 */
export interface MockAiServer {
  /** Base URL to enter as the Ollama "Host URL" (no trailing /v1). */
  url: string;
  close: () => Promise<void>;
  /** Set the plain-text reply the next completion streams back. */
  setReply: (text: string) => void;
  /**
   * Make the next completion emit a tool call to `name` with `args`, then (on
   * the follow-up request that carries the tool result) stream `then` as text.
   */
  setToolCall: (call: { name: string; args: Record<string, unknown>; then: string } | null) => void;
  /** How many /v1/chat/completions requests have been served. */
  requestCount: () => number;
}

export async function startMockAiServer(): Promise<MockAiServer> {
  let reply = "MOCKREPLY";
  let toolCall: { name: string; args: Record<string, unknown>; then: string } | null = null;
  let requests = 0;

  const server: Server = createServer((req, res) => {
    const url = req.url || "";
    // The webview fetches this cross-origin (app is served from localhost:1420),
    // so browser CORS applies. Real Ollama sends permissive CORS by default;
    // mirror that or every request is blocked before it reaches the handler.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Model listing (native Ollama + OpenAI shapes), in case the UI probes it.
    if (req.method === "GET" && url.startsWith("/api/tags")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: "llama3.2" }] }));
      return;
    }
    if (req.method === "GET" && url.startsWith("/v1/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "llama3.2", object: "model" }] }));
      return;
    }

    if (req.method === "POST" && url.startsWith("/v1/chat/completions")) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        requests++;
        const hasToolResult = /"role"\s*:\s*"tool"/.test(body);
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        const id = "chatcmpl-mock";
        const model = "llama3.2";
        const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
        const chunk = (delta: unknown, finish: string | null = null, usage?: unknown) =>
          send({
            id,
            object: "chat.completion.chunk",
            model,
            choices: [{ index: 0, delta, finish_reason: finish }],
            ...(usage ? { usage } : {}),
          });

        chunk({ role: "assistant" });

        // First turn with a pending tool call and no tool result yet -> emit the
        // tool call. The follow-up request (carrying the tool result) streams
        // the `then` text.
        // OpenAI streams usage as a FINAL chunk with empty choices (the shape
        // the AI SDK's `include_usage` path reads); emit it that way.
        const usage = (u: { p: number; c: number }) =>
          send({
            id,
            object: "chat.completion.chunk",
            model,
            choices: [],
            usage: { prompt_tokens: u.p, completion_tokens: u.c, total_tokens: u.p + u.c },
          });

        if (toolCall && !hasToolResult) {
          chunk({
            tool_calls: [
              {
                index: 0,
                id: "call_mock",
                type: "function",
                function: { name: toolCall.name, arguments: JSON.stringify(toolCall.args) },
              },
            ],
          });
          chunk({}, "tool_calls");
          usage({ p: 11, c: 7 });
        } else {
          const text = toolCall && hasToolResult ? toolCall.then : reply;
          for (const piece of text.match(/[\s\S]{1,4}/g) ?? [text]) {
            chunk({ content: piece });
          }
          chunk({}, "stop");
          usage({ p: 13, c: 9 });
        }
        res.write("data: [DONE]\n\n");
        res.end();
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(() => r())),
    setReply: (t) => {
      reply = t;
    },
    setToolCall: (c) => {
      toolCall = c;
    },
    requestCount: () => requests,
  };
}
