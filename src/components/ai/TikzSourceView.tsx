import { ReadOnlyLatex } from "@/components/editor/cm/ReadOnlyLatex";

export function TikzSourceView({ source }: { source: string }) {
  return (
    <ReadOnlyLatex
      source={source}
      testId="tool-picture-code"
      className="max-h-80 overflow-auto text-[11px] [&_.cm-editor]:bg-transparent [&_.cm-scroller]:font-mono"
    />
  );
}
