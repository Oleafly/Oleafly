// The model messages for a user turn and its history when attachments are
// involved. Images and PDFs go by reference (the run resolves them for the
// model); text files are read back and inlined. Loaded lazily.
import type {
  AttachmentKind,
  DraftAttachment,
  StoredAttachmentRef,
} from "@/components/ai/composer/types";
import { HISTORY_MSG_MAX_CHARS, packChatHistoryInfo } from "@/lib/ai-context-pack";
import type { AttachmentPart, FilePart, ModelMessage, TextPart } from "@/lib/chat-types";
import type { AttachmentMeta, ChatMessage } from "@/store/chats";

/** A project file or folder listing mentioned with @, as a data URL. */
export interface MentionAttachment {
  id: string;
  name: string;
  mediaType: string;
  dataUrl: string;
}

export interface AttachmentModelContext {
  readText(scope: string | null, sha256: string): Promise<string | null>;
  /** Characters of attached text one message may carry. */
  textBudget: number;
  /** Send a scanned PDF's page images (vision without PDF input). */
  pageImages: boolean;
}

/** User turns whose attachments are sent again with a new message. */
export const RESEND_ATTACHMENT_TURNS = 3;

const MIN_TEXT_BUDGET = 48_000;
const MAX_TEXT_BUDGET = 400_000;

/** Characters of attachment text for a context window (about 40% of it). */
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
  // Text files are read side by side; the budget is spent in order below.
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

/** The new user turn: its text, attachments, then mentioned files. */
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

/** A note in place of attachments that are not sent again. */
export function skippedAttachmentNote(attachments: readonly AttachmentMeta[]): string {
  return `[Attachments from this message are not sent again: ${attachments.map(describe).join(", ")}.]`;
}

/** One prior turn as a model message; a user turn with stored attachments sends them again when `resend`. */
async function historyMessage(
  message: ChatMessage,
  content: string,
  resend: boolean,
  scope: string | null,
  ctx: AttachmentModelContext,
): Promise<ModelMessage> {
  if (message.role === "assistant") return { role: "assistant", content };
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

/**
 * The conversation before the new turn, packed like `packChatHistory`.
 * The last few user turns with stored attachments send them again; older
 * ones, and attachments saved before 0.4.8, leave a note instead.
 */
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
  // Only the last few user turns carry files, so few of these do any reading.
  const messages = await Promise.all(
    kept.map((message, index) =>
      historyMessage(message, packed.messages[index].content, index >= resendFrom, scope, ctx),
    ),
  );
  return { messages, droppedTurns: packed.droppedTurns };
}
