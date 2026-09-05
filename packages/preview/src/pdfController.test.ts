// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPdfView, gotoPdfPage, registerPdfView } from "./pdfController";

function mountPages(count: number) {
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  document.body.append(scroller);
  const pages = Array.from({ length: count }, (_, i) => {
    const el = document.createElement("div");
    scroller.append(el);
    return { pageNo: i + 1, el };
  });
  return pages;
}

afterEach(() => {
  clearPdfView();
  document.body.innerHTML = "";
});

describe("gotoPdfPage", () => {
  it("scrolls a mounted page into view", async () => {
    const pages = mountPages(3);
    const ensurePageRendered = vi.fn();
    registerPdfView({ pages, scale: 1, ensurePageRendered });

    await expect(gotoPdfPage(2)).resolves.toBe(true);
    expect(ensurePageRendered).toHaveBeenCalledWith(2);
  });

  it("gives up at once when no viewer is mounted", async () => {
    clearPdfView();
    await expect(gotoPdfPage(1)).resolves.toBe(false);
  });

  it("reports a page the document does not have", async () => {
    registerPdfView({ pages: mountPages(2), scale: 1 });
    await expect(gotoPdfPage(9)).resolves.toBe(false);
  });

  it("waits for a viewer that is still mounting", async () => {
    clearPdfView();
    const pending = gotoPdfPage(1, 1000);
    setTimeout(() => registerPdfView({ pages: mountPages(1), scale: 1 }), 150);
    await expect(pending).resolves.toBe(true);
  });
});
