import { describe, expect, it } from "vitest";
import type { TurnRecord } from "@oleafly/ai-core";
import { projectTurnRecords } from "./turn-record-projection";

function turn(items: TurnRecord["items"], overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    turnId: "turn-1",
    clientTurnId: null,
    status: "completed",
    items,
    usage: { input: 0, output: 0 },
    error: null,
    stoppedAtCap: false,
    ...overrides,
  };
}

describe("projectTurnRecords", () => {
  it("turns a child rollout into user and assistant rows with tools in order", () => {
    const rows = projectTurnRecords([
      turn([
        { id: "u", item: { type: "userMessage", text: "Survey the literature" }, completed: true },
        { id: "r", item: { type: "reasoning", summary: ["Plan the search"], content: [] }, completed: true },
        {
          id: "c",
          item: {
            type: "commandExecution",
            command: ["rg", "pendulum"],
            cwd: "/project",
            aggregatedOutput: "main.tex:3",
            exitCode: 0,
            status: "completed",
          },
          completed: true,
        },
        {
          id: "d",
          item: { type: "dynamicToolCall", namespace: "oleafly", tool: "read_file", arguments: {}, output: "content", status: "completed" },
          completed: true,
        },
        { id: "a", item: { type: "agentMessage", text: "Found " }, completed: false },
        { id: "a2", item: { type: "agentMessage", text: "three papers." }, completed: true },
      ]),
    ]);

    expect(rows.map((row) => row.msg.role)).toEqual(["user", "assistant"]);
    expect(rows[0].msg.content).toBe("Survey the literature");
    const assistant = rows[1].msg;
    expect(assistant.content).toBe("Found\n\nthree papers.");
    expect(assistant.reasoningBlocks).toEqual([
      { id: "r", text: "Plan the search", ms: 0, beforeTool: 0 },
    ]);
    expect(assistant.toolCalls?.map((tool) => [tool.name, tool.status])).toEqual([
      ["run_command", "done"],
      ["read_file", "done"],
    ]);
    expect(JSON.parse(assistant.toolCalls?.[0].output ?? "{}")).toEqual({
      command: "rg pendulum",
      output: "main.tex:3",
      exit_code: 0,
    });
    expect(rows[1].isLatestAssistant).toBe(true);
    expect(rows.every((row) => !row.live)).toBe(true);
  });

  it("surfaces errors, nested delegation, and failed tool status", () => {
    const rows = projectTurnRecords([
      turn(
        [
          { id: "u", item: { type: "userMessage", text: "Go" }, completed: true },
          {
            id: "s",
            item: {
              type: "subAgentActivity",
              agentId: "child-1",
              label: "verify",
              kind: "started",
              detail: null,
              runtime: "built-in",
              sessionId: "thread-child-1",
            },
            completed: false,
          },
          {
            id: "s2",
            item: {
              type: "subAgentActivity",
              agentId: "child-1",
              label: "verify",
              kind: "done",
              detail: "checked",
              runtime: "built-in",
              sessionId: "thread-child-1",
            },
            completed: true,
          },
          {
            id: "m",
            item: { type: "mcpToolCall", server: "papers", tool: "search", arguments: {}, result: { hits: 0 }, status: "failed" },
            completed: true,
          },
          { id: "e", item: { type: "error", message: "The provider rejected the request.", willRetry: false, errorInfo: null }, completed: true },
        ],
        { status: "failed", error: "The provider rejected the request." },
      ),
    ]);

    expect(rows.map((row) => row.msg.role)).toEqual(["user", "assistant", "assistant"]);
    expect(rows[1].msg.subagents).toEqual([
      expect.objectContaining({ id: "child-1", state: "done", detail: "checked", sessionId: "thread-child-1" }),
    ]);
    expect(rows[1].msg.toolCalls).toEqual([
      expect.objectContaining({ name: "mcp__papers__search", status: "error" }),
    ]);
    expect(rows[2].msg.content).toBe("The provider rejected the request.");
  });

  it("returns no rows for an empty thread", () => {
    expect(projectTurnRecords([])).toEqual([]);
  });
});
