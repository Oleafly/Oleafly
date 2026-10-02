// @vitest-environment jsdom
import { useRef, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PdfRotation } from "@/components/pdf/PdfViewer";
import { MAX_PREVIEW_SCALE, MIN_PREVIEW_SCALE } from "./preview-zoom";
import { usePdfKeyboardShortcuts, zoomKeyAction } from "./use-pdf-keyboard-shortcuts";

const ROOT = "pdf-root";
const SEARCH_LABEL = "Search the PDF";
const PAGE_LABEL = "Page";
const STATE = "pdf-state";

interface Snapshot {
  searchOpen: boolean;
  searchInput: string;
  outlineOpen: boolean;
  scale: number;
  rotation: PdfRotation;
}

function Harness({
  enabled = true,
  zoomShortcuts = true,
  initialSearchOpen = false,
  initialOutlineOpen = false,
  initialScale = 1,
  userZoom = (mutate: () => void) => mutate(),
}: Readonly<{
  enabled?: boolean;
  zoomShortcuts?: boolean;
  initialSearchOpen?: boolean;
  initialOutlineOpen?: boolean;
  initialScale?: number;
  userZoom?: (mutate: () => void) => void;
}>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(initialSearchOpen);
  const [searchInput, setSearchInput] = useState(initialSearchOpen ? "query" : "");
  const [outlineOpen, setOutlineOpen] = useState(initialOutlineOpen);
  const [scale, setScale] = useState(initialScale);
  const [rotation, setRotation] = useState<PdfRotation>(0);
  usePdfKeyboardShortcuts({
    rootRef,
    enabled,
    searchOpen,
    outlineOpen,
    zoomShortcuts,
    searchInputRef,
    setSearchOpen,
    setSearchInput,
    setOutlineOpen,
    setScale,
    setRotation,
    userZoom,
  });
  const snapshot: Snapshot = { searchOpen, searchInput, outlineOpen, scale, rotation };
  return (
    <div ref={rootRef} data-testid={ROOT}>
      <input ref={searchInputRef} aria-label={SEARCH_LABEL} />
      <input aria-label={PAGE_LABEL} />
      <output data-testid={STATE}>{JSON.stringify(snapshot)}</output>
    </div>
  );
}

function snapshot(): Snapshot {
  return JSON.parse(screen.getByTestId(STATE).textContent ?? "{}") as Snapshot;
}

function press(key: string, init: Partial<KeyboardEventInit> = {}, target?: HTMLElement) {
  return fireEvent.keyDown(target ?? screen.getByTestId(ROOT), { key, ...init });
}

describe("zoomKeyAction", () => {
  it("maps the zoom keys and clamps at the preview limits", () => {
    let scale = 1;
    const setScale = (next: number | ((current: number) => number)) => {
      scale = typeof next === "function" ? next(scale) : next;
    };
    zoomKeyAction("+", setScale)?.();
    expect(scale).toBeCloseTo(1.2);
    zoomKeyAction("=", setScale)?.();
    expect(scale).toBeCloseTo(1.4);
    zoomKeyAction("-", setScale)?.();
    expect(scale).toBeCloseTo(1.2);
    zoomKeyAction("0", setScale)?.();
    expect(scale).toBe(1);

    scale = MAX_PREVIEW_SCALE;
    zoomKeyAction("+", setScale)?.();
    expect(scale).toBe(MAX_PREVIEW_SCALE);
    scale = MIN_PREVIEW_SCALE;
    zoomKeyAction("-", setScale)?.();
    expect(scale).toBe(MIN_PREVIEW_SCALE);

    expect(zoomKeyAction("a", setScale)).toBeNull();
  });
});

describe("usePdfKeyboardShortcuts", () => {
  it("opens search on Mod+F and focuses its field", async () => {
    render(<Harness />);
    const event = press("f", { ctrlKey: true });
    expect(event).toBe(false);
    expect(snapshot().searchOpen).toBe(true);
    await waitFor(() => expect(screen.getByLabelText(SEARCH_LABEL)).toHaveFocus());
  });

  it("closes search first and the outline second on Escape", () => {
    render(<Harness initialSearchOpen initialOutlineOpen />);
    press("Escape");
    expect(snapshot()).toMatchObject({ searchOpen: false, searchInput: "", outlineOpen: true });
    press("Escape");
    expect(snapshot().outlineOpen).toBe(false);
  });

  it("zooms and rotates through userZoom when the shortcuts are on", () => {
    const userZoom = vi.fn((mutate: () => void) => mutate());
    render(<Harness userZoom={userZoom} />);

    press("=", { metaKey: true });
    expect(userZoom).toHaveBeenCalledTimes(1);
    expect(snapshot().scale).toBeCloseTo(1.2);
    press("0", { ctrlKey: true });
    expect(snapshot().scale).toBe(1);

    press("R", { metaKey: true, shiftKey: true });
    press("r", { ctrlKey: true, shiftKey: true });
    expect(snapshot().rotation).toBe(180);
    for (let turn = 0; turn < 2; turn += 1) press("r", { ctrlKey: true, shiftKey: true });
    expect(snapshot().rotation).toBe(0);
  });

  it("leaves zoom keys alone when the shortcuts are off or no modifier is held", () => {
    const userZoom = vi.fn();
    render(<Harness zoomShortcuts={false} userZoom={userZoom} />);
    expect(press("=", { metaKey: true })).toBe(true);
    press("-");
    expect(userZoom).not.toHaveBeenCalled();
    expect(snapshot().scale).toBe(1);
  });

  it("ignores zoom and rotation typed into a field", () => {
    const userZoom = vi.fn();
    render(<Harness userZoom={userZoom} />);
    const field = screen.getByLabelText(PAGE_LABEL);
    press("=", { metaKey: true }, field);
    press("r", { metaKey: true, shiftKey: true }, field);
    expect(userZoom).not.toHaveBeenCalled();
    expect(snapshot().rotation).toBe(0);

    press("Escape", {}, field);
    press("f", { metaKey: true }, field);
    expect(snapshot().searchOpen).toBe(true);
  });

  it("does nothing while disabled and resumes once enabled", () => {
    const { rerender } = render(<Harness enabled={false} />);
    press("f", { ctrlKey: true });
    expect(snapshot().searchOpen).toBe(false);

    rerender(<Harness enabled />);
    act(() => {
      press("f", { ctrlKey: true });
    });
    expect(snapshot().searchOpen).toBe(true);
  });
});
