import type { EditorState, Extension } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { isTypstDisplayBody } from "../../math-source";
import { type LineRole, type ParagraphRules, firstTextPosition, isBlankLine, paragraphLines } from "../paragraphs";
import { TYPST_STYLE_CALLS } from "./builtins";
import { typstVisualField } from "./field";
import { calleeName, isClosedPair } from "./syntax";

const INLINE_MARKUP = new Set(["Strong", "Emph", "SmartQuote", "Escape", "Shorthand", "Ref", "Link"]);
const ASIDE_MARKUP = new Set(["Label", "LineComment", "BlockComment"]);
const INLINE_CALLS: ReadonlySet<string> = new Set([...TYPST_STYLE_CALLS, "link", "cite", "ref", "footnote", "text"]);

function topLevel(node: SyntaxNode): SyntaxNode {
  let current = node;
  while (current.parent && current.parent.name !== "Source") current = current.parent;
  return current;
}

function equationRole(state: EditorState, equation: SyntaxNode): LineRole {
  if (!isClosedPair(equation, "Dollar", "Dollar")) return "text";
  const body = state.sliceDoc(equation.firstChild!.to, equation.lastChild!.from);
  return isTypstDisplayBody(body) ? "block" : "text";
}

function callRole(state: EditorState, hash: SyntaxNode): LineRole {
  const call = hash.nextSibling;
  const name = call?.name === "FuncCall" && call.from === hash.to ? calleeName(state, call) : null;
  return name && INLINE_CALLS.has(name) ? "text" : "block";
}

function leadRole(state: EditorState, node: SyntaxNode): LineRole {
  if (node.name === "Source") return "text";
  const lead = topLevel(node);
  if (lead.name === "Heading") return "heading";
  if (lead.name === "Equation") return equationRole(state, lead);
  if (lead.name === "Hash") return callRole(state, lead);
  if (ASIDE_MARKUP.has(lead.name)) return "aside";
  return INLINE_MARKUP.has(lead.name) ? "text" : "block";
}

export const typstParagraphRules: ParagraphRules = {
  role(state, tree, line) {
    if (!isBlankLine(line)) return leadRole(state, tree.resolveInner(firstTextPosition(line), 1));
    return tree.resolveInner(line.from, 1).name === "Source" ? "blank" : "block";
  },
  contentStart(state) {
    return state.field(typstVisualField, false)?.preamble.to ?? 0;
  },
  indentsAfter(previous) {
    return previous === "text";
  },
};

export const typstParagraphs: Extension = paragraphLines(typstParagraphRules);
