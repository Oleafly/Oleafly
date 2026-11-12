// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { formatRelativeTimeFrom } from "@/lib/intl";

import type { ProjectInfo } from "@oleafly/backend-port";
import { DEFAULT_BOOK_COLOR } from "@/components/library/Book";
import { useFilesStore } from "@/store/files";
import { useProjectColorsStore } from "@/store/project-colors";
import { shortcutLabel, useShortcutStore } from "@/store/shortcuts";
import { NotesLibrary } from "./NotesLibrary";
import { NOTE_COLOR_HEX } from "./note-icons";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { ArtifactItem, NoteItem } from "./types";
import { fakeNotesData } from "./tests/notes-data-fixture";
import "./tests/setup";
import { useNotesPrefsStore } from "@/store/notes-prefs";
import { focusNotesSearch } from "./vault-store";

const copy = enNotes.library;
const MINUTE = 60_000;
const NOW = Date.now();

const notes: NoteItem[] = [
  {
    id: "n1",
    title: "Masking ablation",
    project: "Vision",
    updatedAt: NOW - 5 * MINUTE,
    author: "agent",
    agent: "Codex",
    icon: "lucide:atom",
    summary: "Masking ratio sweep",
  },
  {
    id: "n2",
    title: "Reading list",
    project: "Language",
    updatedAt: NOW - 10 * MINUTE,
    author: "you",
    summary: "Papers to read",
  },
  {
    id: "n3",
    title: "Agent scratch",
    project: "Vision",
    updatedAt: NOW - 20 * MINUTE,
    author: "agent",
    summary: "Notes from an unnamed agent",
  },
];

function artifact(overrides: Partial<ArtifactItem> & Pick<ArtifactItem, "id" | "title" | "kind">): ArtifactItem {
  return {
    taskId: "t1",
    path: `${overrides.id}.out`,
    projectId: "p-vision",
    project: "Vision",
    updatedAt: NOW - 30 * MINUTE,
    agent: "Codex",
    chat: "Ablation chat",
    summary: "",
    ...overrides,
  };
}

const artifacts: ArtifactItem[] = [
  artifact({ id: "a1", title: "Loss curve", kind: "figure" }),
  artifact({ id: "a2", title: "Attention map", kind: "html" }),
  artifact({
    id: "a3",
    title: "Ablation report",
    kind: "report",
    projectId: "p-language",
    project: "Language",
    agent: undefined,
  }),
  artifact({ id: "a4", title: "Metrics table", kind: "data" }),
  artifact({ id: "a5", title: "Checkpoint", kind: "file" }),
];

function fakeData(overrides: Partial<NotesData> = {}): NotesData {
  return fakeNotesData({
    notes,
    artifacts,
    ...overrides,
  });
}

interface Props {
  activeNoteId?: string | null;
  activeArtifactId?: string | null;
  onNewNote?: () => void;
  onOpenNoteInNewTab?: (id: string) => void;
  data?: NotesData;
}

function renderLibrary({
  activeNoteId = null,
  activeArtifactId = null,
  onNewNote,
  onOpenNoteInNewTab,
  data = fakeData(),
}: Props = {}) {
  const handlers = {
    onHome: vi.fn(),
    onOpenNote: vi.fn(),
    onOpenArtifact: vi.fn(),
    iconFor: vi.fn((note: NoteItem) => note.icon),
  };
  const view = render(
    <NotesDataProvider value={data}>
      <NotesLibrary
        iconFor={handlers.iconFor}
        activeNoteId={activeNoteId}
        activeArtifactId={activeArtifactId}
        onHome={handlers.onHome}
        onNewNote={onNewNote}
        onOpenNote={handlers.onOpenNote}
        onOpenNoteInNewTab={onOpenNoteInNewTab}
        onOpenArtifact={handlers.onOpenArtifact}
      />
    </NotesDataProvider>,
  );
  return { ...view, ...handlers };
}

function rowTitles(): string[] {
  return screen
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-labelledby"))
    .filter((id): id is string => id?.endsWith("-title") === true)
    .map((id) => document.getElementById(id)?.textContent ?? "");
}

function kindChip(name: string): HTMLElement {
  return within(screen.getByRole("group", { name: enNotes.vault.search.fields.kind })).getByRole("button", { name });
}

function authorChip(name: string): HTMLElement {
  return within(screen.getByRole("group", { name: copy.filters.writtenBy })).getByRole("button", { name });
}

function filtersToggle(): HTMLElement {
  return screen.getByRole("button", { name: copy.filters.title });
}

async function openFilters(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(filtersToggle());
}

async function openSearch(user: ReturnType<typeof userEvent.setup>, label: string = copy.search): Promise<HTMLElement> {
  await user.click(screen.getByRole("button", { name: label }));
  return screen.getByRole("combobox", { name: label });
}

function header(container: HTMLElement): HTMLElement {
  return container.querySelector("[data-tauri-drag-region]") as HTMLElement;
}

function row(title: string): HTMLElement {
  const match = screen.getByText(title).closest("button");
  if (!match) throw new Error(`no row for ${title}`);
  return match;
}

function ago(timestamp: number): string {
  return formatRelativeTimeFrom(timestamp, Date.now(), { dateAfterDays: 7 });
}

const initialPrefs = useNotesPrefsStore.getState();

beforeEach(() => {
  useNotesPrefsStore.setState(initialPrefs, true);
  localStorage.clear();
  useProjectColorsStore.setState({ colors: {} });
  useFilesStore.setState({ projects: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function heading(name: string): HTMLElement {
  return screen.getByRole("heading", { level: 2, name });
}

function headerOf(name: string): HTMLElement {
  return heading(name).parentElement as HTMLElement;
}

function dotOf(name: string): string | undefined {
  return heading(name).querySelector<HTMLElement>("span[aria-hidden][style]")?.style.background;
}

function painted(color: string): string {
  const probe = document.createElement("span");
  probe.style.background = color;
  return probe.style.background;
}

describe("NotesLibrary", () => {
  it("groups notes and artifacts under their project", () => {
    renderLibrary();
    const sections = screen.getAllByRole("heading", { level: 2 });
    expect(sections.map((heading) => within(heading).getByRole("button").getAttribute("aria-label"))).toEqual(["Vision", "Language"]);
    const vision = sections[0].closest("section") as HTMLElement;
    expect(within(vision).getByText("Masking ablation")).toBeInTheDocument();
    expect(within(vision).getByText("Agent scratch")).toBeInTheDocument();
    expect(within(vision).getByText("Loss curve")).toBeInTheDocument();
    const language = sections[1].closest("section") as HTMLElement;
    expect(within(language).getByText("Reading list")).toBeInTheDocument();
    expect(within(language).getByText("Ablation report")).toBeInTheDocument();
  });

  it("marks each project with its library colour and counts what it holds", () => {
    useProjectColorsStore.setState({ colors: { "p-vision": "#cfbaf0" } });
    useFilesStore.setState({ projects: [{ id: "p-language", name: "Language", color: "#98f5e1" } as ProjectInfo] });
    renderLibrary();
    expect(dotOf("Vision")).toBe(painted("#cfbaf0"));
    expect(dotOf("Language")).toBe(painted("#98f5e1"));
    expect(within(headerOf("Vision")).getByText("6")).toBeInTheDocument();
    expect(within(headerOf("Language")).getByText("2")).toBeInTheDocument();
  });

  it("folds a project group open and closed from its header and remembers it", async () => {
    const user = userEvent.setup();
    const view = renderLibrary();
    const toggle = within(heading("Vision")).getByRole("button");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Masking ablation")).not.toBeInTheDocument();
    expect(screen.getByText("Reading list")).toBeInTheDocument();
    view.unmount();
    renderLibrary();
    const again = within(heading("Vision")).getByRole("button");
    expect(again).toHaveAttribute("aria-expanded", "false");
    await user.click(again);
    expect(screen.getByText("Masking ablation")).toBeInTheDocument();
    expect(useNotesPrefsStore.getState().closedGroups).toEqual([]);
  });

  it("still folds a group after many closed groups were deleted, and forgets those", async () => {
    const user = userEvent.setup();
    useNotesPrefsStore.getState().set("closedGroups", [...Array.from({ length: 600 }, (_, index) => `gone-${index}`), "p-language"]);
    renderLibrary();
    expect(within(heading("Language")).getByRole("button")).toHaveAttribute("aria-expanded", "false");
    const toggle = within(heading("Vision")).getByRole("button");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(useNotesPrefsStore.getState().closedGroups).toEqual(["p-language", "p-vision"]);
  });

  it("gives a project without a picked colour the library's default", () => {
    renderLibrary();
    expect(dotOf("Vision")).toBe(painted(DEFAULT_BOOK_COLOR));
  });

  it("draws a neutral dot for notes that are not about a project", () => {
    renderLibrary({ data: fakeData({ artifacts: [] }) });
    expect(dotOf("Vision")).toBe(painted("transparent"));
    expect(dotOf("Language")).toBe(painted("transparent"));
  });

  it("takes a group's colour from a note's related project", () => {
    useProjectColorsStore.setState({ colors: { "p-language": "#ffcfd2" } });
    renderLibrary({ data: fakeData({ notes: [{ ...notes[1], relatedProjectId: "p-language" }], artifacts: [] }) });
    expect(dotOf("Language")).toBe(painted("#ffcfd2"));
  });

  it("tags agent-written items with the agent and leaves your own plain", () => {
    renderLibrary();
    expect(within(row("Masking ablation")).getByText("Codex").closest("[data-agent-tag]")).toBeInTheDocument();
    expect(within(row("Agent scratch")).getByText(copy.agentFallback).closest("[data-agent-tag]")).toBeInTheDocument();
    expect(row("Reading list").querySelector("[data-agent-tag]")).toBeNull();
  });

  it("tints each note row with the note's colour and each artifact row with its kind", () => {
    renderLibrary({ data: fakeData({ notes: notes.map((note) => (note.id === "n2" ? { ...note, color: "mint" } : note)) }) });
    const chipOf = (title: string) => row(title).querySelector<HTMLElement>("[data-note-color]");
    const colorOf = (title: string) => chipOf(title)?.getAttribute("data-note-color");
    const kindOf = (title: string) => row(title).querySelector("[data-kind]")?.getAttribute("data-kind");
    expect(colorOf("Masking ablation")).toBe("blue");
    expect(colorOf("Reading list")).toBe("mint");
    expect(chipOf("Masking ablation")?.style.getPropertyValue("--note-color")).toBe(NOTE_COLOR_HEX.blue);
    expect(chipOf("Reading list")?.style.getPropertyValue("--note-color")).toBe(NOTE_COLOR_HEX.mint);
    expect(kindOf("Masking ablation")).toBeUndefined();
    expect(kindOf("Loss curve")).toBe("figure");
    expect(kindOf("Attention map")).toBe("html");
    expect(kindOf("Ablation report")).toBe("report");
    expect(kindOf("Metrics table")).toBe("data");
    expect(kindOf("Checkpoint")).toBe("file");
  });

  it("marks each kind filter with its kind's dot and leaves All and the author filters plain", async () => {
    renderLibrary();
    await openFilters(userEvent.setup());
    const dot = (chip: HTMLElement) => chip.querySelector("[data-kind-dot]")?.getAttribute("data-kind-dot") ?? null;
    expect([copy.kind.all, copy.kind.note, copy.kind.figure, copy.kind.report, copy.kind.data].map(kindChip).map(dot)).toEqual([
      null,
      "note",
      "figure",
      "report",
      "data",
    ]);
    expect(dot(authorChip(copy.author.agent))).toBeNull();
  });

  it("shows only when a shared note changed, since anyone may have written it", () => {
    renderLibrary({ data: fakeData({ notes: notes.map((note) => (note.title === "Reading list" ? { ...note, shared: true } : note)) }) });
    expect(row("Reading list")).toHaveTextContent(ago(notes[1].updatedAt));
    expect(row("Reading list")).not.toHaveTextContent(copy.author.you);
  });

  it("shows who wrote each item and when", () => {
    renderLibrary();
    expect(row("Masking ablation")).toHaveTextContent(`Codex · ${ago(notes[0].updatedAt)}`);
    expect(row("Reading list")).toHaveTextContent(`${copy.author.you} · ${ago(notes[1].updatedAt)}`);
    expect(row("Agent scratch")).toHaveTextContent(`${copy.agentFallback} · ${ago(notes[2].updatedAt)}`);
    expect(row("Loss curve")).toHaveTextContent(`Codex · ${ago(artifacts[0].updatedAt)}`);
    expect(row("Ablation report")).toHaveTextContent(`${copy.agentFallback} · ${ago(artifacts[2].updatedAt)}`);
  });

  it("asks the workspace for each note's icon", () => {
    const view = renderLibrary();
    expect(view.iconFor).toHaveBeenCalledWith(notes[0]);
    expect(view.iconFor).toHaveBeenCalledWith(notes[1]);
    expect(view.iconFor).toHaveBeenCalledWith(notes[2]);
  });

  it("filters by title, ignoring case and surrounding spaces", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await user.type(await openSearch(user), "  ABLATION ");
    expect(rowTitles()).toEqual(["Masking ablation", "Ablation report"]);
  });

  it("says nothing matches when the filters hide everything", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await user.type(await openSearch(user), "zebra");
    expect(screen.getByText(copy.empty)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
  });

  it("lists ways to start when there are no notes or artifacts", async () => {
    const user = userEvent.setup();
    const onNewNote = vi.fn();
    renderLibrary({ onNewNote, data: fakeData({ notes: [], artifacts: [], createNoteFrom: vi.fn() }) });
    const start = screen.getByRole("region", { name: copy.start.title });
    expect(within(start).getAllByRole("button").map((row) => row.textContent)).toEqual([
      expect.stringContaining(copy.newNote),
      expect.stringContaining(enNotes.vault.templates.open),
    ]);
    await user.click(within(start).getByRole("button", { name: new RegExp(copy.newNote) }));
    expect(onNewNote).toHaveBeenCalledOnce();
  });

  it("leaves the start list out once the vault has notes", () => {
    renderLibrary();
    expect(screen.queryByRole("region", { name: copy.start.title })).not.toBeInTheDocument();
  });

  it("offers the note, figure, report and data filters", async () => {
    renderLibrary();
    await openFilters(userEvent.setup());
    expect(within(screen.getByRole("group", { name: enNotes.vault.search.fields.kind })).getAllByRole("button").slice(0, 5).map((tab) => tab.textContent)).toEqual([
      copy.kind.all,
      copy.kind.note,
      copy.kind.figure,
      copy.kind.report,
      copy.kind.data,
    ]);
  });

  it("narrows the list by kind, counting interactive figures as figures", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await openFilters(user);
    expect(kindChip(copy.kind.all)).toHaveAttribute("aria-pressed", "true");

    await user.click(kindChip(copy.kind.note));
    expect(rowTitles()).toEqual(["Masking ablation", "Agent scratch", "Reading list"]);

    await user.click(kindChip(copy.kind.figure));
    expect(rowTitles()).toEqual(["Loss curve", "Attention map"]);

    await user.click(kindChip(copy.kind.report));
    expect(rowTitles()).toEqual(["Ablation report"]);

    await user.click(kindChip(copy.kind.data));
    expect(rowTitles()).toEqual(["Metrics table"]);

    await user.click(kindChip(copy.kind.all));
    expect(rowTitles()).toEqual([
      "Masking ablation",
      "Agent scratch",
      "Loss curve",
      "Attention map",
      "Metrics table",
      "Checkpoint",
      "Reading list",
      "Ablation report",
    ]);
  });

  it("counts every artifact as made by an agent", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await openFilters(user);

    await user.click(authorChip(copy.author.you));
    expect(rowTitles()).toEqual(["Reading list"]);

    await user.click(authorChip(copy.author.agent));
    expect(rowTitles()).toEqual([
      "Masking ablation",
      "Agent scratch",
      "Loss curve",
      "Attention map",
      "Metrics table",
      "Checkpoint",
      "Ablation report",
    ]);

    await user.click(authorChip(copy.author.all));
    expect(rowTitles()).toHaveLength(8);
  });

  it("opens notes and artifacts when their rows are clicked", async () => {
    const user = userEvent.setup();
    const view = renderLibrary();
    await user.click(row("Reading list"));
    expect(view.onOpenNote).toHaveBeenCalledWith("n2");
    await user.click(row("Metrics table"));
    expect(view.onOpenArtifact).toHaveBeenCalledWith(artifacts[3]);
  });

  it("marks the open note as the current page", () => {
    renderLibrary({ activeNoteId: "n1" });
    expect(row("Masking ablation")).toHaveAttribute("aria-current", "page");
    expect(row("Reading list")).not.toHaveAttribute("aria-current");
  });

  it("marks the open artifact instead of its note while an artifact is open", () => {
    renderLibrary({ activeNoteId: "n1", activeArtifactId: "a1" });
    expect(row("Loss curve")).toHaveAttribute("aria-current", "page");
    expect(row("Masking ablation")).not.toHaveAttribute("aria-current");
  });

  it("disables New note when no handler is given", () => {
    renderLibrary();
    expect(screen.getByRole("button", { name: copy.newNote })).toBeDisabled();
  });

  it("starts a new note from the New note button", async () => {
    const user = userEvent.setup();
    const onNewNote = vi.fn();
    renderLibrary({ onNewNote });
    await user.click(screen.getByRole("button", { name: copy.newNote }));
    expect(onNewNote).toHaveBeenCalledOnce();
  });

  it("goes home from the brand button", async () => {
    const user = userEvent.setup();
    const view = renderLibrary();
    await user.click(screen.getByRole("button", { name: enShell.home.ariaLabel }));
    expect(view.onHome).toHaveBeenCalledOnce();
  });
});

const menuCopy = copy.menu;
const PROJECT_CHOICES = [
  { id: "p-vision", name: "Vision" },
  { id: "p-language", name: "Language" },
];

function actionData(overrides: Partial<NotesData> = {}): NotesData {
  return fakeData({
    projects: PROJECT_CHOICES,
    renameNote: vi.fn(async () => {}),
    setRelatedProject: vi.fn(async () => {}),
    deleteNote: vi.fn(async () => {}),
    ...overrides,
  });
}

function noteRow(title: string): HTMLElement {
  const match = screen.getByText(title).closest<HTMLElement>("[data-note-row]");
  if (!match) throw new Error(`no note row for ${title}`);
  return match;
}

function moreButton(title: string): HTMLElement {
  return within(noteRow(title)).getByRole("button", { name: menuCopy.more });
}

function openMore(title: string): HTMLElement {
  fireEvent.pointerDown(moreButton(title), { button: 0, ctrlKey: false });
  return screen.getByRole("menu");
}

function menuItemNames(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent ?? "");
}

async function startRename(user: ReturnType<typeof userEvent.setup>, title: string): Promise<HTMLInputElement> {
  await user.click(within(openMore(title)).getByRole("menuitem", { name: menuCopy.rename }));
  return (await screen.findByRole("textbox", { name: menuCopy.renameLabel })) as HTMLInputElement;
}

describe("NotesLibrary filters", () => {
  it("keeps the filters folded at the bottom of the sidebar, under the list and over the footer, with search at the top", () => {
    const { container } = renderLibrary();
    const aside = container.querySelector("aside") as HTMLElement;
    expect(filtersToggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: copy.filters.writtenBy })).not.toBeInTheDocument();
    expect(aside.lastElementChild?.tagName).toBe("FOOTER");
    expect(aside.lastElementChild?.previousElementSibling).toBe(screen.getByTestId("notes-filters"));
    const search = screen.getByRole("button", { name: copy.search });
    expect(search.compareDocumentPosition(filtersToggle()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Vision" }).compareDocumentPosition(filtersToggle())).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("opens the filters and remembers whether they were open", async () => {
    const user = userEvent.setup();
    const first = renderLibrary();
    await openFilters(user);
    expect(filtersToggle()).toHaveAttribute("aria-expanded", "true");
    expect(kindChip(copy.kind.figure)).toBeInTheDocument();
    expect(useNotesPrefsStore.getState().filtersOpen).toBe(true);
    first.unmount();

    renderLibrary();
    expect(filtersToggle()).toHaveAttribute("aria-expanded", "true");
    await user.click(filtersToggle());
    expect(screen.queryByRole("group", { name: copy.filters.writtenBy })).not.toBeInTheDocument();
    expect(useNotesPrefsStore.getState().filtersOpen).toBe(false);
  });

  it("counts the filters that are on, folded or not", async () => {
    const user = userEvent.setup();
    renderLibrary();
    const count = () => screen.getByTestId("notes-filters").querySelector("output");
    expect(count()).toBeNull();

    await openFilters(user);
    await user.click(kindChip(copy.kind.figure));
    expect(count()).toHaveTextContent("1");
    expect(count()).toHaveAttribute("aria-label", copy.filters.active_one.replace("{{count}}", "1"));

    await user.click(authorChip(copy.author.you));
    expect(count()).toHaveTextContent("2");
    expect(count()).toHaveAttribute("aria-label", copy.filters.active_other.replace("{{count}}", "2"));

    await user.click(filtersToggle());
    expect(count()).toHaveTextContent("2");
    expect(rowTitles()).toEqual([]);

    await user.click(filtersToggle());
    await user.click(kindChip(copy.kind.all));
    await user.click(authorChip(copy.author.all));
    expect(count()).toBeNull();
  });

  it("starts folded when the saved state can't be read and still opens when it can't be saved", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage is blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage is blocked");
    });
    const user = userEvent.setup();
    renderLibrary();
    expect(filtersToggle()).toHaveAttribute("aria-expanded", "false");
    await openFilters(user);
    expect(filtersToggle()).toHaveAttribute("aria-expanded", "true");
  });
});

describe("NotesLibrary header", () => {
  it("holds only the brand, Search and New note at rest", () => {
    const { container } = renderLibrary({ onNewNote: vi.fn() });
    const row = header(container);
    expect(within(row).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      enShell.home.ariaLabel,
      copy.search,
      copy.newNote,
    ]);
    expect(screen.queryByRole("combobox", { name: copy.search })).not.toBeInTheDocument();
  });

  it("reads Oleafly Notes in the brand and draws no line under the header, at the height of the tab strip", () => {
    const { container } = renderLibrary();
    const row = header(container);
    expect(within(row).getByText(enNotes.workspace.brand)).toHaveAttribute("data-brand-label");
    expect(row).not.toHaveClass("border-b");
    expect(row).toHaveClass("h-12");
  });

  it("names the search shortcut in the Search button's hover help", async () => {
    renderLibrary();
    const button = screen.getByRole("button", { name: copy.search });
    fireEvent.mouseEnter(button.parentElement as HTMLElement);
    const keys = shortcutLabel(useShortcutStore.getState().bindings.notesSearch);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      enShell.rail.withShortcut.replace("{{label}}", copy.search).replace("{{shortcut}}", keys),
    );
  });

  it("folds the brand away into a focused search field from the Search button", async () => {
    const user = userEvent.setup();
    const { container } = renderLibrary({ onNewNote: vi.fn() });
    const search = await openSearch(user);
    expect(search).toHaveFocus();
    expect(screen.queryByRole("button", { name: enShell.home.ariaLabel })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.search })).not.toBeInTheDocument();
    expect(header(container)).toContainElement(search);
    expect(within(header(container)).getByText(enShell.keys.esc).tagName).toBe("KBD");
    const newNote = screen.getByRole("button", { name: copy.newNote });
    expect(search.compareDocumentPosition(newNote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens and focuses the field from the Notes search shortcut", () => {
    renderLibrary();
    act(() => focusNotesSearch());
    expect(screen.getByRole("combobox", { name: copy.search })).toHaveFocus();
  });

  it("clears and folds back on Escape and gives focus back to the Search button", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await user.type(await openSearch(user), "zebra");
    expect(rowTitles()).toEqual([]);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("combobox", { name: copy.search })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.search })).toHaveFocus();
    expect(screen.getByRole("button", { name: enShell.home.ariaLabel })).toBeInTheDocument();
    expect(rowTitles()).toContain("Masking ablation");
  });

  it("folds on the first Escape while the field is empty, even with the suggestions showing", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await openSearch(user);
    expect(screen.getByTestId("query-search-menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("combobox", { name: copy.search })).not.toBeInTheDocument();
    expect(screen.queryByTestId("query-search-menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.search })).toHaveFocus();
  });

  it("closes the suggestions first when there is a query, then folds on the next Escape", async () => {
    const user = userEvent.setup();
    renderLibrary();
    const search = await openSearch(user);
    await user.type(search, "kind:");
    expect(screen.getByTestId("query-search-menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("query-search-menu")).not.toBeInTheDocument();
    expect(search).toHaveValue("kind:");
    expect(search).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("combobox", { name: copy.search })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.search })).toHaveFocus();
  });

  it("folds on Escape from the clear button too", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await user.type(await openSearch(user), "ablation");
    act(() => screen.getByRole("button", { name: enNotes.vault.search.clear }).focus());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("combobox", { name: copy.search })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.search })).toHaveFocus();
    expect(rowTitles()).toContain("Masking ablation");
  });

  it("folds back on blur while the query is empty", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await openSearch(user);
    await user.click(document.body);
    await waitFor(() => expect(screen.queryByRole("combobox", { name: copy.search })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: copy.search })).toBeInTheDocument();
  });

  it("stays open on blur while there is a query, and folds once the clear button empties it", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await user.type(await openSearch(user), "ablation");
    await user.click(document.body);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    const search = screen.getByRole("combobox", { name: copy.search });
    expect(search).toHaveValue("ablation");
    expect(rowTitles()).toEqual(["Masking ablation", "Ablation report"]);
    await user.click(screen.getByRole("button", { name: enNotes.vault.search.clear }));
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
    await user.click(document.body);
    await waitFor(() => expect(screen.queryByRole("combobox", { name: copy.search })).not.toBeInTheDocument());
  });
});

describe("NotesLibrary footer", () => {
  it("opens the app settings from the gear in the footer", async () => {
    const user = userEvent.setup();
    const openSettings = vi.fn();
    const { container } = renderLibrary({ data: fakeData({ openSettings }) });
    const settings = screen.getByRole("button", { name: copy.settings });
    expect(container.querySelector("footer")).toContainElement(settings);
    await user.click(settings);
    expect(openSettings).toHaveBeenCalledOnce();
  });

  it("disables Settings when the app can't open them", () => {
    renderLibrary();
    expect(screen.getByRole("button", { name: copy.settings })).toBeDisabled();
  });
});

describe("NotesLibrary note actions", () => {
  it("gives every note a More button and leaves artifacts without one", () => {
    renderLibrary({ data: actionData() });
    expect(screen.getAllByRole("button", { name: menuCopy.more })).toHaveLength(notes.length);
    expect(moreButton("Masking ablation")).toBeInTheDocument();
    expect(row("Loss curve").closest("[data-note-row]")).toBeNull();
  });

  it("keeps the More button inside the open note's row", () => {
    renderLibrary({ data: actionData(), activeNoteId: "n1" });
    const current = screen.getByRole("button", { current: "page" });
    expect(current.parentElement).toContainElement(moreButton("Masking ablation"));
  });

  it("renames a note in its row and saves the trimmed title on Enter", async () => {
    const user = userEvent.setup();
    const data = actionData();
    renderLibrary({ data });
    const input = await startRename(user, "Masking ablation");
    expect(input).toHaveValue("Masking ablation");
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Masking ablation".length);
    const renamingRow = input.closest("[data-note-row]") as HTMLElement;
    expect(within(renamingRow).queryByRole("button", { name: menuCopy.more })).not.toBeInTheDocument();
    expect(moreButton("Agent scratch")).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "  Masking sweep  {Enter}");
    expect(data.renameNote).toHaveBeenCalledExactlyOnceWith("n1", "Masking sweep");
    expect(screen.queryByRole("textbox", { name: menuCopy.renameLabel })).not.toBeInTheDocument();
    expect(row("Masking ablation")).toBeInTheDocument();
  });

  it("keeps the title when the rename is left unchanged or empty", async () => {
    const user = userEvent.setup();
    const data = actionData();
    renderLibrary({ data });
    await user.type(await startRename(user, "Masking ablation"), " {Enter}");
    const input = await startRename(user, "Masking ablation");
    await user.clear(input);
    await user.type(input, "   {Enter}");
    expect(data.renameNote).not.toHaveBeenCalled();
  });

  it("opens the same menu on right-click and renames from it", async () => {
    const user = userEvent.setup();
    const data = actionData();
    renderLibrary({ data, onOpenNoteInNewTab: vi.fn() });
    fireEvent.contextMenu(row("Agent scratch"));
    const menu = screen.getByRole("menu");
    expect(menuItemNames(menu)).toEqual([
      menuCopy.openInNewTab,
      menuCopy.copyLink,
      menuCopy.export,
      menuCopy.favorite,
      menuCopy.rename,
      menuCopy.useAsTemplate,
      menuCopy.linkProject,
      menuCopy.delete,
    ]);
    await user.click(within(menu).getByRole("menuitem", { name: menuCopy.rename }));
    const input = await screen.findByRole("textbox", { name: menuCopy.renameLabel });
    expect(input).toHaveValue("Agent scratch");

    fireEvent.contextMenu(input);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("deletes from the right-click menu", async () => {
    const user = userEvent.setup();
    const data = actionData();
    renderLibrary({ data });
    fireEvent.contextMenu(row("Agent scratch"));
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: menuCopy.delete }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: menuCopy.deleteConfirm }));
    expect(data.deleteNote).toHaveBeenCalledExactlyOnceWith("n3");
  });

  it("closes the menu without acting when nothing is picked", async () => {
    const user = userEvent.setup();
    const data = actionData();
    renderLibrary({ data });
    openMore("Masking ablation");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(screen.queryByRole("textbox", { name: menuCopy.renameLabel })).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("NotesLibrary filters", () => {
  it("calls the section Tags, counts every filter and clears them all", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await openFilters(user);
    await user.click(kindChip(copy.kind.figure));
    await user.click(authorChip(copy.author.you));
    expect(screen.getByText(copy.emptyKind.figure)).toBeInTheDocument();
    expect(filtersToggle()).toHaveAccessibleName(expect.stringContaining(copy.filters.title));
    expect(screen.getByText("2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.filters.clear }));
    expect(rowTitles()).toContain("Masking ablation");
    expect(screen.queryByRole("button", { name: copy.filters.clear })).not.toBeInTheDocument();
  });

  it("calls the author filter for everyone All and puts Clear filters at the end of that row only while a filter is on", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await openFilters(user);
    const authors = screen.getByRole("group", { name: copy.filters.writtenBy });
    const label = screen.getByText(copy.filters.writtenBy);
    expect(label).toHaveAttribute("aria-hidden");
    expect(label).toHaveClass("text-muted-foreground");
    expect(label.compareDocumentPosition(authors) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("group", { name: enNotes.vault.search.fields.kind }).compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(copy.author.all).toBe("All");
    expect(within(authors).getAllByRole("button").map((button) => button.textContent)).toEqual([
      copy.author.all,
      copy.author.agent,
      copy.author.you,
    ]);
    expect(screen.queryByRole("button", { name: copy.filters.clear })).not.toBeInTheDocument();

    await user.click(authorChip(copy.author.you));
    const clear = screen.getByRole("button", { name: copy.filters.clear });
    const row = authors.parentElement;
    expect(clear.parentElement).toBe(row);
    expect(row).toHaveClass("flex", "items-center");
    expect(row).not.toHaveClass("flex-wrap");
    expect(row?.lastElementChild).toBe(clear);
    expect(clear).toHaveClass("ml-auto", "shrink-0");

    await user.click(clear);
    expect(screen.queryByRole("button", { name: copy.filters.clear })).not.toBeInTheDocument();
    expect(authorChip(copy.author.all)).toHaveAttribute("aria-pressed", "true");
  });

  it("hides artifacts and the kind filter while Research tasks is off", async () => {
    renderLibrary({ data: fakeData({ researchTasks: false }) });
    await openFilters(userEvent.setup());
    expect(screen.queryByRole("button", { name: copy.kind.figure })).not.toBeInTheDocument();
    expect(screen.queryByText("Loss curve")).not.toBeInTheDocument();
    expect(rowTitles()).toContain("Masking ablation");
  });

  it("says Search notes, not artifacts, while Research tasks is off", async () => {
    const user = userEvent.setup();
    const { unmount } = renderLibrary({ data: fakeData({ researchTasks: false }) });
    const search = await openSearch(user, enNotes.home.search);
    expect(search).toHaveAttribute("placeholder", enNotes.home.search);
    unmount();
    renderLibrary();
    expect(await openSearch(user)).toHaveAttribute("placeholder", copy.search);
  });

  it("groups the filters as toggle buttons, not tabs without panels", async () => {
    renderLibrary();
    await openFilters(userEvent.setup());
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    const kinds = screen.getByRole("group", { name: enNotes.vault.search.fields.kind });
    const authors = screen.getByRole("group", { name: copy.filters.writtenBy });
    expect(within(kinds).getAllByRole("button", { pressed: true }).map((button) => button.textContent)).toEqual([copy.kind.all]);
    expect(within(authors).getAllByRole("button", { pressed: true }).map((button) => button.textContent)).toEqual([copy.author.all]);
  });

  it("keeps the search text when Escape only ends an IME composition", async () => {
    const user = userEvent.setup();
    renderLibrary();
    const search = await openSearch(user);
    await user.type(search, "mask");
    fireEvent.keyDown(search, { key: "Escape", keyCode: 229 });
    expect(search).toHaveValue("mask");
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
  });
});

describe("NotesLibrary home button", () => {
  it("uses the label the workspace gives it", () => {
    render(
      <NotesDataProvider value={fakeData()}>
        <NotesLibrary
          iconFor={(note) => note.icon}
          activeNoteId={null}
          activeArtifactId={null}
          homeLabel={enNotes.workspace.notesHome}
          onHome={vi.fn()}
          onOpenNote={vi.fn()}
          onOpenArtifact={vi.fn()}
        />
      </NotesDataProvider>,
    );
    expect(screen.getByRole("button", { name: enNotes.workspace.notesHome })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enShell.home.ariaLabel })).not.toBeInTheDocument();
  });
});
