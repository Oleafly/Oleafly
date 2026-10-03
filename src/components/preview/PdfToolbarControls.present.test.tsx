// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/toolbar-overflow", async (original) => ({
  ...(await original<typeof import("@/components/ui/toolbar-overflow")>()),
  useAvailableWidth: () => ({ containerRef: () => {}, availableWidth: 4000 }),
}));

import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import { PdfToolbarControls, type PdfToolbarControlsProps } from "./PdfToolbarControls";

const copy = enPreview.presentation;

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  }
});

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
    userZoom: noop,
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
  };
}

describe("PdfToolbarControls present menu", () => {
  it.each([
    [copy.presentFromStart, "start"],
    [copy.presentFromPage, "page"],
    [copy.presentWithPresenter, "presenter"],
  ])("offers %s", async (label, mode) => {
    const onPresent = vi.fn();
    render(<PdfToolbarControls {...props({ onPresent })} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: copy.present }));
    await user.click(await screen.findByRole("menuitem", { name: label }));
    expect(onPresent).toHaveBeenCalledWith(mode);
  });

  it("is absent for images, empty previews and callers that cannot present", () => {
    const { rerender } = render(<PdfToolbarControls {...props()} />);
    expect(screen.queryByRole("button", { name: copy.present })).toBeNull();
    rerender(<PdfToolbarControls {...props({ onPresent: vi.fn(), isImage: true })} />);
    expect(screen.queryByRole("button", { name: copy.present })).toBeNull();
    rerender(<PdfToolbarControls {...props({ onPresent: vi.fn(), hasDocument: false })} />);
    expect(screen.queryByRole("button", { name: copy.present })).toBeNull();
  });
});
