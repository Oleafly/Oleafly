// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const width = vi.hoisted(() => ({ value: 10_000 }));

vi.mock("@/components/ui/toolbar-overflow", async (original) => ({
  ...(await original<typeof import("@/components/ui/toolbar-overflow")>()),
  useAvailableWidth: () => ({ containerRef: () => {}, availableWidth: width.value }),
}));

import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import { PdfToolbarControls, type PdfToolbarControlsProps } from "./PdfToolbarControls";
import type { PdfSyncToggle } from "./use-pdf-sync";

const copy = enPreview;

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  }
});

beforeEach(() => {
  width.value = 10_000;
});

function toggle(overrides: Partial<PdfSyncToggle> = {}): PdfSyncToggle {
  return {
    enabled: false,
    busy: false,
    path: null,
    note: null,
    refresh: vi.fn(),
    setEnabled: vi.fn(),
    ...overrides,
  };
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

describe("the PDF save control", () => {
  it("opens a menu with the save action above the one-line sync toggle", async () => {
    const onSave = vi.fn();
    const pdfSync = toggle();
    render(<PdfToolbarControls {...props({ onSave, pdfSync })} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: copy.actions.savePdf }));
    expect(onSave).not.toHaveBeenCalled();
    expect(pdfSync.refresh).toHaveBeenCalledOnce();

    const save = await screen.findByRole("menuitem", { name: copy.actions.savePdf });
    const sync = screen.getByRole("menuitemcheckbox", { name: copy.sync.toggle });
    expect(sync).toHaveAttribute("aria-checked", "false");
    expect(sync.textContent).toBe(copy.sync.toggle);
    expect(save.compareDocumentPosition(sync) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(save);
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("keeps the menu open when the toggle flips", async () => {
    const pdfSync = toggle({ enabled: true, path: "Thesis.pdf" });
    render(<PdfToolbarControls {...props({ pdfSync })} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: copy.actions.savePdf }));
    const sync = await screen.findByRole("menuitemcheckbox", { name: copy.sync.toggle });
    expect(sync).toHaveAttribute("aria-checked", "true");
    expect(sync).toHaveAttribute("title", "Thesis.pdf");

    await user.click(sync);
    expect(pdfSync.setEnabled).toHaveBeenCalledWith(false);
    expect(screen.getByRole("menuitemcheckbox", { name: copy.sync.toggle })).toBeInTheDocument();
  });

  it("explains a problem below the toggle", async () => {
    const note = "Couldn't update Thesis.pdf.";
    render(<PdfToolbarControls {...props({ pdfSync: toggle({ enabled: true, note }) })} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: copy.actions.savePdf }));
    expect(await screen.findByText(note)).toBeInTheDocument();
  });

  it("lets the toggle be set before the first PDF exists", async () => {
    render(<PdfToolbarControls {...props({ hasDocument: false, pdfSync: toggle() })} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: copy.actions.savePdf }));
    expect(await screen.findByRole("menuitem", { name: copy.actions.savePdf })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("menuitemcheckbox", { name: copy.sync.toggle })).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("shows the same two rows in the overflow menu", async () => {
    width.value = 0;
    const onSave = vi.fn();
    const pdfSync = toggle();
    render(<PdfToolbarControls {...props({ onSave, pdfSync })} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: copy.toolbar.more }));
    expect(pdfSync.refresh).toHaveBeenCalledOnce();
    await user.click(await screen.findByRole("menuitemcheckbox", { name: copy.sync.toggle }));
    expect(pdfSync.setEnabled).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole("menuitem", { name: copy.actions.savePdf }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  });

  it("stays a plain button for images and when sync isn't available", async () => {
    const onSave = vi.fn();
    const { rerender } = render(<PdfToolbarControls {...props({ onSave, pdfSync: null })} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: copy.actions.savePdf }));
    expect(onSave).toHaveBeenCalledTimes(1);

    rerender(<PdfToolbarControls {...props({ onSave, isImage: true, pdfSync: toggle() })} />);
    await user.click(screen.getByRole("button", { name: copy.actions.saveImage }));
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("menuitemcheckbox")).toBeNull();
  });
});
