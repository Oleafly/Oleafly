// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { loadNamespace } from "@/i18n";

vi.mock("@/lib/use-fullscreen", () => ({ useFullscreen: () => false }));

import type { NoteSearchHit, NoteTagCount } from "@/lib/tauri";
import { NOTE_FAVORITES_KEY, toggleNoteFavorite } from "./note-favorites";
import { NotesDataProvider, type NotesData } from "./notes-data";
import { NotesLibrary } from "./NotesLibrary";
import type { ArtifactItem, NoteItem } from "./types";
import { filterByTag, useVaultStore } from "./vault-store";

const copy = enNotes.library;
const vault = enNotes.vault;
const NOTES_FILTERS_OPEN_KEY = "oleafly.notes.filtersOpen";

function note(id: string, title: string, extra: Partial<NoteItem> = {}): NoteItem {
  return { id, title, project: "Vision", updatedAt: 0, author: "you", summary: "", ...extra };
}

const notes: NoteItem[] = [
  note("n1", "Masking ablation", { author: "agent", tags: ["ml"] }),
  note("n2", "Reading list", { tags: ["ml/vision"] }),
  note("n3", "Lab protocol"),
];

const artifacts: ArtifactItem[] = [
  {
    id: "a1",
    taskId: "t1",
    path: "mask.png",
    title: "Mask figure",
    kind: "figure",
    projectId: "p",
    project: "Vision",
    updatedAt: 0,
    chat: "c",
    summary: "",
  },
];

const tags: NoteTagCount[] = [
  { tag: "ml", label: "ml", count: 1, notes: ["n1"] },
  { tag: "ml/vision", label: "ml/Vision", count: 1, notes: ["n2"] },
  { tag: "draft", label: "draft", count: 1, notes: ["n3"] },
];

function hit(id: string, title: string): NoteSearchHit {
  return {
    id,
    noteId: null,
    title,
    titleRanges: [[0, 4]],
    score: 1,
    snippets: [{ text: `About ${title}`, ranges: [[6, 10]] }],
    tags: [],
    aliases: [],
    relatedProject: null,
    updatedAt: 0,
  };
}

function data(overrides: Partial<NotesData> = {}): NotesData {
  return {
    notes,
    artifacts,
    experiments: [],
    citations: [],
    papers: [],
    loadNote: vi.fn(),
    saveNote: vi.fn(),
    searchNotes: vi.fn(async () => [hit("n1", "Masking ablation"), hit("n2", "Reading list"), hit("gone", "Gone")]),
    noteTags: vi.fn(async () => tags),
    ...overrides,
  };
}

function renderLibrary(value = data(), onToday?: () => void) {
  const handlers = { onHome: vi.fn(), onOpenNote: vi.fn(), onOpenNoteInNewTab: vi.fn(), onOpenArtifact: vi.fn() };
  const view = render(
    <NotesDataProvider value={value}>
      <NotesLibrary
        iconFor={(item) => item.icon}
        activeNoteId="n2"
        activeArtifactId={null}
        onToday={onToday}
        {...handlers}
      />
    </NotesDataProvider>,
  );
  return { ...view, ...handlers, value };
}

function search(): HTMLElement {
  return screen.getByRole("combobox", { name: copy.search });
}

function hitOptions(): HTMLElement[] {
  return within(screen.getByRole("listbox", { name: vault.search.results })).getAllByRole("option");
}

function rowTitles(): string[] {
  return [...document.querySelectorAll("[data-note-row]")].map((row) => row.getAttribute("data-note-row") ?? "");
}

beforeAll(async () => {
  await loadNamespace("notes");
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  localStorage.removeItem(NOTES_FILTERS_OPEN_KEY);
  localStorage.removeItem(NOTE_FAVORITES_KEY);
});

afterEach(() => {
  act(() => useVaultStore.setState({ tag: null, tagRequest: 0, switcherOpen: false }));
});

describe("NotesLibrary search", () => {
  it("searches note text and shows highlighted matches", async () => {
    const user = userEvent.setup();
    const { value, container } = renderLibrary();
    await user.type(search(), "mask");
    const list = await screen.findByRole("listbox", { name: vault.search.results }, { timeout: 4000 });
    expect(value.searchNotes).toHaveBeenLastCalledWith("mask", 50);
    expect(within(list).getAllByRole("option")).toHaveLength(2);
    expect(search()).toHaveAttribute("aria-expanded", "true");
    expect(search()).toHaveAttribute("aria-activedescendant", within(list).getAllByRole("option")[0].id);
    expect(container.querySelectorAll("mark")[0]?.textContent).toBe("Mask");
    expect(screen.getByText("Mask figure")).toBeInTheDocument();
    expect(screen.queryByText("Lab protocol")).not.toBeInTheDocument();
  });

  it("moves through results with the arrow keys and opens with Enter or Mod+Enter", async () => {
    const user = userEvent.setup();
    const view = renderLibrary();
    await user.type(search(), "mask");
    const options = await screen.findAllByRole("option", {}, { timeout: 4000 });
    await user.keyboard("{ArrowDown}");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}");
    await user.keyboard("{Enter}");
    expect(view.onOpenNote).toHaveBeenCalledWith("n2");
    fireEvent.keyDown(search(), { key: "Enter", ctrlKey: true });
    expect(view.onOpenNoteInNewTab).toHaveBeenCalledWith("n2");
    view.onOpenNoteInNewTab.mockClear();
    fireEvent.keyDown(search(), { key: "Enter", keyCode: 229 });
    expect(view.onOpenNoteInNewTab).not.toHaveBeenCalled();
    expect(view.onOpenNote).toHaveBeenCalledTimes(1);
    fireEvent.mouseMove(options[0]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.click(options[0]);
    expect(view.onOpenNote).toHaveBeenCalledWith("n1");
    fireEvent.click(options[1], { ctrlKey: true });
    expect(view.onOpenNoteInNewTab).toHaveBeenCalledWith("n2");
    fireEvent.keyDown(options[0], { key: "Enter" });
    expect(view.onOpenNote).toHaveBeenLastCalledWith("n1");
    fireEvent.keyDown(options[0], { key: "a" });
    fireEvent.keyDown(search(), { key: "Tab" });
    await user.keyboard("{Escape}");
    expect(search()).toHaveValue("");
    expect(rowTitles()).toEqual(["n1", "n2", "n3"]);
  });

  it("says when it is searching and when nothing matches", async () => {
    const user = userEvent.setup();
    let finish: (hits: NoteSearchHit[]) => void = () => {};
    const searchNotes = vi.fn(() => new Promise<readonly NoteSearchHit[]>((resolve) => (finish = resolve)));
    renderLibrary(data({ searchNotes, artifacts: [] }));
    await user.type(search(), "zzz");
    expect(screen.getByText(vault.search.searching)).toBeInTheDocument();
    await waitFor(() => expect(searchNotes).toHaveBeenCalled(), { timeout: 4000 });
    await act(async () => finish([]));
    expect(screen.getByText(vault.search.noResults.replace("{{query}}", "zzz"))).toBeInTheDocument();
    fireEvent.keyDown(search(), { key: "ArrowDown" });
  });

  it("applies the author, kind and favorite filters to matches", async () => {
    const user = userEvent.setup();
    act(() => toggleNoteFavorite("n2"));
    const view = renderLibrary();
    await user.type(search(), "mask is:favorite");
    await waitFor(() => expect(view.value.searchNotes).toHaveBeenLastCalledWith("mask", 50), { timeout: 4000 });
    await waitFor(() => expect(hitOptions()).toHaveLength(1), { timeout: 4000 });
    expect(hitOptions()[0]).toHaveTextContent("Reading list");
    await user.clear(search());
    await user.type(search(), "is:favorite");
    expect(rowTitles()).toEqual(["n2"]);
    expect(screen.queryByText("Mask figure")).not.toBeInTheDocument();
    await user.clear(search());
    await user.type(search(), "-is:favorite");
    expect(rowTitles()).toEqual(["n1", "n3"]);
  });
});

describe("NotesLibrary tags", () => {
  async function openTags(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: copy.filters.title }));
  }

  it("lists tags as a tree with counts and filters the list by one", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await openTags(user);
    const tree = await screen.findByRole("list", { name: vault.tags.label });
    expect(within(tree).getAllByRole("button", { pressed: false }).map((button) => button.textContent)).toEqual(["#draft1", "#ml2"]);
    await user.click(screen.getByRole("button", { name: vault.tags.expand.replace("{{tag}}", "ml") }));
    expect(screen.getByRole("button", { name: vault.tags.filter.replace("{{tag}}", "ml/vision") })).toHaveTextContent("#Vision1");
    await user.click(screen.getByRole("button", { name: vault.tags.filter.replace("{{tag}}", "ml") }));
    expect(search()).toHaveValue("tag:ml");
    expect(rowTitles()).toEqual(["n1", "n2"]);
    expect(screen.getByRole("button", { name: vault.tags.filter.replace("{{tag}}", "ml") })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: copy.filters.title })).toHaveTextContent("1");
    expect(screen.queryByText("Mask figure")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: vault.tags.filter.replace("{{tag}}", "ml") }));
    expect(search()).toHaveValue("");
    await user.click(screen.getByRole("button", { name: vault.tags.collapse.replace("{{tag}}", "ml") }));
    expect(screen.queryByRole("button", { name: vault.tags.filter.replace("{{tag}}", "ml/vision") })).not.toBeInTheDocument();
  });

  it("writes a tag asked for elsewhere into the search, shows it as a removable chip and sends it along", async () => {
    const user = userEvent.setup();
    const view = renderLibrary();
    act(() => filterByTag("ml/vision"));
    expect(await screen.findByRole("button", { name: vault.tags.filter.replace("{{tag}}", "ml/vision") })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(search()).toHaveValue("tag:ml/vision");
    expect(useVaultStore.getState().tag).toBeNull();
    expect(rowTitles()).toEqual(["n2"]);
    await user.type(search(), " read");
    await waitFor(() => expect(view.value.searchNotes).toHaveBeenLastCalledWith("tag:ml/vision read", 50), { timeout: 4000 });
    await user.click(screen.getByRole("button", { name: vault.tags.clear.replace("{{tag}}", "ml/vision") }));
    expect(search()).toHaveValue("read");
    act(() => filterByTag("draft"));
    expect(search()).toHaveValue("read tag:draft");
  });

  it("keeps a tag asked for while the sidebar was closed until it opens", () => {
    act(() => filterByTag("ML"));
    renderLibrary();
    expect(search()).toHaveValue("tag:ml");
    expect(rowTitles()).toEqual(["n1", "n2"]);
  });

  it("opens the tags section when the editor asks for a tag", async () => {
    renderLibrary();
    expect(screen.getByRole("button", { name: copy.filters.title })).toHaveAttribute("aria-expanded", "false");
    act(() => filterByTag("draft"));
    await waitFor(() => expect(screen.getByRole("button", { name: copy.filters.title })).toHaveAttribute("aria-expanded", "true"));
    expect(localStorage.getItem(NOTES_FILTERS_OPEN_KEY)).toBe("true");
  });

  it("falls back to the tags in note heads and explains an empty tag list", async () => {
    const user = userEvent.setup();
    renderLibrary(data({ noteTags: vi.fn(async () => []) }));
    await openTags(user);
    expect(await screen.findByText(vault.tags.empty)).toBeInTheDocument();
    act(() => filterByTag("ml"));
    expect(rowTitles()).toEqual([]);
    expect(screen.getByText(copy.empty)).toBeInTheDocument();
  });

  it("filters by note heads before the tag index loads", () => {
    renderLibrary(data({ noteTags: undefined }));
    act(() => filterByTag("ml"));
    expect(rowTitles()).toEqual(["n1", "n2"]);
  });
});

describe("NotesLibrary vault actions", () => {
  it("opens today's note, the quick switcher and the template picker", async () => {
    const user = userEvent.setup();
    const onToday = vi.fn();
    renderLibrary(data({ createNoteFrom: vi.fn(async () => "new") }), onToday);
    const header = document.querySelector("[data-notes-header-actions]") as HTMLElement;
    await user.click(within(header).getByRole("button", { name: vault.daily.open }));
    expect(onToday).toHaveBeenCalled();
    await user.click(within(header).getByRole("button", { name: vault.switcher.open }));
    expect(useVaultStore.getState().switcherOpen).toBe(true);
    await user.click(screen.getByRole("button", { name: vault.templates.open }));
    expect(await screen.findByRole("dialog", { name: vault.templates.label })).toBeInTheDocument();
  });

  it("disables what the data can't do", () => {
    renderLibrary(data({ createNoteFrom: undefined }));
    expect(screen.getByRole("button", { name: vault.daily.open })).toBeDisabled();
    expect(screen.getByRole("button", { name: vault.templates.open })).toBeDisabled();
  });
});
