import { buildStandaloneDoc } from "@oleafly/latex";
import { describe, expect, it, vi } from "vitest";
import { createFigureTools, type AiToolsHost, type ConfirmFn, type FigurePreview } from "./tools";

const TIKZ = String.raw`\draw (0,0) -- (1,1);`;
const WRAPPED = String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,1);
\end{tikzpicture}`;
const PDF_BYTES = [37, 80, 68, 70];

function makeHost(overrides: Partial<AiToolsHost> = {}) {
  let preview: FigurePreview | null = null;
  const host = {
    getProjectId: vi.fn(() => "proj"),
    compileIsolated: vi.fn(async () => ({ ok: true, errors: [], has_pdf: true, log: "ok" })),
    readIsolatedPdf: vi.fn(async () => new Uint8Array(PDF_BYTES).buffer),
    pdfToPng: vi.fn(async () => "data:image/png;base64,RENDER"),
    setLastFigurePreview: vi.fn((value: FigurePreview | null) => {
      preview = value;
    }),
    getLastFigurePreview: vi.fn(() => preview),
    getFigureInsertTarget: vi.fn(() => null),
    prepareExternalMutation: vi.fn(async () => 9),
    insertAtCursor: vi.fn(async () => true),
    replaceRange: vi.fn(async () => true),
    writeProjectBytes: vi.fn(async () => ({})),
    refreshTree: vi.fn(async () => {}),
    readFileContent: vi.fn(async () => ""),
    readProjectBytes: vi.fn(async () => new Uint8Array()),
    ...overrides,
  } as unknown as AiToolsHost;
  return host;
}

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function gif(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(10);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  const view = new DataView(bytes.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return bytes;
}

function jpeg(width: number, height: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const padding = [0x00];
  const sof0 = [
    0xff, 0xc0, 0x00, 0x11, 0x08,
    height >> 8, height & 0xff, width >> 8, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ];
  return new Uint8Array([0xff, 0xd8, ...app0, ...padding, ...sof0, 0xff, 0xd9]);
}

describe("preview_figure in a LaTeX project", () => {
  it("compiles the figure alone, keeps the PDF preview and hands the image to the model", async () => {
    const onImage = vi.fn();
    const host = makeHost();
    const result = await createFigureTools(host, { onImage }).preview_figure.execute({
      code: TIKZ,
      packages: ["pgfplots"],
      libraries: ["arrows.meta"],
    });
    expect(host.compileIsolated).toHaveBeenCalledWith(
      "proj",
      buildStandaloneDoc({ code: TIKZ, packages: ["pgfplots"], libraries: ["arrows.meta"] }),
    );
    expect(host.setLastFigurePreview).toHaveBeenCalledWith({ pdfBytes: new Uint8Array(PDF_BYTES) });
    expect(host.pdfToPng).toHaveBeenCalledWith(new Uint8Array(PDF_BYTES), 1, 2);
    expect(onImage).toHaveBeenCalledWith("data:image/png;base64,RENDER");
    expect(result).toEqual({ success: true, errors: [], has_pdf: true, log_tail: "ok" });
  });

  it("still reports success when the preview image cannot be rendered", async () => {
    const onImage = vi.fn();
    const host = makeHost({
      pdfToPng: vi.fn(async () => {
        throw new Error("canvas lost");
      }),
    });
    expect(await createFigureTools(host, { onImage }).preview_figure.execute({ code: TIKZ })).toMatchObject({
      success: true,
      has_pdf: true,
    });
    expect(onImage).not.toHaveBeenCalled();
  });

  it("clears the stale preview and returns the errors when nothing compiled", async () => {
    const host = makeHost({
      compileIsolated: vi.fn(async () => ({
        ok: false,
        errors: [{ message: "Undefined control sequence" }],
        has_pdf: false,
        log: null,
      })),
    });
    const result = await createFigureTools(host).preview_figure.execute({ code: TIKZ });
    expect(host.readIsolatedPdf).not.toHaveBeenCalled();
    expect(host.setLastFigurePreview).toHaveBeenCalledWith(null);
    expect(result).toEqual({
      success: false,
      errors: [{ message: "Undefined control sequence" }],
      has_pdf: false,
      log_tail: "",
    });
  });

  it("keeps only the last 4,000 characters of the log", async () => {
    const host = makeHost({
      compileIsolated: vi.fn(async () => ({ ok: true, errors: [], has_pdf: false, log: `${"l".repeat(5000)}#` })),
    });
    const result = (await createFigureTools(host).preview_figure.execute({ code: TIKZ })) as { log_tail: string };
    expect(result.log_tail).toHaveLength(4000);
    expect(result.log_tail.endsWith("#")).toBe(true);
  });

  it("returns a failed compile as an error and needs an open project", async () => {
    const failing = makeHost({
      compileIsolated: vi.fn(async () => {
        throw new Error("tectonic missing");
      }),
    });
    expect(await createFigureTools(failing).preview_figure.execute({ code: TIKZ })).toEqual({
      error: "Error: tectonic missing",
    });
    const closed = makeHost({ getProjectId: vi.fn(() => null) });
    expect(await createFigureTools(closed).preview_figure.execute({ code: TIKZ })).toEqual({
      error: "No project open",
    });
    expect(closed.compileIsolated).not.toHaveBeenCalled();
  });
});

describe("preview_figure in a Typst project", () => {
  it("explains when the app cannot render Typst figures", async () => {
    const host = makeHost({ getFigureEngine: vi.fn(() => "typst" as const) });
    expect(await createFigureTools(host).preview_figure.execute({ code: "#box[]" })).toEqual({
      error: "Typst figure previews are not available in this app.",
    });
  });

  it("returns a renderer failure as an error", async () => {
    const host = makeHost({
      getFigureEngine: vi.fn(() => "typst" as const),
      renderTypstFigure: vi.fn(async () => {
        throw new Error("typst crashed");
      }),
    });
    expect(await createFigureTools(host).preview_figure.execute({ code: "#box[]" })).toEqual({
      error: "Error: typst crashed",
    });
  });
});

describe("insert_figure in a LaTeX project", () => {
  it("wraps the code in a figure with its caption and label and saves the rendered PNG", async () => {
    const confirm = vi.fn<ConfirmFn>(async () => true);
    const host = makeHost({ insertTargetPath: vi.fn(() => "main.tex") });
    const tools = createFigureTools(host, { confirm });
    await tools.preview_figure.execute({ code: TIKZ });

    const result = await tools.insert_figure.execute({ code: TIKZ, caption: "Growth", label: "fig:growth" });

    expect(confirm).toHaveBeenCalledWith({
      tool: "insert_figure",
      summary: "Insert this figure into the document",
      image: "data:image/png;base64,RENDER",
    });
    expect(host.insertAtCursor).toHaveBeenCalledWith(
      "proj",
      `\\begin{figure}[htbp]\n\\centering\n${WRAPPED}\n\\caption{Growth}\n\\label{fig:growth}\n\\end{figure}`,
      expect.any(Function),
    );
    expect(host.writeProjectBytes).toHaveBeenCalledWith("proj", "figures/growth.png", "RENDER", 9);
    expect(host.refreshTree).toHaveBeenCalledWith("proj");
    expect(result).toEqual({ success: true, path: "main.tex", figure: "figures/growth.png" });
  });

  it("inserts the bare code with raw and replaces the selected paragraph it came from", async () => {
    const host = makeHost({ getFigureInsertTarget: vi.fn(() => ({ from: 10, to: 42 })) });
    const result = await createFigureTools(host).insert_figure.execute({ code: TIKZ, raw: true });
    expect(host.replaceRange).toHaveBeenCalledWith("proj", 10, 42, WRAPPED, expect.any(Function));
    expect(host.insertAtCursor).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it("names the saved PNG after the label when there is no caption", async () => {
    const host = makeHost({
      getLastFigurePreview: vi.fn(() => ({ pngDataUrl: "data:image/png;base64,TYPST" })),
    });
    const result = await createFigureTools(host).insert_figure.execute({ code: TIKZ, label: "fig:Flow Chart" });
    expect(host.pdfToPng).not.toHaveBeenCalled();
    expect(host.writeProjectBytes).toHaveBeenCalledWith("proj", "figures/fig-flow-chart.png", "TYPST", 9);
    expect(result).toEqual({ success: true, figure: "figures/fig-flow-chart.png" });
  });

  it("saves a bare base64 preview under the default figure name", async () => {
    const host = makeHost({ getLastFigurePreview: vi.fn(() => ({ pngDataUrl: "QUJD" })) });
    const result = await createFigureTools(host).insert_figure.execute({ code: TIKZ });
    expect(host.writeProjectBytes).toHaveBeenCalledWith("proj", "figures/figure.png", "QUJD", 9);
    expect(result).toEqual({ success: true, figure: "figures/figure.png" });
  });

  it("asks without an image and saves no PNG when the preview cannot be rendered", async () => {
    const confirm = vi.fn<ConfirmFn>(async () => true);
    const host = makeHost({
      getLastFigurePreview: vi.fn(() => ({ pdfBytes: new Uint8Array(PDF_BYTES) })),
      pdfToPng: vi.fn(async () => {
        throw new Error("canvas lost");
      }),
    });
    const result = await createFigureTools(host, { confirm }).insert_figure.execute({ code: TIKZ });
    expect(confirm).toHaveBeenCalledWith({ tool: "insert_figure", summary: "Insert this figure into the document" });
    expect(host.writeProjectBytes).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it("leaves the document alone when declined", async () => {
    const host = makeHost();
    const result = await createFigureTools(host, { confirm: async () => false }).insert_figure.execute({ code: TIKZ });
    expect(result).toMatchObject({ declined: true, tool: "insert_figure" });
    expect(host.prepareExternalMutation).not.toHaveBeenCalled();
    expect(host.insertAtCursor).not.toHaveBeenCalled();
  });

  it("reports a cancelled external request before editing", async () => {
    const host = makeHost();
    const result = await createFigureTools(host, { mutationAllowed: () => false }).insert_figure.execute({
      code: TIKZ,
    });
    expect(result).toEqual({
      error: "Error: Project changed or the external request was cancelled before mutation.",
    });
    expect(host.insertAtCursor).not.toHaveBeenCalled();
  });

  it("reports when no editable document is open and saves nothing", async () => {
    const host = makeHost({
      insertAtCursor: vi.fn(async () => false),
      getLastFigurePreview: vi.fn(() => ({ pngDataUrl: "data:image/png;base64,X" })),
    });
    expect(await createFigureTools(host).insert_figure.execute({ code: TIKZ })).toEqual({
      error: "No editable document is open",
    });
    expect(host.writeProjectBytes).not.toHaveBeenCalled();
  });

  it("needs an open project", async () => {
    const host = makeHost({ getProjectId: vi.fn(() => null) });
    expect(await createFigureTools(host).insert_figure.execute({ code: TIKZ })).toEqual({ error: "No project open" });
  });
});

describe("insert_figure in a Typst project", () => {
  it("keeps the imports when the target document cannot be read", async () => {
    const host = makeHost({
      getFigureEngine: vi.fn(() => "typst" as const),
      insertTargetPath: vi.fn(() => "main.typ"),
      readFileContent: vi.fn(async () => {
        throw new Error("gone");
      }),
    });
    await createFigureTools(host).insert_figure.execute({
      code: '#import "@preview/cetz:0.4.2"\n#cetz.canvas({})',
      raw: true,
    });
    expect(host.insertAtCursor).toHaveBeenCalledWith(
      "proj",
      '#import "@preview/cetz:0.4.2"\n#cetz.canvas({})',
      expect.any(Function),
    );
  });

  it("does not read any document when there is no insert target", async () => {
    const host = makeHost({ getFigureEngine: vi.fn(() => "typst" as const) });
    await createFigureTools(host).insert_figure.execute({ code: "#box[]", caption: "Box" });
    expect(host.readFileContent).not.toHaveBeenCalled();
    expect(host.insertAtCursor).toHaveBeenCalledWith(
      "proj",
      "#figure(caption: [Box])[\n  #box[]\n]",
      expect.any(Function),
    );
  });
});

describe("load_image", () => {
  it.each([
    ["PNG", png(640, 480), "image/png", 640, 480],
    ["GIF", gif(32, 16), "image/gif", 32, 16],
    ["JPEG", jpeg(64, 48), "image/jpeg", 64, 48],
  ] as const)("loads a %s and reports its size", async (_label, bytes, mime, width, height) => {
    const onImage = vi.fn();
    const host = makeHost({ readProjectBytes: vi.fn(async () => bytes) });
    const result = await createFigureTools(host, { onImage }).load_image.execute({ path: "sketch" });
    expect(result).toEqual({ loaded: true, path: "sketch", width, height });
    expect(onImage).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^data:${mime};base64,`)));
  });

  it("loads without an image sink", async () => {
    const host = makeHost({ readProjectBytes: vi.fn(async () => png(2, 2)) });
    expect(await createFigureTools(host).load_image.execute({ path: "a.png" })).toMatchObject({ loaded: true });
  });

  it.each([
    ["unknown bytes", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])],
    ["a PNG with zero width", png(0, 10)],
    ["a truncated PNG", png(10, 10).slice(0, 20)],
    ["a JPEG whose scan starts before any frame header", new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 8, 1, 2, 3, 4, 5, 6, 7, 8])],
    ["a JPEG with a segment running past the end", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x7f, 0xff, 1, 2, 3, 4, 5, 6, 7])],
  ])("rejects %s", async (_label, bytes) => {
    const onImage = vi.fn();
    const host = makeHost({ readProjectBytes: vi.fn(async () => bytes) });
    expect(await createFigureTools(host, { onImage }).load_image.execute({ path: "x" })).toEqual({
      error: "Only valid PNG, JPEG, and GIF images are supported.",
    });
    expect(onImage).not.toHaveBeenCalled();
  });

  it("rejects files over 8 MiB", async () => {
    const host = makeHost({ readProjectBytes: vi.fn(async () => new Uint8Array(8 * 1024 * 1024 + 1)) });
    expect(await createFigureTools(host).load_image.execute({ path: "huge.png" })).toEqual({
      error: "Image exceeds the 8 MiB limit.",
    });
  });

  it("rejects images over the pixel limit", async () => {
    const host = makeHost({ readProjectBytes: vi.fn(async () => png(8000, 5000)) });
    expect(await createFigureTools(host).load_image.execute({ path: "wide.png" })).toEqual({
      error: expect.stringContaining("pixel limit"),
    });
  });

  it("returns a read failure as an error and needs an open project", async () => {
    const failing = makeHost({
      readProjectBytes: vi.fn(async () => {
        throw new Error("not found");
      }),
    });
    expect(await createFigureTools(failing).load_image.execute({ path: "x.png" })).toEqual({
      error: "Error: not found",
    });
    const closed = makeHost({ getProjectId: vi.fn(() => null) });
    expect(await createFigureTools(closed).load_image.execute({ path: "x.png" })).toEqual({
      error: "No project open",
    });
  });
});
