import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./agent-events";
import {
  newTurnRecord,
  TurnFold,
  type RecordedStoreItem,
  type StoreItem,
  type TurnRecord,
} from "./thread-items";
import { splitIntoRenderGroups, subagentDisplayStatus, toViewItem, type ViewItem } from "./item-views";

function recordFrom(events: AgentEvent[]) {
  const fold = new TurnFold("turn-1");
  for (const event of events) {
    fold.apply(event);
  }
  return fold.finish();
}

describe("toViewItem", () => {
  it("maps retry errors to stream-error and terminal errors to system-error", () => {
    const fold = new TurnFold("t").apply({ kind: "retry", attempt: 1, max: 3 });
    const retryView = toViewItem(fold.snapshot().items[0], false);
    expect(retryView.type).toBe("stream-error");

    const terminal = new TurnFold("t").apply({
      kind: "error",
      message: "boom",
      retryable: false,
    });
    expect(toViewItem(terminal.snapshot().items[0], false).type).toBe("system-error");
  });

  it("maps subagent kinds onto display statuses", () => {
    const fold = new TurnFold("t").apply({
      kind: "subagentUpdate",
      id: "sub-1",
      label: "research",
      state: "started",
      detail: null,
    });
    const view = toViewItem(fold.snapshot().items[0], false);
    expect(view).toMatchObject({ type: "subagent-activity", displayStatus: "active" });
  });
});

describe("splitIntoRenderGroups", () => {
  it("hoists the final assistant message after the tool output", () => {
    const record = recordFrom([
      { kind: "textDelta", text: "Reading first" },
      { kind: "toolCallStart", id: "c1", name: "read_file" },
      { kind: "toolOutcome", id: "c1", output: "contents" },
      { kind: "textDelta", text: "All done" },
    ]);
    const groups = splitIntoRenderGroups(record);
    expect(groups.agentItems.map((item) => item.type)).toEqual(["assistant-message"]);
    expect(groups.toolOutputItems.map((item) => item.type)).toEqual(["dynamic-tool-call"]);
    expect(groups.assistantItem).toMatchObject({
      type: "assistant-message",
      text: "All done",
    });
    expect(groups.postAssistantItems).toEqual([]);
  });

  it("groups consecutive subagent activity into runs", () => {
    const record = recordFrom([
      {
        kind: "subagentUpdate",
        id: "a",
        label: "one",
        state: "started",
        detail: null,
      },
      {
        kind: "subagentUpdate",
        id: "a",
        label: "one",
        state: "updated",
        detail: null,
      },
      {
        kind: "subagentUpdate",
        id: "b",
        label: "two",
        state: "started",
        detail: null,
      },
    ]);
    const groups = splitIntoRenderGroups(record);
    expect(groups.subagentActivityItemGroups).toHaveLength(2);
    expect(groups.subagentActivityItemGroups[0]).toHaveLength(2);
    expect(groups.subagentActivityItemGroups[1]).toHaveLength(1);
  });

  it("keeps the trailing system error separate from tool output", () => {
    const record = recordFrom([
      { kind: "textDelta", text: "partial" },
      { kind: "error", message: "usage limit", retryable: false },
    ]);
    const groups = splitIntoRenderGroups(record);
    expect(groups.systemEventItem).toMatchObject({ type: "system-error" });
    expect(groups.toolOutputItems).toHaveLength(0);
  });

  it("marks in-flight executions interrupted on interrupted turns", () => {
    const fold = new TurnFold("t")
      .apply({ kind: "toolCallStart", id: "c1", name: "run_command" })
      .apply({ kind: "toolRequest", id: "c1", name: "run_command", arguments: '{"command":"x"}' });
    const record = fold.markInterrupted();
    const view = toViewItem(record.items[0], true);
    expect(view).toMatchObject({ type: "exec", executionStatus: "interrupted" });
  });
});

function recorded(item: StoreItem, completed = true, id = "turn:0"): RecordedStoreItem {
  return { id, item, completed };
}

function idsOf(items: ViewItem[]): (string | null)[] {
  return items.map((item) => ("itemId" in item ? item.itemId : null));
}

function turnWith(items: StoreItem[], status: TurnRecord["status"] = "completed"): TurnRecord {
  return {
    ...newTurnRecord("turn"),
    status,
    items: items.map((item, index) => recorded(item, true, `turn:${index}`)),
  };
}

describe("toViewItem mapping", () => {
  it.each<[string, StoreItem, ViewItem]>([
    [
      "hook prompts",
      { type: "hookPrompt", prompt: "run lint first" },
      { type: "hook-prompt", itemId: "turn:0", prompt: "run lint first" },
    ],
    [
      "proposed plans",
      { type: "plan", text: "1. outline" },
      { type: "proposed-plan", itemId: "turn:0", text: "1. outline" },
    ],
    [
      "file changes",
      { type: "fileChange", changes: { path: "main.tex" }, status: "completed" },
      { type: "patch", itemId: "turn:0", changes: { path: "main.tex" }, status: "completed" },
    ],
    [
      "MCP tool calls",
      {
        type: "mcpToolCall",
        server: "zotero",
        tool: "search",
        arguments: { q: "x" },
        result: null,
        status: "failed",
      },
      { type: "mcp-tool-call", itemId: "turn:0", server: "zotero", tool: "search", status: "failed" },
    ],
    [
      "collaborating agent calls",
      { type: "collabAgentToolCall", tool: "wait_agent", arguments: {}, result: { done: true } },
      { type: "multi-agent-action", itemId: "turn:0", tool: "wait_agent", result: { done: true } },
    ],
    [
      "todo lists",
      { type: "todo-list", explanation: "plan", todos: [{ step: "a", status: "pending" }] },
      {
        type: "todo-list",
        itemId: "turn:0",
        explanation: "plan",
        todos: [{ step: "a", status: "pending" }],
      },
    ],
    [
      "plan implementations",
      { type: "planImplementation", planContent: "do it", completed: true },
      { type: "plan-implementation", itemId: "turn:0", planContent: "do it", completed: true },
    ],
    [
      "automatic approval reviews",
      {
        type: "automaticApprovalReview",
        targetItemId: "turn:3",
        action: "approve",
        riskLevel: "low",
        rationale: null,
      },
      {
        type: "automatic-approval-review",
        itemId: "turn:0",
        targetItemId: "turn:3",
        action: "approve",
        riskLevel: "low",
      },
    ],
    ["strict review notices", { type: "strictReviewNotice" }, { type: "strict-review-notice", itemId: "turn:0" }],
    [
      "remote tasks",
      { type: "remoteTaskCreated", taskId: "task-9" },
      { type: "remote-task-created", itemId: "turn:0", taskId: "task-9" },
    ],
    [
      "personality changes",
      { type: "personalityChanged", personality: "terse" },
      { type: "personality-changed", itemId: "turn:0", personality: "terse" },
    ],
    [
      "forks",
      { type: "forkedFromConversation", sourceConversationId: "c1", sourceConversationTitle: null },
      {
        type: "forked-from-conversation",
        itemId: "turn:0",
        sourceConversationId: "c1",
        sourceConversationTitle: null,
      },
    ],
    [
      "model changes",
      { type: "modelChanged", fromModel: "a", toModel: "b" },
      { type: "model-changed", itemId: "turn:0", fromModel: "a", toModel: "b" },
    ],
    [
      "model reroutes",
      { type: "modelRerouted", fromModel: "a", toModel: "c" },
      { type: "model-rerouted", itemId: "turn:0", fromModel: "a", toModel: "c" },
    ],
    [
      "auto-review interruption warnings",
      { type: "autoReviewInterruptionWarning" },
      { type: "auto-review-interruption-warning", itemId: "turn:0" },
    ],
    [
      "user input responses",
      { type: "userInputResponse", requestId: "r1", answers: ["yes"] },
      { type: "user-input-response", itemId: "turn:0", requestId: "r1", answers: ["yes"] },
    ],
    [
      "MCP elicitations",
      { type: "mcpServerElicitation", requestId: "r2", serverName: "zotero", elicitation: {}, completed: false },
      { type: "mcp-server-elicitation", itemId: "turn:0", requestId: "r2", serverName: "zotero", completed: false },
    ],
    [
      "permission requests",
      { type: "permissionRequest", requestId: "r3", permissions: ["net"], response: "granted" },
      { type: "permission-request", itemId: "turn:0", requestId: "r3", response: "granted" },
    ],
    [
      "web searches",
      { type: "webSearch", query: "diffusion", completed: true },
      { type: "web-search", itemId: "turn:0", query: "diffusion", completed: true },
    ],
    [
      "context compactions",
      { type: "contextCompaction", droppedMessages: 4, reason: "limit" },
      { type: "context-compaction", itemId: "turn:0", droppedMessages: 4, reason: "limit" },
    ],
    [
      "worktree init",
      { type: "worktreeInit", outcome: "created" },
      { type: "worktree-init", itemId: "turn:0", outcome: "created" },
    ],
    ["user messages", { type: "userMessage", text: "hi" }, { type: "user-message", itemId: "turn:0", text: "hi" }],
    [
      "steering messages",
      { type: "steeringUserMessage", text: "stop", status: "queued" },
      { type: "steering-user-message", itemId: "turn:0", text: "stop", status: "queued" },
    ],
    ["steered markers", { type: "steered" }, { type: "steered", itemId: "turn:0" }],
    [
      "generated images",
      { type: "imageGeneration", status: "done", path: "figures/a.png" },
      { type: "generated-image", itemId: "turn:0", status: "done", path: "figures/a.png" },
    ],
    [
      "image views",
      { type: "imageView", imagePaths: ["a.png", "b.png"] },
      { type: "image-view", itemId: "turn:0", imagePaths: ["a.png", "b.png"] },
    ],
    ["entering review mode", { type: "enteredReviewMode" }, { type: "steered", itemId: "turn:0" }],
    ["leaving review mode", { type: "exitedReviewMode" }, { type: "steered", itemId: "turn:0" }],
    ["sleeps", { type: "sleep", durationMs: 1500 }, { type: "sleep", itemId: "turn:0", durationMs: 1500 }],
  ])("maps %s", (_label, item, expected) => {
    expect(toViewItem(recorded(item), false)).toEqual(expected);
  });

  it("joins reasoning summaries with blank lines and falls back to raw content", () => {
    expect(
      toViewItem(recorded({ type: "reasoning", summary: ["First", "Second"], content: ["raw"] }, false), false),
    ).toEqual({ type: "reasoning", itemId: "turn:0", text: "First\n\nSecond", completed: false });
    expect(
      toViewItem(recorded({ type: "reasoning", summary: [], content: ["a", "b"] }), false),
    ).toMatchObject({ text: "ab", completed: true });
  });

  it("keeps a finished command's status even on an interrupted turn", () => {
    const item: StoreItem = {
      type: "commandExecution",
      command: ["ls"],
      cwd: "/proj",
      aggregatedOutput: "main.tex\n",
      exitCode: 0,
      status: "completed",
    };
    expect(toViewItem(recorded(item), true)).toEqual({
      type: "exec",
      itemId: "turn:0",
      command: ["ls"],
      cwd: "/proj",
      output: "main.tex\n",
      exitCode: 0,
      executionStatus: "completed",
    });
    expect(toViewItem(recorded({ ...item, status: "inProgress" }), false)).toMatchObject({
      executionStatus: "inProgress",
    });
  });

  it("carries the terminal error info into the system error view", () => {
    expect(
      toViewItem(recorded({ type: "error", message: "quota", willRetry: false, errorInfo: "429" }), false),
    ).toEqual({ type: "system-error", itemId: "turn:0", message: "quota", errorInfo: "429" });
  });
});

describe("subagentDisplayStatus", () => {
  it.each([
    ["started", "active"],
    ["thinking", "active"],
    ["tool", "active"],
    ["interacted", "updated"],
    ["interrupted", "interrupted"],
    ["done", "completed"],
    ["error", "completed"],
  ] as const)("shows %s as %s", (kind, status) => {
    expect(subagentDisplayStatus(kind)).toBe(status);
  });
});

describe("splitIntoRenderGroups buckets", () => {
  it("returns empty buckets for a turn with no items", () => {
    const groups = splitIntoRenderGroups(turnWith([]));
    expect(groups.assistantItem).toBeNull();
    expect(groups.systemEventItem).toBeNull();
    expect(groups.userItems).toEqual([]);
    expect(groups.toolOutputItems).toEqual([]);
    expect(groups.subagentActivityItemGroups).toEqual([]);
  });

  it("routes every special item kind into its own bucket", () => {
    const groups = splitIntoRenderGroups(
      turnWith([
        { type: "userMessage", text: "go" },
        { type: "hookPrompt", prompt: "hook" },
        { type: "steeringUserMessage", text: "also", status: "sent" },
        { type: "todo-list", explanation: null, todos: [] },
        { type: "plan", text: "plan" },
        { type: "planImplementation", planContent: "impl", completed: false },
        { type: "permissionRequest", requestId: "p", permissions: null, response: null },
        { type: "mcpServerElicitation", requestId: "e", serverName: "s", elicitation: null, completed: true },
        { type: "modelChanged", fromModel: "a", toModel: "b" },
        { type: "modelRerouted", fromModel: "b", toModel: "c" },
        { type: "personalityChanged", personality: "warm" },
        { type: "forkedFromConversation", sourceConversationId: "c", sourceConversationTitle: "Old" },
        { type: "webSearch", query: "q", completed: true },
      ]),
    );

    expect(groups.userItems.map((item) => item.type)).toEqual([
      "user-message",
      "hook-prompt",
      "steering-user-message",
    ]);
    expect(groups.todoListItem?.type).toBe("todo-list");
    expect(groups.proposedPlanItem?.type).toBe("proposed-plan");
    expect(groups.planImplementationItem?.type).toBe("plan-implementation");
    expect(idsOf(groups.permissionRequestItems)).toEqual(["turn:6"]);
    expect(idsOf(groups.mcpServerElicitationItems)).toEqual(["turn:7"]);
    expect(idsOf(groups.modelChangedItems)).toEqual(["turn:8"]);
    expect(idsOf(groups.modelReroutedItems)).toEqual(["turn:9"]);
    expect(idsOf(groups.personalityChangedItems)).toEqual(["turn:10"]);
    expect(idsOf(groups.forkedFromConversationItems)).toEqual(["turn:11"]);
    expect(groups.toolOutputItems.map((item) => item.type)).toEqual(["web-search"]);
    expect(groups.agentItems).toEqual([]);
    expect(groups.assistantItem).toBeNull();
  });

  it("keeps earlier assistant messages inline and hoists only the last one", () => {
    const groups = splitIntoRenderGroups(
      turnWith([
        { type: "agentMessage", text: "first" },
        { type: "agentMessage", text: "second" },
        { type: "agentMessage", text: "final" },
      ]),
    );
    expect(groups.agentItems.map((item) => item.type === "assistant-message" && item.text)).toEqual([
      "first",
      "second",
    ]);
    expect(groups.assistantItem).toMatchObject({ text: "final" });
    expect(groups.postAssistantItems).toEqual([]);
  });

  it("opens a run at the first update and a new run at each active update", () => {
    const activity = (agentId: string, kind: string): StoreItem => ({
      type: "subAgentActivity",
      agentId,
      label: agentId,
      kind,
      detail: null,
    });
    const groups = splitIntoRenderGroups(
      turnWith([activity("a", "done"), activity("a", "interacted"), activity("b", "thinking")]),
    );
    expect(groups.subagentActivityItemGroups.map((run) => run.length)).toEqual([2, 1]);
  });

  it("lets a later terminal error replace an earlier one", () => {
    const groups = splitIntoRenderGroups(
      turnWith([
        { type: "error", message: "first", willRetry: false, errorInfo: null },
        { type: "error", message: "second", willRetry: false, errorInfo: null },
      ]),
    );
    expect(groups.systemEventItem).toMatchObject({ message: "second" });
  });

  it("shows in-flight commands as interrupted only on an interrupted turn", () => {
    const command: StoreItem = {
      type: "commandExecution",
      command: ["make"],
      cwd: "",
      aggregatedOutput: "",
      exitCode: null,
      status: "inProgress",
    };
    expect(splitIntoRenderGroups(turnWith([command], "interrupted")).toolOutputItems[0]).toMatchObject({
      executionStatus: "interrupted",
    });
    expect(splitIntoRenderGroups(turnWith([command], "failed")).toolOutputItems[0]).toMatchObject({
      executionStatus: "inProgress",
    });
  });
});
