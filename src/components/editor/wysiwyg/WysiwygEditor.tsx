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
  setWysiwygEditor,
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
} from "./proofreading";

function isMarkdownPath(path: string): boolean {
  const p = path.toLowerCase();
  return p.endsWith(".md") || p.endsWith(".markdown");
}

const FLUSH_DEBOUNCE_MS = 300;
const MARKDOWN_FRONTMATTER_RE = /^(---\r?\n[\s\S]*?\r?\n---)\r?\n?/u;

function markdownMathRanges(source: string) {
  const bodyOffset = MARKDOWN_FRONTMATTER_RE.exec(source)?.[0].length ?? 0;
  return scanMathExpressions(source, {
    format: "markdown",
    from: bodyOffset,
  }).map(({ from, to }) => ({ from, to }));
}

function replaceContentAndResetHistory(editor: Editor, content: Parameters<Editor["commands"]["setContent"]>[0]) {
  editor.chain().setContent(content, { emitUpdate: false }).setMeta("addToHistory", false).run();

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
}: {
  editor: Editor;
  issue: VisualProofreadingIssue;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] =
    useState<ProofreadingPopoverPosition | null>(null);

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
      const firstAction =
        panelRef.current?.querySelector<HTMLButtonElement>(
          '[data-proofreading-primary="true"]',
        );
      (firstAction ?? panelRef.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [issue.id]);

  useEffect(() => {
    const pointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        panelRef.current?.contains(target as Node) ||
        (target instanceof Element &&
          target
            .closest<HTMLElement>("[data-proofreading-issue]")
            ?.dataset.proofreadingIssue === issue.id)
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener("pointerdown", pointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", pointerDown, true);
  }, [issue.id, onClose]);

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
    const current = actions.findIndex((action) => action === active);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? actions.length - 1
          : event.key === "ArrowDown"
            ? (Math.max(current, -1) + 1) % actions.length
            : (current <= 0 ? actions.length : current) - 1;
    event.preventDefault();
    actions[next]?.focus();
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Proofreading suggestions"
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

      {issue.suggestions.length > 0 && (
        <fieldset
          className="mt-2 grid max-h-40 gap-1 overflow-y-auto"
        >
          <legend className="sr-only">Suggested fixes</legend>
          {issue.suggestions.slice(0, 8).map((suggestion, index) => {
            const Icon =
              suggestion.kind === 1
                ? Trash2
                : suggestion.kind === 2
                  ? Plus
                  : Check;
            return (
              <Button
                key={`${suggestion.kind}:${suggestion.text}:${index}`}
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
              issue.suggestions.length === 0 ? "true" : undefined
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
            issue.suggestions.length === 0 && !issue.projectId
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
  const activePath = useFilesStore((s) => s.activePath);
  const docVersion = useFilesStore((s) => s.docVersion);
  const saveFile = useFilesStore((s) => s.saveFile);
  const latexSplitRef = useRef<LatexDocumentSplit | null>(null);
  const frontmatterRef = useRef("");
  const activePathRef = useRef<string | null>(null);
  activePathRef.current = activePath;
  const wysiwygRef = useRef(wysiwyg);
  wysiwygRef.current = wysiwyg;
  const intelligenceRevisionRef = useRef("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const flush = useCallback((editorInstance: Editor) => {
    const path = activePathRef.current;
    if (!path) return;
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
    useFilesStore.getState().setContent(path, nextSource, { bumpVersion: true });
  }, []);
  const editor = useEditor({
    extensions: [
      ...WYSIWYG_EXTENSIONS,
      VisualMathPreview,
      VisualProjectIntelligence,
      VisualProofreading,
    ],
    content: { type: "doc", content: [{ type: "paragraph" }] },
    immediatelyRender: false,
    editorProps: {
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
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(() => flush(editorInstance), FLUSH_DEBOUNCE_MS);
    },
  });

  useEffect(() => {
    setWysiwygEditor(editor ?? null);
    setWysiwygProjectNavigation(
      editor
        ? {
            goToDefinition: () => goToVisualDefinition(editor),
            findReferences: () => findVisualReferences(editor),
          }
        : null,
    );
    return () => {
      setWysiwygProjectNavigation(null);
      setWysiwygEditor(null);
    };
  }, [editor]);

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: settings are
  // intentional refresh triggers for the imperative proofreading plugin.
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: wysiwyg/docVersion are re-sync triggers, not read directly; the store is read imperatively below
  useEffect(() => {
    if (!editor || !activePath) return;
    const raw = useFilesStore.getState().files[activePath]?.content ?? "";
    if (
      activePath === lastSyncedPathRef.current &&
      raw === lastSyncedTextRef.current
    ) {
      return;
    }
    lastSyncedTextRef.current = raw;
    lastSyncedPathRef.current = activePath;
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
  }, [editor, activePath, wysiwyg, docVersion]);

  useEffect(() => {
    if (!editor || !activePath) return;
    const path = activePath;
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (!wysiwygRef.current) return;
      activePathRef.current = path;
      flush(editor);
      void saveFile(path);
    };
  }, [editor, activePath, saveFile, flush]);

  const onPreambleChange = (value: string) => {
    setPreamble(value);
    preambleRef.current = value;
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
        />
      )}
    </>
  );
}
