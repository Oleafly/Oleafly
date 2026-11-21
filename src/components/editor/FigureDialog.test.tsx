// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FileEntry } from "@oleafly/backend-port";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  insertFigureFromDialog: vi.fn(),
  insertFigurePlaceholder: vi.fn(),
  applyFigureEdit: vi.fn(),
  writeFigureGrid: vi.fn(async () => {}),
  pickOpenPath: vi.fn(),
  resolveVisualAssetUrl: vi.fn(async (path: string) => (path.endsWith(".png") ? `data:${path}` : null)),
  logError: vi.fn(),
  notifyError: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), errorUnique: vi.fn() },
  insertTemplate: vi.fn(),
  insertAtCursor: vi.fn(),
  replaceRange: vi.fn(),
}));

vi.mock("@/components/editor/cm/controller", () => ({
  insertTemplate: mocks.insertTemplate,
  insertAtCursor: mocks.insertAtCursor,
  replaceRange: mocks.replaceRange,
}));

vi.mock("@/components/editor/latex-commands", () => ({
  insertFigureFromDialog: mocks.insertFigureFromDialog,
  insertFigurePlaceholder: mocks.insertFigurePlaceholder,
}));
vi.mock("@/components/editor/figure-edit", () => ({
  applyFigureEdit: mocks.applyFigureEdit,
  writeFigureGrid: mocks.writeFigureGrid,
}));
vi.mock("@/lib/native-file-dialog", () => ({ pickOpenPath: mocks.pickOpenPath }));
vi.mock("@/components/editor/wysiwyg/asset-url", () => ({ resolveVisualAssetUrl: mocks.resolveVisualAssetUrl }));
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notifyError, toast: mocks.toast }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { type FigureGridSource, type FigureGridSpec, figureGridSource, readFigureGridMarker } from "@oleafly/latex/figure-grid";
import { useFilesStore } from "@/store/files";
import { useFigureDialogStore } from "@/store/figure-dialog";
import { FigureDialog, figureWidthValue, widthChoiceFor } from "./FigureDialog";
import { projectImagePaths } from "./figure-image-picker";
import { typstFigureAt } from "./typst-figure";

const TREE: FileEntry[] = [
  { path: "figures", is_dir: true },
  { path: "figures/plot.png", is_dir: false },
  { path: "figures/diagram.svg", is_dir: false },
  { path: "main.tex", is_dir: false },
];

function setProject(tree: FileEntry[], projectId: string | null = "p1", activePath = "main.tex"): void {
  useFilesStore.setState({
    projectId,
    mainDoc: "main.tex",
    activePath,
    tree,
    importPaths: vi.fn(async (destDir: string, sources: string[]) => {
      const added = sources.map((source) => {
        const name = source.split("/").pop() ?? "new.png";
        return { path: destDir ? `${destDir}/${name}` : name, is_dir: false };
      });
      useFilesStore.setState({ tree: [...useFilesStore.getState().tree, ...added] } as never);
    }),
  } as never);
}

function openDialog() {
  const view = render(<FigureDialog />);
  act(() => {
    useFigureDialogStore.getState().setOpen(true);
  });
  return view;
}

function openEditDialog(width: string | null) {
  const view = render(<FigureDialog />);
  act(() => {
    useFigureDialogStore.getState().openForEdit({
      from: 10,
      to: 60,
      path: "figures/plot.png",
      width,
    });
  });
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  setProject(TREE);
});

afterEach(() => {
  act(() => {
    useFigureDialogStore.getState().setOpen(false);
  });
});

describe("helpers", () => {
  it("lists image files sorted and maps width choices", () => {
    expect(projectImagePaths(TREE)).toEqual(["figures/diagram.svg", "figures/plot.png"]);
    expect(figureWidthValue({ width: "full", customWidth: "" })).toBe("\\linewidth");
    expect(figureWidthValue({ width: "custom", customWidth: " 6cm " })).toBe("6cm");
    expect(figureWidthValue({ width: "custom", customWidth: "" })).toBeNull();
    expect(figureWidthValue({ width: "half", customWidth: "" }, "typst")).toBe("50%");
    expect(figureWidthValue({ width: "full", customWidth: "" }, "typst")).toBe("100%");
    expect(widthChoiceFor("75%", "typst")).toEqual({ width: "threeQuarters", customWidth: "" });
    expect(widthChoiceFor("75%")).toEqual({ width: "custom", customWidth: "75%" });
  });
});

describe("FigureDialog", () => {
  it("inserts the selected project image with the chosen width, caption and label", async () => {
    openDialog();
    expect(screen.getByTestId("figure-dialog-insert")).toBeDisabled();
    const image = screen.getAllByTestId("figure-dialog-image").find((node) => node.dataset.path === "figures/plot.png");
    if (!image) throw new Error("plot.png is not listed");
    fireEvent.click(image);
    expect(image).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(screen.getByAltText("Preview of figures/plot.png")).toBeInTheDocument());
    expect((screen.getByTestId("figure-dialog-label") as HTMLInputElement).value).toBe("fig:plot");
    fireEvent.click(screen.getByTestId("figure-dialog-width-full"));
    fireEvent.change(screen.getByTestId("figure-dialog-caption"), { target: { value: "Growth" } });
    fireEvent.click(screen.getByTestId("figure-dialog-insert"));
    expect(mocks.insertFigureFromDialog).toHaveBeenCalledWith({
      path: "figures/plot.png",
      width: "\\linewidth",
      caption: "Growth",
      label: "fig:plot",
    });
    expect(useFigureDialogStore.getState().open).toBe(false);
  });

  it("omits caption and label when their switches are off and accepts a custom width", () => {
    openDialog();
    fireEvent.click(screen.getAllByTestId("figure-dialog-image")[0]);
    fireEvent.click(screen.getByLabelText("Add a caption"));
    fireEvent.click(screen.getByLabelText("Add a label"));
    fireEvent.click(screen.getByTestId("figure-dialog-width-custom"));
    fireEvent.change(screen.getByLabelText("Custom width"), { target: { value: "7cm" } });
    fireEvent.click(screen.getByTestId("figure-dialog-insert"));
    expect(mocks.insertFigureFromDialog).toHaveBeenCalledWith({
      path: "figures/diagram.svg",
      width: "7cm",
      caption: null,
      label: null,
    });
  });

  it("falls back to the placeholder snippet", () => {
    openDialog();
    fireEvent.click(screen.getByTestId("figure-dialog-placeholder"));
    expect(mocks.insertFigurePlaceholder).toHaveBeenCalledOnce();
    expect(mocks.insertFigureFromDialog).not.toHaveBeenCalled();
    expect(useFigureDialogStore.getState().open).toBe(false);
  });

  it("imports an image from disk into the figures folder and selects it", async () => {
    mocks.pickOpenPath.mockResolvedValue("/Users/me/Downloads/new.png");
    openDialog();
    fireEvent.click(screen.getByTestId("figure-dialog-import"));
    await waitFor(() => {
      const added = screen.getAllByTestId("figure-dialog-image").find((node) => node.dataset.path === "figures/new.png");
      expect(added).toHaveAttribute("aria-pressed", "true");
    });
    expect(useFilesStore.getState().importPaths).toHaveBeenCalledWith("figures", ["/Users/me/Downloads/new.png"]);
    expect((screen.getByTestId("figure-dialog-label") as HTMLInputElement).value).toBe("fig:new");
  });

  it("edits an existing image without touching its caption or label", () => {
    openEditDialog("\\linewidth");
    expect(screen.getByText("Edit image")).toBeInTheDocument();
    expect(screen.queryByTestId("figure-dialog-caption")).not.toBeInTheDocument();
    expect(screen.queryByTestId("figure-dialog-label")).not.toBeInTheDocument();
    expect(screen.queryByTestId("figure-dialog-placeholder")).not.toBeInTheDocument();
    expect(screen.getByTestId("figure-dialog-width-full")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("figure-dialog-width-half"));
    fireEvent.click(screen.getByTestId("figure-dialog-insert"));

    expect(mocks.applyFigureEdit).toHaveBeenCalledWith(
      { from: 10, to: 60, path: "figures/plot.png", width: "\\linewidth" },
      { path: "figures/plot.png", width: "0.5\\linewidth" },
    );
    expect(mocks.insertFigureFromDialog).not.toHaveBeenCalled();
    expect(useFigureDialogStore.getState().open).toBe(false);
  });

  it("offers a custom width when the image carries one the presets do not cover", () => {
    openEditDialog("7cm");
    expect(screen.getByTestId("figure-dialog-width-custom")).toHaveAttribute("aria-pressed", "true");
    expect((screen.getByLabelText("Custom width") as HTMLInputElement).value).toBe("7cm");
  });

  it("explains a failed import inline and only logs the cause", async () => {
    const failure = new Error("picker crashed");
    mocks.pickOpenPath.mockRejectedValue(failure);
    openDialog();
    fireEvent.click(screen.getByTestId("figure-dialog-import"));
    expect(await screen.findByRole("alert")).toHaveTextContent(en.figureDialog.importFailed);
    expect(mocks.logError).toHaveBeenCalledWith("import figure", failure);
    expect(mocks.notifyError).not.toHaveBeenCalled();
    for (const notify of Object.values(mocks.toast)) expect(notify).not.toHaveBeenCalled();
  });

  it("shows the empty state without images and keeps a cancelled picker quiet", async () => {
    setProject([{ path: "main.tex", is_dir: false }]);
    mocks.pickOpenPath.mockResolvedValue(null);
    openDialog();
    expect(screen.getByText("This project has no images yet. Import one from disk to get started.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("figure-dialog-import"));
    await waitFor(() => expect(mocks.pickOpenPath).toHaveBeenCalledOnce());
    expect(useFilesStore.getState().importPaths).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("writes a Typst figure with alt text and placement for a Typst file", () => {
    setProject(TREE, "p1", "chapters/one.typ");
    openDialog();
    expect(screen.getByTestId("figure-dialog-alt")).toBeInTheDocument();
    const image = screen.getAllByTestId("figure-dialog-image").find((node) => node.dataset.path === "figures/plot.png");
    if (!image) throw new Error("plot.png is not listed");
    fireEvent.click(image);
    fireEvent.click(screen.getByTestId("figure-dialog-width-threeQuarters"));
    fireEvent.change(screen.getByTestId("figure-dialog-caption"), { target: { value: "Growth" } });
    fireEvent.change(screen.getByTestId("figure-dialog-alt"), { target: { value: "Bar chart" } });
    fireEvent.click(screen.getByTestId("figure-dialog-placement-top"));
    fireEvent.click(screen.getByTestId("figure-dialog-insert"));
    const template = [
      "#figure(",
      '  image("../figures/plot.png", width: 75%, alt: "Bar chart"),',
      "  placement: top,",
      "  caption: [Growth],",
      ") <fig:plot>",
      "",
    ].join("\n");
    const start = template.indexOf("Growth");
    expect(mocks.insertTemplate).toHaveBeenCalledWith(template, start, start + "Growth".length);
    expect(mocks.insertFigureFromDialog).not.toHaveBeenCalled();
  });

  it("keeps the LaTeX dialog free of Typst options", () => {
    openDialog();
    expect(screen.queryByTestId("figure-dialog-alt")).not.toBeInTheDocument();
    expect(screen.queryByTestId("figure-dialog-placement-auto")).not.toBeInTheDocument();
  });

  it("inserts the Typst placeholder for a Typst file", () => {
    setProject(TREE, "p1", "main.typ");
    openDialog();
    fireEvent.click(screen.getByTestId("figure-dialog-placeholder"));
    expect(mocks.insertTemplate).toHaveBeenCalledWith(
      '#figure(\n  image("image-filename", width: 80%),\n  caption: [Caption text],\n) <fig:label>\n',
      18,
      32,
    );
    expect(mocks.insertFigurePlaceholder).not.toHaveBeenCalled();
  });

  it("prefills a Typst figure edit and writes the change back in place", () => {
    setProject(TREE, "p1", "main.typ");
    const source =
      'Intro\n#figure(\n  image("figures/plot.png", width: 50%, alt: "Old"),\n  placement: auto,\n  caption: [Old caption],\n) <fig:old>\n';
    const match = typstFigureAt(source, source.indexOf("width"));
    if (!match?.fields) throw new Error("figure not parsed");
    render(<FigureDialog />);
    act(() => {
      useFigureDialogStore.getState().openForEdit({
        from: match.from,
        to: match.to,
        path: match.fields?.path ?? "",
        width: match.fields?.width ?? null,
        typst: match.fields ?? undefined,
      });
    });
    expect(screen.getByText(en.figureDialog.editFigureTitle)).toBeInTheDocument();
    expect(screen.getByTestId("figure-dialog-width-half")).toHaveAttribute("aria-pressed", "true");
    expect((screen.getByTestId("figure-dialog-caption") as HTMLInputElement).value).toBe("Old caption");
    expect((screen.getByTestId("figure-dialog-label") as HTMLInputElement).value).toBe("fig:old");
    expect((screen.getByTestId("figure-dialog-alt") as HTMLInputElement).value).toBe("Old");
    expect(screen.getByTestId("figure-dialog-placement-auto")).toHaveAttribute("aria-pressed", "true");
    const selected = screen.getAllByTestId("figure-dialog-image").find((node) => node.dataset.path === "figures/plot.png");
    expect(selected).toHaveAttribute("aria-pressed", "true");

    fireEvent.change(screen.getByTestId("figure-dialog-caption"), { target: { value: "New caption" } });
    fireEvent.click(screen.getByTestId("figure-dialog-placement-none"));
    fireEvent.click(screen.getByTestId("figure-dialog-insert"));
    expect(mocks.replaceRange).toHaveBeenCalledWith(
      match.from,
      match.to,
      [
        "#figure(",
        '  image("figures/plot.png", width: 50%, alt: "Old"),',
        "  caption: [New caption],",
        ") <fig:old>",
      ].join("\n"),
    );
    expect(mocks.applyFigureEdit).not.toHaveBeenCalled();
  });

  it("rewrites the image path relative to the file when another image is chosen", () => {
    setProject(TREE, "p1", "chapters/one.typ");
    const source = '#figure(image("../figures/plot.png"), caption: [C])';
    const match = typstFigureAt(source, 5);
    if (!match?.fields) throw new Error("figure not parsed");
    render(<FigureDialog />);
    act(() => {
      useFigureDialogStore.getState().openForEdit({
        from: 0,
        to: source.length,
        path: match.fields?.path ?? "",
        width: null,
        typst: match.fields ?? undefined,
      });
    });
    const diagram = screen.getAllByTestId("figure-dialog-image").find((node) => node.dataset.path === "figures/diagram.svg");
    if (!diagram) throw new Error("diagram.svg is not listed");
    fireEvent.click(diagram);
    fireEvent.click(screen.getByTestId("figure-dialog-insert"));
    expect(mocks.replaceRange).toHaveBeenCalledWith(
      0,
      source.length,
      '#figure(\n  image("../figures/diagram.svg"),\n  caption: [C],\n)',
    );
  });
});

const GRID_TREE: FileEntry[] = [
  { path: "figures", is_dir: true },
  { path: "figures/a.png", is_dir: false },
  { path: "figures/b.png", is_dir: false },
  { path: "figures/c.png", is_dir: false },
  { path: "figures/d.png", is_dir: false },
  { path: "main.tex", is_dir: false },
];

function gridImage(path: string): HTMLElement {
  const image = screen.getAllByTestId("figure-grid-image").find((node) => node.dataset.path === path);
  if (!image) throw new Error(`${path} is not listed`);
  return image;
}

function insertedGrid(): { grid: FigureGridSource; target: unknown } {
  const call = mocks.writeFigureGrid.mock.lastCall as unknown as [FigureGridSource, unknown] | undefined;
  if (!call) throw new Error("no grid was written");
  return { grid: call[0], target: call[1] };
}

function setNaturalSize(image: HTMLImageElement, width: number, height: number) {
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(image, "naturalHeight", { configurable: true, value: height });
  fireEvent.load(image);
}

describe("FigureDialog grid", () => {
  beforeEach(() => {
    setProject(GRID_TREE);
  });

  it("keeps the single image view as the default tab", () => {
    openDialog();
    expect(screen.getByRole("tab", { name: en.figureDialog.tabSingle })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByTestId("figure-dialog-image")).toHaveLength(4);
    expect(screen.queryByTestId("figure-grid-image")).not.toBeInTheDocument();
  });

  it("builds a grid with columns, headers, row labels and a zoom box drawn on the first image", async () => {
    openDialog();
    fireEvent.mouseDown(screen.getByTestId("figure-grid-tab"), { button: 0 });
    expect(screen.queryByTestId("figure-dialog-image")).not.toBeInTheDocument();
    expect(screen.getByTestId("figure-grid-insert")).toBeDisabled();

    for (const path of ["figures/c.png", "figures/a.png", "figures/b.png", "figures/d.png"]) fireEvent.click(gridImage(path));
    fireEvent.click(gridImage("figures/b.png"));
    expect(gridImage("figures/b.png")).toHaveAttribute("aria-pressed", "false");
    expect(gridImage("figures/d.png")).toHaveTextContent("3");
    fireEvent.change(screen.getByTestId("figure-grid-columns"), { target: { value: "2" } });
    fireEvent.change(screen.getByTestId("figure-grid-column-label-0"), { target: { value: "(a) Input" } });
    fireEvent.change(screen.getByTestId("figure-grid-column-label-1"), { target: { value: "(b) Ours" } });
    fireEvent.change(screen.getByTestId("figure-grid-row-label-1"), { target: { value: "Night" } });
    fireEvent.click(screen.getByTestId("figure-grid-width-page"));
    expect((screen.getByTestId("figure-grid-label") as HTMLInputElement).value).toBe("fig:c");
    fireEvent.change(screen.getByTestId("figure-grid-caption"), { target: { value: "Close-ups." } });

    const cells = await waitFor(() => {
      const shown = screen.getAllByTestId("figure-grid-cell").map((cell) => cell.querySelector("img"));
      if (shown.length !== 3 || shown.some((image) => image === null)) throw new Error("the grid preview is not ready");
      return shown as HTMLImageElement[];
    });
    for (const image of cells) setNaturalSize(image, 400, 200);

    fireEvent.click(screen.getByTestId("figure-grid-zoom"));
    fireEvent.click(screen.getByTestId("figure-grid-zoom-below"));
    fireEvent.click(screen.getByTestId("figure-grid-zoom-color-blue"));
    const area = screen.getByTestId("figure-grid-zoom-area");
    const surface = await waitFor(() => {
      const image = area.querySelector("img");
      if (!image) throw new Error("the first image is not shown yet");
      return image;
    });
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 10, y: 20, width: 200, height: 100 }));
    fireEvent.pointerDown(area, { clientX: 130, clientY: 80, button: 0, pointerId: 1 });
    fireEvent.pointerMove(area, { clientX: 60, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(area, { clientX: 30, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(area, { clientX: 200, clientY: 110, pointerId: 1 });

    expect(screen.getByTestId("figure-grid-source").textContent).toContain(String.raw`\begin{tikzpicture}`);
    fireEvent.click(screen.getByTestId("figure-grid-insert"));

    const { grid, target } = insertedGrid();
    expect(target).toBeNull();
    expect(grid.packages).toEqual(["graphicx", "tikz"]);
    expect(grid.source.startsWith(String.raw`\begin{figure*}[t]`)).toBe(true);
    expect(readFigureGridMarker(grid.source)).toEqual({
      images: [
        [
          { path: "figures/c.png", aspect: 2 },
          { path: "figures/a.png", aspect: 2 },
        ],
        [{ path: "figures/d.png", aspect: 2 }],
      ],
      columnLabels: ["(a) Input", "(b) Ours"],
      rowLabels: ["", "Night"],
      zoom: { rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, placement: "below", color: "cyan!40!blue!85!black" },
      width: "page",
      caption: "Close-ups.",
      label: "fig:c",
    });
    expect(useFigureDialogStore.getState().open).toBe(false);
  });

  it("moves the zoom box with the arrow keys and keeps it inside the image", async () => {
    openDialog();
    fireEvent.mouseDown(screen.getByTestId("figure-grid-tab"), { button: 0 });
    fireEvent.click(gridImage("figures/a.png"));
    fireEvent.click(screen.getByTestId("figure-grid-zoom"));
    const area = screen.getByTestId("figure-grid-zoom-area");
    for (let step = 0; step < 30; step += 1) fireEvent.keyDown(area, { key: "ArrowRight" });
    fireEvent.keyDown(area, { key: "ArrowUp" });
    fireEvent.click(screen.getByTestId("figure-grid-insert"));
    expect(readFigureGridMarker(insertedGrid().grid.source)?.zoom?.rect).toEqual({ x: 0.7, y: 0.33, w: 0.3, h: 0.3 });
  });

  it("imports several images from disk at once and adds them to the grid", async () => {
    mocks.pickOpenPath.mockResolvedValue(["/Users/me/one.png", "/Users/me/two.png"]);
    openDialog();
    fireEvent.mouseDown(screen.getByTestId("figure-grid-tab"), { button: 0 });
    fireEvent.click(screen.getByTestId("figure-grid-import"));
    await waitFor(() => expect(gridImage("figures/two.png")).toHaveAttribute("aria-pressed", "true"));
    expect(mocks.pickOpenPath).toHaveBeenCalledWith(expect.objectContaining({ multiple: true }));
    expect(useFilesStore.getState().importPaths).toHaveBeenCalledWith("figures", ["/Users/me/one.png", "/Users/me/two.png"]);
    expect(gridImage("figures/one.png")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("figure-grid-insert"));
    const { grid } = insertedGrid();
    expect(grid.packages).toEqual(["graphicx"]);
    expect(grid.source).toContain(String.raw`\includegraphics[width=0.49\linewidth]{figures/one.png}`);
  });

  it("offers no grid tab for Typst files or when editing a single image", () => {
    setProject(GRID_TREE, "p1", "main.typ");
    openDialog();
    expect(screen.queryByTestId("figure-grid-tab")).not.toBeInTheDocument();
    act(() => {
      useFigureDialogStore.getState().setOpen(false);
    });
    setProject(GRID_TREE);
    openEditDialog(null);
    expect(screen.queryByTestId("figure-grid-tab")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("figure-dialog-image").length).toBeGreaterThan(0);
  });

  it("reopens a grid from its marker and replaces the whole environment on save", () => {
    const spec: FigureGridSpec = {
      images: [[{ path: "figures/a.png", aspect: 1.5 }, { path: "figures/b.png", aspect: 1.5 }]],
      columnLabels: ["Before", "After"],
      rowLabels: [""],
      zoom: { rect: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 }, placement: "right", color: "red!85!black" },
      width: "column",
      caption: "Old caption",
      label: "fig:old",
    };
    render(<FigureDialog />);
    act(() => {
      useFigureDialogStore.getState().openForEdit({ from: 7, to: 900, path: "figures/a.png", width: null, grid: spec });
    });
    expect(screen.getByText(en.figureDialog.gridEditTitle)).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(gridImage("figures/a.png")).toHaveAttribute("aria-pressed", "true");
    expect(gridImage("figures/b.png")).toHaveAttribute("aria-pressed", "true");
    expect((screen.getByTestId("figure-grid-columns") as HTMLInputElement).value).toBe("2");
    expect((screen.getByTestId("figure-grid-column-label-1") as HTMLInputElement).value).toBe("After");
    expect(screen.getByTestId("figure-grid-zoom")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("figure-grid-zoom-right")).toHaveAttribute("aria-pressed", "true");
    expect((screen.getByTestId("figure-grid-label") as HTMLInputElement).value).toBe("fig:old");

    fireEvent.change(screen.getByTestId("figure-grid-caption"), { target: { value: "New caption" } });
    fireEvent.click(screen.getByTestId("figure-grid-insert"));

    const { grid, target } = insertedGrid();
    expect(target).toEqual({ from: 7, to: 900 });
    expect(grid).toEqual(figureGridSource({ ...spec, caption: "New caption" }, (path) => path));
  });
});
