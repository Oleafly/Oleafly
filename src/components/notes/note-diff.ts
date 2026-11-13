import { markdownBlockKey } from "@oleafly/wysiwyg";
import type { Mark, Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { diffWords } from "@/lib/diff-words";
import { myersEditScript } from "@/lib/myers-diff";

export type NoteChangeDraft =
  | { kind: "text"; from: number; to: number; text: string; marks?: readonly Mark[] }
  | { kind: "blocks"; from: number; to: number; nodes: ProseMirrorNode[] };

function sameBlock(left: ProseMirrorNode, right: ProseMirrorNode): boolean {
  return left === right || markdownBlockKey(left) === markdownBlockKey(right);
}

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

export function sameShell(left: ProseMirrorNode, right: ProseMirrorNode): boolean {
  return (
    left.isTextblock &&
    left.type === right.type &&
    JSON.stringify(left.attrs) === JSON.stringify(right.attrs) &&
    flatInline(left) &&
    flatInline(right)
  );
}

interface WordChange {
  from: number;
  to: number;
  text: string;
}

const SPACE = /\s/u;

function trimmed(oldText: string, { from, to, text }: WordChange): WordChange {
  let end = text.length;
  while (from < to && end > 0 && SPACE.test(text[end - 1]) && oldText[to - 1] === text[end - 1]) {
    to -= 1;
    end -= 1;
  }
  let start = 0;
  while (from < to && start < end && SPACE.test(text[start]) && oldText[from] === text[start]) {
    from += 1;
    start += 1;
  }
  return { from, to, text: text.slice(start, end) };
}

function wordChanges(oldText: string, newText: string): WordChange[] {
  const changes: WordChange[] = [];
  let offset = 0;
  let pending: WordChange | null = null;
  for (const token of diffWords(oldText, newText)) {
    if (token.kind === "same") {
      if (pending) changes.push(trimmed(oldText, pending));
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
  if (pending) changes.push(trimmed(oldText, pending));
  return changes;
}

export function textOf(block: ProseMirrorNode): string {
  return block.textBetween(0, block.content.size, undefined, LEAF);
}

function retexted(block: ProseMirrorNode, text: string) {
  const changes = wordChanges(textOf(block), text);
  if (changes.some((change) => change.text.includes(LEAF))) return null;
  const doc = block.type.schema.topNodeType.create(null, block);
  const transform = new Transform(doc);
  const marks = changes.map((change) => doc.resolve(1 + change.from).marks());
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const change = changes[index];
    const from = 1 + change.from;
    const to = 1 + change.to;
    if (change.text) transform.replaceWith(from, to, block.type.schema.text(change.text, marks[index]));
    else transform.delete(from, to);
  }
  const node = transform.doc.firstChild;
  return node ? { node, changes, marks } : null;
}

export function retextBlock(block: ProseMirrorNode, text: string): ProseMirrorNode | null {
  return retexted(block, text)?.node ?? null;
}

function textChanges(oldBlock: ProseMirrorNode, newBlock: ProseMirrorNode, start: number): NoteChangeDraft[] | null {
  if (!sameShell(oldBlock, newBlock)) return null;
  const result = retexted(oldBlock, textOf(newBlock));
  if (!result?.node.eq(newBlock)) return null;
  const { changes, marks } = result;
  return changes.map((change, index) => ({
    kind: "text",
    from: start + 1 + change.from,
    to: start + 1 + change.to,
    text: change.text,
    marks: marks[index],
  }));
}

function nestedChanges(oldBlock: ProseMirrorNode, newBlock: ProseMirrorNode, start: number): NoteChangeDraft[] | null {
  if (oldBlock.isTextblock || oldBlock.type !== newBlock.type || oldBlock.childCount !== newBlock.childCount) return null;
  if (oldBlock.childCount === 0 || JSON.stringify(oldBlock.attrs) !== JSON.stringify(newBlock.attrs)) return null;
  const changes: NoteChangeDraft[] = [];
  let position = start + 1;
  oldBlock.forEach((child, _offset, index) => {
    const next = newBlock.child(index);
    if (!child.eq(next)) changes.push(...blockChanges(child, next, position));
    position += child.nodeSize;
  });
  return changes;
}

function blockChanges(oldBlock: ProseMirrorNode, newBlock: ProseMirrorNode, start: number): NoteChangeDraft[] {
  return (
    textChanges(oldBlock, newBlock, start) ??
    nestedChanges(oldBlock, newBlock, start) ?? [{ kind: "blocks", from: start, to: start + oldBlock.nodeSize, nodes: [newBlock] }]
  );
}

function blockStarts(blocks: readonly ProseMirrorNode[]): number[] {
  const starts: number[] = [];
  let position = 0;
  for (const block of blocks) {
    starts.push(position);
    position += block.nodeSize;
  }
  return starts;
}

function unchangedEdges(oldBlocks: readonly ProseMirrorNode[], newBlocks: readonly ProseMirrorNode[]): { head: number; oldEnd: number; newEnd: number } {
  let head = 0;
  while (head < oldBlocks.length && head < newBlocks.length && sameBlock(oldBlocks[head], newBlocks[head])) head += 1;
  let oldEnd = oldBlocks.length;
  let newEnd = newBlocks.length;
  while (oldEnd > head && newEnd > head && sameBlock(oldBlocks[oldEnd - 1], newBlocks[newEnd - 1])) {
    oldEnd -= 1;
    newEnd -= 1;
  }
  return { head, oldEnd, newEnd };
}

export function diffNoteDocs(current: ProseMirrorNode, proposed: ProseMirrorNode): NoteChangeDraft[] {
  const oldBlocks = children(current);
  const newBlocks = children(proposed);
  const starts = blockStarts(oldBlocks);
  const startOf = (index: number) => (index < oldBlocks.length ? starts[index] : current.content.size);
  const { head, oldEnd, newEnd } = unchangedEdges(oldBlocks, newBlocks);
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
        changes.push(...blockChanges(oldBlocks[oldIndex], newBlocks[added[pair]], starts[oldIndex]));
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
