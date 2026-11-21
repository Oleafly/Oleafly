// @vitest-environment jsdom

import type { Editor } from "@tiptap/core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { NoteOutlineRail } from "./NoteOutlineRail";
import "./tests/setup";

const copy = enNotes.graph.outline;
const NOTE_TITLE = "Field notes";

class FakeResizeObserver {
  static last: FakeResizeObserver | null = null;
  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.last = this;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  fire() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const geometry = { textRight: 600, tops: new Map<string, number>() };

function note(html: string) {
  const container = document.createElement("div");
  container.dataset.noteWidth = "standard";
  Object.defineProperty(container, "clientWidth", { value: 800 });
  const root = document.createElement("div");
  root.className = "ProseMirror";
  root.innerHTML = html;
  container.append(root);
  document.body.append(container);
  return { container, root, editor: { view: { dom: root } } as unknown as Editor };
}

function marks() {
  return [...screen.getByRole("button", { name: copy.title }).querySelectorAll("span")];
}

beforeEach(() => {
  geometry.textRight = 600;
  geometry.tops = new Map([
    ["Intro", -200],
    ["Methods", 40],
    ["Results", 900],
  ]);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.classList.contains("ProseMirror")) return { top: 0, right: geometry.textRight } as DOMRect;
    return { left: 0, top: geometry.tops.get(this.textContent ?? "") ?? 0 } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("NoteOutlineRail", () => {
  it("draws a mark per heading, lights the one being read and scrolls to the chosen one", async () => {
    const scrolled: (string | null)[] = [];
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
      scrolled.push(this.textContent);
    });
    const { editor } = note("<h1>Intro</h1><p>a</p><h2>Methods</h2><p>b</p><h1>Results</h1>");
    render(<NoteOutlineRail editor={editor} title={NOTE_TITLE} />);

    expect(marks()).toHaveLength(3);
    expect(marks()[1]).toHaveAttribute("data-current");
    fireEvent.click(screen.getByRole("button", { name: copy.title }));
    const outline = await screen.findByRole("dialog", { name: copy.title });
    expect(within(outline).getByText(NOTE_TITLE)).toBeInTheDocument();
    expect(within(outline).getByRole("button", { name: "Methods" })).toHaveAttribute("aria-current", "location");

    fireEvent.click(within(outline).getByRole("button", { name: "Results" }));
    expect(scrolled).toEqual(["Results"]);
    await waitFor(() => expect(marks()[2]).toHaveAttribute("data-current"));
  });

  it("follows headings as they are written", async () => {
    const { root, editor } = note("<h1>Intro</h1><h2>Methods</h2>");
    render(<NoteOutlineRail editor={editor} title={NOTE_TITLE} />);
    expect(marks()).toHaveLength(2);
    const added = document.createElement("h1");
    added.textContent = "Results";
    root.append(added);
    await waitFor(() => expect(marks()).toHaveLength(3));
  });

  it("stays out of the text when the note leaves no room beside it", () => {
    geometry.textRight = 780;
    const { editor } = note("<h1>Intro</h1><h2>Methods</h2>");
    render(<NoteOutlineRail editor={editor} title={NOTE_TITLE} />);
    expect(screen.queryByTestId("outline-rail")).toBeNull();

    geometry.textRight = 700;
    act(() => FakeResizeObserver.last?.fire());
    expect(screen.getByTestId("outline-rail")).toBeInTheDocument();
  });
});
