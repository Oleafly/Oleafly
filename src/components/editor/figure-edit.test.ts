import { EditorState } from "@codemirror/state";
import { beforeEach, describe, expect, it, vi } from "vitest";

const controller = vi.hoisted(() => ({
  getEditorView: vi.fn<() => { state: EditorState } | null>(() => null),
  replaceRange: vi.fn(),
  insertAtCursor: vi.fn(),
}));

vi.mock("@/components/editor/cm/controller", () => controller);

const packages = vi.hoisted(() => ({
  latexMainDocument: vi.fn<() => string | null>(() => "main.tex"),
  documentPackages: vi.fn(async () => new Set<string>()),
  insertUsepackages: vi.fn(async () => {}),
}));

vi.mock("@/components/packages/latex-document", () => packages);

const log = vi.hoisted(() => ({ logError: vi.fn(async () => {}) }));

vi.mock("@/lib/log", () => log);

import { type FigureGridSpec, figureGridSource } from "@oleafly/latex/figure-grid";
import { useFigureDialogStore } from "@/store/figure-dialog";
import {
  applyFigureEdit,
  formatIncludeGraphics,
  openFigureEditorAt,
  parseIncludeGraphics,
  writeFigureGrid,
} from "./figure-edit";

const DOC = String.raw`\begin{figure}
  \includegraphics[width=0.5\linewidth]{figures/plot.png}
\end{figure}`;

function viewWith(doc: string) {
  return { state: EditorState.create({ doc }) };
}

const GRID: FigureGridSpec = {
  images: [[{ path: "figures/a.png", aspect: 1 }, { path: "figures/b.png", aspect: 2 }]],
  columnLabels: ["Input", "Ours"],
  rowLabels: [""],
  zoom: { rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, placement: "right", color: "red" },
  width: "column",
  caption: "Grid",
  label: "fig:grid",
};

beforeEach(() => {
  vi.clearAllMocks();
  packages.latexMainDocument.mockReturnValue("main.tex");
  packages.documentPackages.mockResolvedValue(new Set());
  controller.getEditorView.mockReturnValue(null);
  useFigureDialogStore.setState({ open: false, edit: null });
});

describe("parseIncludeGraphics", () => {
  it("reads the path and the width option", () => {
    expect(parseIncludeGraphics(String.raw`\includegraphics[width=0.5\linewidth]{a.png}`)).toEqual({
      path: "a.png",
      width: String.raw`0.5\linewidth`,
    });
    expect(parseIncludeGraphics(String.raw`\includegraphics{a.png}`)).toEqual({
      path: "a.png",
      width: null,
    });
    expect(
      parseIncludeGraphics(String.raw`\includegraphics[scale=2,width=3cm,angle=90]{b}`),
    ).toEqual({ path: "b", width: "3cm" });
  });

  it("allows spaces around the option group", () => {
    expect(parseIncludeGraphics(String.raw`\includegraphics [width=1cm] {a.png}`)).toEqual({
      path: "a.png",
      width: "1cm",
    });
    expect(parseIncludeGraphics(String.raw`\includegraphics   {b.png}`)).toEqual({
      path: "b.png",
      width: null,
    });
  });

  it("returns nothing when the range holds no image", () => {
    expect(parseIncludeGraphics(String.raw`\caption{Plot}`)).toBeNull();
    expect(parseIncludeGraphics("")).toBeNull();
  });
});

describe("formatIncludeGraphics", () => {
  it("writes the width option only when there is one", () => {
    expect(formatIncludeGraphics({ path: "a.png", width: String.raw`\linewidth` })).toBe(
      String.raw`\includegraphics[width=\linewidth]{a.png}`,
    );
    expect(formatIncludeGraphics({ path: "a.png", width: null })).toBe(
      String.raw`\includegraphics{a.png}`,
    );
  });
});

describe("openFigureEditorAt", () => {
  it("opens the dialog on the image in the range", async () => {
    controller.getEditorView.mockReturnValue(viewWith(DOC));
    const from = DOC.indexOf("\\includegraphics");
    const to = DOC.indexOf("}", DOC.indexOf("{figures")) + 1;

    await openFigureEditorAt({ from, to });

    expect(useFigureDialogStore.getState()).toMatchObject({
      open: true,
      edit: { from, to, path: "figures/plot.png", width: String.raw`0.5\linewidth` },
    });
  });

  it("opens the whole grid when the image belongs to a figure grid", async () => {
    const { source } = figureGridSource(GRID, (path) => path);
    const doc = `${DOC}\n\n${source}\n\nAfter.`;
    controller.getEditorView.mockReturnValue(viewWith(doc));
    const from = doc.indexOf(String.raw`\includegraphics[width=0.`, doc.indexOf("figures/a.png") - 40);
    const start = doc.indexOf(String.raw`\begin{figure}[t]`);

    await openFigureEditorAt({ from, to: from + 20 });

    expect(useFigureDialogStore.getState()).toMatchObject({
      open: true,
      edit: { from: start, to: start + source.length, path: "figures/a.png", width: null, grid: GRID },
    });
  });

  it("stays closed without an editor or without an image", async () => {
    await openFigureEditorAt({ from: 0, to: 10 });
    expect(useFigureDialogStore.getState().open).toBe(false);

    controller.getEditorView.mockReturnValue(viewWith("Body text.\n"));
    await openFigureEditorAt({ from: 0, to: 10 });
    expect(useFigureDialogStore.getState().open).toBe(false);
  });
});

describe("applyFigureEdit", () => {
  it("replaces only the command it was opened on", () => {
    applyFigureEdit(
      { from: 4, to: 40, path: "old.png", width: null },
      { path: "new.png", width: "3cm" },
    );
    expect(controller.replaceRange).toHaveBeenCalledWith(
      4,
      40,
      String.raw`\includegraphics[width=3cm]{new.png}`,
    );
  });
});

describe("writeFigureGrid", () => {
  const grid = figureGridSource(GRID, (path) => path);

  it("inserts the grid at the cursor and adds only the packages the document lacks", async () => {
    packages.documentPackages.mockResolvedValue(new Set(["graphicx", "amsmath"]));
    await writeFigureGrid(grid, null);
    expect(controller.insertAtCursor).toHaveBeenCalledWith(`${grid.source}\n`);
    expect(controller.replaceRange).not.toHaveBeenCalled();
    expect(packages.documentPackages).toHaveBeenCalledWith("main.tex");
    expect(packages.insertUsepackages).toHaveBeenCalledWith("main.tex", [{ name: "tikz", options: "" }]);
  });

  it("replaces the grid it was opened on", async () => {
    await writeFigureGrid(grid, { from: 3, to: 90 });
    expect(controller.replaceRange).toHaveBeenCalledWith(3, 90, grid.source);
    expect(controller.insertAtCursor).not.toHaveBeenCalled();
    expect(packages.insertUsepackages).toHaveBeenCalledWith("main.tex", [
      { name: "graphicx", options: "" },
      { name: "tikz", options: "" },
    ]);
  });

  it("skips the preamble without a main document and logs a failed package write", async () => {
    packages.latexMainDocument.mockReturnValue(null);
    await writeFigureGrid(grid, null);
    expect(packages.insertUsepackages).not.toHaveBeenCalled();

    packages.latexMainDocument.mockReturnValue("main.tex");
    const failure = new Error("read failed");
    packages.documentPackages.mockRejectedValue(failure);
    await writeFigureGrid(grid, null);
    expect(log.logError).toHaveBeenCalledWith("add figure grid packages", failure);
  });
});
