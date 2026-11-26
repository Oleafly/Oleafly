import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import type { DocumentSession } from "@oleafly/editor/document-session";
import { isEditorMutationLocked, registerEditorMutationOwner } from "@/lib/editor-mutation-lease";
import { activeFileReadOnly, useActiveFileReadOnly } from "@/lib/read-only-files";
import {
  collabDocumentSession,
  collabRichTextLock,
  type LiveNoteSession,
  type NoteHandBack,
  type NoteLiveHandle,
  type NoteLivePort,
  useCollabLiveProject,
  useCollabNoteLivePort,
  useCollabRichTextLock,
} from "@/lib/collab-live-bridge";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { renderMathExpression } from "@oleafly/editor/math-render";
import {
  createMarkdownSourceSnapshot,
  createWysiwygExtensions,
  parseMarkdownBody,
  splitMarkdownFrontMatter,
  type MarkdownSourceSnapshot,
} from "@oleafly/wysiwyg";
import { useFilesStore } from "@/store/files";
import { setActiveFileMode } from "@/store/visual-mode";
import { useDictionary } from "@/lib/dictionary";
import { cancelProofreading } from "@/lib/proofreading/client";
import { useSettingsStore } from "@/store/settings";
import { Button } from "@/components/ui/button";
import { editorRedo, editorUndo } from "@/components/editor/cm/controller";
import { isRecompileShortcut } from "@/components/editor/cm/recompile-shortcut";
import { requestLiveNoteComment, showCommentsTab } from "@/components/collab/comments-rail";
import { NoteCommentMarks } from "@/components/notes/note-comment-marks";
import { isRemoteTransaction, noteSourceOf, VISUAL_DIALECT } from "@/components/notes/note-live-doc";
import { NOTE_CORE_EXTENSIONS } from "@/components/notes/note-markdown";
import { NotePeerMarks } from "@/components/notes/note-presence-decorations";
import {
  createNoteLiveEditor,
  type NoteLiveAdapter,
  useCompositionSettled,
} from "@/components/notes/use-note-live";
import { i18n } from "@/i18n";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import {
  getWysiwygProjectSessionGeneration,
  setWysiwygDocument,
  setWysiwygEditor,
  setWysiwygFlushController,
  setWysiwygInsertions,
  setWysiwygProjectNavigation,
  setWysiwygVisible,
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
import { QuoteOrBoldKey } from "@/components/editor/rich-text-controls";

const FLUSH_DEBOUNCE_MS = 300;
const EXTERNAL_DOCUMENT_SYNC = "oleaflyExternalDocumentSync";
const PACKAGE_EXTENSIONS = createWysiwygExtensions({
  renderMath: renderMathExpression,
  resolveAssetUrl: resolveVisualAssetUrl,
  localizeLinkHref: localizedVisualHref,
  openLinkHref: openVisualLinkHref,
});
const PASTE_HANDLERS = createVisualPasteHandlers();

function visualReadOnly(projectId: string | null): boolean {
  return activeFileReadOnly() || collabRichTextLock(projectId) !== null;
}

const ExternalMutationGate = Extension.create({
  name: "externalMutationGate",
  addProseMirrorPlugins() {
    return [new Plugin({
      filterTransaction: (transaction) => !transaction.docChanged ||
        transaction.getMeta(EXTERNAL_DOCUMENT_SYNC) === true ||
        isRemoteTransaction(transaction) ||
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

interface LoadedText {
  path: string;
  text: string;
  doc: ProseMirrorNode;
}

interface LiveBinding {
  path: string;
  document: DocumentSession;
  session: LiveNoteSession;
  port: NoteLivePort;
  handle: NoteLiveHandle;
  adapter: NoteLiveAdapter;
}

function VisualLiveNotice({ lock }: Readonly<{ lock: "view" | "connecting" | "suggest" }>) {
  const { t } = useTranslation(["editor"]);
  const message = {
    view: t(($) => $.editor.visual.liveViewOnly),
    connecting: t(($) => $.editor.visual.liveConnecting),
    suggest: t(($) => $.editor.visual.suggestInSource),
  }[lock];
  return (
    <output
      data-testid="visual-live-notice"
      data-lock={lock}
      className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm text-muted-foreground"
    >
      <span>{message}</span>
      {lock === "suggest" ? (
        <Button type="button" variant="outline" size="xs" onClick={() => setActiveFileMode("code")}>
          {t(($) => $.editor.toolbar.switchToSource)}
        </Button>
      ) : null}
    </output>
  );
}

export function WysiwygEditor({ wysiwyg }: Readonly<{ wysiwyg: boolean }>) {
  const synchronizeRef = useRef<() => void>(() => {});
  const projectId = useFilesStore((s) => s.projectId);
  const activePath = useFilesStore((s) => s.activePath);
  const docVersion = useFilesStore((s) => s.docVersion);
  const saveFile = useFilesStore((s) => s.saveFile);
  const liveLock = useCollabRichTextLock(projectId);
  const readOnly = useActiveFileReadOnly() || liveLock !== null;
  const liveProject = useCollabLiveProject((state) => (state.session?.projectId === projectId ? state.session : null));
  const livePort = useCollabNoteLivePort((state) => state.port);
  const frontmatterRef = useRef("");
  const separatorRef = useRef("");
  const markdownSourceRef = useRef<MarkdownSourceSnapshot | null>(null);
  const loadedRef = useRef<LoadedText | null>(null);
  const liveRef = useRef<LiveBinding | null>(null);
  const activePathRef = useRef<string | null>(null);
  activePathRef.current = activePath;
  const projectIdRef = useRef<string | null>(null);
  projectIdRef.current = projectId;
  const wysiwygRef = useRef(wysiwyg);
  wysiwygRef.current = wysiwyg;
  const intelligenceRevisionRef = useRef("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visualDirtyRef = useRef(false);
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

  const sourceOf = useCallback(
    (doc: ProseMirrorNode) =>
      noteSourceOf(doc, frontmatterRef.current, separatorRef.current, markdownSourceRef.current, VISUAL_DIALECT),
    [],
  );

  const flush = useCallback((
    editorInstance: Editor,
    target?: { path: string | null; projectId: string | null },
  ): boolean => {
    const { path, projectId: targetProjectId } = target ?? {
      path: activePathRef.current,
      projectId: projectIdRef.current,
    };
    const live = liveRef.current;
    if (live && live.path === path) {
      void live.handle.flush(0);
      return false;
    }
    const filesState = useFilesStore.getState();
    if (
      !path ||
      filesState.projectId !== targetProjectId ||
      !filesState.files[path] ||
      !visualDirtyRef.current ||
      loadedRef.current?.path !== path
    ) {
      return false;
    }
    const nextSource = sourceOf(editorInstance.state.doc);
    loadedRef.current = { path, text: nextSource, doc: editorInstance.state.doc };
    visualDirtyRef.current = false;
    filesState.setContent(path, nextSource, { bumpVersion: true });
    return true;
  }, [sourceOf]);
  const editor = useEditor({
    extensions: [
      ...PACKAGE_EXTENSIONS,
      QuoteOrBoldKey,
      ExternalMutationGate,
      VisualProjectIntelligence,
      VisualProofreading,
      NotePeerMarks,
      NoteCommentMarks,
    ],
    content: { type: "doc", content: [{ type: "paragraph" }] },
    immediatelyRender: false,
    enableCoreExtensions: NOTE_CORE_EXTENSIONS,
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
        if (event.altKey && !event.shiftKey && event.code === "KeyM") {
          if (!requestLiveNoteComment(projectIdRef.current, activePathRef.current)) return false;
          event.preventDefault();
          showCommentsTab();
          return true;
        }
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
    onUpdate: ({ editor: editorInstance, transaction }) => {
      const live = liveRef.current;
      if (live) {
        if (isRemoteTransaction(transaction)) return;
        live.adapter.invalidate();
        live.handle.localChanged();
        return;
      }
      visualDirtyRef.current = true;
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(() => flush(editorInstance), FLUSH_DEBOUNCE_MS);
    },
  });

  const load = useCallback((editorInstance: Editor, path: string, raw: string) => {
    const { doc, frontmatter, separator, layout } = parseMarkdownBody(raw, {
      preservedInlineRanges: markdownMathRanges(raw),
    });
    frontmatterRef.current = frontmatter;
    separatorRef.current = separator;
    replaceContentAndResetHistory(editorInstance, doc);
    markdownSourceRef.current = createMarkdownSourceSnapshot(layout, editorInstance.getJSON());
    loadedRef.current = { path, text: raw, doc: editorInstance.state.doc };
    visualDirtyRef.current = false;
    refreshVisualProjectIntelligence(editorInstance, intelligenceRevisionRef.current);
    setWysiwygDocument(editorInstance, path);
  }, []);

  const endLive = useCallback(() => {
    const live = liveRef.current;
    if (!live) return;
    liveRef.current = null;
    live.handle.end();
  }, []);

  const handBack = useCallback((editorInstance: Editor, path: string, state: NoteHandBack) => {
    if (editorInstance.isDestroyed) return;
    const text = state.edited ? sourceOf(editorInstance.state.doc) : state.text;
    loadedRef.current = { path, text, doc: editorInstance.state.doc };
    if (state.edited) {
      if (collabDocumentSession(path) === null) {
        useFilesStore.getState().setContent(path, text, { bumpVersion: true });
        return;
      }
      void logError("visual live editing", new Error(`Unsent Visual edits to ${path} were dropped.`));
      toast.info(i18n.t(($) => $.collab.access.unsentReadOnly, { path }));
    }
    useFilesStore.getState().bumpDocVersion();
  }, [sourceOf]);

  const beginLive = useCallback((
    editorInstance: Editor,
    path: string,
    document: DocumentSession,
    session: LiveNoteSession,
    port: NoteLivePort,
  ) => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const text = document.text();
    const loaded = loadedRef.current;
    if (loaded?.path !== path || (loaded.text !== text && !visualDirtyRef.current)) {
      load(editorInstance, path, text);
    }
    const shown = loadedRef.current ?? { path, text, doc: editorInstance.state.doc };
    const baseline = { text: shown.text, serialized: sourceOf(shown.doc) };
    visualDirtyRef.current = false;
    const host = {
      sourceOf,
      adopt: (shared: { text: string; frontmatter: string; snapshot: MarkdownSourceSnapshot | null }) => {
        frontmatterRef.current = shared.frontmatter;
        separatorRef.current = splitMarkdownFrontMatter(shared.text).separator;
        markdownSourceRef.current = shared.snapshot;
      },
    };
    const adapter = createNoteLiveEditor(
      editorInstance,
      () => host,
      baseline.text,
      () => wysiwygRef.current,
      VISUAL_DIALECT,
    );
    let ended = false;
    let handle: NoteLiveHandle;
    try {
      handle = port.bind({
        noteId: session.projectId,
        path,
        session,
        document,
        editor: adapter,
        baseline,
        onEnd: (state) => {
          ended = true;
          if (liveRef.current?.adapter === adapter) liveRef.current = null;
          handBack(editorInstance, path, state);
        },
      });
    } catch (error) {
      void logError("visual live editing", error);
      return;
    }
    if (!ended) liveRef.current = { path, document, session, port, handle, adapter };
  }, [handBack, load, sourceOf]);

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
      reconcile: () => {
        const live = liveRef.current;
        if (live) live.handle.resync();
        else synchronizeRef.current();
      },
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: the document version retriggers the check for a new or detached live session, which the files store doesn't expose as state.
  useEffect(() => {
    if (!editor) return;
    const document =
      wysiwyg && activePath && liveProject && livePort ? collabDocumentSession(activePath) : null;
    const live = liveRef.current;
    if (
      live &&
      (live.path !== activePath || live.document !== document || live.session !== liveProject || live.port !== livePort)
    ) {
      endLive();
    }
    if (document && activePath && liveProject && livePort && !liveRef.current) {
      beginLive(editor, activePath, document, liveProject, livePort);
    }
  }, [beginLive, editor, endLive, wysiwyg, activePath, liveProject, livePort, docVersion]);

  useEffect(() => endLive, [endLive]);

  useCompositionSettled(editor ?? null, () => liveRef.current?.handle.compositionEnd());

  synchronizeRef.current = () => {
    const activePath = useFilesStore.getState().activePath;
    if (!editor || liveRef.current) return;
    if (!activePath) {
      visualDirtyRef.current = false;
      loadedRef.current = null;
      markdownSourceRef.current = null;
      replaceContentAndResetHistory(editor, { type: "doc", content: [{ type: "paragraph" }] });
      setWysiwygDocument(editor, null);
      return;
    }
    const raw = useFilesStore.getState().files[activePath]?.content ?? "";
    const loaded = loadedRef.current;
    if (loaded?.path === activePath && loaded.text === raw) return;
    load(editor, activePath, raw);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: path, visibility and document version deliberately retrigger the imperative editor synchronization.
  useEffect(() => {
    if (!editor) return;
    synchronizeRef.current();
  }, [editor, activePath, wysiwyg, docVersion]);

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

  return (
    <div className="flex h-full flex-col">
      {liveLock && wysiwyg ? <VisualLiveNotice lock={liveLock} /> : null}
      <div data-keep-scroll data-visual-document className="wysiwyg-content flex min-h-0 flex-1 flex-col overflow-auto">
        <div className="flex-1 px-8 py-6">
          <EditorContent editor={editor} />
        </div>
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
