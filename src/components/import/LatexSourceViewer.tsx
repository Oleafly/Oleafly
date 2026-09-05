import { ReadOnlyLatex } from "@/components/editor/cm/ReadOnlyLatex";

/** Read-only, syntax-highlighted LaTeX viewer for the converter's source pane. */
export function LatexSourceViewer({ source }: { source: string }) {
  return (
    <ReadOnlyLatex
      source={source}
      gutter
      testId="import-source"
      className="min-h-0 flex-1 overflow-auto text-xs [&_.cm-editor]:h-full"
    />
  );
}
