// Exporting a built-in chat as Markdown, for chats too long to save and
// for keeping a copy. Loaded lazily.
import { i18n } from "@/i18n";
import { textToBase64 } from "@/lib/base64";
import { localizeMarkers } from "@/lib/chat-markers";
import { formatDateTime } from "@/lib/intl";
import { pickSavePath } from "@/lib/native-file-dialog";
import { writeBytesFile } from "@/lib/tauri";
import type { StoredChat } from "@/store/chats";

function markerLabels() {
  return {
    stopped: i18n.t(($) => $.ai.conversation.stopped),
    stepLimit: i18n.t(($) => $.ai.conversation.stepLimit),
    outputLimit: i18n.t(($) => $.ai.conversation.outputLimit),
  };
}

type StoredMessage = StoredChat["messages"][number];

function messageLines(message: StoredMessage, labels: ReturnType<typeof markerLabels>): string[] {
  const lines = [
    message.role === "user"
      ? `## ${i18n.t(($) => $.ai.conversation.exportYou)}`
      : `## ${i18n.t(($) => $.ai.conversation.exportAssistant)}`,
    "",
    message.role === "assistant" ? localizeMarkers(message.content, labels) : message.content,
    "",
  ];
  const attachments = message.attachments ?? [];
  if (attachments.length > 0) {
    lines.push(`**${i18n.t(($) => $.ai.conversation.exportAttachments)}**`, "");
    for (const attachment of attachments) lines.push(`- ${attachment.name}`);
    lines.push("");
  }
  const tools = [...new Set((message.toolCalls ?? []).map((tool) => tool.name))];
  if (tools.length > 0) {
    lines.push(`**${i18n.t(($) => $.ai.conversation.exportTools)}**`, "");
    for (const tool of tools) lines.push(`- ${tool}`);
    lines.push("");
  }
  return lines;
}

export function chatMarkdown(chat: StoredChat, opts: { projectName: string | null }): string {
  const labels = markerLabels();
  const lines: string[] = [`# ${chat.title || i18n.t(($) => $.ai.history.untitled)}`, ""];
  if (opts.projectName) lines.push(`- Project: ${opts.projectName}`);
  lines.push(`- Started: ${formatDateTime(chat.createdAt)}`, "");
  for (const message of chat.messages) lines.push(...messageLines(message, labels));
  return `${lines.join("\n").trimEnd()}\n`;
}

function slug(title: string): string {
  const cleaned = Array.from(title.normalize("NFKC"))
    .filter((character) => (character.codePointAt(0) ?? 0) >= 32)
    .join("")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return cleaned || "chat";
}

/** Asks where to save the chat as Markdown; "cancelled" when the dialog closes. */
export async function exportChatMarkdown(
  chat: StoredChat,
  projectName: string | null,
): Promise<"saved" | "cancelled"> {
  const destination = await pickSavePath({
    defaultPath: `${slug(chat.title)}.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!destination) return "cancelled";
  await writeBytesFile(destination, textToBase64(chatMarkdown(chat, { projectName })));
  return "saved";
}
