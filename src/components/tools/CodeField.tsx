import { useEffect, useRef } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, placeholder as cmPlaceholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { recompileShortcutBinding } from "@/components/editor/cm/recompile-shortcut";
import { editorTheme } from "@/components/editor/cm/theme";
import { functionKeyTextInput } from "@/lib/function-key-text";

interface CodeFieldProps {
  value: string;
  onChange: (value: string) => void;
  language: () => Extension;
  themeId: string;
  placeholder?: string;
  className?: string;
  testId?: string;
  readOnly?: boolean;
  ariaLabel?: string;
  onView?: (view: EditorView | null) => void;
}

export function CodeField({
  value,
  onChange,
  language,
  themeId,
  placeholder,
  className,
  testId,
  readOnly = false,
  ariaLabel,
  onView,
}: Readonly<CodeFieldProps>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onViewRef = useRef(onView);
  onViewRef.current = onView;

  // biome-ignore lint/correctness/useExhaustiveDependencies: recreated only on mount; value updates synced below
  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          EditorView.lineWrapping,
          ...(readOnly
            ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
            : [
                history(),
                keymap.of([recompileShortcutBinding, ...defaultKeymap, ...historyKeymap]),
                functionKeyTextInput,
              ]),
          language(),
          editorTheme(),
          ...(placeholder ? [cmPlaceholder(placeholder)] : []),
          ...(ariaLabel ? [EditorView.contentAttributes.of({ "aria-label": ariaLabel })] : []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    onViewRef.current?.(view);
    return () => {
      onViewRef.current?.(null);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return (
    <div
      ref={hostRef}
      data-editor-theme={themeId}
      data-testid={testId}
      className={className}
    />
  );
}
