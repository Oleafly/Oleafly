import { useCallback } from "react";
import type { EditorView } from "@codemirror/view";
import { languageForPath } from "@oleafly/editor";
import { CodeField } from "@/components/tools/CodeField";
import type { BodyKey } from "@/features/snippets/draft";
import { snippetFieldChips } from "@/features/snippets/body-chips";
import { useEditorThemeId } from "@/hooks/use-editor-theme";

const SAMPLE_PATHS: Partial<Record<BodyKey, string>> = {
  latex: "snippet.tex",
  typst: "snippet.typ",
  markdown: "snippet.md",
  bibtex: "snippet.bib",
};

export function SnippetBodyEditor({
  value,
  onChange,
  language,
  showSyntax,
  ariaLabel,
  readOnly = false,
  onView,
  testId,
}: Readonly<{
  value: string;
  onChange?: (value: string) => void;
  language: BodyKey;
  showSyntax: boolean;
  ariaLabel: string;
  readOnly?: boolean;
  onView?: (view: EditorView | null) => void;
  testId?: string;
}>) {
  const themeId = useEditorThemeId();
  const extensions = useCallback(() => {
    const path = SAMPLE_PATHS[language];
    const support = path ? languageForPath(path) : null;
    return [support ?? [], showSyntax ? [] : snippetFieldChips()];
  }, [language, showSyntax]);
  return (
    <CodeField
      key={`${language}:${showSyntax}`}
      value={value}
      onChange={(next) => onChange?.(next)}
      language={extensions}
      themeId={themeId}
      readOnly={readOnly}
      ariaLabel={ariaLabel}
      onView={onView}
      testId={testId}
      className="max-h-80 min-h-28 overflow-auto rounded-md border bg-background text-xs"
    />
  );
}
