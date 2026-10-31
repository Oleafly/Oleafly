import { FileText, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AttachmentKind, ComposerAttachment } from "@/components/ai/composer/types";
import { useAttachmentUrl } from "@/components/ai/composer/use-attachment-url";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { formatBytes } from "@/lib/format-bytes";
import { cn } from "@/lib/utils";

const PDF_PAGE_LIMIT = 100;

type ChipItem = ComposerAttachment & { kind?: AttachmentKind; sha256?: string; scope?: string | null };

function StoredThumbnail({ item, sha256 }: Readonly<{ item: ChipItem; sha256: string }>) {
  const { url } = useAttachmentUrl(item.scope ?? null, { sha256, mime: item.mime });
  if (!url) return <FileText className="size-4 shrink-0 text-muted-foreground" />;
  return <img src={url} alt="" className="size-6 shrink-0 rounded object-cover" />;
}

function AttachmentLeading({ item }: Readonly<{ item: ChipItem }>) {
  if (item.status === "processing") return <Spinner size="xs" aria-hidden="true" />;
  if (item.thumbnailUrl && item.status === "ready") {
    return <img src={item.thumbnailUrl} alt="" className="size-6 shrink-0 rounded object-cover" />;
  }
  if (item.status === "ready" && item.kind === "image" && item.sha256) {
    return <StoredThumbnail item={item} sha256={item.sha256} />;
  }
  return <FileText className="size-4 shrink-0 text-muted-foreground" />;
}

export function AttachmentChips({
  items,
  onRemove,
}: Readonly<{
  items: readonly ChipItem[];
  onRemove?: (id: string) => void;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  if (items.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {items.map((item) => {
        const isPdf = item.mime === "application/pdf";
        const meta = [
          item.status === "processing" ? null : formatBytes(item.size),
          isPdf && item.pages ? t(($) => $.ai.attachments.pages, { count: item.pages }) : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const limited = isPdf && (item.pages ?? 0) > PDF_PAGE_LIMIT;
        const chip = (
          <div
            key={item.id}
            data-testid="composer-attachment"
            data-status={item.status}
            aria-busy={item.status === "processing" || undefined}
            className={cn(
              "relative flex max-w-[16rem] items-center gap-1.5 rounded-md border bg-muted/50 py-1 pl-1.5 text-xs",
              onRemove ? "pr-8" : "pr-2",
              item.status === "error" && "border-destructive/50 text-destructive",
            )}
          >
            <AttachmentLeading item={item} />
            <span className="min-w-0">
              <span className="block max-w-[140px] truncate">
                {item.status === "processing"
                  ? t(($) => $.ai.attachments.processing, { name: item.name })
                  : item.name}
              </span>
              {meta && (
                <span className="block text-[0.625rem] leading-tight text-muted-foreground">{meta}</span>
              )}
              {limited && (
                <span className="block text-[0.625rem] leading-tight text-muted-foreground">
                  {t(($) => $.ai.attachments.pagesLimited, {
                    limit: PDF_PAGE_LIMIT,
                    count: item.pages ?? 0,
                  })}
                </span>
              )}
            </span>
            {onRemove && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onRemove(item.id)}
                aria-label={t(($) => $.ai.attachments.remove, { name: item.name })}
                className="absolute right-0.5 top-1/2 size-6 -translate-y-1/2 text-muted-foreground [&_svg]:size-3"
              >
                <X />
              </Button>
            )}
          </div>
        );
        return item.status === "error" && item.error ? (
          <Tooltip key={item.id} label={item.error} wide>
            {chip}
          </Tooltip>
        ) : (
          <div key={item.id} className="contents">
            {chip}
          </div>
        );
      })}
    </div>
  );
}
