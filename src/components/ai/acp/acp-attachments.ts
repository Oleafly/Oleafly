import type { DraftAttachment } from "@/components/ai/composer/types";
import { i18n } from "@/i18n";
import type { AcpImage, AcpPromptFile, AcpPromptInput, AcpSession } from "@/lib/acp";
import { attachmentRead } from "@/lib/attachments";
import { bytesToBase64 } from "@/lib/base64";
import { composerMentionPaths } from "@/lib/composer-tokens";
import type { FileEntry } from "@/lib/tauri";
import type { AcpPromptDraft, AcpSelection } from "@/store/acp-sessions";

/** The largest `session/prompt` payload, leaving room for the envelope. */
export const PROMPT_BUDGET = 1024 * 1024 - 1024;
export const MAX_ACP_ATTACHMENTS = 10;
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_SELECTION_CHARS = 64 * 1024;
const IMAGE_EDGES = [1536, 1024, 768, 512] as const;

export type AcpPromptProblem = "tooLarge" | "tooMany" | "imagesUnsupported" | "notReady";

export class AcpPromptError extends Error {
  constructor(readonly reason: AcpPromptProblem) {
    super(reason);
    this.name = "AcpPromptError";
  }
}

const PROBLEM_TEXT: Record<AcpPromptProblem, () => string> = {
  tooLarge: () => i18n.t(($) => $.ai.acp.messageTooLarge),
  tooMany: () => i18n.t(($) => $.ai.acp.composer.tooManyAttachments),
  imagesUnsupported: () => i18n.t(($) => $.ai.acp.composer.imagesUnsupported),
  notReady: () => i18n.t(($) => $.ai.acp.composer.attachmentsNotReady),
};

/** The message for a prompt the composer could not prepare, if it is one. */
export function promptErrorMessage(error: unknown): string | null {
  return error instanceof AcpPromptError ? PROBLEM_TEXT[error.reason]() : null;
}

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).length;

/** Raw image bytes each image may take within the frame budget. */
export function imageByteBudget(textBytes: number, otherBytes: number, images: number): number {
  if (images <= 0) return 0;
  return Math.floor(((PROMPT_BUDGET - 512 - textBytes - otherBytes) * 3) / 4 / images);
}

/** Reads stored images back, re-encoding large ones smaller until they fit. */
export async function prepareImages(items: readonly DraftAttachment[], perImage: number): Promise<AcpImage[]> {
  const images: AcpImage[] = [];
  for (const item of items) {
    if (!item.sha256) throw new AcpPromptError("notReady");
    const bytes = new Uint8Array(await attachmentRead(item.scope, item.sha256));
    if (bytes.length <= perImage) {
      images.push({ mimeType: item.mime, data: bytesToBase64(bytes) });
      continue;
    }
    const { normalizeImage } = await import("@/lib/image-normalize");
    let fitted: AcpImage | null = null;
    for (const maxEdge of IMAGE_EDGES) {
      const file = new File([bytes], item.name, { type: item.mime });
      const result = await normalizeImage(file, { maxEdge, thumbEdge: 32 });
      if (result.bytes.length <= perImage) {
        fitted = { mimeType: result.mime, data: bytesToBase64(result.bytes) };
        break;
      }
    }
    if (!fitted) throw new AcpPromptError("tooLarge");
    images.push(fitted);
  }
  return images;
}

/** The project files a message's text mentions (folders are left out). */
export function promptMentions(text: string, tree: readonly FileEntry[]): string[] {
  const filesByPath = new Map(tree.map((entry) => [entry.path, entry.is_dir]));
  return composerMentionPaths(text, filesByPath.keys()).filter((path) => filesByPath.get(path) === false);
}

/**
 * What one message sends: text, images inline, other files by reference.
 * `tree` is the conversation's project as the window shows it; null when the
 * window shows another project, and the mentions read when the message was
 * queued are used instead.
 */
export async function toPromptInput(
  draft: AcpPromptDraft,
  session: AcpSession,
  tree: readonly FileEntry[] | null,
): Promise<AcpPromptInput> {
  if (draft.attachments.some((item) => item.status !== "ready")) throw new AcpPromptError("notReady");
  const images = draft.attachments.filter((item) => item.kind === "image");
  if (images.length > 0 && !session.capabilities.image) throw new AcpPromptError("imagesUnsupported");
  const mentioned = tree ? promptMentions(draft.text, tree) : [...draft.mentions];
  const files: AcpPromptFile[] = [];
  for (const item of draft.attachments) {
    if (item.kind === "image") continue;
    if (!item.sha256) throw new AcpPromptError("notReady");
    files.push({ kind: "stored", sha256: item.sha256, name: item.name, mime: item.mime });
  }
  for (const path of mentioned) files.push({ kind: "project", path });
  const selections = draft.selections.map((selection) => ({
    path: selection.path,
    text: selection.text.slice(0, MAX_SELECTION_CHARS),
  }));
  if (draft.attachments.length + mentioned.length + selections.length > MAX_ACP_ATTACHMENTS) {
    throw new AcpPromptError("tooMany");
  }
  const textBytes = byteLength(draft.text);
  if (textBytes > MAX_TEXT_BYTES) throw new AcpPromptError("tooLarge");
  const selectionBytes = selections.reduce((total, selection) => total + byteLength(selection.text), 0);
  const prepared = images.length > 0
    ? await prepareImages(images, imageByteBudget(textBytes, selectionBytes, images.length))
    : [];
  return {
    text: draft.text,
    images: prepared,
    files,
    selections,
    skillId: draft.skill?.id ?? null,
  };
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The editor selection as a quote, or null when nothing is selected. */
export async function quoteSelection(): Promise<AcpSelection | null> {
  const [{ getEditorView }, { useFilesStore }] = await Promise.all([
    import("@/components/editor/cm/controller"),
    import("@/store/files"),
  ]);
  const view = getEditorView();
  if (!view) return null;
  const range = view.state.selection.main;
  if (range.empty) return null;
  const text = view.state.sliceDoc(range.from, range.to).slice(0, MAX_SELECTION_CHARS);
  if (!text.trim()) return null;
  const fromLine = view.state.doc.lineAt(range.from).number;
  const toLine = view.state.doc.lineAt(range.to).number;
  const path = useFilesStore.getState().activePath;
  const name = path ? basename(path) : "";
  const label = name ? `${name}:${fromLine}-${toLine}` : `${fromLine}-${toLine}`;
  return {
    id: `selection-${Date.now()}-${range.from}`,
    path,
    text,
    label,
  };
}
