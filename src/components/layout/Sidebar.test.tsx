// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  searchDocs: vi.fn(async () => [] as unknown[]),
  gotoLine: vi.fn(),
  openFile: vi.fn(async () => {}),
  revealEditor: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({ searchDocs: mocks.searchDocs }));
vi.mock("@/components/editor/cm/controller", () => ({ gotoLine: mocks.gotoLine }));
vi.mock("@/components/files/FileTree", () => ({
  FileTree: () => <div data-testid="file-tree" />,
}));
vi.mock("@/components/layout/WorkspaceControls", () => ({
  SidebarViews: () => <div data-testid="sidebar-views" />,
}));
vi.mock("@/components/layout/DocumentOutline", () => ({
  DocumentOutline: () => <div data-testid="document-outline" />,
}));
vi.mock("@/components/layout/Outline", () => ({
  Outline: () => <div data-testid="project-structure" />,
}));

import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { registry } from "@oleafly/registry";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { FilesPanel, ProjectSearch, Sidebar } from "./Sidebar";

const copy = enShell.projectSearch;

const HIT = {
  project_id: "p1",
  project_name: "Paper",
  path: "chapters/intro.tex",
  line: 9,
  preview: "a matching line",
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockClear();
  mocks.searchDocs.mockResolvedValue([]);
  registry.railTabs.length = 0;
  useFilesStore.setState({
    projectId: "p1",
    openFile: mocks.openFile,
  } as unknown as ReturnType<typeof useFilesStore.getState>);
  useSettingsStore.setState({
    railTab: "files",
    revealEditor: mocks.revealEditor,
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
});

afterEach(() => {
  registry.railTabs.length = 0;
  vi.useRealTimers();
});

describe("ProjectSearch", () => {
  it("hints at what to type before a query", () => {
    render(<ProjectSearch />);
    expect(screen.getByText(copy.title)).toBeInTheDocument();
    expect(screen.getByText(copy.hint)).toBeInTheDocument();
  });

  it("lists the hits of the active project and opens the one chosen", async () => {
    mocks.searchDocs.mockResolvedValue([
      HIT,
      { ...HIT, project_id: "other", path: "elsewhere.tex" },
    ]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ProjectSearch />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByPlaceholderText(copy.placeholder), "matching");
    await vi.advanceTimersByTimeAsync(250);
    expect(await screen.findByText("intro.tex")).toBeInTheDocument();
    expect(screen.queryByText("elsewhere.tex")).not.toBeInTheDocument();
    expect(screen.getByText("a matching line")).toBeInTheDocument();
    await user.click(screen.getByText("intro.tex"));
    await vi.advanceTimersByTimeAsync(150);
    vi.useRealTimers();
    await waitFor(() =>
      expect(mocks.openFile).toHaveBeenCalledWith("chapters/intro.tex"),
    );
    expect(mocks.revealEditor).toHaveBeenCalled();
  });

  it("says when a query matched nothing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ProjectSearch />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByPlaceholderText(copy.placeholder), "zzzq");
    await vi.advanceTimersByTimeAsync(250);
    vi.useRealTimers();
    expect(await screen.findByText(copy.noResults)).toBeInTheDocument();
  });

  it("survives a failing search", async () => {
    mocks.searchDocs.mockRejectedValue(new Error("index down"));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ProjectSearch />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByPlaceholderText(copy.placeholder), "boom");
    await vi.advanceTimersByTimeAsync(250);
    vi.useRealTimers();
    expect(await screen.findByText(copy.noResults)).toBeInTheDocument();
  });
});

describe("Sidebar", () => {
  it("stacks the file tree over the outline and the structure map", async () => {
    render(<FilesPanel />);
    expect(screen.getByTestId("file-tree")).toBeInTheDocument();
    expect(await screen.findByTestId("document-outline")).toBeInTheDocument();
    expect(screen.getByTestId("project-structure")).toBeInTheDocument();
  });

  it("falls back to the files panel for an unknown rail tab", async () => {
    useSettingsStore.setState({ railTab: "nope" } as unknown as ReturnType<
      typeof useSettingsStore.getState
    >);
    render(<Sidebar />);
    expect(screen.getByTestId("sidebar-views")).toBeInTheDocument();
    expect(screen.getByTestId("file-tree")).toBeInTheDocument();
  });

  it("renders the panel a rail tab contributes", () => {
    registry.railTabs.push({
      id: "refs",
      label: "References",
      icon: () => null,
      section: "explore",
      order: 1,
      panel: () => <div data-testid="contributed-panel" />,
    });
    useSettingsStore.setState({ railTab: "refs" } as unknown as ReturnType<
      typeof useSettingsStore.getState
    >);
    render(<Sidebar />);
    expect(screen.getByTestId("contributed-panel")).toBeInTheDocument();
  });
});
