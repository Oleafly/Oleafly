import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { latexLanguage } from "@/components/editor/cm/latex";
import { editorTheme } from "@/components/editor/cm/theme";
import { useSettingsStore } from "@/store/settings";

export function ReadOnlyLatex({
  source,
  gutter = false,
  className,
  testId,
}: {
  source: string;
  gutter?: boolean;
  className?: string;
  testId?: string;
}) {
  const editorThemeId = useSettingsStore((s) => s.editorTheme);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initialRef = useRef({ source, gutter });

  useEffect(() => {
    if (!hostRef.current) return;
    const initial = initialRef.current;
    const view = new EditorView({
      state: EditorState.create({
        doc: initial.source,
        extensions: [
          ...(initial.gutter ? [lineNumbers()] : []),
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

  return <div ref={hostRef} data-testid={testId} data-editor-theme={editorThemeId} className={className} />;
}
