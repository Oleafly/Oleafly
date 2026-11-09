// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { formatRelativeTimeFrom } from "@/lib/intl";

const env = vi.hoisted(() => ({ mac: false, fullscreen: false }));
const log = vi.hoisted(() => ({ logError: vi.fn(async () => {}) }));

vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logError: log.logError,
}));

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return {
    ...actual,
    get isMac() {
      return env.mac;
    },
  };
});
vi.mock("@/lib/use-fullscreen", () => ({ useFullscreen: () => env.fullscreen }));

import type { ProjectInfo } from "@oleafly/backend-port";
import { DEFAULT_BOOK_COLOR } from "@/components/library/Book";
import { useCloudStore } from "@/store/cloud";
import { useFilesStore } from "@/store/files";
import { useProjectColorsStore } from "@/store/project-colors";
import { useToastStore } from "@/store/toast";
import { NotesLibrary } from "./NotesLibrary";
import { NOTE_COLOR_HEX } from "./note-icons";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { ArtifactItem, NoteItem } from "./types";

const copy = enNotes.library;
const NOTES_FILTERS_OPEN_KEY = "oleafly.notes.filtersOpen";
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
  return {
    notes,
    artifacts,
    experiments: [],
    citations: [],
    papers: [],
    loadNote: vi.fn(),
    saveNote: vi.fn(),
    ...overrides,
  };
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
    .map((button) => button.querySelector(".block.truncate.text-sm")?.textContent)
    .filter((title): title is string => Boolean(title));
}

function chip(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

function filtersToggle(): HTMLElement {
  return screen.getByRole("button", { name: copy.filters.title });
}

async function openFilters(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(filtersToggle());
}

function row(title: string): HTMLElement {
  const match = screen.getByText(title).closest("button");
  if (!match) throw new Error(`no row for ${title}`);
  return match;
}

function ago(timestamp: number): string {
  return formatRelativeTimeFrom(timestamp, Date.now(), { dateAfterDays: 7 });
}

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  env.mac = false;
  env.fullscreen = false;
  localStorage.clear();
  log.logError.mockClear();
  useToastStore.setState({ toasts: [] });
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

function dotOf(name: string): string | null {
  return heading(name).querySelector("[data-project-color]")?.getAttribute("data-project-color") ?? null;
}

describe("NotesLibrary", () => {
  it("groups notes and artifacts under their project", () => {
    renderLibrary();
    const sections = screen.getAllByRole("heading", { level: 2 });
    expect(sections.map((heading) => heading.textContent)).toEqual(["Vision", "Language"]);
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
    expect(dotOf("Vision")).toBe("#cfbaf0");
    expect(dotOf("Language")).toBe("#98f5e1");
    expect(headerOf("Vision")).toHaveTextContent(/6$/u);
    expect(headerOf("Language")).toHaveTextContent(/2$/u);
  });

  it("gives a project without a picked colour the library's default", () => {
    renderLibrary();
    expect(dotOf("Vision")).toBe(DEFAULT_BOOK_COLOR);
  });

  it("draws a neutral dot for notes that are not about a project", () => {
    renderLibrary({ data: fakeData({ artifacts: [] }) });
    expect(dotOf("Vision")).toBe("none");
    expect(dotOf("Language")).toBe("none");
  });

  it("takes a group's colour from a note's related project", () => {
    useProjectColorsStore.setState({ colors: { "p-language": "#ffcfd2" } });
    renderLibrary({ data: fakeData({ notes: [{ ...notes[1], relatedProjectId: "p-language" }], artifacts: [] }) });
    expect(dotOf("Language")).toBe("#ffcfd2");
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
    expect(chipOf("Masking ablation")).toHaveClass("note-chip");
    expect(chipOf("Masking ablation")?.querySelector("svg")).toHaveClass("lucide-atom", "text-current");
    expect(chipOf("Reading list")?.querySelector("svg")).toHaveClass("text-current");
  });

  it("shows the filters as chips with a dot in each kind's colour", async () => {
    renderLibrary();
    await openFilters(userEvent.setup());
    for (const name of [copy.kind.all, copy.kind.note, copy.author.all, copy.author.you]) {
      expect(chip(name)).toHaveClass("rounded-full", "border", "aria-pressed:bg-primary/10", "aria-pressed:text-primary");
    }
    expect(chip(copy.kind.all).querySelector("[data-kind-dot]")).toBeNull();
    expect(chip(copy.kind.note).querySelector("[data-kind-dot]")).toHaveClass("bg-violet-500");
    expect(chip(copy.kind.figure).querySelector("[data-kind-dot]")).toHaveClass("bg-pink-500");
    expect(chip(copy.kind.report).querySelector("[data-kind-dot]")).toHaveClass("bg-sky-500");
    expect(chip(copy.kind.data).querySelector("[data-kind-dot]")).toHaveClass("bg-emerald-500");
    expect(chip(copy.author.agent).querySelector("[data-kind-dot]")).toBeNull();
  });

  it("tints the open item with the primary colour", () => {
    renderLibrary({ activeNoteId: "n2" });
    expect(row("Reading list")).toHaveClass("bg-primary/10");
    expect(row("Masking ablation")).not.toHaveClass("bg-primary/10");
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
    await user.type(screen.getByRole("combobox", { name: copy.search }), "  ABLATION ");
    expect(rowTitles()).toEqual(["Masking ablation", "Ablation report"]);
  });

  it("says nothing matches when the filters hide everything", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await user.type(screen.getByRole("combobox", { name: copy.search }), "zebra");
    expect(screen.getByText(copy.empty)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
  });

  it("invites a first note when there are no notes or artifacts", () => {
    renderLibrary({ data: fakeData({ notes: [], artifacts: [] }) });
    expect(screen.getByText(copy.noNotes)).toBeInTheDocument();
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
    expect(chip(copy.kind.all)).toHaveAttribute("aria-pressed", "true");

    await user.click(chip(copy.kind.note));
    expect(rowTitles()).toEqual(["Masking ablation", "Agent scratch", "Reading list"]);

    await user.click(chip(copy.kind.figure));
    expect(rowTitles()).toEqual(["Loss curve", "Attention map"]);

    await user.click(chip(copy.kind.report));
    expect(rowTitles()).toEqual(["Ablation report"]);

    await user.click(chip(copy.kind.data));
    expect(rowTitles()).toEqual(["Metrics table"]);

    await user.click(chip(copy.kind.all));
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

    await user.click(chip(copy.author.you));
    expect(rowTitles()).toEqual(["Reading list"]);

    await user.click(chip(copy.author.agent));
    expect(rowTitles()).toEqual([
      "Masking ablation",
      "Agent scratch",
      "Loss curve",
      "Attention map",
      "Metrics table",
      "Checkpoint",
      "Ablation report",
    ]);

    await user.click(chip(copy.author.all));
    expect(rowTitles()).toHaveLength(8);
  });

  it("shows each artifact's own icon", () => {
    renderLibrary();
    expect(row("Metrics table").querySelector("svg")).toHaveClass("lucide-database");
    expect(row("Checkpoint").querySelector("svg")).toHaveClass("lucide-file");
    expect(row("Attention map").querySelector("svg")).toHaveClass("lucide-braces");
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

  it("leaves room for the macOS window buttons unless the window is fullscreen", () => {
    env.mac = true;
    const { container, unmount } = renderLibrary();
    expect(container.querySelector("[data-tauri-drag-region]")).toHaveClass("pl-[78px]");
    unmount();

    env.fullscreen = true;
    const fullscreen = renderLibrary();
    expect(fullscreen.container.querySelector("[data-tauri-drag-region]")).not.toHaveClass("pl-[78px]");
  });

  it("keeps the default padding off macOS", () => {
    const { container } = renderLibrary();
    expect(container.querySelector("[data-tauri-drag-region]")).not.toHaveClass("pl-[78px]");
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

async function openProjects(user: ReturnType<typeof userEvent.setup>, title: string): Promise<HTMLElement> {
  const menu = openMore(title);
  const trigger = within(menu).getByRole("menuitem", { name: menuCopy.linkProject });
  trigger.focus();
  await user.keyboard("{ArrowRight}");
  return (await screen.findAllByRole("menu")).at(-1) as HTMLElement;
}

async function startRename(user: ReturnType<typeof userEvent.setup>, title: string): Promise<HTMLInputElement> {
  await user.click(within(openMore(title)).getByRole("menuitem", { name: menuCopy.rename }));
  return (await screen.findByRole("textbox", { name: menuCopy.renameLabel })) as HTMLInputElement;
}

function toastMessages(kind: "success" | "error"): string[] {
  return useToastStore
    .getState()
    .toasts.filter((toast) => toast.kind === kind)
    .map((toast) => toast.message);
}

describe("NotesLibrary filters", () => {
  it("keeps the filters folded at the bottom of the sidebar, under the list, with search at the top", () => {
    const { container } = renderLibrary();
    const aside = container.querySelector("aside") as HTMLElement;
    expect(filtersToggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: enNotes.vault.search.fields.author })).not.toBeInTheDocument();
    expect(aside.lastElementChild).toBe(screen.getByTestId("notes-filters"));
    expect(screen.getByTestId("notes-filters")).toHaveClass("border-t", "shrink-0");
    const search = screen.getByRole("combobox", { name: copy.search });
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
    expect(chip(copy.kind.figure)).toBeInTheDocument();
    expect(localStorage.getItem(NOTES_FILTERS_OPEN_KEY)).toBe("true");
    first.unmount();

    renderLibrary();
    expect(filtersToggle()).toHaveAttribute("aria-expanded", "true");
    await user.click(filtersToggle());
    expect(screen.queryByRole("group", { name: enNotes.vault.search.fields.author })).not.toBeInTheDocument();
    expect(localStorage.getItem(NOTES_FILTERS_OPEN_KEY)).toBe("false");
  });

  it("counts the filters that are on, folded or not", async () => {
    const user = userEvent.setup();
    renderLibrary();
    const count = () => screen.getByTestId("notes-filters").querySelector("output");
    expect(count()).toBeNull();

    await openFilters(user);
    await user.click(chip(copy.kind.figure));
    expect(count()).toHaveTextContent("1");
    expect(count()).toHaveAttribute("aria-label", copy.filters.active_one.replace("{{count}}", "1"));

    await user.click(chip(copy.author.you));
    expect(count()).toHaveTextContent("2");
    expect(count()).toHaveAttribute("aria-label", copy.filters.active_other.replace("{{count}}", "2"));

    await user.click(filtersToggle());
    expect(count()).toHaveTextContent("2");
    expect(rowTitles()).toEqual([]);

    await user.click(filtersToggle());
    await user.click(chip(copy.kind.all));
    await user.click(chip(copy.author.all));
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
  it("opens the app settings from the gear beside the brand", async () => {
    const user = userEvent.setup();
    const openSettings = vi.fn();
    const { container } = renderLibrary({ data: fakeData({ openSettings }) });
    const settings = screen.getByRole("button", { name: copy.settings });
    expect(container.querySelector("[data-tauri-drag-region]")).toContainElement(settings);
    expect(settings.querySelector("svg")).toHaveClass("lucide-settings");
    await user.click(settings);
    expect(openSettings).toHaveBeenCalledOnce();
  });

  it("disables Settings when the app can't open them", () => {
    renderLibrary();
    expect(screen.getByRole("button", { name: copy.settings })).toBeDisabled();
  });

  it("puts New note to the right of the search field", () => {
    const { container } = renderLibrary({ onNewNote: vi.fn() });
    const newNote = screen.getByRole("button", { name: copy.newNote });
    const search = screen.getByRole("combobox", { name: copy.search });
    expect(container.querySelector("[data-tauri-drag-region]")).not.toContainElement(newNote);
    const searchRow = search.parentElement?.parentElement as HTMLElement;
    expect(searchRow).toContainElement(newNote);
    expect(search.compareDocumentPosition(newNote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("NotesLibrary note actions", () => {
  it("gives every note a More button and leaves artifacts without one", () => {
    renderLibrary({ data: actionData() });
    expect(screen.getAllByRole("button", { name: menuCopy.more })).toHaveLength(notes.length);
    expect(moreButton("Masking ablation")).toBeInTheDocument();
    expect(row("Loss curve").closest("[data-note-row]")).toBeNull();
    expect(row("Masking ablation")).toHaveClass("pr-9");
  });

  it("still gives a note it can't change a More button, holding only the favorite toggle", () => {
    renderLibrary();
    expect(screen.getAllByRole("button", { name: menuCopy.more })).toHaveLength(notes.length);
    const menu = openMore("Masking ablation");
    expect(menuItemNames(menu)).toEqual([menuCopy.favorite, menuCopy.useAsTemplate]);
    expect(within(menu).queryByRole("separator")).not.toBeInTheDocument();
  });

  it("adds a note to favorites from its menu, keeps it per person and takes it off again", async () => {
    const user = userEvent.setup();
    renderLibrary({ data: actionData() });
    await user.click(within(openMore("Reading list")).getByRole("menuitem", { name: menuCopy.favorite }));
    expect(JSON.parse(localStorage.getItem("oleafly.notes.favorites") ?? "[]")).toEqual(["n2"]);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    const menu = openMore("Reading list");
    expect(within(menu).getByRole("menuitem", { name: menuCopy.unfavorite }).querySelector("svg")).toHaveClass("lucide-star-off");
    await user.click(within(menu).getByRole("menuitem", { name: menuCopy.unfavorite }));
    expect(JSON.parse(localStorage.getItem("oleafly.notes.favorites") ?? "[]")).toEqual([]);
  });

  it("shows the More button on hover or keyboard focus, and keeps it while its menu is open", () => {
    renderLibrary({ data: actionData() });
    const more = moreButton("Masking ablation");
    expect(noteRow("Masking ablation")).toHaveClass("group/row");
    expect(more).toHaveClass(
      "opacity-0",
      "group-hover/row:opacity-100",
      "group-focus-within/row:opacity-100",
      "focus-visible:opacity-100",
      "data-[state=open]:opacity-100",
    );
    expect(more.className).not.toMatch(/(^|\s)(ring|outline)-/u);
    openMore("Masking ablation");
    expect(more).toHaveAttribute("data-state", "open");
  });

  it("opens a note in a new tab", async () => {
    const user = userEvent.setup();
    const onOpenNoteInNewTab = vi.fn();
    const view = renderLibrary({ data: actionData(), onOpenNoteInNewTab });
    await user.click(within(openMore("Reading list")).getByRole("menuitem", { name: menuCopy.openInNewTab }));
    expect(onOpenNoteInNewTab).toHaveBeenCalledWith("n2");
    expect(view.onOpenNote).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("offers each action in order and hides Open in new tab without a handler", () => {
    const { unmount } = renderLibrary({ data: actionData(), onOpenNoteInNewTab: vi.fn() });
    const menu = openMore("Masking ablation");
    expect(menuItemNames(menu)).toEqual([
      menuCopy.openInNewTab,
      menuCopy.favorite,
      menuCopy.rename,
      menuCopy.useAsTemplate,
      menuCopy.linkProject,
      menuCopy.delete,
    ]);
    expect(within(menu).getByRole("separator")).toBeInTheDocument();
    unmount();

    renderLibrary({ data: actionData() });
    expect(menuItemNames(openMore("Masking ablation"))).toEqual([
      menuCopy.favorite,
      menuCopy.rename,
      menuCopy.useAsTemplate,
      menuCopy.linkProject,
      menuCopy.delete,
    ]);
  });

  it("keeps Delete apart from the favorite toggle when it is the only other action", () => {
    renderLibrary({ data: fakeData({ deleteNote: vi.fn(async () => {}) }) });
    const menu = openMore("Masking ablation");
    expect(menuItemNames(menu)).toEqual([menuCopy.favorite, menuCopy.useAsTemplate, menuCopy.delete]);
    expect(within(menu).getByRole("separator")).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: menuCopy.delete })).toHaveClass("text-destructive");
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

  it("saves a rename when the field loses focus", async () => {
    const user = userEvent.setup();
    const data = actionData();
    renderLibrary({ data });
    const input = await startRename(user, "Reading list");
    await user.clear(input);
    await user.type(input, "Reading queue");
    act(() => input.blur());
    expect(data.renameNote).toHaveBeenCalledExactlyOnceWith("n2", "Reading queue");
    expect(screen.queryByRole("textbox", { name: menuCopy.renameLabel })).not.toBeInTheDocument();
  });

  it("cancels a rename with Escape, even when the field then loses focus", async () => {
    const user = userEvent.setup();
    const data = actionData();
    const outer = vi.fn();
    renderLibrary({ data });
    document.addEventListener("keydown", outer);
    const input = await startRename(user, "Masking ablation");
    await user.type(input, " v2");
    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
      fireEvent.blur(input);
    });
    document.removeEventListener("keydown", outer);
    expect(data.renameNote).not.toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalledWith(expect.objectContaining({ key: "Escape" }));
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

  it("keeps renaming when Escape only ends an IME composition", async () => {
    const user = userEvent.setup();
    const data = actionData();
    renderLibrary({ data });
    const input = await startRename(user, "Masking ablation");
    fireEvent.keyDown(input, { key: "Escape", keyCode: 229 });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(screen.getByRole("textbox", { name: menuCopy.renameLabel })).toBe(input);
    expect(data.renameNote).not.toHaveBeenCalled();
  });

  it("marks a note with a cloud conflict copy and opens the compare dialog from its menu", async () => {
    useFilesStore.setState({ projects: [{ id: "n1", kind: "note", main_doc: "note.md" } as ProjectInfo] });
    const conflictCopies = ["note (Laptop 2026-11-08).md"];
    useCloudStore.setState({ state: { projects: [{ localId: "n1", conflictCopies }] } } as unknown as Partial<ReturnType<typeof useCloudStore.getState>>);
    try {
      renderLibrary({ data: actionData() });
      expect(within(noteRow("Masking ablation")).getByRole("img", { name: copy.conflicts.badge })).toBeInTheDocument();
      expect(within(noteRow("Reading list")).queryByRole("img", { name: copy.conflicts.badge })).toBeNull();
      const menu = openMore("Masking ablation");
      fireEvent.click(within(menu).getByRole("menuitem", { name: menuCopy.compareConflict }));
      expect(await screen.findByRole("dialog", { name: copy.conflicts.title.replace("{{name}}", "Masking ablation") })).toBeInTheDocument();
      expect(menuItemNames(openMore("Reading list"))).not.toContain(menuCopy.compareConflict);
    } finally {
      useCloudStore.setState({ state: null });
    }
  });

  it("names the More button in a tooltip", async () => {
    renderLibrary({ data: actionData() });
    fireEvent.mouseEnter(moreButton("Masking ablation"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(menuCopy.more);
  });

  it("ignores other keys while renaming", async () => {
    const user = userEvent.setup();
    const data = actionData();
    renderLibrary({ data });
    const input = await startRename(user, "Masking ablation");
    fireEvent.keyDown(input, { key: "a" });
    expect(input).toBeInTheDocument();
    expect(data.renameNote).not.toHaveBeenCalled();
  });

  it("tells you when a rename fails", async () => {
    const user = userEvent.setup();
    const renameNote = vi.fn(async () => {
      throw new Error("disk full");
    });
    renderLibrary({ data: actionData({ renameNote }) });
    await user.type(await startRename(user, "Masking ablation"), "!{Enter}");
    await waitFor(() => expect(toastMessages("error")).toEqual(['Couldn\'t rename "Masking ablation".']));
    expect(log.logError).toHaveBeenCalledWith("rename note", expect.any(Error));
  });

  it("moves a note to another project", async () => {
    const user = userEvent.setup();
    const data = actionData();
    renderLibrary({ data });
    const submenu = await openProjects(user, "Masking ablation");
    expect(menuItemNames(submenu)).toEqual([enNotes.workspace.noProject, "Vision", "Language"]);
    const none = within(submenu).getByRole("menuitem", { name: enNotes.workspace.noProject });
    expect(none.querySelector("[data-slot=check-badge]")).toBeInTheDocument();
    expect(within(submenu).getByRole("menuitem", { name: "Language" }).querySelector("[data-slot=check-badge]")).toBeNull();
    await user.click(within(submenu).getByRole("menuitem", { name: "Language" }));
    expect(data.setRelatedProject).toHaveBeenCalledExactlyOnceWith("n1", "p-language");
  });

  it("marks the note's project, ignores picking it again and can take the note out of it", async () => {
    const user = userEvent.setup();
    const setRelatedProject = vi.fn(async () => {});
    const linked = [{ ...notes[0], relatedProjectId: "p-vision" }, notes[1], notes[2]];
    renderLibrary({ data: actionData({ notes: linked, setRelatedProject }) });
    let submenu = await openProjects(user, "Masking ablation");
    expect(within(submenu).getByRole("menuitem", { name: "Vision" }).querySelector("[data-slot=check-badge]")).toBeInTheDocument();
    expect(within(submenu).getByRole("menuitem", { name: enNotes.workspace.noProject }).querySelector("[data-slot=check-badge]")).toBeNull();
    await user.click(within(submenu).getByRole("menuitem", { name: "Vision" }));
    expect(setRelatedProject).not.toHaveBeenCalled();

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    submenu = await openProjects(user, "Masking ablation");
    await user.click(within(submenu).getByRole("menuitem", { name: enNotes.workspace.noProject }));
    expect(setRelatedProject).toHaveBeenCalledExactlyOnceWith("n1", null);
  });

  it("logs a link that fails and says it couldn't link the note", async () => {
    const user = userEvent.setup();
    const setRelatedProject = vi.fn(async () => {
      throw new Error("no such project");
    });
    renderLibrary({ data: actionData({ setRelatedProject }) });
    await user.click(within(await openProjects(user, "Reading list")).getByRole("menuitem", { name: "Vision" }));
    await waitFor(() => expect(log.logError).toHaveBeenCalledWith("set the note's project", expect.any(Error)));
    expect(toastMessages("error")).toEqual(['Couldn\'t link "Reading list" to that project.']);
  });

  it("hides Project without a project list or a way to set one", () => {
    const { unmount } = renderLibrary({ data: actionData({ projects: undefined }) });
    expect(menuItemNames(openMore("Masking ablation"))).toEqual([menuCopy.favorite, menuCopy.rename, menuCopy.useAsTemplate, menuCopy.delete]);
    unmount();
    renderLibrary({ data: actionData({ setRelatedProject: undefined }) });
    expect(menuItemNames(openMore("Masking ablation"))).toEqual([menuCopy.favorite, menuCopy.rename, menuCopy.useAsTemplate, menuCopy.delete]);
  });

  it("hides Rename and Delete when the data can't do them", () => {
    renderLibrary({ data: actionData({ renameNote: undefined, deleteNote: undefined }) });
    const menu = openMore("Masking ablation");
    expect(menuItemNames(menu)).toEqual([menuCopy.favorite, menuCopy.useAsTemplate, menuCopy.linkProject]);
    expect(within(menu).queryByRole("separator")).not.toBeInTheDocument();
  });

  it("asks before moving a note to the Recycle Bin, then moves it", async () => {
    const user = userEvent.setup();
    const data = actionData();
    renderLibrary({ data });
    await user.click(within(openMore("Masking ablation")).getByRole("menuitem", { name: menuCopy.delete }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("heading", { name: 'Move "Masking ablation" to the Recycle Bin?' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent(menuCopy.deleteDescription);
    expect(data.deleteNote).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: menuCopy.deleteConfirm }));
    expect(data.deleteNote).toHaveBeenCalledExactlyOnceWith("n1");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(toastMessages("success")).toEqual(['Moved "Masking ablation" to the Recycle Bin.']));
  });

  it("shortens a long note title in the delete dialog", async () => {
    const user = userEvent.setup();
    const title = "A very long note title that keeps going past the limit";
    renderLibrary({ data: actionData({ notes: [{ ...notes[1], title }] }) });
    await user.click(within(openMore(title)).getByRole("menuitem", { name: menuCopy.delete }));
    const heading = within(await screen.findByRole("alertdialog")).getByRole("heading");
    expect(heading.textContent).not.toContain(title);
    expect(heading.textContent).toMatch(/^Move "A very long/u);
  });

  it("keeps the note when the delete is cancelled", async () => {
    const user = userEvent.setup();
    const data = actionData();
    renderLibrary({ data });
    await user.click(within(openMore("Reading list")).getByRole("menuitem", { name: menuCopy.delete }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: new RegExp(`^${enCommon.actions.cancel}`, "u") }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(data.deleteNote).not.toHaveBeenCalled();
    expect(toastMessages("success")).toEqual([]);
  });

  it("tells you when a delete fails", async () => {
    const user = userEvent.setup();
    const deleteNote = vi.fn(async () => {
      throw new Error("not recyclable");
    });
    renderLibrary({ data: actionData({ deleteNote }) });
    await user.click(within(openMore("Reading list")).getByRole("menuitem", { name: menuCopy.delete }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: menuCopy.deleteConfirm }));
    await waitFor(() => expect(toastMessages("error")).toEqual(['Couldn\'t delete "Reading list".']));
    expect(toastMessages("success")).toEqual([]);
    expect(log.logError).toHaveBeenCalledWith("delete note", expect.any(Error));
  });

  it("opens the same menu on right-click and renames from it", async () => {
    const user = userEvent.setup();
    const data = actionData();
    renderLibrary({ data, onOpenNoteInNewTab: vi.fn() });
    fireEvent.contextMenu(row("Agent scratch"));
    const menu = screen.getByRole("menu");
    expect(menuItemNames(menu)).toEqual([
      menuCopy.openInNewTab,
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
  it("calls the section Filters, counts every filter and clears them all", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await openFilters(user);
    await user.click(chip(copy.kind.figure));
    await user.click(chip(copy.author.you));
    expect(screen.getByText(copy.emptyKind.figure)).toBeInTheDocument();
    expect(filtersToggle()).toHaveAccessibleName(expect.stringContaining(copy.filters.title));
    expect(screen.getByText("2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.filters.clear }));
    expect(rowTitles()).toContain("Masking ablation");
    expect(screen.queryByRole("button", { name: copy.filters.clear })).not.toBeInTheDocument();
  });

  it("hides artifacts and the kind filter while Research tasks is off", async () => {
    renderLibrary({ data: fakeData({ researchTasks: false }) });
    await openFilters(userEvent.setup());
    expect(screen.queryByRole("button", { name: copy.kind.figure })).not.toBeInTheDocument();
    expect(screen.queryByText("Loss curve")).not.toBeInTheDocument();
    expect(rowTitles()).toContain("Masking ablation");
  });

  it("says Search notes, not artifacts, while Research tasks is off", () => {
    const { unmount } = renderLibrary({ data: fakeData({ researchTasks: false }) });
    const search = screen.getByRole("combobox", { name: enNotes.home.search });
    expect(search).toHaveAttribute("placeholder", enNotes.home.search);
    unmount();
    renderLibrary();
    expect(screen.getByRole("combobox", { name: copy.search })).toHaveAttribute("placeholder", copy.search);
  });

  it("groups the filters as toggle buttons, not tabs without panels", async () => {
    renderLibrary();
    await openFilters(userEvent.setup());
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    const kinds = screen.getByRole("group", { name: enNotes.vault.search.fields.kind });
    const authors = screen.getByRole("group", { name: enNotes.vault.search.fields.author });
    expect(within(kinds).getAllByRole("button", { pressed: true }).map((button) => button.textContent)).toEqual([copy.kind.all]);
    expect(within(authors).getAllByRole("button", { pressed: true }).map((button) => button.textContent)).toEqual([copy.author.all]);
  });

  it("keeps the search text when Escape only ends an IME composition", async () => {
    const user = userEvent.setup();
    renderLibrary();
    const search = screen.getByRole("combobox", { name: copy.search });
    await user.type(search, "mask");
    fireEvent.keyDown(search, { key: "Escape", keyCode: 229 });
    expect(search).toHaveValue("mask");
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
  });
});

describe("NotesLibrary templates", () => {
  it("marks a note as a template and back from its menu", async () => {
    const user = userEvent.setup();
    const source = "---\nkind: note\nid: n1\ntitle: Masking ablation\n---\n\nBody\n";
    const loadNote = vi.fn(async () => ({ text: source, version: "v1" }));
    const saveNote = vi.fn(async (_id: string, text: string) => ({ text, version: "v2" }));
    const view = renderLibrary({ data: actionData({ loadNote, saveNote }) });
    await user.click(within(openMore("Masking ablation")).getByRole("menuitem", { name: menuCopy.useAsTemplate }));
    await waitFor(() => expect(saveNote).toHaveBeenCalledWith("n1", expect.stringContaining("template: true"), "v1"));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain(
        menuCopy.templateOn.replace("{{name}}", "Masking ablation"),
      ),
    );
    view.unmount();
    const marked = notes.map((note) => (note.id === "n1" ? { ...note, properties: { template: true } } : note));
    renderLibrary({ data: actionData({ notes: marked, loadNote, saveNote }) });
    expect(within(openMore("Masking ablation")).getByRole("menuitem", { name: menuCopy.stopTemplate })).toBeInTheDocument();
  });

  it("says when the template flag could not be saved", async () => {
    const user = userEvent.setup();
    const loadNote = vi.fn(async () => {
      throw new Error("gone");
    });
    renderLibrary({ data: actionData({ loadNote }) });
    await user.click(within(openMore("Masking ablation")).getByRole("menuitem", { name: menuCopy.useAsTemplate }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain(
        enNotes.failures.template.replace("{{name}}", "Masking ablation"),
      ),
    );
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

describe("NotesLibrary rename", () => {
  it("does not finish a rename on the Enter that confirms an IME composition", async () => {
    const user = userEvent.setup();
    const data = actionData();
    renderLibrary({ data });
    const input = await startRename(user, "Masking ablation");
    await user.clear(input);
    await user.type(input, "マスク");
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(data.renameNote).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: menuCopy.renameLabel })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(data.renameNote).toHaveBeenCalledWith("n1", "マスク"));
  });
});
