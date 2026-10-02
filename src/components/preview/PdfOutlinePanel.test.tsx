// @vitest-environment jsdom
import "@/i18n";
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import type { PdfOutlineState, PdfViewerHandle } from "@/components/pdf/PdfViewer";
import { PdfOutlinePanel, PdfOutlineTree } from "./PdfOutlinePanel";

const INTRO = "Introduction";
const BACKGROUND = "Background";
const BLOCKED = "Blocked";
const NO_OUTLINE = "This document has no bookmarks";

const ITEMS: PdfOutlineState["items"] = [
  {
    id: "a",
    title: INTRO,
    external: false,
    children: [
      { id: "a1", title: BACKGROUND, external: true, children: [] },
      { id: "a2", title: BLOCKED, external: false, children: [], disabledReason: "No destination" },
    ],
  },
];

function viewerRef() {
  const ref = createRef<PdfViewerHandle | null>() as { current: PdfViewerHandle | null };
  const activateOutlineItem = vi.fn();
  ref.current = { activateOutlineItem } as unknown as PdfViewerHandle;
  return { ref, activateOutlineItem };
}

describe("PdfOutlinePanel", () => {
  it("shows progress while the outline loads", () => {
    const { ref } = viewerRef();
    render(
      <PdfOutlinePanel
        id="outline"
        open
        state={{ status: "loading", items: [] }}
        pdfRef={ref}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(enPreview.outline.loading)).toBeInTheDocument();
    expect(screen.queryByText(enPreview.outline.empty)).toBeNull();
  });

  it("explains an empty outline, preferring the viewer's own message", () => {
    const { ref } = viewerRef();
    const { rerender } = render(
      <PdfOutlinePanel
        id="outline"
        open
        state={{ status: "success", items: [] }}
        pdfRef={ref}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(enPreview.outline.empty)).toBeInTheDocument();

    rerender(
      <PdfOutlinePanel
        id="outline"
        open
        state={{ status: "unavailable", items: [], message: NO_OUTLINE }}
        pdfRef={ref}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(NO_OUTLINE)).toBeInTheDocument();
  });

  it("jumps to a picked entry and closes itself", async () => {
    const { ref, activateOutlineItem } = viewerRef();
    const onClose = vi.fn();
    render(
      <PdfOutlinePanel
        id="pdf-outline-panel"
        open
        state={{ status: "success", items: ITEMS }}
        pdfRef={ref}
        onClose={onClose}
      />,
    );

    const panel = screen.getByRole("complementary", { name: enPreview.outline.panel });
    expect(panel).toHaveAttribute("id", "pdf-outline-panel");
    expect(panel).toHaveClass("translate-x-0");
    expect(screen.getByLabelText(enPreview.outline.externalLink)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: BLOCKED })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(BACKGROUND) }));
    expect(activateOutlineItem).toHaveBeenCalledWith("a1");
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: enPreview.outline.close }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("slides away and leaves the tab order while closed", () => {
    const { ref } = viewerRef();
    const { container } = render(
      <PdfOutlinePanel
        id="outline"
        open={false}
        state={{ status: "success", items: ITEMS }}
        pdfRef={ref}
        onClose={vi.fn()}
      />,
    );
    const panel = container.querySelector("aside") as HTMLElement;
    expect(panel).toHaveClass("-translate-x-[calc(100%_+_1rem)]");
    expect(panel).toHaveAttribute("inert");
  });

  it("can list entries as a bordered tree with an external badge", async () => {
    const { ref, activateOutlineItem } = viewerRef();
    render(
      <PdfOutlinePanel
        id="detached-pdf-outline"
        open
        state={{ status: "success", items: ITEMS }}
        pdfRef={ref}
        onClose={vi.fn()}
        itemStyle="tree"
      />,
    );

    expect(screen.getByText(enPreview.outline.externalBadge)).toBeInTheDocument();
    expect(screen.queryByLabelText(enPreview.outline.externalLink)).toBeNull();
    const nested = screen.getByRole("button", { name: new RegExp(BACKGROUND) }).closest("ul");
    expect(nested).toHaveClass("ml-3", "border-l");

    await userEvent.click(screen.getByRole("button", { name: INTRO }));
    expect(activateOutlineItem).toHaveBeenCalledWith("a");
  });
});

describe("PdfOutlineTree", () => {
  it("disables entries the viewer cannot reach", () => {
    render(<PdfOutlineTree items={ITEMS} onActivate={vi.fn()} />);
    expect(screen.getByRole("button", { name: BLOCKED })).toBeDisabled();
    expect(screen.getByRole("button", { name: INTRO }).closest("ul")).not.toHaveClass("border-l");
  });
});
