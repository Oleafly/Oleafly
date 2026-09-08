import { buildStandaloneDoc, DIAGRAM_LIBS, parseEmbeddedModel, serializeDiagram, type DiagramModel, type DiagramSourceVersion } from "@oleafly/latex";

export function standaloneDiagramSource(model: DiagramModel, sourceVersion: DiagramSourceVersion = "current"): string {
  const document = buildStandaloneDoc({
    code: serializeDiagram(model, sourceVersion),
    libraries: DIAGRAM_LIBS,
    background: model.background,
  });
  return sourceVersion === "0.2.6" ? document.replaceAll("\\usepackage{lmodern}\n", "") : document;
}

export function editableStandaloneDiagram(source: string): DiagramModel | null {
  const embedded = parseEmbeddedModel(source);
  if (!embedded) return null;
  try {
    const normalized = source.replaceAll("\r\n", "\n").trim();
    return (["current", "0.3.13", "0.2.6"] as const).some((version) => standaloneDiagramSource(embedded, version).trim() === normalized)
      ? embedded : null;
  } catch {
    return null;
  }
}
