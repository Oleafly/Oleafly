// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  notifyError: vi.fn(),
  logError: vi.fn(),
  pickOpenPath: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, isTauri: () => false }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setFocus: vi.fn() }),
}));
vi.mock("@/lib/native-file-dialog", () => ({ pickOpenPath: mocks.pickOpenPath }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/toast", () => ({
  notifyError: mocks.notifyError,
  toast: { info: vi.fn(), infoUnique: vi.fn(), success: vi.fn() },
}));
vi.mock("@/components/editor/wysiwyg/controller", () => ({
  flushWysiwygPendingEdits: vi.fn(),
  invalidateWysiwygProjectSession: vi.fn(),
}));

import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enWorkspace from "@/i18n/locales/en/workspace.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { FileTree } from "./FileTree";

const files = enWorkspace.files;
const TREE = [
  { path: "main.tex", is_dir: false },
  { path: "chapters", is_dir: true },
  { path: "chapters/intro.tex", is_dir: false },
];

function backend(overrides: Record<string, unknown> = {}) {
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command in overrides) {
      const value = overrides[command];
      if (value instanceof Error) throw value;
      return value;
    }
    if (command === "list_files") return TREE;
    if (command === "read_file") return "content";
    if (command === "project_mutation_generation") return 0;
    if (command === "create_file") return { status: "created", path: "new.tex", generation: 1 };
    if (command === "rename_file") return { status: "renamed", path: "paper.tex", generation: 1 };
    if (command === "project_engine") return LATEX_ENGINE;
    if (command === "delete_file") return undefined;
    return undefined;
  });
}

beforeEach(() => {
  backend();
  mocks.notifyError.mockReset();
  mocks.pickOpenPath.mockReset().mockResolvedValue(null);
  useSettingsStore.setState({ hiddenFilePatterns: [] });
  useFilesStore.setState({
    projectId: "project",
    tree: TREE,
    files: {},
    openTabs: [],
    activePath: null,
    mainDoc: "main.tex",
    engine: LATEX_ENGINE,
    engineLoaded: true,
  });
});

async function typeNewName(name: string) {
  const input = await screen.findByPlaceholderText(files.newEntry.filePlaceholder);
  fireEvent.change(input, { target: { value: name } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("FileTree toolbar", () => {
  it("uses the shared Source section toggle when its owner controls collapse", () => {
    const onCollapsedChange = vi.fn();
    render(<FileTree collapsed onCollapsedChange={onCollapsedChange} />);

    const toggle = screen.getByRole("button", { name: files.title });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle.querySelector("svg.lucide-folder-closed")).toBeInTheDocument();
    expect(screen.queryByRole("tree", { name: files.treeAriaLabel })).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it("expands and collapses every visible folder from the Explorer section", () => {
    render(<FileTree />);

    const folder = screen.getByRole("treeitem", { name: /chapters/i });
    expect(folder).toHaveAttribute("aria-expanded", "false");

    const bulkToggle = screen.getByRole("button", { name: files.expandAll });
    for (const label of [
      files.expandAll,
      files.newFileAriaLabel,
      files.newFolderAriaLabel,
      files.importAriaLabel,
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByTestId("source-tree-actions")).toHaveClass(
      "hidden",
      "group-hover/section:flex",
      "group-focus-within/section:flex",
    );
    expect(screen.getByTestId("source-tree-actions").parentElement).toHaveClass(
      "pr-2",
    );

    fireEvent.click(bulkToggle);
    expect(folder).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("intro.tex")).toBeInTheDocument();

    const collapseAll = screen.getByRole("button", { name: files.collapseAll });
    expect(collapseAll).toBe(bulkToggle);
    fireEvent.click(collapseAll);
    expect(folder).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("intro.tex")).not.toBeInTheDocument();
  });

  it("keeps a disabled bulk toggle hidden until the Explorer section is hovered", () => {
    useFilesStore.setState({ tree: [{ path: "main.tex", is_dir: false }] });
    render(<FileTree />);

    const bulkToggle = screen.getByRole("button", { name: files.expandAll });
    expect(bulkToggle).toBeDisabled();
    expect(bulkToggle.parentElement).toHaveClass(
      "hidden",
      "group-hover/section:flex",
    );
  });

  it("clears a selected folder after a project switch", async () => {
    render(<FileTree />);

    fireEvent.click(screen.getByText("chapters"));
    useFilesStore.setState({
      projectId: "next-project",
      tree: [{ path: "next.tex", is_dir: false }],
      files: {},
      openTabs: [],
      activePath: null,
    });
    await screen.findByText("next.tex");

    fireEvent.click(screen.getByRole("button", { name: files.newFileAriaLabel }));
    await typeNewName("notes.tex");

    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.some(
          ([command, args]) =>
            command === "create_file" &&
            (args as { path: string }).path === "notes.tex",
        ),
      ).toBe(true),
    );
  });

  it("creates a file in the selected folder", async () => {
    render(<FileTree />);

    fireEvent.click(screen.getByText("chapters"));
    fireEvent.click(screen.getByRole("button", { name: files.newFileAriaLabel }));
    await typeNewName("notes.tex");

    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.some(
          ([command, args]) =>
            command === "create_file" &&
            (args as { path: string }).path === "chapters/notes.tex",
        ),
      ).toBe(true),
    );
  });

  it("does not expand the next project's matching folder after a delayed create", async () => {
    const sourceTree = [
      { path: "main.tex", is_dir: false },
      { path: "chapters", is_dir: true },
    ];
    const nextProjectTree = [
      { path: "next.tex", is_dir: false },
      { path: "chapters", is_dir: true },
      { path: "chapters/current.tex", is_dir: false },
    ];
    let releaseCreate:
      | ((value: { status: string; path: string; generation: number }) => void)
      | undefined;
    mocks.invoke.mockReset().mockImplementation(async (command: string, args?: unknown) => {
      if (command === "create_file") {
        return new Promise<{ status: string; path: string; generation: number }>((resolve) => {
          releaseCreate = resolve;
        });
      }
      if (command === "list_files") {
        return (args as { projectId?: string } | undefined)?.projectId === "next-project"
          ? nextProjectTree
          : sourceTree;
      }
      if (command === "project_mutation_generation") return 0;
      return undefined;
    });
    useFilesStore.setState({ tree: sourceTree });
    render(<FileTree />);

    fireEvent.click(screen.getByText("chapters"));
    fireEvent.click(screen.getByRole("button", { name: files.newFolderAriaLabel }));
    const input = await screen.findByPlaceholderText(files.newEntry.folderPlaceholder);
    fireEvent.change(input, { target: { value: "research" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(releaseCreate).toBeDefined());

    useFilesStore.setState({
      projectId: "next-project",
      tree: nextProjectTree,
      files: {},
      openTabs: [],
      activePath: null,
      mainDoc: "next.tex",
      engine: LATEX_ENGINE,
      engineLoaded: true,
    });
    await screen.findByText("next.tex");

    if (!releaseCreate) throw new Error("create request was not started");
    const resolveCreate = releaseCreate;
    await act(async () => {
      resolveCreate({ status: "created", path: "chapters/research", generation: 1 });
      await Promise.resolve();
    });

    const nextChapters = screen.getByRole("treeitem", { name: /chapters/i });
    expect(nextChapters).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("current.tex")).not.toBeInTheDocument();
  });

  it("does not surface a delayed create conflict in the next project", async () => {
    let releaseCreate:
      | ((value: { status: string; destination: string; suggested_destination: string; generation: number }) => void)
      | undefined;
    mocks.invoke.mockReset().mockImplementation(async (command: string) => {
      if (command === "create_file") {
        return new Promise<{
          status: string;
          destination: string;
          suggested_destination: string;
          generation: number;
        }>((resolve) => {
          releaseCreate = resolve;
        });
      }
      if (command === "list_files") return TREE;
      if (command === "project_mutation_generation") return 0;
      return undefined;
    });
    render(<FileTree />);

    fireEvent.click(screen.getByRole("button", { name: files.newFileAriaLabel }));
    await typeNewName("notes.tex");
    await waitFor(() => expect(releaseCreate).toBeDefined());

    useFilesStore.setState({
      projectId: "next-project",
      tree: [{ path: "next.tex", is_dir: false }],
      files: {},
      openTabs: [],
      activePath: null,
      mainDoc: "next.tex",
      engine: LATEX_ENGINE,
      engineLoaded: true,
    });
    await screen.findByText("next.tex");

    if (!releaseCreate) throw new Error("create request was not started");
    const resolveCreate = releaseCreate;
    await act(async () => {
      resolveCreate({
        status: "conflict",
        destination: "notes.tex",
        suggested_destination: "notes (2).tex",
        generation: 1,
      });
      await Promise.resolve();
    });

    expect(screen.queryByText(files.conflict.title)).not.toBeInTheDocument();
  });

  it("keeps an expanded selected descendant after its parent directory is renamed", async () => {
    const nestedTree = [
      { path: "main.tex", is_dir: false },
      { path: "chapters", is_dir: true },
      { path: "chapters/drafts", is_dir: true },
      { path: "chapters/drafts/intro.tex", is_dir: false },
    ];
    const renamedTree = [
      { path: "main.tex", is_dir: false },
      { path: "renamed", is_dir: true },
      { path: "renamed/drafts", is_dir: true },
      { path: "renamed/drafts/intro.tex", is_dir: false },
    ];
    backend({
      rename_file: { status: "renamed", path: "renamed", generation: 1 },
      list_files: renamedTree,
    });
    useFilesStore.setState({ tree: nestedTree });
    render(<FileTree />);

    fireEvent.click(screen.getByText("chapters"));
    fireEvent.click(await screen.findByText("drafts"));
    fireEvent.click(
      screen.getByRole("button", {
        name: files.moreActions.replace("{{name}}", "chapters"),
      }),
    );
    fireEvent.click(await screen.findByText(enCommon.actions.rename));
    fireEvent.change(
      await screen.findByRole("textbox", { name: files.renameAriaLabel }),
      { target: { value: "renamed" } },
    );
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: files.renameAriaLabel }),
      { key: "Enter" },
    );

    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.some(
          ([command, args]) =>
            command === "rename_file" && (args as { to: string }).to === "renamed",
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("intro.tex")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: files.newFileAriaLabel }));
    await typeNewName("notes.tex");
    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.some(
          ([command, args]) =>
            command === "create_file" &&
            (args as { path: string }).path === "renamed/drafts/notes.tex",
        ),
      ).toBe(true),
    );
  });

  it("preserves newer selection and expansion while a rename is in flight", async () => {
    const sourceTree = [
      { path: "main.tex", is_dir: false },
      { path: "chapters", is_dir: true },
      { path: "chapters/drafts", is_dir: true },
      { path: "chapters/drafts/intro.tex", is_dir: false },
      { path: "appendix", is_dir: true },
      { path: "appendix/current.tex", is_dir: false },
    ];
    const renamedTree = sourceTree.map((entry) => ({
      ...entry,
      path:
        entry.path === "chapters" || entry.path.startsWith("chapters/")
          ? `renamed${entry.path.slice("chapters".length)}`
          : entry.path,
    }));
    let releaseRename:
      | ((value: { status: string; path: string; generation: number }) => void)
      | undefined;
    mocks.invoke.mockReset().mockImplementation(async (command: string, args?: unknown) => {
      if (command === "rename_file") {
        return new Promise<{ status: string; path: string; generation: number }>((resolve) => {
          releaseRename = resolve;
        });
      }
      if (command === "list_files") return renamedTree;
      if (command === "project_mutation_generation") return 0;
      if (command === "create_file") {
        return {
          status: "created",
          path: (args as { path: string }).path,
          generation: 1,
        };
      }
      return undefined;
    });
    useFilesStore.setState({ tree: sourceTree });
    render(<FileTree />);

    fireEvent.click(screen.getByText("chapters"));
    fireEvent.click(await screen.findByText("drafts"));
    fireEvent.click(
      screen.getByRole("button", {
        name: files.moreActions.replace("{{name}}", "chapters"),
      }),
    );
    fireEvent.click(await screen.findByText(enCommon.actions.rename));
    fireEvent.change(
      await screen.findByRole("textbox", { name: files.renameAriaLabel }),
      { target: { value: "renamed" } },
    );
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: files.renameAriaLabel }),
      { key: "Enter" },
    );
    await waitFor(() => expect(releaseRename).toBeDefined());

    fireEvent.click(screen.getByText("appendix"));
    expect(await screen.findByText("current.tex")).toBeInTheDocument();

    if (!releaseRename) throw new Error("rename request was not started");
    const resolveRename = releaseRename;
    await act(async () => {
      resolveRename({ status: "renamed", path: "renamed", generation: 1 });
      await Promise.resolve();
    });

    expect(await screen.findByText("renamed")).toBeInTheDocument();
    expect(screen.getByText("current.tex")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: files.newFileAriaLabel }));
    await typeNewName("later.tex");
    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.some(
          ([command, args]) =>
            command === "create_file" &&
            (args as { path: string }).path === "appendix/later.tex",
        ),
      ).toBe(true),
    );
  });

  it("preserves a newer new-file draft while its parent rename is in flight", async () => {
    const renamedTree = [
      { path: "main.tex", is_dir: false },
      { path: "renamed", is_dir: true },
      { path: "renamed/intro.tex", is_dir: false },
    ];
    let releaseRename:
      | ((value: { status: string; path: string; generation: number }) => void)
      | undefined;
    mocks.invoke.mockReset().mockImplementation(async (command: string, args?: unknown) => {
      if (command === "rename_file") {
        return new Promise<{ status: string; path: string; generation: number }>((resolve) => {
          releaseRename = resolve;
        });
      }
      if (command === "list_files") return renamedTree;
      if (command === "project_mutation_generation") return 0;
      if (command === "create_file") {
        return {
          status: "created",
          path: (args as { path: string }).path,
          generation: 1,
        };
      }
      return undefined;
    });
    render(<FileTree />);

    fireEvent.click(
      screen.getByRole("button", {
        name: files.moreActions.replace("{{name}}", "chapters"),
      }),
    );
    fireEvent.click(await screen.findByText(enCommon.actions.rename));
    fireEvent.change(
      await screen.findByRole("textbox", { name: files.renameAriaLabel }),
      { target: { value: "renamed" } },
    );
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: files.renameAriaLabel }),
      { key: "Enter" },
    );
    await waitFor(() => expect(releaseRename).toBeDefined());

    fireEvent.click(screen.getByText("chapters"));
    fireEvent.click(screen.getByRole("button", { name: files.newFileAriaLabel }));
    const draftInput = await screen.findByPlaceholderText(files.newEntry.filePlaceholder);
    fireEvent.change(draftInput, { target: { value: "notes.tex" } });

    if (!releaseRename) throw new Error("rename request was not started");
    const resolveRename = releaseRename;
    await act(async () => {
      resolveRename({ status: "renamed", path: "renamed", generation: 1 });
      await Promise.resolve();
    });

    const restoredDraft = await screen.findByPlaceholderText(files.newEntry.filePlaceholder);
    expect(restoredDraft).toHaveValue("notes.tex");
    fireEvent.keyDown(restoredDraft, { key: "Enter" });

    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.some(
          ([command, args]) =>
            command === "create_file" &&
            (args as { path: string }).path === "renamed/notes.tex",
        ),
      ).toBe(true),
    );
  });

  it("keeps another project's in-flight rename from suppressing a new-file blur", async () => {
    const sourceTree = [
      { path: "main.tex", is_dir: false },
      { path: "chapters", is_dir: true },
      { path: "chapters/drafts", is_dir: true },
      { path: "chapters/drafts/intro.tex", is_dir: false },
    ];
    const nextProjectTree = [{ path: "next.tex", is_dir: false }];
    let releaseRename:
      | ((value: { status: string; path: string; generation: number }) => void)
      | undefined;
    mocks.invoke.mockReset().mockImplementation(async (command: string, args?: unknown) => {
      if (command === "rename_file") {
        return new Promise<{ status: string; path: string; generation: number }>((resolve) => {
          releaseRename = resolve;
        });
      }
      if (command === "list_files") {
        return (args as { projectId?: string } | undefined)?.projectId === "next-project"
          ? nextProjectTree
          : sourceTree;
      }
      if (command === "read_file") return "content";
      if (command === "project_mutation_generation") return 0;
      if (command === "create_file") {
        return { status: "created", path: "notes.tex", generation: 1 };
      }
      return undefined;
    });
    useFilesStore.setState({ tree: sourceTree });
    render(<FileTree />);

    fireEvent.click(screen.getByText("chapters"));
    fireEvent.click(await screen.findByText("drafts"));
    fireEvent.click(
      screen.getByRole("button", {
        name: files.moreActions.replace("{{name}}", "chapters"),
      }),
    );
    fireEvent.click(await screen.findByText(enCommon.actions.rename));
    fireEvent.change(
      await screen.findByRole("textbox", { name: files.renameAriaLabel }),
      { target: { value: "renamed" } },
    );
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: files.renameAriaLabel }),
      { key: "Enter" },
    );
    await waitFor(() => expect(releaseRename).toBeDefined());

    useFilesStore.setState({
      projectId: "next-project",
      tree: nextProjectTree,
      files: {},
      openTabs: [],
      activePath: null,
      mainDoc: "next.tex",
      engine: LATEX_ENGINE,
      engineLoaded: true,
    });
    await screen.findByText("next.tex");

    fireEvent.click(screen.getByRole("button", { name: files.newFileAriaLabel }));
    const nextProjectDraft = await screen.findByPlaceholderText(files.newEntry.filePlaceholder);
    fireEvent.change(nextProjectDraft, { target: { value: "notes.tex" } });
    fireEvent.blur(nextProjectDraft);

    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.some(
          ([command, args]) =>
            command === "create_file" &&
            (args as { projectId: string; path: string }).projectId === "next-project" &&
            (args as { projectId: string; path: string }).path === "notes.tex",
        ),
      ).toBe(true),
    );

    const nextProjectListCount = mocks.invoke.mock.calls.filter(
      ([command, args]) =>
        command === "list_files" &&
        (args as { projectId?: string } | undefined)?.projectId === "next-project",
    ).length;
    if (!releaseRename) throw new Error("rename request was not started");
    const resolveRename = releaseRename;
    await act(async () => {
      resolveRename({ status: "renamed", path: "renamed", generation: 1 });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.filter(
          ([command, args]) =>
            command === "list_files" &&
            (args as { projectId?: string } | undefined)?.projectId === "next-project",
        ).length,
      ).toBeGreaterThan(nextProjectListCount),
    );

    expect(screen.queryByText("intro.tex")).not.toBeInTheDocument();
  });

  it("expands only folders that remain visible after hidden-path filtering", () => {
    useSettingsStore.setState({ hiddenFilePatterns: ["private"] });
    useFilesStore.setState({
      tree: [
        { path: "main.tex", is_dir: false },
        { path: "chapters", is_dir: true },
        { path: "chapters/intro.tex", is_dir: false },
        { path: "private", is_dir: true },
        { path: "private/notes.tex", is_dir: false },
      ],
    });
    render(<FileTree />);

    fireEvent.click(screen.getByRole("button", { name: files.expandAll }));

    expect(screen.getByRole("treeitem", { name: /chapters/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("intro.tex")).toBeInTheDocument();
    expect(screen.queryByText("private")).not.toBeInTheDocument();
    expect(screen.queryByText("notes.tex")).not.toBeInTheDocument();
  });

  it("creates a folder at the project root when nothing is selected", async () => {
    render(<FileTree />);

    fireEvent.click(screen.getByRole("button", { name: files.newFolderAriaLabel }));
    const input = await screen.findByPlaceholderText(files.newEntry.folderPlaceholder);
    fireEvent.change(input, { target: { value: "figures" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.some(
          ([command, args]) =>
            command === "create_file" && (args as { path: string }).path === "figures",
        ),
      ).toBe(true),
    );
  });

  it("abandons a new entry on Escape and on an empty name", async () => {
    render(<FileTree />);

    fireEvent.click(screen.getByRole("button", { name: files.newFileAriaLabel }));
    const input = await screen.findByPlaceholderText(files.newEntry.filePlaceholder);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(
      screen.queryByPlaceholderText(files.newEntry.filePlaceholder),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: files.newFileAriaLabel }));
    fireEvent.keyDown(
      await screen.findByPlaceholderText(files.newEntry.filePlaceholder),
      { key: "Enter" },
    );
    expect(
      mocks.invoke.mock.calls.some(([command]) => command === "create_file"),
    ).toBe(false);
  });

  it("names the file that could not be created", async () => {
    backend({ create_file: new Error("disk full") });
    render(<FileTree />);

    fireEvent.click(screen.getByRole("button", { name: files.newFileAriaLabel }));
    await typeNewName("notes.tex");

    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "create file",
        expect.anything(),
        files.createFailed.replace("{{path}}", "notes.tex"),
      ),
    );
  });

  it("imports into the selected folder from the toolbar menu", async () => {
    render(<FileTree />);

    fireEvent.click(screen.getByText("chapters"));
    fireEvent.pointerDown(
      screen.getByRole("button", { name: files.importAriaLabel }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(await screen.findByText(files.importFiles));

    await waitFor(() => expect(mocks.pickOpenPath).toHaveBeenCalled());
  });

  it("does not import picker results into a project selected after picking", async () => {
    const nextProjectTree = [
      { path: "next.tex", is_dir: false },
      { path: "chapters", is_dir: true },
      { path: "chapters/current.tex", is_dir: false },
    ];
    let releasePicker: ((value: string[]) => void) | undefined;
    mocks.pickOpenPath.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          releasePicker = resolve;
        }),
    );
    render(<FileTree />);

    fireEvent.click(screen.getByText("chapters"));
    fireEvent.pointerDown(
      screen.getByRole("button", { name: files.importAriaLabel }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(await screen.findByText(files.importFiles));
    await waitFor(() => expect(releasePicker).toBeDefined());

    useFilesStore.setState({
      projectId: "next-project",
      tree: nextProjectTree,
      files: {},
      openTabs: [],
      activePath: null,
      mainDoc: "next.tex",
      engine: LATEX_ENGINE,
      engineLoaded: true,
    });
    await screen.findByText("next.tex");

    if (!releasePicker) throw new Error("file picker was not opened");
    const resolvePicker = releasePicker;
    await act(async () => {
      resolvePicker(["/tmp/notes.tex"]);
      await Promise.resolve();
    });

    expect(
      mocks.invoke.mock.calls.some(([command]) => command === "import_paths_into_project"),
    ).toBe(false);
    expect(screen.getByRole("treeitem", { name: /chapters/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("does not expand a matching folder after an in-flight import completes", async () => {
    const sourceTree = [
      { path: "main.tex", is_dir: false },
      { path: "chapters", is_dir: true },
    ];
    const nextProjectTree = [
      { path: "next.tex", is_dir: false },
      { path: "chapters", is_dir: true },
      { path: "chapters/current.tex", is_dir: false },
    ];
    let releaseImport: ((value: { imported: string[]; generation: number }) => void) | undefined;
    mocks.pickOpenPath.mockResolvedValue(["/tmp/notes.tex"]);
    mocks.invoke.mockReset().mockImplementation(async (command: string, args?: unknown) => {
      if (command === "import_paths_into_project") {
        return new Promise<{ imported: string[]; generation: number }>((resolve) => {
          releaseImport = resolve;
        });
      }
      if (command === "list_files") {
        return (args as { projectId?: string } | undefined)?.projectId === "next-project"
          ? nextProjectTree
          : sourceTree;
      }
      if (command === "project_mutation_generation") return 0;
      return undefined;
    });
    useFilesStore.setState({ tree: sourceTree });
    render(<FileTree />);

    fireEvent.click(screen.getByText("chapters"));
    fireEvent.pointerDown(
      screen.getByRole("button", { name: files.importAriaLabel }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(await screen.findByText(files.importFiles));
    await waitFor(() => expect(releaseImport).toBeDefined());

    useFilesStore.setState({
      projectId: "next-project",
      tree: nextProjectTree,
      files: {},
      openTabs: [],
      activePath: null,
      mainDoc: "next.tex",
      engine: LATEX_ENGINE,
      engineLoaded: true,
    });
    await screen.findByText("next.tex");

    if (!releaseImport) throw new Error("import request was not started");
    const resolveImport = releaseImport;
    await act(async () => {
      resolveImport({ imported: ["chapters/notes.tex"], generation: 1 });
      await Promise.resolve();
    });

    expect(screen.getByRole("treeitem", { name: /chapters/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("current.tex")).not.toBeInTheDocument();
  });
});

describe("FileTree moves", () => {
  function dropOnRoot(from: string) {
    const tree = screen.getByRole("tree", { name: files.treeAriaLabel });
    const dataTransfer = {
      types: ["text/plain"],
      getData: () => from,
      setData: vi.fn(),
      effectAllowed: "",
      dropEffect: "",
    };
    fireEvent.dragOver(tree, { dataTransfer });
    fireEvent.drop(tree, { dataTransfer });
  }

  it("moves an entry back to the project root", async () => {
    render(<FileTree />);

    dropOnRoot("chapters/intro.tex");

    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.some(
          ([command, args]) =>
            command === "rename_file" && (args as { to: string }).to === "intro.tex",
        ),
      ).toBe(true),
    );
  });

  it("names the entry that could not be moved", async () => {
    backend({ rename_file: new Error("read only volume") });
    render(<FileTree />);

    dropOnRoot("chapters/intro.tex");

    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "move file",
        expect.anything(),
        files.moveFailed.replace("{{path}}", "chapters/intro.tex"),
      ),
    );
  });
});

describe("FileTree row actions", () => {
  function openRowMenu(name: string) {
    fireEvent.click(
      screen.getByRole("button", {
        name: files.moreActions.replace("{{name}}", name),
      }),
    );
  }

  it("renames a file from its row menu", async () => {
    render(<FileTree />);

    openRowMenu("main.tex");
    fireEvent.click(await screen.findByText(enCommon.actions.rename));

    const input = await screen.findByRole("textbox", { name: files.renameAriaLabel });
    fireEvent.change(input, { target: { value: "paper.tex" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.some(
          ([command, args]) =>
            command === "rename_file" && (args as { to: string }).to === "paper.tex",
        ),
      ).toBe(true),
    );
  });

  it("names the file that could not be renamed", async () => {
    backend({ rename_file: new Error("locked") });
    render(<FileTree />);

    openRowMenu("main.tex");
    fireEvent.click(await screen.findByText(enCommon.actions.rename));
    const input = await screen.findByRole("textbox", { name: files.renameAriaLabel });
    fireEvent.change(input, { target: { value: "paper.tex" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "rename file",
        expect.anything(),
        files.renameFailed.replace("{{path}}", "main.tex"),
      ),
    );
  });

  it("abandons a rename on Escape", async () => {
    render(<FileTree />);

    openRowMenu("main.tex");
    fireEvent.click(await screen.findByText(enCommon.actions.rename));
    fireEvent.keyDown(
      await screen.findByRole("textbox", { name: files.renameAriaLabel }),
      { key: "Escape" },
    );

    expect(
      screen.queryByRole("textbox", { name: files.renameAriaLabel }),
    ).not.toBeInTheDocument();
  });

  it("copies an entry from its row menu", async () => {
    render(<FileTree />);

    openRowMenu("main.tex");
    fireEvent.click(await screen.findByText(files.makeCopy));

    await waitFor(() =>
      expect(mocks.invoke.mock.calls.some(([command]) => command === "copy_file")).toBe(
        true,
      ),
    );
  });

  it("asks before deleting and reports a delete that fails", async () => {
    backend({ delete_file: new Error("busy") });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<FileTree />);

    openRowMenu("main.tex");
    fireEvent.click(await screen.findByText(enCommon.actions.delete));
    expect(confirm).toHaveBeenCalledWith(
      files.confirmDelete.replace("{{path}}", "main.tex"),
    );
    expect(
      mocks.invoke.mock.calls.some(([command]) => command === "delete_file"),
    ).toBe(false);

    confirm.mockReturnValue(true);
    openRowMenu("main.tex");
    fireEvent.click(await screen.findByText(enCommon.actions.delete));
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "delete file",
        expect.anything(),
        files.deleteFailed.replace("{{path}}", "main.tex"),
      ),
    );
    confirm.mockRestore();
  });

  it("offers Open and Set as main on a file row", async () => {
    render(<FileTree />);

    openRowMenu("main.tex");
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText(files.setMain)).toBeInTheDocument();
    fireEvent.click(within(menu).getByText(enCommon.actions.open));

    await waitFor(() => expect(useFilesStore.getState().activePath).toBe("main.tex"));
  });

  it("offers creation and import actions on a folder row", async () => {
    render(<FileTree />);

    openRowMenu("chapters");
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText(files.newFile)).toBeInTheDocument();
    expect(within(menu).getByText(files.newFolder)).toBeInTheDocument();
    fireEvent.click(within(menu).getByText(files.importFolder));

    await waitFor(() => expect(mocks.pickOpenPath).toHaveBeenCalled());
  });
});

describe("FileTree conflict dialog", () => {
  const conflict = {
    status: "conflict",
    destination: "notes.tex",
    suggested_destination: "notes (2).tex",
    generation: 0,
  };

  it("reports a conflict resolution that fails and can be dismissed", async () => {
    backend({ create_file: conflict });
    render(<FileTree />);

    fireEvent.click(screen.getByRole("button", { name: files.newFileAriaLabel }));
    await typeNewName("notes.tex");
    await screen.findByText(files.conflict.title);

    backend({ create_file: new Error("disk full") });
    fireEvent.click(screen.getByText(files.conflict.keepBoth));
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "resolve file conflict",
        expect.anything(),
        files.conflict.unchanged,
      ),
    );

    fireEvent.click(screen.getByText(enCommon.actions.cancel));
    expect(screen.queryByText(files.conflict.title)).not.toBeInTheDocument();
  });

  it("dismisses a pending create conflict when its parent disappears on refresh", async () => {
    const conflictInFolder = {
      ...conflict,
      destination: "chapters/notes.tex",
      suggested_destination: "chapters/notes (2).tex",
    };
    backend({ create_file: conflictInFolder });
    render(<FileTree />);

    fireEvent.click(screen.getByText("chapters"));
    fireEvent.click(screen.getByRole("button", { name: files.newFileAriaLabel }));
    await typeNewName("notes.tex");
    await screen.findByText(files.conflict.title);

    useFilesStore.setState({
      tree: [{ path: "main.tex", is_dir: false }],
    });

    await waitFor(() =>
      expect(screen.queryByText(files.conflict.title)).not.toBeInTheDocument(),
    );
  });
});
