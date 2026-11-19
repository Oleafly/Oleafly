import { registerComposerContextKind, type ComposerContextItem } from "@/lib/composer-context";
import type { PdfAnnotation } from "@/lib/tauri";
import { usePdfAnnotationsStore } from "@/store/pdf-annotations";
import { annotationLabel } from "./label";

export const PDF_ANNOTATION_CONTEXT = "pdfAnnotation";

async function textOf(path: string): Promise<string | null> {
  const { sourceText } = await import("@/features/synctex");
  return sourceText(path);
}

export function annotationContextItems(annotations: readonly PdfAnnotation[]): ComposerContextItem[] {
  return annotations.map((annotation) => ({
    id: `${PDF_ANNOTATION_CONTEXT}:${annotation.id}`,
    kind: PDF_ANNOTATION_CONTEXT,
    refId: annotation.id,
    label: annotationLabel(annotation),
  }));
}

function annotationsOf(projectId: string, refIds: readonly string[]): PdfAnnotation[] {
  const state = usePdfAnnotationsStore.getState();
  if (state.projectId !== projectId) return [];
  const wanted = new Set(refIds);
  return state.items.filter((item) => wanted.has(item.id));
}

export async function expandAnnotations(projectId: string, refIds: readonly string[]) {
  const { annotationPrompt, currentSource } = await import("./model");
  return Promise.all(
    annotationsOf(projectId, refIds).map(async (annotation) => {
      const current = currentSource(annotation, annotation.source ? await textOf(annotation.source.path) : null);
      return {
        refId: annotation.id,
        path: current.source?.path ?? annotation.source?.path ?? null,
        text: annotationPrompt(annotation, current),
      };
    }),
  );
}

export function markAnnotationsSent(projectId: string, refIds: readonly string[]): void {
  const updates = annotationsOf(projectId, refIds)
    .filter((annotation) => annotation.status === "draft")
    .map((annotation) => ({ id: annotation.id, status: "sent" as const }));
  void usePdfAnnotationsStore.getState().update(updates);
}

registerComposerContextKind(PDF_ANNOTATION_CONTEXT, { expand: expandAnnotations, sent: markAnnotationsSent });
