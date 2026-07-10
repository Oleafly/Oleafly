import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightActiveLine,
  drawSelection,
  dropCursor,
} from "@codemirror/view";
import {
  foldGutter,
  indentOnInput,
  indentUnit,
  bracketMatching,
  foldKeymap,
} from "@codemirror/language";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { editorTheme } from "@/components/editor/cm/theme";
import { latexLanguage } from "@/components/editor/cm/latex";

/** Imperative handle so a toolbar can insert/wrap text in THIS editor (not the
 *  app's main document editor). */
export interface CmHandle {
  insert: (text: string) => void;
  wrap: (before: string, after: string) => void;
  focus: () => void;
}

/**
 * A standalone, controlled CodeMirror editor with the same LaTeX highlighting
 * and editor theme as the main .tex editor, used inside the diagram composer.
 * Deliberately does NOT call setEditorView, so it stays independent of the
 * document editor that insert_figure / insertAtCursor target.
 */
export const CmCodeEditor = forwardRef<CmHandle, { value: string; onChange: (v: string) => void }>(
  function CmCodeEditor({ value, onChange }, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    // True while we push an external value in, so the change listener does not
    // echo it back out as a user edit.
    const suppressRef = useRef(false);

    // Create the editor once.
    useEffect(() => {
      if (!hostRef.current) return;
      const state = EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          foldGutter({ openText: "▾", closedText: "▸" }),
          drawSelection(),
          dropCursor(),
          indentOnInput(),
          indentUnit.of("  "),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          EditorView.lineWrapping,
          latexLanguage(),
          editorTheme(),
          history(),
          keymap.of([
            indentWithTab,
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
          ]),
          EditorView.updateListener.of((vu) => {
            if (vu.docChanged && !suppressRef.current) {
              onChangeRef.current(vu.state.doc.toString());
            }
          }),
        ],
      });
      const view = new EditorView({ state, parent: hostRef.current });
      viewRef.current = view;
      return () => {
        view.destroy();
        viewRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Controlled: reflect external value changes (e.g. a reset) without
    // clobbering the caret while the user is typing.
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (current !== value) {
        suppressRef.current = true;
        view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
        queueMicrotask(() => {
          suppressRef.current = false;
        });
      }
    }, [value]);

    useImperativeHandle(
      ref,
      () => ({
        insert: (text) => {
          const v = viewRef.current;
          if (!v) return;
          const sel = v.state.selection.main;
          v.dispatch({
            changes: { from: sel.from, to: sel.to, insert: text },
            selection: { anchor: sel.from + text.length },
          });
          v.focus();
        },
        wrap: (before, after) => {
          const v = viewRef.current;
          if (!v) return;
          const sel = v.state.selection.main;
          const selected = v.state.sliceDoc(sel.from, sel.to);
          v.dispatch({
            changes: { from: sel.from, to: sel.to, insert: before + selected + after },
            selection: { anchor: sel.from + before.length + selected.length },
          });
          v.focus();
        },
        focus: () => viewRef.current?.focus(),
      }),
      [],
    );

    return <div ref={hostRef} className="h-full overflow-auto text-xs" />;
  },
);
