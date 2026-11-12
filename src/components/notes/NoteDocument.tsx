import { renderMathExpression } from "@oleafly/editor/math-render";
import { createMarkdownSourceSnapshot, type MarkdownSourceSnapshot, splitMarkdownFrontMatter } from "@oleafly/wysiwyg";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorContent, useEditor } from "@tiptap/react";
import { ChevronLeft, ChevronRight, SmilePlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { NoteBlockHandle } from "./NoteBlockHandle";
import { NoteDeadLinksSection } from "./NoteDeadLinks";
import { NoteInfo } from "./NoteInfo";
import { NoteAttachmentsSection } from "./NotesAttachments";
import { createBlockRefs } from "./note-block-refs";
import { NoteCitationMarks, NoteReferences, useNoteCitations } from "./note-citation-marks";
import { calloutNodeView } from "./NoteCallout";
import { NoteLinkMenu } from "./NoteLinkMenu";
import { NoteSlash } from "./note-slash";
import { NoteSlashMenu } from "./NoteSlashMenu";
import { NoteProperties } from "./NoteProperties";
import { NoteProofreadingPopover, useNoteProofreading } from "./note-proofreading";
import { mergeFrontMatter } from "./note-properties";
import { NoteTagMenu } from "./NoteTagMenu";
import { NoteAtMenu } from "./NoteAtMenu";
import { NoteFieldPopover } from "./NoteFieldPopover";
import { withNoteEmbeds } from "./note-embeds";
import { NoteHoverPreview } from "./note-hover-preview";
import { scrollViewToHeading } from "./note-links";
import { noteBaseExtensions, parseNoteMarkdown, serializeNoteMarkdown } from "./note-markdown";
import { useNoteKnowledge } from "./use-note-knowledge";
import { noteAssetActions, withBlockViews, withImageView } from "./block-views";
import { IconPicker } from "./IconPicker";
import { diffNoteDocs } from "./note-diff";
import { applyNoteEdits } from "./note-edits";
import { readNoteFacts, withNoteColor, withNoteIcon, withNoteIdentity, withNoteTitle } from "./note-file";
import { NoteChip, noteColorStyle } from "./note-icons";
import { useNoteWidth, type NoteWidth } from "./note-prefs";
import { useNoteLinkExtensions } from "./use-note-links";
import { NoteImageDrop, noteImageTarget } from "./note-image-drop";
import { NoteUndoMemory, restoreUndo, startUndoMemory, undoRecord } from "./note-undo-memory";
import { NoteLinkChoice } from "./note-link-choice";
import { bubblePlace, type SelectionBubble } from "./note-bubble";
import { indexedUndoStore } from "./note-undo-store";
import { useSettingsStore } from "@/store/settings";
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
import { isRemoteTransaction, noteSourceOf, parseSharedNote, type SharedNote, sharedNoteSnapshot, showNoteDoc } from "./note-live-doc";
import { NotePeerMarks } from "./note-presence-decorations";
import { noteClipboardText, NoteSelection, type WholeNoteText } from "./note-selection";
import { frontMatterChange, frontMatterSteps } from "./note-front-matter-step";
import { type ClosedWrite, keepEditorReview, lf, outsideDrafts, withBodyEdits, writeClosedNote } from "./note-outside-changes";
import { registerNoteEditor, trackNoteSave } from "@/lib/open-note-editors";
import { addPendingBatch, editsBetween, keptReview, takePendingBatches } from "./note-pending-suggestions";
import { saveVersionBeforeAccept } from "./note-versions";
import { useDailyNeighbors } from "./daily-note";
import { editableChanged } from "./note-editable";
import { type NoteLiveControl, type NoteLiveTarget, useNoteLiveEditor } from "./use-note-live";
import { useNotesData } from "./notes-data";
import { noteVersion, noteWrittenHere } from "./notes-service";
import { FloatingReview } from "./FloatingReview";
import { NoteLiveNotice } from "./NoteLiveNotice";
import { NoteSaveFailed } from "./NoteSaveStatus";
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
  openScroll?: { top: number; id: number } | null;
  live?: NoteLiveTarget | null;
  onClose?: () => void;
  shown?: boolean;
  infoPanel?: HTMLElement | null;
}

const BUBBLE_PROBE = 4096;

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
  if (!(target instanceof HTMLElement) || target.dataset.noteBlank === undefined) return;
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

function frontMatterBlock(text: string): string {
  return text.trimEnd();
}

async function writeWhenIdle(saving: { readonly current: Promise<void> | null }, write: () => Promise<void>): Promise<void> {
  const pending = saving.current;
  if (!pending) return write();
  await pending;
  return writeWhenIdle(saving, write);
}

async function repeatWhile(rounds: number, round: () => Promise<boolean>): Promise<void> {
  if (rounds <= 0 || !(await round())) return;
  await repeatWhile(rounds - 1, round);
}

function sameText(left: string, right: string): boolean {
  return lf(left) === lf(right);
}

function namesTitle(name: string, title: string): boolean {
  return name === title || Array.from(title).slice(0, PROJECT_NAME_CHARS).join("").trim() === name;
}

function keepUndo(editor: Editor, noteId: string): Promise<void> {
  const record = useSettingsStore.getState().notesKeepUndo ? undoRecord(editor) : null;
  return record ? indexedUndoStore.write(noteId, record) : Promise.resolve();
}

function sameNoteDoc(left: ProseMirrorNode, right: ProseMirrorNode): boolean {
  return left.eq(right) || serializeNoteMarkdown(left.toJSON()) === serializeNoteMarkdown(right.toJSON());
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
        {props.infoPanel &&
          createPortal(
            <div className="flex h-full items-center justify-center p-6">
              <Spinner size="sm" />
            </div>,
            props.infoPanel,
          )}
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
  openScroll,
  live = null,
  shown = true,
  infoPanel,
}: Readonly<NoteDocumentProps & { initial: NoteSource }>) {
  const { t } = useTranslation(["notes"]);
  const {
    resolveAsset,
    openAsset,
    revealAsset,
    attachFile,
    loadNote,
    renameNote,
    saveNote,
    watchNote,
    openProject,
  } = useNotesData();
  const resolveRef = useRef(resolveAsset);
  resolveRef.current = resolveAsset;
  const assetsRef = useRef({ openAsset, revealAsset });
  assetsRef.current = { openAsset, revealAsset };
  const attachRef = useRef(attachFile);
  attachRef.current = attachFile;
  const imageTargetRef = useRef(noteImageTarget(note));
  imageTargetRef.current = noteImageTarget(note);
  const [opened] = useState(() => {
    const kept = keptReview(note.id);
    const shown = withBodyEdits(initial.text, kept.file);
    return { kept, shown, parsed: parseNoteMarkdown(shown ?? initial.text) };
  });
  const parsed = opened.parsed;
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
  const [blockRefs] = useState(createBlockRefs);
  const extensions = useMemo(() => {
    const noteId = note.id;
    const resolve = (path: string) => resolveRef.current?.(noteId, path) ?? Promise.resolve(null);
    return [
      ...noteBaseExtensions({ renderMath: renderMathExpression }, { callout: calloutNodeView() })
        .map(withBlockViews)
        .map((extension) => withImageView(extension, resolve, note.shared ? undefined : noteId, () => noteAssetActions(assetsRef.current, noteId)))
        .map((extension) => withNoteEmbeds(extension, knowledge.embeds)),
      NoteSuggestions,
      NotePeerMarks,
      NoteSelection.configure({ wholeNote: (doc) => serializeNoteMarkdown(doc.toJSON(), snapshotRef.current) }),
      NoteSlash,
      NoteImageDrop.configure({
        target: () => (readOnlyRef.current ? null : imageTargetRef.current),
        attach: () => attachRef.current,
      }),
      ...noteLinks.extensions,
      ...knowledge.tagExtensions,
      ...knowledge.atExtensions,
      proofreading.extension,
      NoteFind,
      NoteCitationMarks,
      NoteUndoMemory,
      blockRefs.extension,
    ];
  }, [blockRefs, knowledge, note.id, note.shared, noteLinks.extensions, proofreading.extension]);
  const editor = useEditor({ extensions, content: parsed.doc });
  const citations = useNoteCitations(editor, note, (id) => onOpenNote?.(id, { newTab: false }));
  const assistantRef = useRef<NoteAssistantHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const assistantDockRef = useRef<HTMLDivElement>(null);
  const frontMatterRef = useRef(parsed.frontmatter);
  const savedFrontMatterRef = useRef(parsed.frontmatter);
  const separatorRef = useRef(parsed.separator);
  const snapshotRef = useRef<MarkdownSourceSnapshot | null>(null);
  const versionRef = useRef(initial.version);
  const savedTextRef = useRef(initial.text);
  const diskRef = useRef<SharedNote | null>(null);
  const proposalRef = useRef<SharedNote | null>(null);
  const keptRef = useRef(opened.kept.file.length + opened.kept.proposed.length > 0);
  const restoreRef = useRef(opened.kept.proposed);
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef<Promise<void> | null>(null);
  const undoWriteRef = useRef<Promise<void>>(Promise.resolve());
  const statusRef = useRef(onStatusChange);
  statusRef.current = onStatusChange;
  const lastStatusRef = useRef<SaveStatus>("saved");
  const failureRef = useRef<unknown>(null);
  const retryRef = useRef<() => void>(() => undefined);
  const [saveFailure, setSaveFailure] = useState<NoteSaveFailure | null>(null);
  const report = useCallback((status: SaveStatus) => {
    lastStatusRef.current = status;
    const failure = status === "failed" ? { error: failureRef.current, retry: () => retryRef.current() } : null;
    setSaveFailure(failure);
    statusRef.current?.(status, failure);
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
  const wholeNote = useCallback<WholeNoteText>((doc) => serializeNoteMarkdown(doc.toJSON(), snapshotRef.current), []);

  const sourceOf = useCallback(
    (doc: ProseMirrorNode) => noteSourceOf(doc, frontMatterRef.current, separatorRef.current, snapshotRef.current),
    [],
  );
  const bodySourceOf = useCallback((doc: ProseMirrorNode) => lf(noteSourceOf(doc, "", "", snapshotRef.current)), []);

  const diskNote = useCallback(
    (text: string) => {
      diskRef.current = parseSharedNote(editor.schema, text, diskRef.current);
      return diskRef.current;
    },
    [editor],
  );

  const keepReviewNow = useCallback(
    (closing = false) => {
      keptRef.current = keepEditorReview(editor, note.id, { body: bodySourceOf, full: sourceOf }, closing, keptRef.current);
    },
    [bodySourceOf, editor, note.id, sourceOf],
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
      const base = diskNote(savedTextRef.current);
      const next = diskNote(disk.text);
      const ownWrite =
        timerRef.current === null &&
        savingRef.current === null &&
        noteWrittenHere(note.id, disk.text) &&
        sameText(sourceOf(docWithPending(editor, "disk")), savedTextRef.current);
      const merged = ownWrite
        ? next.frontmatter
        : mergeFrontMatter(savedFrontMatterRef.current, frontMatterRef.current, next.frontmatter);
      frontMatterRef.current = merged;
      savedFrontMatterRef.current = next.frontmatter;
      separatorRef.current = splitMarkdownFrontMatter(disk.text).separator;
      adoptFacts(merged);
      if (ownWrite) {
        if (hasPending(editor, "disk")) showSuggestions(editor, [], "disk");
        showNoteDoc(editor, next.doc);
      } else {
        const drafts = outsideDrafts(base, docWithPending(editor, "disk"), editor.state.doc, next);
        if (drafts.file.length > 0 || hasPending(editor, "disk")) showSuggestions(editor, drafts.file, "disk");
        if (drafts.held.length > 0) showSuggestions(editor, drafts.held, "agent", true);
      }
      snapshotRef.current = sharedNoteSnapshot(next);
      savedDocRef.current = docWithPending(editor, "disk");
      versionRef.current = disk.version;
      savedTextRef.current = disk.text;
      keepReviewNow();
      return merged !== next.frontmatter;
    },
    [adoptFacts, diskNote, editor, keepReviewNow, note.id, sourceOf],
  );

  const save = useCallback(async (): Promise<void> => {
    if (collabRef.current?.holds()) {
      deferredRef.current = true;
      return;
    }
    deferredRef.current = false;
    await writeWhenIdle(savingRef, async () => {
      frontMatterRef.current = frontMatterBlock(withNoteIdentity(frontMatterRef.current));
      const frontMatter = frontMatterRef.current;
      const savedDoc = docWithPending(editor, "disk");
      const text = sourceOf(savedDoc);
      if (sameText(text, savedTextRef.current)) {
        keepReviewNow();
        report("saved");
        return;
      }
      report("saving");
      const base = baseRef.current;
      baseRef.current = null;
      const version = versionRef.current;
      const saving = base === null ? saveNote(note.id, text, version) : saveNote(note.id, text, version, base);
      const run = saving.then(
        (saved) => {
          failureRef.current = null;
          handBackRef.current = null;
          versionRef.current = saved.version;
          savedTextRef.current = saved.text;
          savedFrontMatterRef.current = frontMatter;
          savedDocRef.current = savedDoc;
          if (!editor.isDestroyed && editor.state.doc === savedDoc) undoWriteRef.current = keepUndo(editor, note.id);
          if (mountedRef.current) keepReviewNow();
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
    });
  }, [editor, handleDisk, keepReviewNow, note.id, report, saveNote, sourceOf]);
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
  }, live, shown);
  collabRef.current = collab.control;
  readOnlyRef.current = collab.state.readOnly;
  const viewOnlyRef = useRef(false);
  viewOnlyRef.current = collab.state.viewOnly;
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
    await repeatWhile(FLUSH_ROUNDS, async () => {
      if (savingRef.current) await savingRef.current;
      if (timerRef.current === null) return false;
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      await save();
      return true;
    });
    if (mountedRef.current) keepReviewNow();
    await undoWriteRef.current;
    return unsavedReason();
  }, [keepReviewNow, save, unsavedReason]);

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
    if (opened.shown === null) {
      snapshotRef.current = createMarkdownSourceSnapshot(opened.parsed.layout, editor.getJSON());
      return;
    }
    const file = diskNote(initial.text);
    snapshotRef.current = sharedNoteSnapshot(file);
    showSuggestions(editor, diffNoteDocs(editor.state.doc, file.doc), "disk");
    setReview(reviewSummary(editor));
    savedDocRef.current = docWithPending(editor, "disk");
  }, [diskNote, editor, initial.text, opened]);

  const remembersUndo = useSettingsStore((state) => state.notesKeepUndo);
  useEffect(() => {
    if (!remembersUndo || note.shared || live !== null || readOnlyRef.current || opened.shown !== null) return;
    let current = true;
    const loaded = editor.state.doc;
    void indexedUndoStore.read(note.id).then((record) => {
      if (!current || editor.isDestroyed) return;
      if (record === null || editor.state.doc !== loaded || !restoreUndo(editor, record, sameNoteDoc)) {
        startUndoMemory(editor);
        return;
      }
      snapshotRef.current = createMarkdownSourceSnapshot(opened.parsed.layout, editor.getJSON());
      savedDocRef.current = editor.state.doc;
      editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
    });
    return () => {
      current = false;
    };
  }, [editor, live, note.id, note.shared, opened, remembersUndo]);

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
      if (isRemoteTransaction(transaction)) return;
      let frontMatter = frontMatterRef.current;
      for (const step of frontMatterSteps(transaction)) {
        frontMatter = frontMatterBlock(mergeFrontMatter(step.before, step.after, frontMatter));
      }
      if (frontMatter !== frontMatterRef.current) {
        frontMatterRef.current = frontMatter;
        adoptFacts(frontMatter);
      }
      if (transaction.docChanged || isReviewTransaction(transaction)) scheduleSave();
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
      setBubble((current) => (current?.top === next.top && current.left === next.left ? current : next));
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
      if (timerRef.current === null) return;
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      void save();
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("blur", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("blur", flush);
      window.removeEventListener("pagehide", flush);
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
    keepReviewNow(true);
    const undoKept =
      !collabRef.current?.holds() && docWithPending(editor, "disk") === editor.state.doc ? keepUndo(editor, note.id) : undoWriteRef.current;
    if (!dirty) return;
    frontMatterRef.current = frontMatterBlock(withNoteIdentity(frontMatterRef.current));
    const text = sourceOf(docWithPending(editor, "disk"));
    const closed = {
      noteId: note.id,
      text,
      shownBody: bodySourceOf(editor.state.doc),
      savedFrontMatter: savedFrontMatterRef.current,
      frontMatter: frontMatterRef.current,
      separator: separatorRef.current,
    };
    const notSaved = t(($) => $.notes.saving.notSaved);
    const write: ClosedWrite = (body, version) => {
      const base = baseRef.current;
      return base === null ? saveNote(note.id, body, version) : saveNote(note.id, body, version, base);
    };
    const attempt = async (): Promise<string | null> => {
      if (collabRef.current?.holds()) return notSaved;
      if (sameText(text, savedTextRef.current)) return null;
      return writeClosedNote(write, versionRef.current, { ...closed, saved: savedTextRef.current });
    };
    const done = (async () => {
      await pending?.catch(() => undefined);
      const reason = await attempt();
      await undoKept;
      return reason;
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
    editor.chain().focus("end").insertContent(parseNoteMarkdown(snippet).doc.content ?? []).run();
  }, [editor, insertRequest]);

  useEffect(() => {
    if (openHeading && firstTime(openHeading)) scrollViewToHeading(editor.view, openHeading.slug);
  }, [editor, openHeading]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller && openScroll && firstTime(openScroll)) scroller.scrollTop = openScroll.top;
  }, [openScroll]);

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
        if (readOnlyRef.current) {
          if (viewOnlyRef.current) return 0;
          addPendingBatch(note.id, edits);
          return edits.length;
        }
        const proposed = applyNoteEdits(sourceOf(docWithPending(editor, "agent")), edits);
        proposalRef.current = parseSharedNote(editor.schema, proposed.text, proposalRef.current ?? diskRef.current);
        const drafts = diffNoteDocs(editor.state.doc, proposalRef.current.doc);
        showSuggestions(editor, drafts, "agent");
        return drafts.length;
      },
    }),
    [editor, note.id, sourceOf],
  );

  const liveReadOnly = collab.state.readOnly;
  useEffect(() => {
    editableChanged(editor);
    if (liveReadOnly) return;
    const batches = [restoreRef.current, ...takePendingBatches(note.id)].filter((batch) => batch.length > 0);
    restoreRef.current = [];
    for (const batch of batches) assistantBridge.propose(batch);
  }, [assistantBridge, editor, liveReadOnly, note.id]);

  useEffect(
    () => () => {
      if (!hasPending(editor, "agent")) return;
      const shown = sourceOf(editor.state.doc);
      addPendingBatch(note.id, editsBetween(shown, sourceOf(docWithPending(editor, "agent"))), true);
    },
    [editor, note.id, sourceOf],
  );

  let writer: string | null = null;
  if (note.author === "agent" && note.agent) writer = t(($) => $.notes.document.writtenByAgent, { agent: note.agent });
  else if (!note.shared) writer = t(($) => $.notes.document.writtenByYou);
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
  const daily = useDailyNeighbors(note.id);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onDown = (event: MouseEvent) => focusFromBlank(editor, event);
    scroller.addEventListener("mousedown", onDown);
    return () => scroller.removeEventListener("mousedown", onDown);
  }, [editor]);

  const inline = infoPanel === undefined;
  const openHere = (id: string, heading?: string) => onOpenNote?.(id, heading ? { newTab: false, heading } : { newTab: false });
  const properties = (
    <NoteProperties
      frontMatter={frontMatterRef.current}
      onChange={changeFrontMatter}
      editable={!collab.state.readOnly}
      notes={noteLinks.index.notes}
      onOpenNote={(linked) => openLinked(linked.projectId, false)}
      onEditSource={editSource}
    />
  );
  const backlinks = (className?: string) => (
    <NoteBacklinks
      noteId={facts.id}
      onOpenNote={(_linkedNoteId, { projectId, newTab }) => onOpenNote?.(projectId, { newTab })}
      editor={editor}
      className={className}
    />
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <NoteLiveNotice noteId={note.id} />
      {saveFailure && <NoteSaveFailed failure={saveFailure} onDismiss={() => setSaveFailure(null)} />}
      <div
        ref={scrollRef}
        data-note-width={width}
        data-note-blank
        data-keep-scroll
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
                    ? "-ml-1 mb-3 size-auto rounded-xl p-1 transition-colors hover:bg-accent focus-visible:bg-accent [&_svg]:size-7"
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
            {inline && properties}
          </div>
          <div className="mb-6 mt-1 flex items-center gap-2">
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">{byline}</p>
            {daily &&
              ([["previous", ChevronLeft], ["next", ChevronRight]] as const).map(([step, Icon]) => {
                const day = daily[step];
                if (!day) return <span key={step} aria-hidden className="size-7" />;
                const label = t(($) => $.notes.vault.daily[step], { date: day.title });
                return (
                  <Button
                    key={step}
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground"
                    aria-label={label}
                    data-tooltip={label}
                    onClick={() => onOpenNote?.(day.id, { newTab: false })}
                  >
                    <Icon aria-hidden className="size-4" />
                  </Button>
                );
              })}
          </div>
          {collab.state.viewOnly && (
            <p data-note-view-only className="-mt-4 mb-6 text-xs text-muted-foreground">
              {t(($) => $.notes.live.viewOnly)}
            </p>
          )}
          <div data-note-blank className="wysiwyg-content note-body" style={noteColorStyle(facts.color)}>
            <EditorContent editor={editor} />
          </div>
          {inline && (
            <>
              <NoteReferences {...citations} className="mt-10" />
              {backlinks("mt-10")}
            </>
          )}
          {infoPanel &&
            createPortal(
              <NoteInfo editor={editor} note={note} icon={facts.icon} color={facts.color} title={title}>
                {properties}
                {backlinks()}
                <NoteReferences {...citations} />
                <NoteDeadLinksSection noteId={note.id} editable={!collab.state.readOnly} onOpenNoteAt={openHere} />
                <NoteAttachmentsSection note={note} onOpenNote={(id) => openHere(id)} />
              </NoteInfo>,
              infoPanel,
            )}
          <NoteLinkMenu editor={editor} />
          <NoteSlashMenu editor={editor} />
          <NoteTagMenu editor={editor} />
          <NoteAtMenu editor={editor} />
          <NoteFieldPopover editor={editor} />
          <NoteProofreadingPopover editor={editor} proofreading={proofreading} />
          <NoteHoverPreview containerRef={scrollRef} {...knowledge.hover} />
          <NoteLinkChoice editor={editor} />
          <NoteBlockHandle
            editor={editor}
            noteId={facts.id}
            refs={blockRefs}
            scrollRef={scrollRef}
            onOpenNote={(_linkedNoteId, { projectId, newTab }) => onOpenNote?.(projectId, { newTab })}
          />
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
            beforeAcceptAll={() => saveVersionBeforeAccept(note.id, sourceOf(editor.state.doc))}
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
    </div>
  );
}

