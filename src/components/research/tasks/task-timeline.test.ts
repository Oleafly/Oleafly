import { describe, expect, it } from "vitest";
import type { TaskRuntimeEvent, TaskTranscriptEvent } from "@/lib/research-tasks";
import {
  buildTaskTimeline,
  buildTaskTimelineIncremental,
  latestTimelineUsage,
  TIMELINE_LIVE_ROWS,
  type TaskTimelineCache,
} from "./task-timeline";
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

describe("buildTaskTimeline edge cases", () => {
  const fallback = enResearchTools.tasks.timeline.toolCall;

  function tools(events: TaskRuntimeEvent[], running = true) {
    return buildTaskTimeline(transcript(events), running).items.flatMap((item) =>
      item.kind === "tool" ? [item.tool] : [],
    );
  }

  it("treats a call id without a phase as a request and a repeated request as a rename", () => {
    const [tool] = tools([
      { kind: "tool", callId: "call_7", name: "call_7", phase: null, detail: "", status: null },
      { kind: "tool", callId: "call_7", name: "search", phase: "request", detail: '{"q":"x"}', status: null },
      { kind: "tool", callId: "call_7", name: "", phase: "request", detail: '{"q":"y"}', status: null },
    ] as TaskRuntimeEvent[]);

    expect(tool).toMatchObject({ id: "call_7", name: "search", status: "running", input: '{"q":"y"}' });
  });

  it("pairs untagged results with the oldest unresolved call", () => {
    const items = tools([
      { kind: "tool", callId: null, name: "read_file", detail: "a", status: null },
      { kind: "tool", callId: null, name: "grep", detail: "b", status: null },
      { kind: "tool", callId: null, name: "", detail: "read result", status: null },
      { kind: "tool", callId: null, name: "", detail: "grep result", status: null },
    ] as TaskRuntimeEvent[]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ name: "read_file", status: "done", input: "a", output: "read result" });
    expect(items[1]).toMatchObject({ name: "grep", status: "done", input: "b", output: "grep result" });
  });

  it("pairs a result that names its call id instead of the tool", () => {
    const items = tools([
      { kind: "tool", callId: "call_9", name: "fetch", phase: "request", detail: "url", status: null },
      { kind: "tool", callId: null, name: "call_9", phase: null, detail: "page", status: null },
    ] as TaskRuntimeEvent[]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "call_9", name: "fetch", status: "done", output: "page" });
  });

  it("starts a tool from a result or a finished update when no request was seen", () => {
    const [result, update] = tools([
      { kind: "tool", callId: "call_a", name: "fetch", phase: "result", detail: "page", status: "error" },
      { kind: "tool", callId: "call_b", name: "", phase: "update", detail: "partial", status: "done" },
    ] as TaskRuntimeEvent[]);

    expect(result).toMatchObject({ name: fallback, status: "error", output: "page" });
    expect(update).toMatchObject({ name: fallback, status: "done", output: "partial" });
    expect(update.input).toBeUndefined();
  });

  it("keeps a running update's input and names a fallback tool from its result", () => {
    const [tool] = tools([
      { kind: "tool", callId: "call_c", name: "", phase: "update", detail: "", status: "unknown" },
      { kind: "tool", callId: "call_c", name: "", phase: "update", detail: "", status: null },
      { kind: "tool", callId: "call_c", name: "write_file", phase: "result", detail: "ok", status: null },
    ] as TaskRuntimeEvent[]);

    expect(tool).toMatchObject({ name: "write_file", status: "done", output: "ok" });
    expect(tool.input).toBeUndefined();
  });

  it("marks calls still running when the task ended as interrupted", () => {
    const items = tools(
      [
        { kind: "tool", callId: "call_d", name: "compile", phase: "request", detail: "", status: "running" },
        { kind: "tool", callId: "call_e", name: "lint", phase: "request", detail: "", status: "running" },
        { kind: "tool", callId: "call_e", name: "", phase: "result", detail: "", status: "done" },
      ] as TaskRuntimeEvent[],
      false,
    );

    expect(items[0].interrupted).toBe(true);
    expect(items[1].interrupted).toBeUndefined();
  });

  it("skips blank text and keeps the last known token counts", () => {
    const timeline = buildTaskTimeline(
      transcript([
        { kind: "text", text: "  " },
        { kind: "status", message: "Compiling" },
        { kind: "reasoning", text: " " },
        { kind: "usage", inputTokens: 10, outputTokens: 4 },
        { kind: "usage", inputTokens: null, outputTokens: null },
      ] as TaskRuntimeEvent[]),
    );

    expect(timeline.items.map((item) => item.kind)).toEqual(["milestone"]);
    expect(timeline.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
  });
});

describe("buildTaskTimeline runs, approvals and phases", () => {
  const timeline = enResearchTools.tasks.timeline;

  it("shows a run starting and finishing with its state", () => {
    const { items } = buildTaskTimeline(
      transcript([
        { kind: "run", runId: "r001", name: "baseline", state: "starting", exitCode: null },
        { kind: "run", runId: "r001", name: "baseline", state: "running", exitCode: null },
        { kind: "run", runId: "r001", name: "baseline", state: "failed", exitCode: 3 },
        { kind: "run", runId: "r002", name: "dropout", state: "timed_out", exitCode: null },
      ]),
      false,
    );

    expect(items.map((item) => item.kind)).toEqual(["milestone", "milestone", "milestone", "milestone"]);
    expect(items.map((item) => (item.kind === "milestone" ? item.text : ""))).toEqual([
      timeline.runStarted.replace("{{name}}", "baseline"),
      timeline.runStarted.replace("{{name}}", "baseline"),
      "Run baseline: Failed",
      "Run dropout: Timed out",
    ]);
  });

  it("shows an approval request with its summary and the answer it got", () => {
    const { items } = buildTaskTimeline(
      transcript([
        { kind: "approval", approvalId: "a1", approvalKind: "command", status: "pending", summary: "pip install torch" },
        { kind: "approval", approvalId: "a1", approvalKind: "command", status: "approved", summary: "pip install torch" },
        { kind: "approval", approvalId: "a2", approvalKind: "run", status: "denied", summary: "train.py" },
        { kind: "approval", approvalId: "a3", approvalKind: "mcp", status: "expired", summary: "search" },
        { kind: "approval", approvalId: "a4", approvalKind: "mcp", status: "withdrawn", summary: "search" },
      ]),
    );

    expect(items.map((item) => (item.kind === "milestone" ? item.text : item.kind))).toEqual([
      "Asked for approval: pip install torch",
      "Approval: Approved",
      "Approval: Denied",
      "Approval: Expired",
      "Approval: Withdrawn",
    ]);
  });

  it("marks the waits in the timeline but not working or preparing", () => {
    const { items } = buildTaskTimeline(
      transcript([
        { kind: "phase", phase: "preparing" },
        { kind: "phase", phase: "planning" },
        { kind: "phase", phase: "working" },
        { kind: "phase", phase: "waiting_runs" },
        { kind: "phase", phase: "waiting_approval" },
        { kind: "phase", phase: "wrapping_up" },
        { kind: "phase", phase: "checking_evidence" },
      ]),
    );

    expect(items.map((item) => (item.kind === "milestone" ? item.text : item.kind))).toEqual([
      "Writing the plan",
      "Waiting for runs",
      "Waiting for approval",
      "Wrapping up",
      "Checking evidence",
    ]);
    expect(items.map((item) => item.sequence)).toEqual([2, 4, 5, 6, 7]);
  });

  it("keeps run rows in sequence between messages and tools", () => {
    const { items } = buildTaskTimeline(
      transcript([
        { kind: "text", text: "Measuring the baseline first." },
        { kind: "tool", callId: "call_9", name: "start_run", phase: "request", detail: "{}", status: "running" },
        { kind: "run", runId: "r001", name: "baseline", state: "running", exitCode: null },
        { kind: "tool", callId: "call_9", name: "", phase: "result", detail: '{"id":"r001"}', status: "done" },
        { kind: "run", runId: "r001", name: "baseline", state: "succeeded", exitCode: 0 },
      ]),
      false,
    );

    expect(items.map((item) => item.kind)).toEqual(["message", "tool", "milestone", "milestone"]);
    expect(items.at(-1)).toMatchObject({ kind: "milestone", text: "Run baseline: Finished", sequence: 5 });
  });
});

describe("buildTaskTimelineIncremental", () => {
  /** A long run: text that streams, reasoning, paired tools, statuses and usage. */
  function longRun(count: number): TaskTranscriptEvent[] {
    const events: TaskRuntimeEvent[] = [];
    for (let index = 0; events.length < count; index += 1) {
      events.push(
        { kind: "text", text: `Step ${index} starts. ` },
        { kind: "text", text: `Step ${index} goes on.` },
        { kind: "reasoning", text: `Why ${index}` },
        { kind: "tool", callId: `call_${index}`, name: "read_file", phase: "request", detail: `{"n":${index}}`, status: "running" },
        { kind: "tool", callId: `call_${index}`, name: "", phase: "result", detail: `{"ok":${index}}`, status: "done" },
        { kind: "status", message: `Done ${index}` },
        { kind: "usage", inputTokens: index * 10, outputTokens: index },
      );
    }
    return transcript(events.slice(0, count));
  }

  it("builds what a full build builds, row by row and while the newest text grows", () => {
    const rows = longRun(600);
    let cache: TaskTimelineCache | null = null;
    for (let length = 1; length <= rows.length; length += 37) {
      const shown = rows.slice(0, length);
      const last = shown[shown.length - 1];
      // The newest row is replaced as its text grows, as a live delta does it.
      if (last.event.kind === "text") shown[shown.length - 1] = { ...last, event: { ...last.event, text: `${last.event.text}+` } };
      const built = buildTaskTimelineIncremental(shown, true, cache);
      expect(built.timeline).toEqual(buildTaskTimeline(shown, true));
      cache = built.cache;
    }
    const done = buildTaskTimelineIncremental(rows, false, cache);
    expect(done.timeline).toEqual(buildTaskTimeline(rows, false));
  });

  it("keeps the settled items as the same objects when only the newest text changes", () => {
    const rows = longRun(400);
    const first = buildTaskTimelineIncremental(rows, true, null);
    const grown = rows.slice();
    const last = grown[grown.length - 1];
    grown[grown.length - 1] = { ...last };
    const second = buildTaskTimelineIncremental(grown, true, first.cache);

    expect(first.cache.rows.length).toBeGreaterThan(0);
    expect(first.cache.rows.length).toBeLessThanOrEqual(rows.length - TIMELINE_LIVE_ROWS);
    expect(second.timeline.items[0]).toBe(first.timeline.items[0]);
    expect(second.timeline).toEqual(buildTaskTimeline(grown, true));
  });

  it("builds everything again when older rows are loaded before the ones it holds", () => {
    const rows = longRun(400);
    const newest = rows.slice(100);
    const first = buildTaskTimelineIncremental(newest, true, null);

    const all = buildTaskTimelineIncremental(rows, true, first.cache);

    expect(all.timeline).toEqual(buildTaskTimeline(rows, true));
  });

  it("builds everything again when a later row updates a tool from the settled part", () => {
    const rows = longRun(400);
    const first = buildTaskTimelineIncremental(rows, true, null);
    const update: TaskTranscriptEvent = {
      taskId: "task",
      executionGeneration: 1,
      sequence: rows.length + 1,
      createdAt: 1,
      event: { kind: "tool", callId: "call_0", name: "", phase: "update", detail: '{"late":true}', status: "done" },
    };
    const later = [...rows, update];

    expect(buildTaskTimelineIncremental(later, true, first.cache).timeline).toEqual(buildTaskTimeline(later, true));
  });

  it("doesn't settle past a tool that still waits for its result", () => {
    const waiting = transcript([
      { kind: "tool", callId: "call_open", name: "run_command", phase: "request", detail: "{}", status: "running" },
      ...Array.from({ length: 300 }, (_, index): TaskRuntimeEvent => ({ kind: "status", message: `Row ${index}` })),
    ]);

    const built = buildTaskTimelineIncremental(waiting, false, null);

    expect(built.cache.rows).toHaveLength(0);
    expect(built.timeline).toEqual(buildTaskTimeline(waiting, false));
    expect(built.timeline.items[0]).toMatchObject({ kind: "tool", tool: { interrupted: true } });
  });
});

describe("latestTimelineUsage", () => {
  it("reports the usage a full timeline reports", () => {
    const rows = transcript([
      { kind: "usage", inputTokens: 10, outputTokens: null },
      { kind: "text", text: "Answer" },
      { kind: "usage", inputTokens: null, outputTokens: 7 },
    ]);

    expect(latestTimelineUsage(rows)).toEqual(buildTaskTimeline(rows).usage);
    expect(latestTimelineUsage([])).toEqual({ inputTokens: null, outputTokens: null });
  });
});
