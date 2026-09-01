import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./agent-events";
import { TurnFold } from "./thread-items";
import { splitIntoRenderGroups, toViewItem } from "./item-views";

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
