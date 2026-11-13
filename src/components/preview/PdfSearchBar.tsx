import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { PdfSearchState, PdfViewerHandle } from "@/components/pdf/PdfViewer";
import { FindBar } from "@/components/ui/find-bar";

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
  const { t } = useTranslation(["preview"]);
  return (
    <FindBar
      id={id}
      aria-label={t(($) => $.preview.search.panel)}
      className="absolute right-2 top-2 z-30 max-w-[calc(100%-1rem)]"
      inputRef={inputRef}
      value={query}
      onValueChange={onQueryChange}
      inputLabel={t(($) => $.preview.search.input)}
      placeholder={t(($) => $.preview.search.placeholder)}
      status={pdfSearchCounterLabel(state, query)}
      stepDisabled={state.status !== "success" || state.total === 0}
      onStep={(forward) => {
        if (state.status !== "success") return;
        if (forward) pdfRef.current?.findNext();
        else pdfRef.current?.findPrevious();
      }}
      onClose={onClose}
      labels={{
        previous: t(($) => $.preview.search.previous),
        next: t(($) => $.preview.search.next),
        close: t(($) => $.preview.search.close),
      }}
    />
  );
}
