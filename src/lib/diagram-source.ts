import { buildStandaloneDoc, DIAGRAM_LIBS, parseEmbeddedModel, serializeDiagram, type DiagramModel } from "@oleafly/latex";

export function standaloneDiagramSource(model: DiagramModel, sourceVersion: "current" | "0.3.13" = "current"): string {
  return buildStandaloneDoc({
    code: serializeDiagram(model, sourceVersion),
    libraries: DIAGRAM_LIBS,
    background: model.background,
  });
}

export function editableStandaloneDiagram(source: string): DiagramModel | null {
  const embedded = parseEmbeddedModel(source);
  if (!embedded) return null;
  try {
    const normalized = source.replace(/\r\n/g, "\n").trim();
    return (["current", "0.3.13"] as const).some((version) => standaloneDiagramSource(embedded, version).trim() === normalized)
      ? embedded : null;
  } catch {
    return null;
  }
}
