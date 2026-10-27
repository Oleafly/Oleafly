import type { SyntaxNode } from "@lezer/common";
import {
  type ArgRef,
  argumentSlot,
  type CallArguments,
  readCallArguments,
  type SourceText,
  type TextRange,
} from "../../../typst-arguments";
import type { TypstFieldKind, TypstFormDefinition, TypstFormField } from "../../../typst-forms";
import { decodeTypstBool, decodeTypstNumber, decodeTypstString } from "../../../typst-literals";

export type FieldValue =
  | { readonly type: "text" | "content" | "choice"; readonly value: string }
  | { readonly type: "number"; readonly value: number }
  | { readonly type: "toggle"; readonly value: boolean };

export type ReadOnlyReason = "expression" | "kind" | "unknownOption" | "locked";

// How a multi-line `[..]` body sits in the source: the line break after `[`, the indent of
// its lines, and what precedes `]`. The field shows the body without them and writes it back
// inside them.
export interface BlockLayout {
  readonly open: string;
  readonly indent: string;
  readonly close: string;
}

export type FieldState =
  | { readonly status: "absent" }
  | {
      readonly status: "value";
      readonly value: FieldValue;
      readonly node: TextRange;
      readonly written: "str" | "content" | "literal";
      readonly layout: BlockLayout | null;
    }
  | { readonly status: "readonly"; readonly source: string; readonly node: TextRange; readonly reason: ReadOnlyReason };

export interface FormCallModel {
  readonly definition: TypstFormDefinition;
  // From the call's `#` to its end.
  readonly range: TextRange;
  readonly args: CallArguments;
  readonly fields: readonly FieldState[];
  readonly summary: string | null;
}

export type FieldEdit = { readonly set: FieldValue } | { readonly clear: true };

export type NumberProblem = "number" | "range";

const LITERALS = new Set(["Str", "Int", "Float", "Bool", "None", "Auto", "Numeric", "ContentBlock"]);

const BLOCK_LAYOUT = /^(\n)([ \t]*)([\s\S]*?)(\n[ \t]*)$/u;

// Every slot lies inside the call, whose text `CallArguments` already holds.
function sourceOf(args: CallArguments, node: TextRange): string {
  return args.text.slice(node.from - args.call.from, node.to - args.call.from);
}

function blockBody(body: string): { text: string; layout: BlockLayout | null } {
  const match = BLOCK_LAYOUT.exec(body);
  if (!match) return { text: body, layout: null };
  const [, open, indent, rest, close] = match;
  const lines = `${indent}${rest}`.split("\n");
  if (!lines.every((line) => line.startsWith(indent) || line.trim() === "")) return { text: body, layout: null };
  return { text: lines.map((line) => line.slice(indent.length)).join("\n"), layout: { open, indent, close } };
}

export function layOutBlock(text: string, layout: BlockLayout | null): string {
  if (!layout) return text;
  const lines = text.split("\n").map((line) => (line === "" ? line : `${layout.indent}${line}`));
  return `${layout.open}${lines.join("\n")}${layout.close}`;
}

// Only a set, named, optional argument can be removed from the call.
export function canClear(field: TypstFormField, state: FieldState): boolean {
  return state.status === "value" && !field.required && "named" in field.arg;
}

export function numberProblem(kind: Extract<TypstFieldKind, { type: "number" }>, value: number): NumberProblem | null {
  if (!Number.isFinite(value) || (kind.integer && !Number.isInteger(value))) return "number";
  if ((kind.min !== null && value < kind.min) || (kind.max !== null && value > kind.max)) return "range";
  return null;
}

function literalState(field: TypstFormField, args: CallArguments, slot: { node: TextRange; type: string }): FieldState {
  const source = sourceOf(args, slot.node);
  const readonly = (reason: ReadOnlyReason): FieldState => ({ status: "readonly", source, node: slot.node, reason });
  const found = (next: FieldValue, written: "str" | "content" | "literal", layout: BlockLayout | null = null): FieldState => ({
    status: "value",
    value: next,
    node: slot.node,
    written,
    layout,
  });
  const literal = LITERALS.has(slot.type) || (slot.type === "Unary" && decodeTypstNumber(source, false) !== null);
  if (!literal) return readonly("expression");
  const kind = field.kind;
  const text = slot.type === "Str" ? decodeTypstString(source) : null;
  switch (kind.type) {
    case "text":
      return text === null ? readonly("kind") : found({ type: "text", value: text }, "str");
    case "content":
      if (slot.type === "ContentBlock") {
        const body = blockBody(source.slice(1, -1));
        return found({ type: "content", value: body.text }, "content", body.layout);
      }
      return text === null ? readonly("kind") : found({ type: "content", value: text }, "str");
    case "choice":
      if (text === null) return readonly("kind");
      return kind.options.some((option) => option.value === text)
        ? found({ type: "choice", value: text }, "str")
        : readonly("unknownOption");
    case "number": {
      const number = decodeTypstNumber(source, kind.integer);
      return number === null ? readonly("kind") : found({ type: "number", value: number }, "literal");
    }
    case "toggle": {
      const bool = decodeTypstBool(source);
      return bool === null ? readonly("kind") : found({ type: "toggle", value: bool }, "literal");
    }
  }
}

function fieldState(field: TypstFormField, args: CallArguments): FieldState {
  const slot = argumentSlot(args, field.arg);
  if (args.spread) {
    return slot
      ? { status: "readonly", source: sourceOf(args, slot.node), node: slot.node, reason: "locked" }
      : { status: "readonly", source: "", node: args.list, reason: "locked" };
  }
  return slot ? literalState(field, args, slot) : { status: "absent" };
}

function sameArg(a: ArgRef, b: ArgRef): boolean {
  return "named" in a ? "named" in b && a.named === b.named : "positional" in b && a.positional === b.positional;
}

// The parser only accepts a summary that names one of the form's fields.
function summaryOf(definition: TypstFormDefinition, fields: readonly FieldState[]): string | null {
  const ref = definition.summary;
  const index = ref ? definition.fields.findIndex((field) => sameArg(field.arg, ref)) : -1;
  const state = fields[index];
  if (state?.status !== "value") return null;
  const kind = definition.fields[index].kind;
  if (state.value.type === "choice" && kind.type === "choice") {
    const chosen = state.value.value;
    return kind.options.find((option) => option.value === chosen)?.label ?? chosen;
  }
  return String(state.value.value);
}

// Definition + the call's arguments → one state per declared field. Null when the
// arguments contain a syntax error, so the call stays raw source.
export function readFormCall(
  doc: SourceText,
  hash: SyntaxNode,
  call: SyntaxNode,
  definition: TypstFormDefinition,
): FormCallModel | null {
  const args = readCallArguments(doc, call);
  if (!args) return null;
  const fields = definition.fields.map((field) => fieldState(field, args));
  return { definition, range: { from: hash.from, to: call.to }, args, fields, summary: summaryOf(definition, fields) };
}
