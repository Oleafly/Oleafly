import { afterEach, describe, expect, it } from "vitest";
import type { AcpEvent } from "@/lib/acp";
import { resetDisplayHomes, setDisplayHomes } from "@/lib/display-path";
import { createAcpProjector, projectAcpEvents } from "./projection";

function event(sequence: number, kind: string, data: Record<string, unknown>, turnId = "turn-1"): AcpEvent {
  return { sequence, kind, data, turnId, sessionId: "session-1", projectId: "project-1", agentId: "fixture", modelId: null, taskId: null, timestamp: sequence };
}
const chunk = (sequence: number, text: string) => event(sequence, "agent_message_chunk", { content: { type: "text", text } });

describe("ACP conversation projection", () => {
  afterEach(() => resetDisplayHomes());

  it("shows home paths in agent titles, diffs and stderr as ~", () => {
    setDisplayHomes(["/Users/ada"]);
    const main = "/Users/ada/.oleafly/projects/p/main.tex";
    const rows = projectAcpEvents([
      event(1, "tool_call", { toolCallId: "read", title: `Read ${main}`, status: "in_progress" }),
      event(2, "tool_call_update", {
        toolCallId: "read",
        status: "completed",
        content: [{ type: "diff", path: main, oldText: "a", newText: "b" }],
      }),
      event(3, "diagnostics", { stderr: `warning: could not open ${main}` }),
    ], false);
    expect(rows[0].msg.toolCalls?.[0]).toMatchObject({
      name: "Read ~/.oleafly/projects/p/main.tex",
      diffs: [{ path: "~/.oleafly/projects/p/main.tex", oldText: "a", newText: "b", truncated: false }],
    });
    expect(rows[1].msg.content).toContain("could not open ~/.oleafly/projects/p/main.tex");
    expect(JSON.stringify(rows)).not.toContain("/Users/ada");
  });

  it("shows home paths in tool output as ~", () => {
    setDisplayHomes(["/Users/ada"]);
    const rows = projectAcpEvents([
      event(1, "tool_call", { toolCallId: "pwd", title: "Run pwd", status: "in_progress" }),
      event(2, "tool_call_update", {
        toolCallId: "pwd",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "/Users/ada/x\n/Users/ada" } }],
      }),
    ], false);
    expect(rows[0].msg.toolCalls?.[0].output).toBe("~/x\n~");
  });

  it("keeps the agent's reply as written, so copy gets the real path", () => {
    // The message bubble shows it with ~ (chat-parts); the row keeps the source.
    setDisplayHomes(["/Users/ada"]);
    const rows = projectAcpEvents([chunk(1, "I updated /Users/ada/y.")], false);
    expect(rows[0].msg.content).toBe("I updated /Users/ada/y.");
  });

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

  it("keeps ACP diff blocks as structured changes instead of flattened text", () => {
    const rows = projectAcpEvents([
      event(1, "tool_call", {
        toolCallId: "edit",
        title: "Edit main.tex",
        status: "completed",
        content: [
          { type: "content", content: { type: "text", text: "Applied the edit." } },
          { type: "diff", path: "/paper/main.tex", oldText: "old line", newText: "new line" },
          { type: "diff", path: "/paper/new.tex", oldText: null, newText: "fresh" },
          { type: "diff", path: "/paper/huge.tex", truncated: true, oldSize: 900000, newSize: 900100 },
        ],
      }),
    ], false);
    const tool = rows[0].msg.toolCalls?.[0];
    expect(tool?.output).toBe("Applied the edit.");
    expect(tool?.diffs).toEqual([
      { path: "/paper/main.tex", oldText: "old line", newText: "new line", truncated: false },
      { path: "/paper/new.tex", oldText: null, newText: "fresh", truncated: false },
      { path: "/paper/huge.tex", oldText: null, newText: null, truncated: true },
    ]);
  });

  it("keeps the last diffs when an update carries no content", () => {
    const rows = projectAcpEvents([
      event(1, "tool_call", { toolCallId: "edit", title: "Edit", content: [{ type: "diff", path: "a.tex", oldText: "a", newText: "b" }] }),
      event(2, "tool_call_update", { toolCallId: "edit", status: "completed" }),
    ], false);
    expect(rows[0].msg.toolCalls?.[0].diffs).toEqual([{ path: "a.tex", oldText: "a", newText: "b", truncated: false }]);
  });

  it("attaches turn changes to the turn's last assistant row without adding a row", () => {
    const changes = {
      turnId: "turn-1",
      snapshotId: "snap-1",
      files: [{ index: 0, path: "main.tex", change: "modified", beforeSize: 1, afterSize: 2, added: 1, removed: 0, alsoEditedHere: false, build: false }],
      moreFiles: 0,
      skipped: [],
      overlapped: false,
      unavailable: null,
    };
    const project = createAcpProjector();
    const before = [
      event(1, "user_message", { text: "Fix the intro" }),
      event(2, "tool_call", { toolCallId: "edit", title: "Edit", status: "completed" }),
      chunk(3, "Done."),
    ];
    const first = project(before, true);
    const rows = project([...before, event(4, "turn_changes", changes), event(5, "turn_complete", { stopReason: "end_turn" })], false);
    expect(rows).toHaveLength(3);
    expect(rows[2].msg.turnChanges).toMatchObject({ snapshotId: "snap-1", files: [{ path: "main.tex" }] });
    expect(rows[1].msg.turnChanges).toBeUndefined();
    expect(rows[2]).not.toBe(first[2]);
    expect(rows[0]).toBe(first[0]);
  });

  it("puts turn changes on the user row when the agent said nothing", () => {
    const rows = projectAcpEvents([
      event(1, "user_message", { text: "Run the script" }),
      event(2, "turn_changes", { turnId: "turn-1", snapshotId: null, files: [], moreFiles: 0, skipped: [], overlapped: false, unavailable: "timeout" }),
    ], false);
    expect(rows).toHaveLength(1);
    expect(rows[0].msg.turnChanges?.unavailable).toBe("timeout");
  });

  it("keeps a turn's changes on its own turn", () => {
    const rows = projectAcpEvents([
      event(1, "user_message", { text: "First" }),
      chunk(2, "One."),
      event(3, "user_message", { text: "Second" }, "turn-2"),
      event(4, "agent_message_chunk", { content: { type: "text", text: "Two." } }, "turn-2"),
      event(5, "turn_changes", { turnId: "turn-1", snapshotId: "late", files: [], moreFiles: 2, skipped: [], overlapped: false, unavailable: null }, "turn-1"),
    ], false);
    expect(rows[1].msg.turnChanges?.snapshotId).toBe("late");
    expect(rows[3].msg.turnChanges).toBeUndefined();
  });

  it("shows the skill chip data on the user row", () => {
    const rows = projectAcpEvents([
      event(1, "user_message", { text: "Audit the claims", skill: { id: "oleafly-verify-claims", name: "Verify claims" } }),
    ], false);
    expect(rows[0].msg.skill).toEqual({ id: "oleafly-verify-claims", name: "Verify claims" });
  });

  it("finishes a tool whose last update was too large and says why its output is missing", () => {
    const rows = projectAcpEvents([
      event(1, "user_message", { text: "Tidy the bibliography" }),
      event(2, "tool_call", { toolCallId: "edit", title: "Edit refs.bib", kind: "edit", status: "in_progress" }),
      event(3, "tool_call_update", { sessionUpdate: "tool_call_update", toolCallId: "edit", status: "completed", truncated: true }),
      event(4, "diagnostics", { droppedUpdate: { bytes: 1258291 } }),
      chunk(5, "Done."),
      event(6, "turn_complete", { stopReason: "end_turn" }),
    ], false);
    expect(rows).toHaveLength(4);
    expect(rows[1].msg.toolCalls?.[0]).toMatchObject({ name: "Edit refs.bib", status: "done" });
    expect(rows[2].msg.content).toBe("");
    expect(rows[2].msg.notices).toEqual([
      "Part of the agent's output was too large to show (1.2 MB).",
    ]);
    expect(rows[3].msg.content).toBe("Done.");
  });

  it("explains a dropped update saved before tool calls kept their status", () => {
    const rows = projectAcpEvents([
      event(1, "tool_call", { toolCallId: "edit", title: "Edit refs.bib", status: "in_progress" }),
      event(2, "diagnostics", { droppedUpdate: { bytes: 3 * 1024 * 1024 } }),
      event(3, "turn_complete", { stopReason: "end_turn" }),
    ], false);
    expect(rows).toHaveLength(2);
    expect(rows[1].msg.notices).toEqual([
      "Part of the agent's output was too large to show (3 MB).",
    ]);
  });

  it("does not split an answer around diagnostics that show nothing", () => {
    const rows = projectAcpEvents([
      chunk(1, "The first half"),
      event(2, "diagnostics", { stderr: "" }),
      event(3, "diagnostics", { droppedUpdate: { bytes: "many" } }),
      chunk(4, " and the second half."),
    ], false);
    expect(rows).toHaveLength(1);
    expect(rows[0].msg.content).toBe("The first half and the second half.");
  });
});

describe("ACP projection details", () => {
  it("shows images in a user turn, a returned image and a terminal command", () => {
    const rows = projectAcpEvents([
      event(1, "user_message", { text: "Look", images: [{ mimeType: "image/png" }, {}], skill: { id: "review" } }),
      event(2, "agent_message_chunk", { content: { type: "image" } }),
      event(3, "agent_message_chunk", { content: { type: "audio" } }),
      event(4, "tool_call", { toolCallId: "sh", status: "pending", content: [{ type: "terminal" }, { type: "other" }] }),
    ], false);

    expect(rows[0].msg).toMatchObject({
      role: "user",
      attachments: [
        { name: "Image 1", mediaType: "image/png" },
        { name: "Image 2", mediaType: "" },
      ],
      skill: { id: "review", name: "review" },
    });
    expect(rows[1].msg.content).toBe("[The agent returned an image.]");
    expect(rows).toHaveLength(3);
    expect(rows[2].msg.toolCalls?.[0]).toMatchObject({
      name: "Agent tool",
      status: "error",
      output: "The agent is running a terminal command.",
    });
  });

  it("merges streamed thoughts into one reasoning block and closes it at the end of the turn", () => {
    const rows = projectAcpEvents([
      event(1, "agent_thought_chunk", { content: { type: "text", text: "Compare " } }),
      event(2, "agent_thought_chunk", { content: { type: "text", text: "both drafts" } }),
      event(3, "turn_complete", {}),
    ], false);

    expect(rows).toHaveLength(1);
    expect(rows[0].msg.reasoningBlocks).toEqual([{ id: "session-1:1", text: "Compare both drafts", beforeTool: 0, ms: 0 }]);
  });

  it("keeps a tool's earlier title, status and output across bare updates", () => {
    const rows = projectAcpEvents([
      event(1, "tool_call", {
        toolCallId: "edit",
        title: "Edit main.tex",
        status: "in_progress",
        content: [{ type: "diff", path: "main.tex", truncated: true }, { type: "diff" }],
      }),
      event(2, "tool_call_update", { toolCallId: "edit", status: "mystery" }),
      event(3, "tool_call_update", { toolCallId: "" }),
    ], true);

    expect(rows).toHaveLength(1);
    expect(rows[0].msg.toolCalls?.[0]).toMatchObject({
      name: "Edit main.tex",
      status: "running",
      diffs: [{ path: "main.tex", oldText: null, newText: null, truncated: true }],
    });
  });

  it("lists a plan as a checklist", () => {
    const rows = projectAcpEvents([
      event(1, "plan", { entries: [{ status: "completed", content: "Read the draft" }, { status: "pending", content: "Fix the proof" }] }),
      event(2, "plan", { entries: "not a list" }),
    ], false);

    expect(rows[0].msg.content).toBe("- [x] Read the draft\n- [ ] Fix the proof");
  });

  it("explains an update that was too large and ignores empty diagnostics", () => {
    const rows = projectAcpEvents([
      event(1, "diagnostics", { droppedUpdate: { bytes: 2_097_152 } }),
      event(2, "diagnostics", { droppedUpdate: { bytes: Number.NaN } }),
      event(3, "diagnostics", {}),
    ], false);

    expect(rows).toHaveLength(1);
    expect(rows[0].msg.notices?.[0]).toMatch(/^Part of the agent's output was too large to show \(2/);
  });

  it("says a failed turn's error once and fails its running tools", () => {
    const rows = projectAcpEvents([
      event(1, "tool_call", { toolCallId: "t", title: "Run", status: "in_progress" }),
      chunk(2, "Error: rate limited"),
      event(3, "status", { status: "failed", error: "rate limited" }),
      event(4, "status", { status: "running" }),
    ], true);

    expect(rows).toHaveLength(2);
    expect(rows[0].msg.toolCalls?.[0].status).toBe("error");
  });

  it("adds a failure message the agent did not already give", () => {
    const rows = projectAcpEvents([
      chunk(1, "Working on it"),
      event(2, "tool_call", { toolCallId: "t", title: "Run", status: "completed" }),
      event(3, "status", { status: "disconnected", error: "connection lost" }),
    ], false);

    expect(rows.at(-1)?.msg.content).toBe("connection lost");
  });

  it("adds no row for a failure message that is only whitespace", () => {
    const rows = projectAcpEvents([
      chunk(1, "Working on it"),
      event(2, "turn_complete", { stopReason: "error", error: "  \n\t " }),
      event(3, "status", { status: "failed", error: " " }, "turn-2"),
    ], false);

    expect(rows.map((row) => row.msg.content)).toEqual(["Working on it"]);
  });

  it("hangs file changes on the turn's last assistant row and ignores unknown turns and malformed changes", () => {
    const changes = { snapshotId: "s1", files: [], moreFiles: 0, skipped: [], overlapped: false, unavailable: null };
    const rows = projectAcpEvents([
      event(1, "user_message", { text: "Fix it" }),
      chunk(2, "Done."),
      event(3, "turn_changes", { ...changes, turnId: "turn-1" }),
      event(4, "turn_changes", { ...changes, turnId: "turn-9" }),
      event(5, "turn_changes", "nothing" as unknown as Record<string, unknown>),
      event(6, "user_message", { text: "Again" }, "turn-2"),
      event(7, "turn_changes", changes, "turn-2"),
    ], false);

    expect(rows[1].msg.turnChanges?.snapshotId).toBe("s1");
    expect(rows[2].msg.turnChanges?.snapshotId).toBe("s1");
    expect(rows[0].msg.turnChanges).toBeUndefined();
  });

  it("rebuilds the rows when earlier events were replaced", () => {
    const project = createAcpProjector();
    project([chunk(1, "first"), chunk(2, " draft")], false);

    const rows = project([chunk(1, "second")], false);

    expect(rows).toHaveLength(1);
    expect(rows[0].msg.content).toBe("second");
  });
});
