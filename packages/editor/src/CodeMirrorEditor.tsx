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

import { highlightActiveLineWhenCollapsed } from "./active-line";
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
  clearEditorProofreadingDiagnostics,
  diagnosticPresentationExtensions,
  refreshEditorProofreadingPresentation,
  spellLintExtensions,
  refreshEditorLints,
} from "./spellcheck";
import { liveMathPreview } from "./math-preview";
import { createLatexLinter } from "./latex-linter";
import { latexFolding } from "./latex-folding";
import { ghostCompletion } from "./ghost-completion";
import { foldMarkerDOM, foldMarkerTheme } from "./fold-marker";
import { gateCompletionSource, type CompletionSyntax } from "./completion-trigger";
import type { DocumentSession, TextEdit } from "./document-session";
import {
  collaborationDecorations,
  setCollaboratorSelections,
} from "./collaboration";

// The use* members are React hooks: must follow hook rules, and the host
// object identity must stay stable across renders.
export interface EditorHost {
  useActivePath(): string | null;
  getActivePath(): string | null;
  useProjectId?(): string | null;
  getProjectId?(): string | null;
  useDocVersion(): number;
  useCompletionSyntax(path: string | null): CompletionSyntax;
  getContent(path: string): string;
  setContent(path: string, content: string): void;
  useSettings(): {
    vim: boolean;
    spellcheck: boolean;
    harper: boolean;
    editorTheme: string;
    /** Completion popups while typing; explicit Ctrl+Space always works. */
    autocomplete: boolean;
    /** Auto-insert closing brackets, parentheses, and quotes. */
    autoCloseBrackets: boolean;
    /** Keep the cursor solid instead of blinking. */
    nonBlinkingCursor: boolean;
    /** Dim inline preview of the top completion, accepted with Tab. */
    ghostCompletion: boolean;
  };
  useLintRefreshDeps(): readonly unknown[];
}

export type EditorDocumentAccess =
  | { readonly kind: "solo" }
  | {
      readonly kind: "shared";
      readonly session: DocumentSession | null;
      readonly message: string;
    };

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
  const mathPreview = isLatexDocumentPath(path)
    ? [liveMathPreview("latex")]
    : isMarkdownDocumentPath(path)
      ? [liveMathPreview("markdown")]
      : [];

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
      ...mathPreview,
      createLatexLinter(),
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

// Bracket auto-closing and cursor rendering, both user preferences that must
// reconfigure without recreating the editor.
function editorPrefExtensions(
  autoCloseBrackets: boolean,
  nonBlinkingCursor: boolean,
): Extension[] {
  return [
    autoCloseBrackets ? closeBrackets() : [],
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
  getDocumentSession,
  getDocumentAccess,
}: {
  active?: boolean;
  host: EditorHost;
  extraExtensions?: Extension[];
  extraExtensionsForPath?: (path: string | null) => Extension[];
  extraCompletionSourcesForPath?: (path: string | null) => CompletionSource[];
  extraGhostCompletionSourcesForPath?: (path: string | null) => CompletionSource[];
  // Checked before the default keymaps (CodeMirror keymap precedence: earlier
  // extensions in the array win).
  extraKeymap?: KeyBinding[];
  /** Optional incremental session. Returning null preserves the controlled solo API. */
  getDocumentSession?: (path: string) => DocumentSession | null;
  /** Shared access is fail-closed while its native session is not ready. */
  getDocumentAccess?: (
    projectId: string | null,
    path: string,
  ) => EditorDocumentAccess;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const vimCompartmentRef = useRef<Compartment | null>(null);
  const spellCompartmentRef = useRef<Compartment | null>(null);
  const langCompartmentRef = useRef<Compartment | null>(null);
  const historyCompartmentRef = useRef<Compartment | null>(null);
  const accessCompartmentRef = useRef<Compartment | null>(null);
  const sourceToolsCompartmentRef = useRef<Compartment | null>(null);
  const hostToolsCompartmentRef = useRef<Compartment | null>(null);
  const prevPathRef = useRef<string | null>(null);
  const prevProjectIdRef = useRef<string | null>(null);
  const suppressSyncRef = useRef(false);
  const sessionRef = useRef<DocumentSession | null>(null);
  const sharedRequiredRef = useRef(false);
  const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editorPrefsCompartmentRef = useRef<Compartment | null>(null);
  const activePath = host.useActivePath();
  const projectId = host.useProjectId?.() ?? null;
  const documentAccess = activePath
    ? getDocumentAccess?.(projectId, activePath) ?? {
        kind: "solo" as const,
      }
    : { kind: "solo" as const };
  const completionSyntax = host.useCompletionSyntax(activePath);
  // NB: the active file's content is read imperatively (host.getContent) inside
  // the file-swap effect below, NOT subscribed to. Subscribing here would
  // re-render this component on every keystroke (the store updates on each
  // edit), which is pure waste since CodeMirror owns the document and the
  // effect only needs the content when the file or docVersion actually changes.
  const docVersion = host.useDocVersion();
  const {
    vim: vimEnabled,
    spellcheck,
    harper,
    editorTheme: editorThemeId,
    autocomplete,
    autoCloseBrackets,
    nonBlinkingCursor,
    ghostCompletion: ghostCompletionEnabled,
  } = host.useSettings();
  const lintDeps = host.useLintRefreshDeps();

  // Construct during the layout phase. The corrective measurement effect
  // below is also a layout effect and must see a live EditorView on the first
  // active mount; constructing in a passive effect made that measurement run
  // too early and get skipped permanently.
  useLayoutEffect(() => {
    if (!hostRef.current) return;
    const initialPath = host.getActivePath();
    const initialProjectId = host.getProjectId?.() ?? null;
    const initialAccess = initialPath
      ? getDocumentAccess?.(initialProjectId, initialPath) ?? { kind: "solo" as const }
      : { kind: "solo" as const };
    const initialSession = initialPath
      ? initialAccess.kind === "shared"
        ? initialAccess.session
        : getDocumentSession?.(initialPath) ?? null
      : null;
    sessionRef.current = initialSession;
    sharedRequiredRef.current = initialAccess.kind === "shared";
    const initialContent = initialSession?.snapshot().text ?? (initialPath ? host.getContent(initialPath) : "");
    const vimCompartment = new Compartment();
    vimCompartmentRef.current = vimCompartment;
    const spellCompartment = new Compartment();
    spellCompartmentRef.current = spellCompartment;
    const langCompartment = new Compartment();
    langCompartmentRef.current = langCompartment;
    const historyCompartment = new Compartment();
    historyCompartmentRef.current = historyCompartment;
    const accessCompartment = new Compartment();
    accessCompartmentRef.current = accessCompartment;
    const sourceToolsCompartment = new Compartment();
    sourceToolsCompartmentRef.current = sourceToolsCompartment;
    const hostToolsCompartment = new Compartment();
    hostToolsCompartmentRef.current = hostToolsCompartment;
    const editorPrefsCompartment = new Compartment();
    editorPrefsCompartmentRef.current = editorPrefsCompartment;
    prevPathRef.current = initialPath;
    prevProjectIdRef.current = initialProjectId;
    const initialLang = initialPath ? languageForPath(initialPath) : null;
    const initialCompletionSources =
      extraCompletionSourcesForPath?.(initialPath) ?? [];
    const initialGhostCompletionSources =
      extraGhostCompletionSourcesForPath?.(initialPath) ?? [];

    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        foldGutter({ markerDOM: foldMarkerDOM }),
        foldMarkerTheme,
        editorPrefsCompartment.of(
          editorPrefExtensions(autoCloseBrackets, nonBlinkingCursor),
        ),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        indentUnit.of("    "),
        bracketMatching(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLineWhenCollapsed(),
        highlightSelectionMatches(),
        ...diagnosticPresentationExtensions(),
        EditorView.lineWrapping,
        langCompartment.of(initialLang ? initialLang : []),
        editorTheme(),
        collaborationDecorations(),
        accessCompartment.of(
          initialAccess.kind === "shared" && !initialAccess.session
            ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
            : [],
        ),
        historyCompartment.of(history()),
        vscodeSearch(),
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
        ...(extraExtensions ?? []),
        hostToolsCompartment.of(extraExtensionsForPath?.(initialPath) ?? []),
        keymap.of([
          {
            key: "Mod-z",
            run: () => {
              const session = sessionRef.current;
              if (session?.mode !== "shared") return false;
              session.undo();
              return true;
            },
          },
          {
            key: "Mod-Shift-z",
            run: () => {
              const session = sessionRef.current;
              if (session?.mode !== "shared") return false;
              session.redo();
              return true;
            },
          },
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
            const session = sessionRef.current;
            if (path && session) {
              const edits: TextEdit[] = [];
              vu.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
                edits.push({ from: fromA, to: toA, insert: inserted.toString() });
              });
              session.apply(edits, { origin: "human" });
            } else if (path) {
              if (!sharedRequiredRef.current) {
                host.setContent(path, vu.state.doc.toString());
              }
            }
          }
          if ((vu.selectionSet || vu.docChanged) && !suppressSyncRef.current) {
            const session = sessionRef.current;
            if (!session?.updateLocalSelection) return;
            if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current);
            const selection = vu.state.selection.main;
            const capturedSession = session;
            const capturedAnchor = selection.anchor;
            const capturedHead = selection.head;
            selectionTimerRef.current = setTimeout(() => {
              selectionTimerRef.current = null;
              if (sessionRef.current === capturedSession) {
                capturedSession.updateLocalSelection?.(capturedAnchor, capturedHead);
              }
            }, 50);
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
      if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current);
      sessionRef.current?.updateLocalSelection?.(null, null);
      setEditorView(null);
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bind the active CodeMirror document to the incremental session. Remote
  // changes are dispatched as exact edits and suppressed from the local path.
  useEffect(() => {
    const view = viewRef.current;
    if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current);
    selectionTimerRef.current = null;
    const previousSession = sessionRef.current;
    const session = activePath
      ? documentAccess.kind === "shared"
        ? documentAccess.session
        : getDocumentSession?.(activePath) ?? null
      : null;
    if (previousSession && previousSession !== session) {
      previousSession.updateLocalSelection?.(null, null);
    }
    sessionRef.current = session;
    sharedRequiredRef.current = documentAccess.kind === "shared";
    if (!view || !session) {
      if (view) {
        view.dispatch({
          effects: [
            setCollaboratorSelections.of([]),
            accessCompartmentRef.current!.reconfigure(
              documentAccess.kind === "shared"
                ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
                : [],
            ),
          ],
        });
      }
      return;
    }
    view.dispatch({
      effects: accessCompartmentRef.current!.reconfigure([]),
    });
    const sessionText = session.snapshot().text;
    if (view.state.doc.toString() !== sessionText) {
      suppressSyncRef.current = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: sessionText },
      });
      queueMicrotask(() => {
        suppressSyncRef.current = false;
      });
    }
    if (session.mode === "shared") {
      view.dispatch({ effects: historyCompartmentRef.current!.reconfigure([]) });
    }
    const unsubscribe = session.subscribe((change) => {
      if (change.source !== "remote" || change.edits.length === 0) return;
      suppressSyncRef.current = true;
      view.dispatch({ changes: change.edits });
      queueMicrotask(() => {
        suppressSyncRef.current = false;
      });
    });
    const publishPresence = () => {
      view.dispatch({
        effects: setCollaboratorSelections.of(session.collaborators?.() ?? []),
      });
    };
    publishPresence();
    const unsubscribePresence = session.subscribeCollaborators?.(publishPresence);
    return () => {
      unsubscribe();
      unsubscribePresence?.();
      session.updateLocalSelection?.(null, null);
      if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current);
      selectionTimerRef.current = null;
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [
    activePath,
    projectId,
    docVersion,
    getDocumentSession,
    documentAccess.kind,
    documentAccess.kind === "shared" ? documentAccess.session : null,
  ]);

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
      prevProjectIdRef.current = projectId;
      sharedRequiredRef.current = false;
      setEditorDocumentPath(null);
      queueMicrotask(() => {
        suppressSyncRef.current = false;
      });
      return;
    }
    if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current);
    selectionTimerRef.current = null;
    const nextSession =
      documentAccess.kind === "shared"
        ? documentAccess.session
        : getDocumentSession?.(activePath) ?? null;
    sessionRef.current = nextSession;
    sharedRequiredRef.current = documentAccess.kind === "shared";
    const activeContent = nextSession?.snapshot().text ?? host.getContent(activePath);
    const pathChanged =
      prevPathRef.current !== activePath || prevProjectIdRef.current !== projectId;
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
    const effects = [langCompartmentRef.current!.reconfigure(lang ? lang : [])];
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
    if (pathChanged && nextSession?.mode !== "shared") {
      view.dispatch({ effects: historyCompartmentRef.current!.reconfigure(history()) });
    }
    prevPathRef.current = activePath;
    prevProjectIdRef.current = projectId;
    setEditorDocumentPath(activePath);
    queueMicrotask(() => {
      suppressSyncRef.current = false;
    });
    view.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, projectId, docVersion]);

  // Toggle vim without recreating the editor.
  useEffect(() => {
    const view = viewRef.current;
    const compartment = vimCompartmentRef.current;
    if (!view || !compartment) return;
    view.dispatch({
      effects: compartment.reconfigure(vimEnabled ? vim() : []),
    });
  }, [vimEnabled]);

  // Toggle bracket auto-closing and cursor blinking without recreating the
  // editor.
  useEffect(() => {
    const view = viewRef.current;
    const compartment = editorPrefsCompartmentRef.current;
    if (!view || !compartment) return;
    view.dispatch({
      effects: compartment.reconfigure(
        editorPrefExtensions(autoCloseBrackets, nonBlinkingCursor),
      ),
    });
  }, [autoCloseBrackets, nonBlinkingCursor]);

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
    <div className="relative h-full min-h-0 overflow-hidden">
      <div
        ref={hostRef}
        data-editor-active={active ? "true" : "false"}
        data-editor-theme={editorThemeId}
        data-document-access={documentAccess.kind}
        className="h-full min-h-0 overflow-hidden"
      />
      {documentAccess.kind === "shared" && !documentAccess.session ? (
        <div
          className="absolute inset-x-0 top-0 z-10 border-b bg-background/95 px-3 py-2 text-xs text-muted-foreground"
          data-testid="shared-source-readonly"
        >
          {documentAccess.message}
        </div>
      ) : null}
    </div>
  );
}
