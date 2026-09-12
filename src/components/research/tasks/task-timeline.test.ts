import { describe, expect, it } from "vitest";
import type { TaskRuntimeEvent, TaskTranscriptEvent } from "@/lib/research-tasks";
import { buildTaskTimeline } from "./task-timeline";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };

function transcript(events: TaskRuntimeEvent[]): TaskTranscriptEvent[] {
  return events.map((event, index) => ({
    taskId: "task",
    executionGeneration: 1,
    sequence: index + 1,
    event,
    createdAt: 1_700_000_000_000 + index,
  }));
}

describe("buildTaskTimeline", () => {
  it("keeps the name from a streamed start and takes the arguments from its end", () => {
    const { items } = buildTaskTimeline(
      transcript([
        { kind: "tool", callId: "call_2", name: "write_file", phase: "request", detail: "", status: "running" },
        {
          kind: "tool",
          callId: "call_2",
          name: "",
          phase: "update",
          detail: '{"path":"main.tex","content":"x"}',
          status: "running",
        },
        { kind: "tool", callId: "call_2", name: "", phase: "result", detail: '{"bytes":75}', status: "done" },
      ]),
      false,
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "tool",
      tool: {
        id: "call_2",
        name: "write_file",
        status: "done",
        input: '{"path":"main.tex","content":"x"}',
        output: '{"bytes":75}',
      },
    });
  });

  it("pairs a tool request with its result through the call id", () => {
    const { items } = buildTaskTimeline(
      transcript([
        {
          kind: "tool",
          callId: "call_1",
          name: "read_file",
          phase: "request",
          detail: '{"path":"main.tex"}',
          status: "running",
        },
        {
          kind: "tool",
          callId: "call_1",
          name: "",
          phase: "result",
          detail: '{"content":"body"}',
          status: "done",
        },
      ]),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "tool",
      tool: {
        id: "call_1",
        name: "read_file",
        status: "done",
        input: '{"path":"main.tex"}',
        output: '{"content":"body"}',
      },
    });
  });

  it("keeps parallel calls apart and records a failing result", () => {
    const { items } = buildTaskTimeline(
      transcript([
        { kind: "tool", callId: "a", name: "compile", phase: "request", detail: "{}", status: "running" },
        { kind: "tool", callId: "b", name: "read_file", phase: "request", detail: "{}", status: "running" },
        { kind: "tool", callId: "b", name: "", phase: "result", detail: '{"content":"b"}', status: "done" },
        { kind: "tool", callId: "a", name: "", phase: "result", detail: '{"error":"failed"}', status: "error" },
      ]),
    );

    expect(items.map((item) => (item.kind === "tool" ? item.tool.name : item.kind))).toEqual([
      "compile",
      "read_file",
    ]);
    expect(items[0]).toMatchObject({ tool: { status: "error", output: '{"error":"failed"}' } });
    expect(items[1]).toMatchObject({ tool: { status: "done", output: '{"content":"b"}' } });
  });

  it("merges an ACP update into the call it belongs to", () => {
    const { items } = buildTaskTimeline(
      transcript([
        {
          kind: "tool",
          callId: "tool-9",
          name: "Read file",
          phase: "request",
          detail: '{"kind":"read","rawInput":{"path":"main.tex"}}',
          status: "running",
        },
        {
          kind: "tool",
          callId: "tool-9",
          name: "Read file",
          phase: "update",
          detail: '{"status":"completed","rawOutput":{"content":"body"}}',
          status: "done",
        },
      ]),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      tool: {
        id: "tool-9",
        name: "Read file",
        status: "done",
        output: '{"status":"completed","rawOutput":{"content":"body"}}',
      },
    });
  });

  it("pairs legacy rows where the result carries the call id as its name", () => {
    const { items } = buildTaskTimeline(
      transcript([
        { kind: "tool", name: "read_file", detail: '{"path":"main.tex"}' },
        { kind: "tool", name: "call_1453e2c1372f49f783ac7244", detail: '{"content":"body"}' },
      ]),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "tool",
      tool: { name: "read_file", status: "done", output: '{"content":"body"}' },
    });
  });

  it("keeps a legacy result without a request as its own entry", () => {
    const { items } = buildTaskTimeline(
      transcript([{ kind: "tool", name: "call_orphan", detail: '{"content":"body"}' }]),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "tool", tool: { name: enResearchTools.tasks.timeline.toolCall, status: "done" } });
  });

  it("pairs legacy outcomes with the earliest unresolved request", () => {
    const { items } = buildTaskTimeline(
      transcript([
        { kind: "tool", name: "read_file", detail: '{"path":"main.tex"}' },
        { kind: "tool", name: "compile", detail: "{}" },
        { kind: "tool", name: "call_first", detail: '{"content":"body"}' },
        { kind: "tool", name: "call_second", detail: '{"success":true}' },
      ]),
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      tool: { name: "read_file", status: "done", output: '{"content":"body"}' },
    });
    expect(items[1]).toMatchObject({
      tool: { name: "compile", status: "done", output: '{"success":true}' },
    });
  });

  it("marks a tool without a result as interrupted once the task stops running", () => {
    const events = transcript([
      { kind: "tool", callId: "call_1", name: "compile", phase: "request", detail: "{}", status: "running" },
    ]);

    const live = buildTaskTimeline(events, true).items[0];
    expect(live).toMatchObject({ tool: { status: "running" } });
    expect(live.kind === "tool" && live.tool.interrupted).toBeUndefined();
    expect(buildTaskTimeline(events, false).items[0]).toMatchObject({
      tool: { name: "compile", interrupted: true },
    });
  });

  it("folds usage into a running total instead of timeline rows", () => {
    const timeline = buildTaskTimeline(
      transcript([
        { kind: "usage", inputTokens: 12, outputTokens: 3 },
        { kind: "text", text: "Done." },
        { kind: "usage", inputTokens: 74833, outputTokens: null },
      ]),
    );

    expect(timeline.items.map((item) => item.kind)).toEqual(["message"]);
    expect(timeline.usage).toEqual({ inputTokens: 74833, outputTokens: 3 });
  });

  it("maps milestones, messages and reasoning, and joins streamed segments", () => {
    const { items } = buildTaskTimeline(
      transcript([
        { kind: "sessionBound", nativeSessionId: "native" },
        { kind: "status", message: "Working on step 1." },
        { kind: "reasoning", text: "Checking " },
        { kind: "reasoning", text: "the sources." },
        { kind: "text", text: "The sample " },
        { kind: "text", text: "sizes match." },
        {
          kind: "artifact",
          artifact: { path: "report.md", label: "Evidence report", mediaType: "text/markdown" },
        },
      ]),
    );

    expect(items.map((item) => item.kind)).toEqual([
      "milestone",
      "milestone",
      "reasoning",
      "message",
      "artifact",
    ]);
    expect(items[0]).toMatchObject({ text: enResearchTools.tasks.timeline.sessionConnected });
    expect(items[1]).toMatchObject({ text: "Working on step 1." });
    expect(items[2]).toMatchObject({ text: "Checking the sources." });
    expect(items[3]).toMatchObject({ text: "The sample sizes match." });
    expect(items[4]).toMatchObject({ artifact: { label: "Evidence report" } });
  });
});
