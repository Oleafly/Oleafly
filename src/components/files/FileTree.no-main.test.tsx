// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  toastError: vi.fn(),
  recompile: vi.fn(),
  resetCompile: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, isTauri: () => false }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setFocus: vi.fn() }),
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/toast", () => ({
  notifyError: vi.fn(),
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
vi.mock("@/store/compile", () => ({
  useCompileStore: {
    getState: () => ({ status: "idle", recompile: mocks.recompile, reset: mocks.resetCompile }),
  },
}));

import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import enWorkspace from "@/i18n/locales/en/workspace.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import { mainDocumentMissing } from "@/lib/main-document";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { FileTree } from "./FileTree";

const files = enWorkspace.files;
const TYPST_ENGINE = {
  ...LATEX_ENGINE,
  id: "typst",
  label: "Typst",
  source_format: "typst",
  source_extensions: ["typ"],
};

const TREE = [
  { path: "notes", is_dir: true },
  { path: "notes/draft.md", is_dir: false },
  { path: "poster.typ", is_dir: false },
  { path: "refs.bib", is_dir: false },
];

function backend() {
  mocks.invoke.mockReset().mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "set_main_doc") return { main_doc: args?.mainDoc, engine: "typst" };
    if (command === "project_engine") return TYPST_ENGINE;
    if (command === "read_file") return "= Poster";
    if (command === "project_mutation_generation") return 0;
    return undefined;
  });
}

function openRowMenu(name: string) {
  fireEvent.click(screen.getByRole("button", { name: files.moreActions.replace("{{name}}", name) }));
}

function openFolder(overrides: Record<string, unknown> = {}) {
  useFilesStore.setState({
    projectId: "linked-a",
    manifestHome: "device",
    tree: TREE,
    files: {},
    openTabs: [],
    activePath: null,
    mainDoc: "main.tex",
    engine: LATEX_ENGINE,
    engineLoaded: true,
    ...overrides,
  });
}

beforeEach(() => {
  backend();
  mocks.toastError.mockReset();
  mocks.recompile.mockReset();
  mocks.resetCompile.mockReset();
  useSettingsStore.setState({ hiddenFilePatterns: [] });
  openFolder();
});

describe("an opened folder without a main document", () => {
  it("says how to pick one above the files", () => {
    render(<FileTree />);
    const hint = screen.getByTestId("no-main-document");
    expect(hint).toHaveTextContent(enShell.openedFolder.noMain);
    expect(screen.getByRole("tree")).toBeInTheDocument();
  });

  it("offers every document family, whatever the current engine", async () => {
    render(<FileTree />);
    openRowMenu("poster.typ");
    const typst = await screen.findByRole("menu");
    expect(within(typst).getByText(files.setMain)).not.toHaveAttribute("data-disabled");
    fireEvent.keyDown(typst, { key: "Escape" });

    fireEvent.click(screen.getByText("notes"));
    openRowMenu("draft.md");
    expect(within(await screen.findByRole("menu")).getByText(files.setMain)).not.toHaveAttribute(
      "data-disabled",
    );
  });

  it("still refuses files that are not documents", async () => {
    render(<FileTree />);
    openRowMenu("refs.bib");
    expect(within(await screen.findByRole("menu")).getByText(files.setMain)).toHaveAttribute(
      "data-disabled",
    );
  });

  it("makes the chosen file the main document, opens it and compiles", async () => {
    render(<FileTree />);
    openRowMenu("poster.typ");
    fireEvent.click(within(await screen.findByRole("menu")).getByText(files.setMain));
    await waitFor(() => expect(useFilesStore.getState().mainDoc).toBe("poster.typ"));
    expect(mocks.invoke).toHaveBeenCalledWith("set_main_doc", {
      projectId: "linked-a",
      mainDoc: "poster.typ",
    });
    await waitFor(() => expect(useFilesStore.getState().activePath).toBe("poster.typ"));
    await waitFor(() => expect(mocks.recompile).toHaveBeenCalledWith({ origin: "automatic" }));
    expect(mainDocumentMissing(useFilesStore.getState())).toBe(false);
    expect(screen.queryByTestId("no-main-document")).not.toBeInTheDocument();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("keeps the current engine filter once the folder has a main document", async () => {
    openFolder({ mainDoc: "poster.typ", engine: TYPST_ENGINE });
    render(<FileTree />);
    expect(screen.queryByTestId("no-main-document")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("notes"));
    openRowMenu("draft.md");
    expect(within(await screen.findByRole("menu")).getByText(files.setMain)).toHaveAttribute(
      "data-disabled",
    );
  });

  it("shows nothing extra for a library project", () => {
    openFolder({ projectId: "paper", manifestHome: "library" });
    render(<FileTree />);
    expect(screen.queryByTestId("no-main-document")).not.toBeInTheDocument();
  });
});
