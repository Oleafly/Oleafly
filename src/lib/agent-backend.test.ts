import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: ((event: unknown) => void) | null = null;
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: mocks.Channel }));

import {
  AgentStreamError,
  completeText,
  completeViaBackend,
  streamText,
  streamViaBackend,
  type AgentEvent,
} from "./agent-backend";

function reply(text: string) {
  return { text, usage: { input: 1, output: 2 }, provider_id: "openai", model_id: "gpt-4o" };
}

beforeEach(() => {
  mocks.invoke.mockReset();
});

describe("completion requests", () => {
  it("sends the system prompt and user text the backend expects", async () => {
    mocks.invoke.mockResolvedValue(reply("x^2"));
    const text = await completeText({ system: "sys", user: "hi", temperature: 0.4 });

    expect(text).toBe("x^2");
    const [command, args] = mocks.invoke.mock.calls[0];
    expect(command).toBe("agent_complete");
    expect(args.request).toMatchObject({
      system: "sys",
      temperature: 0.4,
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
  });

  it("gives every call its own id so cancelling one cannot stop another", async () => {
    mocks.invoke.mockResolvedValue(reply(""));
    await completeText({ user: "a" });
    await completeText({ user: "b" });
    const [first, second] = mocks.invoke.mock.calls.map((c) => c[1].requestId);
    expect(first).not.toBe(second);
  });

  it("passes a provider override through without any credential", async () => {
    mocks.invoke.mockResolvedValue(reply(""));
    await completeViaBackend({ messages: [] }, undefined, {
      provider_id: "groq",
      model_id: "llama-3.1-8b-instant",
    });
    const args = mocks.invoke.mock.calls[0][1];
    expect(args.providerOverride).toEqual({
      provider_id: "groq",
      model_id: "llama-3.1-8b-instant",
    });
    expect(JSON.stringify(args)).not.toMatch(/key|secret|token/i);
  });
});

describe("cancellation", () => {
  it("refuses to start when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(completeText({ user: "hi", signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("tells the backend to drop an in-flight request and reports an abort", async () => {
    const controller = new AbortController();
    let rejectCall: (reason: unknown) => void = () => {};
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "agent_cancel") return Promise.resolve();
      return new Promise((_, reject) => {
        rejectCall = reject;
      });
    });

    const pending = completeText({ user: "hi", signal: controller.signal });
    controller.abort();
    // The backend surfaces the dropped request as an ordinary error string.
    rejectCall("The request was cancelled.");

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.invoke).toHaveBeenCalledWith("agent_cancel", expect.anything());
  });

  it("reports a genuine provider failure as an error, not an abort", async () => {
    mocks.invoke.mockRejectedValue("The provider returned 401. Incorrect API key provided");
    await expect(completeText({ user: "hi" })).rejects.toThrow(/401/);
  });
});

function playStream(events: AgentEvent[], hold = false) {
  mocks.invoke.mockImplementation((command: string, args: Record<string, unknown>) => {
    if (command !== "agent_stream") return Promise.resolve();
    const channel = args.onEvent as { onmessage: ((event: AgentEvent) => void) | null };
    for (const event of events) channel.onmessage?.(event);
    return hold ? new Promise(() => {}) : Promise.resolve();
  });
}

describe("streaming", () => {
  it("joins text deltas and reports progress as they arrive", async () => {
    playStream([
      { kind: "textDelta", text: "Hel" },
      { kind: "textDelta", text: "lo" },
      { kind: "done", stopReason: "stop" },
    ]);
    const progress: string[] = [];
    const text = await streamText({ user: "hi", onToken: (full) => progress.push(full) });

    expect(text).toBe("Hello");
    expect(progress).toEqual(["Hel", "Hello"]);
  });

  it("keeps reasoning out of the answer", async () => {
    playStream([
      { kind: "reasoningDelta", text: "thinking hard" },
      { kind: "textDelta", text: "answer" },
      { kind: "done", stopReason: null },
    ]);
    expect(await streamText({ user: "hi" })).toBe("answer");
  });

  it("surfaces a stream error with its retryable flag", async () => {
    playStream([
      { kind: "textDelta", text: "partial" },
      { kind: "error", message: "provider overloaded", retryable: true },
    ]);
    const error = await streamText({ user: "hi" }).catch((e) => e);
    expect(error).toBeInstanceOf(AgentStreamError);
    expect(error.retryable).toBe(true);
    expect(error.message).toBe("provider overloaded");
  });

  it("does not let an error event reach the consumer as content", async () => {
    playStream([{ kind: "error", message: "boom", retryable: false }]);
    const seen: AgentEvent[] = [];
    await streamViaBackend({ messages: [] }, (event) => seen.push(event)).catch(() => {});
    expect(seen).toEqual([]);
  });

  it("forwards tool call events untouched for the agent loop", async () => {
    const events: AgentEvent[] = [
      { kind: "toolCallStart", id: "c1", name: "read_file" },
      { kind: "toolCallArgsDelta", id: "c1", json: '{"path"' },
      { kind: "toolCallEnd", id: "c1", arguments: '{"path":"main.tex"}' },
      { kind: "usage", usage: { input: 10, output: 4 } },
      { kind: "done", stopReason: "tool_calls" },
    ];
    playStream(events);
    const seen: AgentEvent[] = [];
    await streamViaBackend({ messages: [] }, (event) => seen.push(event));
    expect(seen).toEqual(events);
  });

  it("cancels the backend stream and reports an abort", async () => {
    playStream([{ kind: "textDelta", text: "partial" }], true);
    const controller = new AbortController();
    const pending = streamText({ user: "hi", signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.invoke).toHaveBeenCalledWith("agent_cancel", expect.anything());
  });
});
