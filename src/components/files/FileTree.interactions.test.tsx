// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  notifyError: vi.fn(),
  pickOpenPath: vi.fn(),
  linux: false,
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
vi.mock("@/lib/native-file-dialog", () => ({ pickOpenPath: mocks.pickOpenPath }));
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  get isLinux() {
    return mocks.linux;
  },
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/toast", () => ({
  notifyError: mocks.notifyError,
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

import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enWorkspace from "@/i18n/locales/en/workspace.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { FileTree } from "./FileTree";

const files = enWorkspace.files;

const TREE = [
  { path: "main.tex", is_dir: false },
  { path: "notes.tex", is_dir: false },
  { path: "chapters", is_dir: true },
  { path: "chapters/intro.tex", is_dir: false },
];

type Handler = unknown | ((args: Record<string, unknown>) => unknown);

function backend(overrides: Record<string, Handler> = {}) {
  mocks.invoke.mockReset().mockImplementation(async (command: string, args: Record<string, unknown>) => {
    if (command in overrides) {
      const value = overrides[command];
      const result = typeof value === "function" ? value(args) : value;
      if (result instanceof Error) throw result;
      return result;
    }
    if (command === "list_files") return TREE;
    if (command === "read_file") return "content";
    if (command === "project_mutation_generation") return 0;
    if (command === "project_engine") return LATEX_ENGINE;
    return undefined;
  });
}

function renameCalls() {
  return mocks.invoke.mock.calls
    .filter(([command]) => command === "rename_file")
    .map(([, args]) => args as { from: string; to: string; conflictStrategy: string });
}

function transfer() {
  const data = new Map<string, string>();
  return {
    get types() {
      return [...data.keys()];
    },
    setData: (key: string, value: string) => data.set(key, value),
    getData: (key: string) => data.get(key) ?? "",
    effectAllowed: "none",
    dropEffect: "none",
  };
}

function row(name: string) {
  return screen.getByRole("treeitem", { name: new RegExp(`^${name.replace(".", "\\.")}`) });
}

function tree() {
  return screen.getByRole("tree", { name: files.treeAriaLabel });
}

async function renameViaMenu(name: string, value: string) {
  fireEvent.click(screen.getByRole("button", { name: files.moreActions.replace("{{name}}", name) }));
  fireEvent.click(await screen.findByText(enCommon.actions.rename));
  const input = await screen.findByRole("textbox", { name: files.renameAriaLabel });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

const conflict = (destination: string, suggestion: string) => ({
  status: "conflict",
  destination,
  suggested_destination: suggestion,
  generation: 0,
});

beforeEach(() => {
  backend();
  mocks.linux = false;
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

describe("FileTree rename conflicts", () => {
  it("replaces the existing destination when the user chooses Replace", async () => {
    backend({
      rename_file: (args: { conflictStrategy: string }) =>
        args.conflictStrategy === "replace"
          ? { status: "renamed", path: "notes.tex", generation: 1 }
          : conflict("notes.tex", "notes (2).tex"),
    });
    render(<FileTree />);

    await renameViaMenu("main.tex", "notes.tex");
    const dialog = await screen.findByRole("alertdialog", { name: files.conflict.dialogAriaLabel });
    expect(within(dialog).getByText(files.conflict.title)).toBeInTheDocument();
    expect(within(dialog).getByText("notes (2).tex")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: files.conflict.replace }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(renameCalls().at(-1)).toMatchObject({
      from: "main.tex",
      to: "notes.tex",
      conflictStrategy: "replace",
    });
  });

  it("shows the newer suggestion when keeping both collides again", async () => {
    let attempts = 0;
    backend({
      rename_file: () => {
        attempts += 1;
        return attempts === 1
          ? conflict("notes.tex", "notes (2).tex")
          : conflict("notes.tex", "notes (3).tex");
      },
    });
    render(<FileTree />);

    await renameViaMenu("main.tex", "notes.tex");
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: files.conflict.keepBoth }));

    expect(await within(dialog).findByText("notes (3).tex")).toBeInTheDocument();
    expect(renameCalls().at(-1)?.conflictStrategy).toBe("keep_both");
    expect(within(dialog).getByRole("button", { name: files.conflict.keepBoth })).toBeEnabled();
  });

  it("reports a failed resolution and leaves the dialog open", async () => {
    let attempts = 0;
    backend({
      rename_file: () => {
        attempts += 1;
        return attempts === 1 ? conflict("notes.tex", "notes (2).tex") : new Error("disk full");
      },
    });
    render(<FileTree />);

    await renameViaMenu("main.tex", "notes.tex");
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: files.conflict.replace }));

    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "resolve file conflict",
        expect.any(Error),
        files.conflict.unchanged,
      ),
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("opens the destination folder after resolving a nested rename", async () => {
    backend({
      rename_file: (args: { conflictStrategy: string }) =>
        args.conflictStrategy === "keep_both"
          ? { status: "renamed", path: "chapters/main (2).tex", generation: 1 }
          : conflict("chapters/main.tex", "chapters/main (2).tex"),
    });
    render(<FileTree />);

    fireEvent.click(row("chapters"));
    fireEvent.click(row("chapters"));
    expect(row("chapters")).toHaveAttribute("aria-expanded", "false");
    const source = row("main.tex");
    const data = transfer();
    fireEvent.dragStart(source, { dataTransfer: data });
    fireEvent.dragOver(row("chapters"), { dataTransfer: data });
    fireEvent.drop(row("chapters"), { dataTransfer: data });

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: files.conflict.keepBoth }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(row("chapters")).toHaveAttribute("aria-expanded", "true");
  });

  it("explains a failed move without a structured error", async () => {
    backend({ rename_file: new Error("locked") });
    render(<FileTree />);

    const data = transfer();
    fireEvent.dragStart(row("notes.tex"), { dataTransfer: data });
    fireEvent.drop(row("chapters"), { dataTransfer: data });

    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "move file",
        expect.any(Error),
        files.moveFailed.replace("{{path}}", "notes.tex"),
      ),
    );
  });
});

describe("FileTree drag and drop", () => {
  it("moves a file into the folder it is dropped on and opens that folder", async () => {
    backend({ rename_file: { status: "renamed", path: "chapters/main.tex", generation: 1 } });
    render(<FileTree />);
    const data = transfer();

    fireEvent.dragStart(row("main.tex"), { dataTransfer: data });
    expect(data.getData("text/plain")).toBe("main.tex");
    expect(data.effectAllowed).toBe("move");
    expect(fireEvent.dragOver(row("chapters"), { dataTransfer: data })).toBe(false);
    expect(data.dropEffect).toBe("move");
    fireEvent.drop(row("chapters"), { dataTransfer: data });

    await waitFor(() =>
      expect(renameCalls()).toEqual([
        expect.objectContaining({ from: "main.tex", to: "chapters/main.tex" }),
      ]),
    );
    await waitFor(() => expect(row("chapters")).toHaveAttribute("aria-expanded", "true"));
  });

  it("moves a nested file back to the project root when dropped on the tree", async () => {
    backend({ rename_file: { status: "renamed", path: "intro.tex", generation: 1 } });
    render(<FileTree />);
    fireEvent.click(row("chapters"));
    const data = transfer();

    fireEvent.dragStart(row("intro.tex"), { dataTransfer: data });
    expect(fireEvent.dragOver(tree(), { dataTransfer: data })).toBe(false);
    expect(tree()).toHaveClass("bg-primary/10");
    fireEvent.drop(tree(), { dataTransfer: data });

    expect(tree()).not.toHaveClass("bg-primary/10");
    await waitFor(() =>
      expect(renameCalls()).toEqual([
        expect.objectContaining({ from: "chapters/intro.tex", to: "intro.tex" }),
      ]),
    );
  });

  it("ignores drops that would not move anything", async () => {
    render(<FileTree />);
    fireEvent.click(row("chapters"));

    const folder = transfer();
    fireEvent.dragStart(row("chapters"), { dataTransfer: folder });
    fireEvent.drop(row("intro.tex"), { dataTransfer: folder });

    const same = transfer();
    fireEvent.dragStart(row("main.tex"), { dataTransfer: same });
    fireEvent.drop(row("notes.tex"), { dataTransfer: same });

    fireEvent.drop(row("chapters"), { dataTransfer: transfer() });
    fireEvent.drop(tree(), { dataTransfer: transfer() });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(renameCalls()).toEqual([]);
  });

  function osDrop(...dropped: File[]) {
    return {
      types: ["Files", "text/uri-list"],
      items: dropped.map((file) => ({ kind: "file", getAsFile: () => file, webkitGetAsEntry: () => null })),
      files: dropped,
      getData: () => "",
      dropEffect: "none",
    };
  }

  function writes() {
    return mocks.invoke.mock.calls
      .filter(([command]) => command === "write_project_bytes")
      .map(([, args]) => args as { relPath: string; dataBase64: string });
  }

  it("copies files dropped from the file manager into the folder under the pointer", async () => {
    render(<FileTree />);
    const data = osDrop(new File(["png"], "figure.png", { type: "image/png" }));

    expect(fireEvent.dragOver(row("chapters"), { dataTransfer: data })).toBe(false);
    expect(data.dropEffect).toBe("copy");
    expect(row("chapters")).toHaveClass("bg-primary/15");
    fireEvent.drop(row("chapters"), { dataTransfer: data });

    expect(row("chapters")).not.toHaveClass("bg-primary/15");
    await waitFor(() =>
      expect(writes()).toEqual([
        expect.objectContaining({ projectId: "project", relPath: "chapters/figure.png", dataBase64: "cG5n" }),
      ]),
    );
    await waitFor(() => expect(row("chapters")).toHaveAttribute("aria-expanded", "true"));
    expect(renameCalls()).toEqual([]);
  });

  it("copies files dropped on empty space into the project root without overwriting", async () => {
    render(<FileTree />);
    const data = osDrop(new File(["tex"], "main.tex"));

    expect(fireEvent.dragOver(tree(), { dataTransfer: data })).toBe(false);
    fireEvent.drop(tree(), { dataTransfer: data });

    await waitFor(() =>
      expect(writes()).toEqual([expect.objectContaining({ relPath: "main (2).tex" })]),
    );
  });

  function linkDrop() {
    return {
      types: ["text/uri-list", "text/html"],
      items: [
        { kind: "string", type: "text/uri-list" },
        { kind: "string", type: "text/html" },
      ],
      files: [],
      getData: () => "",
      dropEffect: "none",
    };
  }

  function imports() {
    return mocks.invoke.mock.calls
      .filter(([command]) => command === "import_paths_into_project")
      .map(([, args]) => args as { projectId: string; destDir: string; sourcePaths: string[] });
  }

  it("on Linux, imports the files a file manager dropped as links into the folder under the pointer", async () => {
    mocks.linux = true;
    backend({
      take_dropped_paths: ["/home/a/Pictures/figure.png", "/home/a/data"],
      import_paths_into_project: { paths: ["chapters/figure.png", "chapters/data"], generation: 1 },
    });
    render(<FileTree />);
    const data = linkDrop();

    expect(fireEvent.dragOver(row("chapters"), { dataTransfer: data })).toBe(false);
    expect(data.dropEffect).toBe("copy");
    expect(row("chapters")).toHaveClass("bg-primary/15");
    fireEvent.drop(row("chapters"), { dataTransfer: data });

    expect(row("chapters")).not.toHaveClass("bg-primary/15");
    await waitFor(() =>
      expect(imports()).toEqual([
        expect.objectContaining({
          projectId: "project",
          destDir: "chapters",
          sourcePaths: ["/home/a/Pictures/figure.png", "/home/a/data"],
        }),
      ]),
    );
    await waitFor(() => expect(row("chapters")).toHaveAttribute("aria-expanded", "true"));
    expect(writes()).toEqual([]);
    expect(renameCalls()).toEqual([]);
  });

  it("takes a drop that lands right after the pointer enters a row or the tree, before any dragover", async () => {
    mocks.linux = true;
    backend({
      take_dropped_paths: ["/home/a/Pictures/figure.png"],
      import_paths_into_project: { paths: ["figure.png"], generation: 1 },
    });
    render(<FileTree />);
    const links = linkDrop();

    expect(fireEvent.dragEnter(row("main.tex"), { dataTransfer: links })).toBe(false);
    expect(links.dropEffect).toBe("copy");
    fireEvent.drop(row("main.tex"), { dataTransfer: links });
    await waitFor(() =>
      expect(imports()).toEqual([expect.objectContaining({ destDir: "", sourcePaths: ["/home/a/Pictures/figure.png"] })]),
    );

    const data = osDrop(new File(["png"], "figure.png", { type: "image/png" }));
    expect(fireEvent.dragEnter(tree(), { dataTransfer: data })).toBe(false);
    expect(tree()).toHaveClass("bg-primary/10");
    fireEvent.drop(tree(), { dataTransfer: data });
    await waitFor(() => expect(writes()).toEqual([expect.objectContaining({ relPath: "figure.png" })]));
  });

  it("on Linux, imports nothing when the dropped links were not local files", async () => {
    mocks.linux = true;
    backend({ take_dropped_paths: [] });
    render(<FileTree />);
    const data = linkDrop();

    expect(fireEvent.dragOver(tree(), { dataTransfer: data })).toBe(false);
    fireEvent.drop(tree(), { dataTransfer: data });

    await waitFor(() =>
      expect(mocks.invoke.mock.calls.some(([command]) => command === "take_dropped_paths")).toBe(
        true,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(imports()).toEqual([]);
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("elsewhere, leaves a drag that only carries links alone", async () => {
    render(<FileTree />);
    const data = linkDrop();

    expect(fireEvent.dragOver(row("chapters"), { dataTransfer: data })).toBe(true);
    expect(fireEvent.dragOver(tree(), { dataTransfer: data })).toBe(true);
    fireEvent.drop(tree(), { dataTransfer: data });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.invoke.mock.calls.some(([command]) => command === "take_dropped_paths")).toBe(
      false,
    );
    expect(imports()).toEqual([]);
  });

  it("leaves text dragged in from another app alone instead of treating it as a move", async () => {
    render(<FileTree />);
    const text = {
      types: ["text/plain"],
      getData: (type: string) => (type === "text/plain" ? "main.tex" : ""),
      dropEffect: "none",
    };

    expect(fireEvent.dragOver(row("chapters"), { dataTransfer: text })).toBe(true);
    expect(fireEvent.dragOver(tree(), { dataTransfer: text })).toBe(true);
    fireEvent.drop(row("chapters"), { dataTransfer: text });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(renameCalls()).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it("ignores drags that carry no file path and clears the highlight when the drag leaves", () => {
    render(<FileTree />);
    const empty = transfer();

    expect(fireEvent.dragOver(row("chapters"), { dataTransfer: empty })).toBe(true);
    expect(fireEvent.dragOver(tree(), { dataTransfer: empty })).toBe(true);

    const data = transfer();
    fireEvent.dragStart(row("main.tex"), { dataTransfer: data });
    fireEvent.dragOver(tree(), { dataTransfer: data });
    expect(tree()).toHaveClass("bg-primary/10");
    const leave = (relatedTarget: Element) =>
      act(() => {
        tree().dispatchEvent(new MouseEvent("dragleave", { bubbles: true, relatedTarget }));
      });
    leave(row("notes.tex"));
    expect(tree()).toHaveClass("bg-primary/10");
    leave(document.body);
    expect(tree()).not.toHaveClass("bg-primary/10");

    fireEvent.dragOver(row("chapters"), { dataTransfer: data });
    expect(row("chapters")).toHaveClass("bg-primary/15");
    fireEvent.dragEnd(row("main.tex"), { dataTransfer: data });
    expect(row("chapters")).not.toHaveClass("bg-primary/15");
  });
});

describe("FileTree keyboard", () => {
  it("moves focus between rows with the arrow keys", () => {
    render(<FileTree />);
    const rows = screen.getAllByRole("treeitem");
    rows[0].focus();

    fireEvent.keyDown(rows[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1], { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows[0]);
  });

  it("expands a folder with ArrowRight and collapses it with ArrowLeft", () => {
    render(<FileTree />);
    const folder = row("chapters");

    fireEvent.keyDown(folder, { key: "ArrowLeft" });
    expect(folder).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(folder, { key: "ArrowRight" });
    expect(folder).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("intro.tex")).toBeInTheDocument();
    fireEvent.keyDown(folder, { key: "ArrowRight" });
    expect(folder).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(folder, { key: "ArrowLeft" });
    expect(folder).toHaveAttribute("aria-expanded", "false");
  });
});

describe("FileTree context menus", () => {
  it("serves every row from one tree menu that switches between row and empty-area actions", async () => {
    render(<FileTree />);
    expect(tree()).toHaveAttribute("data-state", "closed");
    for (const treeitem of screen.getAllByRole("treeitem")) {
      expect(treeitem).not.toHaveAttribute("data-state");
    }

    fireEvent.contextMenu(row("main.tex"));
    let menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: enCommon.actions.rename })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: files.importFolder })).not.toBeInTheDocument();
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    fireEvent.contextMenu(tree());
    menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: files.importFolder })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: enCommon.actions.rename })).not.toBeInTheDocument();
  });

  it.each([
    ["file", "the empty area", files.newFile, files.newEntry.filePlaceholder, "draft.tex"],
    ["dir", "the empty area", files.newFolder, files.newEntry.folderPlaceholder, "figures"],
    ["file", "a folder", files.newFile, files.newEntry.filePlaceholder, "chapters/draft.tex"],
    ["dir", "a folder", files.newFolder, files.newEntry.folderPlaceholder, "chapters/figures"],
  ] as const)("keeps a new %s field opened from the menu on %s until it is named", async (mode, target, action, placeholder, path) => {
    render(<FileTree />);

    fireEvent.contextMenu(target === "a folder" ? row("chapters") : tree());
    fireEvent.click(await screen.findByRole("menuitem", { name: action }));
    const input = await screen.findByPlaceholderText(placeholder);
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: path.split("/").pop() } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "create_file",
        expect.objectContaining({ path, isDir: mode === "dir" }),
      ),
    );
  });

  it("imports files or a folder into the root from the empty-area menu", async () => {
    render(<FileTree />);

    fireEvent.contextMenu(tree());
    fireEvent.click(await screen.findByRole("menuitem", { name: files.importFiles }));
    await waitFor(() => expect(mocks.pickOpenPath).toHaveBeenCalledTimes(1));
    expect(mocks.pickOpenPath.mock.calls[0][0]).toMatchObject({ multiple: true });

    fireEvent.contextMenu(tree());
    fireEvent.click(await screen.findByRole("menuitem", { name: files.importFolder }));
    await waitFor(() => expect(mocks.pickOpenPath).toHaveBeenCalledTimes(2));
    expect(mocks.pickOpenPath.mock.calls[1][0]).toMatchObject({ directory: true });
  });

  it("imports a picked file into a folder from its own menu and opens the folder", async () => {
    mocks.pickOpenPath.mockResolvedValue("/home/me/data.csv");
    backend({ import_paths_into_project: { imported: ["chapters/data.csv"], skipped: [], generation: 1 } });
    render(<FileTree />);
    expect(row("chapters")).toHaveAttribute("aria-expanded", "false");

    fireEvent.contextMenu(row("chapters"));
    fireEvent.click(await screen.findByRole("menuitem", { name: files.importFiles }));

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "import_paths_into_project",
        expect.objectContaining({ destDir: "chapters", sourcePaths: ["/home/me/data.csv"] }),
      ),
    );
    await waitFor(() => expect(row("chapters")).toHaveAttribute("aria-expanded", "true"));
  });

  it("imports a folder into a folder from its own menu", async () => {
    render(<FileTree />);

    fireEvent.contextMenu(row("chapters"));
    fireEvent.click(await screen.findByRole("menuitem", { name: files.importFolder }));

    await waitFor(() => expect(mocks.pickOpenPath).toHaveBeenCalledWith({ directory: true }));
  });

  it("imports a folder into the selected folder from the toolbar", async () => {
    render(<FileTree />);
    fireEvent.click(row("chapters"));

    fireEvent.pointerDown(screen.getByRole("button", { name: files.importAriaLabel }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: files.importFolder }));

    await waitFor(() => expect(mocks.pickOpenPath).toHaveBeenCalledTimes(1));
    expect(mocks.pickOpenPath.mock.calls[0][0]).toMatchObject({ directory: true });
  });
});
