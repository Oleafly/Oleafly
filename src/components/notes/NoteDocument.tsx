import { renderMathExpression } from "@oleafly/editor/math-render";
import { createMarkdownSourceSnapshot, type MarkdownSourceSnapshot, splitMarkdownFrontMatter } from "@oleafly/wysiwyg";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorContent, useEditor } from "@tiptap/react";
import { SmilePlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isImeEnter } from "@/components/ai/composer/ime";
import { Button } from "@/components/ui/button";
import { useDelegatedTooltips } from "@/components/ui/delegated-tooltip";
import { Spinner } from "@/components/ui/spinner";
import { describeError } from "@/lib/app-error";
import { formatRelativeTimeFrom } from "@/lib/intl";
import { logError } from "@/lib/log";
import { notifyError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useNoteTabsStore } from "@/store/note-tabs";
import { matchesShortcut, shortcutLabel, useShortcutStore } from "@/store/shortcuts";
import { NoteAssistant, type NoteAssistantHandle, type NoteEditorBridge } from "./NoteAssistant";
import { NoteBacklinks } from "./NoteBacklinks";
import { calloutNodeView } from "./NoteCallout";
import { NoteLinkMenu } from "./NoteLinkMenu";
import { NoteSlash } from "./note-slash";
import { NoteSlashMenu } from "./NoteSlashMenu";
import { NoteProperties } from "./NoteProperties";
import { NoteProofreadingPopover, useNoteProofreading } from "./note-proofreading";
import { mergeFrontMatter } from "./note-properties";
import { NoteTagMenu } from "./NoteTagMenu";
import { withNoteEmbeds } from "./note-embeds";
import { NoteHoverPreview } from "./note-hover-preview";
import { scrollViewToHeading } from "./note-links";
import { noteBaseExtensions, parseNoteMarkdown, serializeNoteMarkdown } from "./note-markdown";
import { useNoteKnowledge } from "./use-note-knowledge";
import { withBlockViews, withImageView } from "./block-views";
import { IconPicker } from "./IconPicker";
import { LocalEdits } from "./local-edits";
import { diffNoteDocs } from "./note-diff";
import { applyNoteEdits } from "./note-edits";
import { readNoteFacts, withNoteColor, withNoteIcon, withNoteIdentity, withNoteTitle } from "./note-file";
import { NoteChip } from "./note-icons";
import { useNoteWidth, type NoteWidth } from "./note-prefs";
import { useNoteLinkExtensions } from "./use-note-links";
import { NoteImageDrop, noteImageTarget } from "./note-image-drop";
import {
  canUndoReject,
  docWithPending,
  hasPending,
  isReviewNavigation,
  isReviewTransaction,
  NoteSuggestions,
  reviewSummary,
  showSuggestions,
  undoReject,
  type ReviewSummary,
} from "./note-suggestions";
import { NoteToolbar } from "./NoteToolbar";
import { NoteFind } from "./note-find";
import { NoteFindBar } from "./NoteFindBar";
import { isRemoteTransaction, noteSourceOf, showNoteDoc } from "./note-live-doc";
import { NotePeerMarks } from "./note-presence-decorations";
import { noteClipboardText, NoteSelection, type WholeNoteText } from "./note-selection";
import { frontMatterChange, frontMatterSteps } from "./note-front-matter-step";
import { mergeSequences } from "./note-merge";
import { registerNoteEditor, trackNoteSave } from "@/lib/open-note-editors";
import { addPendingBatch, editsBetween, takePendingBatches } from "./note-pending-suggestions";
import { editableChanged } from "./note-editable";
import { type NoteLiveControl, type NoteLiveTarget, useNoteLiveEditor } from "./use-note-live";
import { useNotesData } from "./notes-data";
import { noteVersion, noteWrittenHere, recordNoteWrite } from "./notes-service";
import { FloatingReview } from "./FloatingReview";
import { NoteConflictError, type NoteItem, type NoteSource } from "./types";

export type SaveStatus = "saved" | "saving" | "failed";

export interface NoteSaveFailure {
  error: unknown;
  retry: () => void;
}

interface NoteDocumentProps {
  note: NoteItem;
  insertRequest: { snippet: string; id: number } | null;
  onSendToPaper?: (text: string) => void;
  onStatusChange?: (status: SaveStatus, failure: NoteSaveFailure | null) => void;
  onOpenNote?: (noteId: string, options: { newTab: boolean; heading?: string }) => void;
  onOpenTag?: (tag: string) => void;
  openHeading?: { slug: string; id: number } | null;
  live?: NoteLiveTarget | null;
  onClose?: () => void;
  shown?: boolean;
}

interface SelectionBubble {
  top: number;
  left: number;
}

const BUBBLE_HEIGHT = 40;
const BUBBLE_WIDTH = 200;
const BUBBLE_GAP = 8;
const BUBBLE_PROBE = 4096;

export function bubblePlace(start: { top: number; left: number }, end: { bottom: number }, viewport: { width: number }): SelectionBubble {
  const above = start.top - BUBBLE_HEIGHT;
  const top = above >= BUBBLE_GAP ? above : end.bottom + BUBBLE_GAP;
  return { top, left: Math.max(BUBBLE_GAP, Math.min(start.left, viewport.width - BUBBLE_WIDTH)) };
}

function selectedText(editor: Editor, wholeNote: WholeNoteText): string {
  const { selection, doc } = editor.state;
  return selection.empty ? "" : noteClipboardText(selection.content(), doc, wholeNote).trim();
}

const handledRequests = new WeakSet<object>();

function firstTime(request: object | null | undefined): boolean {
  if (!request || handledRequests.has(request)) return false;
  handledRequests.add(request);
  return true;
}

function lf(text: string): string {
  return text.replace(/\r\n?/gu, "\n");
}

export function keepClosedEdits(saved: string, closing: string, disk: string): string {
  const lines = (text: string) => lf(text).split("\n");
  return mergeSequences(lines(saved), lines(disk), lines(closing), (line) => line).join("\n");
}

type ClosedWrite = (text: string, version: string) => Promise<NoteSource>;

async function writeClosedNote(write: ClosedWrite, text: string, version: string, saved: string): Promise<string | null> {
  try {
    await write(text, version);
    return null;
  } catch (error) {
    if (!(error instanceof NoteConflictError)) {
      void logError("save the note", error);
      return describeError(error);
    }
    try {
      await write(keepClosedEdits(saved, text, error.disk.text), error.disk.version);
      return null;
    } catch (again) {
      void logError("save the note", again);
      return describeError(again);
    }
  }
}

const SAVE_DELAY_MS = 800;
const PROJECT_NAME_CHARS = 200;
const FLUSH_ROUNDS = 3;
const WIDTH_CLASSES: Readonly<Record<NoteWidth, string>> = {
  standard: "max-w-[44rem] px-4",
  wide: "max-w-[58rem] px-4",
  full: "max-w-none px-[max(1rem,5%)]",
};

type BlankClick = Pick<MouseEvent, "target" | "clientX" | "clientY" | "button" | "preventDefault">;

export function focusFromBlank(editor: Editor | null, event: BlankClick): void {
  if (!editor || event.button !== 0) return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.hasAttribute("data-note-blank")) return;
  const body = editor.view.dom.getBoundingClientRect();
  if (event.clientY < body.top) return;
  event.preventDefault();
  if (event.clientY > body.bottom) {
    editor.commands.focus("end");
    return;
  }
  const left = Math.min(Math.max(event.clientX, body.left + 1), body.right - 1);
  const found = editor.view.posAtCoords({ left, top: event.clientY });
  if (found) editor.chain().focus().setTextSelection(found.pos).run();
  else editor.commands.focus("end");
}

function parseNote(source: string) {
  return parseNoteMarkdown(source);
}

function frontMatterBlock(text: string): string {
  return text.replace(/\s+$/u, "");
}

function sameText(left: string, right: string): boolean {
  return left.replace(/\r\n?/gu, "\n") === right.replace(/\r\n?/gu, "\n");
}

function namesTitle(name: string, title: string): boolean {
  return name === title || Array.from(title).slice(0, PROJECT_NAME_CHARS).join("").trim() === name;
}

export function NoteDocument(props: Readonly<NoteDocumentProps>) {
  const [attempt, setAttempt] = useState(0);
  return <NoteLoader key={attempt} {...props} onRetry={() => setAttempt((count) => count + 1)} />;
}

function NoteLoader({ onRetry, ...props }: Readonly<NoteDocumentProps & { onRetry: () => void }>) {
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
      (error: unknown) => {
        if (!live) return;
        void logError("open a note", error);
        setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [loadNote, noteId]);

  if (failed) {
    return (
      <div data-note-load-failed className="flex flex-1 flex-col items-start gap-3 p-6">
        <p className="text-sm text-muted-foreground">{t(($) => $.notes.document.loadFailed)}</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t(($) => $.notes.document.retryLoad)}
          </Button>
          {props.onClose && (
            <Button variant="ghost" size="sm" onClick={props.onClose}>
              {t(($) => $.notes.document.closeTab)}
            </Button>
          )}
        </div>
      </div>
    );
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
  onOpenNote,
  onOpenTag,
  openHeading,
  live = null,
  shown = true,
}: Readonly<NoteDocumentProps & { initial: NoteSource }>) {
  const { t } = useTranslation(["notes"]);
  const {
    resolveAsset,
    loadNote,
    renameNote,
    saveNote,
    watchNote,
    openProject,
  } = useNotesData();
  const resolveRef = useRef(resolveAsset);
  resolveRef.current = resolveAsset;
  const imageTargetRef = useRef(noteImageTarget(note));
  imageTargetRef.current = noteImageTarget(note);
  const [parsed] = useState(() => parseNote(initial.text));
  const openLinked = (projectId: string, newTab: boolean, heading?: string) =>
    onOpenNote?.(projectId, heading ? { newTab, heading } : { newTab });
  const noteLinks = useNoteLinkExtensions({
    currentProjectId: note.id,
    onOpenNote: (_linkedNoteId, { projectId, newTab, heading }) => openLinked(projectId, newTab, heading),
    onOpenProject: (projectId) => openProject?.(projectId),
  });
  const initialId = useMemo(() => readNoteFacts(initial.text).id, [initial.text]);
  const knowledge = useNoteKnowledge({
    notes: noteLinks.index.notes,
    currentNoteId: initialId,
    onOpenNote: (_linkedNoteId, { projectId, newTab, heading }) => openLinked(projectId, newTab, heading),
    onOpenTag,
  });
  const proofreading = useNoteProofreading(note);
  const extensions = useMemo(() => {
    const noteId = note.id;
    const resolve = (path: string) => resolveRef.current?.(noteId, path) ?? Promise.resolve(null);
    return [
      ...noteBaseExtensions({ renderMath: renderMathExpression }, { callout: calloutNodeView() })
        .map(withBlockViews)
        .map((extension) => withImageView(extension, resolve, noteId))
        .map((extension) => withNoteEmbeds(extension, knowledge.embeds)),
      NoteSuggestions,
      NotePeerMarks,
      NoteSelection.configure({ wholeNote: (doc) => serializeNoteMarkdown(doc.toJSON(), snapshotRef.current) }),
      NoteSlash,
      NoteImageDrop.configure({ target: () => (readOnlyRef.current ? null : imageTargetRef.current) }),
      ...noteLinks.extensions,
      ...knowledge.tagExtensions,
      proofreading.extension,
      NoteFind,
    ];
  }, [knowledge, note.id, noteLinks.extensions, proofreading.extension]);
  const editor = useEditor({ extensions, content: parsed.doc });
  const assistantRef = useRef<NoteAssistantHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const assistantDockRef = useRef<HTMLDivElement>(null);
  const frontMatterRef = useRef(parsed.frontmatter);
  const savedFrontMatterRef = useRef(parsed.frontmatter);
  const separatorRef = useRef(parsed.separator);
  const snapshotRef = useRef<MarkdownSourceSnapshot | null>(null);
  const versionRef = useRef(initial.version);
  const savedTextRef = useRef(initial.text);
  const localRef = useRef(new LocalEdits());
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef<Promise<void> | null>(null);
  const statusRef = useRef(onStatusChange);
  statusRef.current = onStatusChange;
  const lastStatusRef = useRef<SaveStatus>("saved");
  const failureRef = useRef<unknown>(null);
  const retryRef = useRef<() => void>(() => undefined);
  const report = useCallback((status: SaveStatus) => {
    lastStatusRef.current = status;
    statusRef.current?.(status, status === "failed" ? { error: failureRef.current, retry: () => retryRef.current() } : null);
  }, []);
  const [facts, setFacts] = useState(() => readNoteFacts(initial.text));
  const [title, setTitle] = useState(facts.title ?? note.title);
  const [review, setReview] = useState<ReviewSummary>({ count: 0, index: -1, activeId: null });
  const [canUndo, setCanUndo] = useState(false);
  const [bubble, setBubble] = useState<SelectionBubble | null>(null);
  const askKeys = useShortcutStore((state) => shortcutLabel(state.bindings.notesAskAgent));
  const width = useNoteWidth();
  const editingTitle = useRef(false);
  const savedDocRef = useRef<ProseMirrorNode | null>(editor.state.doc);
  const baseRef = useRef<string | null>(null);
  const collabRef = useRef<NoteLiveControl | null>(null);
  const readOnlyRef = useRef(false);
  const deferredRef = useRef(false);
  const handBackRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const quietRef = useRef(false);
  const wholeNote = useCallback<WholeNoteText>((doc) => serializeNoteMarkdown(doc.toJSON(), snapshotRef.current), []);

  const sourceOf = useCallback(
    (doc: ProseMirrorNode) => noteSourceOf(doc, frontMatterRef.current, separatorRef.current, snapshotRef.current),
    [],
  );

  const adoptFacts = useCallback(
    (text: string) => {
      const next = readNoteFacts(text);
      setFacts(next);
      setTitle(next.title ?? note.title);
    },
    [note.title],
  );

  const handleDisk = useCallback(
    (disk: NoteSource): boolean => {
      if (collabRef.current?.holds()) return false;
      if (sameText(disk.text, savedTextRef.current)) {
        versionRef.current = disk.version;
        return false;
      }
      const next = parseNote(disk.text);
      const ownWrite =
        timerRef.current === null &&
        savingRef.current === null &&
        noteWrittenHere(note.id, disk.text) &&
        sameText(sourceOf(docWithPending(editor, "disk")), savedTextRef.current);
      if (ownWrite) {
        if (hasPending(editor, "disk")) {
          quietRef.current = true;
          try {
            showSuggestions(editor, [], "disk");
          } finally {
            quietRef.current = false;
          }
        }
        frontMatterRef.current = next.frontmatter;
        savedFrontMatterRef.current = next.frontmatter;
        separatorRef.current = next.separator;
        adoptFacts(next.frontmatter);
        showNoteDoc(editor, editor.schema.nodeFromJSON(next.doc));
        snapshotRef.current = createMarkdownSourceSnapshot(next.layout, editor.getJSON());
        savedDocRef.current = editor.state.doc;
        localRef.current.clear();
        versionRef.current = disk.version;
        savedTextRef.current = disk.text;
        return false;
      }
      const merged = mergeFrontMatter(savedFrontMatterRef.current, frontMatterRef.current, next.frontmatter);
      frontMatterRef.current = merged;
      savedFrontMatterRef.current = next.frontmatter;
      separatorRef.current = next.separator;
      adoptFacts(merged);
      const drafts = diffNoteDocs(editor.state.doc, editor.schema.nodeFromJSON(next.doc)).filter(
        (draft) => !localRef.current.overlaps(draft.from, draft.to),
      );
      if (drafts.length > 0 || hasPending(editor, "disk")) showSuggestions(editor, drafts, "disk");
      savedDocRef.current = docWithPending(editor, "disk");
      versionRef.current = disk.version;
      savedTextRef.current = disk.text;
      return merged !== next.frontmatter;
    },
    [adoptFacts, editor, note.id, sourceOf],
  );

  const save = useCallback(async (): Promise<void> => {
    if (collabRef.current?.holds()) {
      deferredRef.current = true;
      return;
    }
    deferredRef.current = false;
    while (savingRef.current) await savingRef.current;
    frontMatterRef.current = frontMatterBlock(withNoteIdentity(frontMatterRef.current));
    const frontMatter = frontMatterRef.current;
    const savedDoc = docWithPending(editor, "disk");
    const text = sourceOf(savedDoc);
    if (sameText(text, savedTextRef.current)) {
      report("saved");
      return;
    }
    report("saving");
    const docAtStart = editor.state.doc;
    const base = baseRef.current;
    baseRef.current = null;
    const version = versionRef.current;
    const saving = recordNoteWrite(note.id, text, () =>
      base === null ? saveNote(note.id, text, version) : saveNote(note.id, text, version, base),
    );
    const run = saving.then(
      (saved) => {
        failureRef.current = null;
        handBackRef.current = null;
        versionRef.current = saved.version;
        savedTextRef.current = saved.text;
        savedFrontMatterRef.current = frontMatter;
        savedDocRef.current = savedDoc;
        if (editor.state.doc === docAtStart) localRef.current.clear();
        report("saved");
      },
      (error: unknown) => {
        if (baseRef.current === null) baseRef.current = base;
        if (!mountedRef.current) return;
        if (error instanceof NoteConflictError) {
          handleDisk(error.disk);
          report("saving");
          if (timerRef.current !== null) window.clearTimeout(timerRef.current);
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            void save();
          }, SAVE_DELAY_MS);
          return;
        }
        failureRef.current = error;
        void logError("save the note", error);
        report("failed");
      },
    );
    const tracked: Promise<void> = run.finally(() => {
      if (savingRef.current === tracked) savingRef.current = null;
    });
    savingRef.current = tracked;
    await tracked;
  }, [editor, handleDisk, note.id, report, saveNote, sourceOf]);
  retryRef.current = () => void save();

  const scheduleSave = useCallback(() => {
    if (collabRef.current?.holds()) {
      collabRef.current.localChanged();
      return;
    }
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    report("saving");
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void save();
    }, SAVE_DELAY_MS);
  }, [report, save]);

  const collab = useNoteLiveEditor(note.id, editor, {
    sourceOf,
    baseline: () => {
      localRef.current.clear();
      const shared = handBackRef.current;
      if (shared !== null) {
        handBackRef.current = null;
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        timerRef.current = null;
        deferredRef.current = false;
        baseRef.current = null;
        failureRef.current = null;
        savedTextRef.current = shared;
        savedFrontMatterRef.current = splitMarkdownFrontMatter(shared).frontmatter;
        versionRef.current = noteVersion(shared);
        savedDocRef.current = null;
        report("saved");
        return { text: shared, serialized: shared };
      }
      return {
        text: savedTextRef.current,
        serialized: savedDocRef.current ? sourceOf(savedDocRef.current) : savedTextRef.current,
      };
    },
    settle: async () => {
      if (savingRef.current) await savingRef.current;
      if (timerRef.current === null || handBackRef.current !== null) return;
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      await save();
    },
    adopt: ({ text, frontmatter, snapshot }) => {
      snapshotRef.current = snapshot;
      separatorRef.current = splitMarkdownFrontMatter(text).separator;
      if (frontmatter === frontMatterRef.current) return;
      frontMatterRef.current = frontmatter;
      const next = readNoteFacts(text);
      setFacts(next);
      if (!editingTitle.current) setTitle(next.title ?? note.title);
      if (next.title && next.title !== note.title && !note.home) {
        void renameNote?.(note.id, next.title).catch((error: unknown) => logError("rename note", error));
      }
    },
    handBack: ({ text, base, edited }) => {
      localRef.current.clear();
      handBackRef.current = edited ? text : null;
      savedTextRef.current = edited ? base : text;
      savedFrontMatterRef.current = splitMarkdownFrontMatter(savedTextRef.current).frontmatter;
      versionRef.current = noteVersion(savedTextRef.current);
      savedDocRef.current = edited ? null : editor.state.doc;
      baseRef.current = edited ? base : null;
      if (!edited) {
        report("saved");
        return;
      }
      report("saving");
      void save();
    },
  }, live);
  collabRef.current = collab.control;
  readOnlyRef.current = collab.state.readOnly;
  const liveRef = useRef(false);
  liveRef.current = collab.state.live;
  const shownTitleRef = useRef(note.title);
  shownTitleRef.current = facts.title || note.title;
  const saveJob = useMemo(
    () => ({ title: () => shownTitleRef.current, timedOut: () => t(($) => $.notes.saving.timedOut) }),
    [t],
  );

  const unsavedReason = useCallback((): string | null => {
    if (lastStatusRef.current === "failed") return describeError(failureRef.current);
    const waiting = lastStatusRef.current === "saving" || timerRef.current !== null || savingRef.current !== null;
    const connecting =
      Boolean(collabRef.current?.holds()) &&
      !liveRef.current &&
      !sameText(sourceOf(docWithPending(editor, "disk")), savedTextRef.current);
    return waiting || connecting ? t(($) => $.notes.saving.notSaved) : null;
  }, [editor, sourceOf, t]);

  const flushNow = useCallback(async (): Promise<string | null> => {
    await collabRef.current?.flush();
    for (let round = 0; round < FLUSH_ROUNDS; round += 1) {
      if (savingRef.current) await savingRef.current;
      if (timerRef.current === null) break;
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      await save();
    }
    return unsavedReason();
  }, [save, unsavedReason]);

  const flushRef = useRef(flushNow);
  flushRef.current = flushNow;
  const busy = useCallback(
    () =>
      timerRef.current !== null ||
      savingRef.current !== null ||
      lastStatusRef.current !== "saved" ||
      deferredRef.current ||
      handBackRef.current !== null,
    [],
  );

  useEffect(() => {
    if (collab.state.live || collab.state.readOnly || !deferredRef.current) return;
    deferredRef.current = false;
    scheduleSave();
  }, [collab.state.live, collab.state.readOnly, scheduleSave]);

  useEffect(
    () =>
      registerNoteEditor(note.id, {
        ...saveJob,
        editor,
        root: scrollRef.current,
        text: () => sourceOf(docWithPending(editor, "disk")),
        flush: () => flushRef.current(),
        busy,
        history: (redo) => {
          if (editor.isDestroyed) return;
          if (!redo && undoReject(editor)) return;
          if (redo) editor.commands.redo();
          else editor.commands.undo();
        },
      }),
    [busy, editor, note.id, saveJob, sourceOf],
  );

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
      setCanUndo(canUndoReject(editor));
      if (isReviewNavigation(transaction)) {
        editor.view.dom.querySelector(".note-diff-active")?.scrollIntoView({ block: "center" });
      }
      if (isRemoteTransaction(transaction) || quietRef.current) return;
      let frontMatter = frontMatterRef.current;
      for (const step of frontMatterSteps(transaction)) {
        frontMatter = frontMatterBlock(mergeFrontMatter(step.before, step.after, frontMatter));
      }
      if (frontMatter !== frontMatterRef.current) {
        frontMatterRef.current = frontMatter;
        adoptFacts(frontMatter);
      }
      if (transaction.docChanged) {
        if (!liveRef.current) localRef.current.record(transaction.mapping);
        scheduleSave();
      } else if (isReviewTransaction(transaction)) {
        scheduleSave();
      }
    };
    let frame = 0;
    const placeBubble = () => {
      frame = 0;
      const { from, to, empty } = editor.state.selection;
      if (empty || editor.isDestroyed || !editor.state.doc.textBetween(from, Math.min(to, from + BUBBLE_PROBE), " ").trim()) {
        setBubble(null);
        return;
      }
      const next = bubblePlace(editor.view.coordsAtPos(from), editor.view.coordsAtPos(to), { width: window.innerWidth });
      setBubble((current) => (current && current.top === next.top && current.left === next.left ? current : next));
    };
    const trackSelection = () => {
      if (editor.state.selection.empty) {
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0;
        setBubble(null);
        return;
      }
      if (!frame) frame = window.requestAnimationFrame(placeBubble);
    };
    const hide = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      setBubble(null);
    };
    editor.on("transaction", onTransaction);
    editor.on("selectionUpdate", trackSelection);
    editor.on("blur", hide);
    const scroller = scrollRef.current;
    scroller?.addEventListener("scroll", hide, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      editor.off("transaction", onTransaction);
      editor.off("selectionUpdate", trackSelection);
      editor.off("blur", hide);
      scroller?.removeEventListener("scroll", hide);
    };
  }, [adoptFacts, editor, scheduleSave]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, useShortcutStore.getState().bindings.notesAskAgent) || !editor.view.hasFocus()) return;
      const text = selectedText(editor, wholeNote);
      if (!text) return;
      event.preventDefault();
      event.stopPropagation();
      assistantRef.current?.quote(text);
    };
    scroller.addEventListener("keydown", onKeyDown, true);
    return () => scroller.removeEventListener("keydown", onKeyDown, true);
  }, [editor, wholeNote]);

  const checkDisk = useCallback(() => {
    if (collabRef.current?.holds()) return;
    loadNote(note.id).then(
      (disk) => {
        if (handleDisk(disk)) scheduleSave();
      },
      () => {},
    );
  }, [handleDisk, loadNote, note.id, scheduleSave]);

  useEffect(() => watchNote?.(note.id, checkDisk), [checkDisk, note.id, watchNote]);

  const shownRef = useRef(shown);
  useEffect(() => {
    const returning = shown && !shownRef.current;
    shownRef.current = shown;
    if (returning) checkDisk();
  }, [checkDisk, shown]);

  useEffect(() => {
    const flush = () => {
      if (timerRef.current === null) return null;
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      return save();
    };
    const onLeave = () => void flush();
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("blur", onLeave);
    window.addEventListener("pagehide", onLeave);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("blur", onLeave);
      window.removeEventListener("pagehide", onLeave);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [save]);

  const closeRef = useRef<() => void>(() => undefined);
  closeRef.current = () => {
    mountedRef.current = false;
    const dirty = busy();
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    const pending = savingRef.current;
    if (!dirty) return;
    frontMatterRef.current = frontMatterBlock(withNoteIdentity(frontMatterRef.current));
    const text = sourceOf(docWithPending(editor, "disk"));
    const notSaved = t(($) => $.notes.saving.notSaved);
    const write: ClosedWrite = (body, version) => {
      const base = baseRef.current;
      return recordNoteWrite(note.id, body, () =>
        base === null ? saveNote(note.id, body, version) : saveNote(note.id, body, version, base),
      );
    };
    const attempt = async (): Promise<string | null> => {
      if (collabRef.current?.holds()) return notSaved;
      if (sameText(text, savedTextRef.current)) return null;
      return writeClosedNote(write, text, versionRef.current, savedTextRef.current);
    };
    const done = (async () => {
      await pending?.catch(() => undefined);
      return attempt();
    })();
    trackNoteSave(saveJob, done, attempt);
  };
  useEffect(() => {
    mountedRef.current = true;
    return () => closeRef.current();
  }, []);

  useEffect(() => {
    const snippet = insertRequest?.snippet;
    if (!snippet || !firstTime(insertRequest) || readOnlyRef.current) return;
    editor.chain().focus("end").insertContent(parseNote(snippet).doc.content ?? []).run();
  }, [editor, insertRequest]);

  useEffect(() => {
    if (openHeading && firstTime(openHeading)) scrollViewToHeading(editor.view, openHeading.slug);
  }, [editor, openHeading]);

  const changeFrontMatter = (update: (text: string) => string, undoable = true) => {
    if (readOnlyRef.current) return;
    const before = frontMatterRef.current;
    const after = frontMatterBlock(update(before));
    frontMatterRef.current = after;
    adoptFacts(after);
    if (after === before) {
      scheduleSave();
      return;
    }
    editor.view.dispatch(frontMatterChange(editor.state.tr, before, after, undoable));
  };
  const changeRef = useRef(changeFrontMatter);
  changeRef.current = changeFrontMatter;
  const declaredTitle = useRef(facts.title);
  declaredTitle.current = facts.title;

  const adoptName = useCallback((name: string) => {
    const declared = declaredTitle.current;
    if (declared === null) setTitle(name);
    else if (!namesTitle(name, declared)) changeRef.current((text) => withNoteTitle(text, name), false);
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
    changeFrontMatter((text) => withNoteTitle(text, next), false);
    void renameNote?.(note.id, next).catch((error: unknown) => {
      notifyError("rename note", error, t(($) => $.notes.library.menu.renameFailed, { name: current }));
      if (mountedRef.current) changeRef.current((text) => (readNoteFacts(text).title === next ? withNoteTitle(text, current) : text), false);
    });
  };

  const assistantBridge = useMemo<NoteEditorBridge>(
    () => ({
      readSource: () => sourceOf(docWithPending(editor, "agent")),
      pending: () => reviewSummary(editor).count,
      propose: (edits) => {
        if (readOnlyRef.current) return 0;
        const proposed = applyNoteEdits(sourceOf(docWithPending(editor, "agent")), edits);
        const current = editor.schema.nodeFromJSON(parseNote(sourceOf(editor.state.doc)).doc);
        const shown = current.eq(editor.state.doc) ? current : editor.state.doc;
        const drafts = diffNoteDocs(shown, editor.schema.nodeFromJSON(parseNote(proposed.text).doc));
        showSuggestions(editor, drafts, "agent");
        return drafts.length;
      },
    }),
    [editor, sourceOf],
  );

  const liveReadOnly = collab.state.readOnly;
  useEffect(() => {
    editableChanged(editor);
    if (liveReadOnly) return;
    for (const batch of takePendingBatches(note.id)) assistantBridge.propose(batch);
  }, [assistantBridge, editor, liveReadOnly, note.id]);

  useEffect(
    () => () => {
      if (!hasPending(editor, "agent")) return;
      const shown = sourceOf(editor.state.doc);
      addPendingBatch(note.id, editsBetween(shown, sourceOf(docWithPending(editor, "agent"))), true);
    },
    [editor, note.id, sourceOf],
  );

  const writer =
    note.author === "agent" && note.agent
      ? t(($) => $.notes.document.writtenByAgent, { agent: note.agent })
      : note.shared
        ? null
        : t(($) => $.notes.document.writtenByYou);
  const byline = [
    ...(writer ? [writer] : []),
    note.project,
    ...(note.updatedAt > 0 ? [formatRelativeTimeFrom(note.updatedAt, Date.now(), { dateAfterDays: 7 })] : []),
  ].join(" · ");

  const home = note.home;
  let editSource: (() => void) | undefined;
  if (home) editSource = () => useNoteTabsStore.getState().setMarkdown(home.projectId, home.path, true);
  else if (openProject) editSource = () => openProject(note.id);

  const linkTooltips = useDelegatedTooltips(scrollRef);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onDown = (event: MouseEvent) => focusFromBlank(editor, event);
    scroller.addEventListener("mousedown", onDown);
    return () => scroller.removeEventListener("mousedown", onDown);
  }, [editor]);

  return (
    <div
      ref={scrollRef}
      data-note-width={width}
      data-note-blank
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      <NoteToolbar editor={editor} noteId={note.id} projectId={note.relatedProjectId} readOnly={collab.state.readOnly} />
      <NoteFindBar editor={editor} scope={scrollRef} />
      <article
        data-note-blank
        className={cn("mx-auto w-full flex-1 cursor-text pb-32 pt-10 transition-[max-width] duration-200 motion-reduce:transition-none", WIDTH_CLASSES[width])}
      >
        <div className="group/header" spellCheck={false}>
          {collab.state.readOnly ? (
            facts.icon && (
              <span data-note-icon-static className="-ml-1 mb-3 inline-flex rounded-xl p-1">
                <NoteChip icon={facts.icon} color={facts.color} size="lg" />
              </span>
            )
          ) : (
            <IconPicker
              value={facts.icon}
              hasIcon={Boolean(facts.icon)}
              onChange={(icon) => changeFrontMatter((text) => withNoteIcon(text, icon))}
              color={facts.color}
              onColorChange={(color) => changeFrontMatter((text) => withNoteColor(text, color))}
              trigger={
                facts.icon ? (
                  <NoteChip icon={facts.icon} color={facts.color} size="lg" />
                ) : (
                  <span data-add-icon className="flex items-center gap-1.5 text-sm">
                    <SmilePlus aria-hidden className="size-4" />
                    {t(($) => $.notes.document.addIcon)}
                  </span>
                )
              }
              triggerClassName={
                facts.icon
                  ? "-ml-1 mb-3 size-auto rounded-xl p-1 transition-colors hover:bg-accent focus-visible:bg-accent"
                  : "-ml-1.5 mb-2 h-7 w-auto rounded-md px-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:opacity-100 group-hover/header:opacity-100 data-[state=open]:opacity-100"
              }
            />
          )}
          <input
            aria-label={t(($) => $.notes.document.titleLabel)}
            placeholder={t(($) => $.notes.document.untitled)}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onFocus={() => {
              editingTitle.current = true;
            }}
            onBlur={commitTitle}
            readOnly={collab.state.readOnly}
            onKeyDown={(event) => {
              if (isImeEnter(event)) return;
              if (event.key === "Enter") {
                event.preventDefault();
                editor.commands.focus("start");
              }
              if (event.key === "Escape") setTitle(facts.title ?? note.title);
            }}
            className="note-title w-full border-0 bg-transparent p-0 text-2xl font-bold placeholder:text-muted-foreground/60"
          />
          <NoteProperties
            frontMatter={frontMatterRef.current}
            onChange={changeFrontMatter}
            editable={!collab.state.readOnly}
            notes={noteLinks.index.notes}
            onOpenNote={(linked) => openLinked(linked.projectId, false)}
            onEditSource={editSource}
          />
        </div>
        <p className="mb-6 mt-1 text-xs text-muted-foreground">{byline}</p>
        {collab.state.viewOnly && (
          <p data-note-view-only className="-mt-4 mb-6 text-xs text-muted-foreground">
            {t(($) => $.notes.live.viewOnly)}
          </p>
        )}
        <div data-note-blank className="wysiwyg-content note-body">
          <EditorContent editor={editor} />
        </div>
        <NoteBacklinks
          noteId={facts.id}
          onOpenNote={(_linkedNoteId, { projectId, newTab }) => onOpenNote?.(projectId, { newTab })}
          className="mt-10"
        />
        <NoteLinkMenu editor={editor} />
        <NoteSlashMenu editor={editor} />
        <NoteTagMenu editor={editor} />
        <NoteProofreadingPopover editor={editor} proofreading={proofreading} />
        <NoteHoverPreview containerRef={scrollRef} {...knowledge.hover} />
        {linkTooltips}
      </article>
      {bubble && (
        <div
          data-note-selection-bubble
          style={{ top: bubble.top, left: bubble.left }}
          className="fixed z-50 flex gap-0.5 rounded-md border bg-popover p-1 text-popover-foreground shadow-xl"
        >
          <Button
            variant="ghost"
            size="xs"
            aria-keyshortcuts={askKeys}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => assistantRef.current?.quote(selectedText(editor, wholeNote))}
          >
            {t(($) => $.notes.document.askAgent)}
            <span aria-hidden className="text-muted-foreground">
              {askKeys}
            </span>
          </Button>
          {onSendToPaper && (
            <Button
              variant="ghost"
              size="xs"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSendToPaper(selectedText(editor, wholeNote))}
            >
              {t(($) => $.notes.document.sendToPaper)}
            </Button>
          )}
        </div>
      )}
      {(review.count > 0 || canUndo) && !collab.state.readOnly && (
        <FloatingReview
          editor={editor}
          review={review}
          canUndo={canUndo}
          scrollRef={scrollRef}
          bottomRef={assistantDockRef}
        />
      )}
      <div ref={assistantDockRef} className="pointer-events-none sticky bottom-0 z-10 px-6 pb-4">
        <NoteAssistant
          key={note.id}
          ref={assistantRef}
          note={note}
          bridge={assistantBridge}
          shortcutScope={scrollRef}
          viewOnly={collab.state.viewOnly}
        />
      </div>
    </div>
  );
}

