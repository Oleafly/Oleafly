import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { ReplaceAroundStep, ReplaceStep } from "@tiptap/pm/transform";
import { functionKeyTextOffsets, hasFunctionKeyText, withoutFunctionKeyText } from "./function-key-text";

const functionKeyTextKey = new PluginKey("functionKeyText");

function carriesFunctionKeyText(step: unknown): boolean {
  if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) return false;
  const { content } = step.slice;
  return hasFunctionKeyText(content.textBetween(0, content.size, "", ""));
}

function insertedFunctionKeyRanges(transactions: readonly Transaction[]): [number, number][] {
  let ranges: [number, number][] = [];
  for (const tr of transactions) {
    if (!tr.docChanged) continue;
    ranges = ranges.map(([from, to]) => [tr.mapping.map(from, -1), tr.mapping.map(to, 1)]);
    tr.steps.forEach((step, index) => {
      if (!carriesFunctionKeyText(step)) return;
      const after = tr.mapping.slice(index + 1);
      tr.mapping.maps[index].forEach((_oldFrom, _oldTo, from, to) => {
        ranges.push([after.map(from, -1), after.map(to, 1)]);
      });
    });
  }
  return ranges;
}

function functionKeyPositions(doc: ProseMirrorNode, ranges: readonly [number, number][]): number[] {
  const found = new Set<number>();
  for (const [from, to] of ranges) {
    doc.nodesBetween(Math.max(0, from), Math.min(doc.content.size, to), (node, pos) => {
      if (!node.isText) return true;
      for (const offset of functionKeyTextOffsets(node.text ?? "")) found.add(pos + offset);
      return false;
    });
  }
  return [...found].sort((a, b) => b - a);
}

export const FunctionKeyTextGuard = Extension.create({
  name: "functionKeyTextGuard",
  priority: 1000,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: functionKeyTextKey,
        props: {
          handleTextInput(view, from, to, text) {
            if (!hasFunctionKeyText(text)) return false;
            const kept = withoutFunctionKeyText(text);
            if (kept) view.dispatch(view.state.tr.insertText(kept, from, to));
            return true;
          },
        },
        appendTransaction(transactions, _before, state) {
          const positions = functionKeyPositions(state.doc, insertedFunctionKeyRanges(transactions));
          if (positions.length === 0) return null;
          const repair = state.tr;
          for (const pos of positions) repair.delete(pos, pos + 1);
          return repair;
        },
      }),
    ];
  },
});
