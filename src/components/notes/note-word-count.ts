import { countedWordStarts } from "@oleafly/editor/prose";
import { getTextBetween, getTextSerializersFromSchema, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";

type Serializers = ReturnType<typeof getTextSerializersFromSchema>;

export interface NoteStats {
  words: number;
  characters: number;
  lines: number;
}

const READING_WORDS_PER_MINUTE = 230;

const counted = new WeakMap<ProseMirrorNode, NoteStats>();
const serializers = new WeakMap<Schema, Serializers>();

function serializersOf(schema: Schema): Serializers {
  let found = serializers.get(schema);
  if (!found) {
    found = getTextSerializersFromSchema(schema);
    serializers.set(schema, found);
  }
  return found;
}

export function noteTextWords(text: string): number {
  return countedWordStarts(text).length;
}

export function noteTextStats(text: string): NoteStats {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  return {
    words: noteTextWords(text),
    characters: lines.reduce((total, line) => total + Array.from(line).length, 0),
    lines: lines.length,
  };
}

function sumOf(parent: ProseMirrorNode, statsOf: (child: ProseMirrorNode, offset: number) => NoteStats): NoteStats {
  const total: NoteStats = { words: 0, characters: 0, lines: 0 };
  parent.forEach((child, offset) => {
    const stats = statsOf(child, offset);
    total.words += stats.words;
    total.characters += stats.characters;
    total.lines += stats.lines;
  });
  return total;
}

function blockStats(doc: ProseMirrorNode, node: ProseMirrorNode, pos: number, textSerializers: Serializers): NoteStats {
  let stats = counted.get(node);
  if (stats) return stats;
  stats =
    node.isTextblock || node.childCount === 0 || textSerializers[node.type.name]
      ? noteTextStats(getTextBetween(doc, { from: pos, to: pos + node.nodeSize }, { blockSeparator: "\n\n", textSerializers }))
      : sumOf(node, (child, offset) => blockStats(doc, child, pos + 1 + offset, textSerializers));
  counted.set(node, stats);
  return stats;
}

export function noteStats(editor: Pick<Editor, "state">): NoteStats {
  const { doc, schema } = editor.state;
  let stats = counted.get(doc);
  if (stats) return stats;
  const textSerializers = serializersOf(schema);
  stats = sumOf(doc, (child, offset) => blockStats(doc, child, offset, textSerializers));
  counted.set(doc, stats);
  return stats;
}

export function noteWordCount(editor: Pick<Editor, "state">): number {
  return noteStats(editor).words;
}

export function readingMinutes(words: number): number {
  return Math.round(words / READING_WORDS_PER_MINUTE);
}
