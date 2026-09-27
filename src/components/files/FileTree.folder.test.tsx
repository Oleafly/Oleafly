// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  notifyError: vi.fn(),
  toastError: vi.fn(),
  logError: vi.fn(),
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
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/toast", () => ({
  notifyError: mocks.notifyError,
  toast: {
    info: vi.fn(),
    infoUnique: vi.fn(),
    success: vi.fn(),
    error: mocks.toastError,
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
import { i18n } from "@/i18n";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { formatNumber } from "@/lib/intl";
import { FOLDER_LISTING_LIMIT, useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { FileTree } from "./FileTree";

const files = enWorkspace.files;

const TREE = [
  { path: "locked", is_dir: true, unreadable: true },
  { path: "main.tex", is_dir: false },
  { path: "secret.tex", is_dir: false, unreadable: true },
];

beforeEach(async () => {
  await i18n.changeLanguage("en");
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "list_files") return TREE;
    if (command === "read_file") return "content";
    if (command === "project_mutation_generation") return 0;
    if (command === "project_engine") return LATEX_ENGINE;
    return undefined;
  });
  useSettingsStore.setState({ hiddenFilePatterns: [] });
  useFilesStore.setState({
    projectId: "linked-0123456789abcdef0123456789abcdef",
    tree: TREE,
    treeTruncated: false,
    files: {},
    openTabs: [],
    activePath: null,
    mainDoc: "main.tex",
    manifestHome: "device",
    engine: LATEX_ENGINE,
    engineLoaded: true,
  });
});

describe("FileTree in an opened folder", () => {
  it("shows an unreadable folder as a node that cannot be expanded", () => {
    render(<FileTree />);

    const row = screen.getByRole("treeitem", { name: /locked/ });
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row).not.toHaveAttribute("aria-expanded");
    expect(row).toHaveAttribute("title", files.unreadableHint);
    expect(within(row).getByText(files.unreadable)).toBeInTheDocument();
    expect(row.querySelector("svg.lucide-folder-lock")).toBeInTheDocument();

    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "ArrowRight" });
    expect(row).not.toHaveAttribute("aria-expanded");
  });

  it("never opens an unreadable file", () => {
    render(<FileTree />);

    const row = screen.getByRole("treeitem", { name: /secret\.tex/ });
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row.querySelector("svg.lucide-file-lock")).toBeInTheDocument();
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });

    expect(mocks.invoke.mock.calls.some(([command]) => command === "read_file")).toBe(false);
    expect(useFilesStore.getState().openTabs).toEqual([]);
  });

  it("offers only rename and delete for an unreadable entry", () => {
    render(<FileTree />);

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: /locked/ }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /rename/i })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /delete/i })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: files.newFile })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: files.makeCopy })).not.toBeInTheDocument();
  });

  it("says quietly that a large folder was not listed in full", () => {
    useFilesStore.setState({ treeTruncated: true });
    render(<FileTree />);

    expect(
      screen.getByText(
        i18n.t(($) => $.workspace.files.listingStopped, {
          limit: formatNumber(FOLDER_LISTING_LIMIT),
        }),
      ),
    ).toBeInTheDocument();
  });

  it("says inside a folder that the listing stopped before all of its items", () => {
    useFilesStore.setState({
      tree: [
        { path: "data", is_dir: true, partial: true },
        { path: "data/run-001.csv", is_dir: false },
        { path: "main.tex", is_dir: false },
      ],
      treeTruncated: true,
    });
    render(<FileTree />);

    const row = screen.getByRole("treeitem", { name: /^data/ });
    expect(row).toHaveAttribute("title", files.partialFolder);
    fireEvent.click(row);

    const group = row.parentElement?.querySelector('[role="group"]') as HTMLElement;
    expect(within(group).getByText(files.partialFolder)).toBeInTheDocument();
    expect(within(group).getAllByRole("treeitem")).toHaveLength(1);
  });

  it("shows no notice when the whole folder was listed", () => {
    render(<FileTree />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  function deleteFromMenu(name: string) {
    fireEvent.click(
      screen.getByRole("button", { name: files.moreActions.replace("{{name}}", name) }),
    );
    fireEvent.click(screen.getByText(enCommon.actions.delete));
  }

  function deleteCalls() {
    return mocks.invoke.mock.calls
      .filter(([command]) => command === "delete_file")
      .map(([, args]) => args as { path: string; permanent?: boolean });
  }

  it("moves a deleted file to the Trash after asking", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<FileTree />);

    deleteFromMenu("main.tex");

    expect(confirm).toHaveBeenCalledWith(files.confirmTrash.replace("{{path}}", "main.tex"));
    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(deleteCalls()[0]).toMatchObject({ path: "main.tex" });
    expect(deleteCalls()[0].permanent).toBeUndefined();
    expect(mocks.notifyError).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("asks again before deleting for good when the drive has no Trash", async () => {
    const unavailable = `@oleafly/error:${JSON.stringify({
      code: "project.trash_unavailable",
      params: { path: "main.tex" },
      detail: "no trash",
    })}`;
    mocks.invoke.mockImplementation(async (command: string, args?: { permanent?: boolean }) => {
      if (command === "list_files") return TREE;
      if (command === "project_mutation_generation") return 0;
      if (command === "delete_file" && !args?.permanent) throw unavailable;
      return undefined;
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<FileTree />);

    deleteFromMenu("main.tex");

    await waitFor(() => expect(deleteCalls()).toHaveLength(2));
    expect(confirm).toHaveBeenLastCalledWith(
      files.confirmPermanentDelete.replace("{{path}}", "main.tex"),
    );
    expect(deleteCalls()[1]).toMatchObject({ path: "main.tex", permanent: true });
    expect(mocks.notifyError).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("keeps the file when the permanent delete is declined", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "list_files") return TREE;
      if (command === "project_mutation_generation") return 0;
      if (command === "delete_file") {
        throw `@oleafly/error:${JSON.stringify({ code: "project.trash_unavailable", params: {} })}`;
      }
      return undefined;
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(true).mockReturnValue(false);
    render(<FileTree />);

    deleteFromMenu("main.tex");

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    expect(deleteCalls()).toHaveLength(1);
    expect(mocks.notifyError).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("never offers to replace a folder in an opened folder", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "list_files") return TREE;
      if (command === "project_mutation_generation") return 0;
      if (command === "rename_file") {
        return { status: "conflict", destination: "open", suggested_destination: "open (2)", generation: 0 };
      }
      return undefined;
    });
    useFilesStore.setState({
      tree: [
        { path: "draft", is_dir: true },
        { path: "open", is_dir: true },
        { path: "main.tex", is_dir: false },
      ],
    });
    render(<FileTree />);

    const row = screen.getByRole("treeitem", { name: /draft/ });
    fireEvent.contextMenu(row);
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: /rename/i }));
    const input = screen.getByRole("textbox", { name: files.renameAriaLabel });
    fireEvent.change(input, { target: { value: "open" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: files.conflict.keepBoth })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: files.conflict.replace })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/is an existing folder/)).toBeInTheDocument();
    expect(within(dialog).getByText("open (2)")).toBeInTheDocument();
  });

  it("offers to replace a file that already has the new name", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "list_files") return TREE;
      if (command === "project_mutation_generation") return 0;
      if (command === "rename_file") {
        return {
          status: "conflict",
          destination: "notes.tex",
          suggested_destination: "notes (2).tex",
          generation: 0,
        };
      }
      return undefined;
    });
    useFilesStore.setState({
      tree: [
        { path: "draft.tex", is_dir: false },
        { path: "notes.tex", is_dir: false },
        { path: "main.tex", is_dir: false },
      ],
    });
    render(<FileTree />);

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: /draft\.tex/ }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: /rename/i }));
    const input = screen.getByRole("textbox", { name: files.renameAriaLabel });
    fireEvent.change(input, { target: { value: "notes.tex" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/or replace the existing destination/)).toBeInTheDocument();
    expect(within(dialog).getByText("notes (2).tex")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: files.conflict.replace })).toBeInTheDocument();
  });

  it("draws folders with a chevron that turns open and stars the main document", () => {
    useFilesStore.setState({
      tree: [
        { path: "chapters", is_dir: true },
        { path: "chapters/intro.tex", is_dir: false },
        { path: "main.tex", is_dir: false },
      ],
    });
    render(<FileTree />);

    const folder = screen.getByRole("treeitem", { name: /chapters/ });
    expect(folder).toHaveAttribute("aria-expanded", "false");
    expect(folder.querySelector("svg.lucide-folder")).toBeInTheDocument();
    expect(folder.querySelector("svg.lucide-folder-open")).not.toBeInTheDocument();
    expect(folder.querySelector("svg.lucide-chevron-right")).not.toHaveClass("rotate-90");
    expect(folder.querySelector("svg.lucide-star")).not.toBeInTheDocument();

    const main = screen.getByRole("treeitem", { name: /main\.tex/ });
    expect(main.querySelector("svg.lucide-star")).toBeInTheDocument();
    expect(main.querySelector("svg.lucide-chevron-right")).not.toBeInTheDocument();

    fireEvent.click(folder);
    expect(folder).toHaveAttribute("aria-expanded", "true");
    expect(folder.querySelector("svg.lucide-folder-open")).toBeInTheDocument();
    expect(folder.querySelector("svg.lucide-chevron-right")).toHaveClass("rotate-90");
    const intro = screen.getByRole("treeitem", { name: /intro\.tex/ });
    expect(intro.querySelector("svg.lucide-star")).not.toBeInTheDocument();
    expect(intro.querySelector("svg.lucide-folder")).not.toBeInTheDocument();
  });

  it("marks a linked bibliography as read-only and offers only Open", () => {
    useFilesStore.setState({
      tree: [
        { path: "main.tex", is_dir: false },
        { path: "refs.bib", is_dir: false, read_only: true },
      ],
    });
    render(<FileTree />);

    const row = screen.getByRole("treeitem", { name: /refs\.bib/ });
    expect(row).toHaveAttribute("title", files.linkedReadOnly);
    expect(row).toHaveAttribute("draggable", "false");
    expect(row.querySelector("svg.lucide-link-2")).toBeInTheDocument();
    fireEvent.contextMenu(row);
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: enCommon.actions.open })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: /rename/i })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: /delete/i })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: files.makeCopy })).not.toBeInTheDocument();
  });
});
