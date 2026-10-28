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

// Every slot lies inside the call, whose text `CallArguments` already holds.
function sourceOf(args: CallArguments, node: TextRange): string {
  return args.text.slice(node.from - args.call.from, node.to - args.call.from);
}

// A body that opens with a line break and closes with one followed only by indentation.
function splitBlock(body: string): { open: string; indent: string; rest: string; close: string } | null {
  const last = body.lastIndexOf("\n");
  if (!body.startsWith("\n") || last === 0 || !/^[ \t]*$/u.test(body.slice(last + 1))) return null;
  const indent = /^[ \t]*/u.exec(body.slice(1, last))?.[0] ?? "";
  return { open: "\n", indent, rest: body.slice(1 + indent.length, last), close: body.slice(last) };
}

function blockBody(body: string): { text: string; layout: BlockLayout | null } {
  const parts = splitBlock(body);
  if (!parts) return { text: body, layout: null };
  const { open, indent, rest, close } = parts;
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

interface LiteralValue {
  readonly value: FieldValue;
  readonly written: "str" | "content" | "literal";
  readonly layout?: BlockLayout | null;
}

function stringValue(type: string, source: string): string | null {
  return type === "Str" ? decodeTypstString(source) : null;
}

function contentValue(type: string, source: string): LiteralValue | ReadOnlyReason {
  if (type === "ContentBlock") {
    const body = blockBody(source.slice(1, -1));
    return { value: { type: "content", value: body.text }, written: "content", layout: body.layout };
  }
  const text = stringValue(type, source);
  return text === null ? "kind" : { value: { type: "content", value: text }, written: "str" };
}

function choiceValue(kind: Extract<TypstFieldKind, { type: "choice" }>, type: string, source: string): LiteralValue | ReadOnlyReason {
  const text = stringValue(type, source);
  if (text === null) return "kind";
  return kind.options.some((option) => option.value === text) ? { value: { type: "choice", value: text }, written: "str" } : "unknownOption";
}

// What a literal argument holds for a field of this kind, or why the form can't edit it.
function literalValue(kind: TypstFieldKind, type: string, source: string): LiteralValue | ReadOnlyReason {
  switch (kind.type) {
    case "text": {
      const text = stringValue(type, source);
      return text === null ? "kind" : { value: { type: "text", value: text }, written: "str" };
    }
    case "content":
      return contentValue(type, source);
    case "choice":
      return choiceValue(kind, type, source);
    case "number": {
      const number = decodeTypstNumber(source, kind.integer);
      return number === null ? "kind" : { value: { type: "number", value: number }, written: "literal" };
    }
    case "toggle": {
      const bool = decodeTypstBool(source);
      return bool === null ? "kind" : { value: { type: "toggle", value: bool }, written: "literal" };
    }
  }
}

function literalState(field: TypstFormField, args: CallArguments, slot: { node: TextRange; type: string }): FieldState {
  const source = sourceOf(args, slot.node);
  const literal = LITERALS.has(slot.type) || (slot.type === "Unary" && decodeTypstNumber(source, false) !== null);
  const read = literal ? literalValue(field.kind, slot.type, source) : "expression";
  if (typeof read === "string") return { status: "readonly", source, node: slot.node, reason: read };
  return { status: "value", value: read.value, node: slot.node, written: read.written, layout: read.layout ?? null };
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
