// Typed conversation items: a turn is an ordered list of typed items instead
// of an opaque event log. Live streams fold AgentEvents into items via
// applyAgentEvent; chats persisted in the legacy ChatMessage shape convert on
// read through chatMessagesToTurns (write stays untouched until the item
// store lands). Framework-free on purpose: no stores, no Tauri, no React.

export type ApprovalRisk = "read" | "write" | "shell" | "network";

export type AgentItem =
  | { type: "user-message"; id: string; text: string }
  | { type: "assistant-message"; id: string; text: string }
  | { type: "reasoning"; id: string; text: string; durationMs?: number }
  | { type: "tool-call"; id: string; callId: string; name: string; args?: string }
  | {
      type: "tool-result";
      id: string;
      callId: string;
      output: string;
      status: "ok" | "error";
    }
  | { type: "patch"; id: string; path?: string; diff: string }
  | { type: "error"; id: string; message: string }
  | {
      type: "approval-request";
      id: string;
      callId: string;
      name: string;
      risk: ApprovalRisk;
    }
  | {
      type: "approval-decision";
      id: string;
      callId: string;
      decision: "approved" | "rejected";
    }
  | { type: "plan"; id: string; text: string }
  | {
      type: "todo-list";
      id: string;
      todos: { id: string; content: string; status: string }[];
    }
  | { type: "source-ref"; id: string; label: string; path?: string; url?: string };

export interface Turn {
  id: string;
  items: AgentItem[];
}

/** Wire shape of the backend's streamed events (structural, so the app's
 * AgentEvent type is assignable without importing it here). */
export type StreamedAgentEvent =
  | { kind: "stepStart"; step: number }
  | { kind: "retry"; attempt: number; max: number }
  | { kind: "toolRequest"; id: string; name: string; arguments: string }
  | { kind: "toolOutcome"; id: string; output: string }
  | { kind: "textDelta"; text: string }
  | { kind: "reasoningDelta"; text: string }
  | { kind: "toolCallStart"; id: string; name: string }
  | { kind: "toolCallArgsDelta"; id: string; json: string }
  | { kind: "toolCallEnd"; id: string; arguments: string }
  | { kind: "usage"; usage: { input: number; output: number } }
  | { kind: "done"; stopReason: string | null }
  | { kind: "error"; message: string; retryable: boolean };

export function newTurn(id: string): Turn {
  return { id, items: [] };
}

let itemSeq = 0;
function nextItemId(turnId: string): string {
  itemSeq += 1;
  return `${turnId}:${itemSeq}`;
}

function last(turn: Turn): AgentItem | undefined {
  return turn.items[turn.items.length - 1];
}

function toolResultStatus(output: string): "ok" | "error" {
  return /"error"\s*:/.test(output) ? "error" : "ok";
}

/**
 * Folds one streamed event into the turn. Returns a new Turn; the incoming
 * one is not mutated (the last item is replaced, so memoized renderers of
 * earlier items keep their references).
 */
export function applyAgentEvent(turn: Turn, event: StreamedAgentEvent): Turn {
  const tail = last(turn);
  switch (event.kind) {
    case "textDelta": {
      if (tail?.type === "assistant-message") {
        const merged = { ...tail, text: tail.text + event.text };
        return { ...turn, items: [...turn.items.slice(0, -1), merged] };
      }
      return {
        ...turn,
        items: [
          ...turn.items,
          { type: "assistant-message", id: nextItemId(turn.id), text: event.text },
        ],
      };
    }
    case "reasoningDelta": {
      if (tail?.type === "reasoning") {
        const merged = { ...tail, text: tail.text + event.text };
        return { ...turn, items: [...turn.items.slice(0, -1), merged] };
      }
      return {
        ...turn,
        items: [
          ...turn.items,
          { type: "reasoning", id: nextItemId(turn.id), text: event.text },
        ],
      };
    }
    case "toolCallStart":
      return {
        ...turn,
        items: [
          ...turn.items,
          {
            type: "tool-call",
            id: nextItemId(turn.id),
            callId: event.id,
            name: event.name,
          },
        ],
      };
    case "toolCallEnd": {
      const items = turn.items.map((item) =>
        item.type === "tool-call" && item.callId === event.id
          ? { ...item, args: event.arguments }
          : item,
      );
      return { ...turn, items };
    }
    case "toolRequest": {
      const known = turn.items.some(
        (item) => item.type === "tool-call" && item.callId === event.id,
      );
      if (known) return turn;
      return {
        ...turn,
        items: [
          ...turn.items,
          {
            type: "tool-call",
            id: nextItemId(turn.id),
            callId: event.id,
            name: event.name,
            args: event.arguments,
          },
        ],
      };
    }
    case "toolOutcome":
      return {
        ...turn,
        items: [
          ...turn.items,
          {
            type: "tool-result",
            id: nextItemId(turn.id),
            callId: event.id,
            output: event.output,
            status: toolResultStatus(event.output),
          },
        ],
      };
    case "error":
      return {
        ...turn,
        items: [
          ...turn.items,
          { type: "error", id: nextItemId(turn.id), message: event.message },
        ],
      };
    default:
      return turn;
  }
}

// The legacy persisted shape (structural mirror of the app's ChatMessage).
export interface LegacyToolEntry {
  id?: string;
  name: string;
  status?: string;
  output?: string;
  approval?: "approved" | "rejected";
}

export interface LegacyReasoningBlock {
  id?: string;
  text: string;
  ms?: number;
  beforeTool: number;
}

export interface LegacyChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: LegacyToolEntry[];
  reasoning?: string;
  reasoningMs?: number;
  reasoningBlocks?: LegacyReasoningBlock[];
}

/**
 * Read-path migration: expands the legacy message shape into turns of typed
 * items, preserving the recorded reasoning/tool interleave (the same anchor
 * rule the legacy renderer used).
 */
export function chatMessagesToTurns(messages: LegacyChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;
  let turnSeq = 0;

  const openTurn = (): Turn => {
    turnSeq += 1;
    const turn = newTurn(`legacy-${turnSeq}`);
    turns.push(turn);
    return turn;
  };

  for (const message of messages) {
    if (message.role === "user") {
      current = openTurn();
      current.items.push({
        type: "user-message",
        id: nextItemId(current.id),
        text: message.content,
      });
      continue;
    }
    const turn: Turn = current ?? openTurn();
    current = turn;
    const tools = message.toolCalls ?? [];
    const blocks =
      message.reasoningBlocks ??
      (message.reasoning
        ? [{ text: message.reasoning, ms: message.reasoningMs, beforeTool: 0 }]
        : []);
    for (let anchor = 0; anchor <= tools.length; anchor++) {
      for (const block of blocks) {
        if (Math.min(block.beforeTool, tools.length) !== anchor) continue;
        turn.items.push({
          type: "reasoning",
          id: nextItemId(turn.id),
          text: block.text,
          durationMs: block.ms,
        });
      }
      if (anchor >= tools.length) continue;
      const tool = tools[anchor];
      const callId = tool.id ?? `legacy-call-${anchor}`;
      turn.items.push({
        type: "tool-call",
        id: nextItemId(turn.id),
        callId,
        name: tool.name,
      });
      if (tool.approval) {
        turn.items.push({
          type: "approval-decision",
          id: nextItemId(turn.id),
          callId,
          decision: tool.approval,
        });
      }
      if (tool.output !== undefined && tool.approval !== "rejected") {
        turn.items.push({
          type: "tool-result",
          id: nextItemId(turn.id),
          callId,
          output: tool.output,
          status: tool.status === "error" ? "error" : toolResultStatus(tool.output),
        });
      }
    }
    if (message.content) {
      turn.items.push({
        type: "assistant-message",
        id: nextItemId(turn.id),
        text: message.content,
      });
    }
  }
  return turns;
}
