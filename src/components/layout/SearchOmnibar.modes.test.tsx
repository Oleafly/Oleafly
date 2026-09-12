// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registry } from "@oleafly/registry";

const mocks = vi.hoisted(() => ({
  searchDocs: vi.fn(async () => [] as unknown[]),
  gotoLine: vi.fn(),
  toggleTheme: vi.fn(),
  openProject: vi.fn(async () => {}),
  openFile: vi.fn(async () => {}),
  refreshProjects: vi.fn(async () => {}),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: mocks.toggleTheme }),
}));
vi.mock("@/lib/tauri", () => ({ searchDocs: mocks.searchDocs }));
vi.mock("@/components/editor/cm/controller", () => ({ gotoLine: mocks.gotoLine }));

import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { useFilesStore } from "@/store/files";
import { useFavoritesStore } from "@/store/favorites";
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
  mocks.searchDocs.mockResolvedValue([]);
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

describe("SearchOmnibar modes", () => {
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
    mocks.searchDocs.mockResolvedValue([HIT]);
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

  it("survives a document search that fails", async () => {
    mocks.searchDocs.mockRejectedValue(new Error("index down"));
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
  });

  it("filters projects in the projects mode and opens the one chosen", async () => {
    render(<SearchOmnibar />);
    const user = await type("/projects Beta");
    const row = await screen.findByText("Beta survey");
    await user.click(row);
    await waitFor(() => expect(mocks.openProject).toHaveBeenCalledWith("beta"));
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
});
