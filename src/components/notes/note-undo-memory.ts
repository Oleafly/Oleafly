import { type Editor, Extension, type JSONContent } from "@tiptap/core";
import { redo, undo } from "@tiptap/pm/history";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, Plugin, PluginKey, Selection, type Transaction } from "@tiptap/pm/state";
import { Step } from "@tiptap/pm/transform";
import type { UndoEntry, UndoRecord } from "./note-undo-store";

const HISTORY_META = "history$";
const HISTORY_GROUP_MS = 500;
export const UNDO_ENTRY_LIMIT = 3000;
export const UNDO_FOLD = 500;

interface UndoMark {
  index: number;
  doc: ProseMirrorNode;
}

interface UndoMemory {
  on: boolean;
  base: JSONContent | null;
  entries: UndoEntry[];
  marks: UndoMark[];
}

const memoryKey = new PluginKey("noteUndoMemory");

function memoryOf(editor: Editor): UndoMemory {
  return (editor.storage as unknown as { noteUndoMemory: UndoMemory }).noteUndoMemory;
}

function undoEntry(tr: Transaction, before: EditorState): UndoEntry | null {
  if (tr.getMeta("appendedTransaction")) return null;
  const history = tr.getMeta(HISTORY_META) as { redo?: boolean } | undefined;
  if (!history && !tr.docChanged) return null;
  const entry: UndoEntry = { at: tr.time, selection: before.selection.toJSON(), steps: tr.steps.map((step) => step.toJSON()) };
  if (history?.redo) entry.redo = true;
  else if (history) entry.undo = true;
  else if (tr.getMeta("addToHistory") === false) entry.skip = true;
  return entry;
}

function markDue(index: number, marks: readonly UndoMark[], entry: UndoEntry, last: UndoEntry | undefined): boolean {
  const since = index - (marks.at(-1)?.index ?? 0);
  if (since < UNDO_FOLD) return false;
  if (since >= 2 * UNDO_FOLD || !last) return true;
  return Boolean(entry.undo || entry.redo || last.undo || last.redo) || entry.at - last.at > HISTORY_GROUP_MS;
}

function fold(memory: UndoMemory): void {
  const [mark, ...rest] = memory.marks;
  if (!mark) return;
  memory.base = mark.doc.toJSON();
  memory.entries = memory.entries.slice(mark.index);
  memory.marks = rest.map(({ index, doc }) => ({ index: index - mark.index, doc }));
}

function select(state: EditorState, json: unknown): EditorState {
  try {
    const tr = state.tr.setSelection(Selection.fromJSON(state.doc, json as Parameters<typeof Selection.fromJSON>[1]));
    return state.apply(tr.setMeta("addToHistory", false));
  } catch {
    return state;
  }
}

function stepped(state: EditorState, entry: UndoEntry, history: boolean): EditorState | null {
  const tr = state.tr.setTime(entry.at);
  for (const json of entry.steps) {
    if (tr.maybeStep(Step.fromJSON(state.schema, json)).failed) return null;
  }
  return state.apply(history ? tr : tr.setMeta("addToHistory", false));
}

function historyStepped(state: EditorState, entry: UndoEntry): EditorState | null {
  let next = null as EditorState | null;
  (entry.undo ? undo : redo)(state, (tr) => {
    next = state.apply(tr.setTime(entry.at));
  });
  const plain = stepped(state, entry, false);
  return next && plain && next.doc.eq(plain.doc) ? next : plain;
}

function replay(from: EditorState, record: UndoRecord): { state: EditorState; marks: UndoMark[] } | null {
  try {
    let state = EditorState.create({ doc: ProseMirrorNode.fromJSON(from.schema, record.base), plugins: from.plugins });
    const marks: UndoMark[] = [];
    for (const [index, entry] of record.entries.entries()) {
      if (markDue(index, marks, entry, record.entries[index - 1])) marks.push({ index, doc: state.doc });
      state = select(state, entry.selection);
      const next = entry.undo || entry.redo ? historyStepped(state, entry) : stepped(state, entry, !entry.skip);
      if (!next) return null;
      state = next;
    }
    return { state, marks };
  } catch {
    return null;
  }
}

export function startUndoMemory(editor: Editor): void {
  Object.assign(memoryOf(editor), { on: true, base: editor.state.doc.toJSON(), entries: [], marks: [] });
}

export function restoreUndo(editor: Editor, record: UndoRecord, same: (left: ProseMirrorNode, right: ProseMirrorNode) => boolean): boolean {
  const memory = memoryOf(editor);
  memory.on = false;
  const replayed = replay(editor.state, record);
  if (!replayed || !same(replayed.state.doc, editor.state.doc)) return false;
  const kept = select(replayed.state, editor.state.selection.toJSON());
  editor.view.updateState(kept === replayed.state ? select(kept, Selection.atStart(kept.doc).toJSON()) : kept);
  Object.assign(memory, { on: true, base: record.base, entries: [...record.entries], marks: replayed.marks });
  return true;
}

export function undoRecord(editor: Editor): UndoRecord | null {
  const memory = memoryOf(editor);
  return memory.on && memory.base ? { base: memory.base, entries: [...memory.entries], savedAt: Date.now() } : null;
}

export const NoteUndoMemory = Extension.create({
  name: "noteUndoMemory",

  addStorage(): UndoMemory {
    return { on: false, base: null, entries: [], marks: [] };
  },

  addProseMirrorPlugins() {
    const memory = this.storage as UndoMemory;
    return [
      new Plugin({
        key: memoryKey,
        state: {
          init: () => null,
          apply(tr, value, before) {
            if (!memory.on) return value;
            const entry = undoEntry(tr, before);
            if (!entry) return value;
            if (markDue(memory.entries.length, memory.marks, entry, memory.entries.at(-1))) {
              memory.marks.push({ index: memory.entries.length, doc: before.doc });
            }
            memory.entries.push(entry);
            if (memory.entries.length > UNDO_ENTRY_LIMIT) fold(memory);
            return value;
          },
        },
      }),
    ];
  },
});
