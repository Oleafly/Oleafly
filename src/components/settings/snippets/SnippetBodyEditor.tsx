import { useCallback } from "react";
import type { EditorView } from "@codemirror/view";
import { languageForPath } from "@oleafly/editor";
import type { SnippetLanguage } from "@oleafly/snippets";
import { CodeField } from "@/components/tools/CodeField";
import type { BodyKey } from "@/features/snippets/draft";
import { snippetFieldChips } from "@/features/snippets/body-chips";
import { useEditorThemeId } from "@/hooks/use-editor-theme";

export const SAMPLE_PATH: Readonly<Record<SnippetLanguage, string>> = {
  latex: "snippet.tex",
  typst: "snippet.typ",
  markdown: "snippet.md",
  bibtex: "snippet.bib",
  notes: "snippet.md",
};

export function SnippetBodyEditor({
  value,
  onChange,
  language,
  showSyntax,
  captures = false,
  ariaLabel,
  readOnly = false,
  onView,
  testId,
}: Readonly<{
  value: string;
  onChange?: (value: string) => void;
  language: BodyKey;
  showSyntax: boolean;
  captures?: boolean;
  ariaLabel: string;
  readOnly?: boolean;
  onView?: (view: EditorView | null) => void;
  testId?: string;
}>) {
  const themeId = useEditorThemeId();
  const extensions = useCallback(() => {
    const support = language === "default" ? null : languageForPath(SAMPLE_PATH[language]);
    return [support ?? [], showSyntax ? [] : snippetFieldChips(captures)];
  }, [language, showSyntax, captures]);
  return (
    <CodeField
      key={language}
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
