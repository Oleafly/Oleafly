import { describe, expect, it } from "vitest";
import type { AcpEvent } from "@/lib/acp";
import { createAcpProjector, projectAcpEvents } from "./projection";

function event(sequence: number, kind: string, data: Record<string, unknown>, turnId = "turn-1"): AcpEvent {
  return { sequence, kind, data, turnId, sessionId: "session-1", projectId: "project-1", agentId: "fixture", modelId: null, taskId: null, timestamp: sequence };
}
const chunk = (sequence: number, text: string) => event(sequence, "agent_message_chunk", { content: { type: "text", text } });

describe("ACP conversation projection", () => {
  it("splits the Codex skills budget warning off the answer", () => {
    const project = createAcpProjector();
    const first = [chunk(1, "Warning: Exceeded skills context budget")];
    project(first, true);
    const rows = project(
      [...first, chunk(2, " of 4000 tokens.\nThe revision is ready.")],
      false,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].msg.content).toBe("The revision is ready.");
    expect(rows[0].msg.notices).toEqual([
      "Codex could not list all of its skills. It keeps a 2% context budget for skill descriptions, so trim the skills folder or ask for a skill by name.",
    ]);
  });

  it("keeps text, reasoning and tool activity in observed order", () => {
    const rows = projectAcpEvents([
      event(1, "user_message", { text: "Review this paper" }),
      chunk(2, "I will check the evidence."),
      event(3, "agent_thought_chunk", { content: { type: "text", text: "Checking the reference." } }),
      event(4, "tool_call", { toolCallId: "read", title: "Read reference", status: "in_progress" }),
      chunk(5, "The reference says "), chunk(6, "something different."),
      event(7, "tool_call_update", { toolCallId: "read", status: "completed", content: [{ type: "content", content: { type: "text", text: "Citation result" } }] }),
      event(8, "turn_complete", { stopReason: "end_turn" }),
    ], false);
    expect(rows).toHaveLength(5);
    expect(rows[1].msg.content).toBe("I will check the evidence.");
    expect(rows[2].msg.reasoningBlocks?.[0].text).toBe("Checking the reference.");
    expect(rows[3].msg.toolCalls?.[0]).toMatchObject({ name: "Read reference", status: "done", output: "Citation result" });
    expect(rows[4].msg.content).toBe("The reference says something different.");
  });

  it("preserves earlier message references as tokens arrive", () => {
    const project = createAcpProjector();
    const initial = [event(1, "user_message", { text: "Hi" }), chunk(2, "Hello")];
    const first = project(initial, true);
    const second = project([...initial, chunk(3, " again")], true);
    expect(second[0]).toBe(first[0]);
    expect(second[1].msg.content).toBe("Hello again");
    expect(first[1].msg.content).toBe("Hello");
  });

  it("rebuilds safely when earlier history is loaded", () => {
    const project = createAcpProjector();
    const latest = chunk(4, "Later");
    project([latest], false);
    const rows = project([event(1, "user_message", { text: "Earlier" }), latest], false);
    expect(rows.map((row) => row.msg.content)).toEqual(["Earlier", "Later"]);
  });

  it("marks interrupted tools as stopped rather than running indefinitely", () => {
    const rows = projectAcpEvents([event(1, "tool_call", { toolCallId: "tool", title: "Compile", status: "in_progress" }), event(2, "status", { status: "disconnected" })], false);
    expect(rows[0].msg.toolCalls?.[0].status).toBe("error");
  });

  it("settles pending tool display when reopening a crashed transcript", () => {
    const rows = projectAcpEvents([event(1, "tool_call", { toolCallId: "tool", title: "Compile", status: "in_progress" })], false);
    expect(rows[0].msg.toolCalls?.[0].status).toBe("error");
  });

  it("does not merge repeated tool IDs across turns", () => {
    const rows = projectAcpEvents([event(1, "tool_call", { toolCallId: "1", title: "First" }), event(2, "tool_call", { toolCallId: "1", title: "Second" }, "turn-2")], true);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.msg.toolCalls?.[0].name)).toEqual(["First", "Second"]);
  });

  it("does not repeat a failure the agent already said in its own words", () => {
    const rows = projectAcpEvents([
      event(1, "user_message", { text: "Hello" }),
      chunk(2, "Failed to authenticate: OAuth session expired and could not be refreshed"),
      event(3, "turn_complete", { stopReason: "error", error: "Internal error: Failed to authenticate: OAuth session expired and could not be refreshed" }),
    ], false);
    expect(rows).toHaveLength(2);
    expect(rows[1].msg.content).toBe("Failed to authenticate: OAuth session expired and could not be refreshed");
  });

  it("still reports a failure the agent never mentioned", () => {
    const rows = projectAcpEvents([
      event(1, "user_message", { text: "Hello" }),
      chunk(2, "Reading the manuscript."),
      event(3, "turn_complete", { stopReason: "error", error: "The agent stopped before completing this turn." }),
    ], false);
    expect(rows).toHaveLength(3);
    expect(rows[2].msg.content).toBe("The agent stopped before completing this turn.");
  });
});
