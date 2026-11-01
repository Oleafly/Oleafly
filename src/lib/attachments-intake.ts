import type { AttachmentKind, DraftAttachment, StoredAttachmentRef } from "@/components/ai/composer/types";
import { i18n } from "@/i18n";
import { attachmentPut, attachmentPutText } from "@/lib/attachments";
import { formatBytes } from "@/lib/format-bytes";
import { mimeForPath } from "@/lib/image-mime";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import {
  composerHolding,
  draftAttachments,
  registerAttachmentHolder,
  useComposerDrafts,
} from "@/store/composer-drafts";

export const ATTACHMENT_LIMITS = {
  perMessage: 10,
  imageBytes: 20 * 1024 * 1024,
  pdfBytes: 32 * 1024 * 1024,
  pdfPages: 100,
  textBytes: 2 * 1024 * 1024,
  imageMaxEdge: 2048,
  thumbEdge: 96,
  scannedPageImages: 3,
} as const;

export type AttachmentErrorReason = "unreadableImage" | "unreadablePdf" | "readFailed" | "storeFailed";

export class AttachmentError extends Error {
  readonly reason: AttachmentErrorReason;

  constructor(reason: AttachmentErrorReason) {
    super(reason);
    this.name = "AttachmentError";
    this.reason = reason;
  }
}

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic", "heif", "tif", "tiff", "avif",
]);
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "tex", "typ", "bib", "cls", "sty", "bst", "csv", "tsv", "json", "yaml", "yml",
  "toml", "log", "xml", "html", "css", "js", "ts", "py", "r", "jl", "m", "sh", "ps1", "bat",
  "ipynb", "rst", "org",
]);
const TEXT_TYPES = new Set(["application/json", "application/xml", "application/x-yaml"]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function attachmentKind(file: { name: string; type: string }): AttachmentKind | null {
  const type = file.type.toLowerCase();
  const extension = extensionOf(file.name);
  if (type.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) return "image";
  if (type === "application/pdf" || extension === "pdf") return "pdf";
  if (type.startsWith("text/") || TEXT_TYPES.has(type) || TEXT_EXTENSIONS.has(extension)) {
    return "text";
  }
  return null;
}

export interface IntakeRejection {
  name: string;
  reason: "tooMany" | "tooLarge" | "unsupported";
  limit?: number;
}

function byteLimit(kind: AttachmentKind): number {
  if (kind === "image") return ATTACHMENT_LIMITS.imageBytes;
  if (kind === "pdf") return ATTACHMENT_LIMITS.pdfBytes;
  return ATTACHMENT_LIMITS.textBytes;
}

export function screenFiles(
  files: readonly File[],
  existing: number,
  kinds?: readonly AttachmentKind[],
): { accepted: { file: File; kind: AttachmentKind }[]; rejected: IntakeRejection[] } {
  const accepted: { file: File; kind: AttachmentKind }[] = [];
  const rejected: IntakeRejection[] = [];
  for (const file of files) {
    const kind = attachmentKind(file);
    if (!kind || (kinds && !kinds.includes(kind))) {
      rejected.push({ name: file.name, reason: "unsupported" });
      continue;
    }
    const limit = byteLimit(kind);
    if (file.size > limit) {
      rejected.push({ name: file.name, reason: "tooLarge", limit });
      continue;
    }
    if (existing + accepted.length >= ATTACHMENT_LIMITS.perMessage) {
      rejected.push({ name: file.name, reason: "tooMany", limit: ATTACHMENT_LIMITS.perMessage });
      continue;
    }
    accepted.push({ file, kind });
  }
  return { accepted, rejected };
}

export function rejectionMessage(rejections: readonly IntakeRejection[]): string {
  const sentences: string[] = [];
  let tooMany = false;
  for (const rejection of rejections) {
    if (rejection.reason === "tooMany") {
      if (!tooMany) {
        sentences.push(
          i18n.t(($) => $.ai.attachments.tooMany, { max: ATTACHMENT_LIMITS.perMessage }),
        );
      }
      tooMany = true;
    } else if (rejection.reason === "tooLarge") {
      sentences.push(
        i18n.t(($) => $.ai.attachments.tooLarge, {
          name: rejection.name,
          limit: formatBytes(rejection.limit ?? 0),
        }),
      );
    } else {
      sentences.push(i18n.t(($) => $.ai.attachments.unsupported, { name: rejection.name }));
    }
  }
  return sentences.join(" ");
}

function failureMessage(error: unknown, name: string): string {
  const reason = error instanceof AttachmentError ? error.reason : null;
  switch (reason) {
    case "unreadableImage":
      return i18n.t(($) => $.ai.attachments.unreadableImage, { name });
    case "unreadablePdf":
      return i18n.t(($) => $.ai.attachments.unreadablePdf, { name });
    case "storeFailed":
      return i18n.t(($) => $.ai.attachments.storeFailed, { name });
    default:
      return i18n.t(($) => $.ai.attachments.failed, { name });
  }
}

function fallbackMime(file: File, kind: AttachmentKind): string {
  if (kind === "image") return file.type || mimeForPath(file.name) || "image/png";
  if (kind === "pdf") return "application/pdf";
  return file.type.startsWith("text/") ? file.type : "text/plain";
}

async function store<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    void logError("store attachment", error);
    throw new AttachmentError("storeFailed");
  }
}

type Normalizer = typeof import("@/lib/attachments-normalize");
type NormalizedAttachment = Awaited<ReturnType<Normalizer["normalizeAttachment"]>>;
type StoredMeta = Awaited<ReturnType<typeof attachmentPut>>;

function isDrafted(composerId: string, id: string): boolean {
  return composerHolding(composerId, id) !== null;
}

async function storePdfText(
  scope: string | null,
  sha256: string,
  normalized: NormalizedAttachment,
): Promise<boolean> {
  if (normalized.text === undefined) return false;
  try {
    await attachmentPutText(scope, sha256, normalized.text, normalized.pages);
    return true;
  } catch (error) {
    void logError("store attachment text", error);
    return false;
  }
}

function storePageImages(
  scope: string | null,
  normalized: NormalizedAttachment,
  held: string[],
): Promise<StoredAttachmentRef[]> {
  return Promise.all(
    (normalized.pageImages ?? []).map(async (image, index) => {
      const stored = await store(() =>
        attachmentPut(scope, `${normalized.name} page ${index + 1}.png`, image.mime, image.bytes),
      );
      held.push(stored.sha256);
      return { sha256: stored.sha256, mime: stored.mime };
    }),
  );
}

function readyPatch(
  meta: StoredMeta,
  normalized: NormalizedAttachment,
  hasText: boolean | undefined,
  pageImages: StoredAttachmentRef[],
): Partial<DraftAttachment> {
  const patch: Partial<DraftAttachment> = {
    status: "ready",
    sha256: meta.sha256,
    mime: meta.mime,
    size: meta.size,
    thumbnailUrl: normalized.thumbnailUrl,
  };
  if (normalized.pages !== undefined) patch.pages = normalized.pages;
  if (hasText !== undefined) patch.hasText = hasText;
  if (pageImages.length > 0) patch.pageImages = pageImages;
  return patch;
}

async function prepareAttachment(
  { file, kind, draft }: { file: File; kind: AttachmentKind; draft: DraftAttachment },
  ctx: { composerId: string; scope: string | null },
  normalizer: Normalizer,
): Promise<void> {
  const drafts = useComposerDrafts.getState();
  const holder = () => composerHolding(ctx.composerId, draft.id) ?? ctx.composerId;
  const held: string[] = [];
  const release = registerAttachmentHolder(() => held);
  try {
    const normalized = await normalizer.normalizeAttachment(file, kind, ATTACHMENT_LIMITS);
    if (!isDrafted(ctx.composerId, draft.id)) return;
    const meta = await store(() =>
      attachmentPut(ctx.scope, normalized.name, normalized.mime, normalized.bytes),
    );
    held.push(meta.sha256);
    const hasText = kind === "pdf" ? await storePdfText(ctx.scope, meta.sha256, normalized) : undefined;
    const pageImages = await storePageImages(ctx.scope, normalized, held);
    const composerId = holder();
    const duplicate = draftAttachments(composerId).some(
      (item) => item.id !== draft.id && item.status === "ready" && item.sha256 === meta.sha256,
    );
    if (duplicate) {
      drafts.removeAttachments(composerId, [draft.id]);
      return;
    }
    drafts.updateAttachment(composerId, draft.id, readyPatch(meta, normalized, hasText, pageImages));
  } catch (error) {
    void logError("prepare attachment", error);
    drafts.updateAttachment(holder(), draft.id, {
      status: "error",
      error: failureMessage(error, draft.name),
    });
  } finally {
    release();
  }
}

export async function intakeFiles(
  files: readonly File[],
  ctx: { composerId: string; scope: string | null; kinds?: readonly AttachmentKind[] },
): Promise<void> {
  const drafts = useComposerDrafts.getState();
  const existing = draftAttachments(ctx.composerId).filter((item) => item.status !== "error").length;
  const { accepted, rejected } = screenFiles(files, existing, ctx.kinds);
  if (rejected.length > 0) toast.errorUnique("ai-attach", rejectionMessage(rejected));
  if (accepted.length === 0) return;

  const pending = accepted.map(({ file, kind }) => ({
    file,
    kind,
    draft: {
      id: crypto.randomUUID(),
      name: file.name,
      mime: fallbackMime(file, kind),
      size: file.size,
      status: "processing",
      kind,
      scope: ctx.scope,
    } satisfies DraftAttachment,
  }));
  drafts.addAttachments(ctx.composerId, pending.map((item) => item.draft));

  let normalizer: Normalizer;
  try {
    normalizer = await import("@/lib/attachments-normalize");
  } catch (error) {
    void logError("prepare attachment", error);
    for (const { draft } of pending) {
      drafts.updateAttachment(ctx.composerId, draft.id, {
        status: "error",
        error: failureMessage(error, draft.name),
      });
    }
    return;
  }

  for (const item of pending) {
    if (isDrafted(ctx.composerId, item.draft.id)) await prepareAttachment(item, ctx, normalizer);
  }
}

export async function readDroppedFiles(
  items: readonly { name: string; read: () => Promise<File> }[],
): Promise<File[]> {
  const files: File[] = [];
  const rejected: IntakeRejection[] = [];
  const unreadable: string[] = [];
  for (const item of items) {
    if (!attachmentKind({ name: item.name, type: mimeForPath(item.name) })) {
      rejected.push({ name: item.name, reason: "unsupported" });
    } else if (files.length >= ATTACHMENT_LIMITS.perMessage) {
      rejected.push({ name: item.name, reason: "tooMany", limit: ATTACHMENT_LIMITS.perMessage });
    } else {
      try {
        files.push(await item.read());
      } catch (error) {
        void logError("read dropped file", error);
        unreadable.push(item.name);
      }
    }
  }
  const notes = [
    rejected.length > 0 ? rejectionMessage(rejected) : "",
    unreadable.length > 0 ? i18n.t(($) => $.ai.attachments.dropUnreadable, { names: unreadable.join(", ") }) : "",
  ].filter(Boolean);
  if (notes.length > 0) toast.errorUnique("ai-attach", notes.join(" "));
  return files;
}
