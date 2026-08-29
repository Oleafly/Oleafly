import { describe, expect, it } from "vitest";
import {
  applyAgentEvent,
  chatMessagesToTurns,
  newTurn,
  type AgentItem,
} from "./items";

function itemTypes(items: AgentItem[]): string[] {
  return items.map((item) => item.type);
}

describe("applyAgentEvent", () => {
  it("folds streaming deltas into single message and reasoning items", () => {
    let turn = newTurn("t1");
    turn = applyAgentEvent(turn, { kind: "reasoningDelta", text: "thinking " });
    turn = applyAgentEvent(turn, { kind: "reasoningDelta", text: "hard" });
    turn = applyAgentEvent(turn, { kind: "textDelta", text: "Hello " });
    turn = applyAgentEvent(turn, { kind: "textDelta", text: "world" });

    expect(itemTypes(turn.items)).toEqual(["reasoning", "assistant-message"]);
    expect(turn.items[0]).toMatchObject({ text: "thinking hard" });
    expect(turn.items[1]).toMatchObject({ text: "Hello world" });
  });

  it("keeps tool calls, results, and surrounding text in arrival order", () => {
    let turn = newTurn("t1");
    turn = applyAgentEvent(turn, { kind: "textDelta", text: "Let me check." });
    turn = applyAgentEvent(turn, {
      kind: "toolCallStart",
      id: "c1",
      name: "read_file",
    });
    turn = applyAgentEvent(turn, {
      kind: "toolCallEnd",
      id: "c1",
      arguments: '{"path":"main.tex"}',
    });
    turn = applyAgentEvent(turn, {
      kind: "toolOutcome",
      id: "c1",
      output: '{"content":"..."}',
    });
    turn = applyAgentEvent(turn, { kind: "textDelta", text: "Found it." });

    expect(itemTypes(turn.items)).toEqual([
      "assistant-message",
      "tool-call",
      "tool-result",
      "assistant-message",
    ]);
    expect(turn.items[1]).toMatchObject({
      callId: "c1",
      name: "read_file",
      args: '{"path":"main.tex"}',
    });
    expect(turn.items[2]).toMatchObject({ callId: "c1" });
  });

  it("records stream errors as error items", () => {
    let turn = newTurn("t1");
    turn = applyAgentEvent(turn, {
      kind: "error",
      message: "provider unreachable",
      retryable: false,
    });

    expect(turn.items).toEqual([
      expect.objectContaining({ type: "error", message: "provider unreachable" }),
    ]);
  });

  it("ignores bookkeeping events that carry no renderable content", () => {
    let turn = newTurn("t1");
    turn = applyAgentEvent(turn, { kind: "stepStart", step: 1 });
    turn = applyAgentEvent(turn, { kind: "usage", usage: { input: 1, output: 2 } });
    turn = applyAgentEvent(turn, { kind: "done", stopReason: null });

    expect(turn.items).toEqual([]);
  });
});

describe("chatMessagesToTurns (legacy read-path migration)", () => {
  it("converts a legacy conversation preserving the recorded interleave", () => {
    const turns = chatMessagesToTurns([
      { role: "user", content: "Fix my bibliography" },
      {
        role: "assistant",
        content: "Done.",
        reasoningBlocks: [
          { id: "r1", text: "inspect refs", ms: 1200, beforeTool: 0 },
          { id: "r2", text: "verify fix", ms: 300, beforeTool: 1 },
        ],
        toolCalls: [
          {
            id: "c1",
            name: "read_file",
            status: "done",
            output: '{"success": true}',
            approval: "approved",
          },
        ],
      },
    ]);

    expect(turns).toHaveLength(1);
    expect(itemTypes(turns[0].items)).toEqual([
      "user-message",
      "reasoning",
      "tool-call",
      "approval-decision",
      "tool-result",
      "reasoning",
      "assistant-message",
    ]);
    expect(turns[0].items[3]).toMatchObject({
      callId: "c1",
      decision: "approved",
    });
  });

  it("reads the pre-reasoningBlocks single-block shape", () => {
    const turns = chatMessagesToTurns([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello", reasoning: "quick think", reasoningMs: 40 },
    ]);

    expect(itemTypes(turns[0].items)).toEqual([
      "user-message",
      "reasoning",
      "assistant-message",
    ]);
  });

  it("starts a new turn per user message", () => {
    const turns = chatMessagesToTurns([
      { role: "user", content: "one" },
      { role: "assistant", content: "1" },
      { role: "user", content: "two" },
      { role: "assistant", content: "2" },
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[1].items[0]).toMatchObject({ type: "user-message", text: "two" });
  });
});
