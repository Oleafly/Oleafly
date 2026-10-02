// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

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
vi.mock("@/components/editor/wysiwyg/controller", () => ({
  flushWysiwygPendingEdits: vi.fn(),
  invalidateWysiwygProjectSession: vi.fn(),
}));

import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { i18n } from "@/i18n";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useFilesStore } from "@/store/files";
import { useGitStatusStore } from "@/store/git-status";
import { useSettingsStore } from "@/store/settings";
import { FileTree } from "./FileTree";

const status = enShell.sourceControl.status;
const PROJECT = "project-1";
const TREE = [
  { path: "chapters", is_dir: true },
  { path: "chapters/intro.tex", is_dir: false },
  { path: "main.tex", is_dir: false },
  { path: "refs.bib", is_dir: false },
];

const row = (name: RegExp) => screen.getByRole("treeitem", { name });

beforeEach(async () => {
  await i18n.changeLanguage("en");
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "list_files") return TREE;
    if (command === "project_mutation_generation") return 0;
    if (command === "project_engine") return LATEX_ENGINE;
    return undefined;
  });
  useSettingsStore.setState({ hiddenFilePatterns: [] });
  useFilesStore.setState({
    projectId: PROJECT,
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
  useGitStatusStore.setState({
    count: 2,
    projectId: PROJECT,
    changes: [
      { path: "main.tex", status: "?", staged: false, conflict: false },
      { path: "chapters/intro.tex", status: "M", staged: false, conflict: false },
    ],
  });
});

describe("FileTree Git status", () => {
  it("shows the Source Control badge on changed files and keeps their names in the normal colour", () => {
    render(<FileTree />);

    const main = row(/^main\.tex/);
    expect(within(main).getByText("U")).toBeInTheDocument();
    expect(within(main).getByTitle(status.untracked)).toHaveClass("bg-primary/15");
    expect(main).toHaveAccessibleName(expect.stringContaining(status.untracked));
    expect(within(main).getByText("main.tex")).not.toHaveClass("text-primary");

    const refs = row(/^refs\.bib/);
    expect(within(refs).queryByTitle(status.untracked)).not.toBeInTheDocument();
    expect(within(refs).getByText("refs.bib")).not.toHaveClass("text-primary");
  });

  it("marks a folder that contains changes with a dot and badges the file once opened", () => {
    render(<FileTree />);

    const folder = row(/^chapters/);
    expect(within(folder).getByTitle(status.containsChanges)).toHaveClass("text-amber-600");
    expect(within(folder).getByText("chapters")).not.toHaveClass("text-amber-600");

    fireEvent.click(folder);
    const intro = row(/^intro\.tex/);
    expect(within(intro).getByTitle(status.modified)).toHaveTextContent("M");
    expect(within(intro).getByText("intro.tex")).not.toHaveClass("text-amber-600");
  });

  it("refreshes Git status after a save makes a clean file changed, and only then", async () => {
    const gitStatusCalls = () =>
      mocks.invoke.mock.calls.filter(([command]) => command === "git_status").length;
    const save = (path: string) => {
      act(() =>
        useFilesStore.setState({ files: { [path]: { content: "edited", dirty: true } } }),
      );
      act(() =>
        useFilesStore.setState({ files: { [path]: { content: "edited", dirty: false } } }),
      );
    };
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "list_files") return TREE;
      if (command === "project_mutation_generation") return 0;
      if (command === "project_engine") return LATEX_ENGINE;
      if (command === "git_status") {
        return [
          { path: "main.tex", status: "?", staged: false, conflict: false },
          { path: "chapters/intro.tex", status: "M", staged: false, conflict: false },
          { path: "refs.bib", status: "M", staged: false, conflict: false },
        ];
      }
      return undefined;
    });
    vi.useFakeTimers();
    try {
      render(<FileTree />);

      // main.tex is already listed, so saving it again needs no new status.
      save("main.tex");
      await act(() => vi.advanceTimersByTimeAsync(1_000));
      expect(gitStatusCalls()).toBe(0);

      save("refs.bib");
      await act(() => vi.advanceTimersByTimeAsync(1_000));
      expect(gitStatusCalls()).toBe(1);
      expect(within(row(/^refs\.bib/)).getByTitle(status.modified)).toHaveTextContent("M");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows nothing for a clean tree or another project's status", () => {
    useGitStatusStore.setState({ projectId: "project-2" });
    render(<FileTree />);
    expect(screen.queryByTitle(status.untracked)).not.toBeInTheDocument();
    expect(screen.queryByTitle(status.containsChanges)).not.toBeInTheDocument();

    act(() => useGitStatusStore.setState({ projectId: PROJECT, changes: [] }));
    expect(screen.queryByTitle(status.untracked)).not.toBeInTheDocument();
    expect(screen.queryByTitle(status.containsChanges)).not.toBeInTheDocument();
  });
});
