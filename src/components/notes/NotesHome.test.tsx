// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { formatRelativeTimeFrom } from "@/lib/intl";
import { installIntersectionObserverStub, type IntersectionObserverStub } from "@/components/ui/test-intersection-observer";
import { fakeNotesData } from "./tests/notes-data-fixture";
import "./tests/setup";
vi.mock("@/components/ui/mermaid-diagram", () => ({
  renderDiagram: vi.fn(() => Promise.resolve(document.createElementNS("http://www.w3.org/2000/svg", "svg"))),
}));

import { NotesHome } from "./NotesHome";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { NoteItem } from "./types";
import { useNotesPrefsStore } from "@/store/notes-prefs";

const copy = enNotes.home;
const menuCopy = enNotes.library.menu;
const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const notes: NoteItem[] = [
  {
    id: "n1",
    title: "Masking ablation",
    project: "Vision",
    relatedProjectId: "p-vision",
    updatedAt: NOW - HOUR,
    createdAt: NOW - 5 * DAY,
    author: "agent",
    agent: "Codex",
    icon: "🧪",
    color: "mint",
    summary: "Masking ratio sweep",
    preview: "## Where things stand\n\nMasking ratio sweep across three seeds.\n\n| Run | Ratio |\n| --- | --- |\n| 1 | 0.75 |",
  },
  {
    id: "n2",
    title: "Reading list",
    project: "Notes",
    updatedAt: NOW - 2 * HOUR,
    createdAt: NOW - DAY,
    author: "you",
    summary: "Papers to read",
    preview: "- He et al. 2022\n- Chen et al. 2020",
  },
  {
    id: "n3",
    title: "Agent scratch",
    project: "Vision",
    relatedProjectId: "p-vision",
    updatedAt: NOW - 3 * HOUR,
    author: "agent",
    summary: "",
  },
];

const PROJECTS = [
  { id: "p-vision", name: "Vision" },
  { id: "p-language", name: "Language" },
];

function fakeData(overrides: Partial<NotesData> = {}): NotesData {
  return fakeNotesData({
    notes,
    projects: PROJECTS,
    renameNote: vi.fn(async () => {}),
    setRelatedProject: vi.fn(async () => {}),
    deleteNote: vi.fn(async () => {}),
    resolveAsset: vi.fn(async () => null),
    ...overrides,
  });
}

interface Props {
  data?: NotesData;
  onNewNote?: () => void;
  onImport?: () => void;
  onOpenNoteInNewTab?: (id: string) => void;
}

function renderHome({ data = fakeData(), onNewNote, onImport, onOpenNoteInNewTab }: Props = {}) {
  const handlers = {
    onOpenNote: vi.fn(),
    iconFor: vi.fn((note: NoteItem) => note.icon),
  };
  const view = render(
    <NotesDataProvider value={data}>
      <NotesHome
        iconFor={handlers.iconFor}
        onOpenNote={handlers.onOpenNote}
        onOpenNoteInNewTab={onOpenNoteInNewTab}
        onNewNote={onNewNote}
        onImport={onImport}
      />
    </NotesDataProvider>,
  );
  return { ...view, ...handlers, data };
}

function card(id: string): HTMLElement {
  const match = document.querySelector<HTMLElement>(`[data-note-card="${id}"]`);
  if (!match) throw new Error(`no card for ${id}`);
  return match;
}

function listRow(id: string): HTMLElement {
  const match = document.querySelector<HTMLElement>(`[data-note-list-row="${id}"]`);
  if (!match) throw new Error(`no row for ${id}`);
  return match;
}

function shownIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-note-card], [data-note-list-row]")].map(
    (element) => element.dataset.noteCard ?? element.dataset.noteListRow ?? "",
  );
}

function openMore(scope: HTMLElement): HTMLElement {
  fireEvent.pointerDown(within(scope).getByRole("button", { name: menuCopy.more }), { button: 0, ctrlKey: false });
  return screen.getByRole("menu");
}

function menuItemNames(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent ?? "");
}

function columnHeader(label: string): HTMLElement {
  const match = screen.getAllByRole("button", { name: label }).find((button) => button.hasAttribute("aria-pressed"));
  if (!match) throw new Error(`no column header ${label}`);
  return match;
}

function favorites(): readonly string[] {
  return useNotesPrefsStore.getState().favorites;
}

function ago(timestamp: number): string {
  return formatRelativeTimeFrom(timestamp, Date.now(), { dateAfterDays: 7 });
}

let observer: IntersectionObserverStub | null = null;
const scrollTo = vi.fn();

const initialPrefs = useNotesPrefsStore.getState();

beforeEach(() => {
  useNotesPrefsStore.setState(initialPrefs, true);
  localStorage.clear();
  scrollTo.mockClear();
  HTMLElement.prototype.scrollTo = scrollTo as unknown as HTMLElement["scrollTo"];
});

afterEach(() => {
  observer?.restore();
  observer = null;
  Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

describe("NotesHome header", () => {
  it("shows the title, a search field and a New note button", async () => {
    const user = userEvent.setup();
    const onNewNote = vi.fn();
    renderHome({ onNewNote });
    expect(screen.getByRole("heading", { level: 2, name: copy.title })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: copy.search })).toHaveAttribute("placeholder", copy.search);
    await user.click(screen.getByRole("button", { name: enNotes.library.newNote }));
    expect(onNewNote).toHaveBeenCalledOnce();
  });

  it("turns off New note when there is no way to make one", () => {
    renderHome();
    expect(screen.getByRole("button", { name: enNotes.library.newNote })).toBeDisabled();
  });

  it("shows My notes and Favorites, the sort choice and the layout switch", () => {
    renderHome();
    const tabs = screen.getByRole("tablist", { name: copy.tabs.label });
    expect(within(tabs).getByRole("tab", { name: copy.tabs.mine })).toHaveAttribute("aria-selected", "true");
    expect(within(tabs).getByRole("tab", { name: copy.tabs.favorites })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("button", { name: copy.sort.opened })).toHaveAttribute("aria-haspopup", "menu");
    const layout = screen.getByRole("group", { name: copy.layout });
    expect(within(layout).getByRole("button", { name: enLibrary.home.gridView })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("NotesHome cards", () => {
  it("draws each note as a card with its title, project and a live preview", () => {
    const view = renderHome();
    expect(shownIds()).toEqual(["n1", "n2", "n3"]);
    const masking = card("n1");
    expect(within(masking).getByText("Masking ablation")).toBeInTheDocument();
    expect(within(masking).getByText("🧪")).toBeInTheDocument();
    expect(within(masking).getByText("Vision")).toBeInTheDocument();
    expect(view.iconFor).toHaveBeenCalledWith(notes[0]);

    const preview = masking.querySelector<HTMLElement>("[data-note-preview]");
    expect(preview).toHaveAttribute("aria-hidden", "true");
    expect(preview).toHaveAttribute("inert");
    expect(preview?.querySelector(".wysiwyg-content.note-body > .ProseMirror h2")).toHaveTextContent("Where things stand");
    expect(preview?.querySelectorAll("td")).toHaveLength(2);
    expect(card("n2").querySelectorAll("[data-note-preview] li")).toHaveLength(2);
  });

  it("names each card's open button after its note and describes it with the project", async () => {
    const user = userEvent.setup();
    const view = renderHome();
    const open = screen.getByRole("button", { name: "Reading list" });
    expect(open).toHaveAccessibleDescription("Notes");
    await user.click(open);
    expect(view.onOpenNote).toHaveBeenCalledWith("n2");
  });

  it("builds previews only for cards near the viewport and keeps them once built", () => {
    observer = installIntersectionObserverStub(() => false);
    renderHome();
    expect(document.querySelectorAll("[data-note-preview]")).toHaveLength(0);
    expect(document.querySelectorAll("[data-preview-pending]")).toHaveLength(3);
    act(() => observer?.setVisible((target) => (target as HTMLElement).dataset.noteCard === "n2"));
    expect(card("n2").querySelector("[data-note-preview]")).toBeInTheDocument();
    expect(card("n1").querySelector("[data-note-preview]")).toBeNull();
    act(() => observer?.setVisible(() => false));
    expect(card("n2").querySelector("[data-note-preview]")).toBeInTheDocument();
  });

  it("bookmarks a note from its card", async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(within(card("n2")).getByRole("button", { name: menuCopy.favorite }));
    expect(favorites()).toEqual(["n2"]);
    const starred = within(card("n2")).getByRole("button", { name: menuCopy.unfavorite });
    expect(starred).toHaveAttribute("aria-pressed", "true");
    await user.click(starred);
    expect(favorites()).toEqual([]);
  });

  it("follows favorites changed elsewhere, like the sidebar", () => {
    renderHome();
    act(() => useNotesPrefsStore.getState().toggleFavorite("n3"));
    expect(within(card("n3")).getByRole("button", { name: menuCopy.unfavorite })).toBeInTheDocument();
  });
});

describe("NotesHome tabs, search and sort", () => {
  it("shows only starred notes under Favorites and says when there are none", async () => {
    const user = userEvent.setup();
    useNotesPrefsStore.getState().set("favorites", ["n3", "gone"]);
    renderHome();
    await user.click(screen.getByRole("tab", { name: copy.tabs.favorites }));
    expect(screen.getByRole("tab", { name: copy.tabs.favorites })).toHaveAttribute("aria-selected", "true");
    expect(shownIds()).toEqual(["n3"]);
    await user.click(within(card("n3")).getByRole("button", { name: menuCopy.unfavorite }));
    expect(shownIds()).toEqual([]);
    expect(screen.getByText(copy.noFavorites)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enNotes.library.newNote, hidden: false })).toBeDisabled();
  });

  it("searches titles and preview text, and clears the search with Escape", async () => {
    const user = userEvent.setup();
    renderHome();
    const search = screen.getByRole("combobox", { name: copy.search });
    await user.type(search, "  CHEN ");
    expect(shownIds()).toEqual(["n2"]);
    await user.clear(search);
    await user.type(search, "scratch");
    expect(shownIds()).toEqual(["n3"]);
    await user.clear(search);
    await user.type(search, "zebra");
    expect(shownIds()).toEqual([]);
    expect(screen.getByText(copy.noMatches.replace("{{query}}", "zebra"))).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(search).toHaveValue("");
    expect(shownIds()).toEqual(["n1", "n2", "n3"]);
  });

  it("uses the sidebar's search syntax, completes qualifiers and writes a clicked table tag into the search", async () => {
    const user = userEvent.setup();
    useNotesPrefsStore.getState().set("favorites", ["n2"]);
    useNotesPrefsStore.getState().set("homeLayout", "table");
    const noteTags = vi.fn(async () => [{ tag: "ml", label: "ml", count: 1, notes: ["n1"] }]);
    renderHome({ data: fakeData({ noteTags }) });
    const tableIds = () => [...document.querySelectorAll<HTMLElement>("[data-note-table-row]")].map((row) => row.dataset.noteTableRow);
    const search = screen.getByRole("combobox", { name: copy.search });
    await user.type(search, "ta");
    const menu = screen.getByRole("listbox", { name: enCommon.querySearch.suggestions });
    await user.click(within(menu).getByRole("option", { name: enNotes.vault.search.fields.tag }));
    expect(search).toHaveValue("tag:");
    await user.clear(search);
    await user.type(search, "is:favorite");
    expect(tableIds()).toEqual(["n2"]);
    await user.clear(search);
    await user.click(await screen.findByRole("button", { name: enNotes.vault.tags.filter.replace("{{tag}}", "ml") }));
    expect(search).toHaveValue("tag:ml");
    expect(tableIds()).toEqual(["n1"]);
  });

  it("lets Escape through when the search is already empty", () => {
    renderHome();
    const onKeyDown = vi.fn();
    document.addEventListener("keydown", onKeyDown);
    fireEvent.keyDown(screen.getByRole("combobox", { name: copy.search }), { key: "Escape" });
    expect(onKeyDown).toHaveBeenCalledOnce();
    document.removeEventListener("keydown", onKeyDown);
  });

  it("sorts by last opened, then by the sort picked, remembers it and scrolls back to the top", async () => {
    const user = userEvent.setup();
    useNotesPrefsStore.getState().set("opened", { n3: NOW });
    const view = renderHome();
    const scroller = view.container.querySelector(".overflow-y-auto") as HTMLElement;
    expect(shownIds()).toEqual(["n3", "n1", "n2"]);

    const pick = async (label: string) => {
      fireEvent.pointerDown(screen.getByRole("button", { name: new RegExp(`^${Object.values(copy.sort).join("|")}$`, "u") }), {
        button: 0,
        ctrlKey: false,
      });
      const menu = screen.getByRole("menu");
      expect(menuItemNames(menu)).toEqual(Object.values(copy.sort));
      await user.click(within(menu).getByRole("menuitem", { name: label }));
    };
    await pick(copy.sort.created);
    expect(shownIds()).toEqual(["n3", "n2", "n1"]);
    expect(useNotesPrefsStore.getState().homeSort).toBe("created");
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    expect(scrollTo.mock.contexts.at(-1)).toBe(scroller);
    expect(screen.getByRole("button", { name: copy.sort.created })).toBeInTheDocument();

    await pick(copy.sort.edited);
    expect(shownIds()).toEqual(["n1", "n2", "n3"]);
    await pick(copy.sort.title);
    expect(shownIds()).toEqual(["n3", "n1", "n2"]);
  });

  it("marks the current sort with a check in its menu", () => {
    useNotesPrefsStore.getState().set("homeSort", "title");
    renderHome();
    fireEvent.pointerDown(screen.getByRole("button", { name: copy.sort.title }), { button: 0, ctrlKey: false });
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items.map((item) => item.querySelector("svg") !== null)).toEqual([false, false, false, true]);
  });
});

describe("NotesHome list", () => {
  it("leaves the author out for a shared note no agent wrote", async () => {
    const user = userEvent.setup();
    renderHome({ data: fakeData({ notes: notes.map((note) => (note.id === "n2" ? { ...note, shared: true } : note)) }) });
    await user.click(screen.getByRole("button", { name: enLibrary.home.listView }));
    expect(listRow("n2")).not.toHaveTextContent(enNotes.library.author.you);
  });

  it("switches to compact rows with chip, title, project, author and times, and remembers it", async () => {
    const user = userEvent.setup();
    useNotesPrefsStore.getState().set("opened", { n1: NOW - 10 * 60_000 });
    const first = renderHome();
    await user.click(screen.getByRole("button", { name: enLibrary.home.listView }));
    expect(useNotesPrefsStore.getState().homeLayout).toBe("list");
    expect(document.querySelector("[data-note-card]")).toBeNull();
    const row = listRow("n1");
    expect(row.querySelector("[data-note-color]")).toHaveAttribute("data-note-color", "mint");
    expect(row).toHaveTextContent("Masking ablation");
    expect(row).toHaveTextContent("Vision");
    expect(within(row).getByText("Codex").closest("[data-agent-tag]")).toBeInTheDocument();
    expect(row).toHaveTextContent(ago(notes[0].updatedAt));
    expect(row).toHaveTextContent(ago(NOW - 5 * DAY));
    expect(row).toHaveTextContent(ago(NOW - 10 * 60_000));
    expect(listRow("n2")).toHaveTextContent(enNotes.library.author.you);
    expect(within(listRow("n3")).getByText(enNotes.library.agentFallback)).toBeInTheDocument();
    expect(listRow("n3")).toHaveTextContent(ago(notes[2].updatedAt));
    first.unmount();

    renderHome();
    expect(listRow("n2")).toBeInTheDocument();
  });

  it("heads the columns, marks the sorted one and sorts by a column when it is clicked", async () => {
    const user = userEvent.setup();
    useNotesPrefsStore.getState().set("homeLayout", "list");
    renderHome();
    expect(columnHeader(copy.sort.opened)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(copy.author)).toBeInTheDocument();
    await user.click(columnHeader(copy.sort.title));
    expect(useNotesPrefsStore.getState().homeSort).toBe("title");
    expect(shownIds()).toEqual(["n3", "n1", "n2"]);
    expect(columnHeader(copy.sort.title)).toHaveAttribute("aria-pressed", "true");
    await user.click(columnHeader(copy.sort.created));
    expect(useNotesPrefsStore.getState().homeSort).toBe("created");
  });

  it("opens, stars and manages a note from its row", async () => {
    const user = userEvent.setup();
    useNotesPrefsStore.getState().set("homeLayout", "list");
    const onOpenNoteInNewTab = vi.fn();
    const view = renderHome({ onOpenNoteInNewTab });
    await user.click(screen.getByRole("button", { name: "Agent scratch" }));
    expect(view.onOpenNote).toHaveBeenCalledWith("n3");
    await user.click(within(listRow("n1")).getByRole("button", { name: menuCopy.favorite }));
    expect(favorites()).toEqual(["n1"]);
    fireEvent.contextMenu(listRow("n2"));
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: menuCopy.openInNewTab }));
    expect(onOpenNoteInNewTab).toHaveBeenCalledWith("n2");
    await user.click(within(openMore(listRow("n2"))).getByRole("menuitem", { name: menuCopy.rename }));
    const input = await screen.findByRole("textbox", { name: menuCopy.renameLabel });
    await user.clear(input);
    await user.type(input, "Reading list, week 2{Enter}");
    expect(view.data.renameNote).toHaveBeenCalledWith("n2", "Reading list, week 2");
  });
});

describe("NotesHome note menus", () => {
  it("offers the sidebar's note actions plus favorites from More and from a right-click", async () => {
    const user = userEvent.setup();
    const onOpenNoteInNewTab = vi.fn();
    renderHome({ onOpenNoteInNewTab });
    const menu = openMore(card("n1"));
    expect(menuItemNames(menu)).toEqual([
      menuCopy.openInNewTab,
      menuCopy.copyLink,
      menuCopy.export,
      menuCopy.favorite,
      menuCopy.rename,
      menuCopy.useAsTemplate,
      enNotes.library.menu.linkProject,
      menuCopy.delete,
    ]);
    expect(card("n1")).toHaveAttribute("data-menu-open", "true");
    await user.click(within(menu).getByRole("menuitem", { name: menuCopy.favorite }));
    expect(favorites()).toEqual(["n1"]);

    fireEvent.contextMenu(card("n2"));
    const context = screen.getByRole("menu");
    expect(menuItemNames(context)).toContain(menuCopy.favorite);
    await user.click(within(context).getByRole("menuitem", { name: menuCopy.openInNewTab }));
    expect(onOpenNoteInNewTab).toHaveBeenCalledWith("n2");
  });
});

describe("NotesHome empty state", () => {
  const greetings = Object.values(enNotes.workspace.empty.greetings);

  it("greets a first note with a blank note, starter templates and a Markdown import", async () => {
    const user = userEvent.setup();
    const onNewNote = vi.fn();
    const onImport = vi.fn();
    const { container } = renderHome({ data: fakeData({ notes: [], createNoteFrom: vi.fn() }), onNewNote, onImport });
    expect(screen.getAllByRole("heading", { level: 2 }).filter((heading) => greetings.includes(heading.textContent ?? ""))).toHaveLength(1);
    expect(container.querySelector("[data-rings-pattern]")).not.toBeNull();
    expect(screen.getByRole("button", { name: new RegExp(enNotes.vault.templates.names.proposal) })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: new RegExp(enNotes.vault.templates.blank) }));
    expect(onNewNote).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: enNotes.vault.import.menu }));
    expect(onImport).toHaveBeenCalledOnce();
    Element.prototype.scrollIntoView = vi.fn();
    await user.click(screen.getByRole("button", { name: enNotes.workspace.empty.moreTemplates }));
    expect(await screen.findByRole("dialog", { name: enNotes.vault.templates.label })).toBeInTheDocument();
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });

  it("leaves out the actions that can't run", () => {
    renderHome({ data: fakeData({ notes: [] }) });
    expect(screen.getAllByRole("heading", { level: 2 }).filter((heading) => greetings.includes(heading.textContent ?? ""))).toHaveLength(1);
    expect(screen.queryByRole("button", { name: new RegExp(enNotes.vault.templates.blank) })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enNotes.vault.import.menu })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enNotes.workspace.empty.moreTemplates })).not.toBeInTheDocument();
  });
});

