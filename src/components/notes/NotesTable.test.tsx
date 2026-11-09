// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { NoteTagCount } from "@/lib/tauri";

vi.mock("@/components/ui/mermaid-diagram", () => ({
  renderDiagram: vi.fn(() => Promise.resolve(document.createElementNS("http://www.w3.org/2000/svg", "svg"))),
}));

import { NOTE_HOME_COLUMNS_KEY, NOTE_HOME_LAYOUT_KEY, NOTE_HOME_TABLE_SORT_KEY, saveHomeLayout } from "./note-home-prefs";
import { NotesHome } from "./NotesHome";
import { NotesDataProvider, type NotesData } from "./notes-data";
import { formatValue, nextSort, NotesTable, propertyKeys, sortTableRows } from "./NotesTable";
import type { NoteItem } from "./types";
import { useVaultStore } from "./vault-store";

const copy = enNotes.vault.table;
const NOW = Date.now();

function note(id: string, title: string, extra: Partial<NoteItem> = {}): NoteItem {
  return { id, title, project: "Notes", updatedAt: NOW, author: "you", summary: "", ...extra };
}

const notes: NoteItem[] = [
  note("a", "Beta run", {
    updatedAt: NOW - 3000,
    relatedProjectId: "p1",
    project: "Vision",
    tags: ["ml"],
    properties: { status: "done", priority: 2, reviewed: true, authors: ["Ana", "Bo"], venue: "ICML", meta: { x: 1 } },
  }),
  note("b", "Alpha run", { updatedAt: NOW - 1000, properties: { status: "draft", priority: 10, reviewed: false } }),
  note("c", "Gamma run", { updatedAt: NOW - 2000, tags: ["draft", "ml/vision"], properties: { venue: null } }),
];

const tagsOf = (item: NoteItem) => item.tags ?? [];

function titles(): string[] {
  return [...document.querySelectorAll("[data-note-table-row]")].map((row) => row.getAttribute("data-note-table-row") ?? "");
}

function renderTable(rows = notes) {
  const handlers = { onOpenNote: vi.fn(), onOpenNoteInNewTab: vi.fn() };
  render(
    <NotesTable
      notes={rows}
      iconFor={(item) => item.icon}
      tagsOf={tagsOf}
      projectColor={(id) => (id ? "#123456" : null)}
      {...handlers}
    />,
  );
  return handlers;
}

beforeAll(async () => {
  await loadNamespace("notes");
  await loadNamespace("library");
});

beforeEach(() => {
  localStorage.removeItem(NOTE_HOME_COLUMNS_KEY);
  localStorage.removeItem(NOTE_HOME_TABLE_SORT_KEY);
  localStorage.removeItem(NOTE_HOME_LAYOUT_KEY);
});

afterEach(() => {
  useVaultStore.setState({ tag: null, tagRequest: 0 });
  saveHomeLayout("grid");
});

describe("table helpers", () => {
  it("lists the user's property keys in order, without the managed and built-in ones", () => {
    expect(propertyKeys(notes)).toEqual(["authors", "meta", "priority", "reviewed", "venue"]);
    expect(propertyKeys([note("x", "X")])).toEqual([]);
  });

  it("formats lists, booleans, objects and empty values", () => {
    expect(formatValue(["a", null, 2], "Yes", "No")).toBe("a, 2");
    expect(formatValue(true, "Yes", "No")).toBe("Yes");
    expect(formatValue(false, "Yes", "No")).toBe("No");
    expect(formatValue({ a: 1 }, "Yes", "No")).toBe('{"a":1}');
    expect(formatValue(undefined, "Yes", "No")).toBe("");
    expect(formatValue(3, "Yes", "No")).toBe("3");
  });

  it("sorts by text, numbers and time, keeping empty values last", () => {
    const ids = (key: string, descending: boolean) => sortTableRows(notes, { key, descending }, tagsOf).map((item) => item.id);
    expect(ids("title", false)).toEqual(["b", "a", "c"]);
    expect(ids("title", true)).toEqual(["c", "a", "b"]);
    expect(ids("edited", true)).toEqual(["b", "c", "a"]);
    expect(ids("prop:priority", false)).toEqual(["a", "b", "c"]);
    expect(ids("prop:priority", true)).toEqual(["b", "a", "c"]);
    expect(ids("status", false)).toEqual(["a", "b", "c"]);
    expect(ids("project", false)).toEqual(["a", "b", "c"]);
    expect(ids("tags", false)).toEqual(["c", "a", "b"]);
    expect(ids("prop:venue", true)).toEqual(["a", "b", "c"]);
    const twins = [note("y", "Same", { updatedAt: 1 }), note("x", "Same", { updatedAt: 1 })];
    expect(sortTableRows(twins, { key: "edited", descending: true }, tagsOf).map((item) => item.id)).toEqual(["y", "x"]);
  });

  it("flips the direction on the same column and starts new columns sensibly", () => {
    expect(nextSort({ key: "title", descending: false }, "title")).toEqual({ key: "title", descending: true });
    expect(nextSort({ key: "title", descending: false }, "edited")).toEqual({ key: "edited", descending: true });
    expect(nextSort({ key: "edited", descending: true }, "status")).toEqual({ key: "status", descending: false });
  });
});

describe("NotesTable", () => {
  it("shows title, tags, status, project and last edited, newest first", () => {
    renderTable();
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent);
    expect(headers.slice(0, 5)).toEqual([
      copy.columns.title,
      copy.columns.tags,
      copy.columns.status,
      copy.columns.project,
      copy.columns.edited,
    ]);
    expect(titles()).toEqual(["b", "c", "a"]);
    expect(screen.getByRole("columnheader", { name: copy.columns.edited })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByText("done")).toBeInTheDocument();
    expect(screen.getByText("Vision")).toBeInTheDocument();
    expect(screen.getAllByText("#ml")).toHaveLength(1);
  });

  it("sorts from the headers and remembers the choice", async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole("button", { name: copy.sortBy.replace("{{name}}", copy.columns.title) }));
    expect(titles()).toEqual(["b", "a", "c"]);
    expect(screen.getByRole("columnheader", { name: copy.columns.title })).toHaveAttribute("aria-sort", "ascending");
    await user.click(screen.getByRole("button", { name: copy.sortBy.replace("{{name}}", copy.columns.title) }));
    expect(titles()).toEqual(["c", "a", "b"]);
    expect(JSON.parse(localStorage.getItem(NOTE_HOME_TABLE_SORT_KEY) ?? "{}")).toEqual({ key: "title", descending: true });
  });

  it("adds and removes property columns from the menu", async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole("button", { name: copy.addColumn }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "authors",
      "meta",
      "priority",
      "reviewed",
      "venue",
    ]);
    await user.click(within(menu).getByRole("menuitem", { name: "reviewed" }));
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "authors" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("columnheader", { name: "reviewed" })).toBeInTheDocument();
    expect(screen.getByText(copy.yes)).toBeInTheDocument();
    expect(screen.getByText(copy.no)).toBeInTheDocument();
    expect(screen.getByText("Ana, Bo")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(NOTE_HOME_COLUMNS_KEY) ?? "[]")).toEqual(["reviewed", "authors"]);
    await user.click(screen.getByRole("button", { name: copy.addColumn }));
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "reviewed" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("columnheader", { name: "reviewed" })).not.toBeInTheDocument();
  });

  it("sorts by an added property and falls back when that column goes away", async () => {
    const user = userEvent.setup();
    localStorage.setItem(NOTE_HOME_COLUMNS_KEY, JSON.stringify(["priority"]));
    localStorage.setItem(NOTE_HOME_TABLE_SORT_KEY, JSON.stringify({ key: "prop:priority", descending: false }));
    renderTable();
    expect(titles()).toEqual(["a", "b", "c"]);
    await user.click(screen.getByRole("button", { name: copy.sortBy.replace("{{name}}", "priority") }));
    expect(titles()).toEqual(["b", "a", "c"]);
  });

  it("uses the default order when the saved sort names a missing column", () => {
    localStorage.setItem(NOTE_HOME_TABLE_SORT_KEY, JSON.stringify({ key: "prop:gone", descending: false }));
    renderTable();
    expect(titles()).toEqual(["b", "c", "a"]);
  });

  it("says when there are no other properties", async () => {
    const user = userEvent.setup();
    renderTable([note("x", "Plain")]);
    await user.click(screen.getByRole("button", { name: copy.addColumn }));
    expect(screen.getByRole("menuitem", { name: copy.noProperties })).toHaveAttribute("aria-disabled", "true");
  });

  it("opens notes, in a new tab with Mod, and filters by a clicked tag", async () => {
    const user = userEvent.setup();
    const handlers = renderTable();
    await user.click(screen.getByText("Alpha run"));
    expect(handlers.onOpenNote).toHaveBeenCalledWith("b");
    fireEvent.click(screen.getByText("Beta run"), { ctrlKey: true });
    expect(handlers.onOpenNoteInNewTab).toHaveBeenCalledWith("a");
    await user.click(screen.getByRole("button", { name: enNotes.vault.tags.filter.replace("{{tag}}", "ml/vision") }));
    expect(useVaultStore.getState().tag).toBe("ml/vision");
  });

  it("opens in place on Mod+click when there is no new-tab handler", () => {
    const onOpenNote = vi.fn();
    render(<NotesTable notes={notes} iconFor={() => undefined} tagsOf={tagsOf} projectColor={() => null} onOpenNote={onOpenNote} />);
    fireEvent.click(screen.getByText("Gamma run"), { ctrlKey: true });
    expect(onOpenNote).toHaveBeenCalledWith("c");
  });
});

describe("Notes Home table view", () => {
  function data(overrides: Partial<NotesData> = {}): NotesData {
    return {
      notes,
      artifacts: [],
      experiments: [],
      citations: [],
      papers: [],
      loadNote: vi.fn(),
      saveNote: vi.fn(),
      ...overrides,
    };
  }

  function renderHome(value: NotesData) {
    return render(
      <NotesDataProvider value={value}>
        <NotesHome iconFor={(item) => item.icon} onOpenNote={vi.fn()} />
      </NotesDataProvider>,
    );
  }

  it("switches to the table, hides the sort menu and remembers the layout", async () => {
    const user = userEvent.setup();
    renderHome(data());
    expect(screen.getByRole("button", { name: enNotes.home.sort.opened })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.view }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enNotes.home.sort.opened })).not.toBeInTheDocument();
    expect(localStorage.getItem(NOTE_HOME_LAYOUT_KEY)).toBe("table");
    expect(screen.getByRole("button", { name: enLibrary.home.gridView })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows every tag from the tag index, not only the ones in the note head", async () => {
    saveHomeLayout("table");
    const counts: NoteTagCount[] = [{ tag: "late", label: "Late", count: 1, notes: ["b"] }];
    renderHome(data({ noteTags: vi.fn(async () => counts) }));
    await waitFor(() => expect(screen.getByText("#Late")).toBeInTheDocument());
    expect(screen.queryByText("#ml")).not.toBeInTheDocument();
  });
});
