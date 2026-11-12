// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registry } from "@oleafly/registry";

const mocks = vi.hoisted(() => ({
  textSearch: vi.fn(async () => [] as unknown[]),
  noteSearch: vi.fn(async (_query: string, _limit?: number, _options?: unknown) => [] as unknown[]),
  openNotes: vi.fn(async () => {}),
  gotoLine: vi.fn(),
  toggleTheme: vi.fn(),
  openProject: vi.fn(async () => {}),
  openFile: vi.fn(async () => {}),
  refreshProjects: vi.fn(async () => {}),
  vaultSnapshot: vi.fn(),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: mocks.toggleTheme }),
  currentTheme: () => "dark",
  subscribeTheme: () => () => undefined,
}));
vi.mock("@/lib/tauri", () => ({ textSearch: mocks.textSearch, noteSearch: mocks.noteSearch }));
vi.mock("@/features/open-tool", () => ({ openNotes: mocks.openNotes }));
vi.mock("@/components/editor/cm/controller", () => ({ gotoLine: mocks.gotoLine }));
vi.mock("@/components/notes/app-notes", () => ({ vaultSnapshot: mocks.vaultSnapshot }));

import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { useFilesStore } from "@/store/files";
import { useFavoritesStore } from "@/store/favorites";
import { useNotesPrefsStore } from "@/store/notes-prefs";
import { useSearchModeStore } from "@/store/search-modes";
import { useSettingsStore } from "@/store/settings";
import { useTourStore } from "@/store/tours";
import { SearchOmnibar } from "./SearchOmnibar";

const omnibar = enShell.omnibar;
const run = vi.fn();

const project = (id: string, name: string, color: string) => ({
  id,
  name,
  color,
  kind: "document",
  engine: "latex",
  main_doc: "main.tex",
  created_at: 1_700_000_000,
  updated_at: 1_700_000_500,
  exports: [],
  has_preview: false,
});

const PROJECTS = [
  project("alpha", "Alpha retrieval", "#123456"),
  project("beta", "Beta survey", ""),
];

const HIT = {
  project_id: "alpha",
  project_name: "Alpha retrieval",
  path: "chapters/intro.tex",
  line: 12,
  preview: "a transformer baseline",
  ranges: [] as [number, number][],
};

async function type(text: string) {
  const user = userEvent.setup();
  await user.clear(screen.getByPlaceholderText(/./));
  await user.type(screen.getByPlaceholderText(/./), text);
  return user;
}

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  registry.commands.length = 0;
  run.mockClear();
  for (const mock of Object.values(mocks)) mock.mockClear();
  mocks.textSearch.mockResolvedValue([]);
  mocks.noteSearch.mockResolvedValue([]);
  registry.commands.push({
    id: "omnibar.demo",
    surfaces: ["omnibar"],
    label: () => "Demo command",
    keywords: () => "demo keyword",
    slash: ["demo"],
    icon: () => null,
    order: 1,
    run,
  });
  registry.commands.push({
    id: "tool.demo-tool",
    surfaces: ["omnibar"],
    label: () => "Demo tool",
    slash: ["demo-tool"],
    order: 2,
    run: vi.fn(),
  });
  useSettingsStore.setState({ searchOpen: true, latexTools: true });
  useTourStore.setState({ activeTourId: null });
  useFavoritesStore.setState({ favs: ["alpha"] });
  useFilesStore.setState({
    projectId: "alpha",
    projectKind: "",
    projects: PROJECTS,
    openProject: mocks.openProject,
    openFile: mocks.openFile,
    refreshProjects: mocks.refreshProjects,
  } as unknown as ReturnType<typeof useFilesStore.getState>);
});

afterEach(() => {
  registry.commands.length = 0;
});

function noteHit(id: string, title: string, score: number) {
  return { id, noteId: null, title, titleRanges: [], score, snippets: [], tags: [], aliases: [], relatedProject: null, updatedAt: 0, blocks: [] };
}

function vaultNote(id: string, title: string, author: "agent" | "you" = "you") {
  return { id, title, project: "Notes", updatedAt: 0, author, summary: "" };
}

const VAULT = [
  vaultNote("n-mask", "Mask notes"),
  vaultNote("n-ratio", "Ratio notes"),
  vaultNote("n-both", "Both"),
  vaultNote("lib-1", "Masking report"),
  vaultNote("n-agent", "Agent masking run", "agent"),
  vaultNote("n-starred", "Starred idea"),
];

async function searchFor(text: string) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(<SearchOmnibar />);
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await user.type(screen.getByPlaceholderText(/./), text);
  await vi.advanceTimersByTimeAsync(250);
  vi.useRealTimers();
}

describe("SearchOmnibar notes", () => {
  beforeEach(() => {
    mocks.vaultSnapshot.mockReset().mockResolvedValue({ notes: VAULT, facts: [] });
    useNotesPrefsStore.setState({ favorites: ["n-starred"] });
  });

  afterEach(() => {
    useSettingsStore.setState({ notes: false });
    useSearchModeStore.setState({ notes: "ranked", files: "ranked" });
  });

  it("reads AND, OR, NOT and groups in note searches the way file searches do", async () => {
    useSettingsStore.setState({ notes: true });
    const found: Record<string, unknown[]> = {
      "mask -draft": [noteHit("n-mask", "Mask notes", 1), noteHit("n-both", "Both", 2)],
      "ratio -draft": [noteHit("n-ratio", "Ratio notes", 3), noteHit("n-both", "Both", 5)],
    };
    mocks.noteSearch.mockImplementation(async (query: string) => found[query] ?? []);
    await searchFor("/notes (mask OR ratio) NOT draft");
    expect(await screen.findByText("Ratio notes")).toBeInTheDocument();
    expect(mocks.noteSearch.mock.calls.map((call: unknown[]) => call[0])).toEqual(["mask -draft", "ratio -draft"]);
    expect(screen.getByText("Mask notes")).toBeInTheDocument();
    expect(screen.getAllByText("Both")).toHaveLength(1);
  });

  it("searches notes with the mode shown in the box when everything is searched", async () => {
    useSettingsStore.setState({ notes: true });
    useSearchModeStore.setState({ files: "exact", notes: "fuzzy" });
    await searchFor("masking");
    await waitFor(() => expect(mocks.noteSearch).toHaveBeenLastCalledWith("masking", expect.any(Number), { mode: "exact", blocks: true }));
  });

  it("says when a search has more OR combinations than it runs", async () => {
    useSettingsStore.setState({ notes: true });
    await searchFor("/notes (a OR b OR c OR d OR e OR f) (g OR h OR i OR j OR k OR l)");
    expect(await screen.findByRole("status")).toHaveTextContent(enCommon.querySearch.issues.tooManyBranches);
    await waitFor(() => expect(mocks.noteSearch).toHaveBeenCalledTimes(32));
  });

  it("filters notes by author and favorite the way the Notes library does", async () => {
    useSettingsStore.setState({ notes: true });
    mocks.noteSearch.mockResolvedValue([noteHit("n-agent", "Agent masking run", 2), noteHit("n-mask", "Mask notes", 1)]);
    await searchFor("/notes author:agent mask");
    expect(await screen.findByText("Agent masking run")).toBeInTheDocument();
    expect(mocks.noteSearch.mock.calls.map((call: unknown[]) => call[0])).toEqual(["mask"]);
    expect(screen.queryByText("Mask notes")).toBeNull();
    cleanup();

    mocks.noteSearch.mockClear();
    await searchFor("/notes is:favorite");
    expect(await screen.findByText("Starred idea")).toBeInTheDocument();
    expect(mocks.noteSearch).not.toHaveBeenCalled();
  });

  it("lists matching notes with their blocks and opens a note at the block chosen", async () => {
    useSettingsStore.setState({ notes: true, notesFieldStyle: "outline" });
    mocks.noteSearch.mockResolvedValue([
      {
        id: "lib-1",
        noteId: "n-1",
        title: "Masking report",
        titleRanges: [[0, 7]],
        score: 1,
        snippets: [],
        tags: [],
        aliases: [],
        relatedProject: null,
        updatedAt: 0,
        blocks: [
          { line: 4, block: "acc", kind: "paragraph", text: "Accuracy rose with masking", ranges: [[19, 26]] },
          { line: 9, kind: "item", text: "Check the masking seed", ranges: [] },
        ],
      },
    ]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<SearchOmnibar />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByPlaceholderText(omnibar.placeholder), "/notes masking");
    await vi.advanceTimersByTimeAsync(250);
    expect(await screen.findByText(omnibar.groups.notes)).toBeInTheDocument();
    expect(mocks.noteSearch).toHaveBeenLastCalledWith("masking", 20, { mode: "ranked", blocks: true });
    expect(mocks.textSearch).not.toHaveBeenCalled();
    expect(screen.getByText("Check the masking seed").closest("[data-notes-field-style]")).toHaveAttribute("data-notes-field-style", "outline");
    await user.click(screen.getByText("Check the masking seed"));
    expect(mocks.openNotes).toHaveBeenLastCalledWith("lib-1", "~Check the masking seed");
    vi.useRealTimers();
  });
});

describe("SearchOmnibar modes", () => {
  it("lists notes as projects only while Notes is off", () => {
    const note = { ...project("idea", "Masking idea", ""), kind: "note", main_doc: "note.md" };
    useFilesStore.setState({ projects: [...PROJECTS, note] } as never);
    useSettingsStore.setState({ notes: true });
    const { unmount } = render(<SearchOmnibar />);
    expect(screen.getByText("Alpha retrieval")).toBeInTheDocument();
    expect(screen.queryByText("Masking idea")).toBeNull();
    unmount();

    useSettingsStore.setState({ notes: false });
    render(<SearchOmnibar />);
    expect(screen.getByText("Masking idea")).toBeInTheDocument();
  });

  it("lists commands, tools and projects on the default surface", () => {
    render(<SearchOmnibar />);
    expect(screen.getAllByText(enShell.commandGroups.commands).length).toBeGreaterThan(0);
    expect(screen.getByText("Demo command")).toBeInTheDocument();
    expect(screen.getByText(enShell.commandGroups.tools)).toBeInTheDocument();
    expect(screen.getByText("Demo tool")).toBeInTheDocument();
    expect(screen.getByText("Alpha retrieval")).toBeInTheDocument();
    expect(screen.getByLabelText(omnibar.bookmarked)).toBeInTheDocument();
  });

  it("offers the creation action behind the slash command", async () => {
    render(<SearchOmnibar />);
    const user = await type("/create");
    expect(await screen.findByText(omnibar.createProject)).toBeInTheDocument();
    await user.click(screen.getByText(omnibar.createProject));
    await waitFor(() =>
      expect(useSettingsStore.getState().newProjectOpen).toBe(true),
    );
  });

  it("offers the theme switch behind its slash command", async () => {
    render(<SearchOmnibar />);
    const user = await type("/theme");
    const label = await screen.findByText(enShell.commands.theme.toLight);
    await user.click(label);
    expect(mocks.toggleTheme).toHaveBeenCalled();
  });

  it("offers settings behind its slash command", async () => {
    render(<SearchOmnibar />);
    const user = await type("/settings");
    await user.click(await screen.findByText(enShell.commands.settings.label));
    await waitFor(() =>
      expect(useSettingsStore.getState().settingsOpen).toBe(true),
    );
  });

  it("opens the references rail for an open project", async () => {
    render(<SearchOmnibar />);
    const user = await type("/refs");
    await user.click(await screen.findByText(omnibar.openReferences));
    await waitFor(() => expect(useSettingsStore.getState().railTab).toBe("refs"));
  });

  it("asks for a project before offering references", async () => {
    useFilesStore.setState({ projectId: null });
    render(<SearchOmnibar />);
    await type("/refs");
    expect(
      await screen.findByText(omnibar.referencesNeedProject),
    ).toBeInTheDocument();
  });

  it("runs a registered command reached by its slash alias", async () => {
    render(<SearchOmnibar />);
    const user = await type("/demo");
    const rows = await screen.findAllByText("Demo command");
    await user.click(rows[0]);
    expect(run).toHaveBeenCalled();
  });

  it("suggests the slash commands that match a prefix", async () => {
    render(<SearchOmnibar />);
    await type("/pro");
    expect(await screen.findByText(omnibar.slash.projects)).toBeInTheDocument();
  });

  it("says an unknown slash command is unknown", async () => {
    render(<SearchOmnibar />);
    await type("/zzzq");
    expect(await screen.findByText(omnibar.unknownCommand)).toBeInTheDocument();
  });

  it("fills the input from a slash suggestion without a command", async () => {
    render(<SearchOmnibar />);
    const user = await type("/doc");
    await user.click(await screen.findByText(omnibar.slash.docs));
    await waitFor(() =>
      expect(screen.getByPlaceholderText(omnibar.placeholderDocuments)).toBeInTheDocument(),
    );
  });

  it("searches documents and opens the hit the reader picks", async () => {
    mocks.textSearch.mockResolvedValue([HIT]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<SearchOmnibar />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(
      screen.getByPlaceholderText(omnibar.placeholder),
      "/docs transformer",
    );
    await vi.advanceTimersByTimeAsync(250);
    expect(await screen.findByText(omnibar.groups.documents)).toBeInTheDocument();
    expect(screen.getByText("intro.tex")).toBeInTheDocument();
    await user.click(screen.getByText("intro.tex"));
    await waitFor(() => expect(mocks.openProject).toHaveBeenCalledWith("alpha"));
    expect(mocks.openFile).toHaveBeenCalledWith("chapters/intro.tex");
    await vi.advanceTimersByTimeAsync(200);
    expect(mocks.gotoLine).toHaveBeenCalledWith(12);
    vi.useRealTimers();
  });

  it("opens nothing in the current project when the switch to the hit's project is declined", async () => {
    mocks.textSearch.mockResolvedValue([{ ...HIT, project_id: "beta", project_name: "Beta survey" }]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<SearchOmnibar />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByPlaceholderText(omnibar.placeholder), "/docs transformer");
    await vi.advanceTimersByTimeAsync(250);
    await user.click(await screen.findByText("intro.tex"));

    await waitFor(() => expect(mocks.openProject).toHaveBeenCalledWith("beta"));
    await vi.advanceTimersByTimeAsync(200);
    expect(mocks.openFile).not.toHaveBeenCalled();
    expect(mocks.gotoLine).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("survives a document search that fails", async () => {
    mocks.textSearch.mockRejectedValue(new Error("index down"));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<SearchOmnibar />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(
      screen.getByPlaceholderText(omnibar.placeholder),
      "/docs nothing",
    );
    await vi.advanceTimersByTimeAsync(250);
    vi.useRealTimers();
    expect(await screen.findByText(omnibar.noMatches)).toBeInTheDocument();
    expect(screen.getByTestId("omnibar-no-matches").querySelector("svg")).not.toBeNull();
  });

  it("filters projects in the projects mode and opens the one chosen", async () => {
    render(<SearchOmnibar />);
    const user = await type("/projects Beta");
    const row = await screen.findByText("Beta survey");
    await user.click(row);
    await waitFor(() => expect(mocks.openProject).toHaveBeenCalledWith("beta"));
  });

  it("shows a new search's results from the top of the list", () => {
    render(<SearchOmnibar />);
    const list = screen.getByRole("listbox");
    list.scrollTop = 240;

    fireEvent.change(screen.getByPlaceholderText(/./), { target: { value: "/projects Beta" } });

    expect(screen.getByText("Beta survey")).toBeInTheDocument();
    expect(list.scrollTop).toBe(0);
  });

  it("toggles on the search shortcut and stays shut during a tour", async () => {
    useSettingsStore.setState({ searchOpen: false });
    render(<SearchOmnibar />);
    const apple = /Mac|iPhone|iPad/.test(navigator.platform);
    const press = () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          metaKey: apple,
          ctrlKey: !apple,
          shiftKey: true,
          cancelable: true,
        }),
      );
    press();
    await waitFor(() =>
      expect(useSettingsStore.getState().searchOpen).toBe(true),
    );
    useTourStore.setState({ activeTourId: "home" });
    press();
    expect(useSettingsStore.getState().searchOpen).toBe(true);
  });

  it("runs a command or a tool picked from the default list", async () => {
    const user = userEvent.setup();
    const tool = registry.commands.find((command) => command.id === "tool.demo-tool");
    render(<SearchOmnibar />);

    await user.click(screen.getByText("Demo command"));
    expect(run).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(useSettingsStore.getState().searchOpen).toBe(false));

    useSettingsStore.setState({ searchOpen: true });
    await user.click(await screen.findByText("Demo tool"));
    expect(tool?.run).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and clears the query", async () => {
    render(<SearchOmnibar />);
    const user = await type("alpha");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(useSettingsStore.getState().searchOpen).toBe(false));
  });

  it("shows a document hit whose line does not contain the words searched", async () => {
    mocks.textSearch.mockResolvedValue([{ ...HIT, preview: "stemmed match only" }]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<SearchOmnibar />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByPlaceholderText(omnibar.placeholder), "/docs transformers");
    await vi.advanceTimersByTimeAsync(250);
    vi.useRealTimers();

    const preview = await screen.findByText("stemmed match only");
    expect(preview.querySelector("mark")).toBeNull();
  });
});

