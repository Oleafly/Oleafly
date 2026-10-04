// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, type RefObject } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const width = vi.hoisted(() => ({ value: 0 }));

vi.mock("@/components/ui/toolbar-overflow", async (original) => ({
  ...(await original<typeof import("@/components/ui/toolbar-overflow")>()),
  useAvailableWidth: () => ({ containerRef: () => {}, availableWidth: width.value }),
}));

import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import { PdfToolbarControls, type PdfToolbarControlsProps } from "./PdfToolbarControls";

const copy = enPreview;

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  }
});

beforeEach(() => {
  width.value = 0;
});

function viewer() {
  const gotoPage = vi.fn();
  const ref = { current: { gotoPage } } as unknown as RefObject<never>;
  return { gotoPage, ref };
}

function props(overrides: Partial<PdfToolbarControlsProps> = {}): PdfToolbarControlsProps {
  const noop = () => {};
  return {
    isImage: false,
    hasDocument: true,
    numPages: 12,
    page: 4,
    pageInput: "4",
    setPageInput: noop,
    jumpToPage: noop,
    pdfRef: createRef(),
    layout: "single",
    setLayout: noop,
    outlineOpen: false,
    setOutlineOpen: noop,
    searchOpen: false,
    setSearchOpen: noop,
    searchInputRef: createRef(),
    setSearchInput: noop,
    scale: 1,
    setScale: noop,
    setClampedScale: noop,
    userZoom: (action: () => void) => action(),
    fitPreview: noop,
    exporting: false,
    exportDisplayedPreview: noop,
    downloadActionLabel: () => "Download",
    onSave: noop,
    inverted: false,
    setInverted: noop,
    screenReaderMode: false,
    setScreenReaderMode: noop,
    rotation: 0,
    rotationPending: false,
    onRotate: noop,
    isFs: false,
    setFsToolbarHidden: noop,
    toggleFullscreen: noop,
    onWindow: noop,
    onSettings: noop,
    ...overrides,
  } as PdfToolbarControlsProps;
}

async function openMore(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: copy.toolbar.more }));
}

describe("PdfToolbarControls collapsed into the overflow menu", () => {
  it("turns pages two at a time in the two-page view", async () => {
    const { gotoPage, ref } = viewer();
    render(<PdfToolbarControls {...props({ pdfRef: ref, layout: "double" })} />);
    const user = userEvent.setup();

    await openMore(user);
    await user.click(await screen.findByRole("menuitem", { name: "Page 4 of 12" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: copy.pages.next }));
    expect(gotoPage).toHaveBeenLastCalledWith(6);

    await openMore(user);
    await user.click(await screen.findByRole("menuitem", { name: "Page 4 of 12" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: copy.pages.previous }));
    expect(gotoPage).toHaveBeenLastCalledWith(2);
  });

  it("turns one page at a time in the single-page view", async () => {
    const { gotoPage, ref } = viewer();
    render(<PdfToolbarControls {...props({ pdfRef: ref })} />);
    const user = userEvent.setup();

    await openMore(user);
    await user.click(await screen.findByRole("menuitem", { name: "Page 4 of 12" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: copy.pages.previous }));

    expect(gotoPage).toHaveBeenCalledWith(3);
  });

  it("switches the page layout from the menu", async () => {
    const setLayout = vi.fn();
    render(<PdfToolbarControls {...props({ setLayout })} />);
    const user = userEvent.setup();

    await openMore(user);
    await user.click(await screen.findByRole("menuitem", { name: copy.pageLayout.group }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: copy.pageLayout.double }));
    expect(setLayout).toHaveBeenLastCalledWith("double");
  });

  it("goes back to one page from the two-page view", async () => {
    const setLayout = vi.fn();
    render(<PdfToolbarControls {...props({ setLayout, layout: "double" })} />);
    const user = userEvent.setup();

    await openMore(user);
    await user.click(await screen.findByRole("menuitem", { name: copy.pageLayout.group }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: copy.pageLayout.single }));
    expect(setLayout).toHaveBeenLastCalledWith("single");
  });

  it("zooms to a preset percentage", async () => {
    const setClampedScale = vi.fn();
    render(<PdfToolbarControls {...props({ setClampedScale })} />);
    const user = userEvent.setup();

    await openMore(user);
    await user.click(await screen.findByRole("menuitem", { name: "Zoom · 100%" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "50%" }));

    expect(setClampedScale).toHaveBeenCalledWith(0.5);
  });

  it.each([
    [false, copy.actions.downloadPdf],
    [true, copy.actions.downloadImage],
  ])("downloads the displayed preview (image: %s)", async (isImage, label) => {
    const exportDisplayedPreview = vi.fn();
    render(<PdfToolbarControls {...props({ isImage, exportDisplayedPreview })} />);
    const user = userEvent.setup();

    await openMore(user);
    await user.click(await screen.findByRole("menuitem", { name: label }));

    expect(exportDisplayedPreview).toHaveBeenCalledOnce();
  });
});

describe("PdfToolbarControls search toggle", () => {
  it("clears the search when the search bar closes", async () => {
    width.value = 4000;
    let open = true;
    const setSearchOpen = vi.fn((update: (value: boolean) => boolean) => {
      open = update(open);
    });
    const setSearchInput = vi.fn();
    render(<PdfToolbarControls {...props({ searchOpen: true, setSearchOpen: setSearchOpen as never, setSearchInput })} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: copy.search.open }));

    expect(open).toBe(false);
    expect(setSearchInput).toHaveBeenCalledWith("");
  });
});
