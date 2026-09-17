import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { latexLanguage } from "codemirror-lang-latex";
import type { TableEdit } from "./commands";
import type { ParsedTable, TableEnvironmentInfo } from "./model";
import { parseTableEnvironment, parseTabular } from "./parse";
import { type SyntaxNode, ancestorOfType } from "./syntax";

export function stateOf(doc: string, cursor?: number): EditorState {
  return EditorState.create({
    doc,
    extensions: [latexLanguage],
    selection: cursor === undefined ? undefined : EditorSelection.cursor(cursor),
  });
}

export function tabularNodeOf(state: EditorState): SyntaxNode {
  const tree = ensureSyntaxTree(state, state.doc.length, 5000);
  if (!tree) throw new Error("The syntax tree did not finish parsing");
  let found: SyntaxNode | null = null;
  tree.iterate({
    enter(ref) {
      if (found) return false;
      if (ref.type.is("TabularEnvironment")) {
        found = ref.node;
        return false;
      }
      return undefined;
    },
  });
  if (!found) throw new Error("No tabular environment in the document");
  return found;
}

export interface Fixture {
  state: EditorState;
  parsed: ParsedTable;
  environment: TableEnvironmentInfo | null;
}

export function fixtureOf(doc: string): Fixture {
  const state = stateOf(doc);
  const node = tabularNodeOf(state);
  const parsed = parseTabular(node, state);
  const tableNode = ancestorOfType(node, "TableEnvironment");
  const environment = tableNode ? parseTableEnvironment(tableNode, parsed.tabular) : null;
  return { state, parsed, environment };
}

export function applied(state: EditorState, edit: TableEdit | null): string {
  if (!edit) throw new Error("The command produced no edit");
  return state.update({ changes: edit.changes }).state.doc.toString();
}

export function tabularSource(doc: string): string {
  const start = doc.indexOf(String.raw`\begin{tabular}`);
  const closing = String.raw`\end{tabular}`;
  const end = doc.indexOf(closing);
  return doc.slice(start, end + closing.length);
}
