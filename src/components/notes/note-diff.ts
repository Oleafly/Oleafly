import { markdownBlockKey } from "@oleafly/wysiwyg";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { diffWords } from "@/lib/diff-words";
import { myersEditScript } from "@/lib/myers-diff";

export type NoteChangeDraft =
  | { kind: "text"; from: number; to: number; text: string }
  | { kind: "blocks"; from: number; to: number; nodes: ProseMirrorNode[] };

const LEAF = "￼";

function children(node: ProseMirrorNode): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = [];
  node.forEach((child) => {
    out.push(child);
  });
  return out;
}

function flatInline(block: ProseMirrorNode): boolean {
  let flat = true;
  block.forEach((child) => {
    if (!child.isText && !child.isLeaf) flat = false;
  });
  return flat;
}

function sameShell(left: ProseMirrorNode, right: ProseMirrorNode): boolean {
  return (
    left.isTextblock &&
    left.type === right.type &&
    JSON.stringify(left.attrs) === JSON.stringify(right.attrs) &&
    flatInline(left) &&
    flatInline(right)
  );
}

function wordChanges(oldText: string, newText: string): { from: number; to: number; text: string }[] {
  const changes: { from: number; to: number; text: string }[] = [];
  let offset = 0;
  let pending: { from: number; to: number; text: string } | null = null;
  for (const token of diffWords(oldText, newText)) {
    if (token.kind === "same") {
      if (pending) changes.push(pending);
      pending = null;
      offset += token.text.length;
      continue;
    }
    pending ??= { from: offset, to: offset, text: "" };
    if (token.kind === "del") {
      offset += token.text.length;
      pending.to = offset;
    } else {
      pending.text += token.text;
    }
  }
  if (pending) changes.push(pending);
  return changes;
}

function textChanges(oldBlock: ProseMirrorNode, newBlock: ProseMirrorNode, start: number): NoteChangeDraft[] | null {
  if (!sameShell(oldBlock, newBlock)) return null;
  const oldText = oldBlock.textBetween(0, oldBlock.content.size, undefined, LEAF);
  const newText = newBlock.textBetween(0, newBlock.content.size, undefined, LEAF);
  const changes = wordChanges(oldText, newText);
  if (changes.some((change) => change.text.includes(LEAF))) return null;
  const doc = oldBlock.type.schema.topNodeType.create(null, oldBlock);
  const transform = new Transform(doc);
  for (const change of [...changes].reverse()) {
    const from = 1 + change.from;
    const to = 1 + change.to;
    const marks = doc.resolve(from).marks();
    if (change.text) transform.replaceWith(from, to, oldBlock.type.schema.text(change.text, marks));
    else transform.delete(from, to);
  }
  if (!transform.doc.firstChild?.eq(newBlock)) return null;
  return changes.map((change) => ({
    kind: "text",
    from: start + 1 + change.from,
    to: start + 1 + change.to,
    text: change.text,
  }));
}

export function diffNoteDocs(current: ProseMirrorNode, proposed: ProseMirrorNode): NoteChangeDraft[] {
  const oldBlocks = children(current);
  const newBlocks = children(proposed);
  const starts: number[] = [];
  let position = 0;
  for (const block of oldBlocks) {
    starts.push(position);
    position += block.nodeSize;
  }
  const startOf = (index: number) => (index < oldBlocks.length ? starts[index] : current.content.size);
  let head = 0;
  while (head < oldBlocks.length && head < newBlocks.length && oldBlocks[head] === newBlocks[head]) head += 1;
  let oldEnd = oldBlocks.length;
  let newEnd = newBlocks.length;
  while (oldEnd > head && newEnd > head && oldBlocks[oldEnd - 1] === newBlocks[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }
  const trimmed = myersEditScript(
    oldBlocks.slice(head, oldEnd).map(markdownBlockKey),
    newBlocks.slice(head, newEnd).map(markdownBlockKey),
  );
  if (!trimmed) return [{ kind: "blocks", from: startOf(head), to: startOf(oldEnd), nodes: newBlocks.slice(head, newEnd) }];
  const script = trimmed.map((edit) => ({ ...edit, oldStart: edit.oldStart + head, newStart: edit.newStart + head }));

  const changes: NoteChangeDraft[] = [];
  let removed: number[] = [];
  let added: number[] = [];
  let oldCursor = head;
  const flush = () => {
    if (removed.length === 0 && added.length === 0) return;
    if (removed.length === added.length) {
      removed.forEach((oldIndex, pair) => {
        const oldBlock = oldBlocks[oldIndex];
        const newBlock = newBlocks[added[pair]];
        const start = starts[oldIndex];
        changes.push(
          ...(textChanges(oldBlock, newBlock, start) ?? [
            { kind: "blocks", from: start, to: start + oldBlock.nodeSize, nodes: [newBlock] } as const,
          ]),
        );
      });
    } else {
      const from = removed.length > 0 ? starts[removed[0]] : startOf(oldCursor);
      const last = removed.at(-1);
      const to = last === undefined ? from : starts[last] + oldBlocks[last].nodeSize;
      changes.push({ kind: "blocks", from, to, nodes: added.map((index) => newBlocks[index]) });
    }
    removed = [];
    added = [];
  };
  for (const edit of script) {
    if (edit.kind === "same") {
      flush();
      oldCursor = edit.oldStart + edit.length;
      continue;
    }
    for (let offset = 0; offset < edit.length; offset += 1) {
      if (edit.kind === "del") removed.push(edit.oldStart + offset);
      else added.push(edit.newStart + offset);
    }
    if (edit.kind === "del") oldCursor = edit.oldStart + edit.length;
  }
  flush();
  return changes.sort((left, right) => left.from - right.from || left.to - right.to);
}
