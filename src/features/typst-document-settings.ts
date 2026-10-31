import type { SyntaxNode, Tree } from "@lezer/common";
import { loadTypstParser, typstTools } from "@oleafly/editor/typst";
import {
  type ArgumentPlan,
  hasErrorNode,
  type CallArguments,
  type NamedSlot,
  planArgumentEdit,
  planNamedInsertions,
  readCallArguments,
  sourceText,
  type TextRange,
} from "@oleafly/editor/typst-arguments";
import { decodeTypstString, encodeTypstString } from "@oleafly/editor/typst-literals";
import { composeSettingSteps, type SettingsStep } from "./document-settings";

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
  readonly arguments: CallArguments | null;
  readonly editable: boolean;
}

export async function parseTypstSource(text: string): Promise<Tree> {
  const parser = await loadTypstParser();
  return parser.parse(text);
}

function slice(text: string, node: { from: number; to: number }): string {
  return text.slice(node.from, node.to);
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
    if (!target || !node.getChild("Args")) continue;
    const args = readCallArguments(sourceText(text), node);
    const editable = !node.getChild("If") && args !== null && !args.spread && !hasErrorNode(node);
    rules.push({ target, arguments: args, editable });
  }
  return rules;
}

function editableValue(kind: SettingKind, slot: NamedSlot, text: string): string | null {
  const source = slice(text, slot.value);
  switch (kind) {
    case "string":
      return slot.type === "Str" ? decodeTypstString(source) : null;
    case "length":
      return slot.type === "Numeric" || slot.type === "Auto" ? source : null;
    case "count":
      return slot.type === "Int" ? source : null;
    case "bool":
      return slot.type === "Bool" ? source : null;
    case "numbering":
      if (slot.type === "None") return "none";
      return slot.type === "Str" ? decodeTypstString(source) : null;
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

function ruleFieldState(spec: SettingSpec, rule: SetRuleInfo, text: string): TypstSettingState | null {
  const slot = rule.arguments?.named.find((named) => named.name === spec.argument);
  if (!slot) return null;
  const source = slice(text, slot.value);
  if (!rule.editable) return { status: "locked", reason: "template", source };
  const editable = editableValue(spec.kind, slot, text);
  return editable === null
    ? { status: "locked", reason: "expression", source }
    : { status: "set", value: editable, from: slot.value.from, to: slot.value.to, named: slot.argument };
}

export function readTypstDocumentSettings(text: string, tree: Tree): TypstDocumentSettings {
  const fields = emptyFields();
  for (const rule of setRules(text, tree)) {
    for (const spec of TYPST_SETTINGS) {
      if (spec.rule !== rule.target) continue;
      const state = ruleFieldState(spec, rule, text);
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

function serialize(spec: SettingSpec, value: string): string {
  const trimmed = value.trim();
  switch (spec.kind) {
    case "string":
      if (spec.key === "lang") return encodeTypstString(trimmed.toLowerCase());
      if (spec.key === "region") return encodeTypstString(trimmed.toUpperCase());
      return encodeTypstString(trimmed);
    case "numbering":
      return trimmed === "none" ? "none" : encodeTypstString(trimmed);
    default:
      return trimmed;
  }
}

function lineEnd(text: string, pos: number): number {
  const end = text.indexOf("\n", pos);
  return end < 0 ? text.length : end;
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

interface Addition {
  readonly name: string;
  readonly text: string;
}

function namedText(addition: Addition): string {
  return `${addition.name}: ${addition.text}`;
}

interface RulePlan {
  readonly index: number;
  readonly target: RuleTarget;
  readonly replacements: Addition[];
  readonly removals: string[];
  readonly additions: Addition[];
}

interface SettingsPlan {
  readonly rules: Map<number, RulePlan>;
  readonly fresh: Map<RuleTarget, Addition[]>;
}

function rulePlan(plan: SettingsPlan, rules: readonly SetRuleInfo[], index: number): RulePlan | null {
  const rule = rules[index];
  if (!rule) return null;
  const known = plan.rules.get(index);
  if (known) return known;
  const created: RulePlan = { index, target: rule.target, replacements: [], removals: [], additions: [] };
  plan.rules.set(index, created);
  return created;
}

function ruleHolding(rules: readonly SetRuleInfo[], range: TextRange): number {
  return rules.findIndex(({ arguments: args }) => args !== null && args.call.from <= range.from && range.to <= args.call.to);
}

function lastEditableRule(rules: readonly SetRuleInfo[], target: RuleTarget): number {
  for (let index = rules.length - 1; index >= 0; index--) {
    if (rules[index].target === target && rules[index].editable) return index;
  }
  return -1;
}

function addFresh(fresh: Map<RuleTarget, Addition[]>, target: RuleTarget, additions: readonly Addition[]): void {
  fresh.set(target, [...(fresh.get(target) ?? []), ...additions]);
}

function planChange(
  text: string,
  rules: readonly SetRuleInfo[],
  spec: SettingSpec,
  next: string | null | undefined,
  current: TypstSettingState,
  plan: SettingsPlan,
): void {
  if (current.status === "locked") return;
  if (next === null || next === undefined || next.trim() === "") {
    if (current.status === "set") rulePlan(plan, rules, ruleHolding(rules, current.named))?.removals.push(spec.argument);
    return;
  }
  if (!validateTypstSetting(spec.key, next)) return;
  const addition = { name: spec.argument, text: serialize(spec, next) };
  if (current.status === "set") {
    if (slice(text, current) !== addition.text) rulePlan(plan, rules, ruleHolding(rules, current.named))?.replacements.push(addition);
    return;
  }
  const rule = rulePlan(plan, rules, lastEditableRule(rules, spec.rule));
  if (rule) rule.additions.push(addition);
  else addFresh(plan.fresh, spec.rule, [addition]);
}

function treeReader(text: string, tree: Tree): (current: string) => Tree {
  let last = { text, tree };
  return (current) => {
    if (current !== last.text) {
      const parser = typstTools()?.typstParser;
      if (!parser) throw new Error("The Typst parser is not loaded");
      last = { text: current, tree: parser.parse(current) };
    }
    return last.tree;
  };
}

function changesOf(plan: ArgumentPlan | null): TypstEdit[] {
  return plan?.ok ? [...plan.changes] : [];
}

function ruleSteps(plan: RulePlan, treeOf: (current: string) => Tree, fresh: Map<RuleTarget, Addition[]>): SettingsStep[] {
  const read = (current: string): CallArguments | null => {
    const rule = setRules(current, treeOf(current))[plan.index];
    return rule?.target === plan.target && rule.editable ? rule.arguments : null;
  };
  const steps: SettingsStep[] = plan.removals.map((name) => (current) => {
    const args = read(current);
    return changesOf(args && planArgumentEdit(sourceText(current), args, { remove: { named: name } }, "\n"));
  });
  if (plan.replacements.length > 0) {
    steps.push((current) => {
      const args = read(current);
      if (!args) return [];
      const doc = sourceText(current);
      return plan.replacements.flatMap(({ name, text }) => changesOf(planArgumentEdit(doc, args, { replace: { named: name }, text }, "\n")));
    });
  }
  if (plan.additions.length > 0) {
    steps.push((current) => {
      const args = read(current);
      const added = args ? planNamedInsertions(sourceText(current), args, plan.additions, "\n") : null;
      if (added?.ok) return [...added.changes];
      addFresh(fresh, plan.target, plan.additions);
      return [];
    });
  }
  return steps;
}

function freshRulesStep(fresh: ReadonlyMap<RuleTarget, Addition[]>, treeOf: (current: string) => Tree): SettingsStep {
  return (current) => {
    const lines = RULE_ORDER.flatMap((target) => {
      const list = fresh.get(target);
      return list ? [`#set ${target}(${list.map(namedText).join(", ")})\n`] : [];
    });
    if (lines.length === 0) return [];
    const at = insertionPoint(current, treeOf(current));
    const lead = at > 0 && current[at - 1] !== "\n" ? "\n" : "";
    return [{ from: at, to: at, insert: `${lead}${lines.join("")}` }];
  };
}

export function typstSettingsEdits(text: string, tree: Tree, changes: TypstSettingChanges): TypstEdit[] {
  const { fields } = readTypstDocumentSettings(text, tree);
  const rules = setRules(text, tree);
  const plan: SettingsPlan = { rules: new Map(), fresh: new Map() };
  for (const spec of TYPST_SETTINGS) {
    if (Object.hasOwn(changes, spec.key)) planChange(text, rules, spec, changes[spec.key], fields[spec.key], plan);
  }
  const treeOf = treeReader(text, tree);
  const steps = [...plan.rules.values()]
    .sort((left, right) => left.index - right.index)
    .flatMap((rule) => ruleSteps(rule, treeOf, plan.fresh));
  return composeSettingSteps(text, [...steps, freshRulesStep(plan.fresh, treeOf)]);
}

export function applyTypstEdits(text: string, edits: readonly TypstEdit[]): string {
  let out = text;
  for (const edit of [...edits].sort((left, right) => right.from - left.from)) {
    out = `${out.slice(0, edit.from)}${edit.insert}${out.slice(edit.to)}`;
  }
  return out;
}
