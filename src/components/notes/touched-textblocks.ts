import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface TouchedTextblock {
  node: ProseMirrorNode;
  pos: number;
}

interface PositionedStep {
  from?: unknown;
  to?: unknown;
  pos?: unknown;
}

function changedRanges(tr: Transaction): [number, number][] | null {
  const ranges: [number, number][] = [];
  for (let index = 0; index < tr.steps.length; index += 1) {
    const step = tr.steps[index] as unknown as PositionedStep;
    const map = tr.mapping.maps[index];
    const own: [number, number][] = [];
    map.forEach((_oldStart, _oldEnd, from, to) => {
      own.push([from, to]);
    });
    if (typeof step.from === "number" && typeof step.to === "number") own.push([map.map(step.from, -1), map.map(step.to, 1)]);
    else if (typeof step.pos === "number") own.push([map.map(step.pos, -1), map.map(step.pos, 1) + 1]);
    else if (own.length === 0) return null;
    const rest = tr.mapping.slice(index + 1);
    for (const [from, to] of own) ranges.push([rest.map(from, -1), rest.map(to, 1)]);
  }
  return ranges;
}

export function touchedTextblocks(tr: Transaction): TouchedTextblock[] | null {
  const ranges = changedRanges(tr);
  if (!ranges) return null;
  const { doc } = tr;
  const size = doc.content.size;
  const seen = new Set<number>();
  const found: TouchedTextblock[] = [];
  for (const [from, to] of ranges) {
    const start = Math.max(0, Math.min(from, to) - 1);
    const end = Math.min(size, Math.max(from, to) + 1);
    doc.nodesBetween(start, end, (node, pos) => {
      if (!node.isTextblock) return true;
      if (!seen.has(pos)) {
        seen.add(pos);
        found.push({ node, pos });
      }
      return false;
    });
  }
  return found;
}

export function redecorateTextblocks(
  previous: DecorationSet,
  tr: Transaction,
  decorate: (block: ProseMirrorNode, pos: number) => Decoration[],
): DecorationSet | null {
  const blocks = touchedTextblocks(tr);
  if (!blocks) return null;
  let next = previous.map(tr.mapping, tr.doc);
  const stale: Decoration[] = [];
  const fresh: Decoration[] = [];
  for (const { node, pos } of blocks) {
    const end = pos + node.nodeSize;
    for (const decoration of next.find(pos, end)) {
      if (decoration.from < end && decoration.to > pos) stale.push(decoration);
    }
    fresh.push(...decorate(node, pos));
  }
  if (stale.length > 0) next = next.remove(stale);
  return fresh.length > 0 ? next.add(tr.doc, fresh) : next;
}
