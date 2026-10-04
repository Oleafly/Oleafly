import { beforeEach, describe, expect, it, vi } from "vitest";

const pipeline = vi.hoisted(() => ({
  renderDiagram: vi.fn(),
  svgDocumentToPngBytes: vi.fn(),
  mermaidExportSource: vi.fn(),
  standaloneMermaidSvg: vi.fn(),
}));

vi.mock("@/components/ui/mermaid-diagram", () => ({ renderDiagram: pipeline.renderDiagram }));
vi.mock("@/features/equation-export", () => ({
  svgDocumentToPngBytes: pipeline.svgDocumentToPngBytes,
}));
vi.mock("@/features/mermaid-export", () => ({
  mermaidExportSource: pipeline.mermaidExportSource,
  standaloneMermaidSvg: pipeline.standaloneMermaidSvg,
}));

import { renderMermaidFigure } from "./mermaid-render";

beforeEach(() => {
  const diagram = { tagName: "svg" };
  pipeline.mermaidExportSource.mockReset().mockImplementation((source: string) => `%%export\n${source}`);
  pipeline.renderDiagram.mockReset().mockResolvedValue(diagram);
  pipeline.standaloneMermaidSvg.mockReset().mockReturnValue({ svg: "<svg/>", width: 10, height: 10 });
  pipeline.svgDocumentToPngBytes.mockReset().mockResolvedValue(new Uint8Array([104, 105]));
});

describe("renderMermaidFigure", () => {
  it("renders the export source in the light theme and rasterises the standalone SVG", async () => {
    const result = await renderMermaidFigure("graph TD; A-->B", { scale: 2, background: "#ffffff" });

    expect(pipeline.renderDiagram).toHaveBeenCalledWith("%%export\ngraph TD; A-->B", "light");
    expect(pipeline.standaloneMermaidSvg).toHaveBeenCalledWith(
      await pipeline.renderDiagram.mock.results[0].value,
      "graph TD; A-->B",
    );
    expect(pipeline.svgDocumentToPngBytes).toHaveBeenCalledWith("<svg/>", 2, "#ffffff");
    expect(result).toEqual({ svg: "<svg/>", pngBase64: "aGk=" });
  });

  it("keeps a transparent background when none is given", async () => {
    await renderMermaidFigure("graph LR", { scale: 1, background: "" });

    expect(pipeline.svgDocumentToPngBytes).toHaveBeenCalledWith("<svg/>", 1, null);
  });
});
