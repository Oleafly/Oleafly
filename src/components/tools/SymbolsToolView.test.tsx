// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE, UNKNOWN_ENGINE } from "@/lib/document-engine";
import { useHomeViewStore } from "@/store/home-view";
import { useFilesStore } from "@/store/files";
import { ThemeProvider } from "@/lib/theme";
import researchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  getEditorView: vi.fn(),
  insertAtCursor: vi.fn(),
  isWysiwygActive: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  writeClipboard: vi.fn(),
  insertTypstSymbol: vi.fn(async () => {}),
}));

vi.mock("@/components/editor/typst-commands", () => ({
  insertTypstSymbol: mocks.insertTypstSymbol,
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
        circledast: { detail: "⊛", documentation: "Circled asterisk" },
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

  it("shows and inserts the Typst form in an open Typst file", async () => {
    useFilesStore.setState({
      projectId: "project",
      activePath: "main.typ",
      engine: { ...LATEX_ENGINE, typst_resolved: { version: "0.13.1", source: "bundled" } },
    });
    mocks.getEditorView.mockReturnValue({});
    corpus();
    renderSymbols();

    await screen.findByTestId("symbol-entry-alpha");
    expect(screen.getByTestId("symbols-typst")).toHaveTextContent("alpha");
    expect(screen.getByText("Insert the Typst code into the open Typst document.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("symbol-entry-circledast"));
    expect(screen.getByTestId("symbols-typst")).toHaveTextContent("⊛");
    fireEvent.click(screen.getByTestId("symbol-entry-alpha"));
    fireEvent.click(screen.getByRole("button", { name: "Insert in editor" }));

    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("Inserted alpha in the open editor."));
    expect(mocks.insertTypstSymbol).toHaveBeenCalledWith("\\alpha", "α");
    expect(mocks.insertAtCursor).not.toHaveBeenCalled();
    expect(useHomeViewStore.getState().page).toBe("library");
  });

  it("does not show a Typst form for LaTeX files", async () => {
    useFilesStore.setState({ projectId: "project", activePath: "main.tex", engine: LATEX_ENGINE });
    corpus();
    renderSymbols();
    await screen.findByTestId("symbol-entry-alpha");
    expect(screen.queryByTestId("symbols-typst")).not.toBeInTheDocument();
  });
});

describe("SymbolsToolView corpus and browsing", () => {
  const copy = researchTools.symbols;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function corpora(unimath: unknown, core: unknown, ok = true) {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok, json: async () => unimath } as Response)
      .mockResolvedValueOnce({ ok, json: async () => core } as Response);
  }

  it("merges the core commands, sorts them into categories and skips entries without a glyph", async () => {
    corpora(
      { leq: { detail: "≤" }, sum: { detail: "∑", documentation: "Sum" }, plain: { detail: "abc" }, nodetail: {} },
      {
        commands: [
          { name: "leq", detail: "≤" },
          { name: "oplus", detail: "⊕" },
          { name: "textbf", detail: "bold text" },
          { name: "pounds", detail: "£ (pound sign)" },
          { name: "nodetail" },
        ],
      },
    );
    renderSymbols();

    await screen.findByTestId("symbol-entry-leq");
    expect(screen.queryByTestId("symbol-entry-plain")).toBeNull();
    expect(screen.queryByTestId("symbol-entry-textbf")).toBeNull();
    expect(screen.getAllByRole("option")).toHaveLength(4);

    fireEvent.click(screen.getByTestId("symbols-category-relations"));
    expect(screen.getByTestId("symbol-entry-leq")).toBeInTheDocument();
    expect(screen.queryByTestId("symbol-entry-sum")).toBeNull();

    fireEvent.click(screen.getByTestId("symbols-category-operators"));
    expect(screen.getByTestId("symbol-entry-sum")).toBeInTheDocument();
    expect(screen.getByTestId("symbol-entry-oplus")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("symbols-category-miscellaneous"));
    fireEvent.click(screen.getByTestId("symbol-entry-pounds"));
    expect(screen.getByText("£ (pound sign)")).toBeInTheDocument();
  });

  it("treats unavailable corpus files as empty and reports no matches for a search", async () => {
    corpora({}, {}, false);
    renderSymbols();

    expect(await screen.findByText(copy.noMatches)).toBeInTheDocument();
    expect(screen.getByText(copy.chooseSymbol)).toBeInTheDocument();
  });

  it("searches by command, glyph and description", async () => {
    corpus();
    renderSymbols();
    await screen.findByTestId("symbol-entry-alpha");

    fireEvent.change(screen.getByRole("textbox", { name: copy.searchAria }), { target: { value: "→" } });
    expect(screen.getByTestId("symbol-entry-rightarrow")).toBeInTheDocument();
    expect(screen.queryByTestId("symbol-entry-alpha")).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: copy.searchAria }), { target: { value: "greek letter b" } });
    expect(screen.getByTestId("symbol-entry-beta")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: copy.searchAria }), { target: { value: "nothing like this" } });
    expect(screen.getByText(copy.noMatches)).toBeInTheDocument();
  });

  it("caps the visible list and asks for a narrower search", async () => {
    const many = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`sym${index}`, { detail: "★" }]));
    corpora(many, { commands: [] });
    renderSymbols();

    await screen.findByTestId("symbol-entry-sym0");
    expect(screen.getByText(copy.visibleLimit.replace("{{count}}", "180"))).toBeInTheDocument();
    expect(screen.queryByTestId("symbol-entry-sym199")).toBeNull();
  });

  it("moves the selection with all four arrow keys", async () => {
    const letters = Object.fromEntries(
      ["alpha", "beta", "gamma", "delta", "epsilon"].map((name, index) => [name, { detail: "αβγδε"[index] }]),
    );
    corpora(letters, { commands: [] });
    const realStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = realStyle(element);
      if ((element as HTMLElement).dataset?.testid !== "symbols-grid") return style;
      return { ...style, gridTemplateColumns: "1fr 1fr 1fr" } as CSSStyleDeclaration;
    });
    renderSymbols();

    const alpha = await screen.findByTestId("symbol-entry-alpha");
    fireEvent.keyDown(alpha, { key: "ArrowDown" });
    expect(screen.getByTestId("symbols-command")).toHaveTextContent("\\delta");

    fireEvent.keyDown(screen.getByTestId("symbol-entry-delta"), { key: "ArrowUp" });
    expect(screen.getByTestId("symbols-command")).toHaveTextContent("\\alpha");

    fireEvent.keyDown(screen.getByTestId("symbol-entry-alpha"), { key: "ArrowLeft" });
    expect(screen.getByTestId("symbols-command")).toHaveTextContent("\\alpha");

    fireEvent.keyDown(screen.getByTestId("symbol-entry-alpha"), { key: "Enter" });
    expect(screen.getByTestId("symbols-command")).toHaveTextContent("\\alpha");
  });

  it("reports a command that could not be copied", async () => {
    corpus();
    mocks.writeClipboard.mockRejectedValue(new Error("denied"));
    renderSymbols();
    await screen.findByTestId("symbol-entry-alpha");

    fireEvent.click(screen.getByRole("button", { name: copy.copyCommand }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(copy.copyFailed));
  });

  it("loads the reference again after a failed load", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"));
    renderSymbols();
    await screen.findByText(copy.loadFailed);

    corpus();
    fireEvent.click(screen.getByRole("button", { name: copy.tryAgain }));

    expect(await screen.findByTestId("symbol-entry-alpha")).toBeInTheDocument();
  });

  it("inserts into the visual editor and keeps a command that takes an argument as is", async () => {
    useFilesStore.setState({ projectId: "project", activePath: "main.tex", engine: LATEX_ENGINE });
    mocks.isWysiwygActive.mockReturnValue(true);
    corpora({}, { commands: [{ name: "mathbb{}", detail: "𝔸 (\"mathbb\" command)" }] });
    renderSymbols();

    await screen.findByTestId("symbol-entry-mathbb{}");
    expect(screen.getByText(copy.insertHint)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: copy.insertInEditor }));

    expect(mocks.insertAtCursor).toHaveBeenCalledWith("\\mathbb{}");
  });

  it("renders nothing on another home page", () => {
    useHomeViewStore.setState({ page: "library" });

    const { container } = renderSymbols();

    expect(container.querySelector("[data-testid='symbols-tool-view']")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
