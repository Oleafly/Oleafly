// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  refreshLinked: vi.fn(async () => true),
}));

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
vi.mock("@/lib/log", () => ({ logError: vi.fn(), logWarning: vi.fn(), logInfo: vi.fn() }));
vi.mock("@/components/editor/wysiwyg/controller", () => ({
  flushWysiwygPendingEdits: vi.fn(),
  invalidateWysiwygProjectSession: vi.fn(),
}));
vi.mock("@/features/collab/live/linked-refresh", () => ({ refreshLinked: mocks.refreshLinked }));

import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enWorkspace from "@/i18n/locales/en/workspace.json" with { type: "json" };
import { i18n, loadNamespace } from "@/i18n";
import { useCollabEditorGate, useLiveBackend } from "@/lib/collab-live-bridge";
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { OverleafLinkedFile } from "@/lib/overleaf-live";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { FileTree } from "./FileTree";

const copy = enCollab.overleafLinked;
const TREE = [
  { path: "main.tex", is_dir: false },
  { path: "refs.bib", is_dir: false },
];
const LINKED: OverleafLinkedFile = {
  path: "refs.bib",
  provider: "project_file",
  url: null,
  sourceProject: "64b7f0c2a1e3d4b5c6a7e8f9",
  sourcePath: "/sample.bib",
};

function openRowMenu(name: string) {
  fireEvent.click(screen.getByRole("button", { name: enWorkspace.files.moreActions.replace("{{name}}", name) }));
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(async () => {
  await i18n.changeLanguage("en");
  mocks.refreshLinked.mockClear();
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "list_files") return TREE;
    if (command === "project_mutation_generation") return 0;
    if (command === "project_engine") return LATEX_ENGINE;
    return undefined;
  });
  useSettingsStore.setState({ hiddenFilePatterns: [] });
  useFilesStore.setState({
    projectId: "paper",
    tree: TREE,
    treeTruncated: false,
    files: {},
    openTabs: [],
    activePath: null,
    mainDoc: "main.tex",
    manifestHome: "library",
    engine: LATEX_ENGINE,
    engineLoaded: true,
  });
  useCollabEditorGate.setState({ projectId: "paper", viewer: false, locked: false, connecting: false });
  useLiveBackend.setState({ projectId: "paper", backend: "overleaf", linked: [LINKED] });
});

describe("Overleaf linked files in the file tree", () => {
  it("marks a linked file, explains it and offers a refresh to writers", async () => {
    render(<FileTree />);
    const refs = await screen.findByRole("treeitem", { name: /^refs\.bib/ });
    expect(within(refs).getByTestId("tree-overleaf-linked")).toBeInTheDocument();
    expect(refs).toHaveAttribute("title", copy.treeHint);
    const main = screen.getByRole("treeitem", { name: /^main\.tex/ });
    expect(within(main).queryByTestId("tree-overleaf-linked")).toBeNull();
    expect(main).not.toHaveAttribute("title");
    openRowMenu("refs.bib");
    fireEvent.click(await screen.findByRole("menuitem", { name: copy.refresh }));
    await waitFor(() => expect(mocks.refreshLinked).toHaveBeenCalledWith("paper", "refs.bib"));
  });

  it("keeps the refresh off the menu of files that aren't linked", async () => {
    render(<FileTree />);
    await screen.findByRole("treeitem", { name: /^refs\.bib/ });
    openRowMenu("main.tex");
    expect(await screen.findByRole("menuitem", { name: enWorkspace.files.copyLink })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: copy.refresh })).toBeNull();
  });

  it("keeps the refresh away from reviewers and viewers but still marks the file", async () => {
    act(() => useCollabEditorGate.setState({ locked: true }));
    render(<FileTree />);
    const refs = await screen.findByRole("treeitem", { name: /^refs\.bib/ });
    expect(within(refs).getByTestId("tree-overleaf-linked")).toBeInTheDocument();
    openRowMenu("refs.bib");
    expect(await screen.findByRole("menuitem", { name: enWorkspace.files.copyLink })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: copy.refresh })).toBeNull();
  });

  it("shows nothing for a link list that belongs to another project or the server backend", async () => {
    useLiveBackend.setState({ projectId: "other" });
    const { unmount } = render(<FileTree />);
    const refs = await screen.findByRole("treeitem", { name: /^refs\.bib/ });
    expect(within(refs).queryByTestId("tree-overleaf-linked")).toBeNull();
    unmount();
    useLiveBackend.setState({ projectId: "paper", backend: "server" });
    render(<FileTree />);
    const again = await screen.findByRole("treeitem", { name: /^refs\.bib/ });
    expect(within(again).queryByTestId("tree-overleaf-linked")).toBeNull();
  });
});
