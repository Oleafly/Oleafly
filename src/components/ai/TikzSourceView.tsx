import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { latexLanguage } from "@/components/editor/cm/latex";
import { editorTheme } from "@/components/editor/cm/theme";
import { useSettingsStore } from "@/store/settings";

export function TikzSourceView({ source }: { source: string }) {
  const editorThemeId = useSettingsStore((s) => s.editorTheme);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: sourceRef.current,
        extensions: [
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
      data-testid="tool-picture-code"
      data-editor-theme={editorThemeId}
      className="max-h-80 overflow-auto text-[11px] [&_.cm-editor]:bg-transparent [&_.cm-scroller]:font-mono"
    />
  );
}
