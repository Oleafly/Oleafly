import { renderMathExpression } from "@oleafly/editor/math-render";
import {
  createMarkdownSourceSnapshot,
  createWysiwygExtensions,
  parseMarkdownBody,
  serializeMarkdownBody,
  type MarkdownSourceSnapshot,
} from "@oleafly/wysiwyg";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorContent, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatComposerHandle } from "@/components/ai/composer/ChatComposer";
import { markdownMathRanges } from "@/components/editor/wysiwyg/markdown-source";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatRelativeTimeFrom } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { AgentPrompt, type PromptRequest } from "./AgentPrompt";
import { withBlockViews, withImageView } from "./block-views";
import { IconPicker } from "./IconPicker";
import { LocalEdits } from "./local-edits";
import { diffNoteDocs } from "./note-diff";
import { choiceIn, defaultChoice, hiddenActions, readSavedAgent, saveAgent } from "./note-agent";
import { applyNoteEdits } from "./note-edits";
import { readNoteFacts, withNoteIcon, withNoteIdentity, withNoteTitle } from "./note-file";
import { NoteChip } from "./note-icons";
import { useNoteWidth, type NoteWidth } from "./note-prefs";
import {
  acceptActive,
  acceptAll,
  docWithPending,
  isReviewTransaction,
  moveReview,
  NoteSuggestions,
  rejectActive,
  rejectAll,
  reviewSummary,
  showSuggestions,
  type ReviewSummary,
} from "./note-suggestions";
import { NoteToolbar } from "./NoteToolbar";
import { useNotesData } from "./notes-data";
import { ReviewBar } from "./ReviewBar";
import { NoteConflictError, type NoteAgentChoice, type NoteItem, type NoteSource } from "./types";

export type SaveStatus = "saved" | "saving" | "failed";

interface NoteDocumentProps {
  note: NoteItem;
  insertRequest: { snippet: string; id: number } | null;
  onSendToPaper: (text: string) => void;
  onStatusChange?: (status: SaveStatus) => void;
}

interface SelectionBubble {
  top: number;
  left: number;
  text: string;
}

const SAVE_DELAY_MS = 800;
const WIDTH_CLASSES: Readonly<Record<NoteWidth, string>> = {
  standard: "max-w-[44rem] px-4",
  wide: "max-w-[58rem] px-4",
  full: "max-w-none px-[max(1rem,5%)]",
};

function parseNote(source: string) {
  return parseMarkdownBody(source, { preservedInlineRanges: markdownMathRanges(source) });
}

function frontMatterBlock(text: string): string {
  return text.replace(/\s+$/u, "");
}

export function NoteDocument(props: Readonly<NoteDocumentProps>) {
  const { t } = useTranslation(["notes"]);
  const { loadNote } = useNotesData();
  const [source, setSource] = useState<NoteSource | null>(null);
  const [failed, setFailed] = useState(false);
  const noteId = props.note.id;

  useEffect(() => {
    let live = true;
    loadNote(noteId).then(
      (loaded) => {
        if (live) setSource(loaded);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [loadNote, noteId]);

  if (failed) {
    return <p className="flex-1 p-8 text-sm text-muted-foreground">{t(($) => $.notes.document.loadFailed)}</p>;
  }
  if (!source) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size="sm" />
      </div>
    );
  }
  return <NoteEditor {...props} initial={source} />;
}

function NoteEditor({
  note,
  initial,
  insertRequest,
  onSendToPaper,
  onStatusChange,
}: Readonly<NoteDocumentProps & { initial: NoteSource }>) {
  const { t } = useTranslation(["notes"]);
  const {
    agents,
    preferredAgent,
    openAgentSettings,
    latestRun,
    resolveAsset,
    loadNote,
    proposeEdits,
    renameNote,
    saveNote,
    watchNote,
  } = useNotesData();
  const resolveRef = useRef(resolveAsset);
  resolveRef.current = resolveAsset;
  const [choice, setChoice] = useState<NoteAgentChoice | null>(null);
  const [parsed] = useState(() => parseNote(initial.text));
  const extensions = useMemo(() => {
    const noteId = note.id;
    const resolve = (path: string) => resolveRef.current?.(noteId, path) ?? Promise.resolve(null);
    return [
      ...createWysiwygExtensions({ renderMath: renderMathExpression })
        .map(withBlockViews)
        .map((extension) => withImageView(extension, resolve)),
      NoteSuggestions,
    ];
  }, [note.id]);
  const editor = useEditor({ extensions, content: parsed.doc });
  const composerRef = useRef<ChatComposerHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<AbortController | null>(null);
  const frontMatterRef = useRef(parsed.frontmatter);
  const snapshotRef = useRef<MarkdownSourceSnapshot | null>(null);
  const versionRef = useRef(initial.version);
  const savedTextRef = useRef(initial.text);
  const localRef = useRef(new LocalEdits());
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef<Promise<void> | null>(null);
  const statusRef = useRef(onStatusChange);
  statusRef.current = onStatusChange;
  const [facts, setFacts] = useState(() => readNoteFacts(initial.text));
  const [title, setTitle] = useState(facts.title ?? note.title);
  const [review, setReview] = useState<ReviewSummary>({ count: 0, index: -1, activeId: null });
  const [working, setWorking] = useState(false);
  const hidden = useMemo(() => hiddenActions(Boolean(latestRun?.(note.id))), [latestRun, note.id]);
  const [message, setMessage] = useState<string | null>(null);
  const [quote, setQuote] = useState<string | null>(null);
  const [bubble, setBubble] = useState<SelectionBubble | null>(null);
  const width = useNoteWidth();
  const editingTitle = useRef(false);

  const sourceOf = useCallback((doc: ProseMirrorNode) => {
    const body = serializeMarkdownBody(doc.toJSON(), snapshotRef.current);
    const frontMatter = frontMatterRef.current;
    return frontMatter ? `${frontMatter}\n\n${body}` : body;
  }, []);

  const adoptFacts = useCallback(
    (text: string) => {
      const next = readNoteFacts(text);
      setFacts(next);
      setTitle(next.title ?? note.title);
    },
    [note.title],
  );

  const handleDisk = useCallback(
    (disk: NoteSource) => {
      if (disk.text === savedTextRef.current) {
        versionRef.current = disk.version;
        return;
      }
      const next = parseNote(disk.text);
      frontMatterRef.current = next.frontmatter;
      adoptFacts(disk.text);
      const drafts = diffNoteDocs(editor.state.doc, editor.schema.nodeFromJSON(next.doc)).filter(
        (draft) => !localRef.current.overlaps(draft.from, draft.to),
      );
      showSuggestions(editor, drafts, "disk");
      versionRef.current = disk.version;
      savedTextRef.current = disk.text;
    },
    [adoptFacts, editor],
  );

  const save = useCallback(async (): Promise<void> => {
    if (savingRef.current) await savingRef.current;
    frontMatterRef.current = frontMatterBlock(withNoteIdentity(frontMatterRef.current));
    const text = sourceOf(docWithPending(editor, "disk"));
    if (text === savedTextRef.current) {
      statusRef.current?.("saved");
      return;
    }
    statusRef.current?.("saving");
    const docAtStart = editor.state.doc;
    const run = saveNote(note.id, text, versionRef.current).then(
      (saved) => {
        versionRef.current = saved.version;
        savedTextRef.current = saved.text;
        if (editor.state.doc === docAtStart) localRef.current.clear();
        statusRef.current?.("saved");
      },
      (error: unknown) => {
        if (error instanceof NoteConflictError) {
          handleDisk(error.disk);
          statusRef.current?.("saving");
          if (timerRef.current !== null) window.clearTimeout(timerRef.current);
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            void save();
          }, SAVE_DELAY_MS);
          return;
        }
        statusRef.current?.("failed");
      },
    );
    savingRef.current = run.finally(() => {
      savingRef.current = null;
    });
    await savingRef.current;
  }, [editor, handleDisk, note.id, saveNote, sourceOf]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    statusRef.current?.("saving");
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void save();
    }, SAVE_DELAY_MS);
  }, [save]);

  useEffect(() => {
    snapshotRef.current = createMarkdownSourceSnapshot(parsed.layout, editor.getJSON());
  }, [editor, parsed]);

  useEffect(() => {
    const onTransaction = ({ transaction }: { transaction: Parameters<typeof isReviewTransaction>[0] }) => {
      const next = reviewSummary(editor);
      setReview((current) =>
        current.count === next.count && current.index === next.index && current.activeId === next.activeId
          ? current
          : next,
      );
      if (transaction.docChanged) {
        localRef.current.record(transaction.mapping);
        scheduleSave();
      } else if (isReviewTransaction(transaction)) {
        scheduleSave();
      }
    };
    const trackSelection = () => {
      const { from, to, empty } = editor.state.selection;
      const text = empty ? "" : editor.state.doc.textBetween(from, to, " ").trim();
      if (!text) {
        setBubble(null);
        return;
      }
      const start = editor.view.coordsAtPos(from);
      setBubble({ top: start.top - 40, left: start.left, text });
    };
    const hide = () => setBubble(null);
    editor.on("transaction", onTransaction);
    editor.on("selectionUpdate", trackSelection);
    editor.on("blur", hide);
    const scroller = scrollRef.current;
    scroller?.addEventListener("scroll", hide, { passive: true });
    return () => {
      editor.off("transaction", onTransaction);
      editor.off("selectionUpdate", trackSelection);
      editor.off("blur", hide);
      scroller?.removeEventListener("scroll", hide);
    };
  }, [editor, scheduleSave]);

  useEffect(() => {
    const stop = watchNote?.(note.id, () => {
      loadNote(note.id).then(handleDisk, () => {});
    });
    return stop;
  }, [handleDisk, loadNote, note.id, watchNote]);

  useEffect(() => {
    const flush = () => {
      if (timerRef.current === null) return;
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      void save();
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("blur", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("blur", flush);
      document.removeEventListener("visibilitychange", onHidden);
      flush();
      runRef.current?.abort();
    };
  }, [save]);

  useEffect(() => {
    const snippet = insertRequest?.snippet;
    if (!snippet) return;
    editor.chain().focus("end").insertContent(parseNote(snippet).doc.content ?? []).run();
  }, [editor, insertRequest]);

  useEffect(() => {
    if (!review.activeId) return;
    editor.view.dom.querySelector(".note-diff-active")?.scrollIntoView({ block: "center" });
  }, [editor, review.activeId]);

  const changeFrontMatter = (update: (text: string) => string) => {
    frontMatterRef.current = frontMatterBlock(update(frontMatterRef.current));
    adoptFacts(frontMatterRef.current);
    scheduleSave();
  };
  const changeRef = useRef(changeFrontMatter);
  changeRef.current = changeFrontMatter;
  const declaredTitle = useRef(facts.title);
  declaredTitle.current = facts.title;

  const adoptName = useCallback((name: string) => {
    const declared = declaredTitle.current;
    if (declared === null) setTitle(name);
    else if (declared !== name) changeRef.current((text) => withNoteTitle(text, name));
  }, []);

  useEffect(() => {
    if (!editingTitle.current) adoptName(note.title);
  }, [adoptName, note.title]);

  const commitTitle = () => {
    editingTitle.current = false;
    const next = title.trim();
    const current = facts.title ?? note.title;
    if (!next) {
      setTitle(current);
      adoptName(note.title);
      return;
    }
    if (next === current) {
      adoptName(note.title);
      return;
    }
    changeFrontMatter((text) => withNoteTitle(text, next));
    void renameNote?.(note.id, next);
  };

  useEffect(() => {
    setChoice((current) =>
      current && choiceIn(agents, current.providerId, current.modelId)
        ? current
        : defaultChoice(agents, readSavedAgent(), preferredAgent ?? null),
    );
  }, [agents, preferredAgent]);

  const pickAgent = (next: NoteAgentChoice) => {
    setChoice(next);
    saveAgent(next);
  };

  const send = ({ actionId, prompt }: PromptRequest) => {
    if (!choice) return;
    const agent = choice;
    runRef.current?.abort();
    const controller = new AbortController();
    runRef.current = controller;
    setWorking(true);
    setMessage(null);
    const request = {
      noteId: note.id,
      agent,
      actionId,
      prompt,
      quote,
      source: sourceOf(docWithPending(editor, "disk")),
      latestRun: actionId === "latestRun" ? (latestRun?.(note.id) ?? undefined) : undefined,
    };
    setQuote(null);
    proposeEdits(request, controller.signal)
      .then(
        (edits) => {
          if (controller.signal.aborted) return;
          const base = sourceOf(editor.state.doc);
          const proposed = applyNoteEdits(base, edits);
          const baseDoc = editor.schema.nodeFromJSON(parseNote(base).doc);
          const proposedDoc = editor.schema.nodeFromJSON(parseNote(proposed.text).doc);
          const current = baseDoc.eq(editor.state.doc) ? baseDoc : editor.state.doc;
          const drafts = diffNoteDocs(current, proposedDoc);
          showSuggestions(editor, drafts, "agent");
          if (drafts.length === 0) setMessage(t(($) => $.notes.document.noChanges, { agent: agent.label }));
          else if (proposed.skipped > 0) setMessage(t(($) => $.notes.document.skipped, { count: proposed.skipped }));
        },
        (error: unknown) => {
          if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : String(error));
        },
      )
      .finally(() => {
        if (runRef.current === controller) {
          runRef.current = null;
          setWorking(false);
        }
      });
  };

  const stop = () => {
    runRef.current?.abort();
    runRef.current = null;
    setWorking(false);
  };

  const byline = [
    note.author === "agent" && note.agent
      ? t(($) => $.notes.document.writtenByAgent, { agent: note.agent })
      : t(($) => $.notes.document.writtenByYou),
    note.project,
    formatRelativeTimeFrom(note.updatedAt, Date.now(), { dateAfterDays: 7 }),
  ].join(" · ");

  return (
    <div ref={scrollRef} data-note-width={width} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <NoteToolbar editor={editor} />
      <article className={cn("mx-auto w-full flex-1 pb-32 pt-10 transition-[max-width] duration-200 motion-reduce:transition-none", WIDTH_CLASSES[width])}>
        <div>
          <IconPicker
            value={facts.icon}
            hasIcon={Boolean(facts.icon)}
            onChange={(icon) => changeFrontMatter((text) => withNoteIcon(text, icon))}
            trigger={<NoteChip icon={facts.icon} color={facts.color} size="lg" />}
            triggerClassName="-ml-1 mb-3 size-auto rounded-xl p-1 transition-colors hover:bg-accent focus-visible:bg-accent"
          />
          <input
            aria-label={t(($) => $.notes.document.titleLabel)}
            placeholder={t(($) => $.notes.document.untitled)}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onFocus={() => {
              editingTitle.current = true;
            }}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                editor.commands.focus("start");
              }
              if (event.key === "Escape") setTitle(facts.title ?? note.title);
            }}
            className="w-full border-0 bg-transparent p-0 text-2xl font-bold placeholder:text-muted-foreground/60"
          />
        </div>
        <p className="mb-6 mt-1 text-xs text-muted-foreground">{byline}</p>
        <div className="wysiwyg-content note-body">
          <EditorContent editor={editor} />
        </div>
      </article>
      {bubble && (
        <div
          style={{ top: bubble.top, left: bubble.left }}
          className="fixed z-50 flex gap-0.5 rounded-md border bg-popover p-1 text-popover-foreground shadow-xl"
        >
          <Button
            variant="ghost"
            size="xs"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setQuote(bubble.text);
              composerRef.current?.focus();
            }}
          >
            {t(($) => $.notes.document.askAgent)}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSendToPaper(bubble.text)}
          >
            {t(($) => $.notes.document.sendToPaper)}
          </Button>
        </div>
      )}
      <div className="pointer-events-none sticky bottom-0 z-10 px-6 pb-4">
        {review.count > 0 && (
          <div className="pointer-events-auto mx-auto max-w-2xl">
            <ReviewControls editor={editor} review={review} />
          </div>
        )}
        {review.count === 0 && choice && (
          <AgentPrompt
            composerRef={composerRef}
            shortcutScope={scrollRef}
            agents={agents}
            hiddenActions={hidden}
            choice={choice}
            onChoice={pickAgent}
            working={working}
            quote={quote}
            message={message}
            onClearQuote={() => setQuote(null)}
            onSend={send}
            onStop={stop}
          />
        )}
        {review.count === 0 && !choice && openAgentSettings && (
          <div className="pointer-events-auto mx-auto flex max-w-2xl items-center justify-between gap-3 rounded-[1.375rem] border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
            <span>{t(($) => $.notes.prompt.noAgents)}</span>
            <Button variant="outline" size="xs" onClick={openAgentSettings}>
              {t(($) => $.notes.prompt.setUp)}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewControls({ editor, review }: Readonly<{ editor: Editor; review: ReviewSummary }>) {
  return (
    <ReviewBar
      count={review.count}
      index={review.index}
      onPrevious={() => moveReview(editor, -1)}
      onNext={() => moveReview(editor, 1)}
      onAccept={() => acceptActive(editor)}
      onReject={() => rejectActive(editor)}
      onAcceptAll={() => acceptAll(editor)}
      onRejectAll={() => rejectAll(editor)}
    />
  );
}
