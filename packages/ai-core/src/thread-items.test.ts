import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./agent-events";
import { classifyTool, newTurnRecord, TurnFold } from "./thread-items";

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
  it("seals every open item when a sample is done", () => {
    const fold = new TurnFold("turn-done");
    fold.apply({ kind: "reasoningDelta", text: "thinking" });
    fold.apply({ kind: "retry", attempt: 1, max: 2 });
    fold.apply({ kind: "textDelta", text: "answer" });

    fold.apply({ kind: "done", stopReason: null });

    expect(fold.snapshot().items.every((item) => item.completed)).toBe(true);
  });

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
      {
        kind: "toolOutcome",
        id: "call-2",
        output: '{"message":"denied","declined":true,"status":"declined"}',
      },
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
      status: "declined",
      exitCode: null,
    });
  });

  it.each([
    ['{"error":"aborted"}', "failed", null],
    ['{"message":"denied","declined":true,"status":"declined"}', "declined", null],
    ['{"exec":true,"exit_code":127}', "failed", 127],
    ['{"exec":true,"exit_code":0}', "completed", 0],
    [
      '{"exec":true,"exit_code":null,"timed_out":true,"status":"Stopped: timed out"}',
      "failed",
      null,
    ],
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

describe("TurnFold edge cases", () => {
  it("opens the record with the optimistic user message", () => {
    const record = new TurnFold("turn-u").pushUserMessage("Fix the table").apply({
      kind: "textDelta",
      text: "On it",
    });
    expect(record.snapshot().items.map((entry) => [entry.id, entry.item.type])).toEqual([
      ["turn-u:0", "userMessage"],
      ["turn-u:1", "agentMessage"],
    ]);
    expect(record.snapshot().items[0].item).toEqual({ type: "userMessage", text: "Fix the table" });
  });

  it("extends the open reasoning item and starts a new one after other output", () => {
    const record = fold([
      { kind: "reasoningDelta", text: "think" },
      { kind: "reasoningDelta", text: "ing" },
      { kind: "textDelta", text: "answer" },
      { kind: "reasoningDelta", text: "again" },
    ]);
    expect(record.items.map((entry) => entry.item)).toEqual([
      { type: "reasoning", summary: [], content: ["thinking"] },
      { type: "agentMessage", text: "answer" },
      { type: "reasoning", summary: [], content: ["again"] },
    ]);
  });

  it("starts a new message when text arrives after the sample was sealed", () => {
    const record = fold([
      { kind: "textDelta", text: "one" },
      { kind: "done", stopReason: "tool_use" },
      { kind: "textDelta", text: "two" },
    ]);
    expect(record.items.map((entry) => entry.item)).toEqual([
      { type: "agentMessage", text: "one" },
      { type: "agentMessage", text: "two" },
    ]);
  });

  it("ignores outcomes and argument ends for calls it never opened", () => {
    const record = fold([
      { kind: "toolCallEnd", id: "ghost", arguments: "{}" },
      { kind: "toolOutcome", id: "ghost", output: "{}" },
    ]);
    expect(record.items).toEqual([]);
  });

  it("does not open a second item when a request follows the streamed start", () => {
    const record = fold([
      { kind: "toolCallStart", id: "c1", name: "write_file" },
      { kind: "toolCallEnd", id: "c1", arguments: '{"path":"a.tex","content":"x"}' },
      { kind: "toolRequest", id: "c1", name: "write_file", arguments: '{"path":"b.tex"}' },
      { kind: "toolOutcome", id: "c1", output: '{"success":true}' },
    ]);
    expect(record.items).toHaveLength(1);
    expect(record.items[0].item).toEqual({
      type: "fileChange",
      changes: { path: "a.tex", content: "x" },
      status: "completed",
    });
  });

  it("marks a failed file change from its outcome", () => {
    const record = fold([
      { kind: "toolRequest", id: "c1", name: "delete_file", arguments: '{"path":"old.tex"}' },
      { kind: "toolOutcome", id: "c1", output: '{"error":"locked"}' },
    ]);
    expect(record.items[0].item).toMatchObject({ type: "fileChange", status: "failed" });
  });

  it("keeps unparsable arguments verbatim", () => {
    const record = fold([
      { kind: "toolRequest", id: "c1", name: "search_project", arguments: "not json" },
      { kind: "toolRequest", id: "c2", name: "run_command", arguments: '"ls"' },
      { kind: "toolRequest", id: "c3", name: "exec_command", arguments: '{"command":["ls"],"cwd":7}' },
    ]);
    expect(record.items[0].item).toMatchObject({ type: "dynamicToolCall", arguments: "not json" });
    expect(record.items[1].item).toMatchObject({ type: "commandExecution", command: [], cwd: "" });
    expect(record.items[2].item).toMatchObject({ type: "commandExecution", command: [], cwd: "" });
  });

  it.each([
    ["[1,2]", "completed"],
    ["null", "completed"],
    ['"done"', "completed"],
    ['{"status":"Timed Out after 30s"}', "failed"],
    ['{"exit_code":2}', "failed"],
    ['{"exec":true}', "failed"],
    ['{"status":"ok"}', "completed"],
  ] as const)("classifies the dynamic tool outcome %s as %s", (output, status) => {
    const record = fold([
      { kind: "toolCallStart", id: "c1", name: "compile" },
      { kind: "toolOutcome", id: "c1", output },
    ]);
    expect(record.items[0].item).toMatchObject({ type: "dynamicToolCall", status, output });
  });

  it("records a steer as a marker followed by the steering message", () => {
    const record = fold([{ kind: "steered", text: "use biblatex" }]);
    expect(record.items.map((entry) => entry.item)).toEqual([
      { type: "steered" },
      { type: "userMessage", text: "use biblatex" },
    ]);
  });

  it("adds nothing for bookkeeping events", () => {
    const record = fold([
      { kind: "stepStart", step: 1 },
      { kind: "toolCallArgsDelta", id: "c1", json: "{" },
      { kind: "runEnd" },
    ]);
    expect(record.items).toEqual([]);
    expect(record.status).toBe("completed");
  });

  it("keeps a failed status when the turn finishes after an error", () => {
    const record = fold([{ kind: "error", message: "boom", retryable: true }]);
    expect(record.status).toBe("failed");
    expect(record.items[0].item).toMatchObject({ type: "error", willRetry: true });
  });

  it("leaves running subagent activity open until the turn ends", () => {
    const turn = new TurnFold("turn-s").apply({
      kind: "subagentUpdate",
      runtime: "acp",
      sessionId: "sess",
      providerId: "openai",
      modelId: "gpt",
      agentId: "codex",
      id: "sub-1",
      label: "review",
      state: "thinking",
      detail: null,
    });
    const [entry] = turn.snapshot().items;
    expect(entry.completed).toBe(false);
    expect(entry.item).toMatchObject({
      runtime: "acp",
      sessionId: "sess",
      runtimeAgentId: "codex",
      agentId: "sub-1",
      kind: "thinking",
    });
  });
});

describe("newTurnRecord", () => {
  it("starts empty, in progress, with no client id unless given", () => {
    expect(newTurnRecord("t1")).toEqual({
      turnId: "t1",
      clientTurnId: null,
      status: "inProgress",
      items: [],
      usage: { input: 0, output: 0 },
      error: null,
      stoppedAtCap: false,
    });
    expect(newTurnRecord("t1", "c1").clientTurnId).toBe("c1");
  });
});
