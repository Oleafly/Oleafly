import type { PdfAnnotation, PdfAnnotationSource } from "@/lib/tauri";

export function lineSpan(source: Pick<PdfAnnotationSource, "startLine" | "endLine">): string {
  return source.startLine === source.endLine ? String(source.startLine) : `${source.startLine}-${source.endLine}`;
}

export function annotationLabel(annotation: Pick<PdfAnnotation, "number" | "source">): string {
  const source = annotation.source;
  const name = source ? source.path.slice(source.path.lastIndexOf("/") + 1) : null;
  return name && source ? `${annotation.number} · ${name}:${lineSpan(source)}` : String(annotation.number);
}
