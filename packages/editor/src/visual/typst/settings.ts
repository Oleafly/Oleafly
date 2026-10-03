import type { EditorState } from "@codemirror/state";
import type { Tree } from "@lezer/common";
import { expressionAfterHash, hasErrorNode, isBlank } from "./syntax";

const SETTING_STATEMENTS = new Set(["SetRule", "ShowRule", "ModuleImport", "LetBinding"]);
const COMMENTS = new Set(["LineComment", "BlockComment"]);

export function typstSettingsEnd(state: EditorState, tree: Tree): number {
  const { doc } = state;
  let pos = 0;
  let end = 0;
  let child = tree.topNode.firstChild;
  while (child) {
    if (!isBlank(doc.sliceString(pos, child.from))) break;
    if (COMMENTS.has(child.name)) {
      pos = child.to;
      child = child.nextSibling;
      continue;
    }
    if (child.name !== "Hash") break;
    const statement = expressionAfterHash(child);
    if (!statement || !SETTING_STATEMENTS.has(statement.name) || hasErrorNode(statement)) break;
    const line = doc.lineAt(statement.to);
    if (!isBlank(doc.sliceString(statement.to, line.to))) {
      const next = statement.nextSibling;
      if (!next || !COMMENTS.has(next.name) || next.from > line.to) break;
    }
    end = line.to;
    pos = statement.to;
    child = statement.nextSibling;
  }
  return end;
}
