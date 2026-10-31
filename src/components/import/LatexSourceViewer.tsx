import { ReadOnlyLatex } from "@/components/editor/cm/ReadOnlyLatex";

export function LatexSourceViewer({ source }: Readonly<{ source: string }>) {
  return (
    <ReadOnlyLatex
      source={source}
      gutter
      testId="import-source"
      className="min-h-0 flex-1 overflow-auto text-xs [&_.cm-editor]:h-full"
    />
  );
}
