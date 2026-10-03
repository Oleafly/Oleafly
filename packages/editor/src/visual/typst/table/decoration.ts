import type { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type { TypstDecorationBuilder } from "../field";
import type { TextRange } from "../syntax";
import { parseTypstTable } from "./parse";
import { TypstTableWidget } from "./widget";

export function typstTableWidget(state: EditorState, call: SyntaxNode, removal: TextRange): TypstTableWidget | null {
  const table = parseTypstTable(state, call);
  if (!table) return null;
  return new TypstTableWidget(table, removal, state.sliceDoc(removal.from, removal.to));
}

export function tableDecorations(builder: TypstDecorationBuilder, hash: SyntaxNode, call: SyntaxNode): boolean {
  const range = { from: hash.from, to: call.to };
  if (!builder.shouldDecorate(range)) return false;
  const owned = builder.ownedLines(range);
  if (!owned) return false;
  const widget = typstTableWidget(builder.state, call, range);
  if (!widget) return false;
  builder.push(Decoration.replace({ widget, block: true }).range(owned.from, owned.to));
  return true;
}
