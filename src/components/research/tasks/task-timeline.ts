import { coalesceTranscriptEvents } from "@/lib/chat-activity";
import { i18n } from "@/i18n";
import type {
  TaskArtifact,
  TaskToolEvent,
  TaskToolPhase,
  TaskTranscriptEvent,
} from "@/lib/research-tasks";
import type { ToolEntry } from "@/store/chats";
import { approvalStatusLabel, phaseLabel, runStateLabel } from "./task-status";

export interface TaskTimelineTool extends ToolEntry {
  id: string;
  input?: string;
  interrupted?: boolean;
}

interface TimelineBase {
  key: string;
  sequence: number;
  createdAt: number;
}

export type TaskTimelineItem =
  | (TimelineBase & { kind: "milestone"; text: string })
  | (TimelineBase & { kind: "message"; text: string })
  | (TimelineBase & { kind: "reasoning"; text: string })
  | (TimelineBase & { kind: "tool"; tool: TaskTimelineTool })
  | (TimelineBase & { kind: "artifact"; artifact: TaskArtifact });

export interface TaskTimelineUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface TaskTimeline {
  items: TaskTimelineItem[];
  usage: TaskTimelineUsage;
}

export function toolFallbackName(): string {
  return i18n.t(($) => $.researchTools.tasks.timeline.toolCall);
}

const TOOL_STATUSES = new Set<ToolEntry["status"]>(["running", "done", "error"]);

function toolStatus(value: string | null | undefined): ToolEntry["status"] | undefined {
  return value && TOOL_STATUSES.has(value as ToolEntry["status"])
    ? (value as ToolEntry["status"])
    : undefined;
}

function looksLikeCallId(name: string): boolean {
  return !name || name.startsWith("call_");
}

function toolPhase(event: TaskToolEvent, name: string, matched: string | null): TaskToolPhase {
  if (event.phase) return event.phase;
  if (event.callId) return "request";
  return matched || looksLikeCallId(name) ? "result" : "request";
}

interface TimelineState {
  items: TaskTimelineItem[];
  byCall: Map<string, TaskTimelineTool>;
  unresolved: string[];
}

function hasRealName(name: string): boolean {
  return Boolean(name) && !looksLikeCallId(name);
}

function resolveCall(unresolved: string[], id: string) {
  const position = unresolved.indexOf(id);
  if (position >= 0) unresolved.splice(position, 1);
}

function untaggedCallId(
  phase: TaskToolPhase,
  matched: string | null,
  unresolved: readonly string[],
  fallback: string,
): string {
  if (phase === "request") return fallback;
  return matched ?? unresolved[0] ?? fallback;
}

function createTool(
  event: TaskToolEvent,
  name: string,
  phase: TaskToolPhase,
  id: string,
  status: ToolEntry["status"] | undefined,
): TaskTimelineTool {
  const tool: TaskTimelineTool = {
    id,
    name: phase === "request" && !looksLikeCallId(name) ? name : toolFallbackName(),
    status: status ?? (phase === "request" ? "running" : "done"),
  };
  if (phase === "request" || (phase === "update" && tool.status === "running")) {
    if (event.detail) tool.input = event.detail;
    if (tool.status !== "running") tool.output = event.detail;
  } else {
    tool.output = event.detail;
  }
  return tool;
}

function isRunningUpdate(phase: TaskToolPhase, status: ToolEntry["status"] | undefined): boolean {
  return phase === "update" && (status === undefined || status === "running");
}

function updateTool(
  existing: TaskTimelineTool,
  event: TaskToolEvent,
  name: string,
  phase: TaskToolPhase,
  status: ToolEntry["status"] | undefined,
) {
  if (phase === "request") {
    if (hasRealName(name)) existing.name = name;
    existing.input = event.detail;
  } else if (isRunningUpdate(phase, status)) {
    if (hasRealName(name)) existing.name = name;
    if (event.detail) existing.input = event.detail;
  } else {
    if (hasRealName(name) && existing.name === toolFallbackName()) existing.name = name;
    existing.output = event.detail;
  }
  if (status) existing.status = status;
}

function applyToolEvent(state: TimelineState, base: TimelineBase, event: TaskToolEvent) {
  const name = event.name.trim();
  const matched = name && state.unresolved.includes(name) ? name : null;
  const phase = toolPhase(event, name, matched);
  const resolved =
    event.callId ?? untaggedCallId(phase, matched, state.unresolved, base.key);
  const status = toolStatus(event.status) ?? (phase === "result" ? "done" : undefined);
  const existing = state.byCall.get(resolved);
  if (!existing) {
    const tool = createTool(event, name, phase, resolved, status);
    state.byCall.set(resolved, tool);
    state.items.push({ ...base, kind: "tool", tool });
    if (tool.status === "running") state.unresolved.push(resolved);
    return;
  }
  updateTool(existing, event, name, phase, status);
  if (existing.status !== "running") resolveCall(state.unresolved, resolved);
}

type EntryEvent = TaskTranscriptEvent["event"];

function runMilestoneText(event: Extract<EntryEvent, { kind: "run" }>): string {
  if (event.state === "starting" || event.state === "running") {
    return i18n.t(($) => $.researchTools.tasks.timeline.runStarted, { name: event.name });
  }
  return i18n.t(($) => $.researchTools.tasks.timeline.runFinished, {
    name: event.name,
    status: runStateLabel(event.state),
  });
}

function approvalMilestoneText(event: Extract<EntryEvent, { kind: "approval" }>): string {
  if (event.status === "pending") {
    return i18n.t(($) => $.researchTools.tasks.timeline.approvalRequested, { summary: event.summary });
  }
  return i18n.t(($) => $.researchTools.tasks.timeline.approvalDecided, {
    status: approvalStatusLabel(event.status),
  });
}

function appendEntry(
  state: TimelineState,
  usage: TaskTimelineUsage,
  base: TimelineBase,
  event: EntryEvent,
) {
  switch (event.kind) {
    case "sessionBound":
      state.items.push({
        ...base,
        kind: "milestone",
        text: i18n.t(($) => $.researchTools.tasks.timeline.sessionConnected),
      });
      break;
    case "status":
      state.items.push({ ...base, kind: "milestone", text: event.message });
      break;
    case "text":
      if (event.text.trim()) state.items.push({ ...base, kind: "message", text: event.text });
      break;
    case "reasoning":
      if (event.text.trim()) state.items.push({ ...base, kind: "reasoning", text: event.text });
      break;
    case "artifact":
      state.items.push({ ...base, kind: "artifact", artifact: event.artifact });
      break;
    case "usage":
      if (event.inputTokens !== null) usage.inputTokens = event.inputTokens;
      if (event.outputTokens !== null) usage.outputTokens = event.outputTokens;
      break;
    case "tool":
      applyToolEvent(state, base, event);
      break;
    case "run":
      state.items.push({ ...base, kind: "milestone", text: runMilestoneText(event) });
      break;
    case "approval":
      state.items.push({ ...base, kind: "milestone", text: approvalMilestoneText(event) });
      break;
    case "phase":
      if (event.phase !== "working" && event.phase !== "preparing") {
        state.items.push({ ...base, kind: "milestone", text: phaseLabel(event.phase) });
      }
      break;
  }
}

function markInterrupted(state: TimelineState) {
  for (const id of state.unresolved) {
    const tool = state.byCall.get(id);
    if (tool?.status === "running") tool.interrupted = true;
  }
}

interface TimelineSegment {
  timeline: TaskTimeline;
  settled: boolean;
  calls: ReadonlySet<string>;
}

function buildSegment(events: readonly TaskTranscriptEvent[], running: boolean): TimelineSegment {
  const merged = coalesceTranscriptEvents(events);
  const state: TimelineState = { items: [], byCall: new Map(), unresolved: [] };
  const usage: TaskTimelineUsage = { inputTokens: null, outputTokens: null };

  for (const entry of merged) {
    appendEntry(
      state,
      usage,
      {
        key: `${entry.executionGeneration}:${entry.sequence}`,
        sequence: entry.sequence,
        createdAt: entry.createdAt,
      },
      entry.event,
    );
  }

  const settled = state.unresolved.length === 0;
  if (!running) markInterrupted(state);

  return { timeline: { items: state.items, usage }, settled, calls: new Set(state.byCall.keys()) };
}

export function buildTaskTimeline(
  events: readonly TaskTranscriptEvent[],
  running = true,
): TaskTimeline {
  return buildSegment(events, running).timeline;
}

export function latestTimelineUsage(events: readonly TaskTranscriptEvent[]): TaskTimelineUsage {
  const usage: TaskTimelineUsage = { inputTokens: null, outputTokens: null };
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index].event;
    if (event.kind !== "usage") continue;
    usage.inputTokens ??= event.inputTokens;
    usage.outputTokens ??= event.outputTokens;
    if (usage.inputTokens !== null && usage.outputTokens !== null) break;
  }
  return usage;
}

export interface TaskTimelineCache {
  rows: readonly TaskTranscriptEvent[];
  timeline: TaskTimeline;
  calls: ReadonlySet<string>;
  triedAt: number;
}

const NOTHING_SETTLED: TaskTimelineCache = {
  rows: [],
  timeline: { items: [], usage: { inputTokens: null, outputTokens: null } },
  calls: new Set(),
  triedAt: 0,
};

export const TIMELINE_LIVE_ROWS = 64;

function continuesText(before: TaskTranscriptEvent, after: TaskTranscriptEvent): boolean {
  const kind = before.event.kind;
  return (kind === "text" || kind === "reasoning") && after.event.kind === kind;
}

function startsWith(events: readonly TaskTranscriptEvent[], rows: readonly TaskTranscriptEvent[]): boolean {
  if (rows.length > events.length) return false;
  for (let index = 0; index < rows.length; index += 1) {
    if (events[index] !== rows[index]) return false;
  }
  return true;
}

function namesCall(events: readonly TaskTranscriptEvent[], calls: ReadonlySet<string>): boolean {
  if (calls.size === 0) return false;
  return events.some((row) => row.event.kind === "tool" && Boolean(row.event.callId) && calls.has(row.event.callId ?? ""));
}

function joined(head: TaskTimeline, tail: TaskTimeline): TaskTimeline {
  return {
    items: head.items.length === 0 ? tail.items : [...head.items, ...tail.items],
    usage: {
      inputTokens: tail.usage.inputTokens ?? head.usage.inputTokens,
      outputTokens: tail.usage.outputTokens ?? head.usage.outputTokens,
    },
  };
}

export function buildTaskTimelineIncremental(
  events: readonly TaskTranscriptEvent[],
  running: boolean,
  cache: TaskTimelineCache | null,
): { timeline: TaskTimeline; cache: TaskTimelineCache } {
  let settled = cache && startsWith(events, cache.rows) ? cache : NOTHING_SETTLED;
  let start = settled.rows.length;
  if (events.length - start > 2 * TIMELINE_LIVE_ROWS && events.length - settled.triedAt >= TIMELINE_LIVE_ROWS) {
    const end = events.length - TIMELINE_LIVE_ROWS;
    const rows = events.slice(start, end);
    const segment = buildSegment(rows, true);
    if (segment.settled && !continuesText(events[end - 1], events[end]) && !namesCall(rows, settled.calls)) {
      settled = {
        rows: events.slice(0, end),
        timeline: joined(settled.timeline, segment.timeline),
        calls: new Set([...settled.calls, ...segment.calls]),
        triedAt: 0,
      };
      start = end;
    } else {
      settled = { ...settled, triedAt: events.length };
    }
  }
  const rest = start === 0 ? events : events.slice(start);
  if (namesCall(rest, settled.calls)) {
    return { timeline: buildTaskTimeline(events, running), cache: { ...NOTHING_SETTLED, triedAt: events.length } };
  }
  return { timeline: joined(settled.timeline, buildSegment(rest, running).timeline), cache: settled };
}
