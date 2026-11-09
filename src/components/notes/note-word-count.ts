import { countedWordStarts } from "@oleafly/editor/prose";
import { getTextBetween, getTextSerializersFromSchema, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";

type Serializers = ReturnType<typeof getTextSerializersFromSchema>;

const counts = new WeakMap<ProseMirrorNode, number>();
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

export function noteWordCount(editor: Pick<Editor, "state">): number {
  const { doc, schema } = editor.state;
  const textSerializers = serializersOf(schema);
  let total = 0;
  doc.forEach((child, offset) => {
    let count = counts.get(child);
    if (count === undefined) {
      count = noteTextWords(getTextBetween(doc, { from: offset, to: offset + child.nodeSize }, { blockSeparator: "\n\n", textSerializers }));
      counts.set(child, count);
    }
    total += count;
  });
  return total;
}
