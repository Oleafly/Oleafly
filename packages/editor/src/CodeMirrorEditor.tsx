import { useEffect, useLayoutEffect, useRef } from "react";
import {
  EditorState,
  Compartment,
  Prec,
  type Extension,
} from "@codemirror/state";
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
import { CodeMirror, getCM, vim } from "@replit/codemirror-vim";

import { highlightActiveLineWhenCollapsed } from "./active-line";
import type { EditorTranslator } from "./messages";
import { vscodeSearch } from "./search-panel";
import { editorTheme } from "./theme";
import {
  latexCommandCompletions,
  latexCompletions,
  slashCompletions,
} from "./latex";
import { languageForPath } from "./languages";
import { openEnvironmentCompletion } from "./latex-environments";
import { latexPairInputHandler, latexPairKeymap } from "./latex-pairs";
import { setEditorDocumentPath, setEditorView } from "./controller";
import {
  cancelSourceProofreading,
  clearEditorProofreadingDiagnostics,
  diagnosticPresentationExtensions,
  refreshEditorProofreadingPresentation,
  spellLintExtensions,
  refreshEditorLints,
} from "./spellcheck";
import { liveMathPreview } from "./math-preview";
import { createLatexLinter } from "./latex-linter";
import { bibtexCompletions } from "./bibtex-completions";
import { createBibtexLinter } from "./bibtex-linter";
import { latexFolding } from "./latex-folding";
import { ghostCompletion } from "./ghost-completion";
import { stickyScroll } from "./sticky-scroll";
import { foldMarkerDOM, foldMarkerTheme } from "./fold-marker";
import { gateCompletionSource, type CompletionSyntax } from "./completion-trigger";
import { editorCommandKeymap, type EditorCommandId } from "./editor-commands";
import { emacsModeExtension } from "./emacs-mode";
import { registerHostSave, runHostSave, unregisterHostSave } from "./host-save";

export type EditorKeymapMode = "default" | "vim" | "emacs";

// The use* members are React hooks: must follow hook rules, and the host
// object identity must stay stable across renders.
export interface EditorHost {
  t: EditorTranslator;
  useActivePath(): string | null;
  getActivePath(): string | null;
  useDocVersion(): number;
  useCompletionSyntax(path: string | null): CompletionSyntax;
  getContent(path: string): string;
  setContent(path: string, content: string): void;
  saveActive?(): void;
  isEditLocked?(): boolean;
  registerMutationOwner?(owner: {
    setLocked: (locked: boolean) => void;
    reconcile: () => void;
  }): () => void;
  useSettings(): {
    keymap: EditorKeymapMode;
    spellcheck: boolean;
    harper: boolean;
    editorTheme: string;
    tabSize: number;
    lineWrap: boolean;
    /** Completion popups while typing; explicit Ctrl+Space always works. */
    autocomplete: boolean;
    /** Auto-insert closing brackets, parentheses, and quotes. */
    autoCloseBrackets: boolean;
    autoCloseMath?: boolean;
    /** Keep the cursor solid instead of blinking. */
    nonBlinkingCursor: boolean;
    /** Dim inline preview of the top completion, accepted with Tab. */
    ghostCompletion: boolean;
    /** Pin the enclosing sections and environments to the top while scrolling. */
    stickyScroll: boolean;
  };
  useLintRefreshDeps(): readonly unknown[];
  useEditorKeymap(): Readonly<Partial<Record<EditorCommandId, string>>>;
}

// codemirror-vim's built-in :write/:w command calls this CM5-compatible save
// hook. Route it back to the host that owns the EditorView so the reusable
// editor package does not need to know about the app's file store.
CodeMirror.commands.save = (cm: CodeMirror) => {
  runHostSave(cm.cm6);
};

const runVimHistory = (
  view: EditorView,
  command: "undo" | "redo",
): boolean => {
  const cm = getCM(view);
  if (!cm?.state.vim) return false;
  cm.operation(() => CodeMirror.commands[command](cm));
  return true;
};

const vimHostHistoryGuard: KeyBinding[] = [
  { key: "Mod-z", run: (view) => runVimHistory(view, "undo") },
  { key: "Mod-Shift-z", run: (view) => runVimHistory(view, "redo") },
  ...["Ctrl-y", "Mod-y"].map((key) => ({
    key,
    run: (view: EditorView) => Boolean(getCM(view)?.state.vim),
  })),
];

const editabilityExtensions = (locked: boolean) => [
  EditorState.readOnly.of(locked),
  EditorView.editable.of(!locked),
];

function vimModeExtension(): Extension {
  // Ghost completion and LaTeX pairing both contain highest-precedence
  // keymaps. Vim must precede those too. If Vim declines a platform history
  // chord (for example Ctrl+Y when it cannot scroll farther), consume it
  // before CodeMirror's ordinary undo/redo map can reinterpret the command.
  return Prec.highest([
    vim({ status: true }),
    keymap.of(vimHostHistoryGuard),
  ]);
}

function keymapModeExtension(mode: EditorKeymapMode): Extension {
  if (mode === "vim") return vimModeExtension();
  if (mode === "emacs") return emacsModeExtension();
  return [];
}

function indentExtensions(tabSize: number): Extension {
  return [indentUnit.of(" ".repeat(tabSize)), EditorState.tabSize.of(tabSize)];
}

export const isLatexSourcePath = (path: string | null): boolean =>
  !!path && /\.(?:tex|latex|ltx|sty|cls)$/i.test(path);
export const isBibtexSourcePath = (path: string | null): boolean =>
  !!path && /\.bib$/i.test(path);
export const isProseSourcePath = (path: string | null): boolean =>
  !!path && /\.(?:tex|latex|ltx|md|markdown|typ)$/i.test(path);
const isLatexDocumentPath = (path: string | null): boolean =>
  !!path && /\.(?:tex|latex|ltx)$/i.test(path);
const isMarkdownDocumentPath = (path: string | null): boolean =>
  !!path && /\.(?:md|markdown)$/i.test(path);

function mathPreviewForPath(path: string | null): Extension[] {
  if (isLatexDocumentPath(path)) return [liveMathPreview("latex")];
  if (isMarkdownDocumentPath(path)) return [liveMathPreview("markdown")];
  return [];
}

function sourceToolsForPath(
  path: string | null,
  completionSyntax: CompletionSyntax,
  completionSources: CompletionSource[],
  ghostCompletionSources: CompletionSource[],
  autocompleteWhileTyping: boolean,
  ghostCompletionEnabled: boolean,
): Extension[] {
  const synchronousSources = new Set(ghostCompletionSources);
  const gatedCompletionSources = completionSources.map((source) =>
    synchronousSources.has(source) ? gateCompletionSource(source, completionSyntax) : source,
  );
  const mathPreview = mathPreviewForPath(path);

  if (isLatexSourcePath(path)) {
    const staticLatexSource =
      completionSources.length > 0 ? latexCommandCompletions : latexCompletions;
    const sources = [
      ...gatedCompletionSources,
      staticLatexSource,
      slashCompletions,
    ];
    const ghostSources = [
      ...ghostCompletionSources,
      staticLatexSource,
      slashCompletions,
    ];
    return [
      latexFolding(),
      // Before autocompletion: both register keymaps at the highest
      // precedence, where the earlier extension wins, and the ghost's Escape
      // has to record its dismissal before the popup consumes the key. Its
      // handlers decline whenever the popup should own the key instead.
      ...(ghostCompletionEnabled ? [ghostCompletion(ghostSources, completionSyntax)] : []),
      autocompletion({
        override: sources,
        activateOnTyping: autocompleteWhileTyping,
        closeOnBlur: true,
      }),
      ...(autocompleteWhileTyping ? [openEnvironmentCompletion] : []),
      ...mathPreview,
      createLatexLinter(),
    ];
  }

  if (isBibtexSourcePath(path)) {
    return [
      ...(ghostCompletionEnabled && ghostCompletionSources.length > 0
        ? [ghostCompletion(ghostCompletionSources, completionSyntax)]
        : []),
      autocompletion({
        override: [
          ...gatedCompletionSources,
          gateCompletionSource(bibtexCompletions, completionSyntax),
        ],
        activateOnTyping: autocompleteWhileTyping,
        closeOnBlur: true,
      }),
      createBibtexLinter(),
    ];
  }

  return [
    ...mathPreview,
    ...(ghostCompletionEnabled && ghostCompletionSources.length > 0
      ? [ghostCompletion(ghostCompletionSources, completionSyntax)]
      : []),
    ...(gatedCompletionSources.length > 0
      ? [
          autocompletion({
            override: gatedCompletionSources,
            activateOnTyping: autocompleteWhileTyping,
            closeOnBlur: true,
          }),
        ]
      : []),
  ];
}

// Sticky scroll reads LaTeX sectioning and environments, so it has nothing to
// pin in a Markdown, BibTeX, or JSON buffer.
function stickyScrollFor(path: string | null): Extension[] {
  return isLatexSourcePath(path) ? [stickyScroll()] : [];
}

// Bracket auto-closing and cursor rendering, both user preferences that must
// reconfigure without recreating the editor.
function editorPrefExtensions(
  path: string | null,
  autoCloseBrackets: boolean,
  autoCloseMath: boolean,
  nonBlinkingCursor: boolean,
): Extension[] {
  const math = autoCloseBrackets && autoCloseMath;
  const latexPairs = isLatexSourcePath(path)
    ? [
        latexPairInputHandler({ math, brackets: autoCloseBrackets }),
        ...(math ? [Prec.highest(keymap.of(latexPairKeymap))] : []),
      ]
    : [];
  return [
    autoCloseBrackets ? closeBrackets() : [],
    ...latexPairs,
    // A zero blink cycle keeps the cursor permanently visible.
    drawSelection(nonBlinkingCursor ? { cursorBlinkRate: 0 } : {}),
  ];
}

export function CodeMirrorEditor({
  active = true,
  host,
  extraExtensions,
  extraExtensionsForPath,
  extraCompletionSourcesForPath,
  extraGhostCompletionSourcesForPath,
  extraKeymap,
}: Readonly<{
  active?: boolean;
  host: EditorHost;
  extraExtensions?: Extension[];
  extraExtensionsForPath?: (path: string | null) => Extension[];
  extraCompletionSourcesForPath?: (path: string | null) => CompletionSource[];
  extraGhostCompletionSourcesForPath?: (path: string | null) => CompletionSource[];
  // Checked before the default keymaps (CodeMirror keymap precedence: earlier
  // extensions in the array win).
  extraKeymap?: KeyBinding[];
}>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const vimCompartmentRef = useRef<Compartment | null>(null);
  const vimModeBridgeRef = useRef<{
    cm: CodeMirror;
    modeHandler: () => void;
    tabHandler: (event: KeyboardEvent) => void;
    view: EditorView;
  } | null>(null);
  const spellCompartmentRef = useRef<Compartment | null>(null);
  const langCompartmentRef = useRef<Compartment | null>(null);
  const historyCompartmentRef = useRef<Compartment | null>(null);
  const sourceToolsCompartmentRef = useRef<Compartment | null>(null);
  const hostToolsCompartmentRef = useRef<Compartment | null>(null);
  const prevPathRef = useRef<string | null>(null);
  const suppressSyncRef = useRef(false);
  const synchronizeRef = useRef<() => void>(() => {});

  const editorPrefsCompartmentRef = useRef<Compartment | null>(null);
  const stickyCompartmentRef = useRef<Compartment | null>(null);
  const editabilityCompartmentRef = useRef<Compartment | null>(null);
  const indentCompartmentRef = useRef<Compartment | null>(null);
  const lineWrapCompartmentRef = useRef<Compartment | null>(null);
  const editorKeymapCompartmentRef = useRef<Compartment | null>(null);
  const activePath = host.useActivePath();
  const completionSyntax = host.useCompletionSyntax(activePath);
  // NB: the active file's content is read imperatively (host.getContent) inside
  // the file-swap effect below, NOT subscribed to. Subscribing here would
  // re-render this component on every keystroke (the store updates on each
  // edit), which is pure waste since CodeMirror owns the document and the
  // effect only needs the content when the file or docVersion actually changes.
  const docVersion = host.useDocVersion();
  const {
    keymap: keymapMode,
    spellcheck,
    harper,
    editorTheme: editorThemeId,
    tabSize,
    lineWrap,
    autocomplete,
    autoCloseBrackets,
    autoCloseMath = true,
    nonBlinkingCursor,
    ghostCompletion: ghostCompletionEnabled,
    stickyScroll: stickyScrollEnabled,
  } = host.useSettings();
  const vimEnabled = keymapMode === "vim";
  const editorKeys = host.useEditorKeymap();
  const editorKeysSignature = JSON.stringify(editorKeys);
  const editorKeysRef = useRef(editorKeys);
  editorKeysRef.current = editorKeys;
  const lintDeps = host.useLintRefreshDeps();

  const detachVimModeBridge = () => {
    const current = vimModeBridgeRef.current;
    if (!current) return;
    current.cm.off("vim-mode-change", current.modeHandler);
    current.view.contentDOM.removeEventListener(
      "keydown",
      current.tabHandler,
      true,
    );
    vimModeBridgeRef.current = null;
  };

  const attachVimModeBridge = (view: EditorView) => {
    const cm = getCM(view);
    if (!cm) {
      view.setTabFocusMode(false);
      return;
    }
    const updateTabFocusMode = () => {
      // Outside insert/replace mode, Tab belongs to browser focus navigation,
      // not indentWithTab. This prevents the upstream normal-mode insertion
      // bug without trapping keyboard users inside the editor.
      view.setTabFocusMode(Boolean(cm.state.vim && !cm.state.vim.insertMode));
    };
    const letNormalModeTabLeaveEditor = (event: KeyboardEvent) => {
      if (
        event.key === "Tab" &&
        cm.state.vim &&
        !cm.state.vim.insertMode
      ) {
        // CodeMirror's built-in tab-focus mode checks keyCode. Some webview
        // automation and assistive input paths report only `key`, so stop its
        // editor listener without canceling the browser's focus traversal.
        event.stopImmediatePropagation();
      }
    };
    cm.on("vim-mode-change", updateTabFocusMode);
    view.contentDOM.addEventListener(
      "keydown",
      letNormalModeTabLeaveEditor,
      true,
    );
    vimModeBridgeRef.current = {
      cm,
      modeHandler: updateTabFocusMode,
      tabHandler: letNormalModeTabLeaveEditor,
      view,
    };
    updateTabFocusMode();
  };

  // Construct during the layout phase. The corrective measurement effect
  // below is also a layout effect and must see a live EditorView on the first
  // active mount; constructing in a passive effect made that measurement run
  // too early and get skipped permanently.
  useLayoutEffect(() => {
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
    const editorPrefsCompartment = new Compartment();
    editorPrefsCompartmentRef.current = editorPrefsCompartment;
    const stickyCompartment = new Compartment();
    stickyCompartmentRef.current = stickyCompartment;
    const indentCompartment = new Compartment();
    indentCompartmentRef.current = indentCompartment;
    const lineWrapCompartment = new Compartment();
    lineWrapCompartmentRef.current = lineWrapCompartment;
    const editorKeymapCompartment = new Compartment();
    editorKeymapCompartmentRef.current = editorKeymapCompartment;
    prevPathRef.current = initialPath;
    const initialLang = initialPath ? languageForPath(initialPath) : null;
    const initialCompletionSources =
      extraCompletionSourcesForPath?.(initialPath) ?? [];
    const initialGhostCompletionSources =
      extraGhostCompletionSourcesForPath?.(initialPath) ?? [];

    const editability = new Compartment();
    editabilityCompartmentRef.current = editability;
    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        vimCompartment.of(keymapModeExtension(keymapMode)),
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        foldGutter({ markerDOM: foldMarkerDOM }),
        foldMarkerTheme,
        editorPrefsCompartment.of(
          editorPrefExtensions(
            initialPath,
            autoCloseBrackets,
            autoCloseMath,
            nonBlinkingCursor,
          ),
        ),
        stickyCompartment.of(
          stickyScrollEnabled ? stickyScrollFor(initialPath) : [],
        ),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        indentCompartment.of(indentExtensions(tabSize)),
        bracketMatching(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLineWhenCollapsed(),
        highlightSelectionMatches(),
        ...diagnosticPresentationExtensions(),
        lineWrapCompartment.of(lineWrap ? EditorView.lineWrapping : []),
        langCompartment.of(initialLang ?? []),
        editorTheme(),
        historyCompartment.of(history()),
        vscodeSearch(host.t),
        sourceToolsCompartment.of(
          sourceToolsForPath(
            initialPath,
            completionSyntax,
            initialCompletionSources,
            initialGhostCompletionSources,
            autocomplete,
            ghostCompletionEnabled,
          ),
        ),
        editability.of(editabilityExtensions(host.isEditLocked?.() ?? false)),
        EditorState.transactionFilter.of((transaction) =>
          transaction.docChanged && host.isEditLocked?.() ? [] : transaction),
        ...(extraExtensions ?? []),
        hostToolsCompartment.of(extraExtensionsForPath?.(initialPath) ?? []),
        keymap.of([...completionKeymap]),
        editorKeymapCompartment.of(keymap.of(editorCommandKeymap(editorKeys))),
        keymap.of([
          ...(extraKeymap ?? []),
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
        ]),
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
    if (host.saveActive) registerHostSave(view, host.saveActive);
    if (vimEnabled) attachVimModeBridge(view);
    setEditorView(view);
    setEditorDocumentPath(initialPath);
    const unregisterMutationOwner = host.registerMutationOwner?.({
      setLocked: (locked) => view.dispatch({ effects: editability.reconfigure(editabilityExtensions(locked)) }),
      reconcile: () => synchronizeRef.current(),
    });
    view.focus();

    return () => {
      unregisterMutationOwner?.();
      cancelSourceProofreading(prevPathRef.current ?? undefined);
      setEditorDocumentPath(null);
      detachVimModeBridge();
      view.setTabFocusMode(false);
      unregisterHostSave(view);
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
  synchronizeRef.current = () => {
    const activePath = host.getActivePath();
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
        filter: false,
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
    const ghostCompletionSources =
      extraGhostCompletionSourcesForPath?.(activePath) ?? [];
    const effects = [langCompartmentRef.current!.reconfigure(lang ?? [])];
    effects.push(
      sourceToolsCompartmentRef.current!.reconfigure(
        sourceToolsForPath(
          activePath,
          completionSyntax,
          completionSources,
          ghostCompletionSources,
          autocomplete,
          ghostCompletionEnabled,
        ),
      ),
      hostToolsCompartmentRef.current!.reconfigure(extraExtensionsForPath?.(activePath) ?? []),
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
    if (editabilityCompartmentRef.current) {
      effects.push(
        editabilityCompartmentRef.current.reconfigure(
          editabilityExtensions(host.isEditLocked?.() ?? false),
        ),
      );
    }
    if (current !== activeContent) {
      view.dispatch({
        filter: false,
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
  };
  useEffect(() => synchronizeRef.current(), [activePath, docVersion]);

  // Sticky scroll depends on both the preference and the file's syntax, and it
  // rebuilds its own scope list on reconfigure, so a single effect covers a
  // toggle and a file swap alike.
  useEffect(() => {
    const view = viewRef.current;
    const compartment = stickyCompartmentRef.current;
    if (!view || !compartment) return;
    view.dispatch({
      effects: compartment.reconfigure(
        stickyScrollEnabled ? stickyScrollFor(activePath) : [],
      ),
    });
  }, [activePath, stickyScrollEnabled]);

  useEffect(() => {
    const view = viewRef.current;
    const compartment = vimCompartmentRef.current;
    if (!view || !compartment) return;
    detachVimModeBridge();
    view.setTabFocusMode(false);
    view.dispatch({
      effects: compartment.reconfigure(keymapModeExtension(keymapMode)),
    });
    if (keymapMode === "vim") attachVimModeBridge(view);
  }, [keymapMode]);

  useEffect(() => {
    const view = viewRef.current;
    const compartment = indentCompartmentRef.current;
    if (!view || !compartment) return;
    view.dispatch({ effects: compartment.reconfigure(indentExtensions(tabSize)) });
  }, [tabSize]);

  useEffect(() => {
    const view = viewRef.current;
    const compartment = lineWrapCompartmentRef.current;
    if (!view || !compartment) return;
    view.dispatch({
      effects: compartment.reconfigure(lineWrap ? EditorView.lineWrapping : []),
    });
    view.requestMeasure();
  }, [lineWrap]);

  useEffect(() => {
    const view = viewRef.current;
    const compartment = editorKeymapCompartmentRef.current;
    if (!view || !compartment) return;
    view.dispatch({
      effects: compartment.reconfigure(
        keymap.of(editorCommandKeymap(editorKeysRef.current)),
      ),
    });
  }, [editorKeysSignature]);

  // Toggle bracket auto-closing and cursor blinking without recreating the
  // editor.
  useEffect(() => {
    const view = viewRef.current;
    const compartment = editorPrefsCompartmentRef.current;
    if (!view || !compartment) return;
    view.dispatch({
      effects: compartment.reconfigure(
        editorPrefExtensions(
          activePath,
          autoCloseBrackets,
          autoCloseMath,
          nonBlinkingCursor,
        ),
      ),
    });
  }, [activePath, autoCloseBrackets, autoCloseMath, nonBlinkingCursor]);

  // Toggle completion-while-typing without recreating the editor. Completions
  // live inside the source-tools compartment, so rebuild it for the current
  // path.
  useEffect(() => {
    const view = viewRef.current;
    const compartment = sourceToolsCompartmentRef.current;
    if (!view || !compartment) return;
    const path = host.getActivePath();
    view.dispatch({
      effects: compartment.reconfigure(
        sourceToolsForPath(
          path,
          completionSyntax,
          extraCompletionSourcesForPath?.(path) ?? [],
          extraGhostCompletionSourcesForPath?.(path) ?? [],
          autocomplete,
          ghostCompletionEnabled,
        ),
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autocomplete, ghostCompletionEnabled, completionSyntax]);

  // Toggle spellcheck / Harper grammar without recreating the editor.
  useEffect(() => {
    const view = viewRef.current;
    const compartment = spellCompartmentRef.current;
    if (!view || !compartment) return;
    if (!spellcheck && !harper) {
      cancelSourceProofreading(host.getActivePath() ?? undefined);
      clearEditorProofreadingDiagnostics(view);
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
    const refreshSettings = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          spellcheck?: boolean;
          harper?: boolean;
        }>
      ).detail;
      if (
        detail?.spellcheck === false &&
        detail.harper === false
      ) {
        // The Settings event is synchronous, while React applies the
        // compartment reconfiguration later. Do not force the still-mounted
        // previous linter to start one final request after both providers have
        // been disabled.
        cancelSourceProofreading();
        clearEditorProofreadingDiagnostics(viewRef.current);
        return;
      }
      refreshEditorLints(viewRef.current);
    };
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
