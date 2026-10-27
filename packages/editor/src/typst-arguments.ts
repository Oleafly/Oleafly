import type { SyntaxNode } from "@lezer/common";

export interface TextRange {
  from: number;
  to: number;
}

export interface SourceLine {
  readonly from: number;
  readonly to: number;
}

// CodeMirror's `Text` already has this shape; `sourceText` wraps a plain string.
export interface SourceText {
  sliceString(from: number, to?: number): string;
  lineAt(pos: number): SourceLine;
  readonly length: number;
}

export function sourceText(text: string): SourceText {
  return {
    length: text.length,
    sliceString: (from, to = text.length) => text.slice(from, to),
    lineAt(pos) {
      const from = pos === 0 ? 0 : text.lastIndexOf("\n", pos - 1) + 1;
      const end = text.indexOf("\n", pos);
      let to = end === -1 ? text.length : end;
      if (to > from && text[to - 1] === "\r") to -= 1;
      return { from, to };
    },
  };
}

export type ArgRef = { readonly named: string } | { readonly positional: number };

export interface ArgumentSlot {
  readonly node: TextRange;
  readonly type: string;
  readonly trailing: boolean;
}

export interface NamedSlot {
  readonly name: string;
  readonly argument: TextRange;
  readonly value: TextRange;
  readonly type: string;
}

export interface CallArguments {
  readonly call: TextRange;
  readonly args: TextRange;
  readonly text: string;
  readonly parens: { readonly open: number; readonly close: number } | null;
  readonly positional: readonly ArgumentSlot[];
  readonly named: readonly NamedSlot[];
  readonly spread: boolean;
}

export type ArgumentEdit =
  | { readonly replace: ArgRef; readonly text: string }
  | { readonly insert: ArgRef; readonly text: string; readonly content: boolean }
  | { readonly remove: ArgRef };

export type ArgumentRefusal = "missing" | "exists" | "positionGap" | "spread" | "notRemovable" | "stale";

export interface TextChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export type ArgumentPlan =
  | { readonly ok: true; readonly changes: readonly TextChange[] }
  | { readonly ok: false; readonly reason: ArgumentRefusal };

const SKIPPED = new Set(["LeftParen", "RightParen", "Comma", "LineComment", "BlockComment"]);
const LINE_REST = /^[ \t]*(?:\/\/[^\n]*)?$/u;
const COMMA_AFTER = /^(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*,/u;

function range(node: TextRange): TextRange {
  return { from: node.from, to: node.to };
}

export function callArguments(call: SyntaxNode): SyntaxNode | null {
  return call.getChild("Args");
}

export function argumentNodes(args: SyntaxNode): SyntaxNode[] {
  const nodes: SyntaxNode[] = [];
  for (let child = args.firstChild; child; child = child.nextSibling) {
    if (["LeftParen", "RightParen", "Comma"].includes(child.name)) continue;
    nodes.push(child);
  }
  return nodes;
}

export function namedArgument(doc: SourceText, args: SyntaxNode, name: string): SyntaxNode | null {
  for (let child = args.firstChild; child; child = child.nextSibling) {
    if (child.name !== "Named") continue;
    const key = child.firstChild;
    if (key && doc.sliceString(key.from, key.to) === name) return child;
  }
  return null;
}

export function namedValue(named: SyntaxNode): SyntaxNode | null {
  const colon = named.getChild("Colon");
  const value = colon?.nextSibling ?? null;
  return value && !value.type.isError ? value : null;
}

export function positionalArguments(args: SyntaxNode): SyntaxNode[] {
  return argumentNodes(args).filter((node) => node.name !== "Named" && !node.type.isError);
}

export function insideParentheses(args: SyntaxNode): boolean {
  return args.firstChild?.name === "LeftParen";
}

export function closingParenthesis(args: SyntaxNode): SyntaxNode | null {
  for (let child = args.firstChild; child; child = child.nextSibling) {
    if (child.name === "RightParen") return child;
  }
  return null;
}

export function trailingContentBlocks(args: SyntaxNode): SyntaxNode[] {
  const close = closingParenthesis(args);
  const blocks: SyntaxNode[] = [];
  for (let child = close ? close.nextSibling : args.firstChild; child; child = child.nextSibling) {
    if (child.name === "ContentBlock") blocks.push(child);
  }
  return close || !insideParentheses(args) ? blocks : [];
}

export function contentBody(block: SyntaxNode): TextRange | null {
  const open = block.firstChild;
  const close = block.lastChild;
  if (open?.name !== "LeftBracket" || close?.name !== "RightBracket" || close.from < open.to) return null;
  return { from: open.to, to: close.from };
}

export function hasErrorNode(node: SyntaxNode): boolean {
  let found = false;
  node.toTree().iterate({
    enter(ref) {
      if (ref.type.isError) found = true;
      return !found;
    },
  });
  return found;
}

export function readCallArguments(doc: SourceText, call: SyntaxNode): CallArguments | null {
  const args = callArguments(call);
  if (!args || hasErrorNode(args)) return null;
  const close = insideParentheses(args) ? closingParenthesis(args) : null;
  if (insideParentheses(args) && !close) return null;
  const positional: ArgumentSlot[] = [];
  const named: NamedSlot[] = [];
  let spread = false;
  for (let child = args.firstChild; child; child = child.nextSibling) {
    if (SKIPPED.has(child.name)) continue;
    if (child.name === "Spread") {
      spread = true;
    } else if (child.name === "Named") {
      const key = child.firstChild;
      const value = namedValue(child);
      if (!key || !value) return null;
      named.push({ name: doc.sliceString(key.from, key.to), argument: range(child), value: range(value), type: value.name });
    } else {
      positional.push({ node: range(child), type: child.name, trailing: !close || child.from >= close.to });
    }
  }
  return {
    call: range(call),
    args: range(args),
    text: doc.sliceString(call.from, call.to),
    parens: close ? { open: args.from, close: close.from } : null,
    positional,
    named,
    spread,
  };
}

export function lineStartIndent(doc: SourceText, pos: number): string | null {
  const line = doc.lineAt(pos);
  const before = doc.sliceString(line.from, pos);
  return /^[ \t]*$/u.test(before) ? before : null;
}

function afterSeparator(doc: SourceText, pos: number): { comma: boolean; end: number } {
  let end = pos;
  const text = doc.sliceString(pos, Math.min(doc.length, pos + 256));
  const match = /^[ \t]*(,)?[ \t]*/u.exec(text);
  if (match) end += match[0].length;
  return { comma: Boolean(match?.[1]), end };
}

function commaBefore(doc: SourceText, pos: number): number | null {
  const text = doc.sliceString(Math.max(0, pos - 256), pos);
  const match = /,\s*$/u.exec(text);
  return match ? pos - match[0].length : null;
}

function lineBreakLength(doc: SourceText, pos: number): number {
  return doc.sliceString(pos, Math.min(doc.length, pos + 2)) === "\r\n" ? 2 : 1;
}

export function deleteArgumentSpan(doc: SourceText, span: TextRange): TextChange {
  const indent = lineStartIndent(doc, span.from);
  const after = afterSeparator(doc, span.to);
  const endLine = doc.lineAt(span.to);
  if (indent !== null && after.end >= endLine.to && endLine.to < doc.length) {
    return { from: doc.lineAt(span.from).from, to: endLine.to + lineBreakLength(doc, endLine.to), insert: "" };
  }
  if (after.comma) {
    const next = doc.sliceString(after.end, after.end + 1);
    if (next !== ")" && next !== "") return { from: span.from, to: after.end, insert: "" };
  }
  const comma = commaBefore(doc, span.from);
  if (comma !== null) return { from: comma, to: span.to, insert: "" };
  return { from: span.from, to: after.comma ? after.end : span.to, insert: "" };
}

function refuse(reason: ArgumentRefusal): ArgumentPlan {
  return { ok: false, reason };
}

function planned(...changes: TextChange[]): ArgumentPlan {
  return { ok: true, changes };
}

function insertion(from: number, insert: string): TextChange {
  return { from, to: from, insert };
}

function namedSlot(args: CallArguments, name: string): NamedSlot | null {
  return args.named.find((slot) => slot.name === name) ?? null;
}

function parenthesised(args: CallArguments): TextRange[] {
  const items = [...args.named.map((slot) => slot.argument)];
  for (const slot of args.positional) if (!slot.trailing) items.push(slot.node);
  return items.sort((a, b) => a.from - b.from);
}

function lineIndent(doc: SourceText, pos: number): string {
  const line = doc.lineAt(pos);
  return /^[ \t]*/u.exec(doc.sliceString(line.from, pos))?.[0] ?? "";
}

// Adds arguments to the parenthesised list, after `anchor` (or first when it is null),
// following the call's layout: one line, or one argument per line with the existing indent.
// It never plans two insertions at one position, so any applier gets the same text.
function insertParenthesised(
  doc: SourceText,
  args: CallArguments,
  anchor: TextRange | null,
  texts: readonly string[],
  lineBreak: string,
): TextChange[] {
  const parens = args.parens;
  if (!parens) return [insertion(args.args.from, `(${texts.join(", ")})`)];
  const items = parenthesised(args);
  if (items.length === 0) {
    const inner = doc.sliceString(parens.open + 1, parens.close);
    const to = /^\s*$/u.test(inner) ? parens.close : parens.open + 1;
    return [{ from: parens.open + 1, to, insert: texts.join(", ") }];
  }
  const first = items[0];
  const multiline = doc.sliceString(parens.open + 1, first.from).includes("\n");
  const indent = lineIndent(doc, first.from);
  const newLine = `${lineBreak}${indent}${texts.join(`,${lineBreak}${indent}`)}`;
  const joined = texts.join(", ");
  if (!anchor) return [multiline ? insertion(parens.open + 1, `${newLine},`) : insertion(first.from, `${joined}, `)];
  const last = anchor.to >= (items.at(-1) as TextRange).to;
  const comma = COMMA_AFTER.exec(doc.sliceString(anchor.to, parens.close));
  const after = comma ? anchor.to + comma[0].length : anchor.to;
  if (!multiline) return [comma ? insertion(after, last ? ` ${joined}` : ` ${joined},`) : insertion(anchor.to, `, ${joined}`)];
  const line = doc.lineAt(after);
  const closeOnLine = parens.close <= line.to;
  const ownLine = LINE_REST.test(doc.sliceString(after, closeOnLine ? parens.close : line.to));
  if (comma) return [ownLine ? insertion(closeOnLine ? after : line.to, `${newLine},`) : insertion(after, ` ${joined},`)];
  if (closeOnLine || !ownLine || line.to === anchor.to) return [insertion(anchor.to, `,${newLine}`)];
  return [insertion(anchor.to, ","), insertion(line.to, newLine)];
}

// A new named argument joins the named ones that come before the positional arguments,
// or goes first when a positional argument leads; without positionals it goes last.
function namedAnchor(args: CallArguments): TextRange | null {
  const firstPositional = args.positional.find((slot) => !slot.trailing)?.node ?? null;
  if (!firstPositional) return parenthesised(args).at(-1) ?? null;
  const lastNamed = args.named.at(-1)?.argument ?? null;
  return lastNamed && lastNamed.to < firstPositional.from ? lastNamed : null;
}

function refusalFor(doc: SourceText, args: CallArguments): ArgumentRefusal | null {
  if (args.call.to > doc.length || doc.sliceString(args.call.from, args.call.to) !== args.text) return "stale";
  return args.spread ? "spread" : null;
}

// Adds several named arguments in one change, in the given order.
export function planNamedInsertions(
  doc: SourceText,
  args: CallArguments,
  entries: readonly { readonly name: string; readonly text: string }[],
  lineBreak: string,
): ArgumentPlan {
  const refusal = refusalFor(doc, args);
  if (refusal) return refuse(refusal);
  if (entries.some((entry) => namedSlot(args, entry.name))) return refuse("exists");
  const texts = entries.map((entry) => `${entry.name}: ${entry.text}`);
  return planned(...insertParenthesised(doc, args, namedAnchor(args), texts, lineBreak));
}

function insertArgument(
  doc: SourceText,
  args: CallArguments,
  edit: Extract<ArgumentEdit, { insert: ArgRef }>,
  lineBreak: string,
): ArgumentPlan {
  const target = edit.insert;
  if ("named" in target) return planNamedInsertions(doc, args, [{ name: target.named, text: edit.text }], lineBreak);
  const count = args.positional.length;
  if (target.positional < count) return refuse("exists");
  if (target.positional > count) return refuse("positionGap");
  if (edit.content) return planned(insertion(args.args.to, edit.text));
  if (args.positional.some((slot) => slot.trailing)) return refuse("positionGap");
  const anchor = args.positional.at(-1)?.node ?? null;
  return planned(...insertParenthesised(doc, args, anchor, [edit.text], lineBreak));
}

export function planArgumentEdit(
  doc: SourceText,
  args: CallArguments,
  edit: ArgumentEdit,
  lineBreak: string,
): ArgumentPlan {
  const refusal = refusalFor(doc, args);
  if (refusal) return refuse(refusal);
  if ("insert" in edit) return insertArgument(doc, args, edit, lineBreak);
  const target = "replace" in edit ? edit.replace : edit.remove;
  let span: TextRange;
  if ("named" in target) {
    const slot = namedSlot(args, target.named);
    if (!slot) return refuse("missing");
    span = "replace" in edit ? slot.value : slot.argument;
  } else {
    const slot = args.positional[target.positional];
    if ("remove" in edit) return refuse("notRemovable");
    if (!slot) return refuse("missing");
    span = slot.node;
  }
  if ("replace" in edit) return planned({ from: span.from, to: span.to, insert: edit.text });
  return planned(deleteArgumentSpan(doc, span));
}
