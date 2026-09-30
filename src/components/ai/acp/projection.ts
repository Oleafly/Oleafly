import type { AcpEvent } from "@/lib/acp";
import { turnChangesFrom } from "@/lib/agent-turns";
import type { ChatMessage, ToolDiff, ToolEntry } from "@/store/chats";
import type { RenderedMessage } from "@/components/ai/MessageList";
import { i18n } from "@/i18n";
import { splitAgentNotices } from "@/lib/chat-activity";
import { displayPath, displayText } from "@/lib/display-path";
import { formatBytes } from "@/lib/format-bytes";

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

// Compared after display formatting: shown error rows hold `~` paths.
function bareFailure(value: string): string {
  return displayText(value).replace(/^\s*(?:internal error|error)\s*:\s*/i, "").trim().toLowerCase();
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
    // Command and read results name files too (`pwd`, `ls`, a Read of a path).
    if (value.type === "content") return displayText(text(object(value.content).text));
    if (value.type === "terminal") return i18n.t(($) => $.ai.acp.terminalCommand);
    return "";
  }).filter(Boolean).join("\n");
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** ACP `diff` blocks, kept whole so the tool card can show a real diff. */
function toolDiffs(data: Data): ToolDiff[] | undefined {
  if (!Array.isArray(data.content)) return undefined;
  const diffs = data.content.flatMap((entry: unknown): ToolDiff[] => {
    const value = object(entry);
    if (value.type !== "diff" || !text(value.path)) return [];
    const truncated = value.truncated === true;
    // The card shows the path, so a file outside the project reads `~/…`.
    return [{
      path: displayPath(text(value.path)),
      oldText: truncated ? null : optionalText(value.oldText),
      newText: truncated ? null : optionalText(value.newText),
      truncated,
    }];
  });
  return diffs.length > 0 ? diffs : undefined;
}

function chunkText(content: Data): string {
  if (content.type === "text") return text(content.text);
  if (content.type === "image") return i18n.t(($) => $.ai.acp.agentImage);
  return "";
}

function toolStatus(status: unknown, previous: ToolEntry["status"] | undefined): ToolEntry["status"] {
  if (status === "completed") return "done";
  if (status === "failed") return "error";
  if (status === "in_progress" || status === "pending") return "running";
  return previous ?? "running";
}

interface ProjectionState {
  rows: Row[];
  tools: Map<string, number>;
  lastKind: string;
}

const TERMINAL_STATUSES = new Set(["failed", "disconnected", "cancelled"]);

function rowId(event: AcpEvent): string {
  return `${event.sessionId}:${event.sequence}`;
}

function appendRow(
  state: ProjectionState,
  event: AcpEvent,
  kind: string,
  msg: ChatMessage,
  raw?: string,
) {
  const id = rowId(event);
  state.rows.push({ id, turn: event.turnId, kind, msg: { id, createdAt: event.timestamp, ...msg }, raw });
}

function imageAttachments(images: unknown) {
  if (!Array.isArray(images)) return undefined;
  return images.map((image: unknown, index) => ({
    name: i18n.t(($) => $.ai.acp.imageAttachmentName, { index: index + 1 }),
    mediaType: text(object(image).mimeType),
  }));
}

function mergeChunk(previous: Row, chunk: string, reasoning: boolean) {
  const block = previous.msg.reasoningBlocks?.[0];
  if (reasoning && block) {
    previous.msg = { ...previous.msg, reasoningBlocks: [{ ...block, text: block.text + chunk }] };
    return;
  }
  previous.raw = `${previous.raw ?? previous.msg.content}${chunk}`;
  previous.msg = noticed(previous.msg, previous.raw);
}

function applyChunk(state: ProjectionState, event: AcpEvent): boolean {
  const chunk = chunkText(object(event.data.content));
  if (!chunk) return false;
  const previous = state.rows.at(-1);
  const reasoning = event.kind === "agent_thought_chunk";
  if (previous?.kind === event.kind && previous.turn === event.turnId && state.lastKind === event.kind) {
    mergeChunk(previous, chunk, reasoning);
  } else if (reasoning) {
    appendRow(state, event, event.kind, {
      role: "assistant",
      content: "",
      reasoningBlocks: [{ id: rowId(event), text: chunk, beforeTool: 0 }],
    });
  } else {
    appendRow(state, event, event.kind, noticed({ role: "assistant", content: chunk }, chunk), chunk);
  }
  return true;
}

function applyToolCall(state: ProjectionState, event: AcpEvent): boolean {
  const data = event.data;
  const toolId = text(data.toolCallId);
  if (!toolId) return false;
  const key = `${event.turnId}:${toolId}`;
  const index = state.tools.get(key);
  const previous = index === undefined ? undefined : state.rows[index].msg.toolCalls?.[0];
  const tool: ToolEntry = {
    id: toolId,
    // Agents title tool calls with absolute paths ("Read /Users/…/main.tex").
    name: displayText(text(data.title)) || previous?.name || i18n.t(($) => $.ai.acp.agentToolFallback),
    status: toolStatus(data.status, previous?.status),
    output: data.content ? toolOutput(data) : previous?.output,
    diffs: data.content ? toolDiffs(data) : previous?.diffs,
  };
  if (!tool.diffs) delete tool.diffs;
  if (index === undefined) {
    state.tools.set(key, state.rows.length);
    appendRow(state, event, "tool", { role: "assistant", content: "", toolCalls: [tool] });
  } else {
    state.rows[index].msg = { ...state.rows[index].msg, toolCalls: [tool] };
  }
  return true;
}

function planContent(entries: readonly unknown[]): string {
  return entries
    .map((entry: unknown) => {
      const value = object(entry);
      return `- ${value.status === "completed" ? "[x]" : "[ ]"} ${text(value.content)}`;
    })
    .join("\n");
}

/** Adds the row a diagnostics event explains itself with; false when it shows nothing. */
function applyDiagnostics(state: ProjectionState, event: AcpEvent): boolean {
  const detail = displayText(text(event.data.stderr));
  if (detail) {
    appendRow(
      state,
      event,
      "error",
      noticed({ role: "assistant", content: "" }, detail, (value) =>
        i18n.t(($) => $.ai.acp.agentReported, { detail: value }),
      ),
    );
    return true;
  }
  // The runtime skipped an update over 1 MiB (a whole-file diff, say).
  const dropped = object(event.data.droppedUpdate).bytes;
  if (typeof dropped === "number" && Number.isFinite(dropped) && dropped > 0) {
    appendRow(state, event, "notice", {
      role: "assistant",
      content: "",
      notices: [i18n.t(($) => $.ai.acp.updateTooLarge, { size: formatBytes(dropped) })],
    });
    return true;
  }
  return false;
}

function failRunningTools(row: Row) {
  if (row.msg.toolCalls?.some((tool) => tool.status === "running")) {
    row.msg = {
      ...row.msg,
      toolCalls: row.msg.toolCalls.map((tool) => (tool.status === "running" ? { ...tool, status: "error" } : tool)),
    };
  }
}

function closeTurn(state: ProjectionState, turnId: string | null) {
  for (const row of state.rows) {
    if (turnId && row.turn !== turnId) continue;
    if (row.msg.reasoningBlocks?.some((block) => block.ms === undefined)) {
      row.msg = {
        ...row.msg,
        reasoningBlocks: row.msg.reasoningBlocks.map((block) => ({ ...block, ms: block.ms ?? 0 })),
      };
    }
    failRunningTools(row);
  }
}

function applyTurnEnd(state: ProjectionState, event: AcpEvent) {
  const data = event.data;
  const terminal = event.kind === "turn_complete" || TERMINAL_STATUSES.has(text(data.status));
  if (!terminal) return;
  closeTurn(state, event.turnId);
  if (data.error && !alreadySaid(state.rows, event.turnId, text(data.error))) {
    appendRow(state, event, "error", noticed({ role: "assistant", content: "" }, displayText(text(data.error))));
  }
}

function userSkill(value: unknown): ChatMessage["skill"] {
  const skill = object(value);
  const id = text(skill.id);
  return id ? { id, name: text(skill.name) || id } : undefined;
}

/**
 * Hangs a turn's file changes on the last assistant row of that turn (or the
 * turn's last row when the agent said nothing). Never adds a row.
 */
function applyTurnChanges(state: ProjectionState, event: AcpEvent) {
  const turnChanges = turnChangesFrom(event.data);
  const turn = text(event.data.turnId) || event.turnId;
  if (!turnChanges) return;
  let target = -1;
  for (let index = state.rows.length - 1; index >= 0; index--) {
    const row = state.rows[index];
    if (row.turn !== turn) continue;
    if (target < 0) target = index;
    if (row.msg.role === "assistant") {
      target = index;
      break;
    }
  }
  if (target < 0) return;
  state.rows[target].msg = { ...state.rows[target].msg, turnChanges };
}

function applyEvent(state: ProjectionState, event: AcpEvent): boolean {
  const data = event.data;
  if (event.kind === "user_message") {
    const skill = userSkill(data.skill);
    appendRow(state, event, "user", {
      role: "user",
      content: text(data.text),
      attachments: imageAttachments(data.images),
      ...(skill ? { skill } : {}),
    });
    return true;
  }
  if (event.kind === "turn_changes") {
    applyTurnChanges(state, event);
    return false;
  }
  if (event.kind === "agent_message_chunk" || event.kind === "agent_thought_chunk") {
    return applyChunk(state, event);
  }
  if (event.kind === "tool_call" || event.kind === "tool_call_update") {
    return applyToolCall(state, event);
  }
  if (event.kind === "plan" && Array.isArray(data.entries)) {
    appendRow(state, event, "plan", { role: "assistant", content: planContent(data.entries) });
    return true;
  }
  if (event.kind === "diagnostics") return applyDiagnostics(state, event);
  if (event.kind === "turn_complete" || event.kind === "status") applyTurnEnd(state, event);
  return true;
}

function latestAssistantIndex(rows: readonly Row[]): number {
  for (let index = rows.length - 1; index >= 0; index--) {
    if (rows[index].msg.role === "assistant") return index;
  }
  return -1;
}

function renderRows(
  rows: readonly Row[],
  running: boolean,
  previousRendered: readonly RenderedMessage[],
): RenderedMessage[] {
  const latest = latestAssistantIndex(rows);
  return rows.map((row, index) => {
    const live = running && index === rows.length - 1;
    const isLatestAssistant = index === latest;
    const previous = previousRendered[index];
    return previous?.msg === row.msg && previous.live === live && previous.isLatestAssistant === isLatestAssistant
      ? previous
      : { key: row.id, index, live, isLatestAssistant, msg: row.msg };
  });
}

function isAppendOnly(previousEvents: readonly AcpEvent[], events: readonly AcpEvent[]): boolean {
  if (previousEvents.length > events.length) return false;
  if (!previousEvents.length) return true;
  return previousEvents[0] === events[0] && previousEvents.at(-1) === events[previousEvents.length - 1];
}

export function createAcpProjector() {
  let previousEvents: readonly AcpEvent[] = [];
  let rendered: RenderedMessage[] = [];
  const state: ProjectionState = { rows: [], tools: new Map(), lastKind: "" };
  return (events: readonly AcpEvent[], running: boolean): RenderedMessage[] => {
    const appendOnly = isAppendOnly(previousEvents, events);
    const from = appendOnly ? previousEvents.length : 0;
    if (!appendOnly) {
      state.rows = [];
      state.tools = new Map();
      state.lastKind = "";
      rendered = [];
    }
    for (let position = from; position < events.length; position++) {
      const event = events[position];
      if (applyEvent(state, event)) state.lastKind = event.kind;
    }
    if (!running) {
      for (const row of state.rows) failRunningTools(row);
    }
    previousEvents = events;
    rendered = renderRows(state.rows, running, rendered);
    return rendered;
  };
}

export function projectAcpEvents(events: readonly AcpEvent[], running: boolean): RenderedMessage[] {
  return createAcpProjector()(events, running);
}
