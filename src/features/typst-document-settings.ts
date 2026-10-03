import type { SyntaxNode, Tree } from "@lezer/common";
import { loadTypstParser } from "@oleafly/editor/typst";

export type TypstSettingKey =
  | "paper"
  | "margin"
  | "columns"
  | "font"
  | "fontSize"
  | "lang"
  | "region"
  | "justify"
  | "leading"
  | "headingNumbering"
  | "equationNumbering";

type SettingKind = "string" | "length" | "count" | "bool" | "numbering";
type RuleTarget = "page" | "text" | "par" | "heading" | "math.equation";

interface SettingSpec {
  readonly key: TypstSettingKey;
  readonly rule: RuleTarget;
  readonly argument: string;
  readonly kind: SettingKind;
}

export const TYPST_SETTINGS: readonly SettingSpec[] = [
  { key: "paper", rule: "page", argument: "paper", kind: "string" },
  { key: "margin", rule: "page", argument: "margin", kind: "length" },
  { key: "columns", rule: "page", argument: "columns", kind: "count" },
  { key: "font", rule: "text", argument: "font", kind: "string" },
  { key: "fontSize", rule: "text", argument: "size", kind: "length" },
  { key: "lang", rule: "text", argument: "lang", kind: "string" },
  { key: "region", rule: "text", argument: "region", kind: "string" },
  { key: "justify", rule: "par", argument: "justify", kind: "bool" },
  { key: "leading", rule: "par", argument: "leading", kind: "length" },
  { key: "headingNumbering", rule: "heading", argument: "numbering", kind: "numbering" },
  { key: "equationNumbering", rule: "math.equation", argument: "numbering", kind: "numbering" },
];

const RULE_ORDER: readonly RuleTarget[] = ["page", "text", "par", "heading", "math.equation"];

export type TypstSettingState =
  | { status: "unset" }
  | { status: "set"; value: string; from: number; to: number; named: { from: number; to: number } }
  | { status: "locked"; reason: "template" | "expression"; source: string };

export type TypstSettingChanges = Partial<Record<TypstSettingKey, string | null>>;

export interface TypstDocumentSettings {
  fields: Record<TypstSettingKey, TypstSettingState>;
  templateApplied: boolean;
}

export interface TypstEdit {
  from: number;
  to: number;
  insert: string;
}

interface SetRuleInfo {
  readonly target: RuleTarget;
  readonly node: SyntaxNode;
  readonly args: SyntaxNode;
  readonly editable: boolean;
}

export async function parseTypstSource(text: string): Promise<Tree> {
  const parser = await loadTypstParser();
  return parser.parse(text);
}

function slice(text: string, node: { from: number; to: number }): string {
  return text.slice(node.from, node.to);
}

function hasError(node: SyntaxNode): boolean {
  let found = false;
  node.toTree().iterate({
    enter(child) {
      if (child.type.isError) found = true;
      return !found;
    },
  });
  return found;
}

function children(node: SyntaxNode): SyntaxNode[] {
  const list: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) list.push(child);
  return list;
}

function topLevel(tree: Tree): SyntaxNode[] {
  return children(tree.topNode);
}

function ruleTarget(text: string, node: SyntaxNode): RuleTarget | null {
  const callee = node.getChild("Set")?.nextSibling;
  if (!callee) return null;
  const name = slice(text, callee).replace(/\s+/gu, "");
  return (RULE_ORDER as readonly string[]).includes(name) ? (name as RuleTarget) : null;
}

function setRules(text: string, tree: Tree): SetRuleInfo[] {
  const rules: SetRuleInfo[] = [];
  for (const node of topLevel(tree)) {
    if (node.name !== "SetRule") continue;
    const target = ruleTarget(text, node);
    const args = node.getChild("Args");
    if (!target || !args) continue;
    const editable = !node.getChild("If") && !args.getChild("Spread") && !hasError(node);
    rules.push({ target, node, args, editable });
  }
  return rules;
}

function namedArguments(args: SyntaxNode, text: string): Map<string, SyntaxNode> {
  const named = new Map<string, SyntaxNode>();
  for (const child of children(args)) {
    if (child.name !== "Named") continue;
    const name = child.firstChild;
    if (name?.name === "Ident") named.set(slice(text, name), child);
  }
  return named;
}

function namedValue(named: SyntaxNode): SyntaxNode | null {
  const colon = named.getChild("Colon");
  return colon?.nextSibling ?? null;
}

const SIMPLE_ESCAPES: ReadonlyMap<string, string> = new Map([
  ["n", "\n"],
  ["t", "\t"],
  ["r", "\r"],
]);

function typstEscape(body: string, at: number): { text: string; next: number } {
  const character = body[at];
  if (character === "u" && body[at + 1] === "{") {
    const close = body.indexOf("}", at);
    if (close < 0) return { text: `\\${body.slice(at)}`, next: body.length };
    const code = Number.parseInt(body.slice(at + 2, close), 16);
    const valid = Number.isInteger(code) && code >= 0 && code <= 0x10ffff;
    return { text: valid ? String.fromCodePoint(code) : "", next: close + 1 };
  }
  return { text: SIMPLE_ESCAPES.get(character) ?? character ?? "", next: at + 1 };
}

function unescapeTypstString(literal: string): string {
  const body = literal.slice(1, -1);
  let out = "";
  let index = 0;
  while (index < body.length) {
    const character = body[index];
    if (character === "\\") {
      const escaped = typstEscape(body, index + 1);
      out += escaped.text;
      index = escaped.next;
    } else {
      out += character;
      index += 1;
    }
  }
  return out;
}

function editableValue(kind: SettingKind, value: SyntaxNode, text: string): string | null {
  const source = slice(text, value);
  switch (kind) {
    case "string":
      return value.name === "Str" ? unescapeTypstString(source) : null;
    case "length":
      return value.name === "Numeric" || value.name === "Auto" ? source : null;
    case "count":
      return value.name === "Int" ? source : null;
    case "bool":
      return value.name === "Bool" ? source : null;
    case "numbering":
      if (value.name === "None") return "none";
      return value.name === "Str" ? unescapeTypstString(source) : null;
  }
}

function emptyFields(): Record<TypstSettingKey, TypstSettingState> {
  return Object.fromEntries(TYPST_SETTINGS.map((spec) => [spec.key, { status: "unset" }])) as Record<
    TypstSettingKey,
    TypstSettingState
  >;
}

function appliesTemplate(node: SyntaxNode): boolean {
  return node.name === "ShowRule" && node.getChild("Show")?.nextSibling?.name === "Colon";
}

function ruleFieldState(
  spec: SettingSpec,
  rule: SetRuleInfo,
  named: ReadonlyMap<string, SyntaxNode>,
  text: string,
): TypstSettingState | null {
  const argument = named.get(spec.argument);
  const value = argument ? namedValue(argument) : null;
  if (!argument || !value) return null;
  if (!rule.editable) return { status: "locked", reason: "template", source: slice(text, value) };
  const editable = editableValue(spec.kind, value, text);
  return editable === null
    ? { status: "locked", reason: "expression", source: slice(text, value) }
    : { status: "set", value: editable, from: value.from, to: value.to, named: { from: argument.from, to: argument.to } };
}

export function readTypstDocumentSettings(text: string, tree: Tree): TypstDocumentSettings {
  const fields = emptyFields();
  for (const rule of setRules(text, tree)) {
    const named = namedArguments(rule.args, text);
    for (const spec of TYPST_SETTINGS) {
      if (spec.rule !== rule.target) continue;
      const state = ruleFieldState(spec, rule, named, text);
      if (state) fields[spec.key] = state;
    }
  }
  return { fields, templateApplied: topLevel(tree).some(appliesTemplate) };
}

const LENGTH = /^\d+(?:\.\d+)?(?:pt|mm|cm|in|em)$/u;

export function validateTypstSetting(key: TypstSettingKey, value: string): boolean {
  const trimmed = value.trim();
  switch (key) {
    case "margin":
      return trimmed === "auto" || LENGTH.test(trimmed);
    case "fontSize":
    case "leading":
      return LENGTH.test(trimmed);
    case "columns":
      return /^[1-9]\d?$/u.test(trimmed);
    case "justify":
      return trimmed === "true" || trimmed === "false";
    case "lang":
      return /^[A-Za-z]{2,3}$/u.test(trimmed);
    case "region":
      return /^[A-Za-z]{2}$/u.test(trimmed);
    default:
      return trimmed.length > 0;
  }
}

function typstString(value: string): string {
  let out = "";
  for (const character of value) {
    if (character === "\\" || character === '"') out += `\\${character}`;
    else if (character === "\n") out += String.raw`\n`;
    else if (character === "\t") out += String.raw`\t`;
    else out += character;
  }
  return `"${out}"`;
}

function serialize(spec: SettingSpec, value: string): string {
  const trimmed = value.trim();
  switch (spec.kind) {
    case "string":
      if (spec.key === "lang") return typstString(trimmed.toLowerCase());
      if (spec.key === "region") return typstString(trimmed.toUpperCase());
      return typstString(trimmed);
    case "numbering":
      return trimmed === "none" ? "none" : typstString(trimmed);
    default:
      return trimmed;
  }
}

function lineStart(text: string, pos: number): number {
  return text.lastIndexOf("\n", pos - 1) + 1;
}

function lineEnd(text: string, pos: number): number {
  const end = text.indexOf("\n", pos);
  return end < 0 ? text.length : end;
}

function appendArguments(text: string, args: SyntaxNode, additions: readonly string[]): TypstEdit {
  const close = args.lastChild;
  const closeFrom = close?.name === "RightParen" ? close.from : args.to;
  const items = children(args).filter((child) => child.name !== "LeftParen" && child.name !== "RightParen");
  const last = items.at(-1);
  if (!last) return { from: closeFrom, to: closeFrom, insert: additions.join(", ") };
  const trailingComma = last.name === "Comma";
  const multiLine = text.slice(last.to, closeFrom).includes("\n");
  if (multiLine) {
    const firstItem = items[0];
    const indentation = text.slice(lineStart(text, firstItem.from), firstItem.from);
    const lines = additions.map((addition) => `\n${indentation}${addition}`).join(",");
    return { from: last.to, to: last.to, insert: `${trailingComma ? "" : ","}${lines}${trailingComma ? "," : ""}` };
  }
  return { from: last.to, to: last.to, insert: `${trailingComma ? " " : ", "}${additions.join(", ")}` };
}

function removal(text: string, named: { from: number; to: number }): TypstEdit {
  const after = text.slice(named.to);
  const comma = /^\s*,/u.exec(after);
  if (comma) {
    let to = named.to + comma[0].length;
    const ownLine = text.slice(lineStart(text, named.from), named.from).trim() === "";
    const rest = text.slice(to, lineEnd(text, to));
    if (ownLine && rest.trim() === "") {
      return { from: lineStart(text, named.from), to: Math.min(text.length, lineEnd(text, to) + 1), insert: "" };
    }
    while (text[to] === " ") to += 1;
    return { from: named.from, to, insert: "" };
  }
  const before = text.slice(0, named.from);
  const previous = /,\s*$/u.exec(before);
  return { from: previous ? previous.index : named.from, to: named.to, insert: "" };
}

function insertionPoint(text: string, tree: Tree): number {
  let point = -1;
  for (const node of topLevel(tree)) {
    if (node.name === "ModuleImport" || appliesTemplate(node)) point = node.to;
  }
  if (point < 0) return 0;
  const end = lineEnd(text, point);
  return end < text.length ? end + 1 : end;
}

interface PlannedChanges {
  readonly edits: TypstEdit[];
  readonly additions: Map<RuleTarget, string[]>;
}

function planChange(
  text: string,
  spec: SettingSpec,
  next: string | null | undefined,
  current: TypstSettingState,
  plan: PlannedChanges,
): void {
  if (current.status === "locked") return;
  if (next === null || next === undefined || next.trim() === "") {
    if (current.status === "set") plan.edits.push(removal(text, current.named));
    return;
  }
  if (!validateTypstSetting(spec.key, next)) return;
  const serialized = serialize(spec, next);
  if (current.status === "set") {
    if (slice(text, current) !== serialized) plan.edits.push({ from: current.from, to: current.to, insert: serialized });
    return;
  }
  const list = plan.additions.get(spec.rule) ?? [];
  list.push(`${spec.argument}: ${serialized}`);
  plan.additions.set(spec.rule, list);
}

function lastEditableRule(rules: readonly SetRuleInfo[], target: RuleTarget): SetRuleInfo | undefined {
  for (let index = rules.length - 1; index >= 0; index--) {
    if (rules[index].target === target && rules[index].editable) return rules[index];
  }
  return undefined;
}

function additionEdits(text: string, tree: Tree, additions: ReadonlyMap<RuleTarget, string[]>): TypstEdit[] {
  const rules = setRules(text, tree);
  const edits: TypstEdit[] = [];
  const fresh: string[] = [];
  for (const target of RULE_ORDER) {
    const list = additions.get(target);
    if (!list) continue;
    const rule = lastEditableRule(rules, target);
    if (rule) edits.push(appendArguments(text, rule.args, list));
    else fresh.push(`#set ${target}(${list.join(", ")})\n`);
  }
  if (fresh.length > 0) {
    const at = insertionPoint(text, tree);
    const lead = at > 0 && text[at - 1] !== "\n" ? "\n" : "";
    edits.push({ from: at, to: at, insert: `${lead}${fresh.join("")}` });
  }
  return edits;
}

export function typstSettingsEdits(text: string, tree: Tree, changes: TypstSettingChanges): TypstEdit[] {
  const { fields } = readTypstDocumentSettings(text, tree);
  const plan: PlannedChanges = { edits: [], additions: new Map() };
  for (const spec of TYPST_SETTINGS) {
    if (Object.hasOwn(changes, spec.key)) planChange(text, spec, changes[spec.key], fields[spec.key], plan);
  }
  const edits = [...plan.edits, ...additionEdits(text, tree, plan.additions)];
  return edits.sort((left, right) => left.from - right.from);
}

export function applyTypstEdits(text: string, edits: readonly TypstEdit[]): string {
  let out = text;
  for (const edit of [...edits].sort((left, right) => right.from - left.from)) {
    out = `${out.slice(0, edit.from)}${edit.insert}${out.slice(edit.to)}`;
  }
  return out;
}
