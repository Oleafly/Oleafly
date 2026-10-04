// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPdfView,
  gotoPdfPage,
  gotoRect,
  pageClickToBp,
  registerPdfView,
  setPdfLogger,
} from "./pdfController";

function box(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

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
  setPdfLogger(() => {});
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

describe("gotoPdfPage scrolling", () => {
  function scrollablePane(pages: Array<{ el: HTMLElement }>, scrollTop: number) {
    const scroller = pages[0].el.parentElement as HTMLElement;
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 3_000 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 600 });
    scroller.scrollTop = scrollTop;
    scroller.getBoundingClientRect = () => box(0, 50, 800, 600);
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as typeof scroller.scrollTo;
    return scrollTo;
  }

  it("centres the page inside its own scroll pane", async () => {
    const pages = mountPages(3);
    const scrollTo = scrollablePane(pages, 100);
    pages[2].el.getBoundingClientRect = () => box(0, 900, 600, 200);
    registerPdfView({ pages, scale: 1 });

    await expect(gotoPdfPage(3)).resolves.toBe(true);

    expect(scrollTo).toHaveBeenCalledWith({ top: 750, behavior: "smooth" });
  });

  it("never scrolls above the start of the pane", async () => {
    const pages = mountPages(2);
    const scrollTo = scrollablePane(pages, 10);
    pages[0].el.getBoundingClientRect = () => box(0, -400, 600, 200);
    registerPdfView({ pages, scale: 1 });

    await gotoPdfPage(1);

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("logs the pages it had when the target never appears", async () => {
    const log = vi.fn();
    setPdfLogger(log);
    registerPdfView({ pages: mountPages(2), scale: 1 });

    await expect(gotoPdfPage(9)).resolves.toBe(false);
    clearPdfView();
    await expect(gotoPdfPage(1)).resolves.toBe(false);

    expect(log.mock.calls).toEqual([
      ["pdf goto page", "no page element for page 9 (have pages: 1,2)"],
      ["pdf goto page", "no page element for page 1 (have pages: none)"],
    ]);
  });
});

describe("gotoRect", () => {
  let animate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    animate = vi.fn(() => ({ onfinish: null as (() => void) | null }));
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: animate,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(HTMLElement.prototype, "animate");
  });

  it("highlights the SyncTeX box at the viewer scale and fades it out", () => {
    const pages = mountPages(2);
    const ensurePageRendered = vi.fn();
    registerPdfView({ pages, scale: 2, ensurePageRendered });

    gotoRect({ page: 2, x: 10, y: 20, width: 30, height: 4 });

    const highlight = pages[1].el.querySelector<HTMLElement>(".ll-synctex-hl");
    expect(ensurePageRendered).toHaveBeenCalledWith(2);
    expect(pages[1].el.style.position).toBe("relative");
    expect(highlight).toHaveStyle({ left: "20px", top: "40px", width: "60px", height: "16px" });
    expect(animate).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], {
      duration: 120,
      fill: "forwards",
    });

    vi.advanceTimersByTime(1_800);
    expect(animate).toHaveBeenLastCalledWith([{ opacity: 1 }, { opacity: 0 }], {
      duration: 450,
      fill: "forwards",
    });
    animate.mock.results.at(-1)?.value.onfinish();
    expect(highlight?.isConnected).toBe(false);
  });

  it("keeps a single highlight per page and its own height when tall enough", () => {
    const pages = mountPages(1);
    registerPdfView({ pages, scale: 1 });

    gotoRect({ page: 1, x: 0, y: 0, width: 10, height: 4 });
    gotoRect({ page: 1, x: 5, y: 6, width: 10, height: 12 });

    const highlights = pages[0].el.querySelectorAll<HTMLElement>(".ll-synctex-hl");
    expect(highlights).toHaveLength(1);
    expect(highlights[0]).toHaveStyle({ left: "5px", top: "6px", height: "12px" });
  });

  it("waits for a page that registers while it retries", () => {
    clearPdfView();
    gotoRect({ page: 1, x: 1, y: 1, width: 1, height: 1 });
    vi.advanceTimersByTime(300);
    const pages = mountPages(1);
    registerPdfView({ pages, scale: 1 });

    vi.advanceTimersByTime(150);

    expect(pages[0].el.querySelector(".ll-synctex-hl")).not.toBeNull();
  });

  it("logs a miss after twenty retries", () => {
    const log = vi.fn();
    setPdfLogger(log);
    registerPdfView({ pages: mountPages(1), scale: 1 });

    gotoRect({ page: 4, x: 1, y: 1, width: 1, height: 1 });
    vi.advanceTimersByTime(150 * 19);
    expect(log).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);

    expect(log).toHaveBeenCalledWith(
      "synctex forward",
      "no page element for page 4 (have pages: 1)",
    );
    clearPdfView();
    gotoRect({ page: 2, x: 1, y: 1, width: 1, height: 1 });
    vi.advanceTimersByTime(150 * 20);
    expect(log).toHaveBeenLastCalledWith(
      "synctex forward",
      "no page element for page 2 (have pages: none)",
    );
  });
});

describe("pageClickToBp", () => {
  it("converts a click to PDF points at the registered scale", () => {
    const [page] = mountPages(1);
    page.el.getBoundingClientRect = () => box(10, 20, 200, 300);
    registerPdfView({ pages: [page], scale: 2 });

    expect(pageClickToBp(page.el, 1, { clientX: 110, clientY: 120 })).toEqual({
      page: 1,
      x: 50,
      y: 50,
    });
  });

  it.each([
    ["left of", 5, 120],
    ["above", 110, 15],
    ["right of", 215, 120],
    ["below", 110, 325],
  ])("ignores a click %s the page", (_label, clientX, clientY) => {
    const [page] = mountPages(1);
    page.el.getBoundingClientRect = () => box(10, 20, 200, 300);
    registerPdfView({ pages: [page], scale: 1 });

    expect(pageClickToBp(page.el, 1, { clientX, clientY })).toBeNull();
  });
});
