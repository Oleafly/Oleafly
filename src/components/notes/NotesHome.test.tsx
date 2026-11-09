// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { formatRelativeTimeFrom } from "@/lib/intl";
import { installIntersectionObserverStub, type IntersectionObserverStub } from "@/components/ui/test-intersection-observer";
import { useProjectColorsStore } from "@/store/project-colors";
import { useToastStore } from "@/store/toast";

const log = vi.hoisted(() => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logError: log.logError,
}));
vi.mock("@/components/ui/mermaid-diagram", () => ({
  renderDiagram: vi.fn(() => Promise.resolve(document.createElementNS("http://www.w3.org/2000/svg", "svg"))),
}));

import { NotesHome } from "./NotesHome";
import { NOTE_FAVORITES_KEY, toggleNoteFavorite } from "./note-favorites";
import { NOTE_HOME_LAYOUT_KEY, NOTE_HOME_SORT_KEY, NOTE_OPENED_KEY } from "./note-home-prefs";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { NoteItem } from "./types";

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
  return {
    notes,
    artifacts: [],
    experiments: [],
    citations: [],
    papers: [],
    projects: PROJECTS,
    loadNote: vi.fn(),
    saveNote: vi.fn(),
    renameNote: vi.fn(async () => {}),
    setRelatedProject: vi.fn(async () => {}),
    deleteNote: vi.fn(async () => {}),
    resolveAsset: vi.fn(async () => null),
    ...overrides,
  };
}

interface Props {
  data?: NotesData;
  onNewNote?: () => void;
  onOpenNoteInNewTab?: (id: string) => void;
}

function renderHome({ data = fakeData(), onNewNote, onOpenNoteInNewTab }: Props = {}) {
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

function favorites(): string[] {
  return JSON.parse(localStorage.getItem(NOTE_FAVORITES_KEY) ?? "[]") as string[];
}

function toastMessages(kind: "success" | "error"): string[] {
  return useToastStore
    .getState()
    .toasts.filter((toast) => toast.kind === kind)
    .map((toast) => toast.message);
}

function ago(timestamp: number): string {
  return formatRelativeTimeFrom(timestamp, Date.now(), { dateAfterDays: 7 });
}

let observer: IntersectionObserverStub | null = null;
const scrollTo = vi.fn();

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  localStorage.clear();
  log.logError.mockClear();
  useToastStore.setState({ toasts: [] });
  useProjectColorsStore.setState({ colors: {} });
  scrollTo.mockClear();
  HTMLElement.prototype.scrollTo = scrollTo as unknown as HTMLElement["scrollTo"];
});

afterEach(() => {
  observer?.restore();
  observer = null;
  Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

describe("NotesHome header", () => {
  it("fills its view with the note background and scrolls on its own", () => {
    renderHome();
    const root = screen.getByRole("heading", { name: copy.title }).closest(".overflow-y-auto");
    expect(root).toHaveClass("flex-1", "min-h-0", "bg-background", "@container");
  });

  it("puts the title on the left, a search field centred on wide panes and inline on narrow ones, and a New note button on the right", async () => {
    const user = userEvent.setup();
    const onNewNote = vi.fn();
    renderHome({ onNewNote });
    expect(screen.getByRole("heading", { level: 2, name: copy.title })).toHaveClass("font-semibold");
    const search = screen.getByRole("combobox", { name: copy.search });
    expect(search).toHaveAttribute("placeholder", copy.search);
    expect(search.parentElement).toHaveClass(
      "min-w-0",
      "flex-1",
      "rounded-[0.5625rem]",
      "max-w-[22.5rem]",
      "@min-[36rem]:absolute",
      "@min-[36rem]:left-1/2",
      "@min-[36rem]:w-[22.5rem]",
      "@min-[36rem]:-translate-x-1/2",
    );
    expect(search.parentElement?.className).not.toMatch(/(^|\s)(absolute|left-1\/2|-translate-x-1\/2)(\s|$)/u);
    expect(search.className).not.toMatch(/(^|\s)(ring|outline)-/u);
    await user.click(screen.getByRole("button", { name: enNotes.library.newNote }));
    expect(onNewNote).toHaveBeenCalledOnce();
  });

  it("turns off New note when there is no way to make one", () => {
    renderHome();
    expect(screen.getByRole("button", { name: enNotes.library.newNote })).toBeDisabled();
  });

  it("wraps the toolbar instead of overlapping, and keeps the sort name for screen readers when it hides", () => {
    renderHome();
    const tabs = screen.getByRole("group", { name: copy.tabs.label });
    expect(tabs.parentElement).toHaveClass("flex-wrap", "gap-y-2", "min-h-7");
    const sort = screen.getByRole("button", { name: enNotes.home.sort.opened });
    expect(within(sort).getByText(enNotes.home.sort.opened)).toHaveClass("@max-[32rem]:sr-only");
  });

  it("shows My notes and Favorites, the sort choice and the layout switch", () => {
    renderHome();
    const tabs = screen.getByRole("group", { name: copy.tabs.label });
    expect(within(tabs).getByRole("button", { name: copy.tabs.mine })).toHaveAttribute("aria-pressed", "true");
    expect(within(tabs).getByRole("button", { name: copy.tabs.favorites })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: copy.sort.opened })).toHaveAttribute("aria-haspopup", "menu");
    const layout = screen.getByRole("group", { name: copy.layout });
    expect(within(layout).getByRole("button", { name: enLibrary.home.gridView })).toHaveAttribute("aria-pressed", "true");
    expect(within(layout).getByRole("button", { name: enLibrary.home.listView })).toHaveClass("h-6", "w-[1.875rem]");
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });
});

describe("NotesHome cards", () => {
  it("draws each note as a framed card with its title, project and a live preview", () => {
    useProjectColorsStore.setState({ colors: { "p-vision": "#cfbaf0" } });
    const view = renderHome();
    expect(shownIds()).toEqual(["n1", "n2", "n3"]);
    const masking = card("n1");
    expect(masking).toHaveClass("aspect-[236/264]", "rounded-[1.25rem]", "p-1");
    expect(masking.className).not.toMatch(/border-(l|s)-|note-project/u);
    expect(within(masking).getByText("Masking ablation")).toHaveClass("break-words");
    expect(within(masking).getByText("🧪")).toBeInTheDocument();
    expect(view.iconFor).toHaveBeenCalledWith(notes[0]);
    expect(within(masking).getByText("Vision").previousElementSibling).toHaveAttribute("data-project-color", "#cfbaf0");
    expect(within(card("n2")).getByText("Notes").previousElementSibling).toHaveAttribute("data-project-color", "none");

    const preview = masking.querySelector<HTMLElement>("[data-note-preview]");
    expect(preview).toHaveAttribute("aria-hidden", "true");
    expect(preview).toHaveAttribute("inert");
    expect(preview).toHaveClass("pointer-events-none");
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

  it("stars a note from its card and keeps the star showing once it is a favorite", async () => {
    const user = userEvent.setup();
    renderHome();
    const star = within(card("n2")).getByRole("button", { name: menuCopy.favorite });
    expect(star).toHaveClass("opacity-0", "group-hover/card:opacity-100");
    await user.click(star);
    expect(favorites()).toEqual(["n2"]);
    const starred = within(card("n2")).getByRole("button", { name: menuCopy.unfavorite });
    expect(starred).toHaveAttribute("aria-pressed", "true");
    expect(starred).toHaveClass("opacity-100", "text-amber-500");
    expect(starred.querySelector("svg")).toHaveClass("fill-current");
    await user.click(starred);
    expect(favorites()).toEqual([]);
  });

  it("follows favorites changed elsewhere, like the sidebar", () => {
    renderHome();
    act(() => toggleNoteFavorite("n3"));
    expect(within(card("n3")).getByRole("button", { name: menuCopy.unfavorite })).toBeInTheDocument();
  });
});

describe("NotesHome tabs, search and sort", () => {
  it("shows only starred notes under Favorites and says when there are none", async () => {
    const user = userEvent.setup();
    localStorage.setItem(NOTE_FAVORITES_KEY, JSON.stringify(["n3", "gone"]));
    renderHome();
    await user.click(screen.getByRole("button", { name: copy.tabs.favorites }));
    expect(screen.getByRole("button", { name: copy.tabs.favorites })).toHaveAttribute("aria-pressed", "true");
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
    localStorage.setItem(NOTE_FAVORITES_KEY, JSON.stringify(["n2"]));
    localStorage.setItem(NOTE_HOME_LAYOUT_KEY, "table");
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
    localStorage.setItem(NOTE_OPENED_KEY, JSON.stringify({ n3: NOW }));
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
    expect(localStorage.getItem(NOTE_HOME_SORT_KEY)).toBe("created");
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    expect(scrollTo.mock.contexts.at(-1)).toBe(scroller);
    expect(screen.getByRole("button", { name: copy.sort.created })).toBeInTheDocument();

    await pick(copy.sort.edited);
    expect(shownIds()).toEqual(["n1", "n2", "n3"]);
    await pick(copy.sort.title);
    expect(shownIds()).toEqual(["n3", "n1", "n2"]);
  });

  it("marks the current sort with a check in its menu", () => {
    localStorage.setItem(NOTE_HOME_SORT_KEY, "title");
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
    localStorage.setItem(NOTE_OPENED_KEY, JSON.stringify({ n1: NOW - 10 * 60_000 }));
    const first = renderHome();
    await user.click(screen.getByRole("button", { name: enLibrary.home.listView }));
    expect(localStorage.getItem(NOTE_HOME_LAYOUT_KEY)).toBe("list");
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
    expect(row.className).not.toMatch(/border-(l|s)-|note-project/u);
    first.unmount();

    renderHome();
    expect(listRow("n2")).toBeInTheDocument();
  });

  it("heads the columns, marks the sorted one and sorts by a column when it is clicked", async () => {
    const user = userEvent.setup();
    localStorage.setItem(NOTE_HOME_LAYOUT_KEY, "list");
    renderHome();
    const opened = columnHeader(copy.sort.opened);
    expect(opened).toHaveAttribute("aria-pressed", "true");
    expect(opened).toHaveClass("font-semibold", "text-foreground");
    expect(opened.parentElement).toHaveClass("flex");
    expect(opened.parentElement).not.toHaveClass("hidden");
    expect(columnHeader(copy.sort.created).parentElement).toHaveClass("hidden");
    expect(screen.getByText(copy.author)).toBeInTheDocument();
    await user.click(columnHeader(copy.sort.title));
    expect(localStorage.getItem(NOTE_HOME_SORT_KEY)).toBe("title");
    expect(shownIds()).toEqual(["n3", "n1", "n2"]);
    expect(columnHeader(copy.sort.title)).toHaveAttribute("aria-pressed", "true");
    await user.click(columnHeader(copy.sort.created));
    expect(localStorage.getItem(NOTE_HOME_SORT_KEY)).toBe("created");
  });

  it("opens, stars and manages a note from its row", async () => {
    const user = userEvent.setup();
    localStorage.setItem(NOTE_HOME_LAYOUT_KEY, "list");
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
    expect(menuItemNames(context)[1]).toBe(menuCopy.favorite);
    await user.click(within(context).getByRole("menuitem", { name: menuCopy.openInNewTab }));
    expect(onOpenNoteInNewTab).toHaveBeenCalledWith("n2");
  });

  it("names the icon-only More and star buttons in tooltips", async () => {
    renderHome();
    fireEvent.mouseEnter(within(card("n1")).getByRole("button", { name: menuCopy.more }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(menuCopy.more);
    fireEvent.mouseLeave(within(card("n1")).getByRole("button", { name: menuCopy.more }));
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    fireEvent.mouseEnter(within(card("n1")).getByRole("button", { name: menuCopy.favorite }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(menuCopy.favorite);
  });

  it("keeps only the actions the data can do", () => {
    renderHome({
      data: fakeData({ renameNote: undefined, deleteNote: undefined, setRelatedProject: undefined }),
    });
    expect(menuItemNames(openMore(card("n1")))).toEqual([menuCopy.favorite, menuCopy.useAsTemplate]);
  });

  it("renames a note in its card, saving the trimmed title on Enter and keeping the old one on Escape", async () => {
    const user = userEvent.setup();
    const { data } = renderHome();
    await user.click(within(openMore(card("n1"))).getByRole("menuitem", { name: menuCopy.rename }));
    const input = await screen.findByRole("textbox", { name: menuCopy.renameLabel });
    expect(input).toHaveValue("Masking ablation");
    await waitFor(() => expect(input).toHaveFocus());
    expect(within(card("n1")).queryByRole("button", { name: "Masking ablation" })).not.toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "  Masking, final  {Enter}");
    expect(data.renameNote).toHaveBeenCalledExactlyOnceWith("n1", "Masking, final");
    expect(screen.queryByRole("textbox", { name: menuCopy.renameLabel })).not.toBeInTheDocument();

    await user.click(within(openMore(card("n2"))).getByRole("menuitem", { name: menuCopy.rename }));
    const second = await screen.findByRole("textbox", { name: menuCopy.renameLabel });
    await user.type(second, "zzz{Escape}");
    expect(data.renameNote).toHaveBeenCalledOnce();
    expect(screen.queryByRole("textbox", { name: menuCopy.renameLabel })).not.toBeInTheDocument();
  });

  it("saves a rename when the field loses focus and skips an unchanged or empty title", async () => {
    const user = userEvent.setup();
    const { data } = renderHome();
    await user.click(within(openMore(card("n1"))).getByRole("menuitem", { name: menuCopy.rename }));
    const input = await screen.findByRole("textbox", { name: menuCopy.renameLabel });
    fireEvent.blur(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(data.renameNote).not.toHaveBeenCalled();
    await user.click(within(openMore(card("n1"))).getByRole("menuitem", { name: menuCopy.rename }));
    const again = await screen.findByRole("textbox", { name: menuCopy.renameLabel });
    await user.clear(again);
    fireEvent.blur(again);
    expect(data.renameNote).not.toHaveBeenCalled();
  });

  it("tells you when a rename fails", async () => {
    const user = userEvent.setup();
    renderHome({ data: fakeData({ renameNote: vi.fn(async () => Promise.reject(new Error("locked"))) }) });
    await user.click(within(openMore(card("n2"))).getByRole("menuitem", { name: menuCopy.rename }));
    await user.type(await screen.findByRole("textbox", { name: menuCopy.renameLabel }), "!{Enter}");
    await waitFor(() => expect(toastMessages("error")).toEqual(['Couldn\'t rename "Reading list".']));
  });

  it("moves a note to another project or out of every project", async () => {
    const user = userEvent.setup();
    const { data } = renderHome();
    const choose = async (id: string, name: string) => {
      const trigger = within(openMore(card(id))).getByRole("menuitem", { name: enNotes.library.menu.linkProject });
      trigger.focus();
      await user.keyboard("{ArrowRight}");
      const submenu = (await screen.findAllByRole("menu")).at(-1) as HTMLElement;
      await user.click(within(submenu).getByRole("menuitem", { name }));
    };
    await choose("n2", "Language");
    expect(data.setRelatedProject).toHaveBeenCalledWith("n2", "p-language");
    await choose("n1", enNotes.workspace.noProject);
    expect(data.setRelatedProject).toHaveBeenLastCalledWith("n1", null);
  });

  it("logs a project move that fails", async () => {
    const user = userEvent.setup();
    renderHome({ data: fakeData({ setRelatedProject: vi.fn(async () => Promise.reject(new Error("gone"))) }) });
    const trigger = within(openMore(card("n2"))).getByRole("menuitem", { name: enNotes.library.menu.linkProject });
    trigger.focus();
    await user.keyboard("{ArrowRight}");
    const submenu = (await screen.findAllByRole("menu")).at(-1) as HTMLElement;
    await user.click(within(submenu).getByRole("menuitem", { name: "Vision" }));
    await waitFor(() => expect(log.logError).toHaveBeenCalledWith("set the note's project", expect.any(Error)));
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain(
      enNotes.failures.linkNote.replace("{{name}}", "Reading list"),
    );
  });

  it("asks before moving a note to the Recycle Bin, then moves it and says so", async () => {
    const user = userEvent.setup();
    const { data } = renderHome();
    await user.click(within(openMore(card("n2"))).getByRole("menuitem", { name: menuCopy.delete }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("heading", { name: 'Move "Reading list" to the Recycle Bin?' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: menuCopy.deleteConfirm }));
    expect(data.deleteNote).toHaveBeenCalledExactlyOnceWith("n2");
    await waitFor(() => expect(toastMessages("success")).toEqual(['Moved "Reading list" to the Recycle Bin.']));
  });

  it("keeps the note when the delete is cancelled and reports one that fails", async () => {
    const user = userEvent.setup();
    const deleteNote = vi.fn(async () => Promise.reject(new Error("busy")));
    renderHome({ data: fakeData({ deleteNote }) });
    fireEvent.contextMenu(card("n1"));
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: menuCopy.delete }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: new RegExp(`^${enCommon.actions.cancel}`, "u") }));
    expect(deleteNote).not.toHaveBeenCalled();
    fireEvent.contextMenu(card("n1"));
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: menuCopy.delete }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: menuCopy.deleteConfirm }));
    await waitFor(() => expect(toastMessages("error")).toEqual(['Couldn\'t delete "Masking ablation".']));
    expect(toastMessages("success")).toEqual([]);
  });
});

describe("NotesHome empty state", () => {
  it("invites you to write the first note", async () => {
    const user = userEvent.setup();
    const onNewNote = vi.fn();
    renderHome({ data: fakeData({ notes: [] }), onNewNote });
    expect(screen.getByText(copy.empty)).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: enNotes.library.newNote });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[1]);
    expect(onNewNote).toHaveBeenCalledOnce();
  });

  it("leaves the button out when notes can't be made", () => {
    renderHome({ data: fakeData({ notes: [] }) });
    expect(screen.getByText(copy.empty)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: enNotes.library.newNote })).toHaveLength(1);
  });
});
