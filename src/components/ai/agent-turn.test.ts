import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelMessage, ToolSet } from "@/lib/chat-types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: ((event: unknown) => void) | null = null;
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: mocks.Channel }));

import type { AgentEvent } from "@/lib/agent-backend";
import {
  packToolOutputText,
  runAgentHarness,
  toAgentMessages,
  toolSchemasFor,
} from "./agent-turn";

beforeEach(() => {
  mocks.invoke.mockReset();
});

describe("message conversion", () => {
  it("carries a plain string turn through as one text part", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "hello" }];
    expect(toAgentMessages(messages)).toEqual([
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ]);
  });

  it("converts an assistant tool call into a toolUse part with serialized arguments", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "reading" },
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "read_file",
            input: { path: "main.tex" },
          },
        ],
      },
    ] as unknown as ModelMessage[];

    expect(toAgentMessages(messages)[0].content).toEqual([
      { type: "text", text: "reading" },
      { type: "toolUse", id: "c1", name: "read_file", arguments: '{"path":"main.tex"}' },
    ]);
  });

  it("unwraps a tool result value and sends it as a user turn", () => {
    const messages = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "read_file",
            output: { type: "text", value: "\\documentclass{article}" },
          },
        ],
      },
    ] as unknown as ModelMessage[];

    const converted = toAgentMessages(messages);
    expect(converted[0].role).toBe("user");
    expect(converted[0].content).toEqual([
      { type: "toolResult", id: "c1", name: "read_file", output: "\\documentclass{article}" },
    ]);
  });

  it("drops turns that carry nothing the provider can use", () => {
    const messages = [
      { role: "user", content: "" },
      { role: "assistant", content: [{ type: "reasoning", text: "private" }] },
    ] as unknown as ModelMessage[];
    expect(toAgentMessages(messages)).toEqual([]);
  });

  it("keeps image parts so a vision turn survives the round trip", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image", image: "data:image/png;base64,AA" },
        ],
      },
    ] as unknown as ModelMessage[];
    expect(toAgentMessages(messages)[0].content).toHaveLength(2);
  });
});

describe("tool schemas", () => {
  it("unwraps the raw json schema the AI SDK helper wraps", () => {
    const tools = {
      read_file: {
        description: "Read a file",
        inputSchema: { jsonSchema: { type: "object", properties: { path: {} } } },
      },
    } as unknown as ToolSet;

    expect(toolSchemasFor(tools)).toEqual([
      {
        name: "read_file",
        description: "Read a file",
        input_schema: { type: "object", properties: { path: {} } },
      },
    ]);
  });

  it("falls back to an object schema when a tool declares none", () => {
    const tools = { bare: {} } as unknown as ToolSet;
    expect(toolSchemasFor(tools)[0].input_schema).toEqual({ type: "object", properties: {} });
  });
});

function harness(
  events: AgentEvent[],
  tools: ToolSet = {},
  extra: Partial<Parameters<typeof runAgentHarness>[0]> = {},
) {
  const posted: { callId: string; output: unknown }[] = [];
  mocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    if (command === "agent_tool_result") {
      posted.push({ callId: args.callId as string, output: args.output });
      return;
    }
    if (command !== "agent_run") return;
    const channel = args.onEvent as { onmessage: ((event: AgentEvent) => void) | null };
    for (const event of events) channel.onmessage?.(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { text: "", usage: { input: 0, output: 0 }, steps: 1, stopped_at_cap: false, error: null };
  });

  const calls: string[] = [];
  const handlers = {
    onActivity: vi.fn(),
    onThinking: vi.fn(),
    onText: vi.fn(),
    onReasoningStart: vi.fn(),
    onReasoningDelta: vi.fn(),
    onReasoningEnd: vi.fn(),
    onToolCall: vi.fn((c: { name: string }) => calls.push(c.name)),
    onToolResult: vi.fn(),
    onUsage: vi.fn(),
    onStep: vi.fn(),
    onRetry: vi.fn(),
  };

  return {
    posted,
    handlers,
    run: () =>
      runAgentHarness({
        system: "sys",
        messages: [{ role: "user", content: "hi" }],
        tools,
        signal: new AbortController().signal,
        handlers,
        ...extra,
      }),
  };
}

describe("harness", () => {
  it("reports text as deltas rather than a growing snapshot", async () => {
    const h = harness([
      { kind: "textDelta", text: "Hel" },
      { kind: "textDelta", text: "lo" },
      { kind: "done", stopReason: "stop" },
    ]);
    await h.run();
    expect(h.handlers.onText.mock.calls.map((c) => c[0])).toEqual(["Hel", "lo"]);
  });

  it("opens a reasoning block once and closes it when text starts", async () => {
    const h = harness([
      { kind: "reasoningDelta", text: "a" },
      { kind: "reasoningDelta", text: "b" },
      { kind: "textDelta", text: "answer" },
      { kind: "done", stopReason: null },
    ]);
    await h.run();
    expect(h.handlers.onReasoningStart).toHaveBeenCalledTimes(1);
    expect(h.handlers.onReasoningDelta).toHaveBeenCalledTimes(2);
    expect(h.handlers.onReasoningEnd).toHaveBeenCalledTimes(1);
  });

  it("executes a requested tool and posts its output back to the harness", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const h = harness(
      [{ kind: "toolRequest", id: "c1", name: "read_file", arguments: '{"path":"main.tex"}' }],
      { read_file: { execute } } as unknown as ToolSet,
    );
    await h.run();

    expect(execute).toHaveBeenCalledWith({ path: "main.tex" });
    expect(h.posted).toEqual([
      { callId: "c1", output: { output: '{"ok":true}', images: [] } },
    ]);
    expect(h.handlers.onToolCall).toHaveBeenCalledWith({
      id: "c1",
      name: "read_file",
      args: { path: "main.tex" },
    });
  });

  it("turns a throwing tool into an error result instead of failing the run", async () => {
    const h = harness(
      [{ kind: "toolRequest", id: "c1", name: "write_file", arguments: "{}" }],
      {
        write_file: {
          execute: async () => {
            throw new Error("disk full");
          },
        },
      } as unknown as ToolSet,
    );
    await h.run();
    expect(h.posted[0].output).toEqual({ output: '{"error":"disk full"}', images: [] });
  });

  it("refuses to execute a tool when the run guard reports a context change", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const h = harness(
      [{ kind: "toolRequest", id: "c1", name: "write_file", arguments: '{"path":"a.tex"}' }],
      { write_file: { execute } } as unknown as ToolSet,
      {
        guardToolCall: () =>
          "The project changed while this run was active. The tool was not executed.",
      },
    );
    await h.run();

    expect(execute).not.toHaveBeenCalled();
    expect(String((h.posted[0].output as { output: string }).output)).toContain(
      "project changed",
    );
    expect(h.handlers.onToolResult).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "c1",
        output: expect.objectContaining({ error: expect.stringContaining("project changed") }),
      }),
    );
  });

  it("executes normally when the run guard passes", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const h = harness(
      [{ kind: "toolRequest", id: "c1", name: "read_file", arguments: "{}" }],
      { read_file: { execute } } as unknown as ToolSet,
      { guardToolCall: () => null },
    );
    await h.run();

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("renders a natively executed tool from loop events without executing locally", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const h = harness(
      [
        { kind: "toolCallStart", id: "n1", name: "read_file" },
        { kind: "toolCallEnd", id: "n1", arguments: '{"path":"main.tex"}' },
        { kind: "toolOutcome", id: "n1", output: '{"content":"hello"}' },
      ],
      { read_file: { execute } } as unknown as ToolSet,
    );
    await h.run();

    expect(execute).not.toHaveBeenCalled();
    expect(h.posted).toEqual([]);
    expect(h.handlers.onToolCall).toHaveBeenCalledWith({
      id: "n1",
      name: "read_file",
      args: { path: "main.tex" },
    });
    expect(h.handlers.onToolResult).toHaveBeenCalledWith({
      id: "n1",
      name: "read_file",
      output: { content: "hello" },
    });
  });

  it("does not double-render a tool the webview executed itself", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    // The webview request id is namespaced (tool-{gen}-{seq}-{providerId});
    // the loop's outcome event carries the bare provider id.
    const h = harness(
      [
        { kind: "toolRequest", id: "tool-1-0-c1", name: "write_file", arguments: "{}" },
        { kind: "toolCallStart", id: "c1", name: "write_file" },
        { kind: "toolOutcome", id: "c1", output: '{"ok":true}' },
      ],
      { write_file: { execute } } as unknown as ToolSet,
    );
    await h.run();

    expect(h.handlers.onToolCall).toHaveBeenCalledTimes(1);
    expect(h.handlers.onToolResult).toHaveBeenCalledTimes(1);
  });

  it("reports an unknown tool rather than hanging the harness", async () => {
    const h = harness([{ kind: "toolRequest", id: "c1", name: "nope", arguments: "{}" }]);
    await h.run();
    expect(String((h.posted[0].output as { output: string }).output)).toContain("Unknown tool");
  });

  it("survives tool arguments the provider truncated", async () => {
    const execute = vi.fn(async () => "ok");
    const h = harness([{ kind: "toolRequest", id: "c1", name: "t", arguments: '{"pa' }], {
      t: { execute },
    } as unknown as ToolSet);
    await h.run();
    expect(execute).toHaveBeenCalledWith({});
  });

  it("passes queued vision images along with the tool output", async () => {
    const posted: unknown[] = [];
    mocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === "agent_tool_result") {
        posted.push(args.output);
        return;
      }
      const channel = args.onEvent as { onmessage: ((event: AgentEvent) => void) | null };
      channel.onmessage?.({ kind: "toolRequest", id: "c1", name: "verify", arguments: "{}" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { text: "", usage: { input: 0, output: 0 }, steps: 1, stopped_at_cap: false, error: null };
    });

    await runAgentHarness({
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      tools: { verify: { execute: async () => "checked" } } as unknown as ToolSet,
      signal: new AbortController().signal,
      takePendingImages: () => ["data:image/png;base64,AA"],
      handlers: {
        onActivity: vi.fn(),
        onThinking: vi.fn(),
        onText: vi.fn(),
        onReasoningStart: vi.fn(),
        onReasoningDelta: vi.fn(),
        onReasoningEnd: vi.fn(),
        onToolCall: vi.fn(),
        onToolResult: vi.fn(),
        onUsage: vi.fn(),
        onStep: vi.fn(),
        onRetry: vi.fn(),
      },
    });

    expect(posted).toEqual([{ output: "checked", images: ["data:image/png;base64,AA"] }]);
  });

  it("forwards step and retry progress for the thinking label", async () => {
    const h = harness([
      { kind: "stepStart", step: 0 },
      { kind: "retry", attempt: 1, max: 2 },
      { kind: "stepStart", step: 1 },
      { kind: "done", stopReason: null },
    ]);
    await h.run();
    expect(h.handlers.onStep.mock.calls.map((c) => c[0])).toEqual([0, 1]);
    expect(h.handlers.onRetry).toHaveBeenCalledWith(1, 2);
    expect(h.handlers.onThinking).toHaveBeenCalledWith("Thinking…");
    expect(h.handlers.onThinking).toHaveBeenCalledWith("Continuing…");
  });

  it("sends the system prompt and tool schemas to the backend", async () => {
    const h = harness([{ kind: "done", stopReason: null }], {
      read_file: { description: "d", inputSchema: { jsonSchema: { type: "object" } } },
    } as unknown as ToolSet);
    await h.run();
    const request = mocks.invoke.mock.calls.find((c) => c[0] === "agent_run")?.[1].request;
    expect(request.system).toBe("sys");
    expect(request.tools).toEqual([
      { name: "read_file", description: "d", input_schema: { type: "object" } },
    ]);
  });

  it("suppresses a tool result that finishes after the run is cancelled", async () => {
    const captured: {
      channel?: { onmessage: ((event: AgentEvent) => void) | null };
      finishTool?: (value: unknown) => void;
    } = {};
    mocks.invoke.mockImplementation((command: string, args: Record<string, unknown>) => {
      if (command === "agent_run") {
        captured.channel = args.onEvent as typeof captured.channel;
        return new Promise(() => {});
      }
      return Promise.resolve();
    });
    const execute = vi.fn(
      () => new Promise((resolve) => {
        captured.finishTool = resolve;
      }),
    );
    const takePendingImages = vi.fn(() => ["data:image/png;base64,AA"]);
    const handlers = {
      onActivity: vi.fn(),
      onThinking: vi.fn(),
      onText: vi.fn(),
      onReasoningStart: vi.fn(),
      onReasoningDelta: vi.fn(),
      onReasoningEnd: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onUsage: vi.fn(),
      onStep: vi.fn(),
      onRetry: vi.fn(),
    };
    const controller = new AbortController();
    const pending = runAgentHarness({
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      tools: { slow_write: { execute } } as unknown as ToolSet,
      signal: controller.signal,
      takePendingImages,
      handlers,
    });
    await vi.waitFor(() => expect(captured.channel).toBeDefined());
    captured.channel?.onmessage?.({
      kind: "toolRequest",
      id: "late-tool",
      name: "slow_write",
      arguments: "{}",
    });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    captured.finishTool?.({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handlers.onToolResult).not.toHaveBeenCalled();
    expect(handlers.onThinking).not.toHaveBeenCalledWith("Processing result…");
    expect(takePendingImages).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith("agent_tool_result", expect.anything());
  });
});

describe("file attachments", () => {
  const dataUrl = (text: string) =>
    `data:text/plain;base64,${Buffer.from(text, "utf8").toString("base64")}`;

  it("inlines a text attachment as a labeled text part", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "summarize this" },
          { type: "file", data: dataUrl("@article{k, title={T}}"), mediaType: "text/plain", name: "refs.bib" },
        ],
      },
    ];
    const out = toAgentMessages(messages);
    expect(out).toHaveLength(1);
    expect(out[0].content).toHaveLength(2);
    const attached = out[0].content[1];
    expect(attached.type).toBe("text");
    expect((attached as { text: string }).text).toContain('Attached file "refs.bib"');
    expect((attached as { text: string }).text).toContain("@article{k, title={T}}");
  });

  it("recognizes tex-like extensions even with a generic media type", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "file",
            data: dataUrl("\\section{Intro}"),
            mediaType: "application/octet-stream",
            name: "main.tex",
          },
        ],
      },
    ];
    const out = toAgentMessages(messages);
    expect((out[0].content[0] as { text: string }).text).toContain("\\section{Intro}");
  });

  it("keeps an attachment-only message instead of dropping it", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "file", data: dataUrl("hello"), mediaType: "text/plain", name: "note.txt" },
        ],
      },
    ];
    expect(toAgentMessages(messages)).toHaveLength(1);
  });

  it("names an unsupported binary attachment instead of silently omitting it", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "file", data: "data:application/pdf;base64,AAAA", mediaType: "application/pdf", name: "paper.pdf" },
        ],
      },
    ];
    const out = toAgentMessages(messages);
    const text = (out[0].content[0] as { text: string }).text;
    expect(text).toContain('"paper.pdf"');
    expect(text).toContain("could not be included");
  });

  it("caps an oversized text attachment", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "file", data: dataUrl("x".repeat(60_000)), mediaType: "text/plain", name: "big.txt" },
        ],
      },
    ];
    const text = (toAgentMessages(messages)[0].content[0] as { text: string }).text;
    expect(text.length).toBeLessThan(50_000);
    expect(text).toContain("truncated");
  });
});

describe("tool output packing", () => {
  it("truncates an oversized string field the way the removed TS loop did", () => {
    const packed = packToolOutputText({ content: "y".repeat(40_000), path: "main.tex" });
    expect(packed.length).toBeLessThan(20_000);
    expect(packed).toContain("truncated");
    expect(packed).toContain("main.tex");
  });

  it("leaves a small output untouched", () => {
    expect(packToolOutputText({ ok: true })).toBe('{"ok":true}');
    expect(packToolOutputText("done")).toBe("done");
  });
});
