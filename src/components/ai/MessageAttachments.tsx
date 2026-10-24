import { lazy, Suspense, useState } from "react";
import { FileCode2, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { StoredAttachmentRef } from "@/components/ai/composer/types";
import { useAttachmentUrl } from "@/components/ai/composer/use-attachment-url";
import { Tooltip } from "@/components/ui/tooltip";
import { attachmentRead } from "@/lib/attachments";
import { bytesToBase64 } from "@/lib/base64";
import { formatBytes } from "@/lib/format-bytes";
import { logError } from "@/lib/log";
import { pickSavePath } from "@/lib/native-file-dialog";
import { writeBytesFile } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { AttachmentMeta } from "@/store/chats";
import { useFilesStore } from "@/store/files";

const AttachmentPreviewDialog = lazy(() => import("@/components/ai/composer/AttachmentPreviewDialog"));

function kindOf(meta: AttachmentMeta) {
  if (meta.kind) return meta.kind;
  if (meta.mediaType.startsWith("image/")) return "image";
  if (meta.mediaType === "application/pdf") return "pdf";
  return "text";
}

function ImageChip({ meta, scope }: Readonly<{ meta: AttachmentMeta; scope: string | null }>) {
  const { t } = useTranslation(["common", "ai"]);
  const ref: StoredAttachmentRef | undefined = meta.sha256
    ? { sha256: meta.sha256, mime: meta.mediaType }
    : undefined;
  const { url, failed } = useAttachmentUrl(scope, ref);
  const [open, setOpen] = useState(false);
  const chip = (
    <button
      type="button"
      data-testid="message-attachment"
      data-state={failed ? "missing" : "ready"}
      disabled={!url}
      onClick={() => setOpen(true)}
      aria-label={t(($) => $.ai.attachments.open, { name: meta.name })}
      className={cn(
        "flex items-center gap-1.5 rounded-md border bg-background/60 p-0.5 pr-2 text-xs transition-colors hover:bg-accent focus-visible:bg-accent disabled:cursor-default",
        failed && "opacity-60",
      )}
    >
      {url ? (
        <img src={url} alt="" className="size-10 rounded object-cover" />
      ) : (
        <span className="size-10 rounded bg-muted" />
      )}
      <span className="max-w-[140px] truncate">{meta.name}</span>
    </button>
  );
  return (
    <>
      {failed ? <Tooltip label={t(($) => $.ai.attachments.missing, { name: meta.name })}>{chip}</Tooltip> : chip}
      {open && url && (
        <Suspense fallback={null}>
          <AttachmentPreviewDialog open name={meta.name} url={url} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

function FileChip({ meta, scope }: Readonly<{ meta: AttachmentMeta; scope: string | null }>) {
  const { t } = useTranslation(["common", "ai"]);
  const [missing, setMissing] = useState(false);
  const pdf = kindOf(meta) === "pdf";
  const Icon = pdf ? FileText : FileCode2;
  const detail = [
    meta.size !== undefined ? formatBytes(meta.size) : null,
    pdf && meta.pages ? t(($) => $.ai.attachments.pages, { count: meta.pages }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const save = async () => {
    if (!meta.sha256) return;
    try {
      const destination = await pickSavePath({ defaultPath: meta.name });
      if (!destination) return;
      const bytes = new Uint8Array(await attachmentRead(scope, meta.sha256));
      await writeBytesFile(destination, bytesToBase64(bytes));
      toast.success(t(($) => $.ai.attachments.saved, { name: meta.name }));
    } catch (error) {
      void logError("save attachment copy", error);
      setMissing(true);
      toast.error(t(($) => $.ai.attachments.saveFailed, { name: meta.name }));
    }
  };
  const chip = (
    <button
      type="button"
      data-testid="message-attachment"
      data-state={missing ? "missing" : "ready"}
      onClick={() => void save()}
      aria-label={t(($) => $.ai.attachments.saveCopy, { name: meta.name })}
      className={cn(
        "flex items-center gap-1.5 rounded-md border bg-background/60 px-2 py-1 text-xs transition-colors hover:bg-accent focus-visible:bg-accent",
        missing && "opacity-60",
      )}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 text-left">
        <span className="block max-w-[160px] truncate">{meta.name}</span>
        {detail && <span className="block text-[0.625rem] text-muted-foreground">{detail}</span>}
      </span>
    </button>
  );
  return missing ? (
    <Tooltip label={t(($) => $.ai.attachments.missing, { name: meta.name })}>{chip}</Tooltip>
  ) : (
    chip
  );
}

/** A sent message's stored attachments: thumbnails, previews and saved copies. */
export default function MessageAttachments({
  attachments,
}: Readonly<{ attachments: readonly AttachmentMeta[] }>) {
  const scope = useFilesStore((state) => state.projectId);
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {attachments.map((meta, index) =>
        kindOf(meta) === "image" ? (
          <ImageChip key={`${meta.sha256 ?? meta.name}-${index}`} meta={meta} scope={scope} />
        ) : (
          <FileChip key={`${meta.sha256 ?? meta.name}-${index}`} meta={meta} scope={scope} />
        ),
      )}
    </div>
  );
}
