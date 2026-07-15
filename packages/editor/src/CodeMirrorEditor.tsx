import { useEffect, useRef } from "react";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
  type KeyBinding,
} from "@codemirror/view";
import {
  foldGutter,
  indentOnInput,
  indentUnit,
  bracketMatching,
  foldKeymap,
} from "@codemirror/language";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { vim } from "@replit/codemirror-vim";

import { vscodeSearch } from "./search-panel";
import { editorTheme } from "./theme";
import { latexCompletions, slashCompletions } from "./latex";
import { languageForPath } from "./languages";
import { setEditorView } from "./controller";
import { spellLintExtensions, refreshEditorLints } from "./spellcheck";
import { mathHover } from "./math-preview";
import { createLatexLinter } from "./latex-linter";
import { latexFolding } from "./latex-folding";

// The use* members are React hooks: must follow hook rules, and the host
// object identity must stay stable across renders.
export interface EditorHost {
  useActivePath(): string | null;
  getActivePath(): string | null;
  useDocVersion(): number;
  getContent(path: string): string;
  setContent(path: string, content: string): void;
  useSettings(): { vim: boolean; spellcheck: boolean; harper: boolean };
  useLintRefreshDeps(): readonly unknown[];
}

export const isLatexSourcePath = (path: string | null): boolean =>
  !!path && /\.(?:tex|latex|ltx)$/i.test(path);
export const isProseSourcePath = (path: string | null): boolean =>
  !!path && /\.(?:tex|latex|ltx|md|markdown)$/i.test(path);

export function CodeMirrorEditor({
  host,
  extraExtensions,
  extraExtensionsForPath,
  extraKeymap,
}: {
  host: EditorHost;
  extraExtensions?: Extension[];
  extraExtensionsForPath?: (path: string | null) => Extension[];
  // Checked before the default keymaps (CodeMirror keymap precedence: earlier
  // extensions in the array win).
  extraKeymap?: KeyBinding[];
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const vimCompartmentRef = useRef<Compartment | null>(null);
  const spellCompartmentRef = useRef<Compartment | null>(null);
  const langCompartmentRef = useRef<Compartment | null>(null);
  const historyCompartmentRef = useRef<Compartment | null>(null);
  const sourceToolsCompartmentRef = useRef<Compartment | null>(null);
  const hostToolsCompartmentRef = useRef<Compartment | null>(null);
  const prevPathRef = useRef<string | null>(null);
  const suppressSyncRef = useRef(false);

  const activePath = host.useActivePath();
  // NB: the active file's content is read imperatively (host.getContent) inside
  // the file-swap effect below, NOT subscribed to. Subscribing here would
  // re-render this component on every keystroke (the store updates on each
  // edit), which is pure waste since CodeMirror owns the document and the
  // effect only needs the content when the file or docVersion actually changes.
  const docVersion = host.useDocVersion();
  const { vim: vimEnabled, spellcheck, harper } = host.useSettings();
  const lintDeps = host.useLintRefreshDeps();

  useEffect(() => {
    if (!hostRef.current) return;
    const initialPath = host.getActivePath();
    const initialContent = initialPath ? host.getContent(initialPath) : "";
    const vimCompartment = new Compartment();
    vimCompartmentRef.current = vimCompartment;
    const spellCompartment = new Compartment();
    spellCompartmentRef.current = spellCompartment;
    const langCompartment = new Compartment();
    langCompartmentRef.current = langCompartment;
    const historyCompartment = new Compartment();
    historyCompartmentRef.current = historyCompartment;
    const sourceToolsCompartment = new Compartment();
    sourceToolsCompartmentRef.current = sourceToolsCompartment;
    const hostToolsCompartment = new Compartment();
    hostToolsCompartmentRef.current = hostToolsCompartment;
    prevPathRef.current = initialPath;
    const initialLang = initialPath ? languageForPath(initialPath) : null;

    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        foldGutter({ openText: "▾", closedText: "▸" }),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        indentUnit.of("    "),
        bracketMatching(),
        closeBrackets(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        langCompartment.of(initialLang ? initialLang : []),
        editorTheme(),
        historyCompartment.of(history()),
        vscodeSearch(),
        sourceToolsCompartment.of(
          isLatexSourcePath(initialPath)
            ? [
                latexFolding(),
                autocompletion({
                  override: [latexCompletions, slashCompletions],
                  activateOnTyping: true,
                  closeOnBlur: true,
                }),
                mathHover(),
                createLatexLinter(),
              ]
            : [],
        ),
        ...(extraExtensions ?? []),
        hostToolsCompartment.of(extraExtensionsForPath?.(initialPath) ?? []),
        keymap.of([
          ...(extraKeymap ?? []),
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
        ]),
        vimCompartment.of(vimEnabled ? vim() : []),
        spellCompartment.of(
          isProseSourcePath(initialPath) && (spellcheck || harper)
            ? spellLintExtensions({ spell: spellcheck, harper })
            : []
        ),
        EditorView.updateListener.of((vu) => {
          if (vu.docChanged && !suppressSyncRef.current) {
            const path = host.getActivePath();
            if (path) host.setContent(path, vu.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    setEditorView(view);
    view.focus();

    return () => {
      view.destroy();
      setEditorView(null);
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the active file changes (or a version is restored), swap the document.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !activePath) return;
    const activeContent = host.getContent(activePath);
    const pathChanged = prevPathRef.current !== activePath;
    suppressSyncRef.current = true;
    const current = view.state.doc.toString();
    const lang = languageForPath(activePath);
    const effects = [langCompartmentRef.current!.reconfigure(lang ? lang : [])];
    effects.push(
      sourceToolsCompartmentRef.current!.reconfigure(
        isLatexSourcePath(activePath)
          ? [
              latexFolding(),
              autocompletion({
                override: [latexCompletions, slashCompletions],
                activateOnTyping: true,
                closeOnBlur: true,
              }),
              mathHover(),
              createLatexLinter(),
            ]
          : [],
      ),
    );
    effects.push(
      hostToolsCompartmentRef.current!.reconfigure(extraExtensionsForPath?.(activePath) ?? []),
    );
    effects.push(
      spellCompartmentRef.current!.reconfigure(
        isProseSourcePath(activePath) && (spellcheck || harper)
          ? spellLintExtensions({ spell: spellcheck, harper })
          : [],
      ),
    );
    // Drop the undo history when moving to a different file, so undo/redo never
    // crosses file boundaries (a change from file A must not replay into file B).
    if (pathChanged) {
      effects.push(historyCompartmentRef.current!.reconfigure([]));
    }
    if (current !== activeContent) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: activeContent },
        effects,
      });
    } else {
      view.dispatch({ effects });
    }
    // Re-install a fresh, empty history for the new file.
    if (pathChanged) {
      view.dispatch({ effects: historyCompartmentRef.current!.reconfigure(history()) });
    }
    prevPathRef.current = activePath;
    queueMicrotask(() => {
      suppressSyncRef.current = false;
    });
    view.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, docVersion]);

  // Toggle vim without recreating the editor.
  useEffect(() => {
    const view = viewRef.current;
    const compartment = vimCompartmentRef.current;
    if (!view || !compartment) return;
    view.dispatch({
      effects: compartment.reconfigure(vimEnabled ? vim() : []),
    });
  }, [vimEnabled]);

  // Toggle spellcheck / Harper grammar without recreating the editor.
  useEffect(() => {
    const view = viewRef.current;
    const compartment = spellCompartmentRef.current;
    if (!view || !compartment) return;
    view.dispatch({
      effects: compartment.reconfigure(
        isProseSourcePath(host.getActivePath()) && (spellcheck || harper)
          ? spellLintExtensions({ spell: spellcheck, harper })
          : []
      ),
    });
  }, [spellcheck, harper]);

  // Re-lint when the ignore dictionary or lint-category mutes change (e.g. the
  // user un-ignores a word or toggles a category in Settings).
  useEffect(() => {
    refreshEditorLints(viewRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, lintDeps);

  return <div ref={hostRef} className="h-full overflow-auto" />;
}
