import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { isEditorMutationLocked, registerEditorMutationOwner } from "@/lib/editor-mutation-lease";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import {
  BookOpenCheck,
  Check,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { scanMathExpressions } from "@oleafly/editor/math-source";
import {
  WYSIWYG_EXTENSIONS,
  parseLatexBody,
  serializeLatexBody,
  splitLatexDocument,
  joinLatexDocument,
  parseMarkdownBody,
  serializeMarkdownBody,
  type LatexDocumentSplit,
} from "@oleafly/wysiwyg";
import { useFilesStore } from "@/store/files";
import { useDictionary } from "@/lib/dictionary";
import { cancelProofreading } from "@/lib/proofreading/client";
import { useSettingsStore } from "@/store/settings";
import { Button } from "@/components/ui/button";
import { editorRedo, editorUndo } from "@/components/editor/cm/controller";
import {
  getWysiwygProjectSessionGeneration,
  setWysiwygEditor,
  setWysiwygFlushController,
  setWysiwygProjectNavigation,
  setWysiwygVisible,
} from "./controller";
import {
  findVisualReferences,
  goToVisualDefinition,
  refreshVisualProjectIntelligence,
  VisualProjectIntelligence,
} from "./project-intelligence";
import { useIndexStore } from "@/store/project-index";
import {
  refreshVisualMathPreview,
  VisualMathPreview,
} from "./math-preview";
import {
  applyVisualProofreadingSuggestion,
  ignoreVisualProofreadingIssue,
  isVisualProofreadingIssueCurrent,
  refreshVisualProofreading,
  setVisualProofreadingIssueListener,
  type VisualProofreadingIssue,
  VisualProofreading,
  visualProofreadingIssueGroup,
} from "./proofreading";
import { scrollVisualSelectionLocally } from "./scroll";
import { resetDesktopDocumentScroll } from "@/lib/desktop-viewport";

function isMarkdownPath(path: string): boolean {
  const p = path.toLowerCase();
  return p.endsWith(".md") || p.endsWith(".markdown");
}

const FLUSH_DEBOUNCE_MS = 300;
const EXTERNAL_DOCUMENT_SYNC = "oleaflyExternalDocumentSync";
const ExternalMutationGate = Extension.create({
  name: "externalMutationGate",
  addProseMirrorPlugins() {
    return [new Plugin({
      filterTransaction: (transaction) => !transaction.docChanged ||
        transaction.getMeta(EXTERNAL_DOCUMENT_SYNC) === true ||
        !isEditorMutationLocked(useFilesStore.getState().projectId),
    })];
  },
});
const MARKDOWN_FRONTMATTER_RE = /^(---\r?\n[\s\S]*?\r?\n---)\r?\n?/u;

function markdownMathRanges(source: string) {
  const bodyOffset = MARKDOWN_FRONTMATTER_RE.exec(source)?.[0].length ?? 0;
  return scanMathExpressions(source, {
    format: "markdown",
    from: bodyOffset,
  }).map(({ from, to }) => ({ from, to }));
}

function replaceContentAndResetHistory(editor: Editor, content: Parameters<Editor["commands"]["setContent"]>[0]) {
  editor.chain().setContent(content, { emitUpdate: false }).setMeta("addToHistory", false).setMeta(EXTERNAL_DOCUMENT_SYNC, true).run();

  // Loading a file is a synchronization boundary, not a user edit. Reinitialize
  // plugin state so Undo cannot erase the loaded document or replay edits from
  // a previously active file.
  const plugins = editor.state.plugins;
  const resetState = editor.state.reconfigure({ plugins: [] }).reconfigure({ plugins });
  editor.view.updateState(resetState);
}

interface ProofreadingPopoverPosition {
  left: number;
  top: number;
}

function suggestionLabel(
  suggestion: VisualProofreadingIssue["suggestions"][number],
): string {
  if (suggestion.kind === 1) return "Remove";
  if (suggestion.kind === 2) {
    return suggestion.text ? `Insert “${suggestion.text}”` : "Insert";
  }
  return suggestion.text ? `Replace with “${suggestion.text}”` : "Replace";
}

function VisualProofreadingPopover({
  editor,
  issue,
  onClose,
  onNavigate,
}: {
  editor: Editor;
  issue: VisualProofreadingIssue;
  onClose: () => void;
  onNavigate: (issue: VisualProofreadingIssue) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] =
    useState<ProofreadingPopoverPosition | null>(null);
  const issueGroup = visualProofreadingIssueGroup(editor, issue);
  const suggestions = [
    ...new Map(
      issue.suggestions.map((suggestion) => [
        `${suggestion.kind}:${suggestion.text}`,
        suggestion,
      ]),
    ).values(),
  ].slice(0, 8);

  useLayoutEffect(() => {
    const place = () => {
      if (!isVisualProofreadingIssueCurrent(editor, issue)) {
        onClose();
        return;
      }
      const panel = panelRef.current;
      if (!panel) return;
      try {
        const start = editor.view.coordsAtPos(issue.from);
        const end = editor.view.coordsAtPos(issue.to);
        if (
          Math.max(start.bottom, end.bottom) < 0 ||
          Math.min(start.top, end.top) > window.innerHeight ||
          Math.max(start.right, end.right) < 0 ||
          Math.min(start.left, end.left) > window.innerWidth
        ) {
          onClose();
          return;
        }
        const width = panel.offsetWidth || 320;
        const height = panel.offsetHeight || 240;
        const margin = 8;
        const gap = 8;
        const sameLine = Math.abs(start.top - end.top) < 4;
        const anchorLeft = sameLine
          ? (start.left + end.right) / 2
          : start.left;
        let left = anchorLeft - width / 2;
        let top = Math.max(start.bottom, end.bottom) + gap;
        if (top + height > window.innerHeight - margin) {
          top = Math.min(start.top, end.top) - height - gap;
        }
        left = Math.max(
          margin,
          Math.min(left, window.innerWidth - width - margin),
        );
        top = Math.max(
          margin,
          Math.min(top, window.innerHeight - height - margin),
        );
        setPosition({ left, top });
      } catch {
        onClose();
      }
    };

    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [editor, issue, onClose]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (
        panelRef.current?.dataset.proofreadingPanelIssue !== issue.id
      ) {
        return;
      }
      const firstAction =
        panelRef.current?.querySelector<HTMLButtonElement>(
          '[data-proofreading-primary="true"]',
        );
      (firstAction ?? panelRef.current)?.focus({
        preventScroll: true,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [issue.id]);

  useEffect(() => {
    const pointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        panelRef.current?.contains(target as Node) ||
        (target instanceof Element &&
          target.closest("[data-proofreading-issue]"))
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener("pointerdown", pointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", pointerDown, true);
  }, [onClose]);

  const closeAndFocus = () => {
    onClose();
    requestAnimationFrame(() => editor.view.focus());
  };

  const applySuggestion = (
    suggestion: VisualProofreadingIssue["suggestions"][number],
  ) => {
    if (
      applyVisualProofreadingSuggestion(editor, issue, suggestion)
    ) {
      onClose();
    }
  };

  const ignore = (scope: "project" | "global") => {
    if (ignoreVisualProofreadingIssue(editor, issue, scope)) {
      onClose();
    }
  };

  const moveActionFocus = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeAndFocus();
      return;
    }
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    const actions = [
      ...(panelRef.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? []),
    ];
    if (actions.length === 0) return;
    const active = document.activeElement;
    const current = actions.indexOf(active as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? actions.length - 1
          : event.key === "ArrowDown"
            ? (Math.max(current, -1) + 1) % actions.length
            : (current <= 0 ? actions.length : current) - 1;
    event.preventDefault();
    actions[next]?.focus({ preventScroll: true });
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Proofreading suggestions"
      data-proofreading-panel-issue={issue.id}
      tabIndex={-1}
      className="fixed z-[70] w-80 max-w-[calc(100vw-1rem)] rounded-lg border bg-popover p-2.5 text-popover-foreground shadow-xl outline-none"
      style={
        position
          ? { left: position.left, top: position.top }
          : { left: -10_000, top: -10_000 }
      }
      onKeyDown={moveActionFocus}
    >
      <div className="flex items-start gap-2">
        <BookOpenCheck
          className="mt-0.5 size-4 shrink-0 text-amber-500"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {issue.source === "hunspell"
              ? "Spelling"
              : "Grammar & style"}
          </div>
          <p className="mt-1 text-sm leading-snug">{issue.message}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mr-1 -mt-1 size-7 shrink-0"
          aria-label="Close proofreading suggestions"
          onClick={closeAndFocus}
        >
          <X className="size-3.5" aria-hidden />
        </Button>
      </div>

      {issueGroup && issueGroup.count > 1 && (
        <div className="mt-2 flex items-center justify-between border-t pt-2">
          <span
            className="text-xs text-muted-foreground"
            aria-live="polite"
          >
            Finding {issueGroup.index + 1} of {issueGroup.count}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Previous finding in this raw block"
              disabled={!issueGroup.previous}
              onClick={() => {
                if (issueGroup.previous) {
                  onNavigate(issueGroup.previous);
                }
              }}
            >
              <ChevronUp className="size-3.5" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Next finding in this raw block"
              disabled={!issueGroup.next}
              onClick={() => {
                if (issueGroup.next) onNavigate(issueGroup.next);
              }}
            >
              <ChevronDown className="size-3.5" aria-hidden />
            </Button>
          </div>
        </div>
      )}

      {suggestions.length > 0 && (
        <fieldset
          className="mt-2 grid max-h-40 gap-1 overflow-y-auto"
        >
          <legend className="sr-only">Suggested fixes</legend>
          {suggestions.map((suggestion, index) => {
            const Icon =
              suggestion.kind === 1
                ? Trash2
                : suggestion.kind === 2
                  ? Plus
                  : Check;
            return (
              <Button
                key={`${suggestion.kind}:${suggestion.text}`}
                type="button"
                variant="ghost"
                size="sm"
                data-proofreading-primary={
                  index === 0 ? "true" : undefined
                }
                className="h-auto min-h-8 justify-start whitespace-normal px-2 py-1.5 text-left font-normal"
                onClick={() => applySuggestion(suggestion)}
              >
                <Icon
                  className="size-3.5 shrink-0 text-primary"
                  aria-hidden
                />
                <span className="min-w-0 break-words">
                  {suggestionLabel(suggestion)}
                </span>
              </Button>
            );
          })}
        </fieldset>
      )}

      <div className="mt-2 flex flex-wrap gap-1 border-t pt-2">
        {issue.projectId && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            data-proofreading-primary={
              suggestions.length === 0 ? "true" : undefined
            }
            onClick={() => ignore("project")}
          >
            Ignore in project
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          data-proofreading-primary={
            suggestions.length === 0 && !issue.projectId
              ? "true"
              : undefined
          }
          onClick={() => ignore("global")}
        >
          Ignore everywhere
        </Button>
      </div>
      <p className="sr-only">
        Use Tab or the arrow keys to move between actions. Press Escape
        to close.
      </p>
    </div>,
    document.body,
  );
}

export function WysiwygEditor({ wysiwyg }: { wysiwyg: boolean }) {
  const synchronizeRef = useRef<() => void>(() => {});
  const projectId = useFilesStore((s) => s.projectId);
  const activePath = useFilesStore((s) => s.activePath);
  const docVersion = useFilesStore((s) => s.docVersion);
  const saveFile = useFilesStore((s) => s.saveFile);
  const latexSplitRef = useRef<LatexDocumentSplit | null>(null);
  const frontmatterRef = useRef("");
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
    target = {
      path: activePathRef.current,
      projectId: projectIdRef.current,
    },
  ): boolean => {
    const { path, projectId: targetProjectId } = target;
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
      const body = serializeMarkdownBody(json);
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
      ...WYSIWYG_EXTENSIONS,
      ExternalMutationGate,
      VisualMathPreview,
      VisualProjectIntelligence,
      VisualProofreading,
    ],
    content: { type: "doc", content: [{ type: "paragraph" }] },
    immediatelyRender: false,
    editorProps: {
      handleScrollToSelection:
        scrollVisualSelectionLocally,
      handleKeyDown: (_view, event) => {
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
    const unregisterMutationOwner = editor ? registerEditorMutationOwner({
      projectId: () => projectIdRef.current,
      setLocked: (locked) => editor.setEditable(!locked, false),
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
      unregisterMutationOwner?.();
      setWysiwygProjectNavigation(null);
      setWysiwygFlushController(null);
      setWysiwygEditor(null);
    };
  }, [editor, flush]);

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

  // Settings and dictionary changes invalidate worker output without changing
  // the document. A plugin refresh clears old decorations immediately and
  // schedules a current-revision pass after the typing debounce.
  // Settings are intentional refresh triggers for the imperative proofreading
  // plugin even though they are read by that plugin rather than this effect.
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: path and visibility intentionally retrigger the imperative viewport/revision refresh.
  useEffect(() => {
    if (editor) refreshVisualMathPreview(editor);
  }, [editor, activePath, wysiwyg]);

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
      replaceContentAndResetHistory(editor, { type: "doc", content: [{ type: "paragraph" }] });
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
      const { doc, frontmatter } = parseMarkdownBody(raw, {
        preservedInlineRanges: markdownMathRanges(raw),
      });
      frontmatterRef.current = frontmatter;
      latexSplitRef.current = null;
      preambleRef.current = "";
      setPreamble("");
      setHasDocumentEnv(false);
      replaceContentAndResetHistory(editor, doc);
    } else {
      const split = splitLatexDocument(raw);
      latexSplitRef.current = split;
      preambleRef.current = split.preamble;
      setPreamble(split.preamble);
      setHasDocumentEnv(split.hasDocumentEnv);
      frontmatterRef.current = "";
      replaceContentAndResetHistory(
        editor,
        parseLatexBody(split.body, {
          preservedInlineRanges: scanMathExpressions(split.body, {
            format: "latex",
          }).map(({ from, to }) => ({ from, to })),
        }),
      );
    }
    refreshVisualProjectIntelligence(
      editor,
      intelligenceRevisionRef.current,
    );
  };
  useEffect(() => {
    if (!editor) return;
    void activePath;
    void wysiwyg;
    void docVersion;
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

  const onPreambleChange = (value: string) => {
    if (isEditorMutationLocked(projectIdRef.current)) return;
    setPreamble(value);
    preambleRef.current = value;
    visualDirtyRef.current = true;
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      if (editor) flush(editor);
    }, FLUSH_DEBOUNCE_MS);
  };

  return (
    <>
      <div className="wysiwyg-content flex h-full flex-col overflow-auto">
        {hasDocumentEnv && (
          <div className="mx-auto w-full max-w-[42rem] px-8 pt-6">
            <div className="rounded-md border border-border">
              <button
                type="button"
                onClick={() => setShowPreamble((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
              >
                {showPreamble
                  ? "Hide document preamble"
                  : "Show document preamble"}
                {showPreamble ? (
                  <ChevronUp className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
              </button>
              {showPreamble && (
                <textarea
                  value={preamble}
                  onChange={(e) => onPreambleChange(e.target.value)}
                  spellCheck={false}
                  rows={Math.min(
                    Math.max(preamble.split("\n").length, 3),
                    20,
                  )}
                  className="w-full resize-none border-t border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground outline-none"
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
              End of document
            </div>
          </div>
        )}
      </div>
      {editor && proofreadingIssue && wysiwyg && (
        <VisualProofreadingPopover
          editor={editor}
          issue={proofreadingIssue}
          onClose={closeProofreading}
          onNavigate={(nextIssue) =>
            setProofreadingIssue(nextIssue)
          }
        />
      )}
    </>
  );
}
