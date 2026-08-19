import { useEffect, useState } from "react";
import { Eye, FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function ReaderViewDialog({
  open,
  pages,
  onClose,
}: {
  open: boolean;
  pages: string[];
  onClose: () => void;
}) {
  const [activePage, setActivePage] = useState(0);

  useEffect(() => {
    if (!open) setActivePage(0);
    else if (activePage >= pages.length) setActivePage(Math.max(0, pages.length - 1));
  }, [activePage, open, pages.length]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        data-testid="preflight-reader-dialog"
        className="flex h-[min(46rem,88vh)] max-w-4xl flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="shrink-0 px-6 pb-4 pt-5 pr-14">
          <DialogTitle className="flex items-center gap-2">
            <Eye className="size-5" />
            What the reader sees
          </DialogTitle>
          <DialogDescription>
            Text extracted from the current PDF in reading order. This is close to what a screen reader or automated
            parser receives.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[10rem_minmax(0,1fr)] border-t">
          <nav aria-label="PDF pages" className="overflow-auto border-r bg-muted/20 p-2">
            {pages.map((text, page) => (
              <button
                // PDF page order is intrinsic and pages have no independent IDs.
                // biome-ignore lint/suspicious/noArrayIndexKey: the page number is the stable identity
                key={page}
                type="button"
                onClick={() => setActivePage(page)}
                aria-current={page === activePage ? "page" : undefined}
                className={cn(
                  "mb-1 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent",
                  page === activePage && "bg-accent text-accent-foreground",
                )}
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span>Page {page + 1}</span>
                {!text.trim() && <span className="ml-auto text-[10px] text-muted-foreground">empty</span>}
              </button>
            ))}
          </nav>

          <section aria-label={`Extracted text from page ${activePage + 1}`} className="min-h-0 overflow-auto p-6">
            <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Page {activePage + 1} of {pages.length}
            </div>
            <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-foreground/90">
              {pages[activePage]?.trim()
                ? pages[activePage]
                : "No selectable text was found on this page."}
            </pre>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
