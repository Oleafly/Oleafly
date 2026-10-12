// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ item: vi.fn(), dialog: vi.fn() }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
    minimize: () => Promise.resolve(),
    toggleMaximize: () => Promise.resolve(),
    close: () => Promise.resolve(),
  }),
}));
vi.mock("@/features/collab/sharing/CollabToolbarItem", () => ({
  CollabToolbarItem: () => {
    mocks.item();
    return <button type="button">{"Share stub"}</button>;
  },
}));
vi.mock("@/features/collab/sharing/ShareDialog", () => ({
  ShareDialog: ({ projectId }: { projectId: string }) => {
    mocks.dialog(projectId);
    return <div role="dialog">{projectId}</div>;
  },
}));

import { TopToolbar } from "./TopToolbar";
import { useShareDialog } from "@/components/collab/share-dialog";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { ThemeProvider } from "@/lib/theme";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

function renderToolbar() {
  return render(
    <ThemeProvider>
      <TopToolbar />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useFilesStore.setState({
    projectId: "grant",
    projectName: "Grant proposal",
    projects: [],
    engineError: null,
    manifestHome: "library",
    engine: LATEX_ENGINE,
    engineLoaded: true,
    loading: false,
    mainDoc: "main.tex",
    activePath: null,
    files: {},
    tree: [{ path: "main.tex", is_dir: false }],
  } as unknown as ReturnType<typeof useFilesStore.getState>);
  useCompileStore.setState({ status: "idle", lastCompileCheckpoint: null });
  useSettingsStore.setState({ viewMode: "split", assistantOpen: false, workspaceHidden: false });
  useShareDialog.setState({ projectId: null, fromCopy: false });
});

afterEach(() => {
  cleanup();
  useSettingsStore.setState({ liveCollaboration: false });
});

describe("TopToolbar collaboration item", () => {
  it("sits immediately left of Recompile and stays pinned when live collaboration is on", async () => {
    useSettingsStore.setState({ liveCollaboration: true });
    const view = renderToolbar();
    expect(await screen.findByRole("button", { name: "Share stub" })).toBeInTheDocument();
    const compile = view.container.querySelector('[data-toolbar-item="compile"]');
    const collab = compile?.previousElementSibling;
    expect(collab).toHaveAttribute("data-toolbar-item", "collab");
    expect(collab).not.toHaveAttribute("data-overflow-order");
    expect(collab).not.toHaveAttribute("data-toolbar-icon");
    expect(mocks.item).toHaveBeenCalled();
  });

  it("opens the share dialog from anywhere that asks for it", async () => {
    useSettingsStore.setState({ liveCollaboration: true });
    renderToolbar();
    act(() => useShareDialog.getState().openFor("grant"));
    expect(await screen.findByRole("dialog")).toHaveTextContent("grant");
  });

  it("adds nothing to the toolbar while live collaboration is off", async () => {
    const view = renderToolbar();
    act(() => useShareDialog.getState().openFor("grant"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.container.querySelector('[data-toolbar-item="collab"]')).toBeNull();
    expect(mocks.item).not.toHaveBeenCalled();
    expect(mocks.dialog).not.toHaveBeenCalled();
  });
});
