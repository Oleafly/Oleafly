import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, type WidgetType } from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef, Tree } from "@lezer/common";
import { editorMessage } from "../../messages";
import { visualPortsFacet } from "../facets";
import { type Extents, hasMouseDownEffect, mouseDownEffect, selectionIntersects } from "../selection";
import { skipPreambleCursor } from "../skip-preamble";
import type { VisualPorts, VisualReferenceKind } from "../types";
import { DescriptionItemWidget } from "../widgets/description-item";
import { FootnoteWidget } from "../widgets/footnote";
import { GraphicsWidget } from "../widgets/graphics";
import { IconBraceWidget } from "../widgets/icon-brace";
import { IndicatorWidget } from "../widgets/indicator";
import { ItemWidget } from "../widgets/item";
import { type Preamble, type PreambleLabels, PreambleWidget } from "../widgets/preamble";
import { figureDecorations } from "./figure";
import { isTypstDisplayBody } from "../../math-source";
import { TypstMathWidget } from "./math";
import { typstSettingsEnd } from "./settings";
import {
  calleeName,
  callArguments,
  contentBody,
  decodeTypstEscape,
  hashBefore,
  imagePath,
  isBlank,
  isClosedPair,
  labelKey,
  listDepth,
  positionalArguments,
  referenceKey,
  trailingContentBlocks,
} from "./syntax";
import { tableDecorations } from "./table/decoration";
import { RawLanguageWidget, TypstTextWidget } from "./widgets";

export interface TypstVisualState {
  decorations: DecorationSet;
  preamble: Preamble;
  tree: Tree;
  mousedown: boolean;
}

export interface TypstDecorationResult {
  decorations: DecorationSet;
  preamble: Preamble;
}

export const TYPST_SETTINGS_LABELS: PreambleLabels = {
  show: "visual.typst.settings.show",
  hide: "visual.typst.settings.hide",
};

export const TYPST_STYLE_CALLS: ReadonlySet<string> = new Set([
  "underline",
  "strike",
  "overline",
  "highlight",
  "smallcaps",
  "emph",
  "strong",
  "sub",
  "super",
  "text",
  "upper",
  "lower",
]);

const SHORTHANDS: Readonly<Record<string, string>> = {
  "~": " ",
  "--": "–",
  "---": "—",
  "...": "…",
  "-?": "­",
};

const OPENING_CONTEXT = /[\s([{—–]/u;

export function isTypstTree(tree: Tree): boolean {
  return tree.type.name === "Source";
}

function replaceInline(from: number, to: number, widget?: WidgetType): Range<Decoration> {
  return Decoration.replace({ widget }).range(from, to);
}

function lineClass(from: number, name: string): Range<Decoration> {
  return Decoration.line({ class: name }).range(from);
}

export class TypstDecorationBuilder {
  readonly decorations: Range<Decoration>[] = [];
  readonly preamble: Preamble = { from: 0, to: 0, authors: [] };
  readonly ports: VisualPorts | null;
  private readonly ordinals = new Map<number, number>();
  private readonly openingQuotes = new Set<number>();
  private labels: Set<string> | null = null;

  constructor(
    readonly state: EditorState,
    private readonly tree: Tree,
  ) {
    this.ports = state.facet(visualPortsFacet);
  }

  build(): TypstDecorationResult {
    if (!isTypstTree(this.tree)) return { decorations: Decoration.none, preamble: this.preamble };
    this.preamble.to = typstSettingsEnd(this.state, this.tree);
    this.tree.iterate({ enter: (node) => this.enter(node) });
    const collapsed = this.decorateSettings();
    const ranges = collapsed
      ? this.decorations.filter((range) => range.from >= this.preamble.to || range === collapsed)
      : this.decorations;
    return { decorations: Decoration.set(ranges, true), preamble: this.preamble };
  }

  shouldDecorate(extents: Extents): boolean {
    return this.state.readOnly || !selectionIntersects(this.state.selection, extents);
  }

  push(...ranges: Range<Decoration>[]): void {
    this.decorations.push(...ranges);
  }

  blockRange(node: Extents): Extents {
    const { doc } = this.state;
    const startLine = doc.lineAt(node.from);
    const endLine = doc.lineAt(node.to);
    return {
      from: isBlank(doc.sliceString(startLine.from, node.from)) ? startLine.from : node.from,
      to: isBlank(doc.sliceString(node.to, endLine.to)) ? endLine.to : node.to,
    };
  }

  private enter(node: SyntaxNodeRef): boolean | undefined {
    switch (node.name) {
      case "Heading":
        this.heading(node.node);
        return undefined;
      case "Strong":
        this.delimited(node.node, "Star");
        return undefined;
      case "Emph":
        this.delimited(node.node, "Underscore");
        return undefined;
      case "Raw":
        this.raw(node.node);
        return false;
      case "Link":
      case "LineComment":
      case "BlockComment":
        return false;
      case "SmartQuote":
        this.smartQuote(node.node);
        return false;
      case "Escape":
        this.characterWidget(node, decodeTypstEscape(this.state.sliceDoc(node.from, node.to)));
        return false;
      case "Shorthand":
        this.shorthand(node);
        return false;
      case "Linebreak":
        if (this.shouldDecorate(node)) this.push(replaceInline(node.from, node.to, new IndicatorWidget("↩")));
        return false;
      case "ListItem":
      case "EnumItem":
      case "TermItem":
        this.listItem(node.node);
        return undefined;
      case "Label":
        this.label(node);
        return false;
      case "Ref":
        this.reference(node.node);
        return undefined;
      case "Equation":
        this.equation(node.node);
        return false;
      case "FuncCall": {
        const hash = hashBefore(node.node);
        return hash ? this.call(hash, node.node) : undefined;
      }
      default:
        return undefined;
    }
  }

  private heading(heading: SyntaxNode): void {
    const marker = heading.getChild("HeadingMarker");
    const body = heading.getChild("Markup");
    const { doc } = this.state;
    const line = doc.lineAt(heading.from);
    const level = marker ? Math.min(Math.max(marker.to - marker.from, 1), 6) : 1;
    this.push(lineClass(line.from, `ofl-visual-typst-heading ofl-visual-typst-heading-${level}`));
    if (!marker || !body || body.from > line.to) return;
    if (this.shouldDecorate({ from: line.from, to: doc.lineAt(heading.to).to })) {
      this.push(replaceInline(marker.from, body.from));
    }
  }

  private delimited(node: SyntaxNode, delimiter: string): void {
    if (!isClosedPair(node, delimiter, delimiter)) return;
    const open = node.firstChild!;
    const close = node.lastChild!;
    if (close.from <= open.to || !this.shouldDecorate(node)) return;
    this.push(replaceInline(open.from, open.to), replaceInline(close.from, close.to));
  }

  private raw(node: SyntaxNode): void {
    const open = node.firstChild;
    const close = node.lastChild;
    if (!open || !close || open === close || close.name !== "RawDelim") return;
    const language = node.getChild("RawLang");
    const fenced = open.to - open.from >= 3;
    const { doc } = this.state;
    if (fenced) {
      const first = doc.lineAt(open.from).number;
      const last = doc.lineAt(close.to).number;
      for (let number = first; number <= last; number += 1) {
        const classes = ["ofl-visual-typst-raw-line"];
        if (number === first) classes.push("ofl-visual-typst-raw-first-line");
        if (number === last) classes.push("ofl-visual-typst-raw-last-line");
        this.push(lineClass(doc.line(number).from, classes.join(" ")));
      }
    }
    const contentFrom = language?.to ?? open.to;
    if (close.from <= contentFrom || !this.shouldDecorate(node)) return;
    const languageWidget = fenced && language ? new RawLanguageWidget(this.state.sliceDoc(language.from, language.to)) : undefined;
    this.push(replaceInline(open.from, contentFrom, languageWidget), replaceInline(close.from, close.to));
  }

  private characterWidget(node: Extents, text: string): void {
    if (this.shouldDecorate(node)) this.push(replaceInline(node.from, node.to, new TypstTextWidget(text)));
  }

  private shorthand(node: Extents): void {
    const text = SHORTHANDS[this.state.sliceDoc(node.from, node.to)];
    if (text !== undefined) this.characterWidget(node, text);
  }

  private smartQuote(node: SyntaxNode): void {
    const double = this.state.sliceDoc(node.from, node.to) === '"';
    const before = node.from > 0 ? this.state.sliceDoc(node.from - 1, node.from) : "";
    const opening = before === "" || OPENING_CONTEXT.test(before) || this.openingQuotes.has(node.from - 1);
    if (opening) this.openingQuotes.add(node.from);
    const glyph = double ? (opening ? "“" : "”") : opening ? "‘" : "’";
    this.characterWidget(node, glyph);
  }

  private ordinalOf(item: SyntaxNode): number {
    const marker = item.firstChild;
    const explicit = item.name === "EnumItem" && marker ? /^(\d+)\./u.exec(this.state.sliceDoc(marker.from, marker.to)) : null;
    let ordinal = 1;
    if (explicit) {
      ordinal = Number.parseInt(explicit[1], 10);
    } else {
      const previous = item.prevSibling;
      const continues =
        previous?.name === item.name && isBlank(this.state.sliceDoc(previous.to, item.from));
      if (continues) ordinal = (this.ordinals.get(previous.from) ?? 0) + 1;
    }
    this.ordinals.set(item.from, ordinal);
    return ordinal;
  }

  private listItem(item: SyntaxNode): void {
    const marker = item.firstChild;
    if (!marker?.name.endsWith("Marker")) return;
    const ordinal = this.ordinalOf(item);
    const { doc } = this.state;
    const line = doc.lineAt(marker.from);
    const from = isBlank(doc.sliceString(line.from, marker.from)) ? line.from : marker.from;
    const body = marker.nextSibling;
    const to =
      body && body.from > marker.to && body.from <= line.to && isBlank(doc.sliceString(marker.to, body.from))
        ? body.from
        : marker.to;
    const depth = listDepth(item);
    let widget: WidgetType;
    if (item.name === "TermItem") widget = new DescriptionItemWidget(depth);
    else widget = new ItemWidget(item.name === "EnumItem" ? "enumerate" : "itemize", ordinal, depth);
    this.push(replaceInline(from, to, widget));
  }

  private label(node: Extents): void {
    if (node.to - node.from < 3 || !this.shouldDecorate(node)) return;
    this.push(
      replaceInline(node.from, node.from + 1, new IconBraceWidget("tag", "", editorMessage("visual.label"))),
      replaceInline(node.to - 1, node.to),
    );
  }

  private documentLabels(): Set<string> {
    if (this.labels) return this.labels;
    const labels = new Set<string>();
    this.tree.iterate({
      enter: (node) => {
        if (node.name === "Label") labels.add(labelKey(this.state, node));
        return node.name === "Raw" || node.name === "Equation" ? false : undefined;
      },
    });
    this.labels = labels;
    return labels;
  }

  referenceKind(key: string): VisualReferenceKind {
    const reported = this.ports?.referenceKind?.(key);
    if (reported) return reported;
    return this.documentLabels().has(key) ? "label" : "citation";
  }

  private reference(ref: SyntaxNode): void {
    const marker = ref.getChild("RefMarker");
    const key = referenceKey(this.state, ref);
    if (!marker || !key || !this.shouldDecorate(ref)) return;
    const label = this.referenceKind(key) === "label";
    const icon = label
      ? new IconBraceWidget("tag", "", editorMessage("visual.reference"))
      : new IconBraceWidget("book", "", editorMessage("visual.citation"));
    this.push(replaceInline(marker.from, marker.from + 1, icon));
    this.supplement(ref);
  }

  private supplement(ref: SyntaxNode): void {
    const block = ref.getChild("ContentBlock");
    const body = block ? contentBody(block) : null;
    if (!block || !body) return;
    if (body.from === body.to) {
      this.push(replaceInline(block.from, block.to));
      return;
    }
    this.push(
      replaceInline(block.from, body.from, new TypstTextWidget("", "ofl-visual-typst-ref-supplement-separator")),
      replaceInline(body.to, block.to),
    );
  }

  private equation(node: SyntaxNode): void {
    if (!isClosedPair(node, "Dollar", "Dollar")) return;
    const body = this.state.sliceDoc(node.firstChild!.to, node.lastChild!.from);
    const display = isTypstDisplayBody(body);
    const range = display ? this.blockRange(node) : { from: node.from, to: node.to };
    if (!this.shouldDecorate(range)) return;
    const widget = new TypstMathWidget(this.state.sliceDoc(node.from, node.to), body, display);
    this.push(Decoration.replace({ widget, block: display }).range(range.from, range.to));
  }

  private call(hash: SyntaxNode, call: SyntaxNode): boolean | undefined {
    const name = calleeName(this.state, call);
    const args = callArguments(call);
    if (!name || !args) return undefined;
    if (name === "figure") {
      figureDecorations(this, hash, call);
      return undefined;
    }
    if (name === "table") return tableDecorations(this, hash, call) ? false : undefined;
    if (name === "image") return this.image(hash, call, args);
    if (name === "link") return this.link(hash, call, args);
    if (name === "footnote") return this.footnote(hash, call);
    if (name === "cite") return this.labelCall(hash, call, args, "book");
    if (name === "ref") return this.labelCall(hash, call, args, "tag");
    if (TYPST_STYLE_CALLS.has(name)) this.styleCall(hash, call, args);
    return undefined;
  }

  private styleCall(hash: SyntaxNode, call: SyntaxNode, args: SyntaxNode): void {
    const blocks = trailingContentBlocks(args);
    const block = blocks.length === 1 ? blocks[0] : null;
    const body = block && block.to === call.to ? contentBody(block) : null;
    if (!body || body.from === body.to) return;
    if (!this.shouldDecorate({ from: hash.from, to: call.to })) return;
    this.push(replaceInline(hash.from, body.from), replaceInline(body.to, call.to));
  }

  private link(hash: SyntaxNode, call: SyntaxNode, args: SyntaxNode): undefined {
    if (!this.shouldDecorate({ from: hash.from, to: call.to })) return undefined;
    const blocks = trailingContentBlocks(args);
    const positional = positionalArguments(args).filter((node) => node.name !== "ContentBlock");
    if (blocks.length === 1 && blocks[0].to === call.to) {
      const body = contentBody(blocks[0]);
      if (body && body.from < body.to) {
        this.push(replaceInline(hash.from, body.from), replaceInline(body.to, call.to));
      }
      return undefined;
    }
    const [url] = positional;
    if (blocks.length === 0 && positional.length === 1 && url.name === "Str" && url.to - url.from > 2) {
      this.push(replaceInline(hash.from, url.from + 1), replaceInline(url.to - 1, call.to));
    }
    return undefined;
  }

  private footnote(hash: SyntaxNode, call: SyntaxNode): boolean | undefined {
    const range = { from: hash.from, to: call.to };
    if (!this.shouldDecorate(range)) return undefined;
    this.push(replaceInline(range.from, range.to, new FootnoteWidget("footnote")));
    return false;
  }

  private labelCall(
    hash: SyntaxNode,
    call: SyntaxNode,
    args: SyntaxNode,
    icon: "book" | "tag",
  ): boolean | undefined {
    const [first] = positionalArguments(args);
    if (first?.name !== "Label" || first.to - first.from < 3) return undefined;
    if (!this.shouldDecorate({ from: hash.from, to: call.to })) return undefined;
    const title = editorMessage(icon === "book" ? "visual.citation" : "visual.reference");
    this.push(
      replaceInline(hash.from, first.from + 1, new IconBraceWidget(icon, "", title)),
      replaceInline(first.to - 1, call.to),
    );
    return false;
  }

  private image(hash: SyntaxNode, call: SyntaxNode, args: SyntaxNode): boolean | undefined {
    const range = { from: hash.from, to: call.to };
    const path = imagePath(this.state, args);
    if (!path || !this.shouldDecorate(range)) return undefined;
    const ports = this.ports ? { resolveImage: this.ports.resolveImage.bind(this.ports) } : null;
    const owned = this.ownedLines(range);
    const widget = new GraphicsWidget({ path, centered: false, block: owned !== null, range, ports });
    const target = owned ?? range;
    this.push(Decoration.replace({ widget, block: owned !== null }).range(target.from, target.to));
    return false;
  }

  ownedLines(range: Extents): Extents | null {
    const { doc } = this.state;
    const block = this.blockRange(range);
    return block.from === doc.lineAt(range.from).from && block.to === doc.lineAt(range.to).to ? block : null;
  }

  private decorateSettings(): Range<Decoration> | null {
    if (this.preamble.to <= 0) return null;
    const { doc, selection } = this.state;
    const lastLine = doc.lineAt(this.preamble.to).number;
    if (selectionIntersects(selection, this.preamble)) {
      for (let number = 1; number <= lastLine; number += 1) {
        const classes = ["ofl-visual-preamble-line"];
        if (number === 1) classes.push("ofl-visual-environment-first-line");
        if (number === lastLine) classes.push("ofl-visual-environment-last-line");
        this.push(lineClass(doc.line(number).from, classes.join(" ")));
      }
      this.push(
        Decoration.widget({ widget: new PreambleWidget(true, TYPST_SETTINGS_LABELS), block: true, side: -1 }).range(0),
      );
      return null;
    }
    const collapsed = Decoration.replace({ widget: new PreambleWidget(false, TYPST_SETTINGS_LABELS), block: true }).range(
      0,
      this.preamble.to,
    );
    this.push(collapsed);
    return collapsed;
  }
}

export function buildTypstDecorations(state: EditorState, tree: Tree): TypstDecorationResult {
  return new TypstDecorationBuilder(state, tree).build();
}

export const typstVisualField = StateField.define<TypstVisualState>({
  create(state) {
    const tree = syntaxTree(state);
    return { ...buildTypstDecorations(state, tree), tree, mousedown: false };
  },
  update(value, tr) {
    let mousedown = value.mousedown;
    for (const effect of tr.effects) {
      if (effect.is(mouseDownEffect)) mousedown = effect.value;
    }
    const tree = syntaxTree(tr.state);
    const stillParsing = tree.length < tr.state.doc.length && tree.type === value.tree.type;
    const rebuild =
      !stillParsing && !mousedown && (tree !== value.tree || tr.selection !== undefined || hasMouseDownEffect(tr));
    if (rebuild) return { ...buildTypstDecorations(tr.state, tree), tree, mousedown };
    const decorations = tr.docChanged ? value.decorations.map(tr.changes) : value.decorations;
    if (decorations === value.decorations && mousedown === value.mousedown) return value;
    return { ...value, decorations, mousedown };
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.from(field, (value) => () => value.decorations),
    skipPreambleCursor(field, (state) => {
      const tree = syntaxTree(state);
      return isTypstTree(tree) && tree.length >= state.doc.length;
    }),
  ],
});

export const typstAtomicDecorations: Extension = typstVisualField;
