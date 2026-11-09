import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { blockAtOffset, blockIndexAt, blockPosition, type SharedNote } from "./note-live-doc";

export const MATCH_WINDOW = 400;

export interface CharMap {
  readonly pm: readonly number[];
  readonly src: readonly number[];
}

const maps = new WeakMap<ProseMirrorNode, { start: number; source: string; from: number; map: CharMap }>();

function inlineSource(node: ProseMirrorNode): string | null {
  const source: unknown = node.attrs.source;
  return node.isAtom && typeof source === "string" && source !== "" ? source : null;
}

export function blockCharMap(block: ProseMirrorNode, start: number, source: string, from = 0): CharMap {
  const known = maps.get(block);
  if (known && known.start === start && known.source === source && known.from === from) return known.map;
  const pm: number[] = [];
  const src: number[] = [];
  let cursor = from;
  const find = (needle: string): number => {
    const found = source.indexOf(needle, cursor);
    return found >= 0 && found - cursor <= MATCH_WINDOW ? found : -1;
  };
  block.descendants((node, offset) => {
    if (node.isText) {
      const text = node.textContent;
      for (let index = 0; index < text.length; index += 1) {
        const found = find(text[index]);
        if (found < 0) continue;
        pm.push(start + 1 + offset + index);
        src.push(found);
        cursor = found + 1;
      }
      return false;
    }
    const inline = inlineSource(node);
    if (inline !== null) {
      const found = find(inline);
      if (found >= 0) cursor = found + inline.length;
      return false;
    }
    return true;
  });
  const map = { pm, src };
  maps.set(block, { start, source, from, map });
  return map;
}

function countBelow(values: readonly number[], limit: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] < limit) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function unitSource(key: string): { node: number; source: string } {
  const colon = key.indexOf(":");
  const node = Number(key.slice(0, colon));
  return colon > 0 && Number.isInteger(node) ? { node, source: key.slice(colon + 1) } : { node: 0, source: key };
}

interface Block {
  at: number;
  start: number;
  source: string;
  map: CharMap;
}

function mapBlock(note: SharedNote, doc: ProseMirrorNode, at: number): Block {
  const start = blockPosition(doc, at);
  const { node, source } = unitSource(note.sources[at] ?? "");
  const previous = node > 0 && at > 0 ? mapBlock(note, doc, at - 1).map.src.at(-1) : undefined;
  const from = previous === undefined ? 0 : previous + 1;
  return { at, start, source, map: blockCharMap(doc.child(at), start, source, from) };
}

function blockOf(note: SharedNote, doc: ProseMirrorNode, index: number): Block | null {
  const last = Math.min(doc.childCount, note.starts.length) - 1;
  if (last < 0) return null;
  return mapBlock(note, doc, Math.max(0, Math.min(index, last)));
}

export function sourceOffsetAt(note: SharedNote, doc: ProseMirrorNode, pos: number): number {
  const block = blockOf(note, doc, blockIndexAt(doc, pos));
  if (!block) return 0;
  const { at, source, map } = block;
  const before = countBelow(map.pm, pos);
  const relative = before === 0 ? (map.src[0] ?? 0) : map.src[before - 1] + 1;
  return note.starts[at] + Math.min(relative, source.length);
}

export function docPosAt(note: SharedNote, doc: ProseMirrorNode, offset: number): number {
  const block = blockOf(note, doc, blockAtOffset(note.starts, offset));
  if (!block) return 0;
  const { at, start, map } = block;
  const before = countBelow(map.src, offset - note.starts[at]);
  const pos = before === 0 ? (map.pm[0] ?? start + 1) : map.pm[before - 1] + 1;
  return Math.max(0, Math.min(pos, doc.content.size));
}
