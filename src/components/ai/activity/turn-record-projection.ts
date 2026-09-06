import type { ExecutionStatus, RecordedStoreItem, TurnRecord } from "@oleafly/ai-core";
import type { ChatMessage, SubagentEntry, ToolEntry } from "@/store/chats";
import type { RenderedMessage } from "@/components/ai/MessageList";

function toolStatus(status: ExecutionStatus): ToolEntry["status"] {
  if (status === "inProgress") return "running";
  if (status === "completed") return "done";
  return "error";
}

function serialized(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

function toolEntry(recorded: RecordedStoreItem): ToolEntry | null {
  const item = recorded.item;
  switch (item.type) {
    case "commandExecution":
      return {
        id: recorded.id,
        name: "run_command",
        status: toolStatus(item.status),
        output: JSON.stringify({
          command: item.command.join(" "),
          output: item.aggregatedOutput,
          exit_code: item.exitCode,
        }),
      };
    case "fileChange":
      return {
        id: recorded.id,
        name: "write_file",
        status: toolStatus(item.status),
        output: serialized(item.changes),
      };
    case "dynamicToolCall":
      return {
        id: recorded.id,
        name: item.tool,
        status: toolStatus(item.status),
        output: item.output ?? "",
      };
    case "mcpToolCall":
      return {
        id: recorded.id,
        name: `mcp__${item.server}__${item.tool}`,
        status: toolStatus(item.status),
        output: serialized(item.result),
      };
    default:
      return null;
  }
}

interface TurnRows {
  rows: ChatMessage[];
  assistant: ChatMessage | null;
}

function assistantRow(turn: TurnRecord, state: TurnRows): ChatMessage {
  if (state.assistant) return state.assistant;
  const row: ChatMessage = { id: `${turn.turnId}:assistant`, role: "assistant", content: "" };
  state.assistant = row;
  state.rows.push(row);
  return row;
}

function appendText(row: ChatMessage, text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  row.content = row.content ? `${row.content}\n\n${trimmed}` : trimmed;
}

function projectTurn(turn: TurnRecord): ChatMessage[] {
  const state: TurnRows = { rows: [], assistant: null };
  for (const recorded of turn.items) {
    const item = recorded.item;
    if (item.type === "userMessage" || item.type === "steeringUserMessage") {
      state.rows.push({ id: recorded.id, role: "user", content: item.text });
      state.assistant = null;
      continue;
    }
    if (item.type === "agentMessage" || item.type === "plan") {
      appendText(assistantRow(turn, state), item.text);
      continue;
    }
    if (item.type === "reasoning") {
      const row = assistantRow(turn, state);
      const text = [...item.summary, ...item.content].join("\n").trim();
      if (!text) continue;
      row.reasoningBlocks = [
        ...(row.reasoningBlocks ?? []),
        { id: recorded.id, text, ms: 0, beforeTool: row.toolCalls?.length ?? 0 },
      ];
      continue;
    }
    if (item.type === "subAgentActivity") {
      const row = assistantRow(turn, state);
      const entry: SubagentEntry = {
        id: item.agentId,
        label: item.label,
        state: item.kind,
        detail: item.detail ?? undefined,
        runtime: item.runtime ?? undefined,
        sessionId: item.sessionId ?? undefined,
        providerId: item.providerId ?? undefined,
        modelId: item.modelId ?? undefined,
        agentId: item.runtimeAgentId ?? undefined,
      };
      const list = row.subagents ?? [];
      const index = list.findIndex((existing) => existing.id === entry.id);
      row.subagents = index >= 0 ? list.map((existing, at) => (at === index ? entry : existing)) : [...list, entry];
      continue;
    }
    if (item.type === "error") {
      state.rows.push({ id: recorded.id, role: "assistant", content: item.message });
      state.assistant = null;
      continue;
    }
    const tool = toolEntry(recorded);
    if (tool) {
      const row = assistantRow(turn, state);
      row.toolCalls = [...(row.toolCalls ?? []), tool];
    }
  }
  if (turn.error && !state.rows.some((row) => row.role === "assistant" && row.content === turn.error)) {
    state.rows.push({ id: `${turn.turnId}:error`, role: "assistant", content: turn.error });
  }
  return state.rows;
}

export function projectTurnRecords(turns: readonly TurnRecord[]): RenderedMessage[] {
  const messages = turns.flatMap(projectTurn);
  let latest = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "assistant") {
      latest = index;
      break;
    }
  }
  return messages.map((msg, index) => ({
    key: msg.id ?? `${index}`,
    index,
    live: false,
    isLatestAssistant: index === latest,
    msg,
  }));
}
