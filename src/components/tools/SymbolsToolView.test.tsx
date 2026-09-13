// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE, UNKNOWN_ENGINE } from "@/lib/document-engine";
import { useHomeViewStore } from "@/store/home-view";
import { useFilesStore } from "@/store/files";
import { ThemeProvider } from "@/lib/theme";

const mocks = vi.hoisted(() => ({
  getEditorView: vi.fn(),
  insertAtCursor: vi.fn(),
  isWysiwygActive: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  writeClipboard: vi.fn(),
}));

vi.mock("@/components/editor/cm/controller", () => ({
  getEditorView: mocks.getEditorView,
  insertAtCursor: mocks.insertAtCursor,
}));
vi.mock("@/components/editor/wysiwyg/controller", () => ({
  isWysiwygActive: mocks.isWysiwygActive,
}));
vi.mock("@/lib/toast", () => ({
  toast: { error: mocks.toastError, info: mocks.toastInfo, success: mocks.toastSuccess },
}));

import { SymbolsToolView } from "./SymbolsToolView";

function renderSymbols() {
  return render(<ThemeProvider><SymbolsToolView /></ThemeProvider>);
}

function corpus() {
  vi.mocked(fetch)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        alpha: { detail: "α", documentation: "Greek letter alpha" },
        beta: { detail: "β", documentation: "Greek letter beta" },
        rightarrow: { detail: "→", documentation: "Right arrow" },
      }),
    } as Response)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ commands: [] }) } as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
  useHomeViewStore.setState({ page: "symbols" });
  useFilesStore.setState({ projectId: null, activePath: null, engine: UNKNOWN_ENGINE });
  vi.stubGlobal("fetch", vi.fn());
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.writeClipboard.mockResolvedValue(undefined) },
  });
  mocks.getEditorView.mockReturnValue(null);
  mocks.isWysiwygActive.mockReturnValue(false);
});

describe("SymbolsToolView", () => {
  it("loads a compact browser, filters by category, and updates the selected preview", async () => {
    corpus();
    renderSymbols();

    expect(await screen.findByTestId("symbol-entry-alpha")).toBeInTheDocument();
    expect(screen.getByTestId("symbols-command")).toHaveTextContent("\\alpha");

    fireEvent.click(screen.getByTestId("symbols-category-arrows"));
    expect(screen.getByTestId("symbol-entry-rightarrow")).toBeInTheDocument();
    expect(screen.queryByTestId("symbol-entry-alpha")).not.toBeInTheDocument();
    expect(screen.getByTestId("symbols-command")).toHaveTextContent("\\rightarrow");
  });

  it("keeps selection keyboard-accessible and copies the selected command explicitly", async () => {
    corpus();
    renderSymbols();

    const alpha = await screen.findByTestId("symbol-entry-alpha");
    alpha.focus();
    fireEvent.keyDown(alpha, { key: "ArrowRight" });
    expect(screen.getByTestId("symbols-command")).toHaveTextContent("\\beta");

    fireEvent.click(screen.getByRole("button", { name: "Copy command" }));
    await waitFor(() => expect(mocks.writeClipboard).toHaveBeenCalledWith("\\beta"));
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Command copied.");
  });

  it("keeps insertion unavailable until a LaTeX source editor is open", async () => {
    corpus();
    renderSymbols();

    await screen.findByTestId("symbol-entry-alpha");
    const insert = screen.getByRole("button", { name: "Insert in editor" });
    expect(insert).toBeDisabled();
    expect(screen.getByText("Copy the command into your LaTeX document.")).toBeInTheDocument();
    fireEvent.click(insert);

    expect(mocks.insertAtCursor).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalledWith(expect.stringContaining("Inserted"));
  });

  it("inserts into the verified LaTeX editor and returns to the project", async () => {
    useFilesStore.setState({ projectId: "project", activePath: "main.tex", engine: LATEX_ENGINE });
    mocks.getEditorView.mockReturnValue({});
    corpus();
    renderSymbols();

    await screen.findByTestId("symbol-entry-alpha");
    const insert = screen.getByRole("button", { name: "Insert in editor" });
    expect(insert).toBeEnabled();
    fireEvent.click(insert);

    expect(mocks.insertAtCursor).toHaveBeenCalledWith("\\alpha ");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Inserted \\alpha in the open editor.");
    expect(useHomeViewStore.getState().page).toBe("library");
  });

  it("shows a retry action when both corpora fail to load", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("missing corpus")).mockRejectedValueOnce(new Error("missing corpus"));
    renderSymbols();

    expect(await screen.findByText("The symbol reference could not load.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
