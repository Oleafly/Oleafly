// Taking files into a composer: limits, kind detection, and preparation
// (normalize, store, record). Loaded lazily the first time a file is added.
import type { AttachmentKind, DraftAttachment, StoredAttachmentRef } from "@/components/ai/composer/types";
import { i18n } from "@/i18n";
import { attachmentPut, attachmentPutText } from "@/lib/attachments";
import { formatBytes } from "@/lib/format-bytes";
import { mimeForPath } from "@/lib/image-mime";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import { draftAttachments, useComposerDrafts } from "@/store/composer-drafts";

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

/** Image, PDF or text, by type or extension (any case); null when unsupported. */
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

/** Which files may be attached, checked without reading them. */
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

/** One sentence per rejected file; every "too many" collapses into one. */
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

/**
 * Adds files to a composer's draft: rejected files are reported in one
 * toast; accepted ones show as "processing" chips and are prepared one at
 * a time (one large PDF in memory at once), then stored by hash.
 */
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

  const present = (id: string) =>
    draftAttachments(ctx.composerId).some((item) => item.id === id);

  let normalizer: typeof import("@/lib/attachments-normalize");
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

  for (const { file, kind, draft } of pending) {
    if (!present(draft.id)) continue;
    try {
      const normalized = await normalizer.normalizeAttachment(file, kind, ATTACHMENT_LIMITS);
      if (!present(draft.id)) continue;
      const meta = await store(() =>
        attachmentPut(ctx.scope, normalized.name, normalized.mime, normalized.bytes),
      );
      let hasText: boolean | undefined;
      if (kind === "pdf") {
        hasText = false;
        if (normalized.text !== undefined) {
          try {
            await attachmentPutText(ctx.scope, meta.sha256, normalized.text, normalized.pages);
            hasText = true;
          } catch (error) {
            void logError("store attachment text", error);
          }
        }
      }
      const pageImages: StoredAttachmentRef[] = [];
      for (const [index, image] of (normalized.pageImages ?? []).entries()) {
        const stored = await store(() =>
          attachmentPut(ctx.scope, `${normalized.name} page ${index + 1}.png`, image.mime, image.bytes),
        );
        pageImages.push({ sha256: stored.sha256, mime: stored.mime });
      }
      const duplicate = draftAttachments(ctx.composerId).some(
        (item) => item.id !== draft.id && item.status === "ready" && item.sha256 === meta.sha256,
      );
      if (duplicate) {
        drafts.removeAttachments(ctx.composerId, [draft.id]);
        continue;
      }
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
      drafts.updateAttachment(ctx.composerId, draft.id, patch);
    } catch (error) {
      void logError("prepare attachment", error);
      drafts.updateAttachment(ctx.composerId, draft.id, {
        status: "error",
        error: failureMessage(error, draft.name),
      });
    }
  }
}

/**
 * Reads files dropped through the native bridge (Linux), where every byte
 * crosses the IPC boundary. Only an item that could be attached is read, so a
 * video or an archive never is; the rest are named in one toast. Items are read
 * one after another, and one that cannot be read (a folder) does not stop the
 * others.
 */
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
