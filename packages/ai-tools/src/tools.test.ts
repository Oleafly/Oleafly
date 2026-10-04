import { describe, expect, it, vi } from "vitest";
import { createFigureTools, createOleaflyTools, type AiToolsHost, type RevealLocationResult } from "./tools";

function makeHost(
  revealLocation?: (target: {
    path?: string;
    line?: number;
    page?: number;
  }) => Promise<RevealLocationResult>,
): AiToolsHost {
  return {
    getProjectId: () => "proj",
    ...(revealLocation ? { revealLocation } : {}),
  } as unknown as AiToolsHost;
}

describe("show_location tool", () => {
  it("declares an optional path/line/page schema", () => {
    const tool = createOleaflyTools(makeHost()).show_location;
    expect(tool.description).toContain("SyncTeX");
    expect(tool.inputSchema).toMatchObject({
      type: "object",
      required: [],
      additionalProperties: false,
    });
    expect(tool.inputSchema.properties).toMatchObject({
      path: { type: "string" },
      line: { type: "integer", minimum: 1 },
      page: { type: "integer", minimum: 1 },
    });
  });

  it("refuses a call with neither a path nor a page", async () => {
    const reveal = vi.fn();
    const tools = createOleaflyTools(makeHost(reveal));
    const result = await tools.show_location.execute({});
    expect(result).toMatchObject({ error: expect.stringContaining("Pass a path") });
    expect(reveal).not.toHaveBeenCalled();
  });

  it("rejects a line or page below one, or a fractional one", async () => {
    const reveal = vi.fn();
    const tools = createOleaflyTools(makeHost(reveal));
    expect(await tools.show_location.execute({ path: "main.tex", line: 0 })).toMatchObject({
      error: expect.stringContaining("line"),
    });
    expect(await tools.show_location.execute({ page: 2.5 })).toMatchObject({
      error: expect.stringContaining("page"),
    });
    expect(await tools.show_location.execute({ path: 12 })).toMatchObject({
      error: expect.stringContaining("path"),
    });
    expect(reveal).not.toHaveBeenCalled();
  });

  it("reveals a file line and echoes what it revealed", async () => {
    const reveal = vi.fn(async () => ({ revealed: true }));
    const tools = createOleaflyTools(makeHost(reveal));

    const result = await tools.show_location.execute({ path: "sections/intro.tex", line: 42 });

    expect(reveal).toHaveBeenCalledWith({ path: "sections/intro.tex", line: 42 });
    expect(result).toEqual({ success: true, revealed: true, path: "sections/intro.tex", line: 42 });
  });

  it("passes a page-only request straight through", async () => {
    const reveal = vi.fn(async () => ({ revealed: true }));
    const tools = createOleaflyTools(makeHost(reveal));

    const result = await tools.show_location.execute({ page: 7 });

    expect(reveal).toHaveBeenCalledWith({ page: 7 });
    expect(result).toEqual({ success: true, revealed: true, page: 7 });
  });

  it("keeps the host note when only part of the jump worked", async () => {
    const reveal = vi.fn(async () => ({
      revealed: true,
      note: "The PDF preview did not move.",
    }));
    const tools = createOleaflyTools(makeHost(reveal));

    const result = await tools.show_location.execute({ path: "main.tex", line: 3 });

    expect(result).toEqual({
      success: true,
      revealed: true,
      path: "main.tex",
      line: 3,
      note: "The PDF preview did not move.",
    });
  });

  it("reports a failed reveal as an error with the host's reason", async () => {
    const reveal = vi.fn(async () => ({ revealed: false, note: "No project open." }));
    const tools = createOleaflyTools(makeHost(reveal));

    expect(await tools.show_location.execute({ path: "main.tex" })).toEqual({
      error: "No project open.",
    });
  });

  it("gives a generic reason when the host gives none", async () => {
    const reveal = vi.fn(async () => ({ revealed: false }));
    const tools = createOleaflyTools(makeHost(reveal));

    expect(await tools.show_location.execute({ page: 3 })).toEqual({
      error: "Could not reveal that location.",
    });
  });

  it("stays usable on a host that cannot reveal anything", async () => {
    const tools = createOleaflyTools(makeHost());
    expect(await tools.show_location.execute({ path: "main.tex" })).toMatchObject({
      error: expect.stringContaining("no editor or preview"),
    });
  });

  it("never throws when the host rejects", async () => {
    const reveal = vi.fn(async () => {
      throw new Error("viewer gone");
    });
    const tools = createOleaflyTools(makeHost(reveal));

    expect(await tools.show_location.execute({ page: 1 })).toMatchObject({
      error: expect.stringContaining("viewer gone"),
    });
  });
});

describe("insert_figure tool", () => {
  function figureHost(overrides: Partial<AiToolsHost> = {}): AiToolsHost {
    return {
      getProjectId: () => "proj",
      prepareExternalMutation: vi.fn(async () => 3),
      getLastFigurePreview: () => ({ pdfBytes: new Uint8Array([1]) }),
      pdfToPng: vi.fn(async () => "data:image/png;base64,AAAA"),
      getFigureInsertTarget: () => null,
      insertAtCursor: vi.fn(async () => true),
      replaceRange: vi.fn(async () => true),
      writeProjectBytes: vi.fn(async () => ({})),
      refreshTree: vi.fn(async () => {}),
      insertTargetPath: () => "chapters/results.tex",
      ...overrides,
    } as unknown as AiToolsHost;
  }

  it("names the document it edited and the PNG it saved, so the turn can claim both", async () => {
    const host = figureHost();
    const tools = createFigureTools(host);

    const result = await tools.insert_figure.execute({ code: String.raw`\draw (0,0);`, caption: "Loss curve" });

    expect(host.insertAtCursor).toHaveBeenCalled();
    expect(host.writeProjectBytes).toHaveBeenCalledWith("proj", "figures/loss-curve.png", "AAAA", 3);
    expect(result).toEqual({
      success: true,
      path: "chapters/results.tex",
      figure: "figures/loss-curve.png",
    });
  });

  it("leaves out the PNG when there was no preview to save", async () => {
    const host = figureHost({ getLastFigurePreview: () => null });
    const tools = createFigureTools(host);

    const result = await tools.insert_figure.execute({ code: String.raw`\draw (0,0);` });

    expect(host.writeProjectBytes).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, path: "chapters/results.tex" });
  });

  it("leaves out the PNG when saving it failed", async () => {
    const host = figureHost({ writeProjectBytes: vi.fn(async () => { throw new Error("disk full"); }) });
    const tools = createFigureTools(host);

    const result = await tools.insert_figure.execute({ code: String.raw`\draw (0,0);`, label: "fig:a" });

    expect(result).toEqual({ success: true, path: "chapters/results.tex" });
  });
});

describe("figure tools in a Typst project", () => {
  const CANVAS = '#import "@preview/cetz:0.4.2"\n#cetz.canvas({ cetz.draw.circle((0, 0)) })';

  function typstHost(overrides: Partial<AiToolsHost> = {}): AiToolsHost {
    let preview: unknown = null;
    return {
      getProjectId: () => "proj",
      getFigureEngine: () => "typst",
      renderTypstFigure: vi.fn(async () => ({ ok: true, pngBase64: "UE5H", diagnostics: [] })),
      compileIsolated: vi.fn(),
      readIsolatedPdf: vi.fn(),
      pdfToPng: vi.fn(),
      setLastFigurePreview: vi.fn((value: unknown) => {
        preview = value;
      }),
      getLastFigurePreview: () => preview,
      getFigureInsertTarget: () => null,
      prepareExternalMutation: vi.fn(async () => 7),
      insertAtCursor: vi.fn(async () => true),
      replaceRange: vi.fn(async () => true),
      writeProjectBytes: vi.fn(async () => ({})),
      refreshTree: vi.fn(async () => {}),
      readFileContent: vi.fn(async () => "= Results\n"),
      insertTargetPath: () => "main.typ",
      ...overrides,
    } as unknown as AiToolsHost;
  }

  it("previews through the Typst renderer and hands the image to the model", async () => {
    const host = typstHost();
    const onImage = vi.fn();
    const tools = createFigureTools(host, { onImage });

    const result = await tools.preview_figure.execute({ code: CANVAS });

    expect(host.renderTypstFigure).toHaveBeenCalledWith(
      "proj",
      `#set page(fill: white, margin: 6pt)\n${CANVAS}`,
    );
    expect(host.compileIsolated).not.toHaveBeenCalled();
    expect(onImage).toHaveBeenCalledWith("data:image/png;base64,UE5H");
    expect(host.setLastFigurePreview).toHaveBeenCalledWith({
      pngDataUrl: "data:image/png;base64,UE5H",
    });
    expect(result).toEqual({ success: true, has_image: true, errors: [], warnings: [] });
  });

  it("reports Typst errors against the model's own line numbers and clears the old preview", async () => {
    const host = typstHost({
      renderTypstFigure: vi.fn(async () => ({
        ok: false as const,
        diagnostics: [
          { severity: "error" as const, message: "unknown variable: cetz", line: 3, column: 2 },
        ],
      })),
    });
    const onImage = vi.fn();
    const tools = createFigureTools(host, { onImage });

    const result = await tools.preview_figure.execute({ code: "#cetz.canvas({})" });

    expect(onImage).not.toHaveBeenCalled();
    expect(host.setLastFigurePreview).toHaveBeenCalledWith(null);
    expect(result).toEqual({
      success: false,
      has_image: false,
      warnings: [],
      errors: [{ severity: "error", message: "unknown variable: cetz", line: 2, column: 2 }],
    });
  });

  it("inserts a #figure with its caption and label, and saves the previewed PNG", async () => {
    const confirm = vi.fn(async () => true);
    const host = typstHost();
    const tools = createFigureTools(host, { confirm });
    await tools.preview_figure.execute({ code: CANVAS });

    const result = await tools.insert_figure.execute({
      code: CANVAS,
      caption: "Unit circle",
      label: "fig:circle",
    });

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "insert_figure", image: "data:image/png;base64,UE5H" }),
    );
    expect(host.insertAtCursor).toHaveBeenCalledWith(
      "proj",
      '#import "@preview/cetz:0.4.2"\n#figure(caption: [Unit circle])[\n  #cetz.canvas({ cetz.draw.circle((0, 0)) })\n] <fig:circle>',
      expect.any(Function),
    );
    expect(host.pdfToPng).not.toHaveBeenCalled();
    expect(host.writeProjectBytes).toHaveBeenCalledWith("proj", "figures/unit-circle.png", "UE5H", 7);
    expect(result).toEqual({ success: true, path: "main.typ", figure: "figures/unit-circle.png" });
  });

  it("does not repeat an import the document already has", async () => {
    const host = typstHost({
      readFileContent: vi.fn(async () => '#import "@preview/cetz:0.4.2"\n= Results\n'),
    });
    const tools = createFigureTools(host);

    await tools.insert_figure.execute({ code: CANVAS });

    expect(host.readFileContent).toHaveBeenCalledWith("proj", "main.typ");
    expect(host.insertAtCursor).toHaveBeenCalledWith(
      "proj",
      "#figure[\n  #cetz.canvas({ cetz.draw.circle((0, 0)) })\n]",
      expect.any(Function),
    );
  });

  it("refuses to preview or insert when the project's engine has no figure support", async () => {
    const host = typstHost({ getFigureEngine: () => null });
    const tools = createFigureTools(host);

    expect(await tools.preview_figure.execute({ code: "x" })).toEqual({
      error: "Figure tools work only in LaTeX and Typst projects.",
    });
    expect(await tools.insert_figure.execute({ code: "x" })).toEqual({
      error: "Figure tools work only in LaTeX and Typst projects.",
    });
    expect(host.renderTypstFigure).not.toHaveBeenCalled();
    expect(host.insertAtCursor).not.toHaveBeenCalled();
  });

  it("describes both engines in the preview tool", () => {
    const description = createFigureTools(typstHost()).preview_figure.description;
    expect(description).toContain("TikZ");
    expect(description).toContain("CeTZ");
    expect(description).toContain("fletcher");
  });
});

describe("load_image in any project", () => {
  it("loads a project image even when the engine has no figure support", async () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
      0, 0, 0, 4, 0, 0, 0, 3,
    ]);
    const onImage = vi.fn();
    const host = {
      getProjectId: () => "proj",
      getFigureEngine: () => null,
      readProjectBytes: vi.fn(async () => png),
    } as unknown as AiToolsHost;

    const result = await createFigureTools(host, { onImage }).load_image.execute({ path: "sketch.png" });

    expect(result).toEqual({ loaded: true, path: "sketch.png", width: 4, height: 3 });
    expect(onImage).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/));
  });
});
