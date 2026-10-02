import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import type { PdfSearchState, PdfViewerHandle } from "@/components/pdf/PdfViewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function pdfSearchCounterLabel(state: PdfSearchState, query: string): string {
  if (state.status === "searching") {
    return `${state.scannedPages}/${state.totalPages}`;
  }
  if (query.trim()) return `${state.current}/${state.total}`;
  return "0/0";
}

export function PdfSearchBar({
  id,
  inputRef,
  query,
  onQueryChange,
  state,
  pdfRef,
  onClose,
}: Readonly<{
  id: string;
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (value: string) => void;
  state: PdfSearchState;
  pdfRef: RefObject<PdfViewerHandle | null>;
  onClose: () => void;
}>) {
  const { t } = useTranslation(["common", "preview"]);
  const stepDisabled = state.status !== "success" || state.total === 0;
  return (
    <search
      id={id}
      aria-label={t(($) => $.preview.search.panel)}
      className="absolute right-2 top-2 z-30 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
    >
      <Search className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && state.status === "success") {
            if (event.shiftKey) {
              pdfRef.current?.findPrevious();
            } else {
              pdfRef.current?.findNext();
            }
          }
        }}
        placeholder={t(($) => $.preview.search.placeholder)}
        aria-label={t(($) => $.preview.search.input)}
        className="h-7 w-40 border-0 bg-transparent px-1 text-xs shadow-none"
      />
      <span
        className="min-w-14 text-center text-[11px] tabular-nums text-muted-foreground"
        aria-live="polite"
      >
        {pdfSearchCounterLabel(state, query)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={stepDisabled}
        onClick={() => pdfRef.current?.findPrevious()}
        aria-label={t(($) => $.preview.search.previous)}
      >
        <ChevronLeft className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={stepDisabled}
        onClick={() => pdfRef.current?.findNext()}
        aria-label={t(($) => $.preview.search.next)}
      >
        <ChevronRight className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={onClose}
        aria-label={t(($) => $.preview.search.close)}
      >
        <X className="size-3.5" />
      </Button>
    </search>
  );
}
