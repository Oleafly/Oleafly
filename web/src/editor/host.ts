import type { CompletionSyntax } from "@oleafly/editor";
import type { EditorHost } from "@oleafly/editor/CodeMirrorEditor";
import type { EditorBridge } from "../controller";
import { editorMessage } from "../i18n/packages";
import { abilitiesFor } from "../roles";
import { useWeb, type WebState } from "../store";

const SETTINGS: ReturnType<EditorHost["useSettings"]> = {
  keymap: "default",
  spellcheck: false,
  harper: false,
  editorTheme: "system",
  tabSize: 4,
  lineWrap: true,
  autocomplete: true,
  autoCloseBrackets: true,
  autoCloseMath: true,
  cursorBlinking: "blink",
  highlightCurrentLine: true,
  cursorHeight: "text",
  ghostCompletion: false,
  stickyScroll: false,
  mathPreview: false,
};

const NO_DEPS: readonly unknown[] = [];
const NO_KEYS = {};

export function completionSyntaxFor(path: string | null): CompletionSyntax {
  if (!path) return "generic";
  if (/\.bib$/iu.test(path)) return "bibtex";
  if (/\.(?:tex|latex|ltx|sty|cls)$/iu.test(path)) return "latex";
  if (/\.typ$/iu.test(path)) return "typst";
  if (/\.(?:md|markdown)$/iu.test(path)) return "markdown";
  return "generic";
}

export function editorLocked(state: WebState): boolean {
  if (!abilitiesFor(state.role, state.features).edit) return true;
  return state.activeFileId === null || state.loaded[state.activeFileId] !== true;
}

export function createEditorHost(bridge: EditorBridge): EditorHost {
  return {
    t: editorMessage,
    useActivePath: () => useWeb((state) => state.activePath),
    getActivePath: () => useWeb.getState().activePath,
    useDocVersion: () => useWeb((state) => state.docVersion),
    useCompletionSyntax: completionSyntaxFor,
    getContent: (path) => bridge.sessionFor(path)?.text() ?? "",
    setContent: () => undefined,
    documentSession: (path) => bridge.sessionFor(path),
    saveActive: () => undefined,
    isEditLocked: () => editorLocked(useWeb.getState()),
    useEditLocked: () => useWeb(editorLocked),
    useSettings: () => SETTINGS,
    useLintRefreshDeps: () => NO_DEPS,
    useEditorKeymap: () => NO_KEYS,
    useVisualMode: () => false,
  };
}
