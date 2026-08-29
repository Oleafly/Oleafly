import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./agent-events";
import { classifyTool, TurnFold } from "./thread-items";

function fold(events: AgentEvent[], stoppedAtCap = false) {
  let fold = new TurnFold("turn-1", "client-1");
  for (const event of events) {
    fold = fold.apply(event);
  }
  return fold.finish(stoppedAtCap);
}

describe("classifyTool", () => {
  it("maps shell tools to command executions and mutations to file changes", () => {
    expect(classifyTool("run_command").type).toBe("commandExecution");
    expect(classifyTool("write_file").type).toBe("fileChange");
    expect(classifyTool("read_file").type).toBe("dynamicToolCall");
  });
});

describe("TurnFold", () => {
  it("accumulates text and reasoning deltas into tail items", () => {
    const record = fold([
      { kind: "reasoningDelta", text: "thinking" },
      { kind: "textDelta", text: "Work" },
      { kind: "textDelta", text: "ing" },
    ]);
    expect(record.items).toHaveLength(2);
    expect(record.items[0].item).toMatchObject({ type: "reasoning", content: ["thinking"] });
    expect(record.items[1].item).toMatchObject({ type: "agentMessage", text: "Working" });
    expect(record.items[1].completed).toBe(true);
    expect(record.status).toBe("completed");
    expect(record.clientTurnId).toBe("client-1");
  });

  it("opens tool calls by id and completes them on their outcome, in order", () => {
    const record = fold([
      { kind: "toolCallStart", id: "call-1", name: "read_file" },
      {
        kind: "toolCallEnd",
        id: "call-1",
        arguments: '{"path":"main.tex"}',
      },
      { kind: "toolRequest", id: "call-2", name: "run_command", arguments: '{"command":"ls","cwd":"/tmp"}' },
      { kind: "toolOutcome", id: "call-2", output: '{"error":"denied"}' },
      { kind: "toolOutcome", id: "call-1", output: "contents" },
    ]);
    const [read, exec] = record.items;
    expect(read.item).toMatchObject({
      type: "dynamicToolCall",
      tool: "read_file",
      status: "completed",
      output: "contents",
    });
    expect(read.item.type === "dynamicToolCall" && read.item.arguments).toEqual({
      path: "main.tex",
    });
    expect(exec.item).toMatchObject({
      type: "commandExecution",
      command: ["ls"],
      status: "failed",
      exitCode: null,
    });
  });

  it.each([
    ['{"error":"aborted"}', "failed", null],
    ['{"exit_code":1}', "failed", 1],
    ['{"exit_code":0}', "completed", 0],
    ["plain text mentioning error", "completed", null],
    ['prose containing "error": as a substring', "completed", null],
  ] as const)(
    "classifies command outcome %s as %s with exit code %s",
    (output, status, exitCode) => {
      const record = fold([
        {
          kind: "toolRequest",
          id: "call-1",
          name: "run_command",
          arguments: '{"command":"test"}',
        },
        { kind: "toolOutcome", id: "call-1", output },
      ]);
      expect(record.items[0].item).toMatchObject({
        type: "commandExecution",
        status,
        exitCode,
      });
    },
  );

  it("records retries as reconnecting pills and terminal errors as failures", () => {
    const record = fold([
      { kind: "retry", attempt: 1, max: 4 },
      { kind: "error", message: "connection reset", retryable: false },
    ]);
    expect(record.status).toBe("failed");
    expect(record.error).toBe("connection reset");
    expect(record.items[0].item).toMatchObject({
      type: "error",
      willRetry: true,
      message: "Reconnecting 1/4",
    });
    expect(record.items[1].item).toMatchObject({ type: "error", willRetry: false });
  });

  it("folds subagent activity and compaction into items", () => {
    const record = fold([
      {
        kind: "subagentUpdate",
        id: "sub-1",
        label: "research",
        state: "done",
        detail: "3 papers",
      },
      { kind: "compacted", droppedMessages: 12, reason: "context_limit" },
    ]);
    expect(record.items[0].item).toMatchObject({
      type: "subAgentActivity",
      kind: "done",
      detail: "3 papers",
    });
    expect(record.items[0].completed).toBe(true);
    expect(record.items[1].item).toMatchObject({
      type: "contextCompaction",
      droppedMessages: 12,
    });
  });

  it("marks interrupted turns and seals open items", () => {
    const foldState = new TurnFold("turn-2").apply({ kind: "textDelta", text: "partial" });
    const record = foldState.markInterrupted();
    expect(record.status).toBe("interrupted");
    expect(record.items[0].completed).toBe(true);
  });

  it("keeps usage on the record", () => {
    const record = fold([{ kind: "usage", usage: { input: 10, output: 5 } }], true);
    expect(record.usage).toEqual({ input: 10, output: 5 });
    expect(record.stoppedAtCap).toBe(true);
  });
});
