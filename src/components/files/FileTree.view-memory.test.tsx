// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: unknown) =>
    command === "list_file_tree"
      ? { entries: await mocks.invoke("list_files", args), truncated: false }
      : mocks.invoke(command, args),
  isTauri: () => false,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setFocus: vi.fn() }),
}));
vi.mock("@/lib/native-file-dialog", () => ({ pickOpenPath: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/toast", () => ({
  notifyError: vi.fn(),
  toast: {
    info: vi.fn(),
    infoUnique: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    errorUnique: vi.fn(),
    dismiss: vi.fn(),
  },
}));
vi.mock("@/components/editor/wysiwyg/controller", () => ({
  flushWysiwygPendingEdits: vi.fn(),
  invalidateWysiwygProjectSession: vi.fn(),
}));

import enWorkspace from "@/i18n/locales/en/workspace.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { installScrollGeometry, paddedListHeight } from "@/lib/test-scroll-geometry";
import { resetSidebarViewState } from "@/store/sidebar-view-state";
import { FileTree } from "./FileTree";

const files = enWorkspace.files;

const TREE = [
  { path: "chapters", is_dir: true },
  { path: "chapters/intro.tex", is_dir: false },
  { path: "figures", is_dir: true },
  { path: "figures/plot.png", is_dir: false },
  { path: "main.tex", is_dir: false },
];

const OTHER_TREE = [
  { path: "chapters", is_dir: true },
  { path: "chapters/other.tex", is_dir: false },
  { path: "main.tex", is_dir: false },
];

const LONG_TREE = Array.from({ length: 600 }, (_, index) => ({
  path: `f${String(index).padStart(3, "0")}.tex`,
  is_dir: false,
}));

function openProject(projectId: string, tree: typeof TREE) {
  act(() => {
    useFilesStore.setState({ projectId, tree, loading: false });
  });
}

function row(name: string) {
  return screen.getByRole("treeitem", { name: new RegExp(`^${name.replaceAll(".", "\\.")}`) });
}

function maybeRow(name: string) {
  return screen.queryByRole("treeitem", { name: new RegExp(`^${name.replaceAll(".", "\\.")}`) });
}

function tree() {
  return screen.getByRole("tree", { name: files.treeAriaLabel });
}

beforeEach(() => {
  resetSidebarViewState();
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  useSettingsStore.setState({ hiddenFilePatterns: [] });
  useFilesStore.setState({
    projectId: "alpha",
    tree: TREE,
    treeTruncated: false,
    files: {},
    openTabs: [],
    activePath: null,
    mainDoc: "main.tex",
    manifestHome: "device",
    engine: LATEX_ENGINE,
    engineLoaded: true,
    loading: false,
  });
});

describe("FileTree view memory", () => {
  it("brings back expanded folders and the selection after the panel is closed and reopened", () => {
    const first = render(<FileTree />);
    fireEvent.click(row("chapters"));
    expect(row("chapters")).toHaveAttribute("aria-expanded", "true");
    expect(row("chapters")).toHaveAttribute("aria-selected", "true");
    expect(row("intro.tex")).toBeInTheDocument();
    first.unmount();

    render(<FileTree />);
    expect(row("chapters")).toHaveAttribute("aria-expanded", "true");
    expect(row("chapters")).toHaveAttribute("aria-selected", "true");
    expect(row("intro.tex")).toBeInTheDocument();
    expect(row("figures")).toHaveAttribute("aria-expanded", "false");
  });

  it("starts another project from its own state and restores the first one on return", () => {
    const first = render(<FileTree />);
    fireEvent.click(row("chapters"));
    first.unmount();

    openProject("beta", OTHER_TREE);
    const second = render(<FileTree />);
    expect(row("chapters")).toHaveAttribute("aria-expanded", "false");
    expect(maybeRow("other.tex")).toBeNull();
    fireEvent.click(row("main.tex"));
    second.unmount();

    openProject("alpha", TREE);
    const third = render(<FileTree />);
    expect(row("chapters")).toHaveAttribute("aria-expanded", "true");
    expect(row("intro.tex")).toBeInTheDocument();
    third.unmount();

    openProject("beta", OTHER_TREE);
    render(<FileTree />);
    expect(row("chapters")).toHaveAttribute("aria-expanded", "false");
    expect(row("main.tex")).toHaveAttribute("aria-selected", "true");
  });

  it("swaps in the remembered state of a project opened while the panel stays mounted", () => {
    render(<FileTree />);
    fireEvent.click(row("chapters"));

    openProject("beta", OTHER_TREE);
    expect(row("chapters")).toHaveAttribute("aria-expanded", "false");
    expect(row("chapters")).not.toHaveAttribute("aria-selected", "true");
    fireEvent.click(row("chapters"));
    expect(row("other.tex")).toBeInTheDocument();

    openProject("alpha", TREE);
    expect(row("chapters")).toHaveAttribute("aria-expanded", "true");
    expect(row("intro.tex")).toBeInTheDocument();

    openProject("beta", OTHER_TREE);
    expect(row("other.tex")).toBeInTheDocument();
  });

  it("drops remembered folders that no longer exist and does not revive them later", () => {
    const first = render(<FileTree />);
    fireEvent.click(row("chapters"));
    fireEvent.click(row("figures"));
    first.unmount();

    act(() => {
      useFilesStore.setState({
        tree: TREE.filter((entry) => !entry.path.startsWith("figures")),
      });
    });
    const second = render(<FileTree />);
    expect(row("chapters")).toHaveAttribute("aria-expanded", "true");
    expect(maybeRow("figures")).toBeNull();

    act(() => {
      useFilesStore.setState({ tree: TREE });
    });
    expect(row("figures")).toHaveAttribute("aria-expanded", "false");
    expect(row("chapters")).toHaveAttribute("aria-expanded", "true");
    second.unmount();
  });

  it("keeps the remembered state while the project is still loading its tree", () => {
    const first = render(<FileTree />);
    fireEvent.click(row("figures"));
    first.unmount();

    act(() => {
      useFilesStore.setState({ tree: [], loading: true });
    });
    render(<FileTree />);
    expect(screen.queryAllByRole("treeitem")).toHaveLength(0);

    act(() => {
      useFilesStore.setState({ tree: TREE, loading: false });
    });
    expect(row("figures")).toHaveAttribute("aria-expanded", "true");
    expect(row("plot.png")).toBeInTheDocument();
  });
});

const ROW_HEIGHT = 32;
const VIEWPORT_HEIGHT = 320;

function browserLikeScroller() {
  return installScrollGeometry({
    isScroller: (element) => element.getAttribute("role") === "tree",
    contentHeight: (scroller) => paddedListHeight(scroller.firstElementChild, ROW_HEIGHT),
    viewportHeight: VIEWPORT_HEIGHT,
    rowHeight: ROW_HEIGHT,
  });
}

describe("FileTree scroll memory in a windowed list", () => {
  let layout: ReturnType<typeof browserLikeScroller>;

  beforeEach(() => {
    layout = browserLikeScroller();
    openProject("alpha", LONG_TREE as unknown as typeof TREE);
  });

  afterEach(() => {
    layout.restore();
  });

  it("lands exactly where the list was left, with the matching rows already rendered", () => {
    const first = render(<FileTree />);
    layout.scrollTo(tree(), 6_400);
    expect(tree().scrollTop).toBe(6_400);
    expect(maybeRow("f200.tex")).not.toBeNull();
    first.unmount();

    render(<FileTree />);

    expect(tree().scrollTop).toBe(6_400);
    expect(maybeRow("f200.tex")).not.toBeNull();
    expect(maybeRow("f000.tex")).toBeNull();
    expect(layout.pendingFrames()).toBe(0);
  });

  it("waits for the list to be tall enough instead of settling for the clamped position", () => {
    const first = render(<FileTree />);
    layout.scrollTo(tree(), 12_800);
    first.unmount();

    render(<FileTree />);

    expect(tree().scrollTop).toBe(12_800);
    expect(maybeRow("f400.tex")).not.toBeNull();
  });

  it("keeps a separate scroll position for each project", () => {
    const first = render(<FileTree />);
    layout.scrollTo(tree(), 6_400);
    first.unmount();

    openProject("beta", LONG_TREE as unknown as typeof TREE);
    const second = render(<FileTree />);
    expect(tree().scrollTop).toBe(0);
    layout.scrollTo(tree(), 1_600);
    second.unmount();

    openProject("alpha", LONG_TREE as unknown as typeof TREE);
    const third = render(<FileTree />);
    expect(tree().scrollTop).toBe(6_400);
    third.unmount();

    openProject("beta", LONG_TREE as unknown as typeof TREE);
    render(<FileTree />);
    expect(tree().scrollTop).toBe(1_600);
  });

  it("scrolls a project switched while mounted to the position remembered for it", () => {
    render(<FileTree />);
    layout.scrollTo(tree(), 6_400);

    openProject("beta", LONG_TREE as unknown as typeof TREE);
    expect(tree().scrollTop).toBe(0);
    layout.scrollTo(tree(), 960);

    openProject("alpha", LONG_TREE as unknown as typeof TREE);
    expect(tree().scrollTop).toBe(6_400);
    expect(maybeRow("f200.tex")).not.toBeNull();
  });
});
