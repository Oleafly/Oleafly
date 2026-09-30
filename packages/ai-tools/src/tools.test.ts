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
