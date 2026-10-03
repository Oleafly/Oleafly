import { bytesToBase64 } from "@/lib/base64";

export async function renderMermaidFigure(
  source: string,
  options: { scale: number; background: string },
): Promise<{ svg: string; pngBase64: string }> {
  const [{ renderDiagram }, { svgDocumentToPngBytes }, exporter] = await Promise.all([
    import("@/components/ui/mermaid-diagram"),
    import("@/features/equation-export"),
    import("@/features/mermaid-export"),
  ]);
  const diagram = await renderDiagram(exporter.mermaidExportSource(source), "light");
  const { svg } = exporter.standaloneMermaidSvg(diagram, source);
  const png = await svgDocumentToPngBytes(svg, options.scale, options.background || null);
  return { svg, pngBase64: bytesToBase64(png) };
}
