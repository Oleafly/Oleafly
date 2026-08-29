// The typed thread-item record, mirroring src-tauri's
// crates/oleafly-agent/src/items.rs one-for-one: the store union (exact wire
// tags), the recorded-item envelope, the persisted turn record, and the fold
// that turns an AgentEvent stream into items. Framework-free on purpose: no
// stores, no Tauri, no React.

import type { AgentEvent } from "./agent-events";

export type PlanTodo = { step: string; status: string };

export type ExecutionStatus = "inProgress" | "completed" | "failed" | "declined";

export type StoreItem =
  | { type: "hookPrompt"; prompt: string }
  | { type: "agentMessage"; text: string }
  | { type: "plan"; text: string }
  | { type: "reasoning"; summary: string[]; content: string[] }
  | {
      type: "commandExecution";
      command: string[];
      cwd: string;
      aggregatedOutput: string;
      exitCode: number | null;
      status: ExecutionStatus;
    }
  | { type: "fileChange"; changes: unknown; status: ExecutionStatus }
  | {
      type: "mcpToolCall";
      server: string;
      tool: string;
      arguments: unknown;
      result: unknown;
      status: ExecutionStatus;
    }
  | {
      type: "dynamicToolCall";
      namespace: string;
      tool: string;
      arguments: unknown;
      output: string | null;
      status: ExecutionStatus;
    }
  | { type: "collabAgentToolCall"; tool: string; arguments: unknown; result: unknown }
  | {
      type: "subAgentActivity";
      agentId: string;
      label: string;
      kind: string;
      detail: string | null;
    }
  | { type: "todo-list"; explanation: string | null; todos: PlanTodo[] }
  | { type: "planImplementation"; planContent: string; completed: boolean }
  | {
      type: "error";
      message: string;
      willRetry: boolean;
      errorInfo: string | null;
    }
  | {
      type: "automaticApprovalReview";
      targetItemId: string;
      action: string;
      riskLevel: string;
      rationale: string | null;
    }
  | { type: "strictReviewNotice" }
  | { type: "remoteTaskCreated"; taskId: string }
  | { type: "personalityChanged"; personality: string }
  | {
      type: "forkedFromConversation";
      sourceConversationId: string;
      sourceConversationTitle: string | null;
    }
  | { type: "modelChanged"; fromModel: string; toModel: string }
  | { type: "modelRerouted"; fromModel: string; toModel: string }
  | { type: "autoReviewInterruptionWarning" }
  | { type: "userInputResponse"; requestId: string; answers: unknown }
  | {
      type: "mcpServerElicitation";
      requestId: string;
      serverName: string;
      elicitation: unknown;
      completed: boolean;
    }
  | {
      type: "permissionRequest";
      requestId: string;
      permissions: unknown;
      response: string | null;
    }
  | { type: "webSearch"; query: string; completed: boolean }
  | { type: "contextCompaction"; droppedMessages: number; reason: string }
  | { type: "worktreeInit"; outcome: string }
  | { type: "userMessage"; text: string }
  | { type: "steeringUserMessage"; text: string; status: string }
  | { type: "steered" }
  | { type: "imageGeneration"; status: string; path: string | null }
  | { type: "imageView"; imagePaths: string[] }
  | { type: "enteredReviewMode" }
  | { type: "exitedReviewMode" }
  | { type: "sleep"; durationMs: number };

/** An item with its identity and lifecycle stamp. */
export type RecordedStoreItem = {
  id: string;
  item: StoreItem;
  completed: boolean;
};

export type TurnRecordStatus = "inProgress" | "completed" | "failed" | "interrupted";

/** One turn as persisted: the items it produced plus bookkeeping. */
export type TurnRecord = {
  turnId: string;
  clientTurnId: string | null;
  status: TurnRecordStatus;
  items: RecordedStoreItem[];
  usage: { input: number; output: number };
  error: string | null;
  stoppedAtCap: boolean;
};

export function newTurnRecord(turnId: string, clientTurnId?: string): TurnRecord {
  return {
    turnId,
    clientTurnId: clientTurnId ?? null,
    status: "inProgress",
    items: [],
    usage: { input: 0, output: 0 },
    error: null,
    stoppedAtCap: false,
  };
}

/** Classify a tool name into its store item (mirrors the Rust classify_tool). */
export function classifyTool(name: string): StoreItem {
  if (name === "run_command" || name === "exec_command" || name === "shell_command") {
    return {
      type: "commandExecution",
      command: [],
      cwd: "",
      aggregatedOutput: "",
      exitCode: null,
      status: "inProgress",
    };
  }
  const fileTools = [
    "write_file",
    "replace_in_file",
    "create_file",
    "rename_file",
    "delete_file",
  ];
  if (fileTools.includes(name)) {
    return { type: "fileChange", changes: null, status: "inProgress" };
  }
  return {
    type: "dynamicToolCall",
    namespace: "oleafly",
    tool: name,
    arguments: null,
    output: null,
    status: "inProgress",
  };
}

function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/** Finalize a tool item's arguments from the call's JSON argument string. */
function applyArguments(item: StoreItem, raw: string): void {
  const parsed = parseArguments(raw);
  if (item.type === "commandExecution") {
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.command === "string") item.command = [record.command];
      if (typeof record.cwd === "string") item.cwd = record.cwd;
    }
    return;
  }
  if (item.type === "fileChange") {
    item.changes = parsed;
    return;
  }
  if (item.type === "dynamicToolCall" || item.type === "mcpToolCall") {
    item.arguments = parsed;
  }
}

/**
 * Folds one run's event stream into a persisted turn record — the shell
 * counterpart of the Rust TurnRecorder. One instance per run: the open
 * tool-call map is instance state, never shared.
 */
export class TurnFold {
  private readonly record: TurnRecord;
  private readonly openCalls = new Map<string, number>();

  constructor(turnId: string, clientTurnId?: string) {
    this.record = newTurnRecord(turnId, clientTurnId);
  }

  /** Open the record with the optimistic user message (before any request). */
  pushUserMessage(text: string): this {
    this.record.items.push({
      id: `${this.record.turnId}:${this.record.items.length}`,
      item: { type: "userMessage", text },
      completed: true,
    });
    return this;
  }

  apply(event: AgentEvent): this {
    const record = this.record;
    const push = (item: StoreItem, completed: boolean): number => {
      record.items.push({
        id: `${record.turnId}:${record.items.length}`,
        item,
        completed,
      });
      return record.items.length - 1;
    };

    switch (event.kind) {
      case "textDelta": {
        const last = record.items[record.items.length - 1];
        if (last && !last.completed && last.item.type === "agentMessage") {
          last.item.text += event.text;
        } else {
          push({ type: "agentMessage", text: event.text }, false);
        }
        break;
      }
      case "reasoningDelta": {
        const last = record.items[record.items.length - 1];
        if (last && !last.completed && last.item.type === "reasoning") {
          if (last.item.content.length > 0) {
            last.item.content[last.item.content.length - 1] += event.text;
          } else {
            last.item.content.push(event.text);
          }
        } else {
          push({ type: "reasoning", summary: [], content: [event.text] }, false);
        }
        break;
      }
      case "toolCallStart": {
        this.openCalls.set(event.id, push(classifyTool(event.name), false));
        break;
      }
      case "toolCallEnd": {
        const index = this.openCalls.get(event.id);
        if (index !== undefined) {
          applyArguments(record.items[index].item, event.arguments);
        }
        break;
      }
      case "toolRequest": {
        if (!this.openCalls.has(event.id)) {
          const index = push(classifyTool(event.name), false);
          this.openCalls.set(event.id, index);
          applyArguments(record.items[index].item, event.arguments);
        }
        break;
      }
      case "toolOutcome": {
        const index = this.openCalls.get(event.id);
        if (index !== undefined) {
          this.openCalls.delete(event.id);
          const recorded = record.items[index];
          recorded.completed = true;
          const ok = !event.output.includes('"error"');
          const item = recorded.item;
          if (item.type === "commandExecution") {
            item.aggregatedOutput += event.output;
            item.exitCode = ok ? 0 : 1;
            item.status = ok ? "completed" : "failed";
          } else if (item.type === "fileChange" || item.type === "mcpToolCall") {
            item.status = ok ? "completed" : "failed";
          } else if (item.type === "dynamicToolCall") {
            item.output = event.output;
            item.status = ok ? "completed" : "failed";
          }
        }
        break;
      }
      case "subagentUpdate": {
        push(
          {
            type: "subAgentActivity",
            agentId: event.id,
            label: event.label,
            kind: event.state,
            detail: event.detail,
          },
          event.state === "done" || event.state === "error",
        );
        break;
      }
      case "compacted": {
        push(
          {
            type: "contextCompaction",
            droppedMessages: event.droppedMessages,
            reason: event.reason,
          },
          true,
        );
        break;
      }
      case "usage": {
        record.usage = event.usage;
        break;
      }
      case "retry": {
        push(
          {
            type: "error",
            message: `Reconnecting ${event.attempt}/${event.max}`,
            willRetry: true,
            errorInfo: null,
          },
          false,
        );
        break;
      }
      case "error": {
        record.status = "failed";
        record.error = event.message;
        push(
          {
            type: "error",
            message: event.message,
            willRetry: event.retryable,
            errorInfo: null,
          },
          true,
        );
        break;
      }
      case "done": {
        // The model stream ended: complete the most recent message still
        // open, wherever it sits (text can precede tool calls).
        for (let i = record.items.length - 1; i >= 0; i -= 1) {
          const recorded = record.items[i];
          if (recorded.item.type === "agentMessage") {
            recorded.completed = true;
            break;
          }
        }
        break;
      }
      case "steered": {
        push({ type: "steered" }, true);
        push({ type: "userMessage", text: event.text }, true);
        break;
      }
      default:
        break;
    }
    return this;
  }

  finish(stoppedAtCap = false): TurnRecord {
    if (this.record.status === "inProgress") {
      this.record.status = "completed";
    }
    this.record.stoppedAtCap = stoppedAtCap;
    for (const recorded of this.record.items) {
      recorded.completed = true;
    }
    return this.snapshot();
  }

  markInterrupted(): TurnRecord {
    this.record.status = "interrupted";
    for (const recorded of this.record.items) {
      recorded.completed = true;
    }
    return this.snapshot();
  }

  snapshot(): TurnRecord {
    return this.record;
  }
}
