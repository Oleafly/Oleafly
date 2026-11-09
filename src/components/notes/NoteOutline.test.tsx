// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { allowRadixSelect, chooseOption } from "@/features/collab/tests/select";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { NotesDataProvider, type NotesData } from "./notes-data";
import { NoteOutline } from "./NoteOutline";
import type { NoteSource } from "./types";

const copy = enNotes.graph.outline;
const logs = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError: logs.logError }));

const MARKDOWN = "# Intro\n## Methods\n### Data\n## Results\n";

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  callback: ResizeObserverCallback;
  targets: Element[] = [];
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  unobserve() {}
  disconnect() {
    this.targets = [];
  }
  fire() {
    this.callback([], this as unknown as ResizeObserver);
  }
}


function data(loadNote: NotesData["loadNote"]): NotesData {
  return {
    notes: [],
    artifacts: [],
    experiments: [],
    citations: [],
    papers: [],
    loadNote,
    saveNote: vi.fn(),
  };
}

function renderOutline(noteId: string | null, loadNote: NotesData["loadNote"] = vi.fn(() => Promise.resolve({ text: MARKDOWN, version: "1" }))) {
  const onOpenHeading = vi.fn();
  const utils = render(
    <NotesDataProvider value={data(loadNote)}>
      <NoteOutline noteId={noteId} onOpenHeading={onOpenHeading} />
    </NotesDataProvider>,
  );
  return { ...utils, onOpenHeading };
}

function editor(noteId: string, html: string): { container: HTMLElement; root: HTMLElement } {
  const host = document.createElement("div");
  host.dataset.noteView = noteId;
  host.innerHTML = `<div data-note-width="normal"><div class="note-body"><div class="ProseMirror">${html}</div></div></div>`;
  document.body.append(host);
  return {
    container: host.querySelector("[data-note-width]") as HTMLElement,
    root: host.querySelector(".ProseMirror") as HTMLElement,
  };
}

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  allowRadixSelect();
  logs.logError.mockReset();
});

afterEach(() => {
  for (const element of document.querySelectorAll("[data-note-view]")) element.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("NoteOutline", () => {
  it("asks for a note when none is open", () => {
    renderOutline(null);
    expect(screen.getByText(copy.noNote)).toBeInTheDocument();
  });

  it("lists headings from the saved note and opens one that is not on screen", async () => {
    const user = userEvent.setup();
    const { onOpenHeading } = renderOutline("n1");
    const nav = await screen.findByRole("navigation", { name: copy.title });
    expect(nav).toHaveTextContent("IntroMethodsDataResults");
    await user.click(screen.getByRole("button", { name: "Methods" }));
    expect(onOpenHeading).toHaveBeenCalledWith("n1", "methods");
    await user.click(screen.getByRole("button", { name: "Collapse Methods" }));
    expect(screen.queryByRole("button", { name: "Data" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand Methods" }));
    expect(screen.getByRole("button", { name: "Data" })).toBeInTheDocument();
    await chooseOption(user, copy.levels, "Up to H1");
    expect(screen.queryByRole("button", { name: "Methods" })).not.toBeInTheDocument();
    await chooseOption(user, copy.levels, copy.allLevels);
    expect(screen.getByRole("button", { name: "Methods" })).toBeInTheDocument();
  });

  it("follows the open editor, highlights the heading in view and scrolls to a heading", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const { container, root } = editor("n2", "<h1>Intro</h1><p>a</p><h2>Methods</h2>");
    const tops = new Map<string, number>([
      ["Intro", -200],
      ["Methods", 40],
    ]);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return { top: this === container ? 0 : (tops.get(this.textContent ?? "") ?? 900) } as DOMRect;
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
    renderOutline("n2", vi.fn(() => new Promise<NoteSource>(() => {})));
    expect(await screen.findByRole("button", { name: "Methods" })).toHaveAttribute("aria-current", "location");
    tops.set("Methods", 400);
    fireEvent.scroll(container);
    fireEvent.scroll(container);
    await waitFor(() => expect(screen.getByRole("button", { name: "Intro" })).toHaveAttribute("aria-current", "location"));
    fireEvent.click(screen.getByRole("button", { name: "Methods" }));
    expect(scrolled).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
    const added = document.createElement("h2");
    added.textContent = "Results";
    root.append(added);
    expect(await screen.findByRole("button", { name: "Results" })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("scrolls once the editor appears after opening the note", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    FakeResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { onOpenHeading } = renderOutline("n3");
    await act(() => vi.advanceTimersByTimeAsync(10));
    fireEvent.click(await screen.findByRole("button", { name: "Results" }));
    expect(onOpenHeading).toHaveBeenCalledWith("n3", "results");
    editor("n3", "<h1>Intro</h1><h2>Methods</h2><h3>Data</h3><h2>Results</h2>");
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(scrolled).toHaveBeenCalledWith({ block: "start", behavior: "auto" });
    document.querySelector('[data-note-view="n3"]')?.remove();
    act(() => FakeResizeObserver.instances.at(-1)?.fire());
    await act(() => vi.advanceTimersByTimeAsync(500));
    editor("n3", "<p>No headings now</p>");
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByText(copy.empty)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("reads an editor that has no scroll container and stops measuring when closed", async () => {
    const host = document.createElement("div");
    host.dataset.noteView = "n6";
    host.innerHTML = '<div class="ProseMirror"><h1>Alone</h1></div>';
    document.body.append(host);
    const pending = vi.fn(() => 7);
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", pending);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const { unmount } = renderOutline("n6", vi.fn(() => new Promise<NoteSource>(() => {})));
    expect(await screen.findByRole("button", { name: "Alone" })).not.toHaveAttribute("aria-current");
    unmount();
    expect(cancel).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    const { container, root } = editor("n7", "<h1>Scrolled</h1>");
    vi.stubGlobal("requestAnimationFrame", pending);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const second = renderOutline("n7", vi.fn(() => new Promise<NoteSource>(() => {})));
    await screen.findByRole("button", { name: "Scrolled" });
    fireEvent.scroll(container);
    second.unmount();
    expect(cancel).toHaveBeenCalledWith(7);
    expect(root.isConnected).toBe(true);
    vi.unstubAllGlobals();
  });

  it("logs a note that fails to load and shows no headings", async () => {
    renderOutline("n4", vi.fn(() => Promise.reject(new Error("gone"))));
    await waitFor(() => expect(logs.logError).toHaveBeenCalledWith("read the note outline", expect.any(Error)));
    expect(screen.getByText(copy.empty)).toBeInTheDocument();
  });

  it("drops a late load after the note changes", async () => {
    let finish: (value: { text: string; version: string }) => void = () => {};
    const loadNote = vi.fn(() => new Promise<{ text: string; version: string }>((resolve) => (finish = resolve)));
    const { unmount } = renderOutline("n5", loadNote);
    unmount();
    await act(async () => finish({ text: MARKDOWN, version: "1" }));
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});

describe("NoteOutline upkeep", () => {
  beforeEach(() => {
    FakeResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stops looking for the editor once it has found it, and looks again only after it goes away", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    editor("n8", "<h1>Found</h1>");
    const lookups = vi.spyOn(document, "querySelectorAll");
    renderOutline("n8", vi.fn(() => new Promise<NoteSource>(() => {})));
    expect(await screen.findByRole("button", { name: "Found" })).toBeInTheDocument();
    const afterAttach = lookups.mock.calls.filter(([selector]) => selector === "[data-note-view]").length;
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(lookups.mock.calls.filter(([selector]) => selector === "[data-note-view]").length).toBe(afterAttach);

    document.querySelector('[data-note-view="n8"]')?.remove();
    act(() => FakeResizeObserver.instances.at(-1)?.fire());
    editor("n8", "<h1>Back again</h1>");
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByRole("button", { name: "Back again" })).toBeInTheDocument();
  });

  it("reads the headings again only when a change touches a heading", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { root } = editor("n9", "<h1>Intro</h1><p>Body</p>");
    const reads = vi.spyOn(Element.prototype, "querySelectorAll");
    renderOutline("n9", vi.fn(() => new Promise<NoteSource>(() => {})));
    await screen.findByRole("button", { name: "Intro" });
    reads.mockClear();
    const caret = document.createElement("span");
    root.querySelector("p")?.append(caret);
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(reads).not.toHaveBeenCalled();
    const heading = document.createElement("h2");
    heading.textContent = "Methods";
    root.append(heading);
    expect(await screen.findByRole("button", { name: "Methods" })).toBeInTheDocument();
  });
});
