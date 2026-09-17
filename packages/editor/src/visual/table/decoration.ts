import type { EditorState, Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { selectionIntersects } from "../selection";
import type { ParsedTable } from "./model";
import { isRenderableTable, parseTableEnvironment, parseTabular } from "./parse";
import { type SyntaxNodeRef, type TextRange, ancestorOfType, isDirectChildOfEnvironment } from "./syntax";
import { TableRenderingErrorWidget, TabularWidget } from "./widget";

export function createTabularDecoration(nodeRef: SyntaxNodeRef, state: EditorState): Range<Decoration>[] {
  const node = nodeRef.node;
  const range: TextRange = { from: node.from, to: node.to };
  if (!state.readOnly && selectionIntersects(state.selection, range)) return [];

  const tableNode = ancestorOfType(node, "TableEnvironment");
  const environment = tableNode ? parseTableEnvironment(tableNode, range) : null;
  const directChild = tableNode ? isDirectChildOfEnvironment(node, tableNode) : false;

  let parsed: ParsedTable | null = null;
  try {
    parsed = parseTabular(node, state);
  } catch {
    parsed = null;
  }

  if (parsed && isRenderableTable(parsed)) {
    const outer = environment?.range ?? range;
    const widget = new TabularWidget(parsed, environment, directChild, state.sliceDoc(outer.from, outer.to));
    return [Decoration.replace({ widget, block: true }).range(range.from, range.to)];
  }
  const widget = new TableRenderingErrorWidget(range.from, tableNode !== null);
  return [Decoration.widget({ widget, block: true, side: -1 }).range(range.from)];
}
