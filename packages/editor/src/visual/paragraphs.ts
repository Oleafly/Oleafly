import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Line, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";
import { commandName, unstarredEnvironmentName } from "../latex-tree";
import { visualAtomicField } from "./atomic-decorations";

export type LineRole = "text" | "heading" | "blank" | "block" | "aside";

export interface ParagraphRules {
  role(state: EditorState, tree: Tree, line: Line): LineRole;
  contentStart(state: EditorState): number;
  indentsAfter(previous: LineRole | null): boolean;
}

const PARAGRAPH_START = Decoration.line({ class: "ofl-visual-paragraph-start" });
const BLANK_LINE = Decoration.line({ class: "ofl-visual-blank-line" });
const LOOKBACK_LINES = 200;

export function isBlankLine(line: Line): boolean {
  return line.text.trim() === "";
}

export function firstTextPosition(line: Line): number {
  return line.from + line.text.length - line.text.trimStart().length;
}

interface ParagraphContext {
  opens: boolean;
  previous: LineRole | null;
}

function paragraphContext(state: EditorState, tree: Tree, rules: ParagraphRules, line: Line, start: number): ParagraphContext {
  let blank = false;
  const last = Math.max(1, line.number - LOOKBACK_LINES);
  for (let number = line.number - 1; number >= last; number -= 1) {
    const previous = state.doc.line(number);
    if (previous.to <= start) return { opens: true, previous: null };
    if (isBlankLine(previous)) {
      blank = true;
      continue;
    }
    const role = rules.role(state, tree, previous);
    if (role !== "aside") return { opens: blank, previous: role };
  }
  return { opens: true, previous: null };
}

function startsParagraph(state: EditorState, tree: Tree, rules: ParagraphRules, line: Line, start: number): boolean {
  const context = paragraphContext(state, tree, rules, line, start);
  return context.opens && rules.indentsAfter(context.previous);
}

export function buildParagraphDecorations(view: EditorView, rules: ParagraphRules): DecorationSet {
  const { state } = view;
  const tree = syntaxTree(state);
  const start = rules.contentStart(state);
  const ranges: Range<Decoration>[] = [];
  let done = 0;
  for (const { from, to } of view.visibleRanges) {
    let pos = Math.max(from, start);
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (line.number <= done) continue;
      done = line.number;
      const role = rules.role(state, tree, line);
      if (role === "blank") ranges.push(BLANK_LINE.range(line.from));
      else if (role === "text" && startsParagraph(state, tree, rules, line, start)) ranges.push(PARAGRAPH_START.range(line.from));
    }
  }
  return Decoration.set(ranges);
}

export function paragraphLines(rules: ParagraphRules): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildParagraphDecorations(view, rules);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
          this.decorations = buildParagraphDecorations(update.view, rules);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

const LATEX_PROSE_ENVIRONMENTS = new Set(["document", "abstract", "quotation", "proof", "frame"]);

const LATEX_INLINE_NODES = new Set([
  "Normal",
  "ParenMath",
  "TextColorCommand",
  "ColorBoxCommand",
  "HrefCommand",
  "UrlCommand",
  "VerbCommand",
  "LstInlineCommand",
  "FootnoteCommand",
  "EndnoteCommand",
  "Cite",
  "Ref",
]);

const LATEX_FORMATTING_GROUPS = ["$ToggleTextFormattingCommand", "$OtherTextFormattingCommand"];

const LATEX_LAYOUT_COMMANDS = new Set([
  "\\noindent",
  "\\par",
  "\\vspace",
  "\\vskip",
  "\\smallskip",
  "\\medskip",
  "\\bigskip",
  "\\newpage",
  "\\clearpage",
  "\\cleardoublepage",
  "\\pagebreak",
  "\\centering",
  "\\raggedright",
  "\\raggedleft",
  "\\maketitle",
  "\\tableofcontents",
  "\\listoffigures",
  "\\listoftables",
  "\\appendix",
  "\\frontmatter",
  "\\mainmatter",
  "\\backmatter",
  "\\printbibliography",
]);

const LATEX_CONTAINERS = new Set(["Content", "Text", "LaTeX"]);

function insideLatexBlock(state: EditorState, node: SyntaxNode): boolean {
  const theorems = state.field(visualAtomicField, false)?.theorems;
  for (let current: SyntaxNode | null = node; current; current = current.parent) {
    if (!current.getChild("BeginEnv")) continue;
    const name = unstarredEnvironmentName(current, state);
    if (!name || !(LATEX_PROSE_ENVIRONMENTS.has(name) || theorems?.has(name))) return true;
  }
  return false;
}

function isLatexInline(node: SyntaxNode): boolean {
  return LATEX_INLINE_NODES.has(node.name) || LATEX_FORMATTING_GROUPS.some((group) => node.type.is(group));
}

function latexLeadRole(state: EditorState, node: SyntaxNode): LineRole {
  for (let current: SyntaxNode | null = node; current && !LATEX_CONTAINERS.has(current.name); current = current.parent) {
    if (current.name === "SectioningCommand") return "heading";
    if (current.name === "Comment" || current.name === "Label") return "aside";
    if (current.name === "DollarMath") return current.getChild("DisplayMath") ? "block" : "text";
    if (current.name === "UnknownCommand") {
      return LATEX_LAYOUT_COMMANDS.has(commandName(state, current) ?? "") ? "block" : "text";
    }
    if (isLatexInline(current)) return "text";
  }
  return "block";
}

export const latexParagraphRules: ParagraphRules = {
  role(state, tree, line) {
    const blank = isBlankLine(line);
    const node = tree.resolveInner(blank ? line.from : firstTextPosition(line), 1);
    if (insideLatexBlock(state, node)) return "block";
    return blank ? "blank" : latexLeadRole(state, node);
  },
  contentStart(state) {
    return state.field(visualAtomicField, false)?.preamble.to ?? 0;
  },
  indentsAfter(previous) {
    return previous !== "heading";
  },
};

export const latexParagraphs: Extension = paragraphLines(latexParagraphRules);
