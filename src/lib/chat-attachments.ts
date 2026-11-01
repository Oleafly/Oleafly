import type {
  AttachmentKind,
  DraftAttachment,
  StoredAttachmentRef,
} from "@/components/ai/composer/types";
import { HISTORY_MSG_MAX_CHARS, packChatHistoryInfo, truncateText } from "@/lib/ai-context-pack";
import type { AttachmentPart, FilePart, ModelMessage, TextPart } from "@/lib/chat-types";
import type { AttachmentMeta, ChatMessage } from "@/store/chats";

export interface MentionAttachment {
  id: string;
  name: string;
  mediaType: string;
  dataUrl: string;
}

export interface AttachmentModelContext {
  readText(scope: string | null, sha256: string): Promise<string | null>;
  textBudget: number;
  pageImages: boolean;
}

export const RESEND_ATTACHMENT_TURNS = 3;

const MIN_TEXT_BUDGET = 48_000;
const MAX_TEXT_BUDGET = 400_000;

export function attachmentTextBudget(contextWindow?: number): number {
  if (!contextWindow || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return MIN_TEXT_BUDGET;
  }
  return Math.min(MAX_TEXT_BUDGET, Math.max(MIN_TEXT_BUDGET, Math.floor(contextWindow * 4 * 0.4)));
}

export function attachedFileText(name: string, text: string, budget: number): string {
  const header = `Attached file "${name}":\n\n`;
  if (text.length <= budget) return `${header}${text}`;
  return `${header}${text.slice(0, Math.max(0, budget))}\n\n[Only the first ${Math.max(0, budget)} characters of this file are included.]`;
}

type UserPart = TextPart | FilePart | AttachmentPart;

interface StoredFile {
  kind: AttachmentKind;
  sha256: string;
  name: string;
  mime: string;
  pageImages?: readonly StoredAttachmentRef[];
}

function kindOf(mime: string): AttachmentKind {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  return "text";
}

function fromDraft(item: DraftAttachment): StoredFile | null {
  if (item.status !== "ready" || !item.sha256) return null;
  return {
    kind: item.kind,
    sha256: item.sha256,
    name: item.name,
    mime: item.mime,
    pageImages: item.pageImages,
  };
}

function fromSaved(meta: AttachmentMeta): StoredFile | null {
  if (!meta.sha256) return null;
  return {
    kind: meta.kind ?? kindOf(meta.mediaType),
    sha256: meta.sha256,
    name: meta.name,
    mime: meta.mediaType,
    pageImages: meta.pageImages,
  };
}

async function partsFor(
  files: readonly StoredFile[],
  scope: string | null,
  ctx: AttachmentModelContext,
  textBudget: number,
): Promise<UserPart[]> {
  const loaded = await Promise.all(
    files.map(async (file) => ({
      file,
      text: file.kind === "text" ? await ctx.readText(scope, file.sha256) : null,
    })),
  );
  const parts: UserPart[] = [];
  let remaining = textBudget;
  for (const { file, text } of loaded) {
    if (file.kind === "text") {
      if (text === null) {
        parts.push({
          type: "text",
          text: `[The attachment "${file.name}" is no longer available.]`,
        });
        continue;
      }
      parts.push({ type: "text", text: attachedFileText(file.name, text, remaining) });
      remaining = Math.max(0, remaining - text.length);
      continue;
    }
    parts.push({ type: "attachment", sha256: file.sha256, name: file.name, mime: file.mime });
    if (file.kind === "pdf" && ctx.pageImages) {
      for (const [index, page] of (file.pageImages ?? []).entries()) {
        parts.push({
          type: "attachment",
          sha256: page.sha256,
          name: `${file.name} page ${index + 1}.png`,
          mime: page.mime,
        });
      }
    }
  }
  return parts;
}

function mentionParts(mentions: readonly MentionAttachment[]): FilePart[] {
  return mentions.map((mention) => ({
    type: "file",
    data: mention.dataUrl,
    mediaType: mention.mediaType,
    name: mention.name,
  }));
}

export async function userModelMessage(
  text: string,
  attachments: readonly DraftAttachment[],
  mentions: readonly MentionAttachment[],
  ctx: AttachmentModelContext,
): Promise<ModelMessage> {
  const files = attachments.map(fromDraft).filter((file): file is StoredFile => file !== null);
  if (files.length === 0 && mentions.length === 0) return { role: "user", content: text };
  const scope = attachments.find((item) => item.sha256)?.scope ?? null;
  const parts: UserPart[] = [];
  if (text.trim()) parts.push({ type: "text", text });
  parts.push(...(await partsFor(files, scope, ctx, ctx.textBudget)), ...mentionParts(mentions));
  return { role: "user", content: parts };
}

function describe(meta: AttachmentMeta): string {
  const kind = meta.kind ?? kindOf(meta.mediaType);
  if (kind === "image") return `${meta.name} (image)`;
  if (kind === "pdf") {
    return meta.pages ? `${meta.name} (PDF, ${meta.pages} pages)` : `${meta.name} (PDF)`;
  }
  return `${meta.name} (text)`;
}

export function skippedAttachmentNote(attachments: readonly AttachmentMeta[]): string {
  return `[Attachments from this message are not sent again: ${attachments.map(describe).join(", ")}.]`;
}

function replyReasoning(message: ChatMessage): string {
  const blocks = (message.reasoningBlocks ?? []).map((block) => block.text).filter(Boolean);
  return blocks.length > 0 ? blocks.join("\n\n") : (message.reasoning ?? "");
}

function assistantMessage(message: ChatMessage, content: string): ModelMessage {
  const reasoning = replyReasoning(message);
  if (!reasoning) return { role: "assistant", content };
  return {
    role: "assistant",
    content: [
      { type: "reasoning", text: truncateText(reasoning, HISTORY_MSG_MAX_CHARS) },
      { type: "text", text: content },
    ],
  };
}

async function historyMessage(
  message: ChatMessage,
  content: string,
  resend: boolean,
  scope: string | null,
  ctx: AttachmentModelContext,
): Promise<ModelMessage> {
  if (message.role === "assistant") return assistantMessage(message, content);
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) return { role: "user", content };
  const files = resend
    ? attachments.map(fromSaved).filter((file): file is StoredFile => file !== null)
    : [];
  const left = resend ? attachments.filter((meta) => !meta.sha256) : attachments;
  const text = left.length > 0 ? `${content}\n\n${skippedAttachmentNote(left)}` : content;
  if (files.length === 0) return { role: "user", content: text };
  const parts: UserPart[] = [];
  if (text.trim()) parts.push({ type: "text", text });
  parts.push(...(await partsFor(files, scope, ctx, Math.min(ctx.textBudget, HISTORY_MSG_MAX_CHARS))));
  return { role: "user", content: parts };
}

export async function historyModelMessages(
  prior: readonly ChatMessage[],
  scope: string | null,
  ctx: AttachmentModelContext,
): Promise<{ messages: ModelMessage[]; droppedTurns: number }> {
  const textTurns = prior.filter((m) => m.role === "user" || m.role === "assistant");
  const packed = packChatHistoryInfo(textTurns);
  const kept = textTurns.slice(textTurns.length - packed.messages.length);
  const resendFrom = (() => {
    let seen = 0;
    for (let index = kept.length - 1; index >= 0; index -= 1) {
      const message = kept[index];
      if (message.role !== "user" || !message.attachments?.length) continue;
      seen += 1;
      if (seen === RESEND_ATTACHMENT_TURNS) return index;
    }
    return 0;
  })();
  const messages = await Promise.all(
    kept.map((message, index) =>
      historyMessage(message, packed.messages[index].content, index >= resendFrom, scope, ctx),
    ),
  );
  return { messages, droppedTurns: packed.droppedTurns };
}
