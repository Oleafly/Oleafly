import {
  LRLanguage,
  LanguageSupport,
  foldNodeProp,
  syntaxTree,
} from "@codemirror/language";
import type { EditorState, Line } from "@codemirror/state";
import {
  NodeProp,
  type NodeType,
  type SyntaxNode,
  type SyntaxNodeRef,
} from "@lezer/common";
import { styleTags, type Tag, tags as t } from "@lezer/highlight";
import { latexColorToCss } from "@oleafly/latex";
import { latexLanguage as packagedLatexLanguage } from "codemirror-lang-latex";
import { latexIgnoredRangesField } from "./latex-lexical";

export type { SyntaxNode, SyntaxNodeRef, Tree } from "@lezer/common";

const grammar = packagedLatexLanguage.parser;

const nodeNames = [...new Set(grammar.nodeSet.types.map((type) => type.name))];

const SECTIONING_CTRL_SEQS = new Set([
  "BookCtrlSeq",
  "PartCtrlSeq",
  "ChapterCtrlSeq",
  "SectionCtrlSeq",
  "SubSectionCtrlSeq",
  "SubSubSectionCtrlSeq",
  "ParagraphCtrlSeq",
  "SubParagraphCtrlSeq",
]);

const TOGGLE_FORMATTING_COMMANDS = new Set(["TextBoldCommand", "TextItalicCommand"]);

const OTHER_FORMATTING_COMMANDS = new Set([
  "TextSmallCapsCommand",
  "TextTeletypeCommand",
  "TextMediumCommand",
  "TextSansSerifCommand",
  "TextSuperscriptCommand",
  "TextSubscriptCommand",
  "StrikeOutCommand",
  "EmphasisCommand",
  "UnderlineCommand",
]);

const KEYWORD_CTRL_SEQS = new Set([
  "DocumentClassCtrlSeq",
  "UsePackageCtrlSeq",
  "CiteCtrlSeq",
  "CiteStarrableCtrlSeq",
  "RefCtrlSeq",
  "RefStarrableCtrlSeq",
  "LabelCtrlSeq",
]);

function derivedGroups(name: string): string[] {
  if (name.endsWith("CtrlSeq") || name.endsWith("CtrlSym")) {
    const groups = ["$CtrlSeq"];
    if (name.endsWith("CtrlSym")) groups.push("$CtrlSym");
    if (SECTIONING_CTRL_SEQS.has(name)) groups.push("$SectioningCtrlSeq");
    return groups;
  }
  if (name.endsWith("EnvName")) return ["$EnvName"];
  if (name.endsWith("Command")) {
    const groups = ["$Command"];
    if (TOGGLE_FORMATTING_COMMANDS.has(name)) groups.push("$ToggleTextFormattingCommand");
    if (OTHER_FORMATTING_COMMANDS.has(name)) groups.push("$OtherTextFormattingCommand");
    return groups;
  }
  if (name.endsWith("Argument")) {
    const groups = ["$Argument"];
    if (name.endsWith("TextArgument") || name === "SectioningArgument") groups.push("$TextArgument");
    return groups;
  }
  if (name.endsWith("Brace")) return ["$Brace"];
  return [];
}

const groupProp = NodeProp.group.add((type: NodeType) => {
  const added = derivedGroups(type.name);
  if (added.length === 0) return undefined;
  return [...(type.prop(NodeProp.group) ?? []), ...added];
});

function tokenStyles(): Record<string, Tag> {
  const styles: Record<string, Tag> = {};
  for (const name of nodeNames) {
    if (name === "Begin" || name === "End" || name.endsWith("CtrlSeq")) {
      styles[name] = KEYWORD_CTRL_SEQS.has(name) ? t.keyword : t.tagName;
    } else if (name.endsWith("CtrlSym")) {
      styles[name] = t.literal;
    } else if (name.endsWith("EnvName")) {
      styles[name] = t.attributeValue;
    }
  }
  return styles;
}

const highlightProp = styleTags({
  ...tokenStyles(),
  "HrefCommand/ShortTextArgument/ShortArg/...": t.link,
  "HrefCommand/UrlArgument/...": t.monospace,
  "CtrlSeq Csname": t.tagName,
  "DocumentClass/OptionalArgument/ShortOptionalArg/...": t.attributeValue,
  "DocumentClass/ShortTextArgument/ShortArg/Normal": t.typeName,
  "ListEnvironment/BeginEnv/OptionalArgument/...": t.monospace,
  Number: t.number,
  OpenBrace: t.brace,
  CloseBrace: t.brace,
  OpenBracket: t.squareBracket,
  CloseBracket: t.squareBracket,
  Dollar: t.string,
  Math: t.string,
  "Math/MathChar": t.string,
  "Math/MathSpecialChar": t.string,
  "Math/Number": t.string,
  "MathArgument/OpenBrace MathArgument/CloseBrace": t.string,
  "MathTextCommand/TextArgument/OpenBrace MathTextCommand/TextArgument/CloseBrace": t.string,
  "MathOpening/LeftCtrlSeq MathClosing/RightCtrlSeq MathUnknownCommand/CtrlSeq MathTextCommand/CtrlSeq": t.literal,
  MathDelimiter: t.literal,
  Tilde: t.keyword,
  Ampersand: t.keyword,
  LineBreakCtrlSym: t.keyword,
  Comment: t.comment,
  "UsePackage/OptionalArgument/ShortOptionalArg/Normal": t.attributeValue,
  "UsePackage/ShortTextArgument/ShortArg/Normal": t.tagName,
  "Affiliation/OptionalArgument/ShortOptionalArg/Normal": t.attributeValue,
  "Affil/OptionalArgument/ShortOptionalArg/Normal": t.attributeValue,
  "LiteralArgContent VerbContent VerbatimContent LstInlineContent": t.string,
  "NewCommand/LiteralArgContent": t.typeName,
  "LabelArgument/ShortTextArgument/ShortArg/...": t.attributeValue,
  "RefArgument/ShortTextArgument/ShortArg/...": t.attributeValue,
  "BibKeyArgument/ShortTextArgument/ShortArg/...": t.attributeValue,
  "ShortTextArgument/ShortArg/Normal": t.monospace,
  "UrlArgument/LiteralArgContent": [t.attributeValue, t.url],
  "FilePathArgument/LiteralArgContent": t.attributeValue,
  "BareFilePathArgument/SpaceDelimitedLiteralArgContent": t.attributeValue,
  TrailingContent: t.comment,
  "Item/OptionalArgument/ShortOptionalArg/...": t.strong,
});

function trailingWhitespaceLength(state: EditorState, from: number, to: number): number {
  const tail = state.sliceDoc(Math.max(from, to - 512), to);
  return tail.length - tail.trimEnd().length;
}

function environmentFoldRange(node: SyntaxNode): { from: number; to: number } | null {
  const content = node.getChild("Content");
  return content && content.to > content.from ? { from: content.from, to: content.to } : null;
}

function sectionFoldRange(node: SyntaxNode, state: EditorState): { from: number; to: number } | null {
  const content = node.getChild("Content");
  if (!content) return null;
  const to = content.to - trailingWhitespaceLength(state, content.from, content.to);
  return to > content.from ? { from: content.from, to } : null;
}

const foldProp = foldNodeProp.add({
  $Environment: environmentFoldRange,
  $Section: sectionFoldRange,
});

export const latexTreeParser = grammar
  .configure({ props: [groupProp] })
  .configure({ props: [foldProp, highlightProp] });

export const latexTreeLanguage = LRLanguage.define({
  name: "latex",
  parser: latexTreeParser,
  languageData: {
    commentTokens: { line: "%" },
    closeBrackets: {
      brackets: ["(", "[", "{", "'", '"'],
      before: ")]}:;>$",
    },
  },
});

export function latexTreeSupport(): LanguageSupport {
  return new LanguageSupport(latexTreeLanguage, [latexIgnoredRangesField]);
}

export interface TextSpan {
  from: number;
  to: number;
}

export type ListEnvironmentName = "itemize" | "enumerate" | "description";

export const ALIGNMENT_ENVIRONMENTS: ReadonlySet<string> = new Set(["center", "flushleft", "flushright"]);

const LIST_ENVIRONMENT_NAMES: ReadonlySet<string> = new Set(["itemize", "enumerate", "description"]);

export function isListEnvironmentName(name: string): name is ListEnvironmentName {
  return LIST_ENVIRONMENT_NAMES.has(name);
}

export function nodeText(state: EditorState, span: TextSpan): string {
  return state.sliceDoc(span.from, span.to);
}

export function ancestorOfType(
  node: SyntaxNode | null | undefined,
  ...types: Array<string | number>
): SyntaxNode | null {
  let current = node ?? null;
  while (current) {
    const candidate = current;
    if (types.some((type) => candidate.type.is(type))) return candidate;
    current = candidate.parent;
  }
  return null;
}

export function ancestorAt(
  state: EditorState,
  pos: number,
  type: string | number,
  side: -1 | 0 | 1 = 0,
): SyntaxNode | null {
  return ancestorOfType(syntaxTree(state).resolveInner(pos, side), type);
}

export function descendantsOfType(
  node: SyntaxNode,
  type: string | number,
  stopAt?: string | number,
): SyntaxNode[] {
  const found: SyntaxNode[] = [];
  node.cursor().iterate((ref) => {
    if (ref.type.is(type)) found.push(ref.node);
    if (stopAt !== undefined && ref.type.is(stopAt) && (ref.from !== node.from || ref.to !== node.to)) {
      return false;
    }
    return undefined;
  });
  return found;
}

export function environmentName(node: SyntaxNode | null | undefined, state: EditorState): string | null {
  let edge = node ?? null;
  if (edge?.type.is("$Environment")) edge = edge.getChild("BeginEnv");
  if (!edge || !(edge.type.is("BeginEnv") || edge.type.is("EndEnv"))) return null;
  const name = edge.getChild("EnvNameGroup")?.getChild("OpenBrace")?.nextSibling;
  if (!name || name.type.is("CloseBrace")) return null;
  return state.sliceDoc(name.from, name.to);
}

export function unstarredEnvironmentName(
  node: SyntaxNode | null | undefined,
  state: EditorState,
): string | null {
  return environmentName(node, state)?.replace(/\*$/u, "") ?? null;
}

export function environmentHasClosedName(edge: SyntaxNode): boolean {
  return edge.getChild("EnvNameGroup")?.getChild("CloseBrace") !== null;
}

export function environmentArguments(environment: SyntaxNode): SyntaxNode[] {
  return environment.getChild("BeginEnv")?.getChildren("TextArgument") ?? [];
}

export function centeringCommandWithin(environment: SyntaxNodeRef): SyntaxNode | null {
  let centering: SyntaxNode | null = null;
  environment.node.cursor().iterate((ref) => {
    if (centering) return false;
    if (ref.type.is("CenteringCtrlSeq")) {
      centering = ref.node;
      return false;
    }
    if (ref.type.is("$Environment") && (ref.from !== environment.from || ref.to !== environment.to)) {
      return false;
    }
    return undefined;
  });
  return centering;
}

export function listItemsOf(list: SyntaxNode): SyntaxNode[] {
  return descendantsOfType(list, "Item", "ListEnvironment");
}

export function listEnvironmentName(state: EditorState, list: SyntaxNode): ListEnvironmentName | null {
  const name = unstarredEnvironmentName(list, state);
  return name && isListEnvironmentName(name) ? name : null;
}

export function listDepthOf(node: SyntaxNode | null): number {
  let depth = 0;
  for (let current = node; current; current = current.parent) {
    if (current.type.is("ListEnvironment")) depth += 1;
  }
  return depth;
}

export function mathContainerOf(math: SyntaxNode): SyntaxNode | null {
  return (
    ancestorOfType(math, "$MathContainer") ??
    ancestorOfType(math, "EquationEnvironment") ??
    ancestorOfType(math, "EquationArrayEnvironment")
  );
}

export interface MathSource {
  source: string;
  display: boolean;
}

export function mathSourceOf(state: EditorState, math: SyntaxNodeRef, container: SyntaxNode): MathSource | null {
  const inner = state.sliceDoc(math.from, math.to).trim();
  if (!inner) return null;
  if (container.type.is("$Environment")) {
    const name = environmentName(container, state);
    if (!name || name === "tikzcd") return null;
    if (name === "math") return { source: inner, display: false };
    if (name === "displaymath") return { source: inner, display: true };
    return { source: state.sliceDoc(container.from, container.to).trim(), display: true };
  }
  const display = container.type.is("BracketMath") || container.getChild("DisplayMath") !== null;
  return { source: inner, display };
}

export interface TheoremDeclaration {
  environment: string;
  label: string;
}

export function theoremDeclaration(state: EditorState, node: SyntaxNode): TheoremDeclaration | null {
  const name = node.getChild("ShortTextArgument")?.getChild("ShortArg");
  const label = node.getChild("TextArgument")?.getChild("LongArg");
  if (!name || !label) return null;
  const environment = state.sliceDoc(name.from, name.to).trim();
  const text = state.sliceDoc(label.from, label.to).trim();
  return environment && text ? { environment, label: text } : null;
}

export function shortArgumentText(state: EditorState, node: SyntaxNode): string | null {
  const argument = node.getChild("ShortTextArgument")?.getChild("ShortArg");
  return argument ? state.sliceDoc(argument.from, argument.to).trim() : null;
}

export interface ColoredSpan extends TextSpan {
  color: string;
}

export function colorCommandSpan(state: EditorState, node: SyntaxNode): ColoredSpan | null {
  const spec = node.getChild("ShortTextArgument")?.getChild("ShortArg");
  const content = node.getChild("TextArgument")?.getChild("LongArg");
  if (!spec || !content || content.to <= content.from) return null;
  const model = node.getChild("OptionalArgument")?.getChild("ShortOptionalArg");
  const specText = state.sliceDoc(spec.from, spec.to).trim();
  const color = latexColorToCss(
    model ? `[${state.sliceDoc(model.from, model.to).trim()}]{${specText}}` : specText,
  );
  return color ? { color, from: content.from, to: content.to } : null;
}

export function lineHoldsOnlyNode(line: Line, node: TextSpan): boolean {
  return line.text.trim().length === node.to - node.from;
}

export function commandName(state: EditorState, command: SyntaxNode): string | null {
  const ctrlSeq = command.getChild("$CtrlSeq");
  if (!ctrlSeq) return null;
  const name = state.sliceDoc(ctrlSeq.from, ctrlSeq.to).trim();
  return name.length > 0 ? name : null;
}

export function sectioningLevelName(state: EditorState, command: SyntaxNode): string | null {
  const name = commandName(state, command);
  return name ? name.replace(/^\\/u, "").replace(/\*$/u, "") : null;
}

export function fullyParsed(state: EditorState): boolean {
  return syntaxTree(state).length >= state.doc.length;
}
