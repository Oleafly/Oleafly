import { syntaxTree } from "@codemirror/language";
import { ChangeSet, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { typstTools } from "../../../typst";
import { type ArgumentEdit, hasErrorNode, planArgumentEdit, type TextChange } from "../../../typst-arguments";
import type { TypstFormField } from "../../../typst-forms";
import { encodeTypstBool, encodeTypstNumber, encodeTypstString, sanitizeTypstContent } from "../../../typst-literals";
import { calleeName, expressionAfterHash } from "../syntax";
import {
  canClear,
  type FieldEdit,
  type FieldState,
  type FormCallModel,
  layOutBlock,
  numberProblem,
  readFormCall,
} from "./model";
import { formScopeFor } from "./state";

export type CommitResult = { readonly ok: true } | { readonly ok: false; readonly reason: "stale" | "invalid" | "refused" };

const STALE: CommitResult = { ok: false, reason: "stale" };
const INVALID: CommitResult = { ok: false, reason: "invalid" };
const REFUSED: CommitResult = { ok: false, reason: "refused" };

// The form call whose `#` sits at `anchor` in the current state, read against the current catalog.
export function formCallAt(state: EditorState, anchor: number): { model: FormCallModel; call: SyntaxNode } | null {
  const tree = syntaxTree(state);
  const hash = tree.resolveInner(anchor, 1);
  if (hash.name !== "Hash" || hash.from !== anchor) return null;
  const call = expressionAfterHash(hash);
  const callee = call?.name === "FuncCall" ? calleeName(state, call) : null;
  if (!call || !callee) return null;
  const definition = formScopeFor(state, tree)?.resolve(callee, anchor) ?? null;
  const model = definition ? readFormCall(state.doc, hash, call, definition) : null;
  return model ? { model, call } : null;
}

function encoded(field: TypstFormField, state: FieldState, edit: Extract<FieldEdit, { set: unknown }>): string | null {
  const next = edit.set;
  const kind = field.kind;
  switch (next.type) {
    case "text":
    case "choice":
      return encodeTypstString(next.value);
    case "content":
      if (state.status === "value" && state.written === "str") return encodeTypstString(next.value);
      return `[${layOutBlock(sanitizeTypstContent(next.value), state.status === "value" ? state.layout : null)}]`;
    case "number":
      if (kind.type !== "number" || numberProblem(kind, next.value)) return null;
      return encodeTypstNumber(next.value, kind.integer);
    case "toggle":
      return encodeTypstBool(next.value);
  }
}

function argumentEdit(field: TypstFormField, state: FieldState, edit: FieldEdit): ArgumentEdit | "invalid" | "refused" {
  if (state.status === "readonly") return "refused";
  if ("clear" in edit) return canClear(field, state) ? { remove: field.arg } : "refused";
  if (edit.set.type !== field.kind.type) return "invalid";
  const text = encoded(field, state, edit);
  if (text === null) return "invalid";
  if (state.status === "value") return { replace: field.arg, text };
  return { insert: field.arg, text, content: field.kind.type === "content" && "positional" in field.arg };
}

// The edited stretch of source must still parse with no error nodes.
function parsesCleanly(state: EditorState, changes: readonly TextChange[], call: SyntaxNode, hash: number): boolean {
  const parser = typstTools()?.typstParser;
  if (!parser) return false;
  const set = ChangeSet.of(changes, state.doc.length);
  const from = Math.min(hash, ...changes.map((change) => change.from));
  const to = Math.max(call.to, ...changes.map((change) => change.to));
  const text = set.apply(state.doc).sliceString(set.mapPos(from, -1), set.mapPos(to, 1));
  return !hasErrorNode(parser.parse(text).topNode);
}

// Writes one field's edit as one undoable transaction, after finding the call again.
export function commitFieldEdit(view: EditorView, anchor: number, definitionId: string, field: number, edit: FieldEdit): CommitResult {
  if (view.state.readOnly) return REFUSED;
  const found = formCallAt(view.state, anchor);
  if (!found || found.model.definition.id !== definitionId) return STALE;
  const { model, call } = found;
  const definitionField = model.definition.fields[field];
  const state = model.fields[field];
  if (!definitionField || !state) return STALE;
  const planned = argumentEdit(definitionField, state, edit);
  if (planned === "invalid") return INVALID;
  if (planned === "refused") return REFUSED;
  const plan = planArgumentEdit(view.state.doc, model.args, planned, view.state.lineBreak);
  if (!plan.ok) return plan.reason === "stale" ? STALE : REFUSED;
  if (!parsesCleanly(view.state, plan.changes, call, anchor)) return INVALID;
  view.dispatch({ changes: [...plan.changes], userEvent: "input.form" });
  return { ok: true };
}
