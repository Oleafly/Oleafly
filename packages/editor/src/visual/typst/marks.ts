import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";
import { visualPortsFacet } from "../facets";
import { isTypstTree, TYPST_STYLE_CALLS } from "./field";
import {
  calleeName,
  callArguments,
  contentBody,
  hashBefore,
  labelKey,
  namedArgument,
  namedValue,
  referenceKey,
  trailingContentBlocks,
  type TextRange,
} from "./syntax";

const NAMED_COLORS: ReadonlySet<string> = new Set([
  "black",
  "gray",
  "silver",
  "white",
  "navy",
  "blue",
  "aqua",
  "teal",
  "eastern",
  "purple",
  "fuchsia",
  "maroon",
  "red",
  "orange",
  "yellow",
  "olive",
  "green",
  "lime",
]);

const HEX_COLOR = /^rgb\(\s*"(#[0-9a-f]{3,8})"\s*\)$/iu;

function mark(className: string, from: number, to: number, attributes?: Record<string, string>): Range<Decoration> {
  return Decoration.mark({ class: className, attributes }).range(from, to);
}

function contentHoles(node: SyntaxNode, holes: TextRange[] = []): TextRange[] {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name !== "ContentBlock") {
      contentHoles(child, holes);
      continue;
    }
    const body = contentBody(child);
    if (body) holes.push(body);
  }
  return holes;
}

function codeMarks(from: number, to: number, holes: readonly TextRange[]): Range<Decoration>[] {
  const marks: Range<Decoration>[] = [];
  let pos = from;
  for (const hole of holes) {
    if (hole.from > pos) marks.push(mark("ofl-visual-typst-code", pos, hole.from));
    pos = Math.max(pos, hole.to);
  }
  if (to > pos) marks.push(mark("ofl-visual-typst-code", pos, to));
  return marks;
}

function textColor(state: EditorState, args: SyntaxNode): string | null {
  const fill = namedArgument(state, args, "fill");
  const value = fill ? namedValue(fill) : null;
  if (!value) return null;
  const text = state.sliceDoc(value.from, value.to).trim();
  if (value.name === "Ident" && NAMED_COLORS.has(text)) return text;
  const hex = HEX_COLOR.exec(text);
  return hex ? hex[1] : null;
}

class TypstMarkBuilder {
  readonly marks: Range<Decoration>[] = [];
  private labels: Set<string> | null = null;

  constructor(
    private readonly state: EditorState,
    private readonly tree: Tree,
  ) {}

  private kindOf(key: string): "label" | "citation" {
    const reported = this.state.facet(visualPortsFacet)?.referenceKind?.(key);
    if (reported) return reported;
    if (!this.labels) {
      const labels = new Set<string>();
      this.tree.iterate({
        enter: (node) => {
          if (node.name === "Label") labels.add(labelKey(this.state, node));
          return node.name === "Raw" || node.name === "Equation" ? false : undefined;
        },
      });
      this.labels = labels;
    }
    return this.labels.has(key) ? "label" : "citation";
  }

  build(from: number, to: number): void {
    this.tree.iterate({ from, to, enter: (node) => this.enter(node.node) });
  }

  private enter(node: SyntaxNode): boolean | undefined {
    switch (node.name) {
      case "Heading": {
        const body = node.getChild("Markup");
        if (body && body.to > body.from) this.marks.push(mark("ofl-visual-heading", body.from, body.to));
        return undefined;
      }
      case "Strong":
        this.marks.push(mark("ofl-visual-typst-strong", node.from, node.to));
        return undefined;
      case "Emph":
        this.marks.push(mark("ofl-visual-typst-emph", node.from, node.to));
        return undefined;
      case "Raw":
        this.marks.push(mark("ofl-visual-typst-raw", node.from, node.to));
        return false;
      case "Link":
        this.marks.push(mark("ofl-visual-link-text", node.from, node.to));
        return false;
      case "LineComment":
      case "BlockComment":
        this.marks.push(mark("ofl-visual-typst-comment", node.from, node.to));
        return false;
      case "Label":
        this.marks.push(mark("ofl-visual-chip ofl-visual-chip-label ofl-visual-typst-label", node.from, node.to));
        return false;
      case "Ref":
        this.reference(node);
        return undefined;
      case "TermItem": {
        const term = node.getChild("Markup");
        if (term && term.to > term.from) this.marks.push(mark("ofl-visual-typst-term", term.from, term.to));
        return undefined;
      }
      case "Equation":
        this.marks.push(mark("ofl-visual-typst-math-source", node.from, node.to));
        return false;
      case "Hash":
        return false;
      default:
        break;
    }
    const hash = hashBefore(node);
    if (!hash) return undefined;
    this.code(hash, node);
    if (node.name === "FuncCall") this.call(hash, node);
    return undefined;
  }

  private reference(node: SyntaxNode): void {
    const key = referenceKey(this.state, node);
    if (!key) return;
    const kind = this.kindOf(key) === "label" ? "ref" : "cite";
    this.marks.push(mark(`ofl-visual-chip ofl-visual-chip-${kind}`, node.from, node.to));
    const block = node.getChild("ContentBlock");
    const body = block ? contentBody(block) : null;
    if (body && body.to > body.from) this.marks.push(mark("ofl-visual-typst-ref-supplement", body.from, body.to));
  }

  private code(hash: SyntaxNode, node: SyntaxNode): void {
    this.marks.push(...codeMarks(hash.from, node.to, contentHoles(node)));
  }

  private call(hash: SyntaxNode, node: SyntaxNode): void {
    const name = calleeName(this.state, node);
    const args = callArguments(node);
    if (!name || !args) return;
    if (name === "link") {
      const [block] = trailingContentBlocks(args);
      const body = block ? contentBody(block) : null;
      if (body && body.to > body.from) this.marks.push(mark("ofl-visual-link-text", body.from, body.to));
      else this.marks.push(mark("ofl-visual-link-text", hash.from, node.to));
      return;
    }
    if (name === "cite" || name === "ref") {
      this.marks.push(mark(`ofl-visual-chip ofl-visual-chip-${name === "cite" ? "cite" : "ref"}`, hash.from, node.to));
      return;
    }
    if (name === "figure") {
      this.caption(args);
      return;
    }
    if (!TYPST_STYLE_CALLS.has(name)) return;
    const blocks = trailingContentBlocks(args);
    const body = blocks.length === 1 ? contentBody(blocks[0]) : null;
    if (!body || body.to <= body.from) return;
    const color = name === "text" ? textColor(this.state, args) : null;
    if (name === "text" && !color) return;
    this.marks.push(
      mark(`ofl-visual-typst-${name}`, body.from, body.to, color ? { style: `color: ${color}` } : undefined),
    );
  }

  private caption(args: SyntaxNode): void {
    const named = namedArgument(this.state, args, "caption");
    const value = named ? namedValue(named) : null;
    const body = value?.name === "ContentBlock" ? contentBody(value) : null;
    if (body && body.to > body.from) this.marks.push(mark("ofl-visual-typst-caption", body.from, body.to));
  }
}

export function buildTypstMarks(state: EditorState, tree: Tree, ranges: readonly TextRange[]): DecorationSet {
  if (!isTypstTree(tree)) return Decoration.none;
  const builder = new TypstMarkBuilder(state, tree);
  for (const { from, to } of ranges) builder.build(from, to);
  return Decoration.set(builder.marks, true);
}

class TypstMarkPlugin {
  decorations: DecorationSet;
  private tree: Tree;

  constructor(private readonly view: EditorView) {
    this.tree = syntaxTree(view.state);
    this.decorations = buildTypstMarks(view.state, this.tree, view.visibleRanges);
  }

  update(update: ViewUpdate): void {
    const tree = syntaxTree(update.state);
    const stillParsing = tree.type === this.tree.type && tree.length < update.view.viewport.to;
    if (stillParsing) {
      this.decorations = this.decorations.map(update.changes);
      return;
    }
    if (tree !== this.tree || update.viewportChanged) {
      this.tree = tree;
      this.decorations = buildTypstMarks(this.view.state, tree, this.view.visibleRanges);
    }
  }
}

export const typstMarkDecorations = ViewPlugin.fromClass(TypstMarkPlugin, {
  decorations: (plugin) => plugin.decorations,
});
