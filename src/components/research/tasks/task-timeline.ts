import { coalesceTranscriptEvents } from "@/lib/chat-activity";
import { i18n } from "@/i18n";
import type {
  TaskArtifact,
  TaskToolEvent,
  TaskToolPhase,
  TaskTranscriptEvent,
} from "@/lib/research-tasks";
import type { ToolEntry } from "@/store/chats";

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

function appendEntry(
  state: TimelineState,
  usage: TaskTimelineUsage,
  base: TimelineBase,
  event: TaskTranscriptEvent["event"],
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
  }
}

function markInterrupted(state: TimelineState) {
  for (const id of state.unresolved) {
    const tool = state.byCall.get(id);
    if (tool?.status === "running") tool.interrupted = true;
  }
}

export function buildTaskTimeline(
  events: readonly TaskTranscriptEvent[],
  running = true,
): TaskTimeline {
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

  if (!running) markInterrupted(state);

  return { items: state.items, usage };
}
