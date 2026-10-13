import { createElement } from "react";
import { render } from "@testing-library/react";
import { Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { getEditorView } from "@oleafly/editor";
import { CodeMirrorEditor, type EditorHost } from "@oleafly/editor/CodeMirrorEditor";
import { completionSyntaxForPath } from "@/lib/document-engine";
import { useFilesStore } from "@/store/files";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
}

const HOST: EditorHost = {
  t: (key) => key,
  useActivePath: () => useFilesStore((s) => s.activePath),
  getActivePath: () => useFilesStore.getState().activePath,
  useDocVersion: () => useFilesStore((s) => s.docVersion),
  useCompletionSyntax: (path) => {
    const sourceFormat = useFilesStore((s) => s.engine.source_format);
    return completionSyntaxForPath(path, sourceFormat);
  },
  getContent: (path) => useFilesStore.getState().files[path]?.content ?? "",
  setContent: (path, content) => useFilesStore.getState().setContent(path, content),
  useSettings: () => ({
    keymap: "default", tabSize: 2, lineWrap: true, spellcheck: false, harper: false,
    editorTheme: "system", autocomplete: false, autoCloseBrackets: false,
    cursorBlinking: "blink", highlightCurrentLine: true, cursorHeight: "text", ghostCompletion: false, stickyScroll: false, mathPreview: false,
  }),
  useVisualMode: () => false,
  useEditorKeymap: () => ({}),
  useLintRefreshDeps: () => [],
};

export function renderStoreEditor() {
  return render(createElement(CodeMirrorEditor, { active: true, host: HOST }));
}

export function editorView(): EditorView {
  const view = getEditorView();
  if (!view) throw new Error("the editor did not mount");
  return view;
}

export function editorText(): string {
  return editorView().state.doc.toString();
}

export function typeAtEnd(text: string): void {
  const view = editorView();
  const end = view.state.doc.length;
  view.dispatch({
    changes: { from: end, insert: text },
    selection: { anchor: end + text.length },
    annotations: Transaction.userEvent.of("input.type"),
  });
}
