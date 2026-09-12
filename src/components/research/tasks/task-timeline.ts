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

export function buildTaskTimeline(
  events: readonly TaskTranscriptEvent[],
  running = true,
): TaskTimeline {
  const merged = coalesceTranscriptEvents(events);
  const items: TaskTimelineItem[] = [];
  const byCall = new Map<string, TaskTimelineTool>();
  const usage: TaskTimelineUsage = { inputTokens: null, outputTokens: null };
  const unresolved: string[] = [];

  const resolve = (id: string) => {
    const position = unresolved.indexOf(id);
    if (position >= 0) unresolved.splice(position, 1);
  };

  for (const entry of merged) {
    const base = {
      key: `${entry.executionGeneration}:${entry.sequence}`,
      sequence: entry.sequence,
      createdAt: entry.createdAt,
    };
    const event = entry.event;
    switch (event.kind) {
      case "sessionBound":
        items.push({
          ...base,
          kind: "milestone",
          text: i18n.t(($) => $.researchTools.tasks.timeline.sessionConnected),
        });
        break;
      case "status":
        items.push({ ...base, kind: "milestone", text: event.message });
        break;
      case "text":
        if (event.text.trim()) items.push({ ...base, kind: "message", text: event.text });
        break;
      case "reasoning":
        if (event.text.trim()) items.push({ ...base, kind: "reasoning", text: event.text });
        break;
      case "artifact":
        items.push({ ...base, kind: "artifact", artifact: event.artifact });
        break;
      case "usage":
        if (event.inputTokens !== null) usage.inputTokens = event.inputTokens;
        if (event.outputTokens !== null) usage.outputTokens = event.outputTokens;
        break;
      case "tool": {
        const name = event.name.trim();
        const matched = name && unresolved.includes(name) ? name : null;
        const phase = toolPhase(event, name, matched);
        const resolved =
          event.callId ??
          (phase === "request" ? base.key : (matched ?? unresolved[0] ?? base.key));
        const status = toolStatus(event.status) ?? (phase === "result" ? "done" : undefined);
        const existing = byCall.get(resolved);
        if (!existing) {
          const tool: TaskTimelineTool = {
            id: resolved,
            name: phase === "request" && !looksLikeCallId(name) ? name : toolFallbackName(),
            status: status ?? (phase === "request" ? "running" : "done"),
          };
          if (phase === "request" || (phase === "update" && tool.status === "running")) {
            if (event.detail) tool.input = event.detail;
            if (tool.status !== "running") tool.output = event.detail;
          } else {
            tool.output = event.detail;
          }
          byCall.set(resolved, tool);
          items.push({ ...base, kind: "tool", tool });
          if (tool.status === "running") unresolved.push(resolved);
          break;
        }
        if (phase === "request") {
          if (name && !looksLikeCallId(name)) existing.name = name;
          existing.input = event.detail;
        } else if (phase === "update" && (status === undefined || status === "running")) {
          if (name && !looksLikeCallId(name)) existing.name = name;
          if (event.detail) existing.input = event.detail;
        } else {
          if (name && !looksLikeCallId(name) && existing.name === toolFallbackName()) existing.name = name;
          existing.output = event.detail;
        }
        if (status) existing.status = status;
        if (existing.status !== "running") resolve(resolved);
        break;
      }
    }
  }

  if (!running) {
    for (const id of unresolved) {
      const tool = byCall.get(id);
      if (tool?.status === "running") tool.interrupted = true;
    }
  }

  return { items, usage };
}
