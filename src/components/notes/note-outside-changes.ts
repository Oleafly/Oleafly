import { markdownBlockKey, splitMarkdownFrontMatter } from "@oleafly/wysiwyg";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { describeError } from "@/lib/app-error";
import { wordsOf } from "@/lib/diff-words";
import { logError } from "@/lib/log";
import { diffNoteDocs, type NoteChangeDraft, retextBlock, sameShell, textOf } from "./note-diff";
import { applyNoteEdits, type NoteEdit } from "./note-edits";
import type { SharedNote } from "./note-live-doc";
import { joinNoteSource } from "./note-markdown";
import { mergeOrRefuse, type Overlap } from "./note-merge";
import { addPendingBatch, editsBetween, keepReview } from "./note-pending-suggestions";
import { mergeFrontMatter } from "./note-properties";
import { applyDraft, docWithPending, hasPending } from "./note-suggestions";
import { NoteConflictError } from "./types";

export interface OutsideDrafts {
  file: NoteChangeDraft[];
  held: NoteChangeDraft[];
}

function blocks(doc: ProseMirrorNode): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = [];
  doc.forEach((block) => {
    out.push(block);
  });
  return out;
}

function docOf(like: ProseMirrorNode, nodes: readonly ProseMirrorNode[] | null): ProseMirrorNode | null {
  if (!nodes) return null;
  try {
    return like.type.createChecked(like.attrs, nodes);
  } catch {
    return null;
  }
}

type Side = "ours" | "theirs";

function mergedWords(base: ProseMirrorNode, ours: ProseMirrorNode, theirs: ProseMirrorNode, side: Side): ProseMirrorNode | null {
  if (!sameShell(base, ours) || !sameShell(base, theirs)) return null;
  if (!retextBlock(base, textOf(ours))?.eq(ours) || !retextBlock(base, textOf(theirs))?.eq(theirs)) return null;
  const words = (block: ProseMirrorNode) => wordsOf(textOf(block));
  const merged = mergeOrRefuse(words(base), words(ours), words(theirs), (word) => word, side);
  return merged ? retextBlock(ours, merged.join("")) : null;
}

function overlapping(side: Side): Overlap<ProseMirrorNode> {
  return (ours, theirs, base) => {
    if (ours.length !== base.length || theirs.length !== base.length) return side === "ours" ? ours : theirs;
    return base.map((block, index) => {
      const key = markdownBlockKey(block);
      if (markdownBlockKey(ours[index]) === key) return theirs[index];
      if (markdownBlockKey(theirs[index]) === key) return ours[index];
      return mergedWords(block, ours[index], theirs[index], side) ?? (side === "ours" ? ours[index] : theirs[index]);
    });
  };
}

function onShown(shown: ProseMirrorNode, file: readonly NoteChangeDraft[], drafts: readonly NoteChangeDraft[]): NoteChangeDraft[] {
  const transform = new Transform(shown);
  for (const draft of [...file].reverse()) applyDraft(transform, draft);
  const back = transform.mapping.invert();
  return drafts.map((draft) => {
    const from = back.map(draft.from, 1);
    return { ...draft, from, to: Math.max(from, back.map(draft.to, -1)) };
  });
}

export function outsideDrafts(base: SharedNote, ours: ProseMirrorNode, shown: ProseMirrorNode, next: SharedNote): OutsideDrafts {
  const sources = { base: base.sources, theirs: next.sources };
  const merged = (side: Side) =>
    docOf(shown, mergeOrRefuse(blocks(base.doc), blocks(ours), blocks(next.doc), markdownBlockKey, overlapping(side), sources));
  const fileDoc = merged("ours");
  const theirs = merged("theirs");
  if (!fileDoc || !theirs) return { file: diffNoteDocs(shown, next.doc), held: [] };
  const file = diffNoteDocs(shown, fileDoc);
  return { file, held: onShown(shown, file, diffNoteDocs(fileDoc, theirs)) };
}

const lines = (text: string) => lf(text).split("\n");

export function lf(text: string): string {
  return text.replaceAll(/\r\n?/gu, "\n");
}

interface ReviewSources {
  body: (doc: ProseMirrorNode) => string;
  full: (doc: ProseMirrorNode) => string;
}

export function keepEditorReview(editor: Editor, noteId: string, source: ReviewSources, closing: boolean, kept: boolean): boolean {
  const file = hasPending(editor, "disk");
  const proposed = !closing && hasPending(editor, "agent");
  if (!file && !proposed && !kept) return false;
  const shown = editor.state.doc;
  keepReview(noteId, {
    file: file ? editsBetween(source.body(docWithPending(editor, "disk")), source.body(shown)) : [],
    proposed: proposed ? editsBetween(source.full(shown), source.full(docWithPending(editor, "agent"))) : [],
  });
  return file || proposed;
}

export type ClosedWrite = (text: string, version: string) => Promise<unknown>;

export interface ClosedNote {
  noteId: string;
  text: string;
  saved: string;
  shownBody: string;
  savedFrontMatter: string;
  frontMatter: string;
  separator: string;
}

function keptAfterConflict(note: ClosedNote, disk: string): { written: string; merged: boolean } {
  const merged = mergeOrRefuse(lines(note.saved), lines(note.text), lines(disk), (line) => line, "none");
  if (merged) return { written: merged.join("\n"), merged: true };
  const frontMatter = mergeFrontMatter(note.savedFrontMatter, note.frontMatter, splitMarkdownFrontMatter(disk).frontmatter);
  return { written: joinNoteSource(frontMatter.trimEnd(), note.separator, note.shownBody), merged: false };
}

export async function writeClosedNote(write: ClosedWrite, version: string, note: ClosedNote): Promise<string | null> {
  try {
    await write(note.text, version);
    return null;
  } catch (error) {
    if (!(error instanceof NoteConflictError)) {
      void logError("save the note", error);
      return describeError(error);
    }
    const { written, merged } = keptAfterConflict(note, error.disk.text);
    try {
      await write(written, error.disk.version);
      if (merged) {
        keepReview(note.noteId, { file: editsBetween(lf(splitMarkdownFrontMatter(written).body), note.shownBody), proposed: [] });
      } else {
        keepReview(note.noteId, null);
        addPendingBatch(note.noteId, editsBetween(written, error.disk.text));
      }
      return null;
    } catch (error_) {
      void logError("save the note", error_);
      return describeError(error_);
    }
  }
}

export function withBodyEdits(text: string, edits: readonly NoteEdit[]): string | null {
  if (edits.length === 0) return null;
  const { frontmatter, separator, body } = splitMarkdownFrontMatter(text);
  const applied = applyNoteEdits(lf(body), edits);
  return applied.applied === edits.length ? joinNoteSource(frontmatter, separator, applied.text) : null;
}
