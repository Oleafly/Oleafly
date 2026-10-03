import { syntaxTree } from "@codemirror/language";
import { EditorState, type ChangeSpec } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { typstLanguage } from "../../../typst";
import { parsedState } from "../../test-document";
import { parseTypstTable, type TypstTable } from "./parse";

export function typstTableState(doc: string): EditorState {
  return parsedState(EditorState.create({ doc, extensions: [typstLanguage()] }));
}

export function tableCallOf(state: EditorState, occurrence = 0): SyntaxNode {
  const found: SyntaxNode[] = [];
  syntaxTree(state).iterate({
    enter(ref) {
      if (ref.name === "FuncCall" && state.sliceDoc(ref.from, ref.from + 6) === "table(") found.push(ref.node);
      return undefined;
    },
  });
  const call = found[occurrence];
  if (!call) throw new Error("no table call in the document");
  return call;
}

export function tableOf(doc: string): { state: EditorState; table: TypstTable | null } {
  const state = typstTableState(doc);
  return { state, table: parseTypstTable(state, tableCallOf(state)) };
}

export function applied(state: EditorState, changes: readonly ChangeSpec[]): string {
  return state.update({ changes: [...changes] }).state.doc.toString();
}
