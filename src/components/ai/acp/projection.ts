import type { AcpEvent } from "@/lib/acp";
import type { ChatMessage, ToolEntry } from "@/store/chats";
import type { RenderedMessage } from "@/components/ai/MessageList";
import { i18n } from "@/i18n";
import { splitAgentNotices } from "@/lib/chat-activity";

type Data = Record<string, unknown>;
type Row = { id: string; turn: string | null; kind: string; msg: ChatMessage; raw?: string };
function object(value: unknown): Data { return value && typeof value === "object" ? value as Data : {}; }
function text(value: unknown): string { return typeof value === "string" ? value : ""; }

function noticed(
  message: ChatMessage,
  raw: string,
  label: (detail: string) => string = (detail) => detail,
): ChatMessage {
  const split = splitAgentNotices(raw);
  if (split.notices.length === 0) return { ...message, content: label(raw) };
  return {
    ...message,
    content: split.text ? label(split.text) : "",
    notices: split.notices,
  };
}

function bareFailure(value: string): string {
  return value.replace(/^\s*(?:internal error|error)\s*:\s*/i, "").trim().toLowerCase();
}

function alreadySaid(rows: readonly Row[], turn: string | null, failure: string): boolean {
  const bare = bareFailure(failure);
  if (!bare) return false;
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index];
    if (row.turn !== turn || row.msg.role !== "assistant") continue;
    if (bareFailure(row.raw ?? row.msg.content) === bare) return true;
    if (row.kind === "agent_message_chunk" || row.kind === "error") return false;
  }
  return false;
}

function toolOutput(data: Data): string {
  if (!Array.isArray(data.content)) return "";
  return data.content.map((entry: unknown) => {
    const value = object(entry);
    if (value.type === "content") return text(object(value.content).text);
    if (value.type === "diff") return `${text(value.path)}\n${text(value.oldText)}\n→\n${text(value.newText)}`;
    if (value.type === "terminal") return i18n.t(($) => $.ai.acp.terminalCommand);
    return "";
  }).filter(Boolean).join("\n");
}

export function createAcpProjector() {
  let previousEvents: readonly AcpEvent[] = [];
  let rows: Row[] = [];
  let rendered: RenderedMessage[] = [];
  let tools = new Map<string, number>();
  let lastKind = "";
  return (events: readonly AcpEvent[], running: boolean): RenderedMessage[] => {
    const appendOnly = previousEvents.length <= events.length && (!previousEvents.length || (previousEvents[0] === events[0] && previousEvents.at(-1) === events[previousEvents.length - 1]));
    const from = appendOnly ? previousEvents.length : 0;
    if (!appendOnly) { rows = []; tools = new Map(); lastKind = ""; rendered = []; }
    for (let position = from; position < events.length; position++) {
      const event = events[position];
      const data = event.data;
      const id = `${event.sessionId}:${event.sequence}`;
      const append = (kind: string, msg: ChatMessage, raw?: string) => { rows.push({ id, turn: event.turnId, kind, msg: { id, createdAt: event.timestamp, ...msg }, raw }); };
      if (event.kind === "user_message") {
        append("user", { role: "user", content: text(data.text), attachments: Array.isArray(data.images) ? data.images.map((image: unknown, index) => ({ name: i18n.t(($) => $.ai.acp.imageAttachmentName, { index: index + 1 }), mediaType: text(object(image).mimeType) })) : undefined });
      } else if (event.kind === "agent_message_chunk" || event.kind === "agent_thought_chunk") {
        const content = object(data.content);
        const chunk = content.type === "text" ? text(content.text) : content.type === "image" ? i18n.t(($) => $.ai.acp.agentImage) : "";
        if (!chunk) continue;
        const previous = rows.at(-1);
        const reasoning = event.kind === "agent_thought_chunk";
        if (previous?.kind === event.kind && previous.turn === event.turnId && lastKind === event.kind) {
          const block = previous.msg.reasoningBlocks?.[0];
          if (reasoning && block) {
            previous.msg = { ...previous.msg, reasoningBlocks: [{ ...block, text: block.text + chunk }] };
          } else {
            previous.raw = `${previous.raw ?? previous.msg.content}${chunk}`;
            previous.msg = noticed(previous.msg, previous.raw);
          }
        } else if (reasoning) {
          append(event.kind, { role: "assistant", content: "", reasoningBlocks: [{ id, text: chunk, beforeTool: 0 }] });
        } else {
          append(event.kind, noticed({ role: "assistant", content: chunk }, chunk), chunk);
        }
      } else if (event.kind === "tool_call" || event.kind === "tool_call_update") {
        const toolId = text(data.toolCallId);
        if (!toolId) continue;
        const key = `${event.turnId}:${toolId}`;
        const index = tools.get(key);
        const previous = index === undefined ? undefined : rows[index].msg.toolCalls?.[0];
        const status = data.status === "completed" ? "done" : data.status === "failed" ? "error" : data.status === "in_progress" || data.status === "pending" ? "running" : previous?.status ?? "running";
        const tool: ToolEntry = { id: toolId, name: text(data.title) || previous?.name || i18n.t(($) => $.ai.acp.agentToolFallback), status, output: data.content ? toolOutput(data) : previous?.output };
        if (index === undefined) { tools.set(key, rows.length); append("tool", { role: "assistant", content: "", toolCalls: [tool] }); }
        else rows[index].msg = { ...rows[index].msg, toolCalls: [tool] };
      } else if (event.kind === "plan" && Array.isArray(data.entries)) {
        append("plan", { role: "assistant", content: data.entries.map((entry: unknown) => { const value = object(entry); return `- ${value.status === "completed" ? "[x]" : "[ ]"} ${text(value.content)}`; }).join("\n") });
      } else if (event.kind === "diagnostics") {
        const detail = text(data.stderr);
        if (detail) append("error", noticed({ role: "assistant", content: "" }, detail, (value) =>
          i18n.t(($) => $.ai.acp.agentReported, { detail: value }),
        ));
      } else if (event.kind === "turn_complete" || event.kind === "status") {
        const terminal = event.kind === "turn_complete" || ["failed", "disconnected", "cancelled"].includes(text(data.status));
        if (terminal) {
          for (const row of rows) {
            if (event.turnId && row.turn !== event.turnId) continue;
            if (row.msg.reasoningBlocks?.some((block) => block.ms === undefined)) row.msg = { ...row.msg, reasoningBlocks: row.msg.reasoningBlocks.map((block) => ({ ...block, ms: block.ms ?? 0 })) };
            if (row.msg.toolCalls?.some((tool) => tool.status === "running")) row.msg = { ...row.msg, toolCalls: row.msg.toolCalls.map((tool) => tool.status === "running" ? { ...tool, status: "error" } : tool) };
          }
          if (data.error && !alreadySaid(rows, event.turnId, text(data.error))) append("error", noticed({ role: "assistant", content: "" }, text(data.error)));
        }
      }
      lastKind = event.kind;
    }
    if (!running) {
      for (const row of rows) {
        if (row.msg.toolCalls?.some((tool) => tool.status === "running")) row.msg = { ...row.msg, toolCalls: row.msg.toolCalls.map((tool) => tool.status === "running" ? { ...tool, status: "error" } : tool) };
      }
    }
    previousEvents = events;
    let latest = -1;
    for (let index = rows.length - 1; index >= 0; index--) if (rows[index].msg.role === "assistant") { latest = index; break; }
    rendered = rows.map((row, index) => {
      const live = running && index === rows.length - 1;
      const isLatestAssistant = index === latest;
      const previous = rendered[index];
      return previous?.msg === row.msg && previous.live === live && previous.isLatestAssistant === isLatestAssistant ? previous : { key: row.id, index, live, isLatestAssistant, msg: row.msg };
    });
    return rendered;
  };
}

export function projectAcpEvents(events: readonly AcpEvent[], running: boolean): RenderedMessage[] {
  return createAcpProjector()(events, running);
}
