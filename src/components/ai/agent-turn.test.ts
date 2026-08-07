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
import { runAgentHarness, toAgentMessages, toolSchemasFor } from "./agent-turn";

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

function harness(events: AgentEvent[], tools: ToolSet = {}) {
  const posted: { callId: string; output: unknown }[] = [];
  mocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    if (command === "agent_tool_result") {
      posted.push({ callId: args.callId as string, output: args.output });
      return;
    }
    if (command !== "agent_run") return;
    const channel = args.onEvent as { onmessage: ((event: AgentEvent) => void) | null };
    for (const event of events) channel.onmessage?.(event);
    // Let the tool promises settle before the run resolves.
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
});
