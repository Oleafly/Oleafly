import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { latexLanguage } from "@/components/editor/cm/latex";
import { editorTheme } from "@/components/editor/cm/theme";
import { useSettingsStore } from "@/store/settings";

/** Read-only, syntax-highlighted LaTeX viewer for the converter's source pane. */
export function LatexSourceViewer({ source }: { source: string }) {
  const editorThemeId = useSettingsStore((s) => s.editorTheme);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: recreated only on mount; content updates below
  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: source,
        extensions: [
          lineNumbers(),
          EditorView.lineWrapping,
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          latexLanguage(),
          editorTheme(),
        ],
      }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== source) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: source } });
    }
  }, [source]);

  return (
    <div
      ref={hostRef}
      data-testid="import-source"
      data-editor-theme={editorThemeId}
      className="min-h-0 flex-1 overflow-auto text-xs [&_.cm-editor]:h-full"
    />
  );
}
