import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBytes } from "@/lib/format-bytes";
import { formatNumber } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { useCopyIntoLibraryStore } from "@/store/copy-into-library";

export function CopyIntoLibraryDialog() {
  const { t } = useTranslation(["common", "library"]);
  const target = useCopyIntoLibraryStore((state) => state.target);
  const status = useCopyIntoLibraryStore((state) => state.status);
  const progress = useCopyIntoLibraryStore((state) => state.progress);
  const error = useCopyIntoLibraryStore((state) => state.error);
  const cancel = useCopyIntoLibraryStore((state) => state.cancel);
  const close = useCopyIntoLibraryStore((state) => state.close);
  if (!target) return null;

  const failed = status === "failed";
  const copying = progress?.phase === "copying";
  const byBytes = copying && progress.bytesTotal > 0;
  const [done, total] = byBytes
    ? [progress.bytesDone, progress.bytesTotal]
    : [progress?.entriesDone ?? 0, progress?.entriesTotal ?? 0];
  const percent = copying && total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
  const amount = byBytes ? formatBytes : formatNumber;
  const phaseLabel = copying
    ? t(($) => $.library.folder.copy.copying)
    : t(($) => $.library.folder.copy.counting);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open) return;
        if (failed) close();
        else cancel();
      }}
    >
      <DialogContent
        className="max-w-md"
        closeDisabled={status === "cancelling"}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="pr-6">
          <DialogTitle className="text-base leading-snug [overflow-wrap:anywhere]">
            {t(($) => $.library.folder.copy.title, { name: target.name })}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {t(($) => $.library.folder.copy.description)}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-14 flex-col justify-center gap-2">
          {failed ? (
            <p role="alert" className="text-sm leading-relaxed text-destructive">
              {error}
            </p>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                <span>{phaseLabel}</span>
                {copying ? (
                  <span className="tabular-nums">
                    {t(($) => $.library.folder.copy.count, {
                      done: amount(done),
                      total: amount(total),
                    })}
                  </span>
                ) : null}
              </div>
              <div
                role="progressbar"
                aria-label={phaseLabel}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent ?? undefined}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className={cn(
                    "h-full rounded-full bg-primary transition-[width] duration-200 ease-out motion-reduce:transition-none",
                    percent === null && "w-1/3 animate-pulse motion-reduce:animate-none",
                  )}
                  style={percent === null ? undefined : { width: `${percent}%` }}
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          {failed ? (
            <Button size="sm" onClick={close}>
              {t(($) => $.common.actions.close)}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={status === "cancelling"}
              onClick={cancel}
            >
              {t(($) => $.common.actions.cancel)}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
