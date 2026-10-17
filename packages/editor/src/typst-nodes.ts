import {
  delimitedIndent,
  foldNodeProp,
  indentNodeProp,
  languageDataProp,
} from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { NodeProp, NodeSet, NodeType, type SyntaxNode } from "@lezer/common";
import { styleTags, tags as t } from "@lezer/highlight";
import { syntaxTags } from "./syntax-colors";
import { typstLanguageData } from "./typst";

export const K = {
  Chunk: 0,
  Source: 1,
  Error: 2,
  End: 3,
  Shebang: 4,
  LineComment: 5,
  BlockComment: 6,
  Markup: 7,
  Text: 8,
  Space: 9,
  Linebreak: 10,
  Parbreak: 11,
  Escape: 12,
  Shorthand: 13,
  SmartQuote: 14,
  Strong: 15,
  Emph: 16,
  Raw: 17,
  RawLang: 18,
  RawDelim: 19,
  RawTrimmed: 20,
  Link: 21,
  Label: 22,
  Ref: 23,
  RefMarker: 24,
  Heading: 25,
  HeadingMarker: 26,
  ListItem: 27,
  ListMarker: 28,
  EnumItem: 29,
  EnumMarker: 30,
  TermItem: 31,
  TermMarker: 32,
  Equation: 33,
  Math: 34,
  MathText: 35,
  MathIdent: 36,
  MathFieldAccess: 37,
  MathShorthand: 38,
  MathAlignPoint: 39,
  MathCall: 40,
  MathArgs: 41,
  MathDelimited: 42,
  MathAttach: 43,
  MathPrimes: 44,
  MathFrac: 45,
  MathRoot: 46,
  Hash: 47,
  LeftBrace: 48,
  RightBrace: 49,
  LeftBracket: 50,
  RightBracket: 51,
  LeftParen: 52,
  RightParen: 53,
  Comma: 54,
  Semicolon: 55,
  Colon: 56,
  Star: 57,
  Underscore: 58,
  Dollar: 59,
  Plus: 60,
  Minus: 61,
  Slash: 62,
  Hat: 63,
  Dot: 64,
  Eq: 65,
  EqEq: 66,
  ExclEq: 67,
  Lt: 68,
  LtEq: 69,
  Gt: 70,
  GtEq: 71,
  PlusEq: 72,
  HyphEq: 73,
  StarEq: 74,
  SlashEq: 75,
  Dots: 76,
  Arrow: 77,
  Root: 78,
  Bang: 79,
  Not: 80,
  And: 81,
  Or: 82,
  None: 83,
  Auto: 84,
  Let: 85,
  Set: 86,
  Show: 87,
  Context: 88,
  If: 89,
  Else: 90,
  For: 91,
  In: 92,
  While: 93,
  Break: 94,
  Continue: 95,
  Return: 96,
  Import: 97,
  Include: 98,
  As: 99,
  Code: 100,
  Ident: 101,
  Bool: 102,
  Int: 103,
  Float: 104,
  Numeric: 105,
  Str: 106,
  CodeBlock: 107,
  ContentBlock: 108,
  Parenthesized: 109,
  Array: 110,
  Dict: 111,
  Named: 112,
  Keyed: 113,
  Unary: 114,
  Binary: 115,
  FieldAccess: 116,
  FuncCall: 117,
  Args: 118,
  Spread: 119,
  Closure: 120,
  Params: 121,
  LetBinding: 122,
  SetRule: 123,
  ShowRule: 124,
  Contextual: 125,
  Conditional: 126,
  WhileLoop: 127,
  ForLoop: 128,
  ModuleImport: 129,
  ImportItems: 130,
  ImportItemPath: 131,
  RenamedImportItem: 132,
  ModuleInclude: 133,
  LoopBreak: 134,
  LoopContinue: 135,
  FuncReturn: 136,
  Destructuring: 137,
  DestructAssignment: 138,
  HashKeyword: 139,
  HashFunction: 140,
  HashVariable: 141,
  HashString: 142,
  HashNumber: 143,
  HashLiteral: 144,
  IdentFunction: 145,
  IdentField: 146,
  IdentProperty: 147,
  IdentDefinition: 148,
  TermMarkup: 149,
} as const;

const KIND_NAMES = Object.keys(K);

const VARIANT_BASE: Readonly<Record<number, number>> = {
  [K.HashKeyword]: K.Hash,
  [K.HashFunction]: K.Hash,
  [K.HashVariable]: K.Hash,
  [K.HashString]: K.Hash,
  [K.HashNumber]: K.Hash,
  [K.HashLiteral]: K.Hash,
  [K.IdentFunction]: K.Ident,
  [K.IdentField]: K.Ident,
  [K.IdentProperty]: K.Ident,
  [K.IdentDefinition]: K.Ident,
  [K.TermMarkup]: K.Markup,
};

const VARIANT_GROUP: Readonly<Record<number, string>> = {
  [K.HashKeyword]: "HashKeyword",
  [K.HashFunction]: "HashFunction",
  [K.HashVariable]: "HashVariable",
  [K.HashString]: "HashString",
  [K.HashNumber]: "HashNumber",
  [K.HashLiteral]: "HashLiteral",
  [K.Ident]: "VariableName",
  [K.IdentFunction]: "FunctionName",
  [K.IdentField]: "FieldName",
  [K.IdentProperty]: "PropertyName",
  [K.IdentDefinition]: "DefinedName",
  [K.TermMarkup]: "TermText",
};

export function baseKind(kind: number): number {
  return VARIANT_BASE[kind] ?? kind;
}

function nodeName(id: number): string | undefined {
  if (id === K.Chunk) return undefined;
  if (id === K.Error) return "⚠";
  return KIND_NAMES[baseKind(id)];
}

function defineType(id: number): NodeType {
  const group = VARIANT_GROUP[id];
  const props: [NodeProp<unknown>, unknown][] = [];
  if (group) props.push([NodeProp.group, [group]]);
  if (id === K.Source) props.push([languageDataProp, typstLanguageData]);
  return NodeType.define({
    id,
    name: nodeName(id),
    top: id === K.Source,
    error: id === K.Error,
    skipped: id === K.LineComment || id === K.BlockComment || id === K.Shebang,
    props,
  });
}

function delimited(
  open: string,
  close: string,
): (node: SyntaxNode) => { from: number; to: number } | null {
  return (node) => {
    const opening = node.getChild(open);
    const closing = node.getChildren(close).at(-1);
    if (!opening || !closing || closing.from < opening.to) return null;
    return closing.from > opening.to ? { from: opening.to, to: closing.from } : null;
  };
}

function rawFold(node: SyntaxNode): { from: number; to: number } | null {
  const open = node.firstChild;
  const close = node.lastChild;
  if (!open || !close || open === close || close.name !== "RawDelim") return null;
  const start = node.getChild("RawLang")?.to ?? open.to;
  return close.from > start ? { from: start, to: close.from } : null;
}

function blockCommentFold(node: SyntaxNode, state: EditorState): { from: number; to: number } | null {
  const closed = state.sliceDoc(node.to - 2, node.to) === "*/";
  const to = closed ? node.to - 2 : node.to;
  return to > node.from + 2 ? { from: node.from + 2, to } : null;
}

const typstHighlighting = styleTags({
  "LineComment Shebang": t.lineComment,
  BlockComment: t.blockComment,
  "Heading/...": t.heading,
  "Strong/...": t.strong,
  "Emph/...": t.emphasis,
  "Strong/Star Emph/Underscore": syntaxTags.formatting,
  "ListMarker EnumMarker TermMarker": t.list,
  "TermItem/Colon": t.list,
  "TermText/...": t.strong,
  "Raw/...": [t.monospace, t.string],
  RawLang: t.labelName,
  Link: t.url,
  Label: syntaxTags.reference,
  "Ref/...": syntaxTags.reference,
  "Linebreak Escape Shorthand MathShorthand": t.escape,
  "Equation/...": syntaxTags.math,
  "MathArgs/LeftParen MathArgs/RightParen Math/LeftParen Math/RightParen MathArgs/Comma MathArgs/Semicolon MathFrac/Slash MathArgs/Colon":
    [],
  HashKeyword: t.keyword,
  HashFunction: t.function(t.variableName),
  HashVariable: t.variableName,
  HashString: t.string,
  HashNumber: t.number,
  HashLiteral: t.bool,
  VariableName: t.variableName,
  FunctionName: t.function(t.variableName),
  "FieldName PropertyName": t.propertyName,
  DefinedName: t.definition(t.variableName),
  Let: t.definitionKeyword,
  "Set Show Context": t.keyword,
  "Import Include As": t.moduleKeyword,
  "If Else For In While Break Continue Return": t.controlKeyword,
  "Not And Or": t.operatorKeyword,
  Bool: t.bool,
  None: t.null,
  Auto: t.atom,
  "Int Float Numeric": t.number,
  Str: t.string,
  "Plus Minus Star Slash Eq EqEq ExclEq Lt LtEq Gt GtEq PlusEq HyphEq StarEq SlashEq Dots Arrow":
    t.operator,
  "LeftParen RightParen": t.paren,
  "LeftBracket RightBracket": t.squareBracket,
  "LeftBrace RightBrace": t.brace,
  "Comma Semicolon Colon Dot": t.punctuation,
  "⚠": t.invalid,
});

const typstFoldProps = foldNodeProp.add({
  CodeBlock: delimited("LeftBrace", "RightBrace"),
  ContentBlock: delimited("LeftBracket", "RightBracket"),
  "Args Params Parenthesized Array Dict Destructuring MathArgs ModuleImport": delimited(
    "LeftParen",
    "RightParen",
  ),
  Equation: delimited("Dollar", "Dollar"),
  Raw: rawFold,
  BlockComment: blockCommentFold,
});

const typstIndentProps = indentNodeProp.add({
  Source: () => null,
  CodeBlock: delimitedIndent({ closing: "}" }),
  ContentBlock: delimitedIndent({ closing: "]" }),
  "Args Params Parenthesized Array Dict Destructuring MathArgs": delimitedIndent({ closing: ")" }),
  Equation: delimitedIndent({ closing: "$", align: false }),
});

const typstBracketProps = [
  NodeProp.closedBy.add({
    LeftParen: ["RightParen"],
    LeftBracket: ["RightBracket"],
    LeftBrace: ["RightBrace"],
  }),
  NodeProp.openedBy.add({
    RightParen: ["LeftParen"],
    RightBracket: ["LeftBracket"],
    RightBrace: ["LeftBrace"],
  }),
];

export const typstNodeSet = new NodeSet(KIND_NAMES.map((_, id) => defineType(id))).extend(
  typstHighlighting,
  typstFoldProps,
  typstIndentProps,
  ...typstBracketProps,
);
