import { useEffect, useLayoutEffect, useRef } from "react";
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
  type CompletionSource,
} from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { setDiagnostics } from "@codemirror/lint";
import { vim } from "@replit/codemirror-vim";

import { vscodeSearch } from "./search-panel";
import { editorTheme } from "./theme";
import {
  latexCommandCompletions,
  latexCompletions,
  slashCompletions,
} from "./latex";
import { languageForPath } from "./languages";
import { setEditorDocumentPath, setEditorView } from "./controller";
import {
  cancelSourceProofreading,
  diagnosticPresentationExtensions,
  refreshEditorProofreadingPresentation,
  spellLintExtensions,
  refreshEditorLints,
} from "./spellcheck";
import { liveMathPreview } from "./math-preview";
import { createLatexLinter } from "./latex-linter";
import { latexFolding } from "./latex-folding";
import { foldMarkerDOM, foldMarkerTheme } from "./fold-marker";

// The use* members are React hooks: must follow hook rules, and the host
// object identity must stay stable across renders.
export interface EditorHost {
  useActivePath(): string | null;
  getActivePath(): string | null;
  useDocVersion(): number;
  getContent(path: string): string;
  setContent(path: string, content: string): void;
  useSettings(): { vim: boolean; spellcheck: boolean; harper: boolean; editorTheme: string };
  useLintRefreshDeps(): readonly unknown[];
}

export const isLatexSourcePath = (path: string | null): boolean =>
  !!path && /\.(?:tex|latex|ltx|sty|cls)$/i.test(path);
export const isProseSourcePath = (path: string | null): boolean =>
  !!path && /\.(?:tex|latex|ltx|md|markdown|typ)$/i.test(path);
const isLatexDocumentPath = (path: string | null): boolean =>
  !!path && /\.(?:tex|latex|ltx)$/i.test(path);
const isMarkdownDocumentPath = (path: string | null): boolean =>
  !!path && /\.(?:md|markdown)$/i.test(path);

function sourceToolsForPath(
  path: string | null,
  completionSources: CompletionSource[],
): Extension[] {
  const mathPreview = isLatexDocumentPath(path)
    ? [liveMathPreview("latex")]
    : isMarkdownDocumentPath(path)
      ? [liveMathPreview("markdown")]
      : [];

  if (isLatexSourcePath(path)) {
    return [
      latexFolding(),
      autocompletion({
        override: [
          ...completionSources,
          completionSources.length > 0
            ? latexCommandCompletions
            : latexCompletions,
          slashCompletions,
        ],
        activateOnTyping: true,
        closeOnBlur: true,
      }),
      ...mathPreview,
      createLatexLinter(),
    ];
  }

  return [
    ...mathPreview,
    ...(completionSources.length > 0
      ? [
          autocompletion({
            override: completionSources,
            activateOnTyping: true,
            closeOnBlur: true,
          }),
        ]
      : []),
  ];
}

export function CodeMirrorEditor({
  active = true,
  host,
  extraExtensions,
  extraExtensionsForPath,
  extraCompletionSourcesForPath,
  extraKeymap,
}: {
  active?: boolean;
  host: EditorHost;
  extraExtensions?: Extension[];
  extraExtensionsForPath?: (path: string | null) => Extension[];
  extraCompletionSourcesForPath?: (path: string | null) => CompletionSource[];
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
  const { vim: vimEnabled, spellcheck, harper, editorTheme: editorThemeId } = host.useSettings();
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
    const initialCompletionSources =
      extraCompletionSourcesForPath?.(initialPath) ?? [];

    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        foldGutter({ markerDOM: foldMarkerDOM }),
        foldMarkerTheme,
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
        ...diagnosticPresentationExtensions(),
        EditorView.lineWrapping,
        langCompartment.of(initialLang ? initialLang : []),
        editorTheme(),
        historyCompartment.of(history()),
        vscodeSearch(),
        sourceToolsCompartment.of(
          sourceToolsForPath(initialPath, initialCompletionSources),
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
    setEditorDocumentPath(initialPath);
    view.focus();

    return () => {
      cancelSourceProofreading(prevPathRef.current ?? undefined);
      setEditorDocumentPath(null);
      view.destroy();
      setEditorView(null);
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the source editor mounted at its real panel dimensions while Visual
  // mode is active. CodeMirror virtualizes its document using measured line
  // heights, so mounting it under `display: none` (zero width/height) can feed
  // invalid wrap and block-widget measurements into the height map. Once the
  // source pane becomes visible, measure before the browser paints the next
  // frame; this preserves the document, selection, history, and extension
  // state without recreating the editor.
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!active || !view) return;
    view.requestMeasure();
    const frame = requestAnimationFrame(() => view.requestMeasure());
    return () => cancelAnimationFrame(frame);
  }, [active]);

  // When the active file changes (or a version is restored), swap the document.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (!activePath) {
      // A direct project switch keeps this React component mounted while the
      // files store intentionally passes through an empty state. Treat that
      // as a hard document boundary: otherwise the previous project's
      // diagnostics and pending proofreading actions can survive until the
      // next project opens another file with the same path (usually
      // `main.tex`).
      cancelSourceProofreading(prevPathRef.current ?? undefined);
      suppressSyncRef.current = true;
      view.dispatch(setDiagnostics(view.state, []));
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: "",
        },
        effects: [
          langCompartmentRef.current!.reconfigure([]),
          sourceToolsCompartmentRef.current!.reconfigure([]),
          hostToolsCompartmentRef.current!.reconfigure([]),
          spellCompartmentRef.current!.reconfigure([]),
          historyCompartmentRef.current!.reconfigure([]),
        ],
      });
      view.dispatch({
        effects: historyCompartmentRef.current!.reconfigure(
          history(),
        ),
      });
      prevPathRef.current = null;
      setEditorDocumentPath(null);
      queueMicrotask(() => {
        suppressSyncRef.current = false;
      });
      return;
    }
    const activeContent = host.getContent(activePath);
    const pathChanged = prevPathRef.current !== activePath;
    if (pathChanged && prevPathRef.current) {
      cancelSourceProofreading(prevPathRef.current);
    }
    suppressSyncRef.current = true;
    const current = view.state.doc.toString();
    const lang = languageForPath(activePath);
    const completionSources =
      extraCompletionSourcesForPath?.(activePath) ?? [];
    const effects = [langCompartmentRef.current!.reconfigure(lang ? lang : [])];
    effects.push(
      sourceToolsCompartmentRef.current!.reconfigure(
        sourceToolsForPath(activePath, completionSources),
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
    setEditorDocumentPath(activePath);
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
    if (!spellcheck && !harper) {
      cancelSourceProofreading(host.getActivePath() ?? undefined);
    }
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

  // App-level proofreading preferences that do not affect editor construction
  // (for example, the selected English dialect) request a lightweight re-lint.
  useEffect(() => {
    const refreshSettings = () => refreshEditorLints(viewRef.current);
    const refreshPresentation = () =>
      refreshEditorProofreadingPresentation(viewRef.current);
    window.addEventListener(
      "oleafly:proofreading-settings-changed",
      refreshSettings,
    );
    window.addEventListener(
      "oleafly:proofreading-presentation-changed",
      refreshPresentation,
    );
    return () => {
      window.removeEventListener(
        "oleafly:proofreading-settings-changed",
        refreshSettings,
      );
      window.removeEventListener(
        "oleafly:proofreading-presentation-changed",
        refreshPresentation,
      );
    };
  }, []);

  return (
    <div
      ref={hostRef}
      data-editor-active={active ? "true" : "false"}
      data-editor-theme={editorThemeId}
      className="h-full min-h-0 overflow-hidden"
    />
  );
}
