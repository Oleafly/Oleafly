import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { isEditorMutationLocked, registerEditorMutationOwner } from "@/lib/editor-mutation-lease";
import { activeFileReadOnly, useActiveFileReadOnly } from "@/lib/read-only-files";
import { collabVisualReadOnly, useCollabVisualReadOnly } from "@/lib/collab-live-bridge";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { renderMathExpression } from "@oleafly/editor/math-render";
import { scanMathExpressions } from "@oleafly/editor/math-source";
import {
  createMarkdownSourceSnapshot,
  createWysiwygExtensions,
  parseLatexBody,
  serializeLatexBody,
  splitLatexDocument,
  joinLatexDocument,
  parseMarkdownBody,
  serializeMarkdownBody,
  theoremEnvironmentsFromPreamble,
  type LatexDocumentSplit,
  type MarkdownSourceSnapshot,
} from "@oleafly/wysiwyg";
import { useFilesStore } from "@/store/files";
import { useVisualModeStore } from "@/store/visual-mode";
import { useDictionary } from "@/lib/dictionary";
import { cancelProofreading } from "@/lib/proofreading/client";
import { useSettingsStore } from "@/store/settings";
import { Button } from "@/components/ui/button";
import { editorRedo, editorUndo } from "@/components/editor/cm/controller";
import { isRecompileShortcut } from "@/components/editor/cm/recompile-shortcut";
import {
  getWysiwygProjectSessionGeneration,
  setWysiwygDocument,
  setWysiwygDocumentContext,
  setWysiwygEditor,
  setWysiwygFlushController,
  setWysiwygInsertions,
  setWysiwygProjectNavigation,
  setWysiwygVisible,
  type WysiwygDocumentContext,
} from "./controller";
import { visualInsertions } from "./insert";
import {
  findVisualReferences,
  goToVisualDefinition,
  refreshVisualProjectIntelligence,
  VisualProjectIntelligence,
} from "./project-intelligence";
import { useIndexStore } from "@/store/project-index";
import { resolveVisualAssetUrl } from "./asset-url";
import { localizedVisualHref, openVisualLinkHref } from "@/features/file-links";
import { createVisualPasteHandlers } from "./paste";
import {
  isVisualProofreadingIssueCurrent,
  refreshVisualProofreading,
  setVisualProofreadingIssueListener,
  type VisualProofreadingIssue,
  VisualProofreading,
} from "./proofreading";
import { ProofreadingPopover } from "./ProofreadingPopover";
import { scrollVisualSelectionLocally } from "./scroll";
import { markdownMathRanges } from "./markdown-source";
import { resetDesktopDocumentScroll } from "@/lib/desktop-viewport";
import { publishVisualEditorHistory } from "@/components/editor/history-signal";

function isMarkdownPath(path: string): boolean {
  const p = path.toLowerCase();
  return p.endsWith(".md") || p.endsWith(".markdown");
}

const FLUSH_DEBOUNCE_MS = 300;
const FOLLOW_REMOTE_MS = 150;
const EXTERNAL_DOCUMENT_SYNC = "oleaflyExternalDocumentSync";
const BOOKTABS_PACKAGE = /\\usepackage\s*(?:\[[^\]]*\]\s*)?\{[^}]*\bbooktabs\b[^}]*\}/u;
const PACKAGE_EXTENSIONS = createWysiwygExtensions({
  renderMath: renderMathExpression,
  resolveAssetUrl: resolveVisualAssetUrl,
  localizeLinkHref: localizedVisualHref,
  openLinkHref: openVisualLinkHref,
});
const PASTE_HANDLERS = createVisualPasteHandlers();

export function documentContextForPreamble(preamble: string): WysiwygDocumentContext {
  return {
    theoremEnvironments: theoremEnvironmentsFromPreamble(preamble),
    booktabs: BOOKTABS_PACKAGE.test(preamble),
  };
}
function visualReadOnly(projectId: string | null): boolean {
  return activeFileReadOnly() || collabVisualReadOnly(projectId);
}

const ExternalMutationGate = Extension.create({
  name: "externalMutationGate",
  addProseMirrorPlugins() {
    return [new Plugin({
      filterTransaction: (transaction) => !transaction.docChanged ||
        transaction.getMeta(EXTERNAL_DOCUMENT_SYNC) === true ||
        (!isEditorMutationLocked(useFilesStore.getState().projectId) &&
          !visualReadOnly(useFilesStore.getState().projectId)),
    })];
  },
});

function replaceContentAndResetHistory(editor: Editor, content: Parameters<Editor["commands"]["setContent"]>[0]) {
  editor.chain().setContent(content, { emitUpdate: false }).setMeta("addToHistory", false).setMeta(EXTERNAL_DOCUMENT_SYNC, true).run();

  const plugins = editor.state.plugins;
  const resetState = editor.state.reconfigure({ plugins: [] }).reconfigure({ plugins });
  editor.view.updateState(resetState);
}

export function WysiwygEditor({ wysiwyg }: Readonly<{ wysiwyg: boolean }>) {
  const { t } = useTranslation(["common", "editor"]);
  const synchronizeRef = useRef<() => void>(() => {});
  const projectId = useFilesStore((s) => s.projectId);
  const activePath = useFilesStore((s) => s.activePath);
  const docVersion = useFilesStore((s) => s.docVersion);
  const saveFile = useFilesStore((s) => s.saveFile);
  const collabReadOnly = useCollabVisualReadOnly(projectId);
  const readOnly = useActiveFileReadOnly() || collabReadOnly;
  const latexSplitRef = useRef<LatexDocumentSplit | null>(null);
  const frontmatterRef = useRef("");
  const markdownSourceRef = useRef<MarkdownSourceSnapshot | null>(null);
  const activePathRef = useRef<string | null>(null);
  activePathRef.current = activePath;
  const projectIdRef = useRef<string | null>(null);
  projectIdRef.current = projectId;
  const wysiwygRef = useRef(wysiwyg);
  wysiwygRef.current = wysiwyg;
  const intelligenceRevisionRef = useRef("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visualDirtyRef = useRef(false);
  const preambleRef = useRef("");
  const lastSyncedTextRef = useRef<string | null>(null);
  const lastSyncedPathRef = useRef<string | null>(null);
  const [preamble, setPreamble] = useState("");
  const [hasDocumentEnv, setHasDocumentEnv] = useState(false);
  const [showPreamble, setShowPreamble] = useState(false);
  const [proofreadingIssue, setProofreadingIssue] =
    useState<VisualProofreadingIssue | null>(null);
  const closeProofreading = useCallback(
    () => setProofreadingIssue(null),
    [],
  );
  const spellcheck = useSettingsStore((state) => state.spellcheck);
  const harper = useSettingsStore((state) => state.harper);
  const showRegionalism = useSettingsStore(
    (state) => state.showRegionalism,
  );
  const showWordChoice = useSettingsStore(
    (state) => state.showWordChoice,
  );
  const grammarDialect = useSettingsStore((state) => state.grammarDialect);
  const dictionaryLocale = useSettingsStore(
    (state) => state.dictionaryLocale,
  );
  const globalDictionary = useDictionary((state) => state.global);
  const projectDictionary = useDictionary((state) => state.ignored);
  const intelligenceState = useIndexStore(
    (state) => state.intelligenceState,
  );
  const intelligenceIdentity = intelligenceState.identity;
  const intelligenceRevision = [
    intelligenceState.status,
    intelligenceState.stale ? "stale" : "fresh",
    intelligenceIdentity?.projectId ?? "",
    intelligenceIdentity?.projectRevision ?? 0,
    intelligenceIdentity?.requestGeneration ?? 0,
  ].join(":");
  intelligenceRevisionRef.current = `${activePath ?? ""}:${intelligenceRevision}`;

  const flush = useCallback((
    editorInstance: Editor,
    target?: { path: string | null; projectId: string | null },
  ): boolean => {
    const { path, projectId: targetProjectId } = target ?? {
      path: activePathRef.current,
      projectId: projectIdRef.current,
    };
    const filesState = useFilesStore.getState();
    if (
      !path ||
      filesState.projectId !== targetProjectId ||
      !filesState.files[path] ||
      !visualDirtyRef.current
    ) {
      return false;
    }
    const json = editorInstance.getJSON();
    let nextSource: string;
    if (isMarkdownPath(path)) {
      const body = serializeMarkdownBody(json, markdownSourceRef.current);
      const frontmatter = frontmatterRef.current;
      nextSource = frontmatter ? `${frontmatter}\n\n${body}` : body;
    } else {
      const body = serializeLatexBody(json);
      const split = latexSplitRef.current;
      nextSource = split
        ? joinLatexDocument({ ...split, preamble: preambleRef.current, body })
        : body;
    }
    lastSyncedTextRef.current = nextSource;
    lastSyncedPathRef.current = path;
    visualDirtyRef.current = false;
    filesState.setContent(path, nextSource, { bumpVersion: true });
    return true;
  }, []);
  const editor = useEditor({
    extensions: [
      ...PACKAGE_EXTENSIONS,
      ExternalMutationGate,
      VisualProjectIntelligence,
      VisualProofreading,
    ],
    content: { type: "doc", content: [{ type: "paragraph" }] },
    immediatelyRender: false,
    editorProps: {
      handleScrollToSelection:
        scrollVisualSelectionLocally,
      handlePaste: PASTE_HANDLERS.handlePaste,
      handleDrop: PASTE_HANDLERS.handleDrop,
      handleKeyDown: (_view, event) => {
        // The recompile chord belongs to App.tsx. Claiming it here runs before
        // the HardBreak keymap (Mod-Enter), so it no longer adds a line break;
        // ProseMirror only calls preventDefault, so App still compiles.
        if (isRecompileShortcut(event)) return true;
        if (!(event.metaKey || event.ctrlKey)) return false;
        const key = event.key.toLowerCase();
        if (key === "z" && !event.shiftKey) {
          event.preventDefault();
          editorUndo();
          return true;
        }
        if ((key === "z" && event.shiftKey) || key === "y") {
          event.preventDefault();
          editorRedo();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: editorInstance }) => {
      visualDirtyRef.current = true;
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(() => flush(editorInstance), FLUSH_DEBOUNCE_MS);
    },
  });

  // WebKit restores ProseMirror's DOM selection after a persisted Visual
  // editor remount. That platform operation can finish after React layout and
  // scroll the browser document by the toolbar height even though ProseMirror's
  // own scroll-to-selection hook is editor-local. Correct only this Visual
  // mount/focus boundary; the application root remains an ordinary DOM layer,
  // so this cannot reproduce the blank WKWebView compositing failure caused by
  // fixed/absolute root positioning and global focus interception.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activePath intentionally retriggers the WebKit shell guard when a persisted Visual editor is rebound to another file
  useLayoutEffect(() => {
    if (!editor || !wysiwyg) return;

    let firstFrame = 0;
    let secondFrame = 0;
    const restoreShell = () => {
      resetDesktopDocumentScroll();
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      firstFrame = requestAnimationFrame(() => {
        resetDesktopDocumentScroll();
        secondFrame = requestAnimationFrame(() => resetDesktopDocumentScroll());
      });
    };

    const editorElement = editor.view.dom;
    editorElement.addEventListener("focusin", restoreShell);
    restoreShell();

    return () => {
      editorElement.removeEventListener("focusin", restoreShell);
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [activePath, editor, wysiwyg]);

  useEffect(() => {
    setWysiwygEditor(editor ?? null);
    setWysiwygInsertions(editor ? visualInsertions : null);
    const publishHistory = () =>
      publishVisualEditorHistory(editor ? { canUndo: editor.can().undo(), canRedo: editor.can().redo() } : null);
    publishHistory();
    editor?.on("transaction", publishHistory);
    const unregisterMutationOwner = editor ? registerEditorMutationOwner({
      projectId: () => projectIdRef.current,
      setLocked: (locked) => editor.setEditable(!locked && !visualReadOnly(projectIdRef.current), false),
      reconcile: () => synchronizeRef.current(),
    }) : undefined;
    setWysiwygFlushController(
      editor
        ? () => {
            if (flushTimerRef.current) {
              clearTimeout(flushTimerRef.current);
              flushTimerRef.current = null;
            }
            if (!wysiwygRef.current) return;
            flush(editor);
          }
        : null,
    );
    setWysiwygProjectNavigation(
      editor
        ? {
            goToDefinition: () => goToVisualDefinition(editor),
            findReferences: () => findVisualReferences(editor),
          }
        : null,
    );
    return () => {
      editor?.off("transaction", publishHistory);
      publishVisualEditorHistory(null);
      unregisterMutationOwner?.();
      setWysiwygProjectNavigation(null);
      setWysiwygFlushController(null);
      setWysiwygInsertions(null);
      setWysiwygEditor(null);
    };
  }, [editor, flush]);

  useEffect(() => {
    if (!editor) return;
    const editable = !readOnly && !isEditorMutationLocked(projectIdRef.current);
    if (editor.isEditable !== editable) editor.setEditable(editable, false);
  }, [editor, readOnly]);

  useEffect(() => {
    setWysiwygVisible(wysiwyg);
    if (!editor) return;
    if (!wysiwyg) {
      cancelProofreading("visual", activePath ?? undefined);
      setProofreadingIssue(null);
    }
    refreshVisualProofreading(editor);
  }, [activePath, editor, wysiwyg]);

  useEffect(() => {
    if (!editor) return;
    setVisualProofreadingIssueListener((issue) => {
      if (
        issue &&
        (!wysiwygRef.current ||
          !isVisualProofreadingIssueCurrent(editor, issue))
      ) {
        setProofreadingIssue(null);
        return;
      }
      setProofreadingIssue(issue);
    });
    return () => {
      setVisualProofreadingIssueListener(null);
      setProofreadingIssue(null);
    };
  }, [editor]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: see above.
  useEffect(() => {
    if (editor) refreshVisualProofreading(editor);
  }, [
    editor,
    spellcheck,
    harper,
    showRegionalism,
    showWordChoice,
    grammarDialect,
    dictionaryLocale,
    globalDictionary,
    projectDictionary,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the analysis-state object/path deliberately retrigger the imperative ProseMirror decoration refresh; their current composite value is held in a ref.
  useEffect(() => {
    if (editor) {
      refreshVisualProjectIntelligence(
        editor,
        intelligenceRevisionRef.current,
      );
    }
  }, [editor, intelligenceState, activePath]);

  synchronizeRef.current = () => {
    const activePath = useFilesStore.getState().activePath;
    if (!editor) return;
    if (!activePath) {
      visualDirtyRef.current = false;
      lastSyncedPathRef.current = null;
      lastSyncedTextRef.current = "";
      markdownSourceRef.current = null;
      replaceContentAndResetHistory(editor, { type: "doc", content: [{ type: "paragraph" }] });
      setWysiwygDocument(editor, null);
      return;
    }
    const raw = useFilesStore.getState().files[activePath]?.content ?? "";
    if (
      activePath === lastSyncedPathRef.current &&
      raw === lastSyncedTextRef.current
    ) {
      return;
    }
    lastSyncedTextRef.current = raw;
    lastSyncedPathRef.current = activePath;
    visualDirtyRef.current = false;
    if (isMarkdownPath(activePath)) {
      const { doc, frontmatter, layout } = parseMarkdownBody(raw, {
        preservedInlineRanges: markdownMathRanges(raw),
      });
      frontmatterRef.current = frontmatter;
      latexSplitRef.current = null;
      preambleRef.current = "";
      setPreamble("");
      setHasDocumentEnv(false);
      setWysiwygDocumentContext(null);
      replaceContentAndResetHistory(editor, doc);
      markdownSourceRef.current = createMarkdownSourceSnapshot(layout, editor.getJSON());
    } else {
      markdownSourceRef.current = null;
      const split = splitLatexDocument(raw);
      latexSplitRef.current = split;
      preambleRef.current = split.preamble;
      setPreamble(split.preamble);
      setHasDocumentEnv(split.hasDocumentEnv);
      frontmatterRef.current = "";
      const context = documentContextForPreamble(split.preamble);
      setWysiwygDocumentContext(context);
      replaceContentAndResetHistory(
        editor,
        parseLatexBody(split.body, {
          preservedInlineRanges: scanMathExpressions(split.body, {
            format: "latex",
          }).map(({ from, to }) => ({ from, to })),
          theoremEnvironments: context.theoremEnvironments,
        }),
      );
    }
    refreshVisualProjectIntelligence(
      editor,
      intelligenceRevisionRef.current,
    );
    setWysiwygDocument(editor, activePath);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: path, visibility and document version deliberately retrigger the imperative editor synchronization.
  useEffect(() => {
    if (!editor) return;
    synchronizeRef.current();
  }, [editor, activePath, wysiwyg, docVersion]);

  useEffect(() => {
    if (!editor || !collabReadOnly || !wysiwyg) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = useFilesStore.subscribe((state, previous) => {
      const path = state.activePath;
      if (!path || state.files[path]?.content === previous.files[path]?.content) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        synchronizeRef.current();
      }, FOLLOW_REMOTE_MS);
    });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [editor, collabReadOnly, wysiwyg]);

  useEffect(() => {
    if (!editor || !activePath) return;
    const path = activePath;
    const sourceProjectId = projectId;
    const sourceSessionGeneration = getWysiwygProjectSessionGeneration();
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (!wysiwygRef.current) return;
      if (
        sourceSessionGeneration !== getWysiwygProjectSessionGeneration()
      ) {
        return;
      }
      if (flush(editor, { path, projectId: sourceProjectId })) {
        void saveFile(path);
      }
    };
  }, [editor, activePath, projectId, saveFile, flush]);

  const onPreambleChange = (value: string) => {
    if (isEditorMutationLocked(projectIdRef.current) || visualReadOnly(projectIdRef.current)) return;
    setPreamble(value);
    preambleRef.current = value;
    setWysiwygDocumentContext(documentContextForPreamble(value));
    visualDirtyRef.current = true;
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      if (editor) flush(editor);
    }, FLUSH_DEBOUNCE_MS);
  };

  return (
    <div className="flex h-full flex-col">
      {collabReadOnly && wysiwyg ? (
        <output
          data-testid="visual-shared-notice"
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm text-muted-foreground"
        >
          <span>{t(($) => $.editor.visual.sharedReadOnly)}</span>
          <Button type="button" variant="outline" size="xs" onClick={() => useVisualModeStore.getState().setEnabled(false)}>
            {t(($) => $.editor.toolbar.switchToSource)}
          </Button>
        </output>
      ) : null}
      <div data-keep-scroll className="wysiwyg-content flex min-h-0 flex-1 flex-col overflow-auto">
        {hasDocumentEnv && (
          <div className="mx-auto w-full max-w-[42rem] px-8 pt-6">
            <div className="rounded-md border border-border">
              <button
                type="button"
                onClick={() => setShowPreamble((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
              >
                {showPreamble
                  ? t(($) => $.editor.visual.hidePreamble)
                  : t(($) => $.editor.visual.showPreamble)}
                {showPreamble ? (
                  <ChevronUp className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
              </button>
              {showPreamble && (
                <textarea
                  value={preamble}
                  readOnly={readOnly}
                  onChange={(e) => onPreambleChange(e.target.value)}
                  spellCheck={false}
                  rows={Math.min(
                    Math.max(preamble.split("\n").length, 3),
                    20,
                  )}
                  className="w-full resize-none border-t border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground"
                />
              )}
            </div>
          </div>
        )}
        <div className="flex-1 px-8 py-6">
          <EditorContent editor={editor} />
        </div>
        {hasDocumentEnv && (
          <div className="mx-auto w-full max-w-[42rem] px-8 pb-6">
            <div className="rounded-md border border-border px-3 py-2 text-center text-xs text-muted-foreground">
              {t(($) => $.editor.visual.endOfDocument)}
            </div>
          </div>
        )}
      </div>
      {editor && proofreadingIssue && wysiwyg && (
        <ProofreadingPopover
          editor={editor}
          issue={proofreadingIssue}
          onClose={closeProofreading}
          onNavigate={(nextIssue) =>
            setProofreadingIssue(nextIssue)
          }
        />
      )}
    </div>
  );
}
