import { useEffect, useRef } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { latexLanguage } from "@/components/editor/cm/latex";
import { editorTheme } from "@/components/editor/cm/theme";
import { useEditorThemeId } from "@/hooks/use-editor-theme";

const NO_EXTENSIONS: readonly Extension[] = [];

export function ReadOnlyLatex({
  source,
  gutter = false,
  className,
  testId,
  language,
  extensions = NO_EXTENSIONS,
}: Readonly<{
  source: string;
  gutter?: boolean;
  className?: string;
  testId?: string;
  language?: Extension;
  extensions?: readonly Extension[];
}>) {
  const editorThemeId = useEditorThemeId();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initialRef = useRef({ source, gutter, language, extensions });

  useEffect(() => {
    if (!hostRef.current) return;
    const initial = initialRef.current;
    const view = new EditorView({
      state: EditorState.create({
        doc: initial.source,
        selection: { anchor: initial.source.length },
        extensions: [
          ...(initial.gutter ? [lineNumbers()] : []),
          EditorView.lineWrapping,
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          initial.language ?? latexLanguage(),
          ...initial.extensions,
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
      view.dispatch({ changes: { from: 0, to: current.length, insert: source }, selection: { anchor: source.length } });
    }
  }, [source]);

  return <div ref={hostRef} data-testid={testId} data-editor-theme={editorThemeId} className={className} />;
}
