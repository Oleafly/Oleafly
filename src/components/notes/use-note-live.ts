import { visibleViews, type WorkspaceLayout } from "@oleafly/workspace";
import type { MarkdownSourceSnapshot } from "@oleafly/wysiwyg";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  claimLiveNote,
  type NoteHandBack,
  type NoteLiveEditor,
  type NoteLiveHandle,
  useCollabEditorGate,
  useCollabLiveNote,
  useCollabLiveProject,
  useCollabNoteLivePort,
} from "@/lib/collab-live-bridge";
import { logError } from "@/lib/log";
import { NOTE_FILE } from "@/lib/project-notes";
import { scrollBehavior } from "@/lib/reduced-motion";
import { useFilesStore } from "@/store/files";
import { docPosAt, sourceOffsetAt } from "./note-caret-map";
import {
  alignSharedNote,
  blockAtOffset,
  blockPosition,
  parseSharedNote,
  sharedNoteSnapshot,
  sharedNoteTransaction,
  showNoteDoc,
  type SharedNote,
} from "./note-live-doc";
import { setNotePeerCarets, setNotePeerMarks } from "./note-presence-decorations";
import { docWithPending, hasPending, showSuggestions } from "./note-suggestions";
import { useOptionalNotesData } from "./notes-data";
import { noteIdOf, openNoteViews } from "./notes-layout";
import type { NoteItem } from "./types";

export const COMPOSITION_SETTLE_MS = 50;
export const LIVE_FLUSH_MS = 1_500;
export const LIVE_HEAD_MS = 1_000;
export const LIVE_REBIND_MS: readonly number[] = [1_000, 5_000, 30_000];

export type NoteLiveMode = "local" | "connecting" | "live" | "elsewhere";

export interface LiveNoteInput {
  focused: string | null;
  open: ReadonlySet<string>;
  visible: ReadonlySet<string>;
  shared: ReadonlySet<string>;
}

export function nextLiveNote(current: string | null, input: LiveNoteInput): string | null {
  const kept = current !== null && input.open.has(current) && input.shared.has(current) ? current : null;
  const { focused } = input;
  if (focused === null || focused === kept || !input.shared.has(focused) || !input.open.has(focused)) return kept;
  return kept === null || !input.visible.has(kept) ? focused : kept;
}

export function useLiveNoteClaim(layout: WorkspaceLayout, focusedNoteId: string | null, notes: readonly NoteItem[]): void {
  const shared = useMemo(() => new Set(notes.filter((note) => note.shared).map((note) => note.id)), [notes]);
  const open = useMemo(
    () => new Set(openNoteViews(layout).flatMap((viewId) => noteIdOf(viewId) ?? [])),
    [layout],
  );
  const visible = useMemo(() => new Set(visibleViews(layout).flatMap((viewId) => noteIdOf(viewId) ?? [])), [layout]);
  const claimed = useCollabLiveNote((state) => state.noteId);
  useEffect(() => {
    claimLiveNote(nextLiveNote(claimed, { focused: focusedNoteId, open, visible, shared }));
  }, [claimed, focusedNoteId, open, shared, visible]);
  useEffect(() => () => claimLiveNote(null), []);
}

export function useNoteReadOnly(noteId: string | null): boolean {
  return useCollabEditorGate(
    (gate) => noteId !== null && gate.projectId === noteId && (gate.connecting || gate.locked),
  );
}

export function makeNoteLive(noteId: string): void {
  claimLiveNote(noteId);
}

export function useNoteLiveMode(noteId: string, shared: boolean): NoteLiveMode {
  const slot = useCollabLiveNote(
    useShallow((state) => ({
      mine: state.noteId === noteId,
      other: state.noteId !== null && state.noteId !== noteId,
      session: state.session?.projectId === noteId,
    })),
  );
  const connecting = useCollabEditorGate((gate) => gate.projectId === noteId && gate.connecting);
  if (slot.mine && slot.session) return "live";
  if (slot.mine && connecting) return "connecting";
  if (shared && slot.other) return "elsewhere";
  return "local";
}

export interface NoteBaseline {
  text: string;
  serialized: string;
}

export interface NoteLiveHost {
  sourceOf(doc: ProseMirrorNode): string;
  baseline(): NoteBaseline;
  settle(): Promise<void>;
  adopt(shared: { text: string; frontmatter: string; snapshot: MarkdownSourceSnapshot | null }): void;
  handBack(state: NoteHandBack): void;
}

export interface NoteLiveControl {
  holds(): boolean;
  localChanged(): void;
  flush(): Promise<void>;
}

export interface NoteLiveTarget {
  projectId: string;
  path: string;
}

export interface NoteLiveEditorState {
  live: boolean;
  readOnly: boolean;
  viewOnly: boolean;
}

function mainDocOf(noteId: string): string {
  return useFilesStore.getState().projects.find((project) => project.id === noteId)?.main_doc ?? NOTE_FILE;
}

export interface NoteLiveAdapter extends NoteLiveEditor {
  parse(text: string): SharedNote;
  invalidate(): void;
}

export const PARSED_NOTES_KEPT = 3;
export const LARGE_NOTE_CHARS = 100_000;

export function parsedNotesKept(length: number): number {
  return length > LARGE_NOTE_CHARS ? 2 : PARSED_NOTES_KEPT;
}

export function createNoteLiveEditor(
  editor: Editor,
  host: () => Pick<NoteLiveHost, "sourceOf" | "adopt">,
  start: string,
): NoteLiveAdapter {
  const parsed = new Map<string, SharedNote>();
  let latest: SharedNote | null = null;
  const parse = (text: string): SharedNote => {
    const known = parsed.get(text);
    if (known) return known;
    const note = parseSharedNote(editor.schema, text, latest);
    latest = note;
    parsed.set(text, note);
    const kept = parsedNotesKept(text.length);
    while (parsed.size > kept) parsed.delete(parsed.keys().next().value as string);
    return note;
  };
  parse(start);
  let batching = false;
  let batched: Transaction | null = null;
  let changed = false;
  const pending = (): Transaction | undefined => {
    if (!batching) return undefined;
    batched ??= editor.state.tr.setMeta("addToHistory", false);
    return batched;
  };
  const docNow = (): ProseMirrorNode => batched?.doc ?? editor.state.doc;
  let current: { doc: ProseMirrorNode; note: SharedNote } | null = null;
  const local = (): SharedNote => {
    const doc = docNow();
    if (current?.doc !== doc) current = { doc, note: alignSharedNote(parse(host().sourceOf(doc)), doc) };
    return current.note;
  };
  const marked = (dispatched: boolean) => {
    if (dispatched && batching) changed = true;
  };
  return {
    parse,
    invalidate: () => {
      current = null;
    },
    batch: (run) => {
      if (batching) {
        run();
        return;
      }
      batching = true;
      changed = false;
      try {
        run();
      } finally {
        batching = false;
        const tr = batched;
        batched = null;
        if (tr && changed && !editor.isDestroyed) editor.view.dispatch(tr);
      }
    },
    serialize: () => host().sourceOf(editor.state.doc),
    composing: () => editor.view.composing,
    show: (previous, next, keepLocal) => {
      const nextNote = parse(next);
      const base = keepLocal ? parse(previous) : null;
      if (batched && changed && !editor.isDestroyed) editor.view.dispatch(batched);
      batched = null;
      host().adopt({ text: next, frontmatter: nextNote.frontmatter, snapshot: sharedNoteSnapshot(nextNote) });
      current = null;
      const tr = sharedNoteTransaction(editor.state, base, nextNote);
      if (!tr) return;
      if (batching) {
        batched = tr;
        changed = true;
      } else {
        editor.view.dispatch(tr);
      }
    },
    selectionOffsets: () => {
      const note = local();
      const { doc, selection } = batched ?? editor.state;
      const head = sourceOffsetAt(note, doc, selection.head);
      return { head, anchor: selection.empty ? head : sourceOffsetAt(note, doc, selection.anchor) };
    },
    blockAt: (offset) => blockAtOffset(local().starts, offset),
    setPeerMarks: (marks) => {
      if (!editor.isDestroyed) marked(setNotePeerMarks(editor, marks, pending()));
    },
    setPeerCarets: (carets, replace) => {
      if (editor.isDestroyed) return;
      if (carets.length === 0) {
        marked(setNotePeerCarets(editor, carets, () => 0, undefined, pending()));
        return;
      }
      const into = pending();
      const note = local();
      const doc = docNow();
      marked(setNotePeerCarets(editor, carets, (offset) => docPosAt(note, doc, offset), replace, into));
    },
    revealBlock: (index) => {
      const node = editor.view.nodeDOM(blockPosition(editor.state.doc, index));
      if (node instanceof HTMLElement) node.scrollIntoView({ block: "center", behavior: scrollBehavior() });
    },
    onCaret: (listener) => {
      editor.on("selectionUpdate", listener);
      editor.on("update", listener);
      return () => {
        editor.off("selectionUpdate", listener);
        editor.off("update", listener);
      };
    },
  };
}

const inertListeners = new Set<() => void>();
let inertObserver: MutationObserver | null = null;

function watchInert(listener: () => void): () => void {
  inertListeners.add(listener);
  if (inertObserver === null && typeof MutationObserver === "function") {
    inertObserver = new MutationObserver(() => {
      for (const notify of inertListeners) notify();
    });
    inertObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["inert"], subtree: true });
  }
  return () => {
    inertListeners.delete(listener);
    if (inertListeners.size > 0) return;
    inertObserver?.disconnect();
    inertObserver = null;
  };
}

function editorInert(editor: Editor): boolean {
  if (editor.isDestroyed) return false;
  try {
    return editor.view.dom.closest("[inert]") !== null;
  } catch {
    return false;
  }
}

export function useEditorInert(editor: Editor): boolean {
  const [inert, setInert] = useState(false);
  useEffect(() => {
    const check = () => setInert(editorInert(editor));
    check();
    return watchInert(check);
  }, [editor]);
  return inert;
}

function throttled(ms: number, run: (text: string) => void) {
  let at = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: string | null = null;
  const fire = () => {
    timer = null;
    at = Date.now();
    const text = latest;
    latest = null;
    if (text !== null) run(text);
  };
  return {
    push(text: string): void {
      latest = text;
      if (timer !== null) return;
      const wait = at + ms - Date.now();
      if (wait <= 0) fire();
      else timer = setTimeout(fire, wait);
    },
    cancel(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      latest = null;
    },
  };
}

function acceptDiskChanges(editor: Editor): void {
  if (!hasPending(editor, "disk")) return;
  const target = docWithPending(editor, "disk");
  showSuggestions(editor, [], "disk");
  showNoteDoc(editor, target);
}

export function useNoteLiveEditor(
  noteId: string,
  editor: Editor,
  host: NoteLiveHost,
  target?: NoteLiveTarget | null,
): { state: NoteLiveEditorState; control: NoteLiveControl } {
  const liveId = target?.projectId ?? noteId;
  const livePath = target?.path ?? null;
  const hostRef = useRef(host);
  hostRef.current = host;
  const textChanged = useOptionalNotesData()?.noteTextChanged;
  const textChangedRef = useRef(textChanged);
  textChangedRef.current = textChanged;
  const headTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRef = useRef<NoteLiveHandle | null>(null);
  const adapterRef = useRef<NoteLiveAdapter | null>(null);
  const [live, setLive] = useState(false);
  const inert = useEditorInert(editor);
  const remoteHead = useMemo(
    () => throttled(LIVE_HEAD_MS, (text) => textChangedRef.current?.(noteId, text)),
    [noteId],
  );
  const port = useCollabNoteLivePort((state) => state.port);
  const noteSession = useCollabLiveNote((state) => (state.session?.projectId === noteId ? state.session : null));
  const projectSession = useCollabLiveProject((state) =>
    livePath !== null && state.session?.projectId === liveId ? state.session : null,
  );
  const session = livePath === null ? noteSession : projectSession;
  const gate = useCollabEditorGate(
    useShallow((state) => ({
      connecting: state.projectId === liveId && state.connecting,
      locked: state.projectId === liveId && state.locked,
    })),
  );
  const viewOnly = gate.locked;
  const readOnly = gate.connecting || viewOnly;

  const control = useMemo<NoteLiveControl>(
    () => ({
      holds: () => {
        const current = useCollabEditorGate.getState();
        return handleRef.current !== null || (current.projectId === liveId && current.connecting);
      },
      localChanged: () => {
        const handle = handleRef.current;
        if (!handle) return;
        adapterRef.current?.invalidate();
        handle.localChanged();
        if (headTimer.current !== null) clearTimeout(headTimer.current);
        headTimer.current = setTimeout(() => {
          headTimer.current = null;
          if (!editor.isDestroyed && handleRef.current) textChangedRef.current?.(noteId, hostRef.current.sourceOf(editor.state.doc));
        }, LIVE_HEAD_MS);
      },
      flush: async () => {
        await handleRef.current?.flush(LIVE_FLUSH_MS);
      },
    }),
    [editor, liveId, noteId],
  );

  useEffect(
    () => () => {
      if (headTimer.current !== null) clearTimeout(headTimer.current);
      remoteHead.cancel();
    },
    [remoteHead],
  );

  useEffect(() => {
    if (!session || !port || inert) return;
    let disposed = false;
    let handle: NoteLiveHandle | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const begin = async () => {
      await hostRef.current.settle();
      if (disposed || editor.isDestroyed) return;
      acceptDiskChanges(editor);
      const baseline = hostRef.current.baseline();
      const liveHost: Pick<NoteLiveHost, "sourceOf" | "adopt"> = {
        sourceOf: (doc) => hostRef.current.sourceOf(doc),
        adopt: (shared) => {
          hostRef.current.adopt(shared);
          remoteHead.push(shared.text);
        },
      };
      const adapter = createNoteLiveEditor(editor, () => liveHost, baseline.text);
      const bound: NoteLiveHandle = port.bind({
        noteId: liveId,
        noticeId: noteId,
        path: livePath ?? mainDocOf(noteId),
        session,
        editor: adapter,
        baseline,
        onOpen: () => {
          attempts = 0;
        },
        onEnd: (state) => {
          if (handleRef.current === bound) handleRef.current = null;
          if (adapterRef.current === adapter) adapterRef.current = null;
          handle = null;
          setLive(false);
          if (!editor.isDestroyed) hostRef.current.handBack(state);
          if (state.reason !== "dropped" || disposed || editor.isDestroyed) return;
          const delay = LIVE_REBIND_MS[Math.min(attempts, LIVE_REBIND_MS.length - 1)];
          attempts += 1;
          retry = setTimeout(() => {
            retry = null;
            if (!disposed) begin().catch((error: unknown) => void logError("live note", error));
          }, delay);
        },
      });
      handle = bound;
      handleRef.current = bound;
      adapterRef.current = adapter;
      setLive(true);
    };
    begin().catch((error: unknown) => void logError("live note", error));
    return () => {
      disposed = true;
      if (retry !== null) clearTimeout(retry);
      handle?.end();
    };
  }, [editor, inert, liveId, livePath, noteId, port, remoteHead, session]);

  useEffect(() => {
    if (!editor.isDestroyed) editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  useEffect(() => {
    if (!viewOnly) return;
    handleRef.current?.resync();
    if (hasPending(editor, "agent")) showSuggestions(editor, [], "agent");
  }, [editor, viewOnly]);

  useEffect(() => {
    const dom = editor.view.dom;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ended = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        handleRef.current?.compositionEnd();
      }, COMPOSITION_SETTLE_MS);
    };
    dom.addEventListener("compositionend", ended);
    return () => {
      dom.removeEventListener("compositionend", ended);
      if (timer !== null) clearTimeout(timer);
    };
  }, [editor]);

  return { state: { live, readOnly, viewOnly }, control };
}
