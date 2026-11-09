// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { installIntersectionObserverStub } from "@/components/ui/test-intersection-observer";

const drawn = vi.hoisted(() => ({ icons: [] as string[] }));
vi.mock("./note-icons", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./note-icons")>();
  return {
    ...actual,
    NoteIcon: (props: Parameters<typeof actual.NoteIcon>[0]) => {
      drawn.icons.push(String(props.icon));
      return actual.NoteIcon(props);
    },
    NoteChip: (props: Parameters<typeof actual.NoteChip>[0]) => {
      drawn.icons.push(String(props.icon));
      return actual.NoteChip(props);
    },
  };
});

import { toggleNoteFavorite } from "./note-favorites";
import { type HomeLayout, saveHomeLayout, saveHomeSort } from "./note-home-prefs";
import { NotesHome } from "./NotesHome";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { NoteItem } from "./types";

const NOW = Date.now();
const SCROLLER_HEIGHT = 600;
const LIST_TOP = 100;
const CARD_HEIGHT = 300;
const ROW_HEIGHT = 56;
const TABLE_ROW_HEIGHT = 40;

function note(index: number, title = `Note ${index}`): NoteItem {
  return {
    id: `n${index}`,
    title,
    project: "Notes",
    updatedAt: NOW - index * 60_000,
    author: "you",
    summary: "",
    preview: `Body ${index}`,
  };
}

const NOTES = Array.from({ length: 200 }, (_, index) => note(index));

const DATA: NotesData = {
  notes: NOTES,
  artifacts: [],
  experiments: [],
  citations: [],
  papers: [],
  loadNote: vi.fn(),
  saveNote: vi.fn(),
  renameNote: vi.fn(async () => {}),
};

const iconFor = (item: NoteItem) => `i-${item.id}`;

function home(notes: readonly NoteItem[], onOpenNote: (id: string) => void = vi.fn(), onOpenNoteInNewTab?: (id: string) => void) {
  return (
    <NotesDataProvider value={{ ...DATA, notes }}>
      <NotesHome iconFor={iconFor} onOpenNote={onOpenNote} onOpenNoteInNewTab={onOpenNoteInNewTab} />
    </NotesDataProvider>
  );
}

function isScroller(element: Element): boolean {
  return element.classList.contains("@container");
}

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, left: 0, right: 900, width: 900, height, x: 0, y: top, toJSON: () => ({}) };
}

function itemHeight(element: Element): number {
  if (element.hasAttribute("data-note-list-row")) return ROW_HEIGHT;
  return element.tagName === "TR" ? TABLE_ROW_HEIGHT : CARD_HEIGHT;
}

function laidOutHome(tracks = "200px 200px 200px 200px") {
  let scrollTop = 0;
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
    return isScroller(this) ? SCROLLER_HEIGHT : 0;
  });
  vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) {
    return isScroller(this) ? scrollTop : 0;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (isScroller(this)) return rect(0, SCROLLER_HEIGHT);
    if (this.hasAttribute("data-row-window-item")) return rect(0, itemHeight(this));
    return rect(LIST_TOP - scrollTop, 0);
  });
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element: Element, pseudo?: string | null) => {
    const style = computed(element, pseudo);
    if (isScroller(element)) Object.defineProperty(style, "overflowY", { configurable: true, value: "auto" });
    if (element.classList.contains("grid-cols-1")) {
      Object.defineProperty(style, "gridTemplateColumns", { configurable: true, value: tracks });
    }
    return style;
  });
  return {
    scrollTo(top: number) {
      scrollTop = top;
      act(() => {
        document.querySelector(".\\@container")?.dispatchEvent(new Event("scroll"));
        for (const frame of frames.splice(0)) frame(0);
      });
    },
  };
}

function cardIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-note-card]")].map((card) => card.dataset.noteCard ?? "");
}

function rowIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-note-list-row]")].map((row) => row.dataset.noteListRow ?? "");
}

function tableIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-note-table-row]")].map((row) => row.dataset.noteTableRow ?? "");
}

function ids(from: number, to: number): string[] {
  return Array.from({ length: to - from }, (_, offset) => `n${from + offset}`);
}

function grid(): HTMLElement {
  return document.querySelector<HTMLElement>("[data-note-card]")?.closest<HTMLElement>(".grid") as HTMLElement;
}

function show(layout: HomeLayout) {
  saveHomeLayout(layout);
  saveHomeSort("edited");
}

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  localStorage.clear();
  drawn.icons.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  saveHomeLayout("grid");
});

describe("Notes Home windowing", () => {
  it("mounts only the grid rows in view, as many cards per row as the grid has columns", () => {
    show("grid");
    const layout = laidOutHome();
    render(home(NOTES));
    expect(cardIds()).toEqual(ids(0, 16));
    expect(grid().style.paddingTop).toBe("0px");
    expect(grid().style.paddingBottom).toBe(`${(50 - 4) * CARD_HEIGHT}px`);
    expect(grid().closest(".px-6")).toHaveClass("pb-4", "pt-2.5");
    expect(grid()).toHaveClass("gap-x-4");
    expect(document.querySelector("[data-row-window-item]")).toHaveClass("min-w-0", "pb-4");

    layout.scrollTo(3_100);
    expect(cardIds()).toEqual(ids(32, 56));
    expect(grid().style.paddingTop).toBe(`${8 * CARD_HEIGHT}px`);
  });

  it("follows the grid's own column count when the view narrows", () => {
    show("grid");
    laidOutHome("300px 300px");
    render(home(NOTES));
    expect(cardIds()).toEqual(ids(0, 8));
  });

  it("mounts only the list rows in view and moves them as the view scrolls", () => {
    show("list");
    const layout = laidOutHome();
    render(home(NOTES));
    expect(rowIds()).toEqual(ids(0, 23));
    const rows = document.querySelector("[data-note-list-row]")?.parentElement as HTMLElement;
    expect(rows.style.paddingBottom).toBe(`${(200 - 23) * ROW_HEIGHT}px`);
    expect(document.querySelector("[data-note-list-row]")).toHaveAttribute("data-row-window-item");

    layout.scrollTo(2_900);
    expect(rowIds()).toEqual(ids(38, 73));
    expect(rows.style.paddingTop).toBe(`${38 * ROW_HEIGHT}px`);
  });

  it("mounts only the table rows in view between spacer rows and keeps the row count for screen readers", () => {
    show("table");
    const layout = laidOutHome();
    render(home(NOTES));
    expect(tableIds()).toEqual(ids(0, 27));
    const table = screen.getByRole("table");
    expect(table).toHaveAttribute("aria-rowcount", "201");
    expect(within(table).getAllByRole("row")[0]).toHaveAttribute("aria-rowindex", "1");
    expect(document.querySelector('[data-note-table-row="n0"]')).toHaveAttribute("aria-rowindex", "2");
    const body = table.querySelector("tbody") as HTMLElement;
    expect(body.firstElementChild).toHaveAttribute("data-note-table-row", "n0");
    const after = body.lastElementChild as HTMLElement;
    expect(after).toHaveAttribute("aria-hidden", "true");
    expect(after.querySelector("td")).toHaveAttribute("colspan", "6");
    expect((after.querySelector("td") as HTMLElement).style.height).toBe(`${(200 - 27) * TABLE_ROW_HEIGHT}px`);

    layout.scrollTo(2_100);
    expect(tableIds()).toEqual(ids(38, 77));
    const before = body.firstElementChild as HTMLElement;
    expect(before).toHaveAttribute("aria-hidden", "true");
    expect((before.querySelector("td") as HTMLElement).style.height).toBe(`${38 * TABLE_ROW_HEIGHT}px`);
    expect(document.querySelector('[data-note-table-row="n38"]')).toHaveAttribute("aria-rowindex", "40");

    layout.scrollTo(100_000);
    expect(tableIds().at(-1)).toBe("n199");
    expect(body.lastElementChild).toHaveAttribute("data-note-table-row", "n199");
  });
});

describe("Notes Home redraws", () => {
  const changed = (notes: readonly NoteItem[]) => notes.map((item, index) => (index === 3 ? note(3, "Note 3, revised") : item));

  it.each([["grid"], ["list"], ["table"]] as const)("redraws only the changed note in the %s view", (layout) => {
    show(layout);
    laidOutHome();
    const view = render(home(NOTES));
    drawn.icons.length = 0;
    view.rerender(home(changed(NOTES)));
    expect(drawn.icons).toEqual(["i-n3"]);
    expect(screen.getAllByText("Note 3, revised").length).toBeGreaterThan(0);
  });

  it("keeps cards as they are when only the open handler changes, and opens with the newest one", () => {
    show("grid");
    laidOutHome();
    const first = vi.fn();
    const second = vi.fn();
    const view = render(home(NOTES, first));
    drawn.icons.length = 0;
    view.rerender(home(NOTES, second));
    expect(drawn.icons).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Note 2" }));
    expect(second).toHaveBeenCalledWith("n2");
    expect(first).not.toHaveBeenCalled();
  });

  it("opens in a new tab with the newest handler from the table", () => {
    show("table");
    laidOutHome();
    const first = vi.fn();
    const second = vi.fn();
    const view = render(home(NOTES, vi.fn(), first));
    view.rerender(home(NOTES, vi.fn(), second));
    fireEvent.click(screen.getByText("Note 4"), { ctrlKey: true });
    expect(second).toHaveBeenCalledWith("n4");
    expect(first).not.toHaveBeenCalled();
  });

  it("redraws the cards in view when a favorite changes so their stars stay right", () => {
    show("grid");
    laidOutHome();
    render(home(NOTES));
    act(() => toggleNoteFavorite("n5"));
    const card = document.querySelector('[data-note-card="n5"]') as HTMLElement;
    expect(within(card).getByRole("button", { name: enNotes.library.menu.unfavorite })).toBeInTheDocument();
  });
});

describe("Notes Home previews", () => {
  it("watches every card with one shared observer and stops watching cards once they are near", () => {
    const stub = installIntersectionObserverStub(() => false);
    const Stub = globalThis.IntersectionObserver;
    let made = 0;
    globalThis.IntersectionObserver = class extends Stub {
      constructor(...args: ConstructorParameters<typeof IntersectionObserver>) {
        super(...args);
        made += 1;
      }
    };
    try {
      show("grid");
      laidOutHome();
      const view = render(home(NOTES.slice(0, 6)));
      expect(made).toBe(1);
      expect(stub.observed()).toHaveLength(6);
      act(() => stub.setVisible((target) => (target as HTMLElement).dataset.noteCard === "n1"));
      expect(stub.observed()).toHaveLength(5);
      expect(document.querySelector('[data-note-card="n1"] [data-note-preview]')).toBeInTheDocument();
      act(() => stub.setVisible(() => true));
      expect(stub.observed()).toHaveLength(0);
      expect(document.querySelectorAll("[data-note-preview]")).toHaveLength(6);
      view.unmount();

      stub.setVisible(() => false);
      const again = render(home(NOTES.slice(0, 2)));
      expect(made).toBe(2);
      expect(stub.observed()).toHaveLength(2);
      again.unmount();
      expect(stub.observed()).toHaveLength(0);
    } finally {
      stub.restore();
    }
  });
});
