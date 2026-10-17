// @vitest-environment jsdom
import { useRef, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PdfRotation } from "@/components/pdf/PdfViewer";
import { usePdfKeyboardShortcuts } from "./use-pdf-keyboard-shortcuts";

const ROOT = "pdf-root";
const SEARCH_LABEL = "Search the PDF";
const PAGE_LABEL = "Page";
const STATE = "pdf-state";
const PAGE = "pdf-page";

interface Snapshot {
  searchOpen: boolean;
  searchInput: string;
  outlineOpen: boolean;
  rotation: PdfRotation;
}

function Harness({
  enabled = true,
  initialSearchOpen = false,
  initialOutlineOpen = false,
}: Readonly<{
  enabled?: boolean;
  initialSearchOpen?: boolean;
  initialOutlineOpen?: boolean;
}>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(initialSearchOpen);
  const [searchInput, setSearchInput] = useState(initialSearchOpen ? "query" : "");
  const [outlineOpen, setOutlineOpen] = useState(initialOutlineOpen);
  const [rotation, setRotation] = useState<PdfRotation>(0);
  usePdfKeyboardShortcuts({
    rootRef,
    enabled,
    searchOpen,
    outlineOpen,
    searchInputRef,
    setSearchOpen,
    setSearchInput,
    setOutlineOpen,
    setRotation,
  });
  const snapshot: Snapshot = { searchOpen, searchInput, outlineOpen, rotation };
  return (
    <div ref={rootRef} tabIndex={-1} data-testid={ROOT}>
      <input ref={searchInputRef} aria-label={SEARCH_LABEL} />
      <input aria-label={PAGE_LABEL} />
      <div data-testid={PAGE} />
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

  it("rotates with Mod+Shift+R and leaves the zoom keys to the app", () => {
    render(<Harness />);
    expect(press("=", { metaKey: true })).toBe(true);
    expect(press("-", { ctrlKey: true })).toBe(true);
    expect(press("0", { metaKey: true })).toBe(true);

    press("R", { metaKey: true, shiftKey: true });
    press("r", { ctrlKey: true, shiftKey: true });
    expect(snapshot().rotation).toBe(180);
    for (let turn = 0; turn < 2; turn += 1) press("r", { ctrlKey: true, shiftKey: true });
    expect(snapshot().rotation).toBe(0);
  });

  it("ignores rotation typed into a field", () => {
    render(<Harness />);
    const field = screen.getByLabelText(PAGE_LABEL);
    press("r", { metaKey: true, shiftKey: true }, field);
    expect(snapshot().rotation).toBe(0);

    press("Escape", {}, field);
    press("f", { metaKey: true }, field);
    expect(snapshot().searchOpen).toBe(true);
  });

  it("keeps keyboard focus in the preview when a re-render removes the focused page text", async () => {
    render(<Harness />);
    const text = document.createElement("div");
    text.tabIndex = -1;
    screen.getByTestId(PAGE).append(text);
    act(() => text.focus());
    expect(text).toHaveFocus();

    act(() => text.remove());
    await waitFor(() => expect(screen.getByTestId(ROOT)).toHaveFocus());
  });

  it("lets focus leave for good once the user clicks outside the preview", async () => {
    render(<Harness />);
    const outside = document.createElement("button");
    document.body.append(outside);
    const text = document.createElement("div");
    text.tabIndex = -1;
    screen.getByTestId(PAGE).append(text);
    act(() => text.focus());

    fireEvent.pointerDown(outside);
    act(() => {
      text.blur();
      text.remove();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId(ROOT)).not.toHaveFocus();
    outside.remove();
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
