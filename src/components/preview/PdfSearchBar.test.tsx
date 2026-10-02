// @vitest-environment jsdom
import "@/i18n";
import { createRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import type { PdfSearchState, PdfViewerHandle } from "@/components/pdf/PdfViewer";
import { PdfSearchBar, pdfSearchCounterLabel } from "./PdfSearchBar";

const QUERY = "theorem";

function searchState(patch: Partial<PdfSearchState> = {}): PdfSearchState {
  return {
    status: "idle",
    query: "",
    current: 0,
    total: 0,
    scannedPages: 0,
    totalPages: 0,
    ...patch,
  };
}

function viewerRef() {
  const ref = createRef<PdfViewerHandle | null>() as { current: PdfViewerHandle | null };
  const findNext = vi.fn();
  const findPrevious = vi.fn();
  ref.current = { findNext, findPrevious } as unknown as PdfViewerHandle;
  return { ref, findNext, findPrevious };
}

function Harness({
  state,
  pdfRef,
  onClose = vi.fn(),
}: Readonly<{
  state: PdfSearchState;
  pdfRef: { current: PdfViewerHandle | null };
  onClose?: () => void;
}>) {
  const [query, setQuery] = useState("");
  const inputRef = createRef<HTMLInputElement>();
  return (
    <PdfSearchBar
      id="pdf-search-panel"
      inputRef={inputRef}
      query={query}
      onQueryChange={setQuery}
      state={state}
      pdfRef={pdfRef}
      onClose={onClose}
    />
  );
}

describe("pdfSearchCounterLabel", () => {
  it("reports scan progress while searching", () => {
    expect(pdfSearchCounterLabel(searchState({ status: "searching", scannedPages: 3, totalPages: 9 }), QUERY)).toBe("3/9");
  });

  it("reports the current match once there is a query", () => {
    expect(pdfSearchCounterLabel(searchState({ status: "success", current: 2, total: 5 }), QUERY)).toBe("2/5");
  });

  it("reads 0/0 for a blank query", () => {
    expect(pdfSearchCounterLabel(searchState({ status: "success", current: 2, total: 5 }), "   ")).toBe("0/0");
  });
});

describe("PdfSearchBar", () => {
  it("steps through matches from the buttons and the keyboard", async () => {
    const { ref, findNext, findPrevious } = viewerRef();
    const { container } = render(
      <Harness state={searchState({ status: "success", current: 1, total: 4 })} pdfRef={ref} />,
    );

    const panel = container.querySelector("search");
    expect(panel).toHaveAttribute("id", "pdf-search-panel");
    expect(panel).toHaveAttribute("aria-label", enPreview.search.panel);

    const input = screen.getByLabelText(enPreview.search.input);
    await userEvent.type(input, QUERY);
    expect(input).toHaveValue(QUERY);
    expect(screen.getByText("1/4")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(findNext).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(findPrevious).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: enPreview.search.next }));
    await userEvent.click(screen.getByRole("button", { name: enPreview.search.previous }));
    expect(findNext).toHaveBeenCalledTimes(2);
    expect(findPrevious).toHaveBeenCalledTimes(2);
  });

  it("keeps stepping off until there is a match", () => {
    const { ref, findNext } = viewerRef();
    const { rerender } = render(<Harness state={searchState({ status: "searching" })} pdfRef={ref} />);

    expect(screen.getByRole("button", { name: enPreview.search.next })).toBeDisabled();
    expect(screen.getByRole("button", { name: enPreview.search.previous })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText(enPreview.search.input), { key: "Enter" });
    expect(findNext).not.toHaveBeenCalled();

    rerender(<Harness state={searchState({ status: "success", total: 0 })} pdfRef={ref} />);
    expect(screen.getByRole("button", { name: enPreview.search.next })).toBeDisabled();
  });

  it("closes from its close button", async () => {
    const { ref } = viewerRef();
    const onClose = vi.fn();
    render(<Harness state={searchState()} pdfRef={ref} onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: enPreview.search.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
