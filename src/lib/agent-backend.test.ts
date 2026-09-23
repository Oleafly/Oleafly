import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEventListeners } from "node:events";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: ((event: unknown) => void) | null = null;
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: mocks.Channel }));

import {
  AgentStreamError,
  CHANNEL_DRAIN_GRACE_MS,
  agentSteer,
  agentThreadArchive,
  agentThreadFork,
  completeText,
  completeViaBackend,
  runViaBackend,
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
    rejectCall("The request was cancelled.");

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.invoke).toHaveBeenCalledWith("agent_cancel", expect.anything());
  });

  it("removes abort listeners after normally settled requests", async () => {
    mocks.invoke.mockResolvedValue(reply("done"));
    const controller = new AbortController();

    for (let index = 0; index < 12; index += 1) {
      await completeText({ user: `request ${index}`, signal: controller.signal });
    }

    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("reports a genuine provider failure as an error, not an abort", async () => {
    mocks.invoke.mockRejectedValue("The provider returned 401. Incorrect API key provided");
    await expect(completeText({ user: "hi" })).rejects.toThrow(/401/);
  });
});

describe("steering", () => {
  it("sends the complete user message and waits for backend delivery", async () => {
    let resolveDelivery!: () => void;
    mocks.invoke.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveDelivery = resolve;
      }),
    );
    const message = {
      role: "user" as const,
      content: [
        { type: "text" as const, text: "Use this image" },
        { type: "image" as const, image: "data:image/png;base64,AA==" },
      ],
    };

    let delivered = false;
    const pending = agentSteer("run-1", message).then(() => {
      delivered = true;
    });
    await Promise.resolve();

    expect(mocks.invoke).toHaveBeenCalledWith("agent_steer", {
      requestId: "run-1",
      message,
    });
    expect(delivered).toBe(false);

    resolveDelivery();
    await pending;
    expect(delivered).toBe(true);
  });
});

describe("thread actions", () => {
  it("archives and forks the requested native thread", async () => {
    mocks.invoke.mockResolvedValueOnce(true).mockResolvedValueOnce("thread-forked");

    await expect(agentThreadArchive("thread-source")).resolves.toBe(true);
    await expect(agentThreadFork("thread-source", "project-1")).resolves.toBe(
      "thread-forked",
    );

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "agent_thread_archive", {
      threadId: "thread-source",
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "agent_thread_fork", {
      threadId: "thread-source",
      excludeTurns: null,
      projectId: "project-1",
    });
  });
});

function playStream(events: AgentEvent[], hold = false) {
  mocks.invoke.mockImplementation((command: string, args: Record<string, unknown>) => {
    if (command !== "agent_stream") return Promise.resolve();
    const channel = args.onEvent as { onmessage: ((event: AgentEvent) => void) | null };
    for (const event of events) channel.onmessage?.(event);
    channel.onmessage?.({ kind: "runEnd" });
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

  it("ignores channel events that arrive after cancellation", async () => {
    const captured: {
      channel?: { onmessage: ((event: AgentEvent) => void) | null };
    } = {};
    mocks.invoke.mockImplementation((command: string, args: Record<string, unknown>) => {
      if (command === "agent_cancel") return Promise.resolve();
      if (command === "agent_stream") {
        captured.channel = args.onEvent as typeof captured.channel;
        return new Promise(() => {});
      }
      return Promise.resolve();
    });
    const controller = new AbortController();
    const seen: AgentEvent[] = [];
    const pending = streamViaBackend(
      { messages: [] },
      (event) => seen.push(event),
      controller.signal,
    );
    await vi.waitFor(() => expect(captured.channel).toBeDefined());

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    captured.channel?.onmessage?.({ kind: "textDelta", text: "late" });

    expect(seen).toEqual([]);
  });
});

type FakeChannel = { onmessage: ((event: AgentEvent) => void) | null };

function resultBeforeEvents(command: string, result: unknown) {
  const captured: { channel?: FakeChannel } = {};
  mocks.invoke.mockImplementation((invoked: string, args: Record<string, unknown>) => {
    if (invoked !== command) return Promise.resolve();
    captured.channel = args.onEvent as FakeChannel;
    return Promise.resolve(result);
  });
  return captured;
}

const settledResult = () => new Promise((resolve) => setTimeout(resolve, 0));

const runOutcome = {
  text: "SKILLLOADED75",
  usage: { input: 3, output: 4 },
  steps: 2,
  stopped_at_cap: false,
  error: null,
};

const noTools = { onToolRequest: async () => ({ output: "" }) };

describe("events that land after the command result", () => {
  it("keeps a text delta that arrives after agent_stream resolved", async () => {
    const captured = resultBeforeEvents("agent_stream", undefined);
    const pending = streamText({ user: "hi" });
    await settledResult();

    captured.channel?.onmessage?.({ kind: "textDelta", text: "late" });
    captured.channel?.onmessage?.({ kind: "runEnd" });

    expect(await pending).toBe("late");
  });

  it("holds the run outcome until the channel closes and still delivers the tail", async () => {
    const captured = resultBeforeEvents("agent_run", runOutcome);
    const seen: AgentEvent[] = [];
    let settled = false;
    const pending = runViaBackend(
      { messages: [] },
      { onEvent: (event) => seen.push(event), ...noTools },
    ).then((outcome) => {
      settled = true;
      return outcome;
    });
    await settledResult();
    expect(settled).toBe(false);

    captured.channel?.onmessage?.({ kind: "stepStart", step: 1 });
    captured.channel?.onmessage?.({ kind: "textDelta", text: "SKILLLOADED75" });
    await settledResult();
    expect(settled).toBe(false);

    captured.channel?.onmessage?.({ kind: "runEnd" });
    expect(await pending).toEqual(runOutcome);
    expect(seen).toEqual([
      { kind: "stepStart", step: 1 },
      { kind: "textDelta", text: "SKILLLOADED75" },
    ]);
  });

  it("does not forward the channel close marker to the consumer", async () => {
    playStream([{ kind: "textDelta", text: "a" }]);
    const seen: AgentEvent[] = [];
    await streamViaBackend({ messages: [] }, (event) => seen.push(event));
    expect(seen).toEqual([{ kind: "textDelta", text: "a" }]);
  });

  it("reports an error event that lands after the result", async () => {
    const captured = resultBeforeEvents("agent_stream", undefined);
    const pending = streamViaBackend({ messages: [] }, () => {});
    await settledResult();

    captured.channel?.onmessage?.({ kind: "error", message: "late failure", retryable: false });
    captured.channel?.onmessage?.({ kind: "runEnd" });

    await expect(pending).rejects.toBeInstanceOf(AgentStreamError);
  });

  it("lets an abort end the wait for the channel", async () => {
    const controller = new AbortController();
    resultBeforeEvents("agent_run", runOutcome);
    const pending = runViaBackend(
      { messages: [] },
      { onEvent: () => {}, ...noTools },
      controller.signal,
    );
    await settledResult();

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.invoke).toHaveBeenCalledWith("agent_cancel", expect.anything());
  });

  it("gives up waiting after the grace period and says so", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const captured = resultBeforeEvents("agent_run", runOutcome);
      let settled = false;
      const pending = runViaBackend({ messages: [] }, { onEvent: () => {}, ...noTools }).then(
        (outcome) => {
          settled = true;
          return outcome;
        },
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(captured.channel).toBeDefined();
      await vi.advanceTimersByTimeAsync(CHANNEL_DRAIN_GRACE_MS - 1);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);

      expect(await pending).toEqual(runOutcome);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("agent_run"));
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
});
