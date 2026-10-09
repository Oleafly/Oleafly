// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function sectionStub(testId: string, label: string) {
  return ({
    collapsed,
    onCollapsedChange,
  }: {
    collapsed: boolean;
    onCollapsedChange: (collapsed: boolean) => void;
  }) => (
    <button
      type="button"
      data-testid={testId}
      aria-expanded={!collapsed}
      onClick={() => onCollapsedChange(!collapsed)}
    >
      {label}
    </button>
  );
}

vi.mock("@/components/files/FileTree", () => ({ FileTree: sectionStub("file-tree", "Explorer") }));
vi.mock("@/components/layout/WorkspaceControls", () => ({
  SidebarViews: () => <div data-testid="sidebar-views" />,
}));
vi.mock("@/components/layout/DocumentOutline", () => ({
  DocumentOutline: sectionStub("document-outline", "Outline"),
}));
vi.mock("@/components/layout/Outline", () => ({
  Outline: sectionStub("project-structure", "Structure"),
}));

import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { installScrollGeometry, type ScrollGeometry } from "@/lib/test-scroll-geometry";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { panelExpandSizesKey, panelLayoutKey } from "@/lib/panel-layout";
import { FilesPanel, ProjectSearch } from "./Sidebar";

const copy = enShell.projectSearch;
const EXPLORER_GROUP = "sidebar-explorer-sections-v3";
const EXPLORER_PANELS = [
  "source-tree-v",
  "document-outline-v",
  "project-structure-v",
  "explorer-filler-v",
];

const HIT = {
  project_id: "alpha",
  project_name: "Paper",
  path: "chapters/intro.tex",
  line: 9,
  preview: "a matching line",
};

function openProject(projectId: string) {
  useFilesStore.setState({
    projectId,
    openFile: mocks.openFile,
  } as unknown as ReturnType<typeof useFilesStore.getState>);
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockClear();
  mocks.searchDocs.mockResolvedValue([]);
  localStorage.removeItem(panelLayoutKey(EXPLORER_GROUP, EXPLORER_PANELS));
  localStorage.removeItem(panelExpandSizesKey(EXPLORER_GROUP));
  openProject("alpha");
  useSettingsStore.setState({
    railTab: "files",
    revealEditor: mocks.revealEditor,
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
});

describe("Explorer sections view memory", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute("data-panel") || this.hasAttribute("data-separator") ? 100 : 0;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function setOpen(testId: string, open: boolean) {
    const toggle = await screen.findByTestId(testId);
    if (toggle.getAttribute("aria-expanded") !== String(open)) {
      fireEvent.click(toggle);
    }
    await waitFor(() =>
      expect(screen.getByTestId(testId)).toHaveAttribute("aria-expanded", String(open)),
    );
  }

  it("reopens with the same sections collapsed after another rail was visited", async () => {
    const first = render(<FilesPanel />);
    await setOpen("project-structure", true);
    await setOpen("file-tree", false);
    first.unmount();

    render(<FilesPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("file-tree")).toHaveAttribute("aria-expanded", "false"),
    );
    expect(await screen.findByTestId("document-outline")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("project-structure")).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps the section layout when the project changes, as it is a window-wide layout", async () => {
    const first = render(<FilesPanel />);
    await setOpen("document-outline", false);
    first.unmount();

    openProject("beta");
    render(<FilesPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("document-outline")).toHaveAttribute("aria-expanded", "false"),
    );
  });
});

describe("ProjectSearch view memory", () => {
  async function search(user: ReturnType<typeof userEvent.setup>, text: string) {
    await user.type(screen.getByPlaceholderText(copy.placeholder), text);
    await vi.advanceTimersByTimeAsync(250);
  }

  it("keeps the query and its results after another rail was visited", async () => {
    mocks.searchDocs.mockResolvedValue([HIT]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const first = render(<ProjectSearch />);
    await search(user, "matching");
    expect(await screen.findByText("intro.tex")).toBeInTheDocument();
    first.unmount();

    mocks.searchDocs.mockClear();
    render(<ProjectSearch />);
    expect(screen.getByPlaceholderText(copy.placeholder)).toHaveValue("matching");
    expect(screen.getByText("intro.tex")).toBeInTheDocument();
    expect(screen.getByText("a matching line")).toBeInTheDocument();
    expect(screen.queryByText(copy.noResults)).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("starts another project with an empty search and restores the first on return", async () => {
    mocks.searchDocs.mockResolvedValue([HIT]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const first = render(<ProjectSearch />);
    await search(user, "matching");
    expect(await screen.findByText("intro.tex")).toBeInTheDocument();
    first.unmount();

    openProject("beta");
    const second = render(<ProjectSearch />);
    expect(screen.getByPlaceholderText(copy.placeholder)).toHaveValue("");
    expect(screen.getByText(copy.hint)).toBeInTheDocument();
    second.unmount();

    openProject("alpha");
    render(<ProjectSearch />);
    expect(screen.getByPlaceholderText(copy.placeholder)).toHaveValue("matching");
    expect(screen.getByText("intro.tex")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("swaps the query when the project changes while the panel is open", async () => {
    mocks.searchDocs.mockResolvedValue([HIT]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ProjectSearch />);
    await search(user, "matching");
    expect(await screen.findByText("intro.tex")).toBeInTheDocument();

    openProject("beta");
    await waitFor(() =>
      expect(screen.getByPlaceholderText(copy.placeholder)).toHaveValue(""),
    );

    openProject("alpha");
    await waitFor(() =>
      expect(screen.getByPlaceholderText(copy.placeholder)).toHaveValue("matching"),
    );
    vi.useRealTimers();
  });
});

describe("ProjectSearch scroll memory", () => {
  const MANY = Array.from({ length: 60 }, (_, index) => ({
    ...HIT,
    path: `chapters/part-${String(index).padStart(2, "0")}.tex`,
    line: index + 1,
  }));
  let geometry: ScrollGeometry;

  beforeEach(() => {
    geometry = installScrollGeometry({
      isScroller: (element) => element.classList.contains("overflow-auto"),
      contentHeight: (scroller) => scroller.children.length * 40,
      viewportHeight: 200,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    geometry.restore();
  });

  async function searchAndScroll(top: number) {
    mocks.searchDocs.mockResolvedValue(MANY);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const view = render(<ProjectSearch />);
    await user.type(screen.getByPlaceholderText(copy.placeholder), "matching");
    await vi.advanceTimersByTimeAsync(250);
    expect(await screen.findByText("part-59.tex")).toBeInTheDocument();
    const scroller = screen.getByText("part-00.tex").closest(".overflow-auto") as HTMLElement;
    geometry.scrollTo(scroller, top);
    return view;
  }

  it("returns to the scroll position where the results were left", async () => {
    const first = await searchAndScroll(900);
    first.unmount();

    render(<ProjectSearch />);

    const scroller = screen.getByText("part-00.tex").closest(".overflow-auto") as HTMLElement;
    expect(scroller.scrollTop).toBe(900);
    expect(geometry.pendingFrames()).toBe(0);
  });

  it("shows a new search's results from the top of the list", async () => {
    await searchAndScroll(900);
    const scroller = screen.getByText("part-00.tex").closest(".overflow-auto") as HTMLElement;

    fireEvent.change(screen.getByPlaceholderText(copy.placeholder), {
      target: { value: "matching line" },
    });
    await vi.advanceTimersByTimeAsync(250);

    expect(screen.getByText("part-00.tex")).toBeInTheDocument();
    expect(scroller.scrollTop).toBe(0);
  });

  it("keeps each project's position when the project changes while open", async () => {
    await searchAndScroll(900);
    mocks.searchDocs.mockResolvedValue([...MANY, ...MANY.map((hit) => ({ ...hit, project_id: "beta" }))]);
    const input = screen.getByPlaceholderText(copy.placeholder);
    openProject("beta");
    await waitFor(() => expect(input).toHaveValue(""));
    fireEvent.change(input, { target: { value: "other" } });
    await vi.advanceTimersByTimeAsync(250);
    const scroller = (await screen.findByText("part-00.tex")).closest(".overflow-auto") as HTMLElement;
    geometry.scrollTo(scroller, 400);

    openProject("alpha");
    await waitFor(() => expect(input).toHaveValue("matching"));
    expect(scroller.scrollTop).toBe(900);

    openProject("beta");
    await waitFor(() => expect(input).toHaveValue("other"));
    expect(scroller.scrollTop).toBe(400);
  });

  it("starts another project at the top and restores the first project's position", async () => {
    const first = await searchAndScroll(900);
    first.unmount();

    openProject("beta");
    const second = render(<ProjectSearch />);
    expect(second.container.querySelector(".overflow-auto")?.scrollTop).toBe(0);
    second.unmount();

    openProject("alpha");
    render(<ProjectSearch />);
    const scroller = screen.getByText("part-00.tex").closest(".overflow-auto") as HTMLElement;
    expect(scroller.scrollTop).toBe(900);
  });
});
