// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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
});
