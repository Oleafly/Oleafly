import { i18n } from "@/i18n";
import { acpEvents, acpSessionExport, type AcpEvent, type AcpSession } from "@/lib/acp";
import type { TurnChange } from "@/lib/agent-turns";
import { formatDateTime } from "@/lib/intl";
import { pickSavePath } from "@/lib/native-file-dialog";
import { writeBytesFile } from "@/lib/tauri";
import type { ChatMessage, ChatTurnChanges } from "@/store/chats";
import type { RenderedMessage } from "@/components/ai/MessageList";
import { createAcpProjector, projectAcpEvents } from "./projection";
import { textToBase64 } from "@/lib/base64";
import { currentName, groupControls } from "./acp-controls";

export interface ConversationExportInput {
  session: AcpSession;
  events: readonly AcpEvent[];
  /** The project's display name; the absolute folder path is never written. */
  projectName: string | null;
  agentName: string;
}

function kindLabel(change: TurnChange["change"]): string {
  if (change === "added") return i18n.t(($) => $.ai.turnChanges.kind.added);
  if (change === "deleted") return i18n.t(($) => $.ai.turnChanges.kind.deleted);
  return i18n.t(($) => $.ai.turnChanges.kind.modified);
}

function modelLabel(session: AcpSession): string {
  const { modelId, models } = session.controls;
  if (!modelId) return i18n.t(($) => $.ai.acp.export.modelManaged);
  return models.find((model) => model.modelId === modelId)?.name ?? modelId;
}

function approvalLabel(profile: string): string {
  switch (profile) {
    case "ask-for-approval":
      return i18n.t(($) => $.ai.approval.modes.askForApproval.label);
    case "approve-for-me":
      return i18n.t(($) => $.ai.approval.modes.approveForMe.label);
    case "full-access":
      return i18n.t(($) => $.ai.approval.modes.fullAccess.label);
    case "custom":
      return i18n.t(($) => $.ai.approval.modes.custom.label);
    default:
      return profile;
  }
}

function modeLabel(session: AcpSession): string | null {
  const mode = groupControls(session.controls).mode;
  if (!mode) return null;
  if (mode.kind === "config") return currentName(mode.option);
  return mode.modes.find((entry) => entry.id === mode.current)?.name ?? mode.current;
}

function header(input: ConversationExportInput): string[] {
  const { session, projectName, agentName } = input;
  const lines = [`# ${session.title.trim() || i18n.t(($) => $.ai.acp.export.untitled)}`, ""];
  const field = (label: string, value: string) => lines.push(`- ${label}: ${value}`);
  if (projectName) field(i18n.t(($) => $.ai.acp.export.project), projectName);
  field(i18n.t(($) => $.ai.acp.export.agent), [agentName, session.agentVersion].filter(Boolean).join(" "));
  field(i18n.t(($) => $.ai.acp.export.model), modelLabel(session));
  const mode = modeLabel(session);
  if (mode) field(i18n.t(($) => $.ai.acp.export.mode), mode);
  const effort = groupControls(session.controls).effort;
  const effortName = effort ? currentName(effort) : null;
  if (effortName) field(i18n.t(($) => $.ai.acp.export.effort), effortName);
  if (session.permissionProfile) {
    field(i18n.t(($) => $.ai.acp.export.permissionProfile), approvalLabel(session.permissionProfile));
  }
  if (session.startRevision) {
    const revision = session.startRevision.slice(0, 7);
    field(
      i18n.t(($) => $.ai.acp.export.startRevision),
      session.startDirty ? i18n.t(($) => $.ai.acp.export.uncommitted, { revision }) : revision,
    );
  }
  field(i18n.t(($) => $.ai.acp.export.started), formatDateTime(session.createdAt));
  field(i18n.t(($) => $.ai.acp.export.updated), formatDateTime(session.updatedAt));
  lines.push("");
  const commits = session.commits ?? [];
  if (commits.length > 0) {
    lines.push(`**${i18n.t(($) => $.ai.acp.export.commits)}**`, "");
    for (const commit of commits) {
      const subject = commit.message ? ` ${commit.message.split("\n")[0]}` : "";
      lines.push(`- ${commit.commit.slice(0, 7)}${subject}`);
    }
    lines.push("");
  }
  return lines;
}

function changedFiles(changes: ChatTurnChanges): string[] {
  if (changes.files.length + changes.moreFiles === 0) return [];
  const lines = [`**${i18n.t(($) => $.ai.acp.export.changedFiles)}**`, ""];
  for (const file of changes.files) {
    const counts = file.added !== null || file.removed !== null ? `, +${file.added ?? 0} -${file.removed ?? 0}` : "";
    lines.push(`- ${file.path} (${kindLabel(file.change)}${counts})`);
  }
  if (changes.moreFiles > 0) lines.push(`- ${i18n.t(($) => $.ai.acp.export.moreFiles, { count: changes.moreFiles })}`);
  lines.push("");
  return lines;
}

function assistantBody(message: ChatMessage): string[] {
  const lines: string[] = [];
  for (const tool of message.toolCalls ?? []) {
    lines.push(`- ${i18n.t(($) => $.ai.acp.export.tool, { name: tool.name })}`);
    for (const diff of tool.diffs ?? []) lines.push(`  - ${diff.path}`);
  }
  if (lines.length > 0) lines.push("");
  if (message.content.trim()) lines.push(message.content.trim(), "");
  return lines;
}

/** The conversation as Markdown: header, then each turn with its changed files. */
export function conversationMarkdown(input: ConversationExportInput): string {
  return markdownFromRows(input, projectAcpEvents(input.events, false));
}

function markdownFromRows(
  input: Omit<ConversationExportInput, "events">,
  rows: readonly RenderedMessage[],
): string {
  const lines = header({ ...input, events: [] });
  let speaker: "user" | "assistant" | null = null;
  for (const { msg } of rows) {
    if (msg.role === "user") {
      lines.push(`## ${i18n.t(($) => $.ai.acp.export.you)}`, "", msg.content.trim(), "");
      if (msg.skill) lines.push(`_${i18n.t(($) => $.ai.acp.export.skill, { name: msg.skill.name })}_`, "");
      speaker = "user";
    } else {
      const body = assistantBody(msg);
      if (body.length > 0 && speaker !== "assistant") {
        lines.push(`## ${input.agentName}`, "");
        speaker = "assistant";
      }
      lines.push(...body);
    }
    if (msg.turnChanges) lines.push(...changedFiles(msg.turnChanges));
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

/** Events read from the store per request; the backend serves at most this many. */
const EVENT_PAGE = 500;

/**
 * The whole conversation, projected as its events arrive a page at a time:
 * no single response carries the transcript, the projector applies only each
 * page's new events, and the window gets to paint between pages.
 */
async function projectStoredEvents(projectId: string, sessionId: string): Promise<RenderedMessage[]> {
  const project = createAcpProjector();
  let events: AcpEvent[] = [];
  let rows: RenderedMessage[] = [];
  let after = 0;
  for (;;) {
    const page = await acpEvents(projectId, sessionId, after, EVENT_PAGE);
    if (page.events.length === 0) break;
    // A new array each time: the projector tells a growing list from a changed one by its ends.
    events = [...events, ...page.events];
    rows = project(events, false);
    after = page.events[page.events.length - 1].sequence;
    if (!page.hasMore) break;
  }
  return rows;
}

function fileName(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return safe || i18n.t(($) => $.ai.acp.export.untitled);
}

/**
 * Asks where to save and writes the conversation. The format follows the
 * chosen extension: `.json` is written by the backend straight from the
 * store (large transcripts never cross into the page), anything else is
 * Markdown, built from the stored events read a page at a time. Resolves
 * false when the dialog is cancelled.
 */
export async function exportConversation({
  projectId,
  session,
  projectName,
  agentName,
}: Readonly<{ projectId: string; session: AcpSession; projectName: string | null; agentName: string }>): Promise<boolean> {
  const path = await pickSavePath({
    defaultPath: `${fileName(session.title)}.md`,
    filters: [
      { name: i18n.t(($) => $.ai.acp.export.markdown), extensions: ["md"] },
      { name: i18n.t(($) => $.ai.acp.export.json), extensions: ["json"] },
    ],
  });
  if (!path) return false;
  if (path.toLowerCase().endsWith(".json")) {
    await acpSessionExport(projectId, session.id, path);
    return true;
  }
  const rows = await projectStoredEvents(projectId, session.id);
  await writeBytesFile(path, textToBase64(markdownFromRows({ session, projectName, agentName }, rows)));
  return true;
}
