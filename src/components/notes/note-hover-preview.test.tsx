// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import type { LinkableNote } from "./note-links";
import { HIDE_DELAY_MS, hoverPlacement, HOVER_DELAY_MS, NoteHoverPreview } from "./note-hover-preview";

const NOTES: LinkableNote[] = [
  { noteId: "n-1", projectId: "lib-1", title: "Masking", icon: "🧪" },
  { noteId: "n-2", projectId: "lib-2", title: "Sections" },
  { noteId: "n-3", projectId: "lib-3", title: "Blank" },
];

const LINKS: readonly (readonly [string, string, string | undefined])[] = [
  ["n-1", "Masking", undefined],
  ["n-2", "Results", "results"],
  ["n-3", "Blank", undefined],
  ["gone", "Gone", undefined],
];
const PLAIN = "plain";

function Harness({ loadText }: Readonly<{ loadText: (projectId: string) => Promise<string> }>) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} data-testid="scroller">
      <p>
        {LINKS.map(([id, label, heading]) => (
          <span key={id} className="note-link" data-note-link="note" data-note-id={id} data-note-heading={heading}>
            {label}
          </span>
        ))}
        <span data-testid="plain">{PLAIN}</span>
      </p>
      <NoteHoverPreview
        containerRef={ref}
        getNotes={() => NOTES}
        previewOf={(projectId) => (projectId === "lib-1" ? "Masked **patches** work." : projectId === "lib-3" ? "" : undefined)}
        loadText={loadText}
      />
    </div>
  );
}

function link(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-note-id="${id}"]`) as HTMLElement;
}

function hover(id: string) {
  fireEvent.mouseOver(link(id));
  act(() => {
    vi.advanceTimersByTime(HOVER_DELAY_MS);
  });
}

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("hover previews", () => {
  it("shows a note after a pause and keeps it open while the pointer is inside", () => {
    render(<Harness loadText={vi.fn()} />);
    fireEvent.mouseOver(link("n-1"));
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(HOVER_DELAY_MS);
    });
    const card = screen.getByRole("tooltip");
    expect(card.textContent).toContain("patches");
    fireEvent.mouseOver(link("n-1"));
    fireEvent.mouseOut(link("n-1"), { relatedTarget: card });
    fireEvent.mouseEnter(card);
    act(() => {
      vi.advanceTimersByTime(HIDE_DELAY_MS * 2);
    });
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.mouseLeave(card);
    act(() => {
      vi.advanceTimersByTime(HIDE_DELAY_MS);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("loads a heading section, and closes on Escape and on a click", async () => {
    const loadText = vi.fn(() => Promise.resolve("# Intro\nx\n# Results\nAll good.\n"));
    render(<Harness loadText={loadText} />);
    hover("n-2");
    expect(screen.getByText(enNotes.kb.hover.loading)).toBeTruthy();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("tooltip").textContent).toContain("All good.");
    fireEvent.keyDown(document, { key: "a" });
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    hover("n-1");
    fireEvent.mouseDown(screen.getByTestId("plain"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("says when there is nothing to show and ignores unknown notes and plain text", async () => {
    const loadText = vi.fn(() => Promise.reject(new Error("no")));
    render(<Harness loadText={loadText} />);
    hover("n-3");
    expect(screen.getByText(enNotes.kb.hover.empty)).toBeTruthy();
    fireEvent.mouseOut(link("n-3"), { relatedTarget: screen.getByTestId("plain") });
    act(() => {
      vi.advanceTimersByTime(HIDE_DELAY_MS);
    });
    hover("gone");
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseOver(screen.getByTestId("plain"));
    fireEvent.mouseOut(screen.getByTestId("plain"));
    hover("n-2");
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText(enNotes.kb.hover.empty)).toBeTruthy();
  });

  it("places the card below a link, or above it near the bottom edge", () => {
    expect(hoverPlacement({ left: 900, top: 100, bottom: 120 }, { width: 1000, height: 800 })).toEqual({ left: 640, top: 126 });
    expect(hoverPlacement({ left: 0, top: 700, bottom: 720 }, { width: 1000, height: 800 })).toEqual({ left: 8, bottom: 106 });
  });
});
